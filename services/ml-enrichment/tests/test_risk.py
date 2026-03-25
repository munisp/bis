"""tests/test_risk.py — Unit tests for the ML risk scoring module."""
import pytest
from app.routers.risk import compute_risk_score, risk_level, RiskInput


def make_input(**kwargs) -> RiskInput:
    defaults = dict(
        subject_name="Test Subject",
        subject_type="individual",
        identity_verified=False,
        sanctions_hits=0,
        pep_status=False,
        adverse_media_count=0,
        adverse_media_severity="none",
        network_exposure="low",
        regulatory_violations=0,
        jurisdiction="NG",
    )
    defaults.update(kwargs)
    return RiskInput(**defaults)


def test_low_risk_verified_clean():
    inp = make_input(identity_verified=True, sanctions_hits=0, adverse_media_severity="none")
    score, factors = compute_risk_score(inp)
    assert score < 25, f"Expected low risk, got {score}"
    assert risk_level(score) == "low"


def test_critical_risk_sanctions_pep():
    inp = make_input(
        identity_verified=False,
        sanctions_hits=3,
        pep_status=True,
        adverse_media_severity="critical",
        adverse_media_count=10,
        network_exposure="high",
        regulatory_violations=5,
    )
    score, factors = compute_risk_score(inp)
    assert score >= 75, f"Expected critical risk, got {score}"
    assert risk_level(score) == "critical"


def test_medium_risk_partial_flags():
    inp = make_input(
        identity_verified=True,
        sanctions_hits=1,
        adverse_media_severity="medium",
        adverse_media_count=3,
        network_exposure="medium",
    )
    score, factors = compute_risk_score(inp)
    assert 25 <= score < 75, f"Expected medium/high risk, got {score}"


def test_factors_count():
    inp = make_input()
    score, factors = compute_risk_score(inp)
    assert len(factors) == 5, "Expected 5 risk factors"


def test_score_bounds():
    """Score must always be between 0 and 100."""
    for sanctions in range(0, 6):
        for pep in [True, False]:
            inp = make_input(sanctions_hits=sanctions, pep_status=pep)
            score, _ = compute_risk_score(inp)
            assert 0 <= score <= 100, f"Score out of bounds: {score}"


def test_risk_level_boundaries():
    assert risk_level(0) == "low"
    assert risk_level(24) == "low"
    assert risk_level(25) == "medium"
    assert risk_level(49) == "medium"
    assert risk_level(50) == "high"
    assert risk_level(74) == "high"
    assert risk_level(75) == "critical"
    assert risk_level(100) == "critical"
