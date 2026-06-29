"""
criminal_corporate_scoring.py — Extended risk scoring signals for BIS Risk Engine
==================================================================================
Adds four new scoring domains to the existing risk engine:

1. CriminalRecordSignals  — criminal history from Nigerian law enforcement agencies
2. CorporateCheckSignals  — corporate registry, tax, and director/UBO checks
3. FieldVisitSignals      — field visit confirmation and GPS verification
4. ThinFileSignals        — data completeness penalty for thin-file subjects

These modules are imported by main.py and wired into the WEIGHTS dict and
score_subject() endpoint via the extended RiskScoreRequestV2 model.

Scoring philosophy:
  - Criminal records are the highest-weight new signal (0.20 of composite)
  - Corporate checks add a moderate signal (0.10)
  - Field visit confirmation is a trust boost (reduces score by up to 10 pts)
  - Thin-file penalty adds uncertainty (increases score by up to 15 pts)

The combined weight rebalancing preserves the 1.0 total by reducing the
existing weights proportionally when new signals are present.
"""

from __future__ import annotations

import math
from typing import Optional
from pydantic import BaseModel, Field


# ─── Criminal Record Signals ──────────────────────────────────────────────────

class CriminalRecordSignals(BaseModel):
    """Signals derived from Nigerian law enforcement criminal record checks."""

    # Record counts by verdict
    conviction_count: int = Field(default=0, ge=0, description="Number of convictions")
    acquittal_count: int = Field(default=0, ge=0, description="Number of acquittals")
    pending_count: int = Field(default=0, ge=0, description="Pending charges")
    nolle_prosequi_count: int = Field(default=0, ge=0, description="Nolle prosequi entries")

    # Offence categories (booleans for presence)
    has_violent_offence: bool = False
    has_financial_offence: bool = False
    has_drug_offence: bool = False
    has_cybercrime_offence: bool = False
    has_terrorism_offence: bool = False
    has_corruption_offence: bool = False
    has_sexual_offence: bool = False

    # Warrant status
    outstanding_warrant: bool = False
    warrant_agency: Optional[str] = None  # NPF, EFCC, ICPC, etc.

    # Agency coverage
    npf_checked: bool = False
    efcc_checked: bool = False
    icpc_checked: bool = False
    ndlea_checked: bool = False

    # Confidence
    record_confidence: float = Field(default=0.8, ge=0.0, le=1.0)


def score_criminal_records(sig: CriminalRecordSignals) -> tuple[float, list[str]]:
    """
    Score criminal record signals. Returns (raw_score 0-100, flags).

    Scoring logic:
    - Outstanding warrant: +40 (critical — always escalates)
    - Terrorism/sexual conviction: +35
    - Violent/corruption conviction: +25
    - Financial/drug/cybercrime conviction: +20
    - Pending charges: +10 each (max +20)
    - Acquittals and nolle prosequi: neutral (no penalty)
    - Low agency coverage: +5 uncertainty penalty
    """
    flags: list[str] = []
    score = 0.0

    # Outstanding warrant — highest severity
    if sig.outstanding_warrant:
        score += 40.0
        agency = sig.warrant_agency or "unknown agency"
        flags.append(f"outstanding_warrant:{agency}")

    # Terrorism and sexual offences with conviction
    if sig.has_terrorism_offence and sig.conviction_count > 0:
        score += 35.0
        flags.append("terrorism_conviction")
    if sig.has_sexual_offence and sig.conviction_count > 0:
        score += 35.0
        flags.append("sexual_offence_conviction")

    # Violent and corruption offences
    if sig.has_violent_offence and sig.conviction_count > 0:
        score += 25.0
        flags.append("violent_offence_conviction")
    if sig.has_corruption_offence and sig.conviction_count > 0:
        score += 25.0
        flags.append("corruption_conviction")

    # Financial, drug, cybercrime offences
    if sig.has_financial_offence and sig.conviction_count > 0:
        score += 20.0
        flags.append("financial_offence_conviction")
    if sig.has_drug_offence and sig.conviction_count > 0:
        score += 20.0
        flags.append("drug_offence_conviction")
    if sig.has_cybercrime_offence and sig.conviction_count > 0:
        score += 20.0
        flags.append("cybercrime_conviction")

    # Pending charges (uncertainty)
    pending_penalty = min(sig.pending_count * 10.0, 20.0)
    if pending_penalty > 0:
        score += pending_penalty
        flags.append(f"pending_charges:{sig.pending_count}")

    # Low agency coverage penalty (if fewer than 2 agencies checked)
    agencies_checked = sum([sig.npf_checked, sig.efcc_checked, sig.icpc_checked, sig.ndlea_checked])
    if agencies_checked < 2:
        score += 5.0
        flags.append("low_agency_coverage")

    # Apply confidence discount — low confidence reduces the score impact
    score *= sig.record_confidence

    return min(score, 100.0), flags


