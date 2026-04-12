"""
lex-validator — Python microservice for LEX submission validation and deduplication.

Responsibilities:
  1. Structural validation (required fields, NIN format, phone format, GPS bounds)
  2. NIN/phone exact-match deduplication against recent submissions
  3. Geospatial plausibility (incident GPS must be within the agency's registered state)
  4. Name fuzzy-matching using Levenshtein + phonetic algorithms
  5. LLM-assisted narrative quality scoring (coherence, specificity, credibility)
  6. Composite validation score (0–100) with per-check breakdown

Exposes:
  POST /validate          — validate a single submission payload
  POST /deduplicate       — check for duplicate NIN/phone across recent submissions
  GET  /health            — health check

Environment variables:
  LEX_VALIDATOR_PORT      HTTP port (default: 8091)
  LEX_BIS_API_URL         BIS built-in API URL
  LEX_BIS_API_KEY         Bearer token for LLM calls
  LEX_MODEL               LLM model name (default: auto)
"""

import json
import logging
import math
import os
import re
import unicodedata
from dataclasses import dataclass, field, asdict
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Optional
from urllib.request import Request, urlopen
from urllib.error import URLError

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
log = logging.getLogger("lex-validator")

# ─── Config ───────────────────────────────────────────────────────────────────

PORT = int(os.getenv("LEX_VALIDATOR_PORT", "8091"))
BIS_API_URL = os.getenv("LEX_BIS_API_URL", "https://api.manus.im")
BIS_API_KEY = os.getenv("LEX_BIS_API_KEY", "")

# ─── Nigerian State Bounding Boxes (approximate) ─────────────────────────────
# Format: (min_lat, max_lat, min_lng, max_lng)
STATE_BOUNDS: dict[str, tuple[float, float, float, float]] = {
    "AB": (4.7, 6.0, 7.0, 8.1),    "AD": (8.0, 11.5, 11.5, 13.7),
    "AK": (4.3, 5.5, 7.3, 8.6),    "AN": (5.7, 6.6, 6.8, 7.7),
    "BA": (9.3, 12.8, 8.8, 11.5),  "BY": (4.2, 5.5, 5.8, 6.8),
    "BE": (6.2, 8.5, 7.7, 10.0),   "BO": (10.0, 13.9, 11.5, 15.1),
    "CR": (4.5, 6.9, 7.8, 9.5),    "DE": (5.0, 6.5, 5.1, 7.0),
    "EB": (5.8, 6.8, 7.8, 8.7),    "ED": (5.7, 7.2, 5.0, 6.8),
    "EK": (7.3, 8.1, 4.9, 5.9),    "EN": (6.0, 7.0, 7.0, 7.9),
    "GO": (9.5, 11.5, 10.3, 12.3), "IM": (5.0, 5.9, 6.8, 7.7),
    "JI": (11.5, 13.5, 8.5, 10.5), "KD": (9.0, 11.5, 6.8, 9.2),
    "KN": (11.0, 13.2, 7.5, 9.5),  "KT": (11.0, 13.9, 6.5, 9.2),
    "KE": (10.5, 13.0, 3.5, 6.0),  "KO": (6.5, 8.9, 5.8, 7.8),
    "KW": (7.8, 9.5, 3.5, 6.0),    "LA": (6.3, 6.8, 2.7, 4.0),
    "NA": (7.5, 9.5, 7.5, 9.5),    "NI": (8.5, 11.5, 3.5, 7.0),
    "OG": (6.5, 7.5, 2.8, 4.2),    "ON": (6.0, 7.8, 4.5, 6.2),
    "OS": (7.0, 8.0, 4.0, 5.2),    "OY": (7.0, 9.0, 2.8, 5.0),
    "PL": (8.0, 10.5, 8.3, 10.5),  "RI": (4.5, 5.8, 6.5, 8.0),
    "SO": (12.0, 14.0, 4.0, 6.5),  "TA": (7.0, 10.0, 10.5, 13.0),
    "YO": (10.0, 13.5, 10.5, 14.5),"FC": (8.3, 9.3, 6.8, 7.8),
}

# ─── Validation Result ────────────────────────────────────────────────────────

@dataclass
class CheckResult:
    name: str
    passed: bool
    score: int          # 0–100 contribution
    weight: float       # relative weight in composite
    detail: str = ""

@dataclass
class ValidationResult:
    overall_score: int
    passed: bool
    checks: list[CheckResult] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    recommendation: str = "review"  # "approve", "review", "reject"

