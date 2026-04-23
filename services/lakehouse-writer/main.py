"""
BIS Lakehouse Writer Service
────────────────────────────
FastAPI microservice that consumes events from Kafka and writes them to a
Delta Lake on the local filesystem (or S3-compatible object store).

Endpoints
---------
POST /ingest/investigation   – write one investigation row to the investigations delta table
POST /ingest/alert           – write one alert row to the alerts delta table
POST /ingest/kyc             – write one KYC record row to the kyc delta table
POST /query/duckdb           – run an arbitrary read-only DuckDB SQL query over the parquet files
GET  /health                 – liveness probe
GET  /tables                 – list registered delta tables and row counts

Architecture
------------
• Delta Lake tables are stored under LAKEHOUSE_BASE_PATH (default: /data/lakehouse)
• Each table is partitioned by date (year/month/day) for efficient time-range queries
• DuckDB is used as the query engine — it can read Delta Lake parquet files natively
• Kafka consumer (optional) auto-ingests events when KAFKA_BROKERS is set
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import duckdb
import pandas as pd
import pyarrow as pa
from deltalake import DeltaTable, write_deltalake
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ── Configuration ─────────────────────────────────────────────────────────────
LAKEHOUSE_BASE = Path(os.getenv("LAKEHOUSE_BASE_PATH", "/data/lakehouse"))
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "")
KAFKA_TOPICS = os.getenv("KAFKA_TOPICS", "bis.investigations,bis.alerts,bis.kyc").split(",")
SERVICE_PORT = int(os.getenv("LAKEHOUSE_PORT", "8085"))
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

logging.basicConfig(level=getattr(logging, LOG_LEVEL), format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("lakehouse-writer")

# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="BIS Lakehouse Writer",
    description="Delta Lake ingestion and DuckDB analytics service for the BIS platform",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Table schemas (PyArrow) ───────────────────────────────────────────────────
INVESTIGATION_SCHEMA = pa.schema([
    pa.field("id", pa.int64()),
    pa.field("ref", pa.string()),
    pa.field("subject_type", pa.string()),
    pa.field("subject_name", pa.string()),
    pa.field("country", pa.string()),
    pa.field("tier", pa.string()),
    pa.field("priority", pa.string()),
    pa.field("status", pa.string()),
    pa.field("risk_score", pa.float64()),
    pa.field("risk_tier", pa.string()),
    pa.field("created_by", pa.string()),
    pa.field("created_at", pa.timestamp("ms", tz="UTC")),
    pa.field("updated_at", pa.timestamp("ms", tz="UTC")),
    pa.field("completed_at", pa.timestamp("ms", tz="UTC"), nullable=True),
    # Partition columns
    pa.field("year", pa.int32()),
    pa.field("month", pa.int32()),
    pa.field("day", pa.int32()),
])

ALERT_SCHEMA = pa.schema([
    pa.field("id", pa.int64()),
    pa.field("investigation_id", pa.int64(), nullable=True),
    pa.field("type", pa.string()),
    pa.field("severity", pa.string()),
    pa.field("title", pa.string()),
    pa.field("body", pa.string()),
    pa.field("subject_ref", pa.string(), nullable=True),
    pa.field("source_service", pa.string(), nullable=True),
    pa.field("read", pa.bool_()),
    pa.field("acknowledged", pa.bool_()),
    pa.field("resolved", pa.bool_()),
    pa.field("dismissed", pa.bool_()),
    pa.field("created_at", pa.timestamp("ms", tz="UTC")),
    pa.field("year", pa.int32()),
    pa.field("month", pa.int32()),
    pa.field("day", pa.int32()),
])

KYC_SCHEMA = pa.schema([
    pa.field("id", pa.int64()),
    pa.field("investigation_id", pa.int64(), nullable=True),
    pa.field("subject_name", pa.string()),
    pa.field("nin", pa.string(), nullable=True),
    pa.field("bvn", pa.string(), nullable=True),
    pa.field("status", pa.string()),
    pa.field("risk_score", pa.float64(), nullable=True),
    pa.field("biometric_status", pa.string(), nullable=True),
    pa.field("created_by", pa.string(), nullable=True),
    pa.field("created_at", pa.timestamp("ms", tz="UTC")),
    pa.field("year", pa.int32()),
    pa.field("month", pa.int32()),
    pa.field("day", pa.int32()),
])

TABLE_REGISTRY: dict[str, dict] = {
    "investigations": {
        "path": LAKEHOUSE_BASE / "investigations",
        "schema": INVESTIGATION_SCHEMA,
        "partition_by": ["year", "month", "day"],
    },
    "alerts": {
        "path": LAKEHOUSE_BASE / "alerts",
        "schema": ALERT_SCHEMA,
        "partition_by": ["year", "month", "day"],
    },
    "kyc": {
        "path": LAKEHOUSE_BASE / "kyc",
        "schema": KYC_SCHEMA,
        "partition_by": ["year", "month", "day"],
    },
}

# ── Helpers ───────────────────────────────────────────────────────────────────
def ensure_table_dirs() -> None:
    """Create lakehouse directories if they don't exist."""
    LAKEHOUSE_BASE.mkdir(parents=True, exist_ok=True)
    for meta in TABLE_REGISTRY.values():
        meta["path"].mkdir(parents=True, exist_ok=True)