# ─── Corporate Check Signals ──────────────────────────────────────────────────

class CorporateCheckSignals(BaseModel):
    """Signals derived from Nigerian corporate registry and tax checks."""

    # CAC (Corporate Affairs Commission)
    cac_registered: bool = False
    cac_status: str = Field(default="unknown", description="active, inactive, struck_off, dissolved")
    cac_age_years: float = Field(default=0.0, ge=0.0, description="Years since registration")
    director_count: int = Field(default=0, ge=0)
    has_foreign_directors: bool = False
    shell_company_indicators: int = Field(default=0, ge=0, description="Number of shell company red flags")

    # FIRS (Federal Inland Revenue Service)
    firs_tax_cleared: Optional[bool] = None  # None = not checked
    outstanding_tax_amount: float = Field(default=0.0, ge=0.0)

    # Directors/UBO screening
    director_sanctions_hit: bool = False
    director_pep_hit: bool = False
    ubo_identified: bool = True  # False = opaque ownership

    # Sanctions
    corporate_sanctions_hit: bool = False
    sanctions_list: Optional[str] = None

    # Confidence
    check_confidence: float = Field(default=0.8, ge=0.0, le=1.0)


def score_corporate_check(sig: CorporateCheckSignals) -> tuple[float, list[str]]:
    """
    Score corporate check signals. Returns (raw_score 0-100, flags).

    Scoring logic:
    - Corporate sanctions hit: +40
    - Director sanctions hit: +30
    - Not CAC registered: +25
    - Struck off / dissolved: +20
    - FIRS not cleared: +15
    - Shell company indicators: +10 each (max +30)
    - Opaque UBO: +15
    - Very new company (< 1 year): +10
    - Director PEP hit: +10
    - Foreign directors: +5
    """
    flags: list[str] = []
    score = 0.0

    # Sanctions
    if sig.corporate_sanctions_hit:
        score += 40.0
        flags.append(f"corporate_sanctions:{sig.sanctions_list or 'unknown'}")

    if sig.director_sanctions_hit:
        score += 30.0
        flags.append("director_sanctions_hit")

    # CAC registration
    if not sig.cac_registered:
        score += 25.0
        flags.append("not_cac_registered")
    elif sig.cac_status in ("struck_off", "dissolved"):
        score += 20.0
        flags.append(f"cac_status:{sig.cac_status}")

    # FIRS tax clearance
    if sig.firs_tax_cleared is False:
        score += 15.0
        flags.append("firs_not_cleared")
        if sig.outstanding_tax_amount > 0:
            flags.append(f"outstanding_tax:{sig.outstanding_tax_amount:.0f}")

    # Shell company indicators
    shell_penalty = min(sig.shell_company_indicators * 10.0, 30.0)
    if shell_penalty > 0:
        score += shell_penalty
        flags.append(f"shell_indicators:{sig.shell_company_indicators}")

    # Opaque ownership
    if not sig.ubo_identified:
        score += 15.0
        flags.append("opaque_ubo")

    # Very new company
    if sig.cac_registered and sig.cac_age_years < 1.0:
        score += 10.0
        flags.append("new_company")

    # PEP director
    if sig.director_pep_hit:
        score += 10.0
        flags.append("director_pep_hit")

    # Foreign directors
    if sig.has_foreign_directors:
        score += 5.0
        flags.append("foreign_directors")

    score *= sig.check_confidence

    return min(score, 100.0), flags


# ─── Field Visit Signals ──────────────────────────────────────────────────────

class FieldVisitSignals(BaseModel):
    """Signals derived from field visit GPS check-in and findings submission."""

    # Visit completion
    visit_completed: bool = False
    address_confirmed: bool = False
    subject_present: bool = False

    # GPS verification
    gps_verified: bool = False
    gps_accuracy_metres: float = Field(default=100.0, ge=0.0)

    # Duration
    duration_minutes: int = Field(default=0, ge=0)
    minimum_duration_met: bool = True  # False if < 5 minutes

    # Outcome
    outcome: str = Field(default="not_visited", description="confirmed, unconfirmed, inconclusive, not_visited")

    # Photo evidence
    photos_uploaded: int = Field(default=0, ge=0)


