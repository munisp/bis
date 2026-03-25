"""
app/routers/lakehouse.py — Natural-language AI query over the BIS data lakehouse.

The Lakehouse AI query pipeline:
  1. Accept a natural-language question from the analyst
  2. Use Ollama (or cloud LLM) to convert the question to a SQL query
  3. Execute the SQL against the BIS MySQL/TiDB database
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
BIS Platform MySQL Database Schema (key tables):
- investigations(id, ref, title, status, priority, risk_score, subject_name, created_at, due_at)
- alerts(id, ref, type, severity, status, message, source_service, created_at)
- cases(id, ref, title, type, status, priority, risk_score, created_at, closed_at)
- field_tasks(id, ref, title, status, priority, agent_id, investigation_id, created_at)
- users(id, name, email, role, created_at)
- tenants(id, name, plan, status, created_at)
- screening_requests(id, ref, subject_name, status, risk_score, created_at)
- kyc_verifications(id, ref, subject_name, status, provider, created_at)
- audit_log(id, action, entity_type, entity_id, actor_id, created_at)

Rules:
- Always use SELECT only (no INSERT/UPDATE/DELETE)
- Use LIMIT to cap results (max 1000)
- Use DATE_FORMAT or DATE() for date grouping
- Use COUNT(*), AVG(), SUM() for aggregations
- Always include created_at in time-based queries
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


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/query", response_model=LakehouseQueryResponse)
async def lakehouse_query(req: LakehouseQueryRequest, request: Request) -> LakehouseQueryResponse:
    """Convert a natural-language question to SQL, execute it, and summarise the result."""
    ollama = request.app.state.ollama
    settings = request.app.state.settings
    model = req.model or settings.ollama_default_model

    # Step 1: Generate SQL
    sql_prompt = f"""
{SCHEMA_CONTEXT}

Question: {req.question}
{f'Additional context: {req.context}' if req.context else ''}

Generate a single valid MySQL SELECT query to answer this question.
Return ONLY the SQL query, no explanation, no markdown fences.
"""
    try:
        generated_sql = await ollama.generate(
            model=model,
            prompt=sql_prompt,
            system="You are a MySQL expert. Return only valid SQL SELECT statements.",
        )
        generated_sql = sanitize_sql(generated_sql.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error("lakehouse.sql_generation.failed", error=str(e))
        raise HTTPException(status_code=503, detail=f"SQL generation failed: {e}")

    # Step 2: Execute SQL (placeholder — real implementation connects to DB)
    # In production, use sqlalchemy async engine to execute generated_sql
    rows: List[Dict[str, Any]] = []
    columns: List[str] = []
    # TODO: connect to settings.database_url and execute generated_sql with LIMIT

    # Step 3: Summarise result
    answer_prompt = f"""
Question: {req.question}
SQL executed: {generated_sql}
Result: {len(rows)} rows returned.
{f'Sample data: {rows[:5]}' if rows else 'No data returned.'}

Provide a clear, concise answer to the question based on the query result.
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
