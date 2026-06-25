"""
pin_fallback.py — Biometric PIN Fallback module for BIS Biometric Engine.

Provides FastAPI router with endpoints for enrolling, verifying, revoking, and
checking the status of a PIN-based fallback when biometric capture fails.

Security design:
  - PINs are stored as Argon2id hashes in Redis (key: bis:bio:pin:{subject_ref}).
  - Enrolment requires a prior successful biometric verification (Redis flag
    bis:bio:verified:{subject_ref} must exist).
  - Verification is rate-limited: PIN_MAX_ATTEMPTS per PIN_WINDOW_S seconds.
  - After max attempts the PIN is locked for PIN_LOCK_S seconds.
  - All PIN events are published to Kafka (bis.biometric.events).

Usage (in main.py):
    from pin_fallback import pin_router, set_redis
    app.include_router(pin_router)
    # Call set_redis(_redis) after Redis is connected in lifespan.
"""

import hashlib
import hmac
import json
import logging
import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

log = logging.getLogger("biometric-engine.pin")

# ── Config ────────────────────────────────────────────────────────────────────
_PIN_KEY_PREFIX      = "bis:bio:pin:"
_PIN_ATTEMPT_PREFIX  = "bis:bio:pin:attempts:"
_PIN_LOCK_PREFIX     = "bis:bio:pin:locked:"
_BIO_VERIFIED_PREFIX = "bis:bio:verified:"
_PIN_MAX_ATTEMPTS    = int(os.getenv("PIN_MAX_ATTEMPTS", "5"))
_PIN_WINDOW_S        = int(os.getenv("PIN_WINDOW_S", "900"))   # 15 minutes
_PIN_LOCK_S          = int(os.getenv("PIN_LOCK_S", "900"))     # 15 minutes
_KAFKA_BROKERS       = os.getenv("KAFKA_BROKERS", "kafka:9092")
_KAFKA_TOPIC         = "bis.biometric.events"

# Argon2id via passlib (soft dependency — falls back to PBKDF2-HMAC-SHA256)
try:
    from passlib.hash import argon2 as _argon2  # type: ignore
    _ARGON2_AVAILABLE = True
except ImportError:
    _ARGON2_AVAILABLE = False
    log.warning("passlib[argon2] not available — PIN hashing falls back to PBKDF2-HMAC-SHA256")

# Module-level Redis handle (injected from main.py lifespan)
_redis = None


def set_redis(r) -> None:
    """Inject the shared Redis connection from main.py lifespan."""
    global _redis
    _redis = r


# ── Hash helpers ──────────────────────────────────────────────────────────────

def _hash_pin(pin: str) -> str:
    """Hash a PIN using Argon2id (preferred) or PBKDF2-HMAC-SHA256 fallback."""
    if _ARGON2_AVAILABLE:
        return _argon2.using(rounds=3, memory_cost=65536, parallelism=2).hash(pin)
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, 260_000)
    return "pbkdf2$" + salt.hex() + "$" + dk.hex()


def _verify_pin_hash(pin: str, stored: str) -> bool:
    """Constant-time PIN hash verification."""
    try:
        if stored.startswith("pbkdf2$"):
            _, salt_hex, dk_hex = stored.split("$")
            salt = bytes.fromhex(salt_hex)
            dk = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, 260_000)
            return hmac.compare_digest(dk.hex(), dk_hex)
        if _ARGON2_AVAILABLE:
            return _argon2.verify(pin, stored)
        return False
    except Exception:
        return False


# ── Redis helpers ─────────────────────────────────────────────────────────────

async def _is_pin_locked(subject_ref: str) -> bool:
    if _redis is None:
        return False
    return bool(await _redis.exists(f"{_PIN_LOCK_PREFIX}{subject_ref}"))


async def _increment_pin_attempts(subject_ref: str) -> int:
    if _redis is None:
        return 0
    key = f"{_PIN_ATTEMPT_PREFIX}{subject_ref}"
    count = await _redis.incr(key)
    await _redis.expire(key, _PIN_WINDOW_S)
    if count >= _PIN_MAX_ATTEMPTS:
        await _redis.setex(f"{_PIN_LOCK_PREFIX}{subject_ref}", _PIN_LOCK_S, "1")
    return int(count)


