"""
Natural-language analytics over a tenant-scoped BIS PostgreSQL data store.

The language model is restricted to selecting a bounded analytics plan. It never
produces executable SQL, identifiers, or SQL parameters. Each plan is a static,
parameterized aggregate query with an explicit tenant predicate.
"""
from __future__ import annotations

import json
import os
import secrets
from typing import Any, Dict, List, Literal, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import create_async_engine

log = structlog.get_logger(__name__)
router = APIRouter()


class LakehouseQueryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(..., min_length=1, max_length=2_000, description="Natural-language analytics question")
    context: Optional[str] = Field(default=None, max_length=2_000, description="Optional non-sensitive analytics context")
    model: Optional[str] = Field(default=None, max_length=128)
    tenant_id: int = Field(..., gt=0, description="Trusted tenant identity injected by the BFF")
    max_rows: int = Field(default=100, ge=1, le=1_000)


class LakehouseQueryResponse(BaseModel):
    question: str
    generated_sql: str
    answer: str
    row_count: int
    columns: List[str]
    rows: List[Dict[str, Any]]
    model_used: str


class LakehouseQueryPlan(BaseModel):
    """A model-selected identifier, not executable model-generated SQL."""

    model_config = ConfigDict(extra="forbid")

    query_id: Literal[
        "investigation_status_summary",
        "alert_severity_summary",
        "kyc_status_summary",
    ]
    lookback_days: int = Field(default=30, ge=1, le=365)


SAFE_QUERY_TEMPLATES: Dict[str, tuple[Any, str]] = {
    "investigation_status_summary": (
        sa_text(
            """
            SELECT "status" AS status, COUNT(*)::bigint AS record_count
              FROM investigations
             WHERE "tenantId" = :tenant_id
               AND "deletedAt" IS NULL
               AND "createdAt" >= NOW() - (:lookback_days * INTERVAL '1 day')
             GROUP BY "status"
             ORDER BY record_count DESC, status ASC
             LIMIT :max_rows
            """
        ),
        "SELECT status, COUNT(*) FROM investigations WHERE tenant_id = :tenant_id AND created_at >= :lookback_window GROUP BY status",
    ),
    "alert_severity_summary": (
        sa_text(
            """
            SELECT severity, COUNT(*)::bigint AS record_count
              FROM alerts
             WHERE "tenantId" = :tenant_id
               AND "deletedAt" IS NULL
               AND "createdAt" >= NOW() - (:lookback_days * INTERVAL '1 day')
             GROUP BY severity
             ORDER BY record_count DESC, severity ASC
             LIMIT :max_rows
            """
        ),
        "SELECT severity, COUNT(*) FROM alerts WHERE tenant_id = :tenant_id AND created_at >= :lookback_window GROUP BY severity",
    ),
    "kyc_status_summary": (
        sa_text(
            """
            SELECT status, COUNT(*)::bigint AS record_count
              FROM kyc_records
             WHERE "tenantId" = :tenant_id
               AND "deletedAt" IS NULL
               AND "createdAt" >= NOW() - (:lookback_days * INTERVAL '1 day')
             GROUP BY status
             ORDER BY record_count DESC, status ASC
             LIMIT :max_rows
            """
        ),
        "SELECT status, COUNT(*) FROM kyc_records WHERE tenant_id = :tenant_id AND created_at >= :lookback_window GROUP BY status",
    ),
}


PLAN_CONTEXT = """
Choose exactly one approved analytics plan for the requested tenant-scoped aggregate.
Do not generate SQL, identifiers, filters, or any fields outside this JSON object.

Approved query_id values:
- investigation_status_summary: counts of investigations grouped by status
- alert_severity_summary: counts of alerts grouped by severity
- kyc_status_summary: counts of KYC records grouped by status

Return only JSON in this form:
{"query_id":"one approved value","lookback_days":30}
"""


def _gateway_key() -> str:
    key = os.getenv("BIS_GATEWAY_KEY", "").strip()
    if not key:
        log.error("lakehouse.gateway_key.unconfigured")
        raise HTTPException(status_code=503, detail="Lakehouse analytics is unavailable")
    return key


