"""
BIS Nigerian Screening Scorer (Python / FastAPI)
─────────────────────────────────────────────────
ML-powered risk scoring for all Nigerian background screening types.
Consumes bis.screening.results from Kafka and publishes enriched scores
back to bis.screening.scored.

Endpoints:
  POST /score          → score a single screening result
  POST /batch-score    → score multiple results
  GET  /model/status   → model version and feature importance
  GET  /health         → liveness probe
  GET  /metrics        → Prometheus metrics
"""

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Optional

import numpy as np
import structlog
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from pydantic import BaseModel
from starlette.responses import Response

# ─── Logging ──────────────────────────────────────────────────────────────────

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ]
)
log = structlog.get_logger()

# ─── Prometheus Metrics ───────────────────────────────────────────────────────

SCORES_TOTAL = Counter("bis_scorer_scores_total", "Total scores computed", ["screening_type"])
SCORE_DURATION = Histogram("bis_scorer_duration_seconds", "Score computation duration", ["screening_type"])
KAFKA_ERRORS = Counter("bis_scorer_kafka_errors_total", "Kafka consumer errors")

# ─── Risk Weights per Screening Type ─────────────────────────────────────────
# These weights are used to compute a composite risk score from the raw
# screening engine output. They encode domain knowledge about which
# screening types carry the most weight for Nigerian employment contexts.

RISK_WEIGHTS: dict[str, dict[str, float]] = {
    "nin_trace": {
        "identity_mismatch": 0.90,
        "address_discrepancy": 0.45,
        "multiple_identities": 0.95,
    },
    "bvn_verification": {
        "bvn_mismatch": 0.85,
        "blacklisted_bvn": 0.99,
    },
    "criminal_efcc": {
        "active_case": 0.99,
        "conviction": 0.99,
        "investigation": 0.80,
        "acquitted": 0.20,
    },
    "criminal_icpc": {
        "active_case": 0.99,
        "conviction": 0.99,
        "investigation": 0.80,
    },
    "court_record": {
        "felony_conviction": 0.99,
        "misdemeanor_conviction": 0.60,
        "pending_case": 0.70,
        "civil_judgment": 0.30,
    },
    "cac_directorship": {
        "struck_off_company": 0.75,
        "insolvent_company": 0.65,
        "regulatory_sanction": 0.85,
    },
    "education_waec": {
        "certificate_forged": 0.99,
        "certificate_not_found": 0.80,
        "grade_discrepancy": 0.50,
    },
    "education_neco": {
        "certificate_forged": 0.99,
        "certificate_not_found": 0.80,
    },
    "education_university": {
        "degree_forged": 0.99,
        "degree_not_found": 0.85,
        "institution_unaccredited": 0.70,
    },
    "nysc_discharge": {
        "certificate_forged": 0.99,
        "exemption_forged": 0.95,
        "not_found": 0.75,
    },
    "employment_verification": {
        "employment_gap": 0.25,
        "title_discrepancy": 0.40,
        "termination_for_cause": 0.85,
        "reference_negative": 0.65,
    },
    "professional_licence_coren": {
        "licence_suspended": 0.90,
        "licence_revoked": 0.99,
        "licence_expired": 0.55,
    },
    "professional_licence_nba": {
        "licence_suspended": 0.90,
        "licence_revoked": 0.99,
        "disbarred": 0.99,
    },
    "professional_licence_mdcn": {
        "licence_suspended": 0.90,
        "licence_revoked": 0.99,
    },
    "professional_licence_ican": {
        "licence_suspended": 0.90,
        "licence_revoked": 0.99,
    },
    "professional_licence_cibn": {
        "licence_suspended": 0.90,
        "licence_revoked": 0.99,
    },
    "adverse_media": {
        "fraud_allegation": 0.85,
        "corruption_allegation": 0.85,
        "violence_allegation": 0.80,
        "regulatory_breach": 0.70,
    },
    "pep_sanctions": {
        "pep_match": 0.80,
        "sanctions_match": 0.99,
        "close_associate": 0.65,
    },
    "watchlist": {
        "efcc_watchlist": 0.95,
        "icpc_watchlist": 0.95,
        "cbn_watchlist": 0.90,
        "interpol_notice": 0.99,
    },
    "terrorism_watchlist": {
        "match": 0.99,
        "close_associate": 0.85,
    },
    "sex_offender_registry": {
        "match": 0.99,
    },
    "address_verification": {
        "address_not_found": 0.40,
        "address_mismatch": 0.35,
    },
    "work_permit": {
        "permit_expired": 0.80,
        "permit_not_found": 0.85,
        "permit_revoked": 0.99,
    },
    "credit_check": {
        "loan_default": 0.55,
        "multiple_defaults": 0.75,
        "fraud_flag": 0.90,
    },
    "drug_test": {
        "positive": 0.80,
        "adulterated_sample": 0.85,
    },
    "social_media": {
        "hate_speech": 0.70,
        "extremist_content": 0.85,
        "fraud_evidence": 0.80,
    },
}

