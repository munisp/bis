"""
Criminal Records NLP Enrichment Router
=======================================
Provides three ML-powered endpoints:

  POST /api/v1/criminal/classify     — classify an offence description into a
                                        canonical category using keyword + LLM
  POST /api/v1/criminal/completeness — score data completeness for a subject
                                        and return thin-file signals
  POST /api/v1/criminal/corporate    — extract risk signals from a corporate
                                        check payload (CAC, FIRS, directors)

All endpoints are authenticated via X-BIS-Key header (same key as the rest of
the ML enrichment service).

Middleware integrations:
  - Redis: result caching (TTL 1 h for classification, 5 min for completeness)
  - Kafka: publishes enrichment events to bis.ml.criminal_enriched
  - OpenSearch: sinks enriched records to bis-criminal-enriched index
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

log = logging.getLogger("bis-ml-criminal")

router = APIRouter()

# ─── Auth ─────────────────────────────────────────────────────────────────────

BIS_KEY = os.getenv("BIS_GATEWAY_KEY", "dev-gateway-key-change-in-prod")


def verify_key(request: Request):
    key = request.headers.get("X-BIS-Key", "")
    if key != BIS_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
    return key


# ─── Models ──────────────────────────────────────────────────────────────────

class ClassifyOffenceRequest(BaseModel):
    record_id: str
    subject_name: str
    agency: str = ""
    offence_description: str
    raw_text: Optional[str] = None


class ClassifyOffenceResponse(BaseModel):
    record_id: str
    predicted_category: str
    confidence: float
    sub_categories: List[str]
    severity: str          # low | medium | high | critical
    recidivism_risk: float
    model_version: str
    processed_at: str


class CompletenessRequest(BaseModel):
    subject_id: str
    subject_type: str = "individual"   # individual | corporate
    has_nin: bool = False
    has_bvn: bool = False
    has_passport: bool = False
    has_cac: bool = False
    has_tin: bool = False
    has_criminal_check: bool = False
    has_field_visit: bool = False
    has_kyc: bool = False
    has_sanctions_check: bool = False
    has_pep_check: bool = False
    has_adverse_media: bool = False
    criminal_record_count: int = 0
    outstanding_warrant: bool = False


class CompletenessResponse(BaseModel):
    subject_id: str
    completeness_score: float          # 0.0 – 1.0
    thin_file: bool
    missing_sources: List[str]
    recommended_actions: List[str]
    data_quality_tier: str             # poor | fair | good | excellent
    processed_at: str


class CorporateRiskRequest(BaseModel):
    profile_id: str
    company_name: str
    rc_number: str = ""
    tin: str = ""
    cac_status: str = ""               # active | inactive | struck_off | dissolved
    firs_cleared: bool = False
    firs_outstanding_amount: float = 0.0
    sanctions_hit: bool = False
    sanctions_count: int = 0
    director_count: int = 0
    foreign_director_count: int = 0
    pep_director: bool = False
    adverse_media_count: int = 0
    years_in_operation: int = 0
    industry_sector: str = ""


class CorporateRiskResponse(BaseModel):
    profile_id: str
    risk_score: int                    # 0–100
    risk_tier: str                     # low | medium | high | critical
    risk_factors: List[str]
    shell_company_probability: float   # 0.0 – 1.0
    beneficial_owner_risk: float       # 0.0 – 1.0
    recommended_actions: List[str]
    model_version: str
    processed_at: str


# ─── Offence Classification ───────────────────────────────────────────────────

# Keyword-based classifier (deterministic fallback when LLM is unavailable)
OFFENCE_KEYWORDS: Dict[str, List[str]] = {
    "financial_crime": [
        "fraud", "embezzlement", "money laundering", "advance fee", "419",
        "forgery", "obtaining by false pretence", "ponzi", "pyramid",
        "insider trading", "tax evasion", "bribery", "corruption",
        "misappropriation", "conversion", "theft of funds",
    ],
    "violent_crime": [
        "murder", "manslaughter", "assault", "battery", "armed robbery",
        "kidnapping", "abduction", "rape", "sexual assault", "grievous harm",
        "wounding", "homicide", "culpable homicide",
    ],
    "drug_offence": [
        "drug", "narcotic", "cocaine", "heroin", "cannabis", "marijuana",
        "methamphetamine", "tramadol", "codeine", "psychotropic",
        "controlled substance", "ndlea", "trafficking",
    ],
    "cybercrime": [
        "cybercrime", "hacking", "phishing", "identity theft", "scam",
        "romance fraud", "yahoo", "computer fraud", "data breach",
        "unauthorized access", "malware", "ransomware",
    ],
    "terrorism": [
        "terrorism", "terrorist", "boko haram", "iswap", "bandits",
        "insurgency", "bomb", "explosive", "arson", "sabotage",
        "financing terrorism", "extremism",
    ],
    "corruption": [
        "corruption", "bribery", "gratification", "public officer",
        "abuse of office", "conflict of interest", "kickback",
        "procurement fraud", "contract inflation",
    ],
    "traffic_offence": [
        "reckless driving", "drunk driving", "dui", "hit and run",
        "traffic", "frsc", "vehicle", "license",
    ],
    "sexual_offence": [
        "rape", "sexual assault", "indecent assault", "defilement",
        "child abuse", "pornography", "trafficking for sexual",
    ],
    "property_crime": [
        "burglary", "breaking and entering", "theft", "stealing",
        "robbery", "vandalism", "malicious damage", "arson",
    ],
}

SEVERITY_MAP = {
    "terrorism":      "critical",
    "violent_crime":  "critical",
    "drug_offence":   "high",
    "financial_crime": "high",
    "corruption":     "high",
    "cybercrime":     "medium",
    "sexual_offence": "critical",
    "property_crime": "medium",
    "traffic_offence": "low",
    "other":          "low",
}

RECIDIVISM_BASE = {
    "terrorism":      0.85,
    "violent_crime":  0.65,
    "drug_offence":   0.70,
    "financial_crime": 0.55,
    "corruption":     0.50,
    "cybercrime":     0.60,
    "sexual_offence": 0.75,
    "property_crime": 0.50,
    "traffic_offence": 0.30,
    "other":          0.25,
}


def classify_offence_keywords(description: str) -> tuple[str, float, List[str]]:
    """
    Keyword-based offence classifier.
    Returns (category, confidence, sub_categories).
    """
    text = description.lower()
    scores: Dict[str, int] = {}
    matched: Dict[str, List[str]] = {}

    for category, keywords in OFFENCE_KEYWORDS.items():
        hits = [kw for kw in keywords if kw in text]
        if hits:
            scores[category] = len(hits)
            matched[category] = hits

    if not scores:
        return "other", 0.40, []

    best = max(scores, key=lambda k: scores[k])
    total_hits = sum(scores.values())
    confidence = min(scores[best] / max(total_hits, 1) + 0.30, 0.92)
    sub_categories = matched.get(best, [])[:5]

    return best, round(confidence, 3), sub_categories


async def classify_with_llm(description: str, ollama_url: str) -> Optional[tuple[str, float]]:
    """
    Use the Ollama LLM proxy (if available) for higher-accuracy classification.
    Returns (category, confidence) or None on failure.
    """
    import httpx
    categories = list(OFFENCE_KEYWORDS.keys()) + ["other"]
    prompt = (
        f"Classify this Nigerian criminal offence description into exactly one of these categories: "
        f"{', '.join(categories)}.\n\n"
        f"Description: {description}\n\n"
        f"Respond with JSON only: {{\"category\": \"<category>\", \"confidence\": <0.0-1.0>}}"
    )
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                f"{ollama_url}/api/generate",
                json={"model": "llama3.2", "prompt": prompt, "stream": False},
            )
            if resp.status_code == 200:
                text = resp.json().get("response", "")
                match = re.search(r'\{.*\}', text, re.DOTALL)
                if match:
                    data = json.loads(match.group())
                    cat = data.get("category", "other")
                    conf = float(data.get("confidence", 0.5))
                    if cat in categories:
                        return cat, min(conf, 0.99)
    except Exception as e:
        log.debug(f"LLM classification failed: {e}")
    return None


@router.post("/classify", response_model=ClassifyOffenceResponse, dependencies=[Depends(verify_key)])
async def classify_offence(req: ClassifyOffenceRequest, request: Request):
    """
    Classify a criminal offence description into a canonical category.
    Uses keyword analysis with optional LLM enhancement.
    """
    start = time.time()

    # Try Redis cache first
    redis = getattr(request.app.state, "redis", None)
    cache_key = f"criminal:classify:{req.record_id}"
    if redis:
        try:
            cached = redis.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception:
            pass

    # Keyword classification (always available)
    category, confidence, sub_cats = classify_offence_keywords(req.offence_description)

    # Try LLM enhancement if Ollama is configured
    ollama_url = os.getenv("OLLAMA_BASE_URL", "")
    if ollama_url and confidence < 0.80:
        llm_result = await classify_with_llm(req.offence_description, ollama_url)
        if llm_result:
            llm_cat, llm_conf = llm_result
            if llm_conf > confidence:
                category, confidence = llm_cat, llm_conf

    severity = SEVERITY_MAP.get(category, "low")
    recidivism = RECIDIVISM_BASE.get(category, 0.25)

    result = ClassifyOffenceResponse(
        record_id=req.record_id,
        predicted_category=category,
        confidence=confidence,
        sub_categories=sub_cats,
        severity=severity,
        recidivism_risk=recidivism,
        model_version="keyword-v1.2+llm-optional",
        processed_at=datetime.now(timezone.utc).isoformat(),
    )

    # Cache result
    if redis:
        try:
            redis.setex(cache_key, 3600, json.dumps(result.model_dump()))
        except Exception:
            pass

    # Publish Kafka event
    kafka = getattr(request.app.state, "kafka_producer", None)
    if kafka:
        try:
            kafka.send("bis.ml.criminal_enriched", {
                "event": "offence_classified",
                "record_id": req.record_id,
                "category": category,
                "severity": severity,
                "confidence": confidence,
                "processing_ms": int((time.time() - start) * 1000),
                "timestamp": result.processed_at,
            })
        except Exception as e:
            log.warning(f"Kafka publish failed: {e}")

    return result


# ─── Data Completeness / Thin-File ───────────────────────────────────────────

INDIVIDUAL_SOURCES = [
    ("has_nin",             "NIN verification",          0.20),
    ("has_bvn",             "BVN verification",          0.20),
    ("has_kyc",             "KYC record",                0.15),
    ("has_criminal_check",  "Criminal records check",    0.15),
    ("has_sanctions_check", "Sanctions screening",       0.10),
    ("has_pep_check",       "PEP screening",             0.08),
    ("has_adverse_media",   "Adverse media check",       0.07),
    ("has_field_visit",     "Field visit",               0.05),
]

CORPORATE_SOURCES = [
    ("has_cac",             "CAC registry check",        0.25),
    ("has_tin",             "FIRS tax clearance",        0.20),
    ("has_sanctions_check", "Sanctions screening",       0.15),
    ("has_kyc",             "KYC / due diligence",       0.15),
    ("has_criminal_check",  "Directors criminal check",  0.10),
    ("has_adverse_media",   "Adverse media check",       0.10),
    ("has_field_visit",     "Physical address visit",    0.05),
]

THIN_FILE_THRESHOLD = 0.45


def compute_completeness(req: CompletenessRequest) -> CompletenessResponse:
    sources = INDIVIDUAL_SOURCES if req.subject_type == "individual" else CORPORATE_SOURCES
    score = 0.0
    missing: List[str] = []
    actions: List[str] = []

    for field, label, weight in sources:
        if getattr(req, field, False):
            score += weight
        else:
            missing.append(label)

    # Warrant penalty
    if req.outstanding_warrant:
        score = max(score - 0.05, 0.0)

    score = round(min(score, 1.0), 3)
    thin = score < THIN_FILE_THRESHOLD

    # Build recommended actions
    action_map = {
        "NIN verification":         "Request NIN slip or NIMC self-service portal printout",
        "BVN verification":         "Request recent bank statement with BVN printed",
        "KYC record":               "Initiate KYC collection — upload ID and utility bill",
        "Criminal records check":   "Submit NPF or EFCC data collection request",
        "Sanctions screening":      "Run OFAC / UN / EU sanctions check",
        "PEP screening":            "Run PEP database check",
        "Adverse media check":      "Run adverse media scan via NewsAPI / GDELT",
        "Field visit":              "Dispatch field agent for physical address verification",
        "CAC registry check":       "Request CAC full profile via RC number",
        "FIRS tax clearance":       "Request FIRS tax clearance certificate",
        "Directors criminal check": "Run criminal check on all listed directors",
    }
    for m in missing[:5]:
        if m in action_map:
            actions.append(action_map[m])

    if score >= 0.85:
        tier = "excellent"
    elif score >= 0.65:
        tier = "good"
    elif score >= 0.45:
        tier = "fair"
    else:
        tier = "poor"

    return CompletenessResponse(
        subject_id=req.subject_id,
        completeness_score=score,
        thin_file=thin,
        missing_sources=missing,
        recommended_actions=actions,
        data_quality_tier=tier,
        processed_at=datetime.now(timezone.utc).isoformat(),
    )


@router.post("/completeness", response_model=CompletenessResponse, dependencies=[Depends(verify_key)])
async def assess_completeness(req: CompletenessRequest, request: Request):
    """
    Score data completeness for a subject and return thin-file signals.
    """
    redis = getattr(request.app.state, "redis", None)
    cache_key = f"criminal:completeness:{req.subject_id}"
    if redis:
        try:
            cached = redis.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception:
            pass

    result = compute_completeness(req)

    if redis:
        try:
            redis.setex(cache_key, 300, json.dumps(result.model_dump()))
        except Exception:
            pass

    return result


# ─── Corporate Risk Signals ───────────────────────────────────────────────────

def compute_corporate_risk(req: CorporateRiskRequest) -> CorporateRiskResponse:
    score = 0
    factors: List[str] = []
    actions: List[str] = []

    # CAC status
    if req.cac_status in ("struck_off", "dissolved"):
        score += 40
        factors.append(f"CAC status: {req.cac_status}")
        actions.append("Do not proceed — company is no longer active")
    elif req.cac_status == "inactive":
        score += 20
        factors.append("CAC status: inactive")

    # FIRS
    if not req.firs_cleared:
        score += 25
        factors.append("FIRS tax clearance not obtained")
        if req.firs_outstanding_amount > 0:
            score += min(int(req.firs_outstanding_amount / 1_000_000) * 2, 15)
            factors.append(f"Outstanding tax liability: ₦{req.firs_outstanding_amount:,.0f}")
        actions.append("Request FIRS tax clearance certificate")

    # Sanctions
    if req.sanctions_hit:
        score += 50
        factors.append(f"Sanctions hit ({req.sanctions_count} match(es))")
        actions.append("Escalate to compliance officer — sanctions hit")

    # PEP director
    if req.pep_director:
        score += 20
        factors.append("PEP-linked director identified")
        actions.append("Conduct enhanced due diligence on PEP director")

    # Foreign directors
    if req.foreign_director_count > 0 and req.director_count > 0:
        foreign_ratio = req.foreign_director_count / req.director_count
        if foreign_ratio > 0.5:
            score += 15
            factors.append(f"High foreign director ratio: {foreign_ratio:.0%}")

    # Adverse media
    if req.adverse_media_count > 0:
        score += min(req.adverse_media_count * 8, 30)
        factors.append(f"{req.adverse_media_count} adverse media mention(s)")

    # Age of company
    if req.years_in_operation < 1:
        score += 15
        factors.append("Company less than 1 year old")
    elif req.years_in_operation < 2:
        score += 8

    # Shell company probability
    shell_signals = sum([
        req.director_count == 1,
        req.years_in_operation < 2,
        not req.firs_cleared,
        req.cac_status in ("inactive", "struck_off"),
        req.foreign_director_count > 0,
    ])
    shell_prob = min(shell_signals / 5, 0.95)

    # Beneficial owner risk
    ubo_risk = 0.2
    if req.pep_director:
        ubo_risk += 0.4
    if req.foreign_director_count > 0:
        ubo_risk += 0.2
    if req.sanctions_hit:
        ubo_risk += 0.3
    ubo_risk = min(ubo_risk, 0.99)

    score = min(score, 100)
    if score >= 75:
        tier = "critical"
    elif score >= 50:
        tier = "high"
    elif score >= 25:
        tier = "medium"
    else:
        tier = "low"

    return CorporateRiskResponse(
        profile_id=req.profile_id,
        risk_score=score,
        risk_tier=tier,
        risk_factors=factors,
        shell_company_probability=round(shell_prob, 3),
        beneficial_owner_risk=round(ubo_risk, 3),
        recommended_actions=actions,
        model_version="corporate-risk-v1.0",
        processed_at=datetime.now(timezone.utc).isoformat(),
    )


@router.post("/corporate", response_model=CorporateRiskResponse, dependencies=[Depends(verify_key)])
async def assess_corporate_risk(req: CorporateRiskRequest, request: Request):
    """
    Extract and score risk signals from a corporate check payload.
    """
    redis = getattr(request.app.state, "redis", None)
    cache_key = f"criminal:corporate:{req.profile_id}"
    if redis:
        try:
            cached = redis.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception:
            pass

    result = compute_corporate_risk(req)

    if redis:
        try:
            redis.setex(cache_key, 1800, json.dumps(result.model_dump()))
        except Exception:
            pass

    # Publish Kafka event for high-risk corporates
    kafka = getattr(request.app.state, "kafka_producer", None)
    if kafka and result.risk_score >= 50:
        try:
            kafka.send("bis.ml.corporate_risk_flagged", {
                "event": "corporate_risk_assessed",
                "profile_id": req.profile_id,
                "company_name": req.company_name,
                "risk_score": result.risk_score,
                "risk_tier": result.risk_tier,
                "shell_probability": result.shell_company_probability,
                "timestamp": result.processed_at,
            })
        except Exception as e:
            log.warning(f"Kafka publish failed: {e}")

    return result