# ─── Utility Functions ────────────────────────────────────────────────────────

def normalize_name(name: str) -> str:
    """Lowercase, strip accents, collapse whitespace."""
    name = unicodedata.normalize("NFKD", name)
    name = "".join(c for c in name if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", name.lower().strip())

def levenshtein(a: str, b: str) -> int:
    """Standard Levenshtein distance."""
    if len(a) < len(b):
        a, b = b, a
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a):
        curr = [i + 1]
        for j, cb in enumerate(b):
            curr.append(min(prev[j + 1] + 1, curr[j] + 1, prev[j] + (ca != cb)))
        prev = curr
    return prev[-1]

def name_similarity(a: str, b: str) -> float:
    """Return 0.0–1.0 similarity between two names."""
    a, b = normalize_name(a), normalize_name(b)
    if a == b:
        return 1.0
    max_len = max(len(a), len(b), 1)
    dist = levenshtein(a, b)
    return max(0.0, 1.0 - dist / max_len)

def soundex(name: str) -> str:
    """Basic Soundex implementation."""
    name = normalize_name(name).upper()
    if not name:
        return "0000"
    code_map = {
        "BFPV": "1", "CGJKQSXYZ": "2", "DT": "3",
        "L": "4", "MN": "5", "R": "6",
    }
    def code(c: str) -> str:
        for chars, digit in code_map.items():
            if c in chars:
                return digit
        return "0"
    result = [name[0]]
    prev = code(name[0])
    for c in name[1:]:
        d = code(c)
        if d != "0" and d != prev:
            result.append(d)
        prev = d
    result = "".join(result)
    return (result + "000")[:4]

def validate_nin(nin: Optional[str]) -> bool:
    """Nigerian NIN is exactly 11 digits."""
    if not nin:
        return True  # optional field
    return bool(re.match(r"^\d{11}$", nin.strip()))

def validate_phone(phone: Optional[str]) -> bool:
    """Nigerian phone: 11 digits starting with 0, or +234 prefix."""
    if not phone:
        return True
    p = re.sub(r"[\s\-\(\)]", "", phone)
    return bool(re.match(r"^(\+234|0)\d{10}$", p))

def validate_gps_in_state(lat: Optional[float], lng: Optional[float], state: str) -> tuple[bool, str]:
    """Check if GPS coordinates fall within the state's bounding box."""
    if lat is None or lng is None:
        return True, "GPS not provided (skipped)"
    bounds = STATE_BOUNDS.get(state)
    if not bounds:
        return True, f"No bounds for state {state}"
    min_lat, max_lat, min_lng, max_lng = bounds
    in_bounds = min_lat <= lat <= max_lat and min_lng <= lng <= max_lng
    if not in_bounds:
        return False, f"GPS ({lat:.4f}, {lng:.4f}) outside {state} bounds ({min_lat}–{max_lat}°N, {min_lng}–{max_lng}°E)"
    return True, f"GPS within {state} bounds"

# ─── LLM Narrative Scoring ────────────────────────────────────────────────────

def score_narrative_llm(narrative: str, incident_type: str) -> tuple[int, str]:
    """
    Call the BIS LLM API to score narrative quality.
    Returns (score 0-100, explanation).
    Falls back to heuristic scoring if LLM is unavailable.
    """
    if not BIS_API_KEY or not narrative:
        return _heuristic_narrative_score(narrative), "heuristic (LLM unavailable)"

    prompt = f"""You are a law enforcement report quality assessor. Score the following incident narrative on a scale of 0–100 based on:
- Specificity (names, dates, locations, vehicle plates, amounts)
- Coherence (logical sequence of events)
- Credibility (plausible for a {incident_type.replace('_', ' ')} incident)
- Completeness (who, what, when, where, how)

Narrative: "{narrative}"

Return JSON only: {{"score": <0-100>, "explanation": "<one sentence>"}}"""

    try:
        payload = json.dumps({
            "model": "auto",
            "messages": [
                {"role": "system", "content": "You are a law enforcement report quality assessor. Return JSON only."},
                {"role": "user", "content": prompt},
            ],
            "response_format": {"type": "json_object"},
            "max_tokens": 150,
        }).encode()

        req = Request(
            f"{BIS_API_URL}/v1/chat/completions",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {BIS_API_KEY}",
            },
        )
        with urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            content = data["choices"][0]["message"]["content"]
            result = json.loads(content)
            return int(result.get("score", 50)), result.get("explanation", "")
    except (URLError, KeyError, json.JSONDecodeError, Exception) as e:
        log.warning(f"LLM narrative scoring failed: {e}")
        return _heuristic_narrative_score(narrative), "heuristic (LLM error)"

