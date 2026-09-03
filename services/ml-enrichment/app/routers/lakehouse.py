"""
app/routers/lakehouse.py — Natural-language AI query over the BIS data lakehouse.

The Lakehouse AI query pipeline:
  1. Accept a natural-language question from the analyst
  2. Use Ollama (or cloud LLM) to convert the question to a SQL query
  3. Execute the SQL against the BIS PostgreSQL database
  4. Use Ollama to summarise the result set in plain English
  5. Return both the SQL and the natural-language answer

This enables analysts to query investigation data, alert trends, and case
statistics without writing SQL — directly from the BIS dashboard.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

import structlog
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text as sa_text

log = structlog.get_logger(__name__)
router = APIRouter()


# ── Models ────────────────────────────────────────────────────────────────────

class LakehouseQueryRequest(BaseModel):
    question: str = Field(..., description="Natural-language question about BIS data")
    context: Optional[str] = None  # Optional: additional context for the LLM
    model: Optional[str] = None
    max_rows: int = Field(100, ge=1, le=1000)


class LakehouseQueryResponse(BaseModel):
    question: str
    generated_sql: str
    answer: str
    row_count: int
    columns: List[str]
    rows: List[Dict[str, Any]]
    model_used: str


# ── Schema context for SQL generation ────────────────────────────────────────

SCHEMA_CONTEXT = """
BIS Platform PostgreSQL Database Schema (key tables, snake_case column names):

investigations(id, ref, title, status, priority, riskScore, subjectName, createdAt, dueAt)
  status values: open | in_progress | closed | archived
  priority values: low | medium | high | critical

alerts(id, ref, type, severity, status, message, sourceService, createdAt)
  severity values: low | medium | high | critical
  status values: open | acknowledged | resolved | false_positive

cases(id, ref, title, type, status, priority, riskScore, createdAt, closedAt)
  type values: fraud | aml | kyc | sanctions | general
  status values: open | in_progress | closed | archived

fieldTasks(id, ref, title, status, priority, agentId, investigationId, createdAt)
  status values: pending | in_progress | completed | cancelled

users(id, name, email, role, createdAt)
  role values: admin | analyst | agent | viewer

tenants(id, name, plan, status, createdAt)

screeningRequests(id, ref, subjectName, status, riskScore, createdAt)

kycRecords(id, ref, subjectName, status, provider, createdAt)
  status values: pending | passed | failed | expired

auditLog(id, action, entityType, entityId, actorId, createdAt)

Rules:
- Always use SELECT only (no INSERT/UPDATE/DELETE/DROP/ALTER)
- Use LIMIT to cap results (max 1000 rows)
- Column names are snake_case, for example risk_score and created_at
- Use DATE_TRUNC() for date grouping
- Use COUNT(*), AVG(), SUM() for aggregations
- Always include createdAt in time-based queries
- For date filtering use: WHERE created_at >= NOW() - INTERVAL '30 days'
"""


def sanitize_sql(sql: str) -> str:
    """Strip dangerous SQL keywords to prevent injection."""
    dangerous = re.compile(
        r'\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|EXEC|EXECUTE)\b',
        re.IGNORECASE,
    )
    if dangerous.search(sql):
        raise ValueError("Generated SQL contains disallowed operations")
    return sql.strip().rstrip(";")


def _make_async_url(db_url: str) -> str:
    """Normalize an explicit PostgreSQL URL for SQLAlchemy's asyncpg driver."""
    if db_url.startswith("postgresql+asyncpg://"):
        return db_url
    if db_url.startswith("postgresql://"):
        return db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if db_url.startswith("postgres://"):
        return db_url.replace("postgres://", "postgresql+asyncpg://", 1)
    raise ValueError("DATABASE_URL must be a PostgreSQL URL")


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/query", response_model=LakehouseQueryResponse)
async def lakehouse_query(req: LakehouseQueryRequest, request: Request) -> LakehouseQueryResponse:
    """Convert a natural-language question to SQL, execute it, and summarise the result."""
    ollama = request.app.state.ollama
    settings = request.app.state.settings
    model = req.model or settings.ollama_default_model

    # Step 1: Generate SQL via Ollama
    sql_prompt = f"""
{SCHEMA_CONTEXT}

Question: {req.question}
{f'Additional context: {req.context}' if req.context else ''}

Generate a single valid PostgreSQL SELECT query to answer this question.
Return ONLY the SQL query, no explanation, no markdown fences.
"""
    try:
        generated_sql = await ollama.generate(
            model=model,
            prompt=sql_prompt,
            system="You are a PostgreSQL expert. Return only valid SQL SELECT statements.",
        )
        generated_sql = sanitize_sql(generated_sql.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error("lakehouse.sql_generation.failed", error=str(e))
        raise HTTPException(status_code=503, detail=f"SQL generation failed: {e}")

    # Step 2: Execute SQL against the BIS database
    rows: List[Dict[str, Any]] = []
    columns: List[str] = []
    try:
        db_url = _make_async_url(settings.database_url)
        engine = create_async_engine(
            db_url,
            pool_pre_ping=True,
            pool_size=1,
            max_overflow=0,
            connect_args={"command_timeout": 5},
        )
        # Enforce row limit in generated SQL
        limited_sql = generated_sql
        if "limit" not in limited_sql.lower():
            limited_sql = f"{limited_sql} LIMIT {req.max_rows}"

        async with engine.connect() as conn:
            await conn.execute(sa_text("SET TRANSACTION READ ONLY"))
            await conn.execute(sa_text("SET LOCAL statement_timeout = '5000ms'"))
            result = await conn.execute(sa_text(limited_sql))
            columns = list(result.keys())
            raw_rows = result.fetchall()
            rows = [dict(zip(columns, row)) for row in raw_rows]

        await engine.dispose()
        log.info(
            "lakehouse.sql_execution.ok",
            question=req.question[:80],
            rows=len(rows),
            sql=limited_sql[:200],
        )
    except ValueError:
        raise
    except Exception as db_err:
        log.error("lakehouse.sql_execution.failed", error=str(db_err), sql=generated_sql[:300])
        raise HTTPException(
            status_code=422,
            detail=f"SQL execution failed: {db_err}",
        )

    # Step 3: Summarise result via Ollama
    answer_prompt = f"""
Question: {req.question}
SQL executed: {generated_sql}
Result: {len(rows)} rows returned.
{f'Sample data (first 5 rows): {rows[:5]}' if rows else 'No data returned for this query.'}

Provide a clear, concise answer to the question based on the query result.
Be specific — mention counts, percentages, or key values where relevant.
"""
    try:
        answer = await ollama.generate(
            model=model,
            prompt=answer_prompt,
            system="You are a data analyst. Summarise query results clearly for a compliance officer.",
        )
    except Exception:
        answer = f"Query executed successfully. {len(rows)} row(s) returned."

    log.info("lakehouse.query.completed", question=req.question[:80], rows=len(rows))

    return LakehouseQueryResponse(
        question=req.question,
        generated_sql=generated_sql,
        answer=answer,
        row_count=len(rows),
        columns=columns,
        rows=rows,
        model_used=model,
    )
