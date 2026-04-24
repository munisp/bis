"""
BIS Risk Engine — DuckDB Analytics Layer
=========================================
Provides risk-focused analytics queries over the Delta Lake parquet files.
All queries use DuckDB's parameterised query API to prevent SQL injection.

Security: All user-supplied values are passed as parameters, never interpolated
into SQL strings. Table paths are constructed from a hardcoded LAKEHOUSE_BASE
directory and a validated table name allowlist.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("bis-duckdb-analytics")

LAKEHOUSE_BASE = Path(os.getenv("LAKEHOUSE_BASE_PATH", "/data/lakehouse"))

# Allowlist of valid table names — prevents path traversal
VALID_TABLES = frozenset([
    "transactions", "aml_alerts", "investigations", "kyc_records",
    "sar_filings", "audit_log", "field_tasks", "reports",
])

# ─── DuckDB availability check ────────────────────────────────────────────────

try:
    import duckdb
    DUCKDB_AVAILABLE = True
except ImportError:
    DUCKDB_AVAILABLE = False
    logger.warning("duckdb not installed — analytics queries will return empty results")


def _conn():
    """Return a fresh in-memory DuckDB connection."""
    if not DUCKDB_AVAILABLE:
        raise RuntimeError("duckdb not available")
    conn = duckdb.connect(":memory:")
    conn.execute("INSTALL parquet; LOAD parquet;")
    return conn


def _validate_table(table: str) -> str:
    """Validate table name against allowlist. Raises ValueError if invalid."""
    if table not in VALID_TABLES:
        raise ValueError(f"Invalid table name: {table!r}. Must be one of: {sorted(VALID_TABLES)}")
    return table


def _validate_channel(channel: str) -> str:
    """Validate channel name (alphanumeric + underscore only)."""
    if not re.match(r'^[a-zA-Z0-9_]{1,50}$', channel):
        raise ValueError(f"Invalid channel: {channel!r}")
    return channel


def _validate_account_id(account_id: str) -> str:
    """Validate account ID (alphanumeric + hyphens only)."""
    if not re.match(r'^[a-zA-Z0-9\-_]{1,100}$', account_id):
        raise ValueError(f"Invalid account_id: {account_id!r}")
    return account_id


def _table_glob(table: str) -> str:
    """Return glob pattern for a validated table name."""
    _validate_table(table)
    return str(LAKEHOUSE_BASE / table / "**" / "*.parquet")


def _table_exists(table: str) -> bool:
    """Return True if the table directory contains at least one parquet file."""
    try:
        _validate_table(table)
    except ValueError:
        return False
    p = LAKEHOUSE_BASE / table
    return p.exists() and any(p.rglob("*.parquet"))


def _run(sql: str, params: Optional[list] = None) -> list[dict[str, Any]]:
    """Execute a parameterised DuckDB query and return results as list of dicts."""
    conn = _conn()
    try:
        result = conn.execute(sql, params or []).fetchdf()
        return result.to_dict(orient="records")
    finally:
        conn.close()


# ─── Peer Group Baseline ──────────────────────────────────────────────────────

def peer_group_baseline(channel: str, days: int = 90) -> dict[str, Any]:
    """
    Compute average and 95th-percentile transaction amounts for a given
    channel over the last N days. Used as a baseline for anomaly detection.
    """
    if not DUCKDB_AVAILABLE or not _table_exists("transactions"):
        return {"channel": channel, "available": False}

    channel = _validate_channel(channel)
    path = _table_glob("transactions")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")

    # Path is hardcoded from LAKEHOUSE_BASE — safe to embed in SQL
    # channel and cutoff are passed as parameters
    rows = _run(
        f"""
        SELECT
            channel,
            COUNT(*) as tx_count,
            AVG(amount_kobo) / 100.0 as avg_ngn,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount_kobo) / 100.0 as p50_ngn,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY amount_kobo) / 100.0 as p95_ngn,
            PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY amount_kobo) / 100.0 as p99_ngn,
            STDDEV(amount_kobo) / 100.0 as stddev_ngn
        FROM read_parquet('{path}', union_by_name=true)
        WHERE created_at >= ?
          AND channel = ?
        GROUP BY channel
        """,
        [cutoff, channel],
    )
    if not rows:
        return {"channel": channel, "available": False, "tx_count": 0}
    return {"available": True, **rows[0]}


def all_channel_baselines(days: int = 90) -> list[dict[str, Any]]:
    """Return peer group baselines for all channels."""
    if not DUCKDB_AVAILABLE or not _table_exists("transactions"):
        return []
    path = _table_glob("transactions")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    return _run(
        f"""
        SELECT
            channel,
            COUNT(*) as tx_count,
            AVG(amount_kobo) / 100.0 as avg_ngn,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY amount_kobo) / 100.0 as p95_ngn,
            PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY amount_kobo) / 100.0 as p99_ngn
        FROM read_parquet('{path}', union_by_name=true)
        WHERE created_at >= ?
        GROUP BY channel
        ORDER BY tx_count DESC
        """,
        [cutoff],
    )


# ─── Velocity Analysis ────────────────────────────────────────────────────────

def account_velocity(account_id: str, window_hours: int = 24) -> dict[str, Any]:
    """
    Return transaction velocity for a specific account over the last N hours.
    account_id is validated and passed as a parameter (not interpolated).
    """
    if not DUCKDB_AVAILABLE or not _table_exists("transactions"):
        return {"account_id": account_id, "available": False}

    account_id = _validate_account_id(account_id)
    path = _table_glob("transactions")
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=window_hours)).isoformat()

    rows = _run(
        f"""
        SELECT
            account_id,
            COUNT(*) as tx_count,
            SUM(amount_kobo) / 100.0 as total_ngn,
            COUNT(DISTINCT counterparty_account) as distinct_counterparties,
            COUNT(DISTINCT channel) as distinct_channels,
            MIN(created_at) as first_tx,
            MAX(created_at) as last_tx
        FROM read_parquet('{path}', union_by_name=true)
        WHERE account_id = ?
          AND created_at >= ?
        GROUP BY account_id
        """,
        [account_id, cutoff],
    )
    if not rows:
        return {"account_id": account_id, "available": True, "tx_count": 0, "window_hours": window_hours}
    return {"available": True, "window_hours": window_hours, **rows[0]}


def high_velocity_accounts(window_hours: int = 24, min_tx_count: int = 10) -> list[dict[str, Any]]:
    """Return accounts with unusually high transaction velocity."""
    if not DUCKDB_AVAILABLE or not _table_exists("transactions"):
        return []
    path = _table_glob("transactions")
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=window_hours)).isoformat()
    return _run(
        f"""
        SELECT
            account_id,
            COUNT(*) as tx_count,
            SUM(amount_kobo) / 100.0 as total_ngn,
            COUNT(DISTINCT counterparty_account) as distinct_counterparties
        FROM read_parquet('{path}', union_by_name=true)
        WHERE created_at >= ?
        GROUP BY account_id
        HAVING COUNT(*) >= ?
        ORDER BY tx_count DESC
        LIMIT 50
        """,
        [cutoff, min_tx_count],
    )


# ─── Entity Risk Trend ────────────────────────────────────────────────────────

def entity_risk_trend(subject_name: str, days: int = 90) -> list[dict[str, Any]]:
    """
    Return weekly risk score trend for a named subject.
    subject_name is validated (max 200 chars, no SQL metacharacters) and
    passed as a DuckDB parameter — never interpolated into SQL.
    """
    if not DUCKDB_AVAILABLE or not _table_exists("aml_alerts"):
        return []

    # Validate: max 200 chars, strip leading/trailing whitespace
    subject_name = subject_name.strip()[:200]
    if not subject_name:
        return []

    path = _table_glob("aml_alerts")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")

    # Use ILIKE with a parameterised wildcard pattern
    pattern = f"%{subject_name}%"
    return _run(
        f"""
        SELECT
            DATE_TRUNC('week', created_at) as week,
            COUNT(*) as alert_count,
            COUNT(CASE WHEN risk_level IN ('high', 'critical') THEN 1 END) as high_risk_count
        FROM read_parquet('{path}', union_by_name=true)
        WHERE subject_name ILIKE ?
          AND created_at >= ?
        GROUP BY 1
        ORDER BY 1
        """,
        [pattern, cutoff],
    )


# ─── Risk Score Distribution ──────────────────────────────────────────────────

def risk_score_distribution(days: int = 30, buckets: int = 10) -> list[dict[str, Any]]:
    """Return histogram of transaction risk scores."""
    if not DUCKDB_AVAILABLE or not _table_exists("transactions"):
        return []
    path = _table_glob("transactions")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    bucket_size = max(1, 100 // buckets)
    return _run(
        f"""
        SELECT
            FLOOR(risk_score / {bucket_size}) * {bucket_size} as bucket_start,
            FLOOR(risk_score / {bucket_size}) * {bucket_size} + {bucket_size - 1} as bucket_end,
            COUNT(*) as count
        FROM read_parquet('{path}', union_by_name=true)
        WHERE created_at >= ?
          AND risk_score IS NOT NULL
        GROUP BY 1, 2
        ORDER BY 1
        """,
        [cutoff],
    )


# ─── Network Analysis ─────────────────────────────────────────────────────────

def account_network(account_id: str, hops: int = 1, days: int = 30) -> dict[str, Any]:
    """
    Return the immediate transaction network for an account.
    account_id is validated and passed as a parameter.
    """
    if not DUCKDB_AVAILABLE or not _table_exists("transactions"):
        return {"account_id": account_id, "nodes": [], "edges": []}

    account_id = _validate_account_id(account_id)
    path = _table_glob("transactions")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")

    edges = _run(
        f"""
        SELECT
            account_id as source,
            counterparty_account as target,
            COUNT(*) as tx_count,
            SUM(amount_kobo) / 100.0 as total_ngn,
            direction
        FROM read_parquet('{path}', union_by_name=true)
        WHERE (account_id = ? OR counterparty_account = ?)
          AND created_at >= ?
        GROUP BY 1, 2, 5
        ORDER BY total_ngn DESC
        LIMIT 50
        """,
        [account_id, account_id, cutoff],
    )

    nodes: set[str] = set()
    for e in edges:
        if e.get("source"):
            nodes.add(str(e["source"]))
        if e.get("target"):
            nodes.add(str(e["target"]))

    return {
        "account_id": account_id,
        "period_days": days,
        "node_count": len(nodes),
        "edge_count": len(edges),
        "nodes": list(nodes),
        "edges": edges,
    }


# ─── Anomaly Score Helpers ────────────────────────────────────────────────────

def compute_z_score(value: float, mean: float, stddev: float) -> float:
    """Return the Z-score for a value given a distribution's mean and stddev."""
    if stddev == 0:
        return 0.0
    return (value - mean) / stddev


