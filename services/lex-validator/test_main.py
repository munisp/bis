"""Tests for lex-validator microservice."""
import json
import pytest
from main import (
    normalize_name, levenshtein, name_similarity, soundex,
    validate_nin, validate_phone, validate_gps_in_state,
    check_duplicates, validate_submission,
    _heuristic_narrative_score, DuplicateCheckResult,
)


# ─── Unit: name utilities ──────────────────────────────────────────────────────

def test_normalize_name_strips_accents():
    assert normalize_name("Ọlúwafẹmi") == "oluwafemi"

def test_normalize_name_collapses_whitespace():
    assert normalize_name("  John   Doe  ") == "john doe"

def test_levenshtein_identical():
    assert levenshtein("abc", "abc") == 0

def test_levenshtein_one_insert():
    assert levenshtein("abc", "abcd") == 1

def test_levenshtein_substitution():
    assert levenshtein("kitten", "sitten") == 1

def test_name_similarity_identical():
    assert name_similarity("Emeka Obi", "Emeka Obi") == 1.0

def test_name_similarity_close():
    sim = name_similarity("Emeka Obi", "Emeka Oby")
    assert sim > 0.8

def test_name_similarity_different():
    sim = name_similarity("John Smith", "Ngozi Adeyemi")
    assert sim < 0.5

def test_soundex_basic():
    assert soundex("Robert") == soundex("Rupert")  # both R163

def test_soundex_different():
    assert soundex("Smith") != soundex("Jones")


# ─── Unit: field validators ───────────────────────────────────────────────────

def test_validate_nin_valid():
    assert validate_nin("12345678901") is True

def test_validate_nin_invalid_length():
    assert validate_nin("1234567890") is False

def test_validate_nin_non_numeric():
    assert validate_nin("1234567890A") is False

def test_validate_nin_none():
    assert validate_nin(None) is True  # optional field

def test_validate_phone_valid_0():
    assert validate_phone("08012345678") is True

def test_validate_phone_valid_plus234():
    assert validate_phone("+2348012345678") is True

def test_validate_phone_invalid():
    assert validate_phone("1234") is False

def test_validate_phone_none():
    assert validate_phone(None) is True


# ─── Unit: GPS plausibility ───────────────────────────────────────────────────

def test_gps_lagos_in_bounds():
    ok, detail = validate_gps_in_state(6.5244, 3.3792, "LA")
    assert ok, detail

def test_gps_lagos_out_of_bounds():
    ok, detail = validate_gps_in_state(12.0, 8.0, "LA")  # Kano coords
    assert not ok

def test_gps_none_skipped():
    ok, detail = validate_gps_in_state(None, None, "LA")
    assert ok

def test_gps_unknown_state():
    ok, detail = validate_gps_in_state(6.5, 3.3, "XX")
    assert ok  # unknown state → skip check


# ─── Unit: deduplication ─────────────────────────────────────────────────────

RECENT = [
    {"ref": "LEX-001", "subjectNin": "12345678901", "subjectPhone": "08011111111", "subjectName": "Emeka Obi"},
    {"ref": "LEX-002", "subjectNin": None, "subjectPhone": "08022222222", "subjectName": "Ngozi Eze"},
]

def test_dedup_nin_exact_match():
    results = check_duplicates("12345678901", None, None, RECENT)
    assert len(results) == 1
    assert results[0].match_type == "nin"
    assert results[0].matched_ref == "LEX-001"

def test_dedup_phone_exact_match():
    results = check_duplicates(None, "08022222222", None, RECENT)
    assert len(results) == 1
    assert results[0].match_type == "phone"
    assert results[0].matched_ref == "LEX-002"

def test_dedup_name_fuzzy_match():
    results = check_duplicates(None, None, "Emeka Oby", RECENT)
    assert len(results) >= 1
    assert results[0].match_type == "name"

def test_dedup_no_match():
    results = check_duplicates("99999999999", "09099999999", "Completely Different", RECENT)
    assert len(results) == 0

def test_dedup_empty_recent():
    results = check_duplicates("12345678901", "08011111111", "Emeka Obi", [])
    assert len(results) == 0


# ─── Unit: heuristic narrative scoring ───────────────────────────────────────

def test_heuristic_empty_narrative():
    assert _heuristic_narrative_score("") == 0

def test_heuristic_short_narrative():
    score = _heuristic_narrative_score("Suspect arrested.")
    assert score < 40

def test_heuristic_rich_narrative():
    narrative = (
        "On 15 March 2025, at approximately 14:30 hours, officers from Lagos Island Division "
        "arrested one Emeka Obi (M, 35) at the junction of Broad Street and Marina Road, Lagos Island. "
        "The suspect was found in possession of a black Toyota Camry with plate number LAG-234-XY, "
        "which was reported stolen on 10 March 2025. The vehicle was impounded and the suspect was "
        "charged under Section 5 of the Robbery and Firearms Act."
    )
    score = _heuristic_narrative_score(narrative)
    assert score >= 60


# ─── Integration: full validation pipeline ───────────────────────────────────

VALID_PAYLOAD = {
    "submitterId": "OFF-001",
    "agencyCode": "NPF-LA-HQ-001",
    "incidentType": "arrest",
    "incidentState": "LA",
    "subjectName": "Emeka Obi",
    "subjectNin": "12345678901",
    "subjectPhone": "08012345678",
    "gpsLat": 6.5244,
    "gpsLng": 3.3792,
    "narrative": (
        "On 15 March 2025, officers arrested Emeka Obi at Marina Road Lagos Island "
        "in possession of a stolen vehicle plate LAG-234-XY. Suspect charged under Section 5."
    ),
}

def test_validate_valid_submission():
    result = validate_submission(VALID_PAYLOAD)
    assert result.overall_score >= 50
    assert result.passed

def test_validate_missing_required_fields():
    payload = {"submitterId": "OFF-001"}
    result = validate_submission(payload)
    assert not result.passed
    assert result.recommendation == "reject"
    assert any("Missing" in f for f in result.flags)

def test_validate_invalid_nin():
    payload = {**VALID_PAYLOAD, "subjectNin": "123"}
    result = validate_submission(payload)
    assert any("NIN" in f for f in result.flags)

def test_validate_gps_out_of_state():
    payload = {**VALID_PAYLOAD, "gpsLat": 12.0, "gpsLng": 8.0}  # Kano coords for Lagos submission
    result = validate_submission(payload)
    assert any("GPS" in f or "outside" in f for f in result.flags)

def test_validate_with_duplicate():
    recent = [{"ref": "LEX-001", "subjectNin": "12345678901", "subjectPhone": None, "subjectName": "Emeka Obi"}]
    result = validate_submission(VALID_PAYLOAD, recent_submissions=recent)
    assert any("duplicate" in f.lower() for f in result.flags)

def test_validate_returns_all_checks():
    result = validate_submission(VALID_PAYLOAD)
    check_names = {c.name for c in result.checks}
    assert "required_fields" in check_names
    assert "nin_format" in check_names
    assert "phone_format" in check_names
    assert "gps_plausibility" in check_names
    assert "narrative_quality" in check_names
    assert "deduplication" in check_names
