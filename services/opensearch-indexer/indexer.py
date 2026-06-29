#!/usr/bin/env python3
"""
BIS OpenSearch Indexing Pipeline
=================================
Bulk-indexes BIS entities (investigations, AML alerts, KYC records) from
PostgreSQL into OpenSearch.  Designed to run as:

  1. A one-shot re-index job:   python3 indexer.py --mode full
  2. An incremental sync job:   python3 indexer.py --mode incremental --since 2h
  3. A continuous daemon:       python3 indexer.py --mode watch --interval 60

Environment variables
---------------------
DATABASE_URL          PostgreSQL DSN  (required)
OPENSEARCH_URL        OpenSearch base URL  (default: http://localhost:9200)
OPENSEARCH_USER       Basic-auth username  (default: admin)
OPENSEARCH_PASSWORD   Basic-auth password  (default: admin)
BATCH_SIZE            Documents per bulk request  (default: 500)
"""

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Generator, List, Optional, Tuple

import psycopg2
import psycopg2.extras
import requests
from requests.auth import HTTPBasicAuth

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("bis-indexer")

# ─── Config ───────────────────────────────────────────────────────────────────

DATABASE_URL    = os.environ.get("DATABASE_URL", "")
OPENSEARCH_URL  = os.environ.get("OPENSEARCH_URL", "http://localhost:9200")
OS_USER         = os.environ.get("OPENSEARCH_USER", "admin")
OS_PASSWORD     = os.environ.get("OPENSEARCH_PASSWORD", "admin")
BATCH_SIZE      = int(os.environ.get("BATCH_SIZE", "500"))

OS_AUTH = HTTPBasicAuth(OS_USER, OS_PASSWORD)
OS_HEADERS = {"Content-Type": "application/x-ndjson"}

INDEX_INVESTIGATIONS  = "bis-investigations"
INDEX_ALERTS          = "bis-alerts"
INDEX_KYC             = "bis-kyc"
INDEX_CRIMINAL        = "bis-criminal-records"
INDEX_FIELD_VISITS    = "bis-field-visits"
INDEX_CORPORATE       = "bis-corporate-checks"


# ─── Database helpers ─────────────────────────────────────────────────────────

def get_db_conn():
    """Return a new psycopg2 connection."""
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set")
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


def fetch_investigations(conn, since: Optional[datetime] = None) -> Generator[Dict, None, None]:
    """Yield investigation rows from PostgreSQL."""
    query = """
        SELECT
            i.ref,
            i.subject_name   AS "subjectName",
            i.subject_type   AS "subjectType",
            i.status,
            COALESCE(i.risk_score, 0)::float AS "riskScore",
            i.tier,
            i.priority,
            i.country,
            i.created_at     AS "createdAt",
            i.updated_at     AS "updatedAt",
            COALESCE(u.tenant_id::text, '')  AS "tenantId"
        FROM investigations i
        LEFT JOIN users u ON u.id = i.created_by
    """
    params: List[Any] = []
    if since:
        query += " WHERE i.updated_at >= %s"
        params.append(since)
    query += " ORDER BY i.updated_at DESC"

    with conn.cursor() as cur:
        cur.execute(query, params)
        for row in cur:
            yield dict(row)


def fetch_alerts(conn, since: Optional[datetime] = None) -> Generator[Dict, None, None]:
    """Yield AML alert rows from PostgreSQL."""
    query = """
        SELECT
            a.alert_ref          AS "alertRef",
            a.title,
            a.risk_level         AS "riskLevel",
            a.status,
            t.tx_ref             AS "transactionRef",
            COALESCE(a.triggered_value, 0)::float AS "triggeredValue",
            a.created_at         AS "createdAt",
            COALESCE(u.tenant_id::text, '') AS "tenantId"
        FROM aml_alerts a
        LEFT JOIN transactions t ON t.id = a.transaction_id
        LEFT JOIN users u ON u.id = t.created_by
    """
    params: List[Any] = []
    if since:
        query += " WHERE a.created_at >= %s"
        params.append(since)
    query += " ORDER BY a.created_at DESC"

    with conn.cursor() as cur:
        cur.execute(query, params)
        for row in cur:
            yield dict(row)


def fetch_kyc_records(conn, since: Optional[datetime] = None) -> Generator[Dict, None, None]:
    """Yield KYC record rows from PostgreSQL."""
    query = """
        SELECT
            k.id,
            k.subject_name   AS "subjectName",
            k.nin,
            k.bvn,
            k.status,
            COALESCE(k.risk_score, 0)::float AS "riskScore",
            k.created_at     AS "createdAt",
            COALESCE(u.tenant_id::text, '') AS "tenantId"
        FROM kyc_records k
        LEFT JOIN users u ON u.id = k.created_by
    """
    params: List[Any] = []
    if since:
        query += " WHERE k.created_at >= %s"
        params.append(since)
    query += " ORDER BY k.created_at DESC"

    with conn.cursor() as cur:
        cur.execute(query, params)
        for row in cur:
            yield dict(row)