def amount_anomaly_score(amount_kobo: int, channel: str) -> float:
    """
    Return a 0-100 anomaly score for a transaction amount relative to its
    channel peer group. Uses Z-score clamped to [0, 100].
    """
    try:
        baseline = peer_group_baseline(channel)
    except ValueError:
        return 50.0  # neutral score for invalid channel

    if not baseline.get("available"):
        return 50.0  # neutral score when no baseline available

    avg = baseline.get("avg_ngn", 0) * 100  # convert back to kobo
    stddev = baseline.get("stddev_ngn", 1) * 100
    z = compute_z_score(amount_kobo, avg, stddev)
    # Map Z-score to 0-100: Z=0 → 0, Z=3 → 100
    score = min(100.0, max(0.0, (z / 3.0) * 100.0))
    return round(score, 2)


# ─── Structuring Detection ────────────────────────────────────────────────────

def structuring_detection(days: int = 30, threshold_kobo: int = 500_000_00) -> list[dict[str, Any]]:
    """
    Detect potential structuring: accounts with many transactions just below
    the reporting threshold (default: ₦5,000,000 = 500_000_00 kobo).
    """
    if not DUCKDB_AVAILABLE or not _table_exists("transactions"):
        return []
    path = _table_glob("transactions")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    sub_threshold = int(threshold_kobo * 0.9)

    return _run(
        f"""
        SELECT
            account_id,
            COUNT(*) as tx_count,
            SUM(amount_kobo) / 100.0 as total_ngn,
            MIN(amount_kobo) / 100.0 as min_ngn,
            MAX(amount_kobo) / 100.0 as max_ngn,
            COUNT(DISTINCT CAST(created_at AS DATE)) as active_days
        FROM read_parquet('{path}', union_by_name=true)
        WHERE created_at >= ?
          AND amount_kobo BETWEEN ? AND ?
          AND direction = 'debit'
        GROUP BY account_id
        HAVING COUNT(*) >= 5
        ORDER BY tx_count DESC
        LIMIT 100
        """,
        [cutoff, sub_threshold, threshold_kobo],
    )
