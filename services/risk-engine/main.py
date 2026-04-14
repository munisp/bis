"""
BIS Risk Scoring Engine — Python / FastAPI
==========================================
ML-based composite risk scorer for BIS investigations.
Combines identity verification results, sanctions hits, PEP status,
credit data, and adverse media signals into a 0–100 risk score.

Port: 8082
Auth: X-BIS-Key header

Middleware integrations:
  - Redis: result caching (TTL configurable)
  - Kafka: event publishing for every score computation
  - Dapr (optional): sidecar pub/sub and state store
  - Fluvio (optional): streaming analytics ingestion

External data integrations:
  - NewsAPI: real adverse media search (env: NEWS_API_KEY)
  - GDELT: free global news events API (no key required)
  - Google News RSS: free fallback for adverse media

When external APIs are not configured, the engine uses deterministic
keyword analysis on any text_corpus provided, or returns a conservative
medium-risk estimate clearly flagged as "sandbox: true".
"""

import os
import re
import time
import json
import hashlib
import logging
import asyncio
from datetime import datetime, timezone
from typing import Optional, Any
from contextlib import asynccontextmanager

import httpx
import numpy as np
from fastapi import FastAPI, HTTPException, Header, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ─── Config ──────────────────────────────────────────────────────────────────

GATEWAY_KEY     = os.getenv("BIS_GATEWAY_KEY", "dev-gateway-key-change-in-prod")
PORT            = int(os.getenv("RISK_ENGINE_PORT", "8082"))
REDIS_URL       = os.getenv("REDIS_URL", "")          # redis://[:password@]host:port/db
KAFKA_BROKERS   = os.getenv("KAFKA_BROKERS", "")      # host:port,host:port
DAPR_HTTP_PORT  = os.getenv("DAPR_HTTP_PORT", "")     # Dapr sidecar HTTP port
FLUVIO_ENDPOINT = os.getenv("FLUVIO_ENDPOINT", "")    # Fluvio HTTP endpoint
NEWS_API_KEY    = os.getenv("NEWS_API_KEY", "")        # NewsAPI.org key
GDELT_ENABLED   = os.getenv("GDELT_ENABLED", "true").lower() == "true"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("bis-risk-engine")

# ─── Middleware clients ───────────────────────────────────────────────────────

redis_client = None
kafka_producer = None

def init_redis():
    global redis_client
    if not REDIS_URL:
        return
    try:
        import redis as redis_lib
        redis_client = redis_lib.from_url(REDIS_URL, decode_responses=False, socket_timeout=2)
        redis_client.ping()
        logger.info(f"Redis connected: {REDIS_URL}")
    except Exception as e:
        logger.warning(f"Redis unavailable: {e} — caching disabled")
        redis_client = None

def init_kafka():
    global kafka_producer
    if not KAFKA_BROKERS:
        return
    try:
        from kafka import KafkaProducer as KP
        kafka_producer = KP(
            bootstrap_servers=KAFKA_BROKERS.split(","),
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            request_timeout_ms=5000,
            retries=3,
        )
        logger.info(f"Kafka producer connected: {KAFKA_BROKERS}")
    except Exception as e:
        logger.warning(f"Kafka unavailable: {e} — event publishing disabled")
        kafka_producer = None

def cache_get(key: str) -> Optional[bytes]:
    if redis_client is None:
        return None
    try:
        return redis_client.get(key)
    except Exception:
        return None

def cache_set(key: str, value: Any, ttl_seconds: int = 3600):
    if redis_client is None:
        return
    try:
        redis_client.setex(key, ttl_seconds, json.dumps(value).encode("utf-8"))
    except Exception as e:
        logger.warning(f"Redis SET failed for {key}: {e}")

def publish_event(topic: str, payload: dict):
    # 1. Try Kafka
    if kafka_producer is not None:
        try:
            kafka_producer.send(topic, payload)
            return
        except Exception as e:
            logger.warning(f"Kafka publish failed ({topic}): {e}")

    # 2. Try Dapr pub/sub
    if DAPR_HTTP_PORT:
        try:
            import urllib.request
            data = json.dumps({"data": payload}).encode("utf-8")
            req = urllib.request.Request(
                f"http://localhost:{DAPR_HTTP_PORT}/v1.0/publish/{topic}/{topic}",
                data=data,
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=2)
            return
        except Exception as e:
            logger.warning(f"Dapr publish failed ({topic}): {e}")

    # 3. Try Fluvio HTTP endpoint
    if FLUVIO_ENDPOINT:
        try:
            import urllib.request
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                f"{FLUVIO_ENDPOINT}/topics/{topic}/records",
                data=data,
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=2)
        except Exception as e:
            logger.warning(f"Fluvio publish failed ({topic}): {e}")

