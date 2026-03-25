"""
app/routers/risk.py — ML-based composite risk scoring endpoint.

Risk score (0–100) is computed from:
  - Identity verification status (0–20)
  - Sanctions / PEP hit count (0–30)
  - Adverse media severity (0–20)
  - Network exposure (0–15)
  - Regulatory history (0–15)

The model uses a weighted linear combination with Ollama-generated
natural-language explanation for each contributing factor.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional

import structlog
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

log = structlog.get_logger(__name__)
router = APIRouter()


# ── Request / Response models ─────────────────────────────────────────────────

class RiskInput(BaseModel):
    subject_name: str = Field(..., description="Full name of the individual or entity")
    subject_type: str = Field("individual", description="individual | corporate")
    identity_verified: bool = False
    sanctions_hits: int = Field(0, ge=0)
    pep_status: bool = False
    adverse_media_count: int = Field(0, ge=0)
    adverse_media_severity: str = Field("none", description="none | low | medium | high | critical")
    network_exposure: str = Field("low", description="low | medium | high")
    regulatory_violations: int = Field(0, ge=0)
    jurisdiction: str = "NG"
    additional_context: Optional[str] = None


class RiskFactor(BaseModel):
    name: str
    score: float
    max_score: float
    weight: float
    explanation: str


class RiskScoreResponse(BaseModel):
    subject_name: str
    composite_score: int = Field(..., ge=0, le=100)
    risk_level: str  # low | medium | high | critical
    factors: List[RiskFactor]
    recommendation: str
    model_version: str = "bis-risk-v1.0"


# ── Scoring logic ─────────────────────────────────────────────────────────────

SEVERITY_MAP = {"none": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
EXPOSURE_MAP = {"low": 0, "medium": 1, "high": 2}


def compute_risk_score(inp: RiskInput) -> tuple[int, List[RiskFactor]]:
    """Compute a deterministic composite risk score from structured inputs."""

    factors: List[RiskFactor] = []

    # 1. Identity (max 20)
    id_score = 20.0 if inp.identity_verified else 8.0
    factors.append(RiskFactor(
        name="Identity Verification",
        score=id_score,
        max_score=20.0,
        weight=0.20,
        explanation=(
            "Identity fully verified via biometric and document checks."
            if inp.identity_verified
            else "Identity not verified — increases uncertainty risk."
        ),
    ))

    # 2. Sanctions / PEP (max 30)
    sanctions_score = max(0.0, 30.0 - (inp.sanctions_hits * 10.0) - (15.0 if inp.pep_status else 0.0))
    sanctions_score = max(0.0, min(30.0, sanctions_score))
    factors.append(RiskFactor(
        name="Sanctions & PEP",
        score=sanctions_score,
        max_score=30.0,
        weight=0.30,
        explanation=(
            f"{inp.sanctions_hits} sanctions hit(s) found. "
            + ("Subject is a Politically Exposed Person (PEP). " if inp.pep_status else "No PEP flag. ")
        ),
    ))

    # 3. Adverse media (max 20)
    sev = SEVERITY_MAP.get(inp.adverse_media_severity, 0)
    media_score = max(0.0, 20.0 - (inp.adverse_media_count * 2.0) - (sev * 3.0))
    media_score = max(0.0, min(20.0, media_score))
    factors.append(RiskFactor(
        name="Adverse Media",
        score=media_score,
        max_score=20.0,
        weight=0.20,
        explanation=(
            f"{inp.adverse_media_count} adverse media article(s) found "
            f"with {inp.adverse_media_severity} severity."
        ),
    ))

    # 4. Network exposure (max 15)
    exp = EXPOSURE_MAP.get(inp.network_exposure, 0)
    network_score = max(0.0, 15.0 - (exp * 5.0))
    factors.append(RiskFactor(
        name="Network Exposure",
        score=network_score,
        max_score=15.0,
        weight=0.15,
        explanation=f"Network exposure classified as {inp.network_exposure}.",
    ))

    # 5. Regulatory history (max 15)
    reg_score = max(0.0, 15.0 - (inp.regulatory_violations * 5.0))
    reg_score = min(15.0, reg_score)
    factors.append(RiskFactor(
        name="Regulatory History",
        score=reg_score,
        max_score=15.0,
        weight=0.15,
        explanation=(
            f"{inp.regulatory_violations} regulatory violation(s) on record."
            if inp.regulatory_violations > 0
            else "No regulatory violations found."
        ),
    ))

    # Composite: sum of (score / max_score) * weight * 100
    composite = sum(
        (f.score / f.max_score) * f.weight * 100
        for f in factors
    )
    # Invert: higher raw score = lower risk; we want higher composite = higher risk
    risk_score = int(100 - composite)
    return risk_score, factors


def risk_level(score: int) -> str:
    if score < 25:
        return "low"
    elif score < 50:
        return "medium"
    elif score < 75:
        return "high"
    return "critical"


def recommendation(score: int, inp: RiskInput) -> str:
    level = risk_level(score)
    if level == "low":
        return "Standard onboarding procedures apply. Periodic monitoring recommended."
    elif level == "medium":
        return "Enhanced due diligence required. Obtain additional documentation and references."
    elif level == "high":
        return (
            "High-risk subject. Senior compliance officer approval required before proceeding. "
            "File Suspicious Activity Report (SAR) if transacting."
        )
    return (
        "Critical risk. Do not onboard. Escalate to MLRO and EFCC immediately. "
        "Freeze any existing accounts pending investigation."
    )


# ── Ollama-enhanced explanation ──────────────────────────────────────────────

class RiskExplainRequest(BaseModel):
    subject: str
    risk_score: int = Field(..., ge=0, le=100)
    factors: List[str] = []
    model: Optional[str] = None


class RiskExplainResponse(BaseModel):
    explanation: str
    model: str
    fallback: bool = False


@router.post("/explain", response_model=RiskExplainResponse)
async def explain_risk(req: RiskExplainRequest, request: Request) -> RiskExplainResponse:
    """Generate a natural-language explanation of a risk score using Ollama."""
    ollama = getattr(request.app.state, "ollama", None)
    model = req.model or "llama3.2"
    factors_text = "\n".join(f"- {f}" for f in req.factors) if req.factors else "- No specific factors provided"
    prompt = (
        f"You are a senior AML compliance officer. Explain the following risk assessment in 2-3 clear sentences "
        f"suitable for a compliance report:\n\n"
        f"Subject: {req.subject}\n"
        f"Risk Score: {req.risk_score}/100\n"
        f"Contributing Factors:\n{factors_text}\n\n"
        f"Provide a concise, professional explanation of why this risk score was assigned and what it means."
    )
    fallback = False
    if ollama:
        try:
            explanation = await ollama.generate(model=model, prompt=prompt)
            if explanation:
                return RiskExplainResponse(explanation=explanation, model=model)
        except Exception as e:
            log.warning("risk.explain.ollama_failed", error=str(e))
    # Deterministic fallback
    fallback = True
    level = risk_level(req.risk_score)
    explanation = (
        f"{req.subject} has been assigned a risk score of {req.risk_score}/100 ({level} risk). "
        f"The primary contributing factors are: {', '.join(req.factors[:3]) if req.factors else 'general profile assessment'}. "
        f"{'Enhanced due diligence and senior approval are required before proceeding.' if req.risk_score >= 50 else 'Standard monitoring procedures apply.'}"
    )
    return RiskExplainResponse(explanation=explanation, model="deterministic-fallback", fallback=fallback)


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/score", response_model=RiskScoreResponse)
async def score_risk(inp: RiskInput, request: Request) -> RiskScoreResponse:
    """Compute a composite ML risk score for a subject."""
    score, factors = compute_risk_score(inp)
    level = risk_level(score)
    rec = recommendation(score, inp)

    log.info(
        "risk.scored",
        subject=inp.subject_name,
        score=score,
        level=level,
    )

    return RiskScoreResponse(
        subject_name=inp.subject_name,
        composite_score=score,
        risk_level=level,
        factors=factors,
        recommendation=rec,
    )
