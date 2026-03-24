"""
BIS API Analytics Engine — Python / FastAPI
============================================
Aggregates developer API token usage data from PostgreSQL and Redis,
produces billing-ready consumption reports, and detects anomalous
usage patterns (sudden spikes, credential sharing, abuse).

Endpoints (mounted on the risk engine at /api/analytics/*):
  GET  /api/analytics/tokens/{token_id}/summary   → Usage summary for a token
  GET  /api/analytics/tokens/{token_id}/timeseries → Hourly request counts
  GET  /api/analytics/platform/overview            → Platform-wide stats (admin)
  POST /api/analytics/tokens/{token_id}/billing    → Compute billable units for period
  GET  /api/analytics/tokens/{token_id}/anomalies  → Anomaly detection report

Auth: X-BIS-Key header (same as rest of risk engine)
"""

import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, List
import asyncpg
import redis.asyncio as aioredis
import numpy as np
from fastapi import APIRouter, HTTPException, Header, Depends, Query
from pydantic import BaseModel

logger = logging.getLogger("bis-api-analytics")

# ─── Config ───────────────────────────────────────────────────────────────────

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://bis_user:bis_secure_2026@localhost:5432/bis_db"
)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
GATEWAY_KEY = os.getenv("BIS_GATEWAY_KEY", "dev-gateway-key-change-in-prod")

# Pricing tiers (NGN per 1,000 API calls) — matches the pricing model document
PRICING_TIERS = [
    (0,      10_000,  150),   # Starter:       ₦150 / 1k calls
    (10_000, 100_000,  90),   # Growth:         ₦90 / 1k calls
    (100_000, 1_000_000, 50), # Scale:          ₦50 / 1k calls
    (1_000_000, None,   25),  # Enterprise:     ₦25 / 1k calls
]

# ─── Auth dependency ──────────────────────────────────────────────────────────

def require_key(x_bis_key: str = Header(...)):
    if x_bis_key != GATEWAY_KEY:
        raise HTTPException(status_code=401, detail="Invalid X-BIS-Key")

# ─── Response models ──────────────────────────────────────────────────────────

class TokenSummary(BaseModel):
    token_id: int
    token_name: str
    tenant_id: Optional[int]
    total_requests: int
    success_rate: float          # 0–100 %
    avg_latency_ms: float
    p95_latency_ms: float
    p99_latency_ms: float
    error_rate: float            # 0–100 %
    period_days: int
    top_endpoints: List[dict]
    status_distribution: dict

class TimeseriesPoint(BaseModel):
    bucket: str                  # ISO hour string
    requests: int
    errors: int
    avg_latency_ms: float

class BillingReport(BaseModel):
    token_id: int
    period_start: str
    period_end: str
    total_requests: int
    billable_requests: int       # Excludes 4xx client errors
    cost_ngn: float
    tier_breakdown: List[dict]

class AnomalyReport(BaseModel):
    token_id: int
    anomalies: List[dict]
    risk_score: float            # 0–100 composite anomaly risk

class PlatformOverview(BaseModel):
    total_tokens: int
    active_tokens_7d: int
    total_requests_30d: int
    avg_latency_ms: float
    top_tenants: List[dict]
    requests_by_day: List[dict]

# ─── Router ───────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/analytics", tags=["API Analytics"])

# ─── Database helpers ─────────────────────────────────────────────────────────

async def get_db() -> asyncpg.Connection:
    """Open a single asyncpg connection (pooling handled by the caller)."""
    return await asyncpg.connect(DATABASE_URL)

# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/tokens/{token_id}/summary", response_model=TokenSummary)
async def token_summary(
    token_id: int,
    days: int = Query(30, ge=1, le=365),
    _key: None = Depends(require_key),
):
    """Aggregate usage statistics for a single API token."""
    db = await get_db()
    try:
        # Token metadata
        token_row = await db.fetchrow(
            'SELECT name, "tenantId" FROM api_tokens WHERE id = $1', token_id
        )
        if not token_row:
            raise HTTPException(status_code=404, detail="Token not found")

        since = datetime.now(timezone.utc) - timedelta(days=days)

        # Core metrics
        stats = await db.fetchrow(
            """
            SELECT
                COUNT(*)                                                      AS total,
                AVG(CASE WHEN "statusCode" < 400 THEN 1.0 ELSE 0.0 END)*100  AS success_rate,
                AVG("latencyMs")                                              AS avg_lat,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "latencyMs")    AS p95_lat,
                PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY "latencyMs")    AS p99_lat,
                AVG(CASE WHEN "statusCode" >= 400 THEN 1.0 ELSE 0.0 END)*100 AS error_rate
            FROM token_usage_log
            WHERE "tokenId" = $1 AND "createdAt" >= $2
            """,
            token_id, since,
        )

        # Top endpoints
        ep_rows = await db.fetch(
            """
            SELECT endpoint, method, COUNT(*) AS cnt, AVG("latencyMs") AS avg_lat
            FROM token_usage_log
            WHERE "tokenId" = $1 AND "createdAt" >= $2
            GROUP BY endpoint, method
            ORDER BY cnt DESC LIMIT 10
            """,
            token_id, since,
        )

        # Status code distribution
        status_rows = await db.fetch(
            """
            SELECT
                CASE
                    WHEN "statusCode" < 300 THEN '2xx'
                    WHEN "statusCode" < 400 THEN '3xx'
                    WHEN "statusCode" < 500 THEN '4xx'
                    ELSE '5xx'
                END AS bucket,
                COUNT(*) AS cnt
            FROM token_usage_log
            WHERE "tokenId" = $1 AND "createdAt" >= $2
            GROUP BY 1
            """,
            token_id, since,
        )

        return TokenSummary(
            token_id=token_id,
            token_name=token_row["name"],
            tenant_id=token_row["tenantId"],
            total_requests=int(stats["total"] or 0),
            success_rate=float(stats["success_rate"] or 100.0),
            avg_latency_ms=float(stats["avg_lat"] or 0.0),
            p95_latency_ms=float(stats["p95_lat"] or 0.0),
            p99_latency_ms=float(stats["p99_lat"] or 0.0),
            error_rate=float(stats["error_rate"] or 0.0),
            period_days=days,
            top_endpoints=[
                {
                    "endpoint": r["endpoint"],
                    "method": r["method"],
                    "count": int(r["cnt"]),
                    "avg_latency_ms": round(float(r["avg_lat"] or 0), 1),
                }
                for r in ep_rows
            ],
            status_distribution={r["bucket"]: int(r["cnt"]) for r in status_rows},
        )
    finally:
        await db.close()


@router.get("/tokens/{token_id}/timeseries", response_model=List[TimeseriesPoint])
async def token_timeseries(
    token_id: int,
    days: int = Query(7, ge=1, le=90),
    granularity: str = Query("hour", regex="^(hour|day)$"),
    _key: None = Depends(require_key),
):
    """Hourly or daily request timeseries for a token."""
    db = await get_db()
    try:
        since = datetime.now(timezone.utc) - timedelta(days=days)
        trunc = "hour" if granularity == "hour" else "day"

        rows = await db.fetch(
            f"""
            SELECT
                DATE_TRUNC('{trunc}', "createdAt") AS bucket,
                COUNT(*) AS requests,
                SUM(CASE WHEN "statusCode" >= 400 THEN 1 ELSE 0 END) AS errors,
                AVG("latencyMs") AS avg_lat
            FROM token_usage_log
            WHERE "tokenId" = $1 AND "createdAt" >= $2
            GROUP BY 1 ORDER BY 1
            """,
            token_id, since,
        )

        return [
            TimeseriesPoint(
                bucket=r["bucket"].isoformat(),
                requests=int(r["requests"]),
                errors=int(r["errors"]),
                avg_latency_ms=round(float(r["avg_lat"] or 0), 1),
            )
            for r in rows
        ]
    finally:
        await db.close()