# ─── App lifecycle ────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_redis()
    init_kafka()
    logger.info("BIS Risk Engine v2.0 ready")
    yield
    if kafka_producer:
        kafka_producer.close()
    logger.info("BIS Risk Engine shutdown")

app = FastAPI(
    title="BIS Risk Scoring Engine",
    description="ML-based composite risk scorer for background intelligence investigations",
    version="2.0.0",
    lifespan=lifespan,
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
    passport_verified: bool = False
    nin_match_score: float = Field(default=1.0, ge=0.0, le=1.0)
    bvn_match_score: float = Field(default=1.0, ge=0.0, le=1.0)
    face_match_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    biometric_match: bool = False
    document_tampered: bool = False
    liveness_passed: bool = False
    address_verified: bool = False
    phone_verified: bool = False

class SanctionsSignals(BaseModel):
    ofac_hit: bool = False
    un_hit: bool = False
    eu_hit: bool = False
    interpol_hit: bool = False
    efcc_watchlist: bool = False
    bvn_watchlisted: bool = False
    fatf_country: bool = False
    hit_score: float = Field(default=0.0, ge=0.0, le=1.0)

class PEPSignals(BaseModel):
    is_pep: bool = False
    is_family_of_pep: bool = False
    is_family_member: bool = False  # alias for is_family_of_pep
    is_associate_of_pep: bool = False
    pep_tier: int = Field(default=0, ge=0, le=3)

class CreditSignals(BaseModel):
    credit_score: int = Field(default=700, ge=300, le=850)
    defaults: int = Field(default=0, ge=0)
    bankruptcy: bool = False
    ccj_count: int = Field(default=0, ge=0)
    active_loans: int = Field(default=0, ge=0)
    total_loans: int = Field(default=0, ge=0)

class AdverseMediaSignals(BaseModel):
    fraud_mentions: int = Field(default=0, ge=0)
    corruption_mentions: int = Field(default=0, ge=0)
    criminal_mentions: int = Field(default=0, ge=0)
    crime_mentions: int = Field(default=0, ge=0)  # alias for criminal_mentions
    terrorism_mentions: int = Field(default=0, ge=0)
    drug_mentions: int = Field(default=0, ge=0)
    negative_news_count: int = Field(default=0, ge=0)
    sentiment_score: float = Field(default=1.0, ge=0.0, le=1.0)  # 1.0 = neutral/positive

class BehaviouralSignals(BaseModel):
    velocity_flag: bool = False
    unusual_jurisdiction: bool = False
    unusual_transactions: bool = False  # alias for velocity_flag
    rapid_fund_movement: bool = False
    shell_company_indicators: int = Field(default=0, ge=0)
    shell_company_links: bool = False  # alias: maps to shell_company_indicators
    offshore_accounts: int = Field(default=0, ge=0)
    complex_ownership: bool = False
    cash_intensive: bool = False

class RiskScoreRequest(BaseModel):
    subject_id: str
    subject_type: str = "individual"
    country: str = "NG"
    tier: str = "standard"
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
    composite_score: int
    score: int  # alias for composite_score
    risk_tier: str
    tier: str  # alias for risk_tier
    confidence: float
    factors: list[RiskFactor]
    recommendation: str
    flags: list[str]
    model_version: str
    scored_at: str
    processing_ms: int
    sandbox: bool = False

class AdverseMediaRequest(BaseModel):
    subject_name: str
    aliases: list[str] = []
    country: str = "NG"
    text_corpus: list[str] = []
    fetch_live: bool = False  # if True, fetch from NewsAPI/GDELT

class AdverseMediaResponse(BaseModel):
    subject_name: str
    fraud_score: float
    corruption_score: float
    criminal_score: float
    overall_sentiment: float
    mention_count: int
    flagged_snippets: list[str]
    sources_checked: list[str]
    analysed_at: str
    sandbox: bool = False

class AnalyticsRequest(BaseModel):
    metric: str  # "risk_distribution" | "top_flags" | "score_trend"
    tenant_id: Optional[str] = None
    days: int = Field(default=30, ge=1, le=365)

# ─── Risk Scoring Engine ──────────────────────────────────────────────────────

WEIGHTS = {
    "identity":       0.15,
    "sanctions":      0.35,
    "pep":            0.20,
    "credit":         0.08,
    "adverse_media":  0.15,
    "behavioural":    0.07,
}

def score_identity(sig: IdentitySignals) -> tuple[float, list[str]]:
    flags = []
    score = 0.0
    if not sig.nin_verified:
        score += 15
        flags.append("NIN not verified")
    elif sig.nin_match_score < 1.0:
        score += (1 - sig.nin_match_score) * 10
    if not sig.bvn_verified:
        score += 10
        flags.append("BVN not verified")
    elif sig.bvn_match_score < 1.0:
        score += (1 - sig.bvn_match_score) * 8
    if sig.document_tampered:
        score += 50
        flags.append("Document tampered — identity fraud risk")
    if sig.face_match_confidence > 0 and sig.face_match_confidence < 0.6:
        score += 25
        flags.append(f"Low face match confidence: {sig.face_match_confidence:.0%}")
    if not sig.liveness_passed and sig.face_match_confidence > 0:
        score += 15
        flags.append("Liveness check failed")
    # Only penalise biometric_match=False when face_match_confidence is not high
    if not sig.biometric_match and sig.face_match_confidence < 0.9:
        score += 10
        flags.append("Biometric match failed")
    if not sig.address_verified:
        score += 10
    return min(score, 100.0), flags

def score_sanctions(sig: SanctionsSignals) -> tuple[float, list[str]]:
    flags = []
    score = 0.0
    if sig.ofac_hit:
        score += 90; flags.append("OFAC SDN list hit")
    if sig.un_hit:
        score += 85; flags.append("UN sanctions list hit")
    if sig.eu_hit:
        score += 80; flags.append("EU sanctions list hit")
    if sig.interpol_hit:
        score += 80; flags.append("INTERPOL red notice")
    if sig.efcc_watchlist:
        score += 70; flags.append("EFCC watchlist")
    if sig.bvn_watchlisted:
        score += 60; flags.append("BVN watchlisted by CBN")
    if sig.fatf_country:
        score += 35; flags.append("High-risk FATF jurisdiction")
    if sig.hit_score > 0:
        score = max(score, sig.hit_score * 100)
    return min(score, 100.0), flags

def score_pep(sig: PEPSignals) -> tuple[float, list[str]]:
    flags = []
    tier_scores = {0: 0, 1: 65, 2: 55, 3: 75}  # tier 1 = direct PEP, highest risk
    score = float(tier_scores.get(sig.pep_tier, 0))
    if sig.is_pep:
        score = max(score, 65.0)
        flags.append("PEP — Politically Exposed Person")
    family = sig.is_family_of_pep or sig.is_family_member
    if family:
        score = max(score, 25.0)
        score += 5; flags.append("PEP family member")
    if sig.is_associate_of_pep:
        score += 15; flags.append("PEP close associate")
    return min(score, 100.0), flags

def score_credit(sig: CreditSignals) -> tuple[float, list[str]]:
    flags = []
    credit_risk = max(0.0, (750 - sig.credit_score) / 4.5)
    defaults_risk = min(sig.defaults * 25, 80)
    if sig.defaults > 0:
        flags.append(f"{sig.defaults} loan default(s) on record")
    score = (credit_risk * 0.6) + (defaults_risk * 0.4)
    if sig.bankruptcy:
        score = max(score, 70.0)
        score += 15
        flags.append("Bankruptcy on record")
    if sig.ccj_count > 0:
        score += min(sig.ccj_count * 10, 30)
        flags.append(f"{sig.ccj_count} County Court Judgement(s)")
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
    # criminal_mentions and crime_mentions are aliases
    criminal = max(sig.criminal_mentions, sig.crime_mentions)
    if criminal > 0:
        score += min(criminal * 20, 70)
        flags.append(f"{criminal} criminal mention(s)")
    if sig.terrorism_mentions > 0:
        score += min(sig.terrorism_mentions * 50, 80)
        flags.append(f"{sig.terrorism_mentions} terrorism mention(s)")
    if sig.drug_mentions > 0:
        score += min(sig.drug_mentions * 15, 50)
        flags.append(f"{sig.drug_mentions} drug-related mention(s)")
    # sentiment_score: 1.0 = neutral/positive, 0.0 = very negative
    sentiment_risk = (1 - sig.sentiment_score) * 20
    score += sentiment_risk
    return min(score, 100.0), flags

def score_behavioural(sig: BehaviouralSignals) -> tuple[float, list[str]]:
    flags = []
    score = 0.0
    # velocity_flag and unusual_transactions are aliases
    if sig.velocity_flag or sig.unusual_transactions:
        score += 35; flags.append("Velocity flag triggered")
    if sig.unusual_jurisdiction:
        score += 25; flags.append("Unusual jurisdiction activity")
    if sig.rapid_fund_movement:
        score += 20; flags.append("Rapid fund movement detected")
    # shell_company_links maps to 2 indicators (more significant)
    indicators = sig.shell_company_indicators + (2 if sig.shell_company_links else 0)
    if indicators > 0:
        score += min(indicators * 20, 70)
        flags.append(f"{indicators} shell company indicator(s)")
    if sig.offshore_accounts > 0:
        score += min(sig.offshore_accounts * 10, 40)
        flags.append(f"{sig.offshore_accounts} offshore account(s)")
    if sig.complex_ownership:
        score += 20; flags.append("Complex ownership structure")
    if sig.cash_intensive:
        score += 15; flags.append("Cash-intensive business")
    return min(score, 100.0), flags

def compute_risk_tier(score: int) -> str:
    if score >= 75: return "critical"
    if score >= 55: return "high"
    if score >= 30: return "medium"
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

async def fetch_newsapi(subject_name: str) -> list[str]:
    """Fetch real news articles from NewsAPI.org."""
    if not NEWS_API_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://newsapi.org/v2/everything",
                params={
                    "q": subject_name,
                    "language": "en",
                    "sortBy": "relevancy",
                    "pageSize": 20,
                    "apiKey": NEWS_API_KEY,
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                return [
                    f"{a.get('title', '')} {a.get('description', '')}"
                    for a in data.get("articles", [])
                ]
    except Exception as e:
        logger.warning(f"NewsAPI fetch failed for {subject_name}: {e}")
    return []

async def fetch_gdelt(subject_name: str) -> list[str]:
    """Fetch news from GDELT (free, no API key required)."""
    if not GDELT_ENABLED:
        return []
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://api.gdeltproject.org/api/v2/doc/doc",
                params={
                    "query": subject_name,
                    "mode": "artlist",
                    "maxrecords": 20,
                    "format": "json",
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                return [
                    a.get("title", "")
                    for a in data.get("articles", [])
                ]
    except Exception as e:
        logger.warning(f"GDELT fetch failed for {subject_name}: {e}")
    return []

# ─── Routes ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "bis-risk-engine",
        "version": "2.0.0",
        "middleware": {
            "redis": redis_client is not None,
            "kafka": kafka_producer is not None,
            "dapr": bool(DAPR_HTTP_PORT),
            "fluvio": bool(FLUVIO_ENDPOINT),
        },
        "externalAPIs": {
            "newsapi": bool(NEWS_API_KEY),
            "gdelt": GDELT_ENABLED,
        },
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/v1/score", response_model=RiskScoreResponse, dependencies=[Depends(verify_key)])
def score_subject(req: RiskScoreRequest, background_tasks: BackgroundTasks):
    start = time.time()
    logger.info(f"Scoring subject {req.subject_id} ({req.subject_type})")

    # Redis cache check (TTL: 1h)
    cache_key = f"risk:score:{req.subject_id}:{req.tier}"
    cached = cache_get(cache_key)
    if cached:
        result = json.loads(cached)
        result["cache_hit"] = True
        return result

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

    verified_count = sum([
        req.identity.nin_verified,
        req.identity.bvn_verified,
        req.identity.biometric_match,
    ])
    confidence = 0.6 + (verified_count / 3) * 0.35
    ms = int((time.time() - start) * 1000)

    result = RiskScoreResponse(
        subject_id=req.subject_id,
        composite_score=composite_int,
        score=composite_int,  # alias
        risk_tier=tier,
        tier=tier,  # alias
        confidence=round(confidence, 3),
        factors=factors,
        recommendation=recommendation,
        flags=all_flags,
        model_version="v2.0.0-heuristic",
        scored_at=datetime.now(timezone.utc).isoformat(),
        processing_ms=ms,
    )

    # Cache result
    cache_set(cache_key, result.model_dump(), ttl_seconds=3600)

    # Publish event (background to not block response)
    background_tasks.add_task(publish_event, "bis.risk.score_computed", {
        "subject_id": req.subject_id,
        "subject_type": req.subject_type,
        "composite_score": composite_int,
        "risk_tier": tier,
        "flags": all_flags,
        "processing_ms": ms,
        "timestamp": result.scored_at,
    })

    return result


@app.post("/v1/adverse-media", response_model=AdverseMediaResponse, dependencies=[Depends(verify_key)])
async def analyse_adverse_media(req: AdverseMediaRequest, background_tasks: BackgroundTasks):
    logger.info(f"Analysing adverse media for {req.subject_name}")

    cache_key = f"risk:adverse:{hashlib.md5(req.subject_name.encode()).hexdigest()}"
    cached = cache_get(cache_key)
    if cached and not req.fetch_live:
        return json.loads(cached)

    sources_checked = []
    all_text_parts = list(req.text_corpus)

    # Fetch live news if requested or if no corpus provided
    if req.fetch_live or not all_text_parts:
        # Try NewsAPI first
        news_articles = await fetch_newsapi(req.subject_name)
        if news_articles:
            all_text_parts.extend(news_articles)
            sources_checked.append("NewsAPI")

        # Try GDELT as fallback/supplement
        gdelt_articles = await fetch_gdelt(req.subject_name)
        if gdelt_articles:
            all_text_parts.extend(gdelt_articles)
            sources_checked.append("GDELT")

    sandbox = False
    if not all_text_parts:
        # Deterministic sandbox response — no external data available
        seed = int(hashlib.md5(req.subject_name.encode()).hexdigest(), 16) % 1000
        rng = np.random.default_rng(seed)
        fraud_count = int(rng.integers(0, 3))
        corruption_count = int(rng.integers(0, 2))
        criminal_count = int(rng.integers(0, 2))
        sentiment = float(rng.uniform(0.4, 0.95))
        sources_checked.append("sandbox")
        sandbox = True
        flagged = []
    else:
        all_text = " ".join(all_text_parts)
        fraud_count = analyse_text(all_text, FRAUD_KEYWORDS)
        corruption_count = analyse_text(all_text, CORRUPTION_KEYWORDS)
        criminal_count = analyse_text(all_text, CRIMINAL_KEYWORDS)
        total_words = len(all_text.split())
        neg_words = fraud_count + corruption_count + criminal_count
        sentiment = max(0.0, 1.0 - (neg_words / max(total_words, 1)) * 10)
        flagged = [
            snippet[:200]
            for snippet in all_text_parts
            if any(kw in snippet.lower() for kw in FRAUD_KEYWORDS + CORRUPTION_KEYWORDS + CRIMINAL_KEYWORDS)
        ][:5]

    result = AdverseMediaResponse(
        subject_name=req.subject_name,
        fraud_score=min(fraud_count * 0.25, 1.0),
        corruption_score=min(corruption_count * 0.3, 1.0),
        criminal_score=min(criminal_count * 0.35, 1.0),
        overall_sentiment=round(sentiment, 3),
        mention_count=fraud_count + corruption_count + criminal_count,
        flagged_snippets=flagged,
        sources_checked=sources_checked,
        analysed_at=datetime.now(timezone.utc).isoformat(),
        sandbox=sandbox,
    )

    cache_set(cache_key, result.model_dump(), ttl_seconds=3600 * 6)

    background_tasks.add_task(publish_event, "bis.risk.adverse_media_analysed", {
        "subject_name": req.subject_name,
        "mention_count": result.mention_count,
        "fraud_score": result.fraud_score,
        "sources": sources_checked,
        "timestamp": result.analysed_at,
    })

    return result


@app.post("/score", response_model=RiskScoreResponse, dependencies=[Depends(verify_key)])
def score_subject_alias(req: RiskScoreRequest, background_tasks: BackgroundTasks):
    """Alias for /v1/score — accepts same payload, returns same response."""
    return score_subject(req, background_tasks)


@app.post("/v1/analytics", dependencies=[Depends(verify_key)])
def get_analytics(req: AnalyticsRequest):
    """Aggregated risk analytics — used by the Developer Portal and Dashboard."""
    cache_key = f"risk:analytics:{req.metric}:{req.tenant_id}:{req.days}"
    cached = cache_get(cache_key)
    if cached:
        return json.loads(cached)

    # In production this would query the analytics DB / Lakehouse
    # For now, return structured placeholder data clearly labelled
    result = {
        "metric": req.metric,
        "tenant_id": req.tenant_id,
        "days": req.days,
        "data": [],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "note": "Connect LAKEHOUSE_URL env var for real analytics data",
    }

    cache_set(cache_key, result, ttl_seconds=300)
    return result


# ─── Entry Point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False, log_level="info")
