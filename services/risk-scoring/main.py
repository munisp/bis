"""
BIS Risk Scoring Service
========================
Python microservice for:
  1. ML-enhanced transaction risk scoring (rule-based + heuristic ensemble)
  2. Regulatory report generation (CTR, STR, goAML XML)
  3. Entity risk profiling (customer, counterparty, PEP/sanctions)

Port: 8086 (configurable via PORT env var)
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from xml.etree.ElementTree import Element, SubElement, tostring
from xml.dom import minidom

from flask import Flask, request, jsonify

app = Flask(__name__)

# ─── Constants ────────────────────────────────────────────────────────────────

HIGH_RISK_COUNTRIES = {
    "AF", "BY", "CF", "CG", "CU", "ER", "IR", "KP", "LY", "ML",
    "MM", "NI", "RU", "SO", "SS", "SY", "VE", "YE", "ZW",
}

FATF_GREY_LIST = {
    "BJ", "BF", "CM", "CD", "HT", "JM", "ML", "MZ", "NG",
    "PH", "SN", "TZ", "TJ", "VN", "YE",
}

HIGH_RISK_SECTORS = {
    "casino", "gambling", "cryptocurrency", "money_service_business",
    "real_estate", "precious_metals", "arms_dealer", "offshore_banking",
    "shell_company", "hawala",
}

CTR_THRESHOLDS = {
    "NGN": 5_000_000,
    "USD": 10_000,
    "EUR": 10_000,
    "GBP": 10_000,
    "GHS": 50_000,
    "KES": 1_000_000,
    "ZAR": 100_000,
    "XOF": 6_550_000,
}

STRUCTURING_BUFFER = 0.05  # 5% below CTR threshold = structuring indicator


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

    @classmethod
    def from_score(cls, score: float) -> "RiskLevel":
        if score < 25:
            return cls.LOW
        elif score < 50:
            return cls.MEDIUM
        elif score < 75:
            return cls.HIGH
        else:
            return cls.CRITICAL


@dataclass
class RuleHit:
    rule_id: str
    rule_name: str
    score_contribution: float
    description: str


@dataclass
class TransactionRiskResult:
    transaction_ref: str
    risk_score: float
    risk_level: str
    flags: list[str]
    blocked: bool
    requires_ctr: bool
    requires_str: bool
    rule_hits: list[dict]
    scored_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class EntityRiskProfile:
    entity_id: str
    entity_name: str
    entity_type: str  # individual | corporate | financial_institution
    risk_score: float
    risk_level: str
    pep_match: bool
    sanctions_match: bool
    adverse_media: bool
    high_risk_country: bool
    high_risk_sector: bool
    flags: list[str]
    profiled_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ─── Transaction Risk Scoring ─────────────────────────────────────────────────

def score_transaction(data: dict) -> TransactionRiskResult:
    """
    Ensemble rule-based + heuristic AML scoring.
    Returns a score 0-100 with detailed rule hits.
    """
    score = 0.0
    flags: list[str] = []
    rule_hits: list[RuleHit] = []

    amount = float(data.get("amount", 0))
    currency = data.get("currency", "USD").upper()
    orig_country = data.get("originator_country", "").upper()
    bene_country = data.get("beneficiary_country", "").upper()
    tx_type = data.get("transaction_type", "")
    narration = data.get("narration", "") or ""
    is_cash = bool(data.get("is_cash", False))
    sector = data.get("originator_sector", "").lower()
    velocity_24h = int(data.get("velocity_24h_count", 0))
    velocity_amount_24h = float(data.get("velocity_24h_amount", 0))

    # Rule 1: High-risk originator country
    if orig_country in HIGH_RISK_COUNTRIES:
        contrib = 35.0
        score += contrib
        flags.append("high_risk_originator_country")
        rule_hits.append(RuleHit("AML-001", "High-Risk Originator Country", contrib,
                                 f"Originator country {orig_country} on FATF/OFAC list"))

    # Rule 2: High-risk beneficiary country
    if bene_country in HIGH_RISK_COUNTRIES:
        contrib = 35.0
        score += contrib
        flags.append("high_risk_beneficiary_country")
        rule_hits.append(RuleHit("AML-002", "High-Risk Beneficiary Country", contrib,
                                 f"Beneficiary country {bene_country} on FATF/OFAC list"))

    # Rule 3: FATF grey list
    if orig_country in FATF_GREY_LIST or bene_country in FATF_GREY_LIST:
        contrib = 10.0
        score += contrib
        flags.append("fatf_grey_list_country")
        rule_hits.append(RuleHit("AML-003", "FATF Grey List Country", contrib,
                                 "Transaction involves FATF grey-listed jurisdiction"))

    # Rule 4: Potential structuring
    threshold = CTR_THRESHOLDS.get(currency, 10_000)
    lower_bound = threshold * (1 - STRUCTURING_BUFFER)
    if lower_bound <= amount < threshold:
        contrib = 45.0
        score += contrib
        flags.append("potential_structuring")
        rule_hits.append(RuleHit("AML-004", "Potential Structuring / Smurfing", contrib,
                                 f"Amount {amount:.2f} {currency} is in structuring range "
                                 f"({lower_bound:.2f}–{threshold:.2f})"))

    # Rule 5: CTR required
    requires_ctr = is_cash and amount >= threshold
    if requires_ctr:
        contrib = 20.0
        score += contrib
        flags.append("ctr_required")
        rule_hits.append(RuleHit("AML-005", "CTR Required (Large Cash)", contrib,
                                 f"Cash transaction {amount:.2f} {currency} >= CTR threshold {threshold}"))

    # Rule 6: High-risk sector
    if sector in HIGH_RISK_SECTORS:
        contrib = 25.0
        score += contrib
        flags.append("high_risk_sector")
        rule_hits.append(RuleHit("AML-006", "High-Risk Business Sector", contrib,
                                 f"Originator sector '{sector}' is high-risk for ML/TF"))

    # Rule 7: Suspicious narration keywords
    suspicious_kw = [
        "shell", "offshore", "nominee", "bearer", "crypto", "bitcoin",
        "hawala", "smurfing", "layering", "placement", "integration",
        "black market", "untaxed", "undeclared",
    ]
    found_kw = [kw for kw in suspicious_kw if kw in narration.lower()]
    if found_kw:
        contrib = 30.0
        score += contrib
        flags.append("suspicious_narration")
        rule_hits.append(RuleHit("AML-007", "Suspicious Narration Keywords", contrib,
                                 f"Keywords found: {', '.join(found_kw)}"))

    # Rule 8: High transaction velocity (>10 transactions in 24h)
    if velocity_24h > 10:
        contrib = min(velocity_24h * 2.0, 30.0)
        score += contrib
        flags.append("high_velocity")
        rule_hits.append(RuleHit("AML-008", "High Transaction Velocity", contrib,
                                 f"{velocity_24h} transactions in 24 hours (threshold: 10)"))

    # Rule 9: Round number large transfer
    if amount >= 100_000 and amount % 10_000 == 0:
        contrib = 10.0
        score += contrib
        flags.append("round_number_large_transfer")
        rule_hits.append(RuleHit("AML-009", "Round Number Large Transfer", contrib,
                                 f"Transfer {amount:.2f} is a round number >= 100,000 (layering indicator)"))

    # Rule 10: Cross-border wire
    if orig_country != bene_country and tx_type in ("wire_transfer", "swift_mt103", "swift_mt202"):
        contrib = 5.0
        score += contrib
        flags.append("cross_border_wire")
        rule_hits.append(RuleHit("AML-010", "Cross-Border Wire Transfer", contrib,
                                 "Cross-border wire — verify purpose code and beneficial ownership"))

    # Rule 11: Velocity amount spike (>5x daily average)
    if velocity_amount_24h > 0 and amount > 0:
        avg = velocity_amount_24h / max(velocity_24h, 1)
        if amount > avg * 5 and amount > 50_000:
            contrib = 20.0
            score += contrib
            flags.append("velocity_amount_spike")
            rule_hits.append(RuleHit("AML-011", "Velocity Amount Spike", contrib,
                                     f"Transaction {amount:.2f} is >5x 24h average {avg:.2f}"))

    # Cap at 100
    score = min(score, 100.0)
    risk_level = RiskLevel.from_score(score)
    blocked = score >= 100 or "sanctioned_bic" in flags

    requires_str = score >= 50 or any(f in flags for f in [
        "high_risk_originator_country", "high_risk_beneficiary_country",
        "potential_structuring", "suspicious_narration",
    ])

    return TransactionRiskResult(
        transaction_ref=data.get("transaction_ref", str(uuid.uuid4())),
        risk_score=round(score, 2),
        risk_level=risk_level.value,
        flags=flags,
        blocked=blocked,
        requires_ctr=requires_ctr,
        requires_str=requires_str,
        rule_hits=[asdict(rh) for rh in rule_hits],
    )


# ─── Entity Risk Profiling ────────────────────────────────────────────────────

def profile_entity(data: dict) -> EntityRiskProfile:
    score = 0.0
    flags: list[str] = []

    country = data.get("country", "").upper()
    sector = data.get("sector", "").lower()
    is_pep = bool(data.get("is_pep", False))
    is_sanctioned = bool(data.get("is_sanctioned", False))
    adverse_media = bool(data.get("adverse_media", False))
    entity_type = data.get("entity_type", "individual")

    if is_pep:
        score += 40
        flags.append("pep")
    if is_sanctioned:
        score += 100  # Auto-block
        flags.append("sanctioned")
    if adverse_media:
        score += 25
        flags.append("adverse_media")
    if country in HIGH_RISK_COUNTRIES:
        score += 30
        flags.append("high_risk_country")
    if country in FATF_GREY_LIST:
        score += 10
        flags.append("fatf_grey_list")
    if sector in HIGH_RISK_SECTORS:
        score += 20
        flags.append("high_risk_sector")
    if entity_type == "shell_company":
        score += 35
        flags.append("shell_company")

    score = min(score, 100.0)

    return EntityRiskProfile(
        entity_id=data.get("entity_id", str(uuid.uuid4())),
        entity_name=data.get("entity_name", "Unknown"),
        entity_type=entity_type,
        risk_score=round(score, 2),
        risk_level=RiskLevel.from_score(score).value,
        pep_match=is_pep,
        sanctions_match=is_sanctioned,
        adverse_media=adverse_media,
        high_risk_country=country in HIGH_RISK_COUNTRIES,
        high_risk_sector=sector in HIGH_RISK_SECTORS,
        flags=flags,
    )


# ─── Regulatory Report Generation ─────────────────────────────────────────────

def generate_ctr(data: dict) -> dict:
    """Generate a Currency Transaction Report (CTR) per NFIU guidelines."""
    report_id = f"CTR-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}"
    return {
        "report_id": report_id,
        "report_type": "CTR",
        "filing_institution": data.get("institution_name", "BIS Financial Intelligence"),
        "filing_institution_bic": data.get("institution_bic", "BISNGLA1XXX"),
        "transaction_date": data.get("transaction_date", datetime.now(timezone.utc).date().isoformat()),
        "transaction_ref": data.get("transaction_ref"),
        "amount": data.get("amount"),
        "currency": data.get("currency"),
        "transaction_type": data.get("transaction_type"),
        "account_number": data.get("account_number"),
        "customer_name": data.get("customer_name"),
        "customer_id": data.get("customer_id"),
        "customer_dob": data.get("customer_dob"),
        "customer_address": data.get("customer_address"),
        "customer_id_type": data.get("customer_id_type", "NIN"),
        "customer_id_number": data.get("customer_id_number"),
        "branch_code": data.get("branch_code"),
        "teller_id": data.get("teller_id"),
        "narrative": data.get("narrative", "Cash transaction above CTR threshold"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "draft",
        "submission_deadline": _add_days(datetime.now(timezone.utc), 3).isoformat(),
    }


def generate_str(data: dict) -> dict:
    """Generate a Suspicious Transaction Report (STR) per NFIU/GIABA guidelines."""
    report_id = f"STR-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}"
    return {
        "report_id": report_id,
        "report_type": "STR",
        "filing_institution": data.get("institution_name", "BIS Financial Intelligence"),
        "filing_institution_bic": data.get("institution_bic", "BISNGLA1XXX"),
        "report_date": datetime.now(timezone.utc).date().isoformat(),
        "transaction_ref": data.get("transaction_ref"),
        "amount": data.get("amount"),
        "currency": data.get("currency"),
        "suspicion_type": data.get("suspicion_type", "money_laundering"),
        "suspicion_indicators": data.get("suspicion_indicators", []),
        "subject_name": data.get("subject_name"),
        "subject_account": data.get("subject_account"),
        "subject_country": data.get("subject_country"),
        "counterparty_name": data.get("counterparty_name"),
        "counterparty_account": data.get("counterparty_account"),
        "counterparty_country": data.get("counterparty_country"),
        "narrative": data.get("narrative", "Transaction flagged by AML monitoring system"),
        "risk_score": data.get("risk_score"),
        "aml_flags": data.get("aml_flags", []),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "draft",
        "submission_deadline": _add_days(datetime.now(timezone.utc), 5).isoformat(),
    }


def generate_goaml_xml(data: dict) -> str:
    """
    Generate goAML-compliant XML for UNODC Financial Intelligence Unit submission.
    Follows goAML 4.0 schema.
    """
    root = Element("Report")
    root.set("xmlns", "http://www.unodc.org/goaml/en")
    root.set("version", "4.0")

    # Report header
    hdr = SubElement(root, "Header")
    SubElement(hdr, "ReportId").text = data.get("report_id", f"GOAML-{uuid.uuid4().hex[:12].upper()}")
    SubElement(hdr, "ReportType").text = data.get("report_type", "STR")
    SubElement(hdr, "ReportDate").text = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    SubElement(hdr, "Currency").text = data.get("currency", "NGN")
    SubElement(hdr, "FilingInstitution").text = data.get("institution_name", "BIS Financial Intelligence")
    SubElement(hdr, "FilingInstitutionBIC").text = data.get("institution_bic", "BISNGLA1XXX")

    # Transaction
    tx = SubElement(root, "Transaction")
    SubElement(tx, "TransactionRef").text = data.get("transaction_ref", "")
    SubElement(tx, "TransactionDate").text = data.get("transaction_date", datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    SubElement(tx, "Amount").text = str(data.get("amount", 0))
    SubElement(tx, "Currency").text = data.get("currency", "NGN")
    SubElement(tx, "TransactionType").text = data.get("transaction_type", "wire_transfer")

    # Originator
    orig = SubElement(tx, "Originator")
    SubElement(orig, "Name").text = data.get("originator_name", "")
    SubElement(orig, "Account").text = data.get("originator_account", "")
    SubElement(orig, "Country").text = data.get("originator_country", "NG")
    SubElement(orig, "BIC").text = data.get("originator_bic", "")

    # Beneficiary
    bene = SubElement(tx, "Beneficiary")
    SubElement(bene, "Name").text = data.get("beneficiary_name", "")
    SubElement(bene, "Account").text = data.get("beneficiary_account", "")
    SubElement(bene, "Country").text = data.get("beneficiary_country", "")
    SubElement(bene, "BIC").text = data.get("beneficiary_bic", "")

    # Suspicion
    susp = SubElement(root, "Suspicion")
    SubElement(susp, "SuspicionType").text = data.get("suspicion_type", "money_laundering")
    SubElement(susp, "Narrative").text = data.get("narrative", "")
    indicators = SubElement(susp, "Indicators")
    for indicator in data.get("suspicion_indicators", []):
        SubElement(indicators, "Indicator").text = indicator

    # Risk assessment
    risk = SubElement(root, "RiskAssessment")
    SubElement(risk, "RiskScore").text = str(data.get("risk_score", 0))
    SubElement(risk, "RiskLevel").text = data.get("risk_level", "medium")
    flags_el = SubElement(risk, "Flags")
    for flag in data.get("aml_flags", []):
        SubElement(flags_el, "Flag").text = flag

    # Pretty-print
    xml_str = tostring(root, encoding="unicode")
    dom = minidom.parseString(xml_str)
    return dom.toprettyxml(indent="  ")


def _add_days(dt: datetime, days: int) -> datetime:
    from datetime import timedelta
    return dt + timedelta(days=days)


# ─── HTTP Endpoints ───────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({
        "status": "ok",
        "service": "bis-risk-scoring",
        "version": "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


@app.route("/score/transaction", methods=["POST"])
def api_score_transaction():
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body required"}), 400
    result = score_transaction(data)
    return jsonify(asdict(result))


@app.route("/score/entity", methods=["POST"])
def api_score_entity():
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body required"}), 400
    result = profile_entity(data)
    return jsonify(asdict(result))


@app.route("/report/ctr", methods=["POST"])
def api_generate_ctr():
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body required"}), 400
    report = generate_ctr(data)
    return jsonify(report)


@app.route("/report/str", methods=["POST"])
def api_generate_str():
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body required"}), 400
    report = generate_str(data)
    return jsonify(report)


@app.route("/report/goaml-xml", methods=["POST"])
def api_generate_goaml_xml():
    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "Request body required"}), 400
    xml_output = generate_goaml_xml(data)
    return app.response_class(
        response=xml_output,
        status=200,
        mimetype="application/xml",
    )


@app.route("/report/batch-str", methods=["POST"])
def api_batch_str():
    """Generate STRs for multiple transactions in one call."""
    data = request.get_json(force=True)
    transactions = data.get("transactions", [])
    if not transactions:
        return jsonify({"error": "transactions array required"}), 400
    reports = [generate_str(tx) for tx in transactions]
    return jsonify({
        "count": len(reports),
        "reports": reports,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8086))
    debug = os.environ.get("DEBUG", "false").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug)