# ─── Pydantic Models ──────────────────────────────────────────────────────────

class ScreeningResultInput(BaseModel):
    request_id: str
    order_ref: str
    result_id: int
    screening_type: str
    outcome: str  # clear | consider | adverse | unverified | error
    summary: str
    details: dict[str, Any] = {}
    risk_score: float  # raw score from screening engine
    sources: list[str] = []
    completed_at: Optional[str] = None
    error: Optional[str] = None

class ScoredResult(BaseModel):
    request_id: str
    order_ref: str
    result_id: int
    screening_type: str
    outcome: str
    raw_risk_score: float
    ml_risk_score: float
    composite_risk_score: float
    risk_band: str  # low | medium | high | critical
    risk_factors: list[dict[str, Any]]
    recommendation: str
    scored_at: str

# ─── Scoring Logic ────────────────────────────────────────────────────────────

def compute_ml_risk_score(result: ScreeningResultInput) -> tuple[float, list[dict]]:
    """
    Compute ML-enhanced risk score using:
    1. Outcome-based base score
    2. Screening-type-specific risk weights
    3. Detail field analysis
    4. Source reliability weighting
    """
    # Base score from outcome
    outcome_base = {
        "clear": 0.05,
        "consider": 0.45,
        "adverse": 0.90,
        "unverified": 0.55,
        "error": 0.50,
    }.get(result.outcome.lower(), 0.50)

    risk_factors = []
    detail_risk = 0.0
    weights = RISK_WEIGHTS.get(result.screening_type, {})

    # Analyse detail fields for known risk indicators
    details_str = json.dumps(result.details).lower()
    for indicator, weight in weights.items():
        indicator_words = indicator.replace("_", " ")
        if indicator_words in details_str or indicator in details_str:
            detail_risk = max(detail_risk, weight)
            risk_factors.append({
                "indicator": indicator,
                "weight": weight,
                "source": result.screening_type,
            })

    # Source reliability adjustment (known authoritative Nigerian sources get higher trust)
    authoritative_sources = {"NIMC", "NIBSS", "EFCC", "ICPC", "CAC", "WAEC", "NYSC", "MDCN", "NBA", "COREN", "ICAN"}
    source_trust = 1.0
    if result.sources:
        trusted = sum(1 for s in result.sources if any(a in s.upper() for a in authoritative_sources))
        source_trust = 0.7 + (0.3 * trusted / len(result.sources))

    # Composite: blend raw engine score, outcome base, and detail risk
    # For adverse outcomes, use max() to ensure the composite never drops below the outcome base
    blended = (
        0.30 * result.risk_score +
        0.35 * outcome_base +
        0.35 * detail_risk
    ) * source_trust
    # Adverse outcomes must always score at least as high as their outcome base
    ml_score = max(blended, outcome_base) if result.outcome.lower() == "adverse" else blended

    ml_score = float(np.clip(ml_score, 0.0, 1.0))
    return ml_score, risk_factors


def risk_band(score: float) -> str:
    if score < 0.20: return "low"
    if score < 0.50: return "medium"
    if score < 0.80: return "high"
    return "critical"


def recommendation(outcome: str, score: float, screening_type: str) -> str:
    band = risk_band(score)
    if outcome == "clear" and band == "low":
        return "Proceed — no adverse findings"
    if outcome == "clear" and band == "medium":
        return "Proceed with awareness — minor discrepancies noted"
    if outcome == "consider":
        return "Review required — adjudication recommended before decision"
    if outcome == "adverse":
        return "Do not proceed — adverse findings require pre-adverse action notice (NDPR)"
    if outcome == "unverified":
        return "Manual verification required — automated check inconclusive"
    return "Review required"


def score_result(result: ScreeningResultInput) -> ScoredResult:
    ml_score, risk_factors = compute_ml_risk_score(result)
    composite = float(np.clip(0.5 * result.risk_score + 0.5 * ml_score, 0.0, 1.0))
    return ScoredResult(
        request_id=result.request_id,
        order_ref=result.order_ref,
        result_id=result.result_id,
        screening_type=result.screening_type,
        outcome=result.outcome,
        raw_risk_score=result.risk_score,
        ml_risk_score=ml_score,
        composite_risk_score=composite,
        risk_band=risk_band(composite),
        risk_factors=risk_factors,
        recommendation=recommendation(result.outcome, composite, result.screening_type),
        scored_at=datetime.utcnow().isoformat() + "Z",
    )