def _partition_cols(ts: datetime) -> dict:
    return {"year": ts.year, "month": ts.month, "day": ts.day}


def write_row(table_name: str, row: dict) -> None:
    """Append a single row to a Delta Lake table."""
    meta = TABLE_REGISTRY.get(table_name)
    if not meta:
        raise ValueError(f"Unknown table: {table_name}")
    table_path = str(meta["path"])
    schema = meta["schema"]
    partition_by = meta["partition_by"]

    df = pd.DataFrame([row])
    arrow_table = pa.Table.from_pandas(df, schema=schema, preserve_index=False)

    write_deltalake(
        table_path,
        arrow_table,
        mode="append",
        partition_by=partition_by,
        schema_mode="merge",
    )
    logger.info(f"[lakehouse] Wrote 1 row to {table_name}")


def get_row_count(table_name: str) -> int:
    """Return the total row count for a Delta table."""
    meta = TABLE_REGISTRY.get(table_name)
    if not meta:
        return 0
    table_path = str(meta["path"])
    try:
        dt = DeltaTable(table_path)
        return dt.to_pandas().shape[0]
    except Exception:
        return 0


def run_duckdb_query(sql: str) -> list[dict]:
    """Execute a read-only DuckDB query over the lakehouse parquet files."""
    con = duckdb.connect(database=":memory:")
    # Register each delta table as a DuckDB view using its parquet files
    for table_name, meta in TABLE_REGISTRY.items():
        table_path = str(meta["path"])
        parquet_glob = f"{table_path}/**/*.parquet"
        try:
            con.execute(f"CREATE VIEW {table_name} AS SELECT * FROM read_parquet('{parquet_glob}', hive_partitioning=true)")
        except Exception:
            # Table may not have any parquet files yet; create empty view
            con.execute(f"CREATE VIEW {table_name} AS SELECT * FROM (VALUES (NULL)) t(dummy) WHERE 1=0")

    # Block write operations
    sql_upper = sql.strip().upper()
    for forbidden in ("INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER", "TRUNCATE"):
        if forbidden in sql_upper:
            raise ValueError(f"Write operations not allowed in query endpoint: {forbidden}")

    result = con.execute(sql).fetchdf()
    con.close()
    return result.to_dict(orient="records")


# ── Pydantic models ───────────────────────────────────────────────────────────
class InvestigationRow(BaseModel):
    id: int
    ref: str
    subject_type: str = "individual"
    subject_name: str
    country: str = "NG"
    tier: str = "standard"
    priority: str = "medium"
    status: str = "open"
    risk_score: float = 0.0
    risk_tier: str = "low"
    created_by: str = "system"
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    completed_at: Optional[str] = None


class AlertRow(BaseModel):
    id: int
    investigation_id: Optional[int] = None
    type: str = "system"
    severity: str = "medium"
    title: str
    body: str = ""
    subject_ref: Optional[str] = None
    source_service: Optional[str] = None
    read: bool = False
    acknowledged: bool = False
    resolved: bool = False
    dismissed: bool = False
    created_at: Optional[str] = None