def fetch_criminal_records(conn, since=None):
    """Yield criminal record rows from PostgreSQL."""
    query = """
        SELECT
            cr.id,
            cr.record_ref          AS "recordRef",
            cr.subject_name        AS "subjectName",
            cr.subject_type        AS "subjectType",
            cr.nin,
            cr.bvn,
            cr.agency,
            cr.offence_category    AS "offenceCategory",
            cr.offence_description AS "offenceDescription",
            cr.verdict,
            cr.outstanding_warrant AS "outstandingWarrant",
            COALESCE(cr.confidence_score, 0)::float AS "confidenceScore",
            cr.created_at          AS "createdAt",
            COALESCE(u.tenant_id::text, '') AS "tenantId"
        FROM criminal_records cr
        LEFT JOIN criminal_record_requests crr ON crr.id = cr.request_id
        LEFT JOIN users u ON u.id = crr.created_by
    """
    params = []
    if since:
        query += " WHERE cr.created_at >= %s"
        params.append(since)
    query += " ORDER BY cr.created_at DESC"
    with conn.cursor() as cur:
        cur.execute(query, params)
        for row in cur:
            yield dict(row)


def fetch_field_visits(conn, since=None):
    """Yield field visit report rows from PostgreSQL."""
    query = """
        SELECT
            fvr.id,
            fvr.task_ref           AS "taskRef",
            fvr.subject_name       AS "subjectName",
            fvr.outcome,
            fvr.address_confirmed  AS "addressConfirmed",
            fvr.subject_present    AS "subjectPresent",
            COALESCE(fvr.gps_lat, 0)::float  AS "gpsLat",
            COALESCE(fvr.gps_lng, 0)::float  AS "gpsLng",
            COALESCE(fvr.duration_minutes, 0)::int AS "durationMinutes",
            fvr.narrative,
            fvr.created_at         AS "createdAt",
            COALESCE(u.tenant_id::text, '') AS "tenantId"
        FROM field_visit_reports fvr
        LEFT JOIN field_tasks ft ON ft.id = fvr.task_id
        LEFT JOIN users u ON u.id = ft.assigned_to
    """
    params = []
    if since:
        query += " WHERE fvr.created_at >= %s"
        params.append(since)
    query += " ORDER BY fvr.created_at DESC"
    with conn.cursor() as cur:
        cur.execute(query, params)
        for row in cur:
            yield dict(row)


def fetch_corporate_checks(conn, since=None):
    """Yield corporate screening profile rows from PostgreSQL."""
    query = """
        SELECT
            csp.id,
            csp.profile_ref        AS "profileRef",
            csp.company_name       AS "companyName",
            csp.rc_number          AS "rcNumber",
            csp.tin,
            csp.cac_status         AS "cacStatus",
            csp.firs_cleared       AS "firsCleared",
            csp.sanctions_hit      AS "sanctionsHit",
            COALESCE(csp.risk_score, 0)::float AS "riskScore",
            csp.outcome,
            csp.created_at         AS "createdAt",
            COALESCE(u.tenant_id::text, '') AS "tenantId"
        FROM corporate_screening_profiles csp
        LEFT JOIN users u ON u.id = csp.created_by
    """
    params = []
    if since:
        query += " WHERE csp.created_at >= %s"
        params.append(since)
    query += " ORDER BY csp.created_at DESC"
    with conn.cursor() as cur:
        cur.execute(query, params)
        for row in cur:
            yield dict(row)


# ─── OpenSearch helpers ───────────────────────────────────────────────────────

def _serialize(obj: Any) -> Any:
    """JSON-serialize datetime objects."""
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