def score_field_visit(sig: FieldVisitSignals) -> tuple[float, list[str]]:
    """
    Score field visit signals. Returns (raw_score 0-100, flags).

    Field visit is a TRUST BOOST — confirmed visits reduce risk.
    The score returned here is a REDUCTION applied to the composite.

    Scoring logic (negative = risk reduction):
    - Confirmed + subject present + GPS verified: -10 (max trust boost)
    - Confirmed + address confirmed: -7
    - Visit completed but inconclusive: -3
    - Address not confirmed: +5 (uncertainty)
    - Suspiciously short visit: +8
    - Not visited at all: 0 (neutral — no data)
    """
    flags: list[str] = []
    score = 0.0  # 0 = neutral

    if not sig.visit_completed:
        return 0.0, []  # No field visit — neutral

    if sig.outcome == "confirmed":
        if sig.subject_present and sig.gps_verified:
            score -= 10.0
            flags.append("field_visit_confirmed_gps")
        elif sig.address_confirmed:
            score -= 7.0
            flags.append("field_visit_address_confirmed")
        else:
            score -= 3.0
            flags.append("field_visit_confirmed")

        if sig.photos_uploaded >= 2:
            score -= 2.0  # Extra trust for photo evidence
            flags.append("field_visit_photos")

    elif sig.outcome == "unconfirmed":
        score += 5.0
        flags.append("field_visit_unconfirmed")

    elif sig.outcome == "inconclusive":
        score -= 2.0
        flags.append("field_visit_inconclusive")

    # Suspiciously short visit
    if sig.visit_completed and not sig.minimum_duration_met:
        score += 8.0
        flags.append("field_visit_short_duration")

    return score, flags


# ─── Thin-File Signals ────────────────────────────────────────────────────────

class ThinFileSignals(BaseModel):
    """Signals derived from data completeness analysis for thin-file subjects."""

    # Data source coverage (0.0 – 1.0 per source)
    nin_data_available: bool = False
    bvn_data_available: bool = False
    cac_data_available: bool = False
    credit_data_available: bool = False
    court_data_available: bool = False
    address_data_available: bool = False

    # Overall completeness score (0.0 – 1.0)
    completeness_score: float = Field(default=0.5, ge=0.0, le=1.0)

    # Explicitly flagged as thin-file by analyst
    analyst_flagged: bool = False

    # Alternative evidence collected
    alternative_evidence_count: int = Field(default=0, ge=0)


def score_thin_file(sig: ThinFileSignals) -> tuple[float, list[str]]:
    """
    Score thin-file signals. Returns (raw_score 0-100, flags).

    Thin-file adds an UNCERTAINTY PENALTY — insufficient data increases risk.

    Scoring logic:
    - Completeness < 0.3: +15 (very thin)
    - Completeness < 0.5: +10
    - Completeness < 0.7: +5
    - Analyst explicitly flagged: +5 additional
    - Each alternative evidence item: -2 (max -6)
    """
    flags: list[str] = []
    score = 0.0

    # Completeness-based penalty
    if sig.completeness_score < 0.3:
        score += 15.0
        flags.append("thin_file_critical")
    elif sig.completeness_score < 0.5:
        score += 10.0
        flags.append("thin_file_moderate")
    elif sig.completeness_score < 0.7:
        score += 5.0
        flags.append("thin_file_mild")

    # Analyst flag adds extra uncertainty
    if sig.analyst_flagged:
        score += 5.0
        flags.append("analyst_flagged_thin_file")

    # Alternative evidence reduces uncertainty
    evidence_reduction = min(sig.alternative_evidence_count * 2.0, 6.0)
    score -= evidence_reduction
    if evidence_reduction > 0:
        flags.append(f"alternative_evidence:{sig.alternative_evidence_count}")

    return max(score, 0.0), flags


# ─── Extended Request/Response Models ────────────────────────────────────────

class RiskScoreRequestV2(BaseModel):
    """
    Extended risk score request that includes the four new signal domains.
    Backwards-compatible with RiskScoreRequest — all new fields are optional.
    """
    subject_id: str
    subject_type: str = "individual"
    country: str = "NG"
    tier: str = "standard"

    # Existing signal domains (imported from main.py at runtime)
    # These are typed as dict here to avoid circular imports
    identity: dict = Field(default_factory=dict)
    sanctions: dict = Field(default_factory=dict)
    pep: dict = Field(default_factory=dict)
    credit: dict = Field(default_factory=dict)
    adverse_media: dict = Field(default_factory=dict)
    behavioural: dict = Field(default_factory=dict)

    # New signal domains
    criminal_records: Optional[CriminalRecordSignals] = None
    corporate_check: Optional[CorporateCheckSignals] = None
    field_visit: Optional[FieldVisitSignals] = None
    thin_file: Optional[ThinFileSignals] = None


# ─── Weight Rebalancing ───────────────────────────────────────────────────────

# Base weights (must sum to 1.0)
BASE_WEIGHTS = {
    "identity":       0.15,
    "sanctions":      0.35,
    "pep":            0.20,
    "credit":         0.08,
    "adverse_media":  0.15,
    "behavioural":    0.07,
}

