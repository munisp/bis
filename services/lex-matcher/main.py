"""
lex-matcher — Python microservice for LEX submission deduplication and name matching.

Capabilities:
  - NIN/BVN cross-reference against existing submissions
  - Name similarity using Levenshtein + phonetic (Soundex/Metaphone) algorithms
  - Duplicate detection across submissions and cases
  - REST API consumed by BIS tRPC procedures

Endpoints:
  POST /match          — find similar submissions for a new submission
  POST /deduplicate    — check if a submission is a duplicate
  POST /cross-ref      — cross-reference NIN/BVN against existing records
  GET  /health         — health check
  GET  /metrics        — Prometheus metrics
"""

import os
import time
import logging
import hashlib
from typing import Optional
from contextlib import asynccontextmanager

import structlog
import httpx
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from rapidfuzz import fuzz, process
import jellyfish
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response

# ── Logging ──────────────────────────────────────────────────────────────────
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        structlog.processors.JSONRenderer(),
    ]
)
log = structlog.get_logger()

# ── Config ───────────────────────────────────────────────────────────────────
BIS_API_URL = os.getenv("BIS_API_URL", "http://bff:4000")
BIS_API_KEY = os.getenv("BIS_API_KEY", "lex-matcher-internal-key")
JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret")
PORT = int(os.getenv("PORT", "8090"))
MATCH_THRESHOLD = float(os.getenv("MATCH_THRESHOLD", "0.75"))

# ── Prometheus metrics ────────────────────────────────────────────────────────
match_requests = Counter("lex_matcher_requests_total", "Total match requests", ["endpoint"])
match_duration = Histogram("lex_matcher_duration_seconds", "Match request duration", ["endpoint"])
duplicates_found = Counter("lex_matcher_duplicates_found_total", "Duplicate submissions found")

# ── Security ─────────────────────────────────────────────────────────────────
bearer_scheme = HTTPBearer(auto_error=False)

def verify_api_key(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)) -> bool:
    if not credentials:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    if credentials.credentials != BIS_API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API key")
    return True

# ── Models ───────────────────────────────────────────────────────────────────
class SubmissionRecord(BaseModel):
    id: int
    referenceNumber: str
    subjectName: str
    subjectNin: Optional[str] = None
    subjectBvn: Optional[str] = None
    subjectPhone: Optional[str] = None
    narrative: Optional[str] = None
    incidentType: Optional[str] = None
    state: Optional[str] = None

class MatchRequest(BaseModel):
    candidate: SubmissionRecord
    corpus: list[SubmissionRecord]
    threshold: float = Field(default=MATCH_THRESHOLD, ge=0.0, le=1.0)
    max_results: int = Field(default=10, ge=1, le=50)

class MatchResult(BaseModel):
    submission_id: int
    reference_number: str
    subject_name: str
    name_score: float
    nin_match: bool
    bvn_match: bool
    phone_match: bool
    combined_score: float
    match_reasons: list[str]

class MatchResponse(BaseModel):
    matches: list[MatchResult]
    is_duplicate: bool
    highest_score: float
    processing_time_ms: float

class CrossRefRequest(BaseModel):
    nin: Optional[str] = None
    bvn: Optional[str] = None
    phone: Optional[str] = None
    corpus: list[SubmissionRecord]

class CrossRefResult(BaseModel):
    hits: list[dict]
    nin_hits: int
    bvn_hits: int
    phone_hits: int

class DeduplicateRequest(BaseModel):
    candidate: SubmissionRecord
    corpus: list[SubmissionRecord]
    strict: bool = False  # if True, require exact NIN/BVN match; if False, use fuzzy name

class DeduplicateResponse(BaseModel):
    is_duplicate: bool
    duplicate_of: Optional[str] = None  # referenceNumber of the duplicate
    confidence: float
    reasons: list[str]

# ── Name similarity helpers ───────────────────────────────────────────────────
def normalize_name(name: str) -> str:
    """Normalize a name for comparison: lowercase, strip extra spaces."""
    return " ".join(name.lower().strip().split())