async def _reset_pin_attempts(subject_ref: str) -> None:
    if _redis is None:
        return
    await _redis.delete(f"{_PIN_ATTEMPT_PREFIX}{subject_ref}")
    await _redis.delete(f"{_PIN_LOCK_PREFIX}{subject_ref}")


# ── Kafka helper ──────────────────────────────────────────────────────────────

def _publish_pin_event(subject_ref: str, event_type: str, data: dict) -> None:
    """Fire-and-forget: publish PIN event to Kafka bis.biometric.events."""
    try:
        from kafka import KafkaProducer  # type: ignore
        p = KafkaProducer(
            bootstrap_servers=_KAFKA_BROKERS.split(","),
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            max_block_ms=2000,
        )
        p.send(_KAFKA_TOPIC, value={
            "event_type": event_type,
            "subject_ref": subject_ref,
            "source": "bis-biometric-engine",
            "published_at": datetime.utcnow().isoformat() + "Z",
            **data,
        })
        p.flush(timeout=2)
        p.close()
    except Exception as exc:
        log.debug(f"[PIN] Kafka publish skipped: {exc}")


# ── Pydantic models ───────────────────────────────────────────────────────────

class PINEnrolRequest(BaseModel):
    subject_ref: str = Field(..., description="Unique subject identifier")
    pin: str = Field(..., min_length=4, max_length=8, description="4–8 digit PIN")
    require_biometric_gate: bool = Field(
        True,
        description="If true, enrolment requires a prior successful biometric verification",
    )


class PINEnrolResponse(BaseModel):
    subject_ref: str
    enrolled: bool
    message: str
    enrolled_at: str


class PINVerifyRequest(BaseModel):
    subject_ref: str = Field(..., description="Unique subject identifier")
    pin: str = Field(..., min_length=4, max_length=8, description="4–8 digit PIN")
    reason: str = Field("biometric_fallback", description="Reason for PIN fallback")


class PINVerifyResponse(BaseModel):
    subject_ref: str
    verified: bool
    reason: str
    attempts_remaining: Optional[int] = None
    locked_until_s: Optional[int] = None
    verified_at: Optional[str] = None


# ── Router ────────────────────────────────────────────────────────────────────

pin_router = APIRouter(prefix="/pin", tags=["PIN Fallback"])


@pin_router.post("/enrol", response_model=PINEnrolResponse,
                 summary="Enrol a PIN for biometric fallback")
async def pin_enrol(req: PINEnrolRequest) -> PINEnrolResponse:
    """
    Enrol a PIN for use as a biometric fallback.

    By default (require_biometric_gate=true), the subject must have completed
    a successful biometric verification within the last 24 hours. This prevents
    an attacker from enrolling a PIN without first passing liveness + face match.
    """
    if _redis is None:
        raise HTTPException(status_code=503, detail="PIN enrolment unavailable: Redis not connected")

    if req.require_biometric_gate:
        bio_key = f"{_BIO_VERIFIED_PREFIX}{req.subject_ref}"
        verified = await _redis.exists(bio_key)
        if not verified:
            raise HTTPException(
                status_code=403,
                detail=(
                    "PIN enrolment requires a prior successful biometric verification. "
                    "Complete liveness + face match first."
                ),
            )

    if not req.pin.isdigit():
        raise HTTPException(status_code=400, detail="PIN must contain only digits")

    pin_hash = _hash_pin(req.pin)
    await _redis.set(f"{_PIN_KEY_PREFIX}{req.subject_ref}", pin_hash)
    await _reset_pin_attempts(req.subject_ref)

    enrolled_at = datetime.utcnow().isoformat() + "Z"
    log.info(f"[PIN] Enrolled subject_ref={req.subject_ref}")
    _publish_pin_event(req.subject_ref, "PIN_ENROLLED", {"enrolled_at": enrolled_at})

    return PINEnrolResponse(
        subject_ref=req.subject_ref,
        enrolled=True,
        message="PIN enrolled successfully",
        enrolled_at=enrolled_at,
    )


@pin_router.post("/verify", response_model=PINVerifyResponse,
                 summary="Verify a PIN as biometric fallback")