def bulk_index(index: str, id_field: str, rows: Generator[Dict, None, None]) -> Tuple[int, int]:
    """
    Bulk-index rows into OpenSearch.

    Returns (indexed_count, error_count).
    """
    indexed = 0
    errors  = 0
    batch: List[Dict] = []

    def flush(batch: List[Dict]) -> Tuple[int, int]:
        if not batch:
            return 0, 0
        lines = []
        for doc in batch:
            doc_id = str(doc.get(id_field, ""))
            lines.append(json.dumps({"index": {"_index": index, "_id": doc_id}}))
            lines.append(json.dumps(doc, default=_serialize))
        body = "\n".join(lines) + "\n"

        resp = requests.post(
            f"{OPENSEARCH_URL}/_bulk",
            data=body,
            headers=OS_HEADERS,
            auth=OS_AUTH,
            timeout=30,
        )
        if resp.status_code >= 300:
            log.error("Bulk index error %d: %s", resp.status_code, resp.text[:500])
            return 0, len(batch)

        result = resp.json()
        ok = sum(1 for item in result.get("items", []) if "error" not in item.get("index", {}))
        err = len(result.get("items", [])) - ok
        return ok, err

    for row in rows:
        batch.append(row)
        if len(batch) >= BATCH_SIZE:
            ok, err = flush(batch)
            indexed += ok
            errors  += err
            batch = []

    ok, err = flush(batch)
    indexed += ok
    errors  += err

    return indexed, errors


# ─── Index modes ──────────────────────────────────────────────────────────────

def run_full_index():
    """Re-index all entities from scratch."""
    log.info("Starting full re-index...")
    conn = get_db_conn()
    try:
        for index, id_field, fetcher in [
            (INDEX_INVESTIGATIONS, "ref",       fetch_investigations),
            (INDEX_ALERTS,         "alertRef",  fetch_alerts),
            (INDEX_KYC,            "id",        fetch_kyc_records),
            (INDEX_CRIMINAL,       "id",        fetch_criminal_records),
            (INDEX_FIELD_VISITS,   "id",        fetch_field_visits),
            (INDEX_CORPORATE,      "id",        fetch_corporate_checks),
        ]:
            log.info("Indexing %s ...", index)
            ok, err = bulk_index(index, id_field, fetcher(conn))
            log.info("  %s: %d indexed, %d errors", index, ok, err)
    finally:
        conn.close()


def run_incremental_index(since: datetime):
    """Index only records updated since the given datetime."""
    log.info("Incremental index since %s ...", since.isoformat())
    conn = get_db_conn()
    try:
        for index, id_field, fetcher in [
            (INDEX_INVESTIGATIONS, "ref",       fetch_investigations),
            (INDEX_ALERTS,         "alertRef",  fetch_alerts),
            (INDEX_KYC,            "id",        fetch_kyc_records),
            (INDEX_CRIMINAL,       "id",        fetch_criminal_records),
            (INDEX_FIELD_VISITS,   "id",        fetch_field_visits),
            (INDEX_CORPORATE,      "id",        fetch_corporate_checks),
        ]:
            log.info("Incremental %s ...", index)
            ok, err = bulk_index(index, id_field, fetcher(conn, since=since))
            log.info("  %s: %d indexed, %d errors", index, ok, err)
    finally:
        conn.close()


def run_watch_mode(interval_seconds: int):
    """Continuously poll for new records and index them."""
    log.info("Watch mode: interval=%ds", interval_seconds)
    last_run = datetime.now(timezone.utc) - timedelta(seconds=interval_seconds)

    while True:
        try:
            run_incremental_index(since=last_run)
            last_run = datetime.now(timezone.utc)
        except Exception as exc:
            log.error("Watch mode error: %s", exc)

        log.info("Sleeping %ds until next sync...", interval_seconds)
        time.sleep(interval_seconds)


# ─── CLI ──────────────────────────────────────────────────────────────────────

def parse_since(value: str) -> datetime:
    """Parse a relative time string like '2h', '30m', '1d' into a datetime."""
    unit = value[-1].lower()
    amount = int(value[:-1])
    delta = {
        "m": timedelta(minutes=amount),
        "h": timedelta(hours=amount),
        "d": timedelta(days=amount),
    }.get(unit)
    if delta is None:
        raise argparse.ArgumentTypeError(f"Invalid since value: {value!r} (use e.g. 2h, 30m, 1d)")
    return datetime.now(timezone.utc) - delta


def main():
    parser = argparse.ArgumentParser(description="BIS OpenSearch Indexing Pipeline")
    parser.add_argument(
        "--mode",
        choices=["full", "incremental", "watch"],
        default="full",
        help="Indexing mode",
    )
    parser.add_argument(
        "--since",
        type=parse_since,
        default="24h",
        help="For incremental mode: how far back to look (e.g. 2h, 30m, 1d)",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=60,
        help="For watch mode: polling interval in seconds",
    )
    args = parser.parse_args()

    if args.mode == "full":
        run_full_index()
    elif args.mode == "incremental":
        since = args.since if isinstance(args.since, datetime) else parse_since(args.since)
        run_incremental_index(since)
    elif args.mode == "watch":
        run_watch_mode(args.interval)


if __name__ == "__main__":
    main()