def name_similarity(a: str, b: str) -> float:
    """
    Compute composite name similarity score using:
    - Token sort ratio (handles word order differences)
    - Partial ratio (handles abbreviated names)
    - Soundex phonetic match (handles phonetic variants)
    - Metaphone phonetic match
    Returns a score between 0.0 and 1.0.
    """
    a_norm = normalize_name(a)
    b_norm = normalize_name(b)

    if not a_norm or not b_norm:
        return 0.0

    # Exact match
    if a_norm == b_norm:
        return 1.0

    # Fuzzy string matching
    token_sort = fuzz.token_sort_ratio(a_norm, b_norm) / 100.0
    partial = fuzz.partial_ratio(a_norm, b_norm) / 100.0
    wratio = fuzz.WRatio(a_norm, b_norm) / 100.0

    # Phonetic matching (per word)
    a_words = a_norm.split()
    b_words = b_norm.split()

    soundex_score = 0.0
    metaphone_score = 0.0
    if a_words and b_words:
        # Compare first and last name phonetics
        a_soundex = [jellyfish.soundex(w) for w in a_words]
        b_soundex = [jellyfish.soundex(w) for w in b_words]
        soundex_matches = sum(1 for s in a_soundex if s in b_soundex)
        soundex_score = soundex_matches / max(len(a_soundex), len(b_soundex))

        a_metaphone = [jellyfish.metaphone(w) for w in a_words]
        b_metaphone = [jellyfish.metaphone(w) for w in b_words]
        metaphone_matches = sum(1 for m in a_metaphone if m in b_metaphone)
        metaphone_score = metaphone_matches / max(len(a_metaphone), len(b_metaphone))

    # Weighted composite score
    composite = (
        token_sort * 0.35 +
        partial * 0.20 +
        wratio * 0.25 +
        soundex_score * 0.10 +
        metaphone_score * 0.10
    )
    return round(min(composite, 1.0), 4)

def hash_id_field(value: Optional[str]) -> Optional[str]:
    """Hash a sensitive ID field (NIN/BVN) for comparison without storing plaintext."""
    if not value:
        return None
    return hashlib.sha256(value.strip().encode()).hexdigest()

def normalize_phone(phone: Optional[str]) -> Optional[str]:
    """Normalize Nigerian phone numbers to E.164 format."""
    if not phone:
        return None
    digits = "".join(c for c in phone if c.isdigit())
    if digits.startswith("234") and len(digits) == 13:
        return f"+{digits}"
    if digits.startswith("0") and len(digits) == 11:
        return f"+234{digits[1:]}"
    if len(digits) == 10:
        return f"+234{digits}"
    return phone.strip()

# ── App lifecycle ─────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("lex-matcher starting", port=PORT, threshold=MATCH_THRESHOLD)
    yield
    log.info("lex-matcher shutting down")

app = FastAPI(
    title="BIS LEX Matcher",
    description="Name similarity and deduplication service for LEX submissions",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4000", "http://bff:4000"],
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "lex-matcher", "version": "1.0.0"}

@app.get("/metrics")
async def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

@app.post("/match", response_model=MatchResponse, dependencies=[Depends(verify_api_key)])
async def match_submission(req: MatchRequest):
    """
    Find submissions in the corpus that are similar to the candidate.
    Uses name similarity, NIN/BVN cross-reference, and phone matching.
    """
    start = time.perf_counter()
    match_requests.labels(endpoint="match").inc()

    results: list[MatchResult] = []

    for record in req.corpus:
        if record.id == req.candidate.id:
            continue

        reasons: list[str] = []
        name_score = name_similarity(req.candidate.subjectName, record.subjectName)

        # Exact ID matches (hash comparison)
        nin_match = bool(
            req.candidate.subjectNin and record.subjectNin and
            hash_id_field(req.candidate.subjectNin) == hash_id_field(record.subjectNin)
        )
        bvn_match = bool(
            req.candidate.subjectBvn and record.subjectBvn and
            hash_id_field(req.candidate.subjectBvn) == hash_id_field(record.subjectBvn)
        )
        phone_match = bool(
            req.candidate.subjectPhone and record.subjectPhone and
            normalize_phone(req.candidate.subjectPhone) == normalize_phone(record.subjectPhone)
        )

        if nin_match:
            reasons.append("NIN match")
        if bvn_match:
            reasons.append("BVN match")
        if phone_match:
            reasons.append("Phone match")
        if name_score >= 0.85:
            reasons.append(f"High name similarity ({name_score:.0%})")
        elif name_score >= req.threshold:
            reasons.append(f"Name similarity ({name_score:.0%})")

        # Combined score: ID matches are strong signals
        id_boost = 0.0
        if nin_match or bvn_match:
            id_boost = 0.30
        elif phone_match:
            id_boost = 0.15

        combined = min(name_score + id_boost, 1.0)

        if combined >= req.threshold or nin_match or bvn_match:
            results.append(MatchResult(
                submission_id=record.id,
                reference_number=record.referenceNumber,
                subject_name=record.subjectName,
                name_score=name_score,
                nin_match=nin_match,
                bvn_match=bvn_match,
                phone_match=phone_match,
                combined_score=combined,
                match_reasons=reasons,
            ))

    # Sort by combined score descending
    results.sort(key=lambda r: r.combined_score, reverse=True)
    results = results[:req.max_results]

    highest = results[0].combined_score if results else 0.0
    is_dup = highest >= 0.90 or any(r.nin_match or r.bvn_match for r in results)

    elapsed = (time.perf_counter() - start) * 1000
    match_duration.labels(endpoint="match").observe(elapsed / 1000)

    return MatchResponse(
        matches=results,
        is_duplicate=is_dup,
        highest_score=highest,
        processing_time_ms=round(elapsed, 2),
    )

