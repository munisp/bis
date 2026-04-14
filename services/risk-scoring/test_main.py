"""
Tests for BIS Risk Scoring Service
"""
import pytest
from main import (
    score_transaction,
    profile_entity,
    generate_ctr,
    generate_str,
    generate_goaml_xml,
    RiskLevel,
)


# ─── Transaction Scoring Tests ────────────────────────────────────────────────

def base_tx():
    return {
        "transaction_ref": "TXN-TEST-001",
        "amount": 1000.0,
        "currency": "USD",
        "originator_name": "Test Corp",
        "originator_country": "NG",
        "beneficiary_name": "Test Beneficiary",
        "beneficiary_country": "GB",
        "transaction_type": "wire_transfer",
    }


def test_low_risk_transaction():
    result = score_transaction(base_tx())
    assert result.risk_score < 25
    assert result.risk_level == RiskLevel.LOW.value
    assert not result.blocked
    assert not result.requires_ctr


def test_high_risk_originator_country():
    tx = base_tx()
    tx["originator_country"] = "KP"  # North Korea
    result = score_transaction(tx)
    assert result.risk_score >= 35
    assert "high_risk_originator_country" in result.flags


def test_high_risk_beneficiary_country():
    tx = base_tx()
    tx["beneficiary_country"] = "IR"  # Iran
    result = score_transaction(tx)
    assert result.risk_score >= 35
    assert "high_risk_beneficiary_country" in result.flags


def test_both_high_risk_countries():
    tx = base_tx()
    tx["originator_country"] = "KP"
    tx["beneficiary_country"] = "SY"
    result = score_transaction(tx)
    assert result.risk_score >= 70
    assert result.risk_level in (RiskLevel.HIGH.value, RiskLevel.CRITICAL.value)


def test_structuring_usd():
    tx = base_tx()
    tx["amount"] = 9_600.0  # Just below $10k CTR threshold
    tx["originator_country"] = "NG"
    tx["beneficiary_country"] = "NG"
    result = score_transaction(tx)
    assert "potential_structuring" in result.flags
    assert result.risk_score >= 45


def test_structuring_ngn():
    tx = base_tx()
    tx["amount"] = 4_800_000.0  # Just below NGN 5M threshold
    tx["currency"] = "NGN"
    tx["originator_country"] = "NG"
    tx["beneficiary_country"] = "NG"
    result = score_transaction(tx)
    assert "potential_structuring" in result.flags


def test_ctr_required_cash():
    tx = base_tx()
    tx["amount"] = 15_000.0
    tx["currency"] = "USD"
    tx["is_cash"] = True
    tx["originator_country"] = "NG"
    tx["beneficiary_country"] = "NG"
    result = score_transaction(tx)
    assert result.requires_ctr
    assert "ctr_required" in result.flags


def test_no_ctr_for_non_cash():
    tx = base_tx()
    tx["amount"] = 15_000.0
    tx["currency"] = "USD"
    tx["is_cash"] = False
    result = score_transaction(tx)
    assert not result.requires_ctr


def test_high_risk_sector():
    tx = base_tx()
    tx["originator_sector"] = "casino"
    result = score_transaction(tx)
    assert "high_risk_sector" in result.flags
    assert result.risk_score >= 25


def test_suspicious_narration():
    tx = base_tx()
    tx["narration"] = "Payment for offshore shell company services"
    result = score_transaction(tx)
    assert "suspicious_narration" in result.flags
    assert result.risk_score >= 30


def test_high_velocity():
    tx = base_tx()
    tx["velocity_24h_count"] = 15
    result = score_transaction(tx)
    assert "high_velocity" in result.flags


def test_round_number_large_transfer():
    tx = base_tx()
    tx["amount"] = 500_000.0
    tx["originator_country"] = "NG"
    tx["beneficiary_country"] = "NG"
    result = score_transaction(tx)
    assert "round_number_large_transfer" in result.flags


def test_cross_border_wire():
    tx = base_tx()
    tx["transaction_type"] = "swift_mt103"
    result = score_transaction(tx)
    assert "cross_border_wire" in result.flags


def test_score_capped_at_100():
    tx = base_tx()
    tx["originator_country"] = "KP"
    tx["beneficiary_country"] = "IR"
    tx["amount"] = 9_600.0
    tx["currency"] = "USD"
    tx["narration"] = "offshore shell bitcoin hawala"
    tx["originator_sector"] = "casino"
    tx["velocity_24h_count"] = 20
    result = score_transaction(tx)
    assert result.risk_score <= 100


def test_str_required_for_high_risk():
    tx = base_tx()
    tx["originator_country"] = "KP"
    result = score_transaction(tx)
    assert result.requires_str


def test_rule_hits_populated():
    tx = base_tx()
    tx["originator_country"] = "KP"
    result = score_transaction(tx)
    assert len(result.rule_hits) > 0
    assert all("rule_id" in rh for rh in result.rule_hits)
    assert all("score_contribution" in rh for rh in result.rule_hits)


# ─── Entity Risk Profiling Tests ──────────────────────────────────────────────

def base_entity():
    return {
        "entity_id": "ENT-001",
        "entity_name": "Test Corp",
        "entity_type": "corporate",
        "country": "NG",
        "sector": "manufacturing",
    }


