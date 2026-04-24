"""
BIS Risk Engine — DuckDB Analytics Layer
=========================================
Provides risk-focused analytics queries over the Delta Lake parquet files.
Used by the risk engine to:
  - Compute peer group baselines for anomaly detection
  - Identify velocity patterns (rapid transaction sequences)
  - Cross-reference entity risk scores over time
  - Generate risk trend reports for analyst dashboards

All queries are read-only. The DuckDB connection is in-memory and
opened fresh per query to avoid state leakage.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("bis-duckdb-analytics")

LAKEHOUSE_BASE = Path(os.getenv("LAKEHOUSE_BASE_PATH", "/data/lakehouse"))

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


def _table_glob(table: str) -> str:
    return str(LAKEHOUSE_BASE / table / "**" / "*.parquet")


def _table_exists(table: str) -> bool:
    p = LAKEHOUSE_BASE / table
    return p.exists() and any(p.rglob("*.parquet"))


def _run(sql: str) -> list[dict[str, Any]]:
    conn = _conn()
    try:
        return conn.execute(sql).fetchdf().to_dict(orient="records")
    finally:
        conn.close()


# ─── Peer Group Baseline ──────────────────────────────────────────────────────

def peer_group_baseline(channel: str, days: int = 90) -> dict[str, Any]:
    """
    Compute average and 95th-percentile transaction amounts for a given
    channel (e.g., 'mobile', 'web', 'atm') over the last N days.
    Used as a baseline for anomaly detection.
    """
    if not DUCKDB_AVAILABLE or not _table_exists("transactions"):
        return {"channel": channel, "available": False}
    path = _table_glob("transactions")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
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
        WHERE created_at >= '{cutoff}'
          AND channel = '{channel}'
        GROUP BY channel
        """
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
        WHERE created_at >= '{cutoff}'
        GROUP BY channel
        ORDER BY tx_count DESC
        """
    )


# ─── Velocity Analysis ────────────────────────────────────────────────────────

def account_velocity(account_id: str, window_hours: int = 24) -> dict[str, Any]:
    """
    Return transaction velocity for a specific account over the last N hours.
    High velocity (many transactions in a short window) is a key AML signal.
    """
    if not DUCKDB_AVAILABLE or not _table_exists("transactions"):
        return {"account_id": account_id, "available": False}
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
        WHERE account_id = '{account_id}'
          AND created_at >= '{cutoff}'
        GROUP BY account_id
        """
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
        WHERE created_at >= '{cutoff}'
        GROUP BY account_id
        HAVING COUNT(*) >= {min_tx_count}
        ORDER BY tx_count DESC
        LIMIT 50
        """
    )


# ─── Entity Risk Trend ────────────────────────────────────────────────────────

def entity_risk_trend(subject_name: str, days: int = 90) -> list[dict[str, Any]]:
    """Return weekly risk score trend for a named subject."""
    if not DUCKDB_AVAILABLE or not _table_exists("aml_alerts"):
        return []
    path = _table_glob("aml_alerts")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    return _run(
        f"""
        SELECT
            DATE_TRUNC('week', created_at) as week,
            COUNT(*) as alert_count,
            COUNT(CASE WHEN risk_level IN ('high', 'critical') THEN 1 END) as high_risk_count
        FROM read_parquet('{path}', union_by_name=true)
        WHERE subject_name ILIKE '%{subject_name}%'
          AND created_at >= '{cutoff}'
        GROUP BY 1
        ORDER BY 1
        """
    )


# ─── Risk Score Distribution ──────────────────────────────────────────────────

def risk_score_distribution(days: int = 30, buckets: int = 10) -> list[dict[str, Any]]:
    """Return histogram of transaction risk scores."""
    if not DUCKDB_AVAILABLE or not _table_exists("transactions"):
        return []
    path = _table_glob("transactions")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    bucket_size = 100 // buckets
    return _run(
        f"""
        SELECT
            FLOOR(risk_score / {bucket_size}) * {bucket_size} as bucket_start,
            FLOOR(risk_score / {bucket_size}) * {bucket_size} + {bucket_size - 1} as bucket_end,
            COUNT(*) as count
        FROM read_parquet('{path}', union_by_name=true)
        WHERE created_at >= '{cutoff}'
          AND risk_score IS NOT NULL
        GROUP BY 1, 2
        ORDER BY 1
        """
    )


# ─── Network Analysis ─────────────────────────────────────────────────────────

def account_network(account_id: str, hops: int = 1, days: int = 30) -> dict[str, Any]:
    """
    Return the immediate transaction network for an account.
    hops=1: direct counterparties only.
    """
    if not DUCKDB_AVAILABLE or not _table_exists("transactions"):
        return {"account_id": account_id, "nodes": [], "edges": []}
    path = _table_glob("transactions")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")

    # Direct counterparties
    edges = _run(
        f"""
        SELECT
            account_id as source,
            counterparty_account as target,
            COUNT(*) as tx_count,
            SUM(amount_kobo) / 100.0 as total_ngn,
            direction
        FROM read_parquet('{path}', union_by_name=true)
        WHERE (account_id = '{account_id}' OR counterparty_account = '{account_id}')
          AND created_at >= '{cutoff}'
        GROUP BY 1, 2, 5
        ORDER BY total_ngn DESC
        LIMIT 50
        """
    )

    nodes = set()
    for e in edges:
        nodes.add(e["source"])
        nodes.add(e["target"])

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
    baseline = peer_group_baseline(channel)
    if not baseline.get("available"):
        return 50.0  # neutral score when no baseline available

    avg = baseline.get("avg_ngn", 0) * 100  # convert back to kobo
    stddev = baseline.get("stddev_ngn", 1) * 100
    z = compute_z_score(amount_kobo, avg, stddev)
    # Map Z-score to 0-100: Z=0 → 0, Z=3 → 100
    score = min(100.0, max(0.0, (z / 3.0) * 100.0))
    return round(score, 2)