@app.post("/deduplicate", response_model=DeduplicateResponse, dependencies=[Depends(verify_api_key)])
async def deduplicate(req: DeduplicateRequest):
    """
    Determine if a candidate submission is a duplicate of any in the corpus.
    Strict mode requires exact NIN/BVN match.
    """
    match_requests.labels(endpoint="deduplicate").inc()

    for record in req.corpus:
        if record.id == req.candidate.id:
            continue

        reasons: list[str] = []
        confidence = 0.0

        # Strict mode: exact ID match required
        if req.strict:
            nin_match = bool(
                req.candidate.subjectNin and record.subjectNin and
                hash_id_field(req.candidate.subjectNin) == hash_id_field(record.subjectNin)
            )
            bvn_match = bool(
                req.candidate.subjectBvn and record.subjectBvn and
                hash_id_field(req.candidate.subjectBvn) == hash_id_field(record.subjectBvn)
            )
            if nin_match:
                reasons.append("Exact NIN match")
                confidence = 1.0
            elif bvn_match:
                reasons.append("Exact BVN match")
                confidence = 1.0
        else:
            # Fuzzy mode: name + ID signals
            name_score = name_similarity(req.candidate.subjectName, record.subjectName)
            nin_match = bool(
                req.candidate.subjectNin and record.subjectNin and
                hash_id_field(req.candidate.subjectNin) == hash_id_field(record.subjectNin)
            )
            bvn_match = bool(
                req.candidate.subjectBvn and record.subjectBvn and
                hash_id_field(req.candidate.subjectBvn) == hash_id_field(record.subjectBvn)
            )
            phone_match = bool(
                req.candidate.subjectPhone and record.subjectPhone and
                normalize_phone(req.candidate.subjectPhone) == normalize_phone(record.subjectPhone)
            )

            id_boost = 0.30 if (nin_match or bvn_match) else (0.15 if phone_match else 0.0)
            confidence = min(name_score + id_boost, 1.0)

            if nin_match:
                reasons.append("NIN match")
            if bvn_match:
                reasons.append("BVN match")
            if phone_match:
                reasons.append("Phone match")
            if name_score >= 0.85:
                reasons.append(f"High name similarity ({name_score:.0%})")

        if confidence >= 0.90:
            duplicates_found.inc()
            return DeduplicateResponse(
                is_duplicate=True,
                duplicate_of=record.referenceNumber,
                confidence=confidence,
                reasons=reasons,
            )

    return DeduplicateResponse(
        is_duplicate=False,
        duplicate_of=None,
        confidence=0.0,
        reasons=[],
    )

@app.post("/cross-ref", response_model=CrossRefResult, dependencies=[Depends(verify_api_key)])
async def cross_reference(req: CrossRefRequest):
    """
    Cross-reference NIN/BVN/phone against the corpus.
    Returns all records that share any of these identifiers.
    """
    match_requests.labels(endpoint="cross-ref").inc()

    hits: list[dict] = []
    nin_hits = 0
    bvn_hits = 0
    phone_hits = 0

    nin_hash = hash_id_field(req.nin)
    bvn_hash = hash_id_field(req.bvn)
    phone_norm = normalize_phone(req.phone)

    for record in req.corpus:
        matched_fields: list[str] = []

        if nin_hash and record.subjectNin and hash_id_field(record.subjectNin) == nin_hash:
            matched_fields.append("NIN")
            nin_hits += 1
        if bvn_hash and record.subjectBvn and hash_id_field(record.subjectBvn) == bvn_hash:
            matched_fields.append("BVN")
            bvn_hits += 1
        if phone_norm and record.subjectPhone and normalize_phone(record.subjectPhone) == phone_norm:
            matched_fields.append("Phone")
            phone_hits += 1

        if matched_fields:
            hits.append({
                "id": record.id,
                "referenceNumber": record.referenceNumber,
                "subjectName": record.subjectName,
                "matchedFields": matched_fields,
                "state": record.state,
                "incidentType": record.incidentType,
            })

    return CrossRefResult(hits=hits, nin_hits=nin_hits, bvn_hits=bvn_hits, phone_hits=phone_hits)

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, log_level="info")