async def pin_verify(req: PINVerifyRequest) -> PINVerifyResponse:
    """
    Verify a PIN as a fallback when biometric capture is unavailable.

    Rate-limited to PIN_MAX_ATTEMPTS per PIN_WINDOW_S seconds per subject.
    After max attempts the PIN is locked for PIN_LOCK_S seconds.
    """
    if _redis is None:
        raise HTTPException(status_code=503, detail="PIN verification unavailable: Redis not connected")

    if await _is_pin_locked(req.subject_ref):
        lock_ttl = await _redis.ttl(f"{_PIN_LOCK_PREFIX}{req.subject_ref}")
        log.warning(f"[PIN] Locked subject_ref={req.subject_ref}")
        _publish_pin_event(req.subject_ref, "PIN_LOCKED_ATTEMPT", {"reason": req.reason})
        return PINVerifyResponse(
            subject_ref=req.subject_ref,
            verified=False,
            reason="pin_locked",
            locked_until_s=int(lock_ttl),
        )

    stored_hash_bytes = await _redis.get(f"{_PIN_KEY_PREFIX}{req.subject_ref}")
    if stored_hash_bytes is None:
        raise HTTPException(
            status_code=404,
            detail=f"No PIN enrolled for subject_ref={req.subject_ref!r}",
        )

    stored_hash = stored_hash_bytes.decode() if isinstance(stored_hash_bytes, bytes) else stored_hash_bytes
    match = _verify_pin_hash(req.pin, stored_hash)

    if match:
        await _reset_pin_attempts(req.subject_ref)
        verified_at = datetime.utcnow().isoformat() + "Z"
        log.info(f"[PIN] Verified subject_ref={req.subject_ref} reason={req.reason}")
        _publish_pin_event(req.subject_ref, "PIN_VERIFIED", {
            "reason": req.reason, "verified_at": verified_at,
        })
        return PINVerifyResponse(
            subject_ref=req.subject_ref,
            verified=True,
            reason="pin_match",
            verified_at=verified_at,
        )
    else:
        attempts = await _increment_pin_attempts(req.subject_ref)
        remaining = max(0, _PIN_MAX_ATTEMPTS - attempts)
        log.warning(f"[PIN] Failed attempt subject_ref={req.subject_ref} attempts={attempts}")
        _publish_pin_event(req.subject_ref, "PIN_FAILED", {
            "attempts": attempts, "remaining": remaining, "reason": req.reason,
        })
        return PINVerifyResponse(
            subject_ref=req.subject_ref,
            verified=False,
            reason="pin_mismatch",
            attempts_remaining=remaining,
        )


@pin_router.delete("/{subject_ref}", summary="Revoke a PIN")
async def pin_revoke(subject_ref: str) -> dict:
    """Revoke the PIN for a subject (e.g. on account compromise or re-enrolment)."""
    if _redis is None:
        raise HTTPException(status_code=503, detail="Redis not connected")
    deleted = await _redis.delete(f"{_PIN_KEY_PREFIX}{subject_ref}")
    await _reset_pin_attempts(subject_ref)
    log.info(f"[PIN] Revoked subject_ref={subject_ref}")
    _publish_pin_event(subject_ref, "PIN_REVOKED", {})
    return {
        "subject_ref": subject_ref,
        "revoked": bool(deleted),
        "revoked_at": datetime.utcnow().isoformat() + "Z",
    }


@pin_router.get("/{subject_ref}/status", summary="Check PIN enrolment and lock status")
async def pin_status(subject_ref: str) -> dict:
    """Return whether a PIN is enrolled and whether it is currently locked."""
    if _redis is None:
        return {"subject_ref": subject_ref, "enrolled": False, "locked": False, "redis_available": False}
    enrolled = bool(await _redis.exists(f"{_PIN_KEY_PREFIX}{subject_ref}"))
    locked = await _is_pin_locked(subject_ref)
    lock_ttl = int(await _redis.ttl(f"{_PIN_LOCK_PREFIX}{subject_ref}")) if locked else 0
    attempts_raw = await _redis.get(f"{_PIN_ATTEMPT_PREFIX}{subject_ref}")
    attempts = int(attempts_raw) if attempts_raw else 0
    return {
        "subject_ref": subject_ref,
        "enrolled": enrolled,
        "locked": locked,
        "locked_until_s": lock_ttl if locked else None,
        "attempts_in_window": attempts,
        "max_attempts": _PIN_MAX_ATTEMPTS,
        "window_s": _PIN_WINDOW_S,
    }