def _heuristic_narrative_score(narrative: str) -> int:
    """Simple heuristic: length, digit presence, proper nouns."""
    if not narrative:
        return 0
    score = 0
    words = narrative.split()
    # Length bonus
    score += min(40, len(words) * 2)
    # Contains numbers (dates, amounts, plates)
    if re.search(r"\d", narrative):
        score += 15
    # Contains proper nouns (capitalised words not at sentence start)
    proper = re.findall(r"(?<!\. )[A-Z][a-z]{2,}", narrative)
    score += min(20, len(proper) * 5)
    # Contains location indicators
    if re.search(r"\b(street|road|avenue|junction|market|bridge|area|state|lga|ward)\b", narrative, re.I):
        score += 15
    # Penalise very short narratives
    if len(words) < 10:
        score = max(0, score - 30)
    return min(100, score)

# ─── Deduplication ────────────────────────────────────────────────────────────

@dataclass
class DuplicateCheckResult:
    is_duplicate: bool
    match_type: str  # "nin", "phone", "name"
    confidence: float
    matched_ref: str
    detail: str

def check_duplicates(
    subject_nin: Optional[str],
    subject_phone: Optional[str],
    subject_name: Optional[str],
    recent_submissions: list[dict],
) -> list[DuplicateCheckResult]:
    """
    Check for duplicates against a list of recent submissions.
    Each submission dict should have: ref, subjectNin, subjectPhone, subjectName.
    """
    results: list[DuplicateCheckResult] = []

    for sub in recent_submissions:
        ref = sub.get("ref", "")

        # NIN exact match
        if subject_nin and sub.get("subjectNin") and subject_nin.strip() == sub["subjectNin"].strip():
            results.append(DuplicateCheckResult(
                is_duplicate=True, match_type="nin", confidence=1.0,
                matched_ref=ref, detail=f"NIN {subject_nin} matches {ref}",
            ))
            continue

        # Phone exact match
        if subject_phone and sub.get("subjectPhone"):
            p1 = re.sub(r"[\s\-\(\)\+]", "", subject_phone)
            p2 = re.sub(r"[\s\-\(\)\+]", "", sub["subjectPhone"])
            if p1 == p2:
                results.append(DuplicateCheckResult(
                    is_duplicate=True, match_type="phone", confidence=0.95,
                    matched_ref=ref, detail=f"Phone {subject_phone} matches {ref}",
                ))
                continue

        # Name fuzzy match (Levenshtein + Soundex)
        if subject_name and sub.get("subjectName"):
            sim = name_similarity(subject_name, sub["subjectName"])
            sx1 = soundex(subject_name)
            sx2 = soundex(sub["subjectName"])
            phonetic_match = sx1 == sx2
            if sim >= 0.85 or (sim >= 0.70 and phonetic_match):
                confidence = min(0.90, sim)
                results.append(DuplicateCheckResult(
                    is_duplicate=True, match_type="name", confidence=confidence,
                    matched_ref=ref,
                    detail=f"Name similarity {sim:.0%} (soundex: {sx1}/{sx2}) with {ref}",
                ))

    return results

# ─── Main Validation Pipeline ─────────────────────────────────────────────────

