"""
app/services/model_store.py — S3-backed model persistence for UEBA IsolationForest.

Responsibilities:
  - Serialise (joblib) the trained IsolationForest + StandardScaler to S3.
  - Store the current model version key in Redis so all replicas can detect
    when a newer model is available and hot-reload it.
  - Provide load_model() for startup bootstrap (falls back to None if no model
    exists yet, which triggers a fresh fit on the first RETRAIN_INTERVAL).
  - Provide save_model() called after every successful _retrain_model().

Environment variables consumed:
  AWS_ENDPOINT_URL   — S3-compatible endpoint (MinIO / AWS)
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  S3_BUCKET          — bucket name (default: bis-ml-models)
  REDIS_URL          — redis://host:port (default: redis://redis:6379)
"""
from __future__ import annotations

import io
import logging
import os
import time
from typing import Any, Optional, Tuple

import joblib
import structlog

log = structlog.get_logger(__name__)

_S3_BUCKET = os.getenv("S3_BUCKET", "bis-ml-models")
_MODEL_KEY = "ueba/isolation_forest/model.joblib"
_SCALER_KEY = "ueba/isolation_forest/scaler.joblib"
_REDIS_VERSION_KEY = "bis:ueba:model_version"

# ---------------------------------------------------------------------------
# Lazy S3 client
# ---------------------------------------------------------------------------

def _s3_client():
    """Return a boto3 S3 client, or None if boto3 is not available."""
    try:
        import boto3  # type: ignore
        kwargs: dict = {}
        endpoint = os.getenv("AWS_ENDPOINT_URL")
        if endpoint:
            kwargs["endpoint_url"] = endpoint
        return boto3.client(
            "s3",
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "minioadmin"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "minioadmin"),
            **kwargs,
        )
    except ImportError:
        log.warning("model_store.boto3_unavailable", msg="boto3 not installed; model persistence disabled")
        return None


def _redis_client():
    """Return a redis.Redis client, or None if redis-py is not available."""
    try:
        import redis  # type: ignore
        url = os.getenv("REDIS_URL", "redis://redis:6379")
        return redis.from_url(url, decode_responses=True, socket_connect_timeout=2)
    except ImportError:
        log.warning("model_store.redis_unavailable", msg="redis-py not installed; version key disabled")
        return None
    except Exception as exc:
        log.warning("model_store.redis_connect_failed", error=str(exc))
        return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def save_model(model: Any, scaler: Any) -> Optional[str]:
    """
    Serialise model + scaler to S3 and update the Redis version key.
    Returns the version string (timestamp) or None on failure.
    """
    s3 = _s3_client()
    if s3 is None:
        log.info("model_store.save_skipped", reason="boto3 unavailable")
        return None

    version = str(int(time.time()))
    try:
        # Ensure bucket exists
        try:
            s3.head_bucket(Bucket=_S3_BUCKET)
        except Exception:
            s3.create_bucket(Bucket=_S3_BUCKET)

        # Serialise model
        model_buf = io.BytesIO()
        joblib.dump(model, model_buf)
        model_buf.seek(0)
        s3.put_object(Bucket=_S3_BUCKET, Key=_MODEL_KEY, Body=model_buf.read())

        # Serialise scaler
        scaler_buf = io.BytesIO()
        joblib.dump(scaler, scaler_buf)
        scaler_buf.seek(0)
        s3.put_object(Bucket=_S3_BUCKET, Key=_SCALER_KEY, Body=scaler_buf.read())

        log.info("model_store.saved", version=version, bucket=_S3_BUCKET)

        # Update Redis version key so other replicas can hot-reload
        r = _redis_client()
        if r is not None:
            try:
                r.set(_REDIS_VERSION_KEY, version, ex=86400 * 7)  # 7-day TTL
            except Exception as exc:
                log.warning("model_store.redis_version_set_failed", error=str(exc))

        return version

    except Exception as exc:
        log.error("model_store.save_failed", error=str(exc))
        return None


def load_model() -> Tuple[Optional[Any], Optional[Any], Optional[str]]:
    """
    Load model + scaler from S3.
    Returns (model, scaler, version) or (None, None, None) if not found.
    """
    s3 = _s3_client()
    if s3 is None:
        return None, None, None

    try:
        model_obj = s3.get_object(Bucket=_S3_BUCKET, Key=_MODEL_KEY)
        model = joblib.load(io.BytesIO(model_obj["Body"].read()))

        scaler_obj = s3.get_object(Bucket=_S3_BUCKET, Key=_SCALER_KEY)
        scaler = joblib.load(io.BytesIO(scaler_obj["Body"].read()))

        # Read version from Redis
        version: Optional[str] = None
        r = _redis_client()
        if r is not None:
            try:
                version = r.get(_REDIS_VERSION_KEY)
            except Exception:
                pass

        log.info("model_store.loaded", version=version, bucket=_S3_BUCKET)
        return model, scaler, version

    except Exception as exc:
        log.info("model_store.load_failed", reason=str(exc))
        return None, None, None


def current_version() -> Optional[str]:
    """Return the current model version from Redis, or None."""
    r = _redis_client()
    if r is None:
        return None
    try:
        return r.get(_REDIS_VERSION_KEY)
    except Exception:
        return None