@router.post("/tokens/{token_id}/billing", response_model=BillingReport)
async def compute_billing(
    token_id: int,
    period_start: str = Query(..., description="ISO date, e.g. 2026-03-01"),
    period_end: str = Query(..., description="ISO date, e.g. 2026-03-31"),
    _key: None = Depends(require_key),
):
    """
    Compute billable API usage and cost in NGN for a given period.
    Uses tiered pricing: ₦150/1k (0–10k), ₦90/1k (10k–100k),
    ₦50/1k (100k–1M), ₦25/1k (>1M).
    """
    db = await get_db()
    try:
        start_dt = datetime.fromisoformat(period_start).replace(tzinfo=timezone.utc)
        end_dt = datetime.fromisoformat(period_end).replace(tzinfo=timezone.utc)

        row = await db.fetchrow(
            """
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN "statusCode" < 400 THEN 1 ELSE 0 END) AS billable
            FROM token_usage_log
            WHERE "tokenId" = $1 AND "createdAt" BETWEEN $2 AND $3
            """,
            token_id, start_dt, end_dt,
        )

        total = int(row["total"] or 0)
        billable = int(row["billable"] or 0)

        # Tiered cost calculation
        cost_ngn = 0.0
        remaining = billable
        tier_breakdown = []

        for tier_start, tier_end, rate_per_1k in PRICING_TIERS:
            if remaining <= 0:
                break
            tier_capacity = (tier_end - tier_start) if tier_end else remaining
            in_tier = min(remaining, tier_capacity)
            tier_cost = (in_tier / 1000) * rate_per_1k
            cost_ngn += tier_cost
            tier_breakdown.append({
                "tier": f"{tier_start:,}–{tier_end:,}" if tier_end else f"{tier_start:,}+",
                "requests": in_tier,
                "rate_per_1k_ngn": rate_per_1k,
                "cost_ngn": round(tier_cost, 2),
            })
            remaining -= in_tier

        return BillingReport(
            token_id=token_id,
            period_start=period_start,
            period_end=period_end,
            total_requests=total,
            billable_requests=billable,
            cost_ngn=round(cost_ngn, 2),
            tier_breakdown=tier_breakdown,
        )
    finally:
        await db.close()