def validate_submission(payload: dict, recent_submissions: list[dict] | None = None) -> ValidationResult:
    """
    Run all validation checks and return a ValidationResult.
    """
    checks: list[CheckResult] = []
    flags: list[str] = []

    # 1. Required fields
    required = ["submitterId", "agencyCode", "incidentType", "incidentState", "narrative"]
    missing = [f for f in required if not payload.get(f)]
    checks.append(CheckResult(
        name="required_fields",
        passed=len(missing) == 0,
        score=0 if missing else 100,
        weight=0.20,
        detail=f"Missing: {missing}" if missing else "All required fields present",
    ))
    if missing:
        flags.append(f"Missing required fields: {', '.join(missing)}")

    # 2. NIN format
    nin = payload.get("subjectNin")
    nin_valid = validate_nin(nin)
    checks.append(CheckResult(
        name="nin_format",
        passed=nin_valid,
        score=0 if (nin and not nin_valid) else 100,
        weight=0.10,
        detail="NIN format valid" if nin_valid else f"Invalid NIN format: {nin}",
    ))
    if not nin_valid:
        flags.append(f"Invalid NIN format: {nin}")

    # 3. Phone format
    phone = payload.get("subjectPhone")
    phone_valid = validate_phone(phone)
    checks.append(CheckResult(
        name="phone_format",
        passed=phone_valid,
        score=0 if (phone and not phone_valid) else 100,
        weight=0.05,
        detail="Phone format valid" if phone_valid else f"Invalid phone: {phone}",
    ))
    if not phone_valid:
        flags.append(f"Invalid phone format: {phone}")

    # 4. GPS plausibility
    lat = payload.get("gpsLat")
    lng = payload.get("gpsLng")
    state = payload.get("incidentState", "")
    gps_ok, gps_detail = validate_gps_in_state(lat, lng, state)
    checks.append(CheckResult(
        name="gps_plausibility",
        passed=gps_ok,
        score=0 if (lat and not gps_ok) else 100,
        weight=0.15,
        detail=gps_detail,
    ))
    if not gps_ok:
        flags.append(gps_detail)

    # 5. Narrative quality (LLM or heuristic)
    narrative = payload.get("narrative", "")
    incident_type = payload.get("incidentType", "other")
    narrative_score, narrative_detail = score_narrative_llm(narrative, incident_type)
    checks.append(CheckResult(
        name="narrative_quality",
        passed=narrative_score >= 40,
        score=narrative_score,
        weight=0.30,
        detail=f"Score {narrative_score}/100 — {narrative_detail}",
    ))
    if narrative_score < 40:
        flags.append(f"Low narrative quality score: {narrative_score}/100")

    # 6. Duplicate check
    dup_score = 100
    dup_detail = "No duplicates found"
    if recent_submissions:
        dups = check_duplicates(nin, phone, payload.get("subjectName"), recent_submissions)
        if dups:
            top = dups[0]
            dup_score = max(0, int((1 - top.confidence) * 100))
            dup_detail = top.detail
            flags.append(f"Possible duplicate ({top.match_type}): {top.matched_ref}")
    checks.append(CheckResult(
        name="deduplication",
        passed=dup_score >= 50,
        score=dup_score,
        weight=0.20,
        detail=dup_detail,
    ))

    # Composite score
    total_weight = sum(c.weight for c in checks)
    composite = int(sum(c.score * c.weight for c in checks) / total_weight)

    # Recommendation
    if composite >= 75 and not any(not c.passed for c in checks[:4]):
        recommendation = "approve"
    elif composite < 35 or (not checks[0].passed):
        recommendation = "reject"
    else:
        recommendation = "review"

    # A submission with missing required fields is never "passed" regardless of composite score
    required_check = next((c for c in checks if c.name == "required_fields"), None)
    hard_fail = required_check is not None and not required_check.passed

    return ValidationResult(
        overall_score=composite,
        passed=(composite >= 50) and not hard_fail,
        checks=checks,
        flags=flags,
        recommendation=recommendation,
    )

# ─── HTTP Handler ─────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        log.info(f"{self.address_string()} — {format % args}")

    def send_json(self, status: int, data: dict):
        body = json.dumps(data, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"service": "lex-validator", "status": "ok"})
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/validate":
            try:
                body = self.read_json()
                payload = body.get("submission", body)
                recent = body.get("recentSubmissions", [])
                result = validate_submission(payload, recent)
                self.send_json(200, {
                    "overallScore": result.overall_score,
                    "passed": result.passed,
                    "recommendation": result.recommendation,
                    "flags": result.flags,
                    "checks": [asdict(c) for c in result.checks],
                })
            except Exception as e:
                log.error(f"/validate error: {e}")
                self.send_json(500, {"error": str(e)})

        elif self.path == "/deduplicate":
            try:
                body = self.read_json()
                dups = check_duplicates(
                    body.get("subjectNin"),
                    body.get("subjectPhone"),
                    body.get("subjectName"),
                    body.get("recentSubmissions", []),
                )
                self.send_json(200, {
                    "isDuplicate": len(dups) > 0,
                    "matches": [asdict(d) for d in dups],
                })
            except Exception as e:
                log.error(f"/deduplicate error: {e}")
                self.send_json(500, {"error": str(e)})

        else:
            self.send_json(404, {"error": "not found"})

# ─── Entry Point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    log.info(f"lex-validator listening on port {PORT}")
    server.serve_forever()
