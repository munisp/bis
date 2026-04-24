"""
BIS Delta Lake Analytics Module
================================
Advanced analytics layer over the BIS Delta Lake using DuckDB.
Provides:
  - Table schema inspection and statistics
  - Time-series aggregation queries
  - AML pattern detection queries
  - Cross-table join analytics
  - Parquet file compaction (small file problem mitigation)
  - Partition pruning helpers
  - VACUUM / OPTIMIZE wrappers (Delta Lake maintenance)

All queries are read-only unless explicitly noted.

Security: All date/threshold values are passed as DuckDB parameters (not
interpolated into SQL strings). Table paths are constructed from a hardcoded
LAKEHOUSE_BASE directory — no user input reaches the path construction.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

try:
    import duckdb
    DUCKDB_AVAILABLE = True
except ImportError:
    DUCKDB_AVAILABLE = False

try:
    import pandas as pd
    import pyarrow as pa
    from deltalake import DeltaTable, write_deltalake
    DELTALAKE_AVAILABLE = True
except ImportError:
    DELTALAKE_AVAILABLE = False

logger = logging.getLogger("bis-delta-lake")

LAKEHOUSE_BASE = Path(os.getenv("LAKEHOUSE_BASE_PATH", "/data/lakehouse"))

# ─── DuckDB connection (in-memory, reads parquet files) ──────────────────────

def get_duckdb_conn():
    """Return a new in-memory DuckDB connection configured for Delta Lake reads."""
    conn = duckdb.connect(":memory:")
    conn.execute("INSTALL parquet; LOAD parquet;")
    conn.execute("INSTALL json; LOAD json;")
    return conn


def run_query(sql: str, params: Optional[list] = None) -> list[dict[str, Any]]:
    """Execute a read-only DuckDB SQL query over the lakehouse parquet files."""
    conn = get_duckdb_conn()
    try:
        result = conn.execute(sql, params or []).fetchdf()
        return result.to_dict(orient="records")
    except Exception as e:
        logger.error(f"DuckDB query error: {e}\nSQL: {sql}")
        raise
    finally:
        conn.close()


# ─── Table Helpers ────────────────────────────────────────────────────────────

def table_path(table_name: str) -> str:
    """Return the glob pattern for reading all parquet files in a table."""
    return str(LAKEHOUSE_BASE / table_name / "**" / "*.parquet")


def table_exists(table_name: str) -> bool:
    """Return True if the table directory contains at least one parquet file."""
    p = LAKEHOUSE_BASE / table_name
    return p.exists() and any(p.rglob("*.parquet"))


def list_tables() -> list[str]:
    """Return names of all tables that have parquet data."""
    if not LAKEHOUSE_BASE.exists():
        return []
    return [d.name for d in LAKEHOUSE_BASE.iterdir() if d.is_dir() and any(d.rglob("*.parquet"))]


# ─── Schema & Statistics ─────────────────────────────────────────────────────

def describe_table(table_name: str) -> dict[str, Any]:
    """Return schema and row count for a table."""
    if not table_exists(table_name):
        return {"table": table_name, "exists": False, "row_count": 0, "columns": []}
    path = table_path(table_name)
    rows = run_query(f"DESCRIBE SELECT * FROM read_parquet('{path}', union_by_name=true)")
    count = run_query(f"SELECT COUNT(*) as cnt FROM read_parquet('{path}', union_by_name=true)")
    return {
        "table": table_name,
        "exists": True,
        "row_count": count[0]["cnt"] if count else 0,
        "columns": [{"name": r["column_name"], "type": r["column_type"]} for r in rows],
    }


def table_stats(table_name: str, days: int = 30) -> dict[str, Any]:
    """Return basic statistics for a table over the last N days."""
    if not table_exists(table_name):
        return {"table": table_name, "exists": False}
    path = table_path(table_name)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    try:
        rows = run_query(
            f"""
            SELECT
                COUNT(*) as total_rows,
                MIN(created_at) as earliest,
                MAX(created_at) as latest,
                COUNT(DISTINCT year) as distinct_years,
                COUNT(DISTINCT month) as distinct_months
            FROM read_parquet('{path}', union_by_name=true)
            WHERE created_at >= ?
            """,
            [cutoff],
        )
        return {"table": table_name, "exists": True, "period_days": days, **rows[0]}
    except Exception as e:
        return {"table": table_name, "exists": True, "error": str(e)}


# ─── Transaction Analytics ────────────────────────────────────────────────────

def transaction_volume_by_day(days: int = 30) -> list[dict[str, Any]]:
    """Return daily transaction volume (count + total NGN) for the last N days."""
    if not table_exists("transactions"):
        return []
    path = table_path("transactions")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    return run_query(
        f"""
        SELECT
            CAST(created_at AS DATE) as date,
            COUNT(*) as tx_count,
            SUM(amount_kobo) / 100.0 as total_ngn,
            AVG(amount_kobo) / 100.0 as avg_ngn,
            COUNT(CASE WHEN aml_flag THEN 1 END) as flagged_count
        FROM read_parquet('{path}', union_by_name=true)
        WHERE created_at >= ?
        GROUP BY 1
        ORDER BY 1
        """,
        [cutoff],
    )


def top_corridors(days: int = 30, limit: int = 20) -> list[dict[str, Any]]:
    """Return top transaction corridors (account pairs) by volume."""
    if not table_exists("transactions"):
        return []
    path = table_path("transactions")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    return run_query(
        f"""
        SELECT
            account_id,
            counterparty_account,
            COUNT(*) as tx_count,
            SUM(amount_kobo) / 100.0 as total_ngn
        FROM read_parquet('{path}', union_by_name=true)
        WHERE created_at >= ?
        GROUP BY 1, 2
        ORDER BY total_ngn DESC
        LIMIT ?
        """,
        [cutoff, limit],
    )


def high_risk_transactions(risk_threshold: float = 70.0, days: int = 7) -> list[dict[str, Any]]:
    """Return transactions with risk score above threshold in the last N days."""
    if not table_exists("transactions"):
        return []
    path = table_path("transactions")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    return run_query(
        f"""
        SELECT id, ref, account_id, counterparty_account,
               amount_kobo / 100.0 as amount_ngn, channel,
               risk_score, aml_flag, created_at
        FROM read_parquet('{path}', union_by_name=true)
        WHERE created_at >= ?
          AND risk_score >= ?
        ORDER BY risk_score DESC, created_at DESC
        LIMIT 500
        """,
        [cutoff, risk_threshold],
    )


# ─── AML Analytics ────────────────────────────────────────────────────────────

def aml_alert_summary(days: int = 30) -> dict[str, Any]:
    """Return AML alert summary statistics."""
    if not table_exists("aml_alerts"):
        return {"exists": False}
    path = table_path("aml_alerts")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    rows = run_query(
        f"""
        SELECT
            COUNT(*) as total,
            COUNT(CASE WHEN risk_level = 'critical' THEN 1 END) as critical,
            COUNT(CASE WHEN risk_level = 'high' THEN 1 END) as high,
            COUNT(CASE WHEN risk_level = 'medium' THEN 1 END) as medium,
            COUNT(CASE WHEN risk_level = 'low' THEN 1 END) as low,
            COUNT(CASE WHEN status = 'open' THEN 1 END) as open_count,
            COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_count,
            COUNT(DISTINCT rule_name) as distinct_rules
        FROM read_parquet('{path}', union_by_name=true)
        WHERE created_at >= ?
        """,
        [cutoff],
    )
    return {"period_days": days, **rows[0]} if rows else {}


def aml_alerts_by_rule(days: int = 30) -> list[dict[str, Any]]:
    """Return AML alert counts grouped by rule name."""
    if not table_exists("aml_alerts"):
        return []
    path = table_path("aml_alerts")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    return run_query(
        f"""
        SELECT
            rule_name,
            COUNT(*) as alert_count,
            COUNT(CASE WHEN risk_level IN ('high', 'critical') THEN 1 END) as high_risk_count,
            AVG(amount_kobo) / 100.0 as avg_amount_ngn
        FROM read_parquet('{path}', union_by_name=true)
        WHERE created_at >= ?
        GROUP BY rule_name
        ORDER BY alert_count DESC
        """,
        [cutoff],
    )


def structuring_detection(days: int = 30, threshold_kobo: int = 500_000_00) -> list[dict[str, Any]]:
    """
    Detect potential structuring: accounts with many transactions just below
    the reporting threshold (default: ₦5,000,000 = 500_000_00 kobo).
    """
    if not table_exists("transactions"):
        return []
    path = table_path("transactions")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    sub_threshold = int(threshold_kobo * 0.9)  # 90% of threshold
    return run_query(
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


# ─── SAR Analytics ────────────────────────────────────────────────────────────

def sar_filing_trend(days: int = 90) -> list[dict[str, Any]]:
    """Return weekly SAR/STR filing counts."""
    if not table_exists("sar_filings"):
        return []
    path = table_path("sar_filings")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    return run_query(
        f"""
        SELECT
            DATE_TRUNC('week', created_at) as week,
            filing_type,
            COUNT(*) as filing_count,
            SUM(amount_kobo) / 100.0 as total_ngn
        FROM read_parquet('{path}', union_by_name=true)
        WHERE created_at >= ?
        GROUP BY 1, 2
        ORDER BY 1, 2
        """,
        [cutoff],
    )


# ─── Cross-Table Analytics ────────────────────────────────────────────────────

def investigation_to_alert_funnel(days: int = 30) -> dict[str, Any]:
    """
    Return funnel metrics: investigations opened → alerts triggered →
    STRs filed over the period.
    """
    result: dict[str, Any] = {"period_days": days}

    if table_exists("investigations"):
        path = table_path("investigations")
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
        rows = run_query(
            f"SELECT COUNT(*) as cnt FROM read_parquet('{path}', union_by_name=true) WHERE created_at >= ?",
            [cutoff],
        )
        result["investigations_opened"] = rows[0]["cnt"] if rows else 0

    if table_exists("aml_alerts"):
        path = table_path("aml_alerts")
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
        rows = run_query(
            f"SELECT COUNT(*) as cnt FROM read_parquet('{path}', union_by_name=true) WHERE created_at >= ?",
            [cutoff],
        )
        result["aml_alerts_triggered"] = rows[0]["cnt"] if rows else 0

    if table_exists("sar_filings"):
        path = table_path("sar_filings")
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
        rows = run_query(
            f"SELECT COUNT(*) as cnt FROM read_parquet('{path}', union_by_name=true) WHERE created_at >= ?",
            [cutoff],
        )
        result["strs_filed"] = rows[0]["cnt"] if rows else 0

    return result


# ─── Delta Lake Maintenance ───────────────────────────────────────────────────

def vacuum_table(table_name: str, retention_hours: int = 168) -> dict[str, Any]:
    """
    Run VACUUM on a Delta Lake table to remove old parquet files.
    Default retention: 7 days (168 hours).
    """
    table_dir = str(LAKEHOUSE_BASE / table_name)
    try:
        dt = DeltaTable(table_dir)
        result = dt.vacuum(retention_hours=retention_hours, dry_run=False)
        return {"table": table_name, "vacuumed": True, "files_removed": len(result)}
    except Exception as e:
        logger.error(f"VACUUM failed for {table_name}: {e}")
        return {"table": table_name, "vacuumed": False, "error": str(e)}


def optimize_table(table_name: str, target_size_mb: int = 128) -> dict[str, Any]:
    """
    Compact small parquet files in a Delta Lake table (Z-ORDER not applied here).
    """
    table_dir = str(LAKEHOUSE_BASE / table_name)
    try:
        dt = DeltaTable(table_dir)
        metrics = dt.optimize.compact()
        return {
            "table": table_name,
            "optimized": True,
            "files_added": metrics.get("numFilesAdded", 0),
            "files_removed": metrics.get("numFilesRemoved", 0),
            "bytes_added": metrics.get("filesAdded", {}).get("totalSize", 0),
        }
    except Exception as e:
        logger.error(f"OPTIMIZE failed for {table_name}: {e}")
        return {"table": table_name, "optimized": False, "error": str(e)}


def get_table_history(table_name: str, limit: int = 20) -> list[dict[str, Any]]:
    """Return the Delta Lake transaction log history for a table."""
    table_dir = str(LAKEHOUSE_BASE / table_name)
    try:
        dt = DeltaTable(table_dir)
        history = dt.history(limit=limit)
        return history
    except Exception as e:
        logger.error(f"History failed for {table_name}: {e}")
        return []