class KycRow(BaseModel):
    id: int
    investigation_id: Optional[int] = None
    subject_name: str
    nin: Optional[str] = None
    bvn: Optional[str] = None
    status: str = "pending"
    risk_score: Optional[float] = None
    biometric_status: Optional[str] = None
    created_by: Optional[str] = None
    created_at: Optional[str] = None


class DuckDBQuery(BaseModel):
    sql: str = Field(..., description="Read-only SQL query to execute against the lakehouse")
    limit: int = Field(default=1000, ge=1, le=10000)


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "lakehouse-writer",
        "lakehouse_base": str(LAKEHOUSE_BASE),
        "tables": list(TABLE_REGISTRY.keys()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/tables")
async def list_tables():
    """List all registered Delta tables with row counts."""
    result = []
    for table_name, meta in TABLE_REGISTRY.items():
        table_path = str(meta["path"])
        try:
            dt = DeltaTable(table_path)
            version = dt.version()
            row_count = dt.to_pandas().shape[0]
            last_commit = dt.history(1)[0].get("timestamp", 0)
        except Exception:
            version = -1
            row_count = 0
            last_commit = 0
        result.append({
            "table": table_name,
            "path": table_path,
            "version": version,
            "row_count": row_count,
            "last_commit_ms": last_commit,
        })
    return {"tables": result}


@app.post("/ingest/investigation")
async def ingest_investigation(row: InvestigationRow):
    """Write one investigation row to the Delta Lake."""
    now = datetime.now(timezone.utc)
    created_at = datetime.fromisoformat(row.created_at) if row.created_at else now
    updated_at = datetime.fromisoformat(row.updated_at) if row.updated_at else now
    completed_at = datetime.fromisoformat(row.completed_at) if row.completed_at else None

    data = {
        "id": row.id,
        "ref": row.ref,
        "subject_type": row.subject_type,
        "subject_name": row.subject_name,
        "country": row.country,
        "tier": row.tier,
        "priority": row.priority,
        "status": row.status,
        "risk_score": row.risk_score,
        "risk_tier": row.risk_tier,
        "created_by": row.created_by,
        "created_at": pd.Timestamp(created_at),
        "updated_at": pd.Timestamp(updated_at),
        "completed_at": pd.Timestamp(completed_at) if completed_at else None,
        **_partition_cols(created_at),
    }
    try:
        write_row("investigations", data)
        return {"ok": True, "table": "investigations", "ref": row.ref}
    except Exception as e:
        logger.error(f"Failed to write investigation {row.ref}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ingest/alert")
async def ingest_alert(row: AlertRow):
    """Write one alert row to the Delta Lake."""
    now = datetime.now(timezone.utc)
    created_at = datetime.fromisoformat(row.created_at) if row.created_at else now

    data = {
        "id": row.id,
        "investigation_id": row.investigation_id,
        "type": row.type,
        "severity": row.severity,
        "title": row.title,
        "body": row.body,
        "subject_ref": row.subject_ref,
        "source_service": row.source_service,
        "read": row.read,
        "acknowledged": row.acknowledged,
        "resolved": row.resolved,
        "dismissed": row.dismissed,
        "created_at": pd.Timestamp(created_at),
        **_partition_cols(created_at),
    }
    try:
        write_row("alerts", data)
        return {"ok": True, "table": "alerts", "id": row.id}
    except Exception as e:
        logger.error(f"Failed to write alert {row.id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ingest/kyc")
async def ingest_kyc(row: KycRow):
    """Write one KYC record row to the Delta Lake."""
    now = datetime.now(timezone.utc)
    created_at = datetime.fromisoformat(row.created_at) if row.created_at else now

    data = {
        "id": row.id,
        "investigation_id": row.investigation_id,
        "subject_name": row.subject_name,
        "nin": row.nin,
        "bvn": row.bvn,
        "status": row.status,
        "risk_score": row.risk_score,
        "biometric_status": row.biometric_status,
        "created_by": row.created_by,
        "created_at": pd.Timestamp(created_at),
        **_partition_cols(created_at),
    }
    try:
        write_row("kyc", data)
        return {"ok": True, "table": "kyc", "id": row.id}
    except Exception as e:
        logger.error(f"Failed to write KYC record {row.id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/query/duckdb")
async def query_duckdb(body: DuckDBQuery):
    """Execute a read-only DuckDB SQL query over the lakehouse parquet files."""
    sql = body.sql.strip()
    if not sql.upper().startswith("SELECT"):
        raise HTTPException(status_code=400, detail="Only SELECT queries are allowed")
    # Inject LIMIT if not present
    if "LIMIT" not in sql.upper():
        sql = f"{sql} LIMIT {body.limit}"
    try:
        rows = run_duckdb_query(sql)
        return {"ok": True, "row_count": len(rows), "rows": rows}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"DuckDB query error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Kafka consumer (optional) ─────────────────────────────────────────────────
async def kafka_consumer_loop():
    """Consume events from Kafka and write to Delta Lake."""
    if not KAFKA_BROKERS:
        logger.info("[lakehouse] KAFKA_BROKERS not set — Kafka consumer disabled")
        return
    try:
        from aiokafka import AIOKafkaConsumer  # type: ignore
    except ImportError:
        logger.warning("[lakehouse] aiokafka not installed — Kafka consumer disabled")
        return

    consumer = AIOKafkaConsumer(
        *KAFKA_TOPICS,
        bootstrap_servers=KAFKA_BROKERS,
        group_id="lakehouse-writer",
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        auto_offset_reset="earliest",
    )
    await consumer.start()
    logger.info(f"[lakehouse] Kafka consumer started on topics: {KAFKA_TOPICS}")
    try:
        async for msg in consumer:
            topic = msg.topic
            value = msg.value
            try:
                if "investigations" in topic:
                    await ingest_investigation(InvestigationRow(**value))
                elif "alerts" in topic:
                    await ingest_alert(AlertRow(**value))
                elif "kyc" in topic:
                    await ingest_kyc(KycRow(**value))
            except Exception as e:
                logger.error(f"[lakehouse] Failed to process Kafka message from {topic}: {e}")
    finally:
        await consumer.stop()


# ── Batch Ingest ─────────────────────────────────────────────────────────────
class BatchIngestRequest(BaseModel):
    table: str
    rows: list[dict]

@app.post("/ingest/batch")
async def ingest_batch(body: BatchIngestRequest):
    """Batch-write multiple rows to any supported Delta Lake table."""
    supported = {"investigations", "alerts", "kyc", "transactions", "aml_alerts", "sar_filings", "cases"}
    if body.table not in supported:
        raise HTTPException(status_code=400, detail=f"Unsupported table: {body.table}. Supported: {sorted(supported)}")
    written = 0
    errors = []
    for i, row in enumerate(body.rows):
        try:
            row["_ingested_at"] = datetime.now(timezone.utc).isoformat()
            if "created_at" not in row:
                row["created_at"] = row["_ingested_at"]
            ts = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))
            row.update(_partition_cols(ts))
            write_row(body.table, {k: pd.Timestamp(v) if k.endswith("_at") and v else v for k, v in row.items()})
            written += 1
        except Exception as e:
            errors.append({"index": i, "error": str(e)})
    return {"ok": True, "table": body.table, "written": written, "errors": errors}