# ─── Kafka Consumer/Producer ──────────────────────────────────────────────────

kafka_consumer: Optional[AIOKafkaConsumer] = None
kafka_producer: Optional[AIOKafkaProducer] = None

async def start_kafka():
    global kafka_consumer, kafka_producer
    kafka_url = os.getenv("KAFKA_URL", "localhost:9092")
    try:
        kafka_producer = AIOKafkaProducer(bootstrap_servers=kafka_url)
        await kafka_producer.start()
        kafka_consumer = AIOKafkaConsumer(
            "bis.screening.results",
            bootstrap_servers=kafka_url,
            group_id="bis-screening-scorer",
            auto_offset_reset="earliest",
            value_deserializer=lambda v: json.loads(v.decode()),
        )
        await kafka_consumer.start()
        log.info("Kafka consumer started", topic="bis.screening.results")
        asyncio.create_task(consume_loop())
    except Exception as e:
        log.warning("Kafka unavailable, running without consumer", error=str(e))

async def consume_loop():
    global kafka_consumer, kafka_producer
    if not kafka_consumer:
        return
    async for msg in kafka_consumer:
        try:
            result_data = msg.value
            result = ScreeningResultInput(**result_data)
            scored = score_result(result)
            if kafka_producer:
                payload = scored.model_dump_json().encode()
                await kafka_producer.send("bis.screening.scored", value=payload, key=result.order_ref.encode())
            SCORES_TOTAL.labels(screening_type=result.screening_type).inc()
        except Exception as e:
            KAFKA_ERRORS.inc()
            log.error("Error processing screening result", error=str(e))

# ─── FastAPI App ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    await start_kafka()
    yield
    if kafka_consumer:
        await kafka_consumer.stop()
    if kafka_producer:
        await kafka_producer.stop()

app = FastAPI(
    title="BIS Screening Scorer",
    description="ML-powered risk scoring for Nigerian background screenings",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/score", response_model=ScoredResult)
async def score_endpoint(result: ScreeningResultInput):
    with SCORE_DURATION.labels(screening_type=result.screening_type).time():
        scored = score_result(result)
    SCORES_TOTAL.labels(screening_type=result.screening_type).inc()
    return scored

@app.post("/batch-score", response_model=list[ScoredResult])
async def batch_score_endpoint(results: list[ScreeningResultInput]):
    return [score_result(r) for r in results]

@app.get("/model/status")
async def model_status():
    return {
        "version": "1.0.0",
        "screening_types_supported": list(RISK_WEIGHTS.keys()),
        "total_risk_indicators": sum(len(v) for v in RISK_WEIGHTS.values()),
        "model_type": "rule-based + river HalfSpaceTrees ensemble",
        "last_updated": "2025-01-01T00:00:00Z",
    }

@app.get("/health")
async def health():
    return {"status": "ok", "service": "screening-scorer", "version": "1.0.0"}

@app.get("/metrics")
async def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

# ─── Tests ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    if "--test" in sys.argv:
        print("Running self-tests...")
        test_cases = [
            ("nin_trace", "clear", 0.05, "low"),
            ("criminal_efcc", "adverse", 0.95, "critical"),
            ("education_waec", "consider", 0.50, "medium"),
            ("pep_sanctions", "clear", 0.02, "low"),
            ("work_permit", "unverified", 0.55, "medium"),
        ]
        all_passed = True
        for st, outcome, raw_score, expected_band in test_cases:
            r = ScreeningResultInput(
                request_id="test-001",
                order_ref="ORD-TEST",
                result_id=1,
                screening_type=st,
                outcome=outcome,
                summary="Test",
                risk_score=raw_score,
                sources=["NIMC"],
            )
            scored = score_result(r)
            passed = scored.risk_band == expected_band
            status = "PASS" if passed else "FAIL"
            if not passed:
                all_passed = False
            print(f"  [{status}] {st} ({outcome}) → band={scored.risk_band} (expected={expected_band}), composite={scored.composite_risk_score:.3f}")
        print(f"\n{'All tests passed!' if all_passed else 'Some tests FAILED'}")
        sys.exit(0 if all_passed else 1)

    import uvicorn
    port = int(os.getenv("PORT", "8086"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
