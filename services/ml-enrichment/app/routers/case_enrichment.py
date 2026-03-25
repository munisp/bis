"""
app/routers/case_enrichment.py — Auto-populate case fields from investigation data using Ollama.

Given a case ref and its linked investigations, this service:
  1. Fetches investigation summaries from the BIS API
  2. Uses Ollama to extract: legal basis, regulatory framework, risk summary, tags
  3. Returns structured enrichment data that the BIS frontend can apply to the case
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import structlog
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

log = structlog.get_logger(__name__)
router = APIRouter()


# ── Models ────────────────────────────────────────────────────────────────────

class EnrichmentRequest(BaseModel):
    case_ref: str
    case_title: str
    case_type: str
    investigation_summaries: List[str] = Field(
        default_factory=list,
        description="List of investigation summary texts to enrich from",
    )
    existing_summary: Optional[str] = None
    model: Optional[str] = None


class EnrichmentResponse(BaseModel):
    case_ref: str
    suggested_legal_basis: Optional[str]
    suggested_regulatory_framework: Optional[str]
    suggested_tags: List[str]
    risk_summary: str
    recommended_priority: str  # low | medium | high | critical
    enriched_summary: str
    model_used: str


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/{case_ref}/enrich", response_model=EnrichmentResponse)
async def enrich_case(
    case_ref: str,
    req: EnrichmentRequest,
    request: Request,
) -> EnrichmentResponse:
    """Auto-enrich a case with AI-extracted fields from linked investigation data."""
    ollama = request.app.state.ollama
    settings = request.app.state.settings
    model = req.model or settings.ollama_default_model

    investigations_text = "\n\n".join(
        f"Investigation {i+1}: {s}" for i, s in enumerate(req.investigation_summaries)
    ) or "No linked investigations provided."

    prompt = f"""
You are a compliance case management AI for the BIS (Background Intelligence System) platform in Nigeria.

Case Reference: {case_ref}
Case Title: {req.case_title}
Case Type: {req.case_type}
Existing Summary: {req.existing_summary or 'None'}

Linked Investigation Summaries:
{investigations_text}

Based on the above, provide a JSON response with these exact fields:
{{
  "legal_basis": "string — applicable Nigerian law (e.g., EFCC Act 2004, MLPA 2022, CAMA 2020, CBN Act)",
  "regulatory_framework": "string — applicable framework (e.g., FATF, CBN AML/CFT, SEC Rules)",
  "tags": ["array", "of", "relevant", "compliance", "tags"],
  "risk_summary": "string — 2-sentence risk summary",
  "recommended_priority": "low | medium | high | critical",
  "enriched_summary": "string — comprehensive 3-sentence case summary"
}}

Return ONLY valid JSON, no markdown fences.
"""

    try:
        raw = await ollama.generate(
            model=model,
            prompt=prompt,
            system="You are a Nigerian compliance expert. Return only valid JSON.",
        )

        import json
        # Strip any markdown fences if present
        raw = raw.strip()
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:-1])

        data: Dict[str, Any] = json.loads(raw)

        return EnrichmentResponse(
            case_ref=case_ref,
            suggested_legal_basis=data.get("legal_basis"),
            suggested_regulatory_framework=data.get("regulatory_framework"),
            suggested_tags=data.get("tags", []),
            risk_summary=data.get("risk_summary", ""),
            recommended_priority=data.get("recommended_priority", "medium"),
            enriched_summary=data.get("enriched_summary", ""),
            model_used=model,
        )

    except Exception as e:
        log.error("case_enrichment.failed", case_ref=case_ref, error=str(e))
        raise HTTPException(status_code=503, detail=f"Case enrichment failed: {e}")