def require_gateway_key(request: Request) -> None:
    presented = request.headers.get("X-BIS-Key", "")
    if not presented or not secrets.compare_digest(presented, _gateway_key()):
        raise HTTPException(status_code=401, detail="Lakehouse analytics authorization failed")


def parse_query_plan(raw_plan: str) -> LakehouseQueryPlan:
    """Parse a closed plan schema; raw model output never becomes executable SQL."""
    try:
        candidate = json.loads(raw_plan.strip())
        return LakehouseQueryPlan.model_validate(candidate)
    except (json.JSONDecodeError, ValidationError, TypeError, ValueError) as error:
        raise ValueError("The analytics question could not be mapped to an approved query plan") from error


def _make_async_url(db_url: str) -> str:
    """Normalize an explicit PostgreSQL URL for SQLAlchemy's asyncpg driver."""
    if db_url.startswith("postgresql+asyncpg://"):
        return db_url
    if db_url.startswith("postgresql://"):
        return db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if db_url.startswith("postgres://"):
        return db_url.replace("postgres://", "postgresql+asyncpg://", 1)
    raise ValueError("DATABASE_URL must be a PostgreSQL URL")


@router.post("/query", response_model=LakehouseQueryResponse, dependencies=[Depends(require_gateway_key)])
async def lakehouse_query(req: LakehouseQueryRequest, request: Request) -> LakehouseQueryResponse:
    """Answer an aggregate analytics question through a bounded tenant-specific plan."""
    ollama = request.app.state.ollama
    settings = request.app.state.settings
    model = req.model or settings.ollama_default_model
    plan_prompt = f"""
{PLAN_CONTEXT}
Question: {req.question}
{f'Additional analytics context: {req.context}' if req.context else ''}
"""

    try:
        raw_plan = await ollama.generate(
            model=model,
            prompt=plan_prompt,
            system="You select only approved analytics plans. Return JSON and no other text.",
        )
        plan = parse_query_plan(raw_plan)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Question is not supported by approved analytics plans") from error
    except Exception:
        log.error("lakehouse.plan_generation.failed")
        raise HTTPException(status_code=503, detail="Lakehouse analytics is unavailable")

    statement, display_sql = SAFE_QUERY_TEMPLATES[plan.query_id]
    engine = None
    try:
        engine = create_async_engine(
            _make_async_url(settings.database_url),
            pool_pre_ping=True,
            pool_size=1,
            max_overflow=0,
            connect_args={"command_timeout": 5},
        )
        parameters = {
            "tenant_id": req.tenant_id,
            "lookback_days": plan.lookback_days,
            "max_rows": req.max_rows,
        }
        async with engine.connect() as connection:
            await connection.execute(sa_text("SET TRANSACTION READ ONLY"))
            await connection.execute(sa_text("SET LOCAL statement_timeout = '5000ms'"))
            result = await connection.execute(statement, parameters)
            rows = [dict(row) for row in result.mappings().all()]
            columns = list(result.keys())
    except Exception:
        log.error("lakehouse.query_execution.failed", query_id=plan.query_id, tenant_id=req.tenant_id)
        raise HTTPException(status_code=503, detail="Lakehouse analytics is unavailable")
    finally:
        if engine is not None:
            await engine.dispose()

    answer_prompt = f"""
Question: {req.question}
Approved analytics plan: {plan.query_id}
Result: {len(rows)} aggregate row(s) returned.
Rows: {rows[:5] if rows else 'No data returned.'}

Provide a concise answer based only on these aggregate results.
"""
    try:
        answer = await ollama.generate(
            model=model,
            prompt=answer_prompt,
            system="You are a compliance analytics assistant. Summarize only the supplied aggregate result.",
        )
    except Exception:
        answer = f"Approved analytics plan completed. {len(rows)} aggregate row(s) returned."

    log.info("lakehouse.query.completed", query_id=plan.query_id, tenant_id=req.tenant_id, rows=len(rows))
    return LakehouseQueryResponse(
        question=req.question,
        generated_sql=display_sql,
        answer=answer,
        row_count=len(rows),
        columns=columns,
        rows=rows,
        model_used=model,
    )
