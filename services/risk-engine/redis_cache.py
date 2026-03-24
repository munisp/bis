"""
BIS Risk Engine — Redis Cache Layer
Caches risk scores and lookup results to reduce redundant API calls.
"""
import json
import logging
import os
from typing import Any, Optional

logger = logging.getLogger("bis.redis")

# Try to import redis; fall back gracefully if not installed
try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    logger.warning("[Redis] redis-py not installed — cache disabled")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
SCORE_TTL = int(os.getenv("RISK_SCORE_TTL_SECONDS", "3600"))   # 1 hour
LOOKUP_TTL = int(os.getenv("LOOKUP_TTL_SECONDS", "86400"))      # 24 hours

_client: Optional[Any] = None


def _get_client():
    global _client
    if not REDIS_AVAILABLE:
        return None
    if _client is None:
        try:
            _client = redis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=2)
            _client.ping()
            logger.info("[Redis] Connected → %s", REDIS_URL)
        except Exception as exc:
            logger.warning("[Redis] Cannot connect: %s — cache disabled", exc)
            _client = None
    return _client


def cache_score(subject_id: str, score_data: dict) -> None:
    """Cache a risk score result for the given subject."""
    client = _get_client()
    if client is None:
        return
    key = f"bis:score:{subject_id}"
    try:
        client.setex(key, SCORE_TTL, json.dumps(score_data))
        logger.debug("[Redis] Cached score for %s (TTL=%ds)", subject_id, SCORE_TTL)
    except Exception as exc:
        logger.warning("[Redis] cache_score error: %s", exc)


def get_cached_score(subject_id: str) -> Optional[dict]:
    """Return a cached risk score or None on miss."""
    client = _get_client()
    if client is None:
        return None
    key = f"bis:score:{subject_id}"
    try:
        raw = client.get(key)
        if raw:
            logger.debug("[Redis] Cache HIT for score:%s", subject_id)
            return json.loads(raw)
    except Exception as exc:
        logger.warning("[Redis] get_cached_score error: %s", exc)
    return None


def cache_lookup(lookup_type: str, identifier: str, result: dict) -> None:
    """Cache a data source lookup result (NIN, BVN, sanctions, etc.)."""
    client = _get_client()
    if client is None:
        return
    key = f"bis:lookup:{lookup_type}:{identifier}"
    try:
        client.setex(key, LOOKUP_TTL, json.dumps(result))
        logger.debug("[Redis] Cached lookup %s:%s (TTL=%ds)", lookup_type, identifier, LOOKUP_TTL)
    except Exception as exc:
        logger.warning("[Redis] cache_lookup error: %s", exc)


def get_cached_lookup(lookup_type: str, identifier: str) -> Optional[dict]:
    """Return a cached lookup result or None on miss."""
    client = _get_client()
    if client is None:
        return None
    key = f"bis:lookup:{lookup_type}:{identifier}"
    try:
        raw = client.get(key)
        if raw:
            logger.debug("[Redis] Cache HIT for lookup %s:%s", lookup_type, identifier)
            return json.loads(raw)
    except Exception as exc:
        logger.warning("[Redis] get_cached_lookup error: %s", exc)
    return None


def invalidate_subject(subject_id: str) -> None:
    """Remove all cached data for a subject (e.g. after re-investigation)."""
    client = _get_client()
    if client is None:
        return
    try:
        keys = client.keys(f"bis:*:{subject_id}*")
        if keys:
            client.delete(*keys)
            logger.info("[Redis] Invalidated %d keys for subject %s", len(keys), subject_id)
    except Exception as exc:
        logger.warning("[Redis] invalidate_subject error: %s", exc)
