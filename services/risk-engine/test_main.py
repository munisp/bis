"""
Risk Engine — Test Suite
Tests scoring functions, risk tier computation, and API endpoints.
"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

# Patch middleware clients before importing app
import sys
sys.modules.setdefault("redis", MagicMock())

from main import (
    app,
    score_identity, score_sanctions, score_pep,
    score_credit, score_adverse_media, score_behavioural,
    compute_risk_tier, build_recommendation, analyse_text,
    IdentitySignals, SanctionsSignals, PEPSignals,
    CreditSignals, AdverseMediaSignals, BehaviouralSignals,
    GATEWAY_KEY,
)

client = TestClient(app)
AUTH = {"X-BIS-Key": GATEWAY_KEY}


# ─── Unit: score_identity ─────────────────────────────────────────────────────

def test_identity_perfect_score():
    sig = IdentitySignals(
        nin_verified=True, bvn_verified=True, passport_verified=True,
        face_match_confidence=0.98, document_tampered=False,
        liveness_passed=True, address_verified=True,
    )
    score, flags = score_identity(sig)
    assert score <= 10, "Perfect identity signals should yield low risk"
    assert len(flags) == 0

def test_identity_tampered_document():
    sig = IdentitySignals(document_tampered=True, face_match_confidence=0.5)
    score, flags = score_identity(sig)
    assert score >= 50
    assert any("tampered" in f.lower() for f in flags)

def test_identity_low_face_match():
    sig = IdentitySignals(face_match_confidence=0.55, liveness_passed=False)
    score, flags = score_identity(sig)
    assert score >= 30

def test_identity_no_verifications():
    sig = IdentitySignals(
        nin_verified=False, bvn_verified=False, passport_verified=False,
        face_match_confidence=0.0, document_tampered=False,
        liveness_passed=False, address_verified=False,
    )
    score, flags = score_identity(sig)
    assert score >= 40


# ─── Unit: score_sanctions ────────────────────────────────────────────────────

def test_sanctions_clean():
    sig = SanctionsSignals(ofac_hit=False, un_hit=False, eu_hit=False, fatf_country=False)
    score, flags = score_sanctions(sig)
    assert score == 0
    assert len(flags) == 0

def test_sanctions_ofac_hit():
    sig = SanctionsSignals(ofac_hit=True)
    score, flags = score_sanctions(sig)
    assert score >= 80
    assert any("OFAC" in f for f in flags)

def test_sanctions_multiple_hits():
    sig = SanctionsSignals(ofac_hit=True, un_hit=True, eu_hit=True, fatf_country=True)
    score, flags = score_sanctions(sig)
    assert score == 100
    assert len(flags) >= 3

def test_sanctions_fatf_only():
    sig = SanctionsSignals(fatf_country=True)
    score, flags = score_sanctions(sig)
    assert score >= 30


# ─── Unit: score_pep ─────────────────────────────────────────────────────────

def test_pep_clean():
    sig = PEPSignals(is_pep=False)
    score, flags = score_pep(sig)
    assert score == 0

def test_pep_direct():
    sig = PEPSignals(is_pep=True, pep_tier=1, is_family_member=False)
    score, flags = score_pep(sig)
    assert score >= 60
    assert any("PEP" in f for f in flags)

def test_pep_family():
    sig = PEPSignals(is_pep=False, is_family_member=True)
    score, flags = score_pep(sig)
    assert score >= 20


# ─── Unit: score_credit ───────────────────────────────────────────────────────

def test_credit_excellent():
    sig = CreditSignals(credit_score=780, defaults=0, bankruptcy=False, ccj_count=0)
    score, flags = score_credit(sig)
    assert score <= 10

def test_credit_bankruptcy():
    sig = CreditSignals(bankruptcy=True, defaults=3, ccj_count=2)
    score, flags = score_credit(sig)
    assert score >= 70
    assert any("bankruptcy" in f.lower() for f in flags)

def test_credit_poor_score():
    sig = CreditSignals(credit_score=300, defaults=5)
    score, flags = score_credit(sig)
    assert score >= 40


# ─── Unit: score_adverse_media ────────────────────────────────────────────────

def test_adverse_media_clean():
    sig = AdverseMediaSignals(fraud_mentions=0, crime_mentions=0, corruption_mentions=0)
    score, flags = score_adverse_media(sig)
    assert score == 0

def test_adverse_media_high():
    sig = AdverseMediaSignals(
        fraud_mentions=5, crime_mentions=3, corruption_mentions=2,
        terrorism_mentions=1, drug_mentions=0,
    )
    score, flags = score_adverse_media(sig)
    assert score >= 60

def test_adverse_media_terrorism():
    sig = AdverseMediaSignals(terrorism_mentions=1)
    score, flags = score_adverse_media(sig)
    assert score >= 50


# ─── Unit: score_behavioural ─────────────────────────────────────────────────

def test_behavioural_clean():
    sig = BehaviouralSignals(
        unusual_transactions=False, rapid_fund_movement=False,
        shell_company_links=False, offshore_accounts=0,
    )
    score, flags = score_behavioural(sig)
    assert score == 0

def test_behavioural_shell_company():
    sig = BehaviouralSignals(shell_company_links=True, offshore_accounts=3)
    score, flags = score_behavioural(sig)
    assert score >= 50


# ─── Unit: compute_risk_tier ─────────────────────────────────────────────────

def test_risk_tier_low():
    assert compute_risk_tier(15) == "low"

def test_risk_tier_medium():
    assert compute_risk_tier(45) == "medium"

def test_risk_tier_high():
    assert compute_risk_tier(70) == "high"

def test_risk_tier_critical():
    assert compute_risk_tier(90) == "critical"


# ─── Unit: analyse_text ──────────────────────────────────────────────────────

def test_analyse_text_hit():
    count = analyse_text("John was convicted of fraud and money laundering", ["fraud", "laundering"])
    assert count >= 2

def test_analyse_text_miss():
    count = analyse_text("John is a respected businessman", ["fraud", "laundering"])
    assert count == 0


# ─── API: health endpoint ─────────────────────────────────────────────────────

def test_health_endpoint():
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"


# ─── API: score endpoint ──────────────────────────────────────────────────────

def test_score_endpoint_basic():
    payload = {
        "subject_id": "TEST-001",
        "subject_name": "Test Subject",
        "identity": {"nin_verified": True, "bvn_verified": True, "face_match_confidence": 0.95},
        "sanctions": {"ofac_hit": False, "un_hit": False},
        "pep": {"is_pep": False},
        "credit": {"credit_score": 700},
        "adverse_media": {"fraud_mentions": 0},
        "behavioural": {"unusual_transactions": False},
    }
    resp = client.post("/score", json=payload, headers=AUTH)
    assert resp.status_code == 200
    data = resp.json()
    assert "score" in data
    assert "tier" in data
    assert 0 <= data["score"] <= 100
    assert data["tier"] in ["low", "medium", "high", "critical"]

def test_score_endpoint_high_risk():
    payload = {
        "subject_id": "TEST-002",
        "subject_name": "High Risk Subject",
        "sanctions": {"ofac_hit": True, "un_hit": True},
        "pep": {"is_pep": True, "pep_tier": 1},
        "adverse_media": {"fraud_mentions": 5, "corruption_mentions": 3},
    }
    resp = client.post("/score", json=payload, headers=AUTH)
    assert resp.status_code == 200
    data = resp.json()
    assert data["score"] >= 70
    assert data["tier"] in ["high", "critical"]

def test_score_endpoint_unauthorized():
    payload = {"subject_id": "TEST-003"}
    resp = client.post("/score", json=payload, headers={"X-BIS-Key": "wrong-key"})
    assert resp.status_code in [401, 403, 422]


# ─── build_recommendation ────────────────────────────────────────────────────

def test_recommendation_critical():
    rec = build_recommendation("critical", ["OFAC sanctions hit", "PEP tier 1"])
    assert len(rec) > 10
    assert any(word in rec.lower() for word in ["reject", "block", "prohibit", "decline", "critical"])

def test_recommendation_low():
    rec = build_recommendation("low", [])
    assert len(rec) > 5