# New domain weights (added when signals are present)
NEW_DOMAIN_WEIGHTS = {
    "criminal_records": 0.20,
    "corporate_check":  0.10,
    "field_visit":      0.05,  # trust boost — can reduce composite
    "thin_file":        0.05,  # uncertainty penalty
}


def compute_extended_weights(has_criminal: bool, has_corporate: bool,
                              has_field_visit: bool, has_thin_file: bool) -> dict[str, float]:
    """
    Rebalance weights when new signal domains are present.
    Reduces existing weights proportionally to make room for new domains.
    Total always sums to 1.0.
    """
    new_weight_total = (
        (NEW_DOMAIN_WEIGHTS["criminal_records"] if has_criminal else 0.0) +
        (NEW_DOMAIN_WEIGHTS["corporate_check"] if has_corporate else 0.0) +
        (NEW_DOMAIN_WEIGHTS["field_visit"] if has_field_visit else 0.0) +
        (NEW_DOMAIN_WEIGHTS["thin_file"] if has_thin_file else 0.0)
    )

    if new_weight_total == 0.0:
        return BASE_WEIGHTS.copy()

    # Scale existing weights down proportionally
    scale = (1.0 - new_weight_total) / sum(BASE_WEIGHTS.values())
    weights = {k: round(v * scale, 4) for k, v in BASE_WEIGHTS.items()}

    if has_criminal:
        weights["criminal_records"] = NEW_DOMAIN_WEIGHTS["criminal_records"]
    if has_corporate:
        weights["corporate_check"] = NEW_DOMAIN_WEIGHTS["corporate_check"]
    if has_field_visit:
        weights["field_visit"] = NEW_DOMAIN_WEIGHTS["field_visit"]
    if has_thin_file:
        weights["thin_file"] = NEW_DOMAIN_WEIGHTS["thin_file"]

    return weights


# ─── Composite Score Extension ────────────────────────────────────────────────

def apply_extended_signals(
    base_composite: float,
    criminal: Optional[CriminalRecordSignals],
    corporate: Optional[CorporateCheckSignals],
    field_visit: Optional[FieldVisitSignals],
    thin_file: Optional[ThinFileSignals],
) -> tuple[float, list[str], list[dict]]:
    """
    Apply extended signal scores to the base composite score.
    Returns (adjusted_composite, additional_flags, additional_factors).
    """
    additional_flags: list[str] = []
    additional_factors: list[dict] = []
    adjustment = 0.0

    weights = compute_extended_weights(
        has_criminal=criminal is not None,
        has_corporate=corporate is not None,
        has_field_visit=field_visit is not None,
        has_thin_file=thin_file is not None,
    )

    if criminal is not None:
        raw, flags = score_criminal_records(criminal)
        w = weights.get("criminal_records", 0.0)
        weighted = raw * w
        adjustment += weighted
        additional_flags.extend(flags)
        additional_factors.append({
            "category": "criminal_records",
            "label": "Criminal Records",
            "weight": w,
            "raw_score": round(raw, 2),
            "weighted_score": round(weighted, 2),
            "flag": len(flags) > 0,
        })

    if corporate is not None:
        raw, flags = score_corporate_check(corporate)
        w = weights.get("corporate_check", 0.0)
        weighted = raw * w
        adjustment += weighted
        additional_flags.extend(flags)
        additional_factors.append({
            "category": "corporate_check",
            "label": "Corporate Check",
            "weight": w,
            "raw_score": round(raw, 2),
            "weighted_score": round(weighted, 2),
            "flag": len(flags) > 0,
        })

    if field_visit is not None:
        raw, flags = score_field_visit(field_visit)
        w = weights.get("field_visit", 0.0)
        # Field visit can reduce the composite (trust boost)
        weighted = raw * w
        adjustment += weighted
        additional_flags.extend(flags)
        additional_factors.append({
            "category": "field_visit",
            "label": "Field Visit Verification",
            "weight": w,
            "raw_score": round(raw, 2),
            "weighted_score": round(weighted, 2),
            "flag": any("unconfirmed" in f or "short" in f for f in flags),
        })

    if thin_file is not None:
        raw, flags = score_thin_file(thin_file)
        w = weights.get("thin_file", 0.0)
        weighted = raw * w
        adjustment += weighted
        additional_flags.extend(flags)
        additional_factors.append({
            "category": "thin_file",
            "label": "Data Completeness",
            "weight": w,
            "raw_score": round(raw, 2),
            "weighted_score": round(weighted, 2),
            "flag": len(flags) > 0,
        })

    adjusted = min(max(base_composite + adjustment, 0.0), 100.0)
    return adjusted, additional_flags, additional_factors
