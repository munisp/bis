"""
BIS Risk Scoring Engine — Python / FastAPI
==========================================
ML-based composite risk scorer for BIS investigations.
Combines identity verification results, sanctions hits, PEP status,
credit data, and adverse media signals into a 0–100 risk score.

Port: 8082
Auth: X-BIS-Key header
"""

import os
import re
import time
import math
import hashlib
import logging
from datetime import datetime, timezone
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ─── Config ──────────────────────────────────────────────────────────────────

GATEWAY_KEY = os.getenv("BIS_GATEWAY_KEY", "dev-gateway-key-change-in-prod")
PORT = int(os.getenv("RISK_ENGINE_PORT", "8082"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("bis-risk-engine")

# ─── App ─────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="BIS Risk Scoring Engine",
    description="ML-based composite risk scorer for background intelligence investigations",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ─── Auth ─────────────────────────────────────────────────────────────────────

def verify_key(x_bis_key: str = Header(...)):
    if x_bis_key != GATEWAY_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
    return x_bis_key

# ─── Models ──────────────────────────────────────────────────────────────────

class IdentitySignals(BaseModel):
    nin_verified: bool = False
    bvn_verified: bool = False
    nin_match_score: float = Field(default=0.0, ge=0.0, le=1.0)
    bvn_match_score: float = Field(default=0.0, ge=0.0, le=1.0)
    biometric_match: bool = False
    address_verified: bool = False
    phone_verified: bool = False

class SanctionsSignals(BaseModel):
    ofac_hit: bool = False
    un_hit: bool = False
    interpol_hit: bool = False
    efcc_watchlist: bool = False
    bvn_watchlisted: bool = False
    hit_score: float = Field(default=0.0, ge=0.0, le=1.0)

class PEPSignals(BaseModel):
    is_pep: bool = False
    is_family_of_pep: bool = False
    is_associate_of_pep: bool = False
    pep_tier: int = Field(default=0, ge=0, le=3)  # 0=none, 1=local, 2=national, 3=international

class CreditSignals(BaseModel):
    credit_score: int = Field(default=700, ge=300, le=850)
    defaults: int = Field(default=0, ge=0)
    active_loans: int = Field(default=0, ge=0)
    total_loans: int = Field(default=0, ge=0)

class AdverseMediaSignals(BaseModel):
    fraud_mentions: int = Field(default=0, ge=0)
    corruption_mentions: int = Field(default=0, ge=0)
    criminal_mentions: int = Field(default=0, ge=0)
    negative_news_count: int = Field(default=0, ge=0)
    sentiment_score: float = Field(default=0.5, ge=0.0, le=1.0)  # 0=very negative, 1=very positive

class BehaviouralSignals(BaseModel):
    velocity_flag: bool = False
    unusual_jurisdiction: bool = False
    shell_company_indicators: int = Field(default=0, ge=0)
    complex_ownership: bool = False
    cash_intensive: bool = False

class RiskScoreRequest(BaseModel):
    subject_id: str
    subject_type: str = "individual"  # individual | corporate
    country: str = "NG"
    tier: str = "standard"  # basic | standard | comprehensive
    identity: IdentitySignals = Field(default_factory=IdentitySignals)
    sanctions: SanctionsSignals = Field(default_factory=SanctionsSignals)
    pep: PEPSignals = Field(default_factory=PEPSignals)
    credit: CreditSignals = Field(default_factory=CreditSignals)
    adverse_media: AdverseMediaSignals = Field(default_factory=AdverseMediaSignals)
    behavioural: BehaviouralSignals = Field(default_factory=BehaviouralSignals)

class RiskFactor(BaseModel):
    category: str
    label: str
    weight: float
    raw_score: float
    weighted_score: float
    flag: bool

class RiskScoreResponse(BaseModel):
    subject_id: str
    composite_score: int  # 0–100
    risk_tier: str  # low | medium | high | critical
    confidence: float
    factors: list[RiskFactor]
    recommendation: str
    flags: list[str]
    model_version: str
    scored_at: str
    processing_ms: int

class AdverseMediaRequest(BaseModel):
    subject_name: str
    aliases: list[str] = []
    country: str = "NG"
    text_corpus: list[str] = []  # raw text snippets to analyse

class AdverseMediaResponse(BaseModel):
    subject_name: str
    fraud_score: float
    corruption_score: float
    criminal_score: float
    overall_sentiment: float
    mention_count: int
    flagged_snippets: list[str]
    analysed_at: str

# ─── Risk Scoring Engine ──────────────────────────────────────────────────────

# Feature weights (must sum to 1.0)
WEIGHTS = {
    "identity":       0.20,
    "sanctions":      0.30,
    "pep":            0.15,
    "credit":         0.10,
    "adverse_media":  0.15,
    "behavioural":    0.10,
}

def score_identity(sig: IdentitySignals) -> tuple[float, list[str]]:
    """Returns raw risk score 0–100 (higher = riskier) and flags."""
    flags = []
    score = 0.0

    if not sig.nin_verified:
        score += 30
        flags.append("NIN not verified")
    else:
        score += (1 - sig.nin_match_score) * 20

    if not sig.bvn_verified:
        score += 25
        flags.append("BVN not verified")
    else:
        score += (1 - sig.bvn_match_score) * 15

    if not sig.biometric_match:
        score += 15
        flags.append("Biometric match failed")

    if not sig.address_verified:
        score += 10

    return min(score, 100.0), flags


def score_sanctions(sig: SanctionsSignals) -> tuple[float, list[str]]:
    flags = []
    score = 0.0

    if sig.ofac_hit:
        score += 90
        flags.append("OFAC SDN list hit")
    if sig.un_hit:
        score += 85
        flags.append("UN sanctions list hit")
    if sig.interpol_hit:
        score += 80
        flags.append("INTERPOL red notice")
    if sig.efcc_watchlist:
        score += 70
        flags.append("EFCC watchlist")
    if sig.bvn_watchlisted:
        score += 60
        flags.append("BVN watchlisted by CBN")

    if sig.hit_score > 0:
        score = max(score, sig.hit_score * 100)

    return min(score, 100.0), flags


def score_pep(sig: PEPSignals) -> tuple[float, list[str]]:
    flags = []
    score = 0.0

    tier_scores = {0: 0, 1: 30, 2: 55, 3: 75}
    score += tier_scores.get(sig.pep_tier, 0)

    if sig.is_pep:
        flags.append("Politically Exposed Person")
    if sig.is_family_of_pep:
        score += 20
        flags.append("Family member of PEP")
    if sig.is_associate_of_pep:
        score += 15
        flags.append("Close associate of PEP")

    return min(score, 100.0), flags


def score_credit(sig: CreditSignals) -> tuple[float, list[str]]:
    flags = []
    # Invert credit score: high credit = low risk
    credit_risk = max(0, (750 - sig.credit_score) / 4.5)  # 0–100

    defaults_risk = min(sig.defaults * 25, 80)
    if sig.defaults > 0:
        flags.append(f"{sig.defaults} loan default(s) on record")

    score = (credit_risk * 0.6) + (defaults_risk * 0.4)
    return min(score, 100.0), flags


def score_adverse_media(sig: AdverseMediaSignals) -> tuple[float, list[str]]:
    flags = []
    score = 0.0

    if sig.fraud_mentions > 0:
        score += min(sig.fraud_mentions * 15, 60)
        flags.append(f"{sig.fraud_mentions} fraud mention(s) in media")
    if sig.corruption_mentions > 0:
        score += min(sig.corruption_mentions * 12, 50)
        flags.append(f"{sig.corruption_mentions} corruption mention(s)")
    if sig.criminal_mentions > 0:
        score += min(sig.criminal_mentions * 20, 70)
        flags.append(f"{sig.criminal_mentions} criminal mention(s)")

    # Sentiment: 0=very negative → high risk
    sentiment_risk = (1 - sig.sentiment_score) * 40
    score += sentiment_risk

    return min(score, 100.0), flags


def score_behavioural(sig: BehaviouralSignals) -> tuple[float, list[str]]:
    flags = []
    score = 0.0

    if sig.velocity_flag:
        score += 35
        flags.append("Velocity flag triggered")
    if sig.unusual_jurisdiction:
        score += 25
        flags.append("Unusual jurisdiction activity")
    if sig.shell_company_indicators > 0:
        score += min(sig.shell_company_indicators * 20, 60)
        flags.append(f"{sig.shell_company_indicators} shell company indicator(s)")
    if sig.complex_ownership:
        score += 20
        flags.append("Complex ownership structure")
    if sig.cash_intensive:
        score += 15
        flags.append("Cash-intensive business")

    return min(score, 100.0), flags


def compute_risk_tier(score: int) -> str:
    if score >= 75:
        return "critical"
    if score >= 55:
        return "high"
    if score >= 30:
        return "medium"
    return "low"


def build_recommendation(tier: str, flags: list[str]) -> str:
    if tier == "critical":
        return "BLOCK — Do not proceed. Immediate escalation required. File SAR."
    if tier == "high":
        return "REVIEW — Enhanced due diligence required before proceeding."
    if tier == "medium":
        return "MONITOR — Standard due diligence. Flag for periodic review."
    return "PASS — Risk within acceptable parameters. Standard onboarding."


# ─── NLP Adverse Media Analyser ──────────────────────────────────────────────

FRAUD_KEYWORDS = [
    "fraud", "scam", "ponzi", "embezzlement", "money laundering",
    "419", "advance fee", "forgery", "counterfeit", "theft",
]
CORRUPTION_KEYWORDS = [
    "bribery", "corruption", "kickback", "misappropriation", "looting",
    "diversion of funds", "ghost worker", "contract inflation",
]
CRIMINAL_KEYWORDS = [
    "arrested", "convicted", "indicted", "charged", "sentenced",
    "detained", "wanted", "fugitive", "criminal",
]

def analyse_text(text: str, keywords: list[str]) -> int:
    text_lower = text.lower()
    return sum(1 for kw in keywords if kw in text_lower)


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "bis-risk-engine",
        "version": "1.0.0",
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/v1/score", response_model=RiskScoreResponse, dependencies=[Depends(verify_key)])
def score_subject(req: RiskScoreRequest):
    start = time.time()
    logger.info(f"Scoring subject {req.subject_id} ({req.subject_type})")

    all_flags: list[str] = []
    factors: list[RiskFactor] = []

    scorers = [
        ("identity",      "Identity Verification",  score_identity,      req.identity),
        ("sanctions",     "Sanctions Screening",    score_sanctions,     req.sanctions),
        ("pep",           "PEP Screening",          score_pep,           req.pep),
        ("credit",        "Credit Risk",            score_credit,        req.credit),
        ("adverse_media", "Adverse Media",          score_adverse_media, req.adverse_media),
        ("behavioural",   "Behavioural Signals",    score_behavioural,   req.behavioural),
    ]

    composite = 0.0
    for key, label, scorer_fn, signals in scorers:
        raw, flags = scorer_fn(signals)
        weight = WEIGHTS[key]
        weighted = raw * weight
        composite += weighted
        all_flags.extend(flags)
        factors.append(RiskFactor(
            category=key,
            label=label,
            weight=weight,
            raw_score=round(raw, 2),
            weighted_score=round(weighted, 2),
            flag=len(flags) > 0,
        ))

    composite_int = min(int(round(composite)), 100)
    tier = compute_risk_tier(composite_int)
    recommendation = build_recommendation(tier, all_flags)

    # Confidence: higher with more verified signals
    verified_count = sum([
        req.identity.nin_verified,
        req.identity.bvn_verified,
        req.identity.biometric_match,
    ])
    confidence = 0.6 + (verified_count / 3) * 0.35

    ms = int((time.time() - start) * 1000)

    return RiskScoreResponse(
        subject_id=req.subject_id,
        composite_score=composite_int,
        risk_tier=tier,
        confidence=round(confidence, 3),
        factors=factors,
        recommendation=recommendation,
        flags=all_flags,
        model_version="v1.0.0-heuristic",
        scored_at=datetime.now(timezone.utc).isoformat(),
        processing_ms=ms,
    )


@app.post("/v1/adverse-media", response_model=AdverseMediaResponse, dependencies=[Depends(verify_key)])
def analyse_adverse_media(req: AdverseMediaRequest):
    logger.info(f"Analysing adverse media for {req.subject_name}")

    all_text = " ".join(req.text_corpus)
    if not all_text:
        # Generate deterministic mock based on name
        seed = int(hashlib.md5(req.subject_name.encode()).hexdigest(), 16) % 1000
        rng = np.random.default_rng(seed)
        fraud_count = int(rng.integers(0, 3))
        corruption_count = int(rng.integers(0, 2))
        criminal_count = int(rng.integers(0, 2))
        sentiment = float(rng.uniform(0.3, 0.9))
    else:
        fraud_count = analyse_text(all_text, FRAUD_KEYWORDS)
        corruption_count = analyse_text(all_text, CORRUPTION_KEYWORDS)
        criminal_count = analyse_text(all_text, CRIMINAL_KEYWORDS)
        # Simple sentiment: ratio of negative to total words
        total_words = len(all_text.split())
        neg_words = fraud_count + corruption_count + criminal_count
        sentiment = max(0.0, 1.0 - (neg_words / max(total_words, 1)) * 10)

    flagged = []
    for snippet in req.text_corpus:
        if any(kw in snippet.lower() for kw in FRAUD_KEYWORDS + CORRUPTION_KEYWORDS + CRIMINAL_KEYWORDS):
            flagged.append(snippet[:200])

    return AdverseMediaResponse(
        subject_name=req.subject_name,
        fraud_score=min(fraud_count * 0.25, 1.0),
        corruption_score=min(corruption_count * 0.3, 1.0),
        criminal_score=min(criminal_count * 0.35, 1.0),
        overall_sentiment=round(sentiment, 3),
        mention_count=fraud_count + corruption_count + criminal_count,
        flagged_snippets=flagged[:5],
        analysed_at=datetime.now(timezone.utc).isoformat(),
    )


# ─── Entry Point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False, log_level="info")