# ── Transaction Ingest ────────────────────────────────────────────────────────
class TransactionRow(BaseModel):
    id: str
    ref: Optional[str] = None
    account_id: Optional[str] = None
    counterparty_account: Optional[str] = None
    amount_kobo: Optional[int] = None
    currency: Optional[str] = "NGN"
    direction: Optional[str] = None  # credit | debit
    channel: Optional[str] = None
    narration: Optional[str] = None
    status: Optional[str] = None
    risk_score: Optional[float] = None
    aml_flag: Optional[bool] = False
    created_at: Optional[str] = None

@app.post("/ingest/transaction")
async def ingest_transaction(row: TransactionRow):
    """Write one transaction row to the Delta Lake."""
    now = datetime.now(timezone.utc)
    created_at = datetime.fromisoformat(row.created_at.replace("Z", "+00:00")) if row.created_at else now
    data = {
        "id": row.id,
        "ref": row.ref,
        "account_id": row.account_id,
        "counterparty_account": row.counterparty_account,
        "amount_kobo": row.amount_kobo,
        "currency": row.currency,
        "direction": row.direction,
        "channel": row.channel,
        "narration": row.narration,
        "status": row.status,
        "risk_score": row.risk_score,
        "aml_flag": row.aml_flag,
        "created_at": pd.Timestamp(created_at),
        **_partition_cols(created_at),
    }
    try:
        write_row("transactions", data)
        return {"ok": True, "table": "transactions", "id": row.id}
    except Exception as e:
        logger.error(f"Failed to write transaction {row.id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── AML Alert Ingest ──────────────────────────────────────────────────────────
class AmlAlertRow(BaseModel):
    id: str
    transaction_ref: Optional[str] = None
    rule_id: Optional[str] = None
    rule_name: Optional[str] = None
    risk_level: Optional[str] = None  # low | medium | high | critical
    amount_kobo: Optional[int] = None
    subject_name: Optional[str] = None
    status: Optional[str] = "open"
    analyst_notes: Optional[str] = None
    created_at: Optional[str] = None

@app.post("/ingest/aml-alert")
async def ingest_aml_alert(row: AmlAlertRow):
    """Write one AML alert row to the Delta Lake."""
    now = datetime.now(timezone.utc)
    created_at = datetime.fromisoformat(row.created_at.replace("Z", "+00:00")) if row.created_at else now
    data = {
        "id": row.id,
        "transaction_ref": row.transaction_ref,
        "rule_id": row.rule_id,
        "rule_name": row.rule_name,
        "risk_level": row.risk_level,
        "amount_kobo": row.amount_kobo,
        "subject_name": row.subject_name,
        "status": row.status,
        "analyst_notes": row.analyst_notes,
        "created_at": pd.Timestamp(created_at),
        **_partition_cols(created_at),
    }
    try:
        write_row("aml_alerts", data)
        return {"ok": True, "table": "aml_alerts", "id": row.id}
    except Exception as e:
        logger.error(f"Failed to write AML alert {row.id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── SAR Filing Ingest ─────────────────────────────────────────────────────────
class SarFilingRow(BaseModel):
    id: str
    ref: Optional[str] = None
    subject_name: Optional[str] = None
    filing_type: Optional[str] = None  # STR | CTR | GOAML
    status: Optional[str] = "draft"
    regulator: Optional[str] = None
    amount_kobo: Optional[int] = None
    filed_at: Optional[str] = None
    created_at: Optional[str] = None

@app.post("/ingest/sar-filing")
async def ingest_sar_filing(row: SarFilingRow):
    """Write one SAR/STR filing row to the Delta Lake."""
    now = datetime.now(timezone.utc)
    created_at = datetime.fromisoformat(row.created_at.replace("Z", "+00:00")) if row.created_at else now
    data = {
        "id": row.id,
        "ref": row.ref,
        "subject_name": row.subject_name,
        "filing_type": row.filing_type,
        "status": row.status,
        "regulator": row.regulator,
        "amount_kobo": row.amount_kobo,
        "filed_at": pd.Timestamp(datetime.fromisoformat(row.filed_at.replace("Z", "+00:00"))) if row.filed_at else None,
        "created_at": pd.Timestamp(created_at),
        **_partition_cols(created_at),
    }
    try:
        write_row("sar_filings", data)
        return {"ok": True, "table": "sar_filings", "id": row.id}
    except Exception as e:
        logger.error(f"Failed to write SAR filing {row.id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Stats ─────────────────────────────────────────────────────────────────────
@app.get("/stats")
async def get_stats():
    """Return row counts for all lakehouse tables."""
    stats = {}
    for table in ["investigations", "alerts", "kyc", "transactions", "aml_alerts", "sar_filings", "cases"]:
        try:
            result = run_duckdb_query(f"SELECT COUNT(*) as cnt FROM read_parquet('{LAKEHOUSE_BASE}/{table}/**/*.parquet', union_by_name=true)")
            stats[table] = result[0]["cnt"] if result else 0
        except Exception:
            stats[table] = 0
    return {"ok": True, "stats": stats}


@app.on_event("startup")
async def startup():
    ensure_table_dirs()
    logger.info(f"[lakehouse] Lakehouse base: {LAKEHOUSE_BASE}")
    asyncio.create_task(kafka_consumer_loop())


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=SERVICE_PORT, reload=False)