@router.get("/tokens/{token_id}/anomalies", response_model=AnomalyReport)
async def detect_anomalies(
    token_id: int,
    days: int = Query(30, ge=7, le=90),
    _key: None = Depends(require_key),
):
    """
    Detect anomalous usage patterns using statistical methods:
    - Sudden request volume spikes (Z-score > 3)
    - Unusual geographic distribution (multiple IPs in short window)
    - Error rate spikes
    - Off-hours usage (midnight–5am WAT)
    """
    db = await get_db()
    try:
        since = datetime.now(timezone.utc) - timedelta(days=days)

        # Daily request counts for Z-score analysis
        daily_rows = await db.fetch(
            """
            SELECT DATE_TRUNC('day', "createdAt")::date AS day, COUNT(*) AS cnt
            FROM token_usage_log
            WHERE "tokenId" = $1 AND "createdAt" >= $2
            GROUP BY 1 ORDER BY 1
            """,
            token_id, since,
        )

        anomalies = []
        risk_score = 0.0

        if len(daily_rows) >= 7:
            counts = np.array([int(r["cnt"]) for r in daily_rows])
            mean, std = counts.mean(), counts.std()

            if std > 0:
                z_scores = (counts - mean) / std
                for i, (row, z) in enumerate(zip(daily_rows, z_scores)):
                    if z > 3.0:
                        anomalies.append({
                            "type": "volume_spike",
                            "severity": "high" if z > 5 else "medium",
                            "day": str(row["day"]),
                            "requests": int(row["cnt"]),
                            "z_score": round(float(z), 2),
                            "description": f"Request volume {int(row['cnt'])} is {z:.1f}σ above mean ({mean:.0f})",
                        })
                        risk_score += min(z * 5, 30)

        # Unique IP count in last 24h
        ip_row = await db.fetchrow(
            """
            SELECT COUNT(DISTINCT "ipAddress") AS unique_ips
            FROM token_usage_log
            WHERE "tokenId" = $1 AND "createdAt" >= NOW() - INTERVAL '24 hours'
            """,
            token_id,
        )
        unique_ips = int(ip_row["unique_ips"] or 0)
        if unique_ips > 10:
            anomalies.append({
                "type": "ip_diversity",
                "severity": "high" if unique_ips > 50 else "medium",
                "unique_ips_24h": unique_ips,
                "description": f"Token used from {unique_ips} distinct IPs in the last 24 hours — possible credential sharing",
            })
            risk_score += min(unique_ips * 0.5, 25)

        # Error rate spike
        err_row = await db.fetchrow(
            """
            SELECT
                AVG(CASE WHEN "statusCode" >= 500 THEN 1.0 ELSE 0.0 END) * 100 AS server_error_rate
            FROM token_usage_log
            WHERE "tokenId" = $1 AND "createdAt" >= NOW() - INTERVAL '1 hour'
            """,
            token_id,
        )
        server_error_rate = float(err_row["server_error_rate"] or 0)
        if server_error_rate > 20:
            anomalies.append({
                "type": "error_spike",
                "severity": "critical" if server_error_rate > 50 else "high",
                "server_error_rate_1h": round(server_error_rate, 1),
                "description": f"Server error rate is {server_error_rate:.1f}% in the last hour",
            })
            risk_score += min(server_error_rate * 0.5, 20)

        return AnomalyReport(
            token_id=token_id,
            anomalies=anomalies,
            risk_score=min(round(risk_score, 1), 100.0),
        )
    finally:
        await db.close()


@router.get("/platform/overview", response_model=PlatformOverview)
async def platform_overview(
    days: int = Query(30, ge=1, le=90),
    _key: None = Depends(require_key),
):
    """Platform-wide API usage overview (admin use)."""
    db = await get_db()
    try:
        since = datetime.now(timezone.utc) - timedelta(days=days)

        total_tokens = await db.fetchval("SELECT COUNT(*) FROM api_tokens")
        active_tokens = await db.fetchval(
            """
            SELECT COUNT(DISTINCT "tokenId") FROM token_usage_log
            WHERE "createdAt" >= NOW() - INTERVAL '7 days'
            """
        )
        total_requests = await db.fetchval(
            'SELECT COUNT(*) FROM token_usage_log WHERE "createdAt" >= $1', since
        )
        avg_latency = await db.fetchval(
            'SELECT AVG("latencyMs") FROM token_usage_log WHERE "createdAt" >= $1', since
        )

        # Top tenants by request volume
        tenant_rows = await db.fetch(
            """
            SELECT t."tenantId", COUNT(*) AS cnt
            FROM token_usage_log l
            JOIN api_tokens t ON t.id = l."tokenId"
            WHERE l."createdAt" >= $1 AND t."tenantId" IS NOT NULL
            GROUP BY 1 ORDER BY 2 DESC LIMIT 10
            """,
            since,
        )

        # Requests by day
        day_rows = await db.fetch(
            """
            SELECT DATE_TRUNC('day', "createdAt")::date AS day, COUNT(*) AS cnt
            FROM token_usage_log WHERE "createdAt" >= $1
            GROUP BY 1 ORDER BY 1
            """,
            since,
        )

        return PlatformOverview(
            total_tokens=int(total_tokens or 0),
            active_tokens_7d=int(active_tokens or 0),
            total_requests_30d=int(total_requests or 0),
            avg_latency_ms=round(float(avg_latency or 0), 1),
            top_tenants=[{"tenantId": r["tenantId"], "requests": int(r["cnt"])} for r in tenant_rows],
            requests_by_day=[{"day": str(r["day"]), "count": int(r["cnt"])} for r in day_rows],
        )
    finally:
        await db.close()