def test_clean_entity():
    result = profile_entity(base_entity())
    assert result.risk_score < 25
    assert result.risk_level == RiskLevel.LOW.value
    assert not result.pep_match
    assert not result.sanctions_match


def test_pep_entity():
    entity = base_entity()
    entity["is_pep"] = True
    result = profile_entity(entity)
    assert result.pep_match
    assert result.risk_score >= 40
    assert "pep" in result.flags


def test_sanctioned_entity():
    entity = base_entity()
    entity["is_sanctioned"] = True
    result = profile_entity(entity)
    assert result.sanctions_match
    assert result.risk_score == 100
    assert "sanctioned" in result.flags


def test_adverse_media():
    entity = base_entity()
    entity["adverse_media"] = True
    result = profile_entity(entity)
    assert result.adverse_media
    assert result.risk_score >= 25
    assert "adverse_media" in result.flags


def test_high_risk_country_entity():
    entity = base_entity()
    entity["country"] = "KP"
    result = profile_entity(entity)
    assert result.high_risk_country
    assert "high_risk_country" in result.flags


def test_high_risk_sector_entity():
    entity = base_entity()
    entity["sector"] = "casino"
    result = profile_entity(entity)
    assert result.high_risk_sector
    assert "high_risk_sector" in result.flags


# ─── CTR Generation Tests ─────────────────────────────────────────────────────

def test_ctr_has_required_fields():
    data = {
        "transaction_ref": "TXN-001",
        "amount": 15000,
        "currency": "USD",
        "customer_name": "John Doe",
        "customer_id": "NIN-12345",
    }
    report = generate_ctr(data)
    assert report["report_type"] == "CTR"
    assert report["report_id"].startswith("CTR-")
    assert report["amount"] == 15000
    assert report["status"] == "draft"
    assert "submission_deadline" in report


def test_ctr_report_id_unique():
    data = {"transaction_ref": "TXN-001", "amount": 15000, "currency": "USD"}
    r1 = generate_ctr(data)
    r2 = generate_ctr(data)
    assert r1["report_id"] != r2["report_id"]


# ─── STR Generation Tests ─────────────────────────────────────────────────────

def test_str_has_required_fields():
    data = {
        "transaction_ref": "TXN-002",
        "amount": 9500,
        "currency": "USD",
        "subject_name": "Suspicious Corp",
        "suspicion_type": "money_laundering",
        "suspicion_indicators": ["structuring", "high_risk_country"],
    }
    report = generate_str(data)
    assert report["report_type"] == "STR"
    assert report["report_id"].startswith("STR-")
    assert report["suspicion_type"] == "money_laundering"
    assert "structuring" in report["suspicion_indicators"]
    assert report["status"] == "draft"


def test_str_submission_deadline():
    data = {"transaction_ref": "TXN-003", "amount": 5000, "currency": "USD"}
    report = generate_str(data)
    assert "submission_deadline" in report
    # Deadline should be 5 days from now
    from datetime import datetime, timezone, timedelta
    deadline = datetime.fromisoformat(report["submission_deadline"].replace("Z", "+00:00"))
    now = datetime.now(timezone.utc)
    diff = (deadline - now).days
    assert 4 <= diff <= 5


# ─── goAML XML Tests ──────────────────────────────────────────────────────────

def test_goaml_xml_valid():
    data = {
        "report_id": "GOAML-TEST-001",
        "report_type": "STR",
        "currency": "NGN",
        "institution_name": "BIS Financial Intelligence",
        "transaction_ref": "TXN-001",
        "amount": 9_500_000,
        "originator_name": "Suspicious Corp",
        "originator_country": "NG",
        "beneficiary_name": "Shell Co Ltd",
        "beneficiary_country": "KP",
        "suspicion_type": "money_laundering",
        "suspicion_indicators": ["structuring", "high_risk_country"],
        "narrative": "Transaction flagged by AML system",
        "risk_score": 85,
        "risk_level": "critical",
        "aml_flags": ["potential_structuring", "high_risk_beneficiary_country"],
    }
    xml_output = generate_goaml_xml(data)
    assert "<?xml" in xml_output
    assert "GOAML-TEST-001" in xml_output
    assert "STR" in xml_output
    assert "Suspicious Corp" in xml_output
    assert "money_laundering" in xml_output
    assert "structuring" in xml_output


def test_goaml_xml_contains_risk_assessment():
    data = {
        "risk_score": 75,
        "risk_level": "critical",
        "aml_flags": ["sanctioned_bic"],
    }
    xml_output = generate_goaml_xml(data)
    assert "RiskAssessment" in xml_output
    assert "75" in xml_output
    assert "sanctioned_bic" in xml_output


# ─── Risk Level Tests ─────────────────────────────────────────────────────────

def test_risk_level_boundaries():
    assert RiskLevel.from_score(0) == RiskLevel.LOW
    assert RiskLevel.from_score(24) == RiskLevel.LOW
    assert RiskLevel.from_score(25) == RiskLevel.MEDIUM
    assert RiskLevel.from_score(49) == RiskLevel.MEDIUM
    assert RiskLevel.from_score(50) == RiskLevel.HIGH
    assert RiskLevel.from_score(74) == RiskLevel.HIGH
    assert RiskLevel.from_score(75) == RiskLevel.CRITICAL
    assert RiskLevel.from_score(100) == RiskLevel.CRITICAL
