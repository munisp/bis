"""
app/services/kafka_producer.py — Kafka producer for ML enrichment events.

Publishes risk scores, UEBA alerts, and adverse media findings to Kafka
for downstream consumption by the Rust event processor and BFF.

Topics:
  bis.ml.risk-scores    — Risk score computed events
  bis.ml.ueba-alerts    — UEBA anomaly alerts (score > threshold)
  bis.ml.adverse-media  — Adverse media analysis results
  bis.events            — General BIS event bus

Environment variables:
  KAFKA_BROKERS         — Comma-separated broker list (default: localhost:9092)
  KAFKA_TOPIC_PREFIX    — Topic prefix (default: bis)
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import structlog

log = structlog.get_logger(__name__)

KAFKA_BROKERS = os.environ.get("KAFKA_BROKERS", "localhost:9092")
TOPIC_RISK = "bis.ml.risk-scores"
TOPIC_UEBA = "bis.ml.ueba-alerts"
TOPIC_ADVERSE = "bis.ml.adverse-media"
TOPIC_EVENTS = "bis.events"

# ─── Producer singleton ───────────────────────────────────────────────────────

_producer: Optional[Any] = None
_available: Optional[bool] = None


def _get_producer():
    """Return a KafkaProducer or None if kafka-python is unavailable."""
    global _producer, _available
    if _available is False:
        return None
    if _producer is not None:
        return _producer
    try:
        from kafka import KafkaProducer
        from kafka.errors import NoBrokersAvailable
        p = KafkaProducer(
            bootstrap_servers=KAFKA_BROKERS.split(","),
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            key_serializer=lambda k: k.encode("utf-8") if k else None,
            acks="all",
            retries=3,
            max_block_ms=5000,
            request_timeout_ms=10000,
        )
        _producer = p
        _available = True
        log.info("kafka_producer.connected", brokers=KAFKA_BROKERS)
    except ImportError:
        log.warning("kafka_producer.unavailable", reason="kafka-python not installed")
        _available = False
    except Exception as exc:
        log.warning("kafka_producer.connect_failed", error=str(exc))
        _available = False
    return _producer


def _publish(topic: str, key: str, payload: Dict[str, Any]) -> bool:
    """Publish a message to Kafka. Returns True on success."""
    p = _get_producer()
    if p is None:
        log.debug("kafka_producer.skipped", topic=topic, key=key)
        return False
    try:
        future = p.send(topic, key=key, value=payload)
        future.get(timeout=5)
        return True
    except Exception as exc:
        log.warning("kafka_producer.publish_failed", topic=topic, key=key, error=str(exc))
        return False


# ─── Public API ───────────────────────────────────────────────────────────────

def publish_risk_score(subject_id: str, tenant_id: str, score_data: Dict[str, Any]) -> None:
    """Publish a risk score result to bis.ml.risk-scores."""
    payload = {
        "event_type": "RISK_SCORE_COMPUTED",
        "subject_id": subject_id,
        "tenant_id": tenant_id,
        "composite_score": score_data.get("composite_score"),
        "risk_level": score_data.get("risk_level"),
        "model_version": score_data.get("model_version", "bis-risk-v1.0"),
        "published_at": datetime.now(timezone.utc).isoformat(),
        "data": score_data,
    }
    key = f"{tenant_id}:{subject_id}"
    ok = _publish(TOPIC_RISK, key, payload)
    if ok:
        log.info("kafka_producer.risk_published", subject_id=subject_id)


def publish_ueba_alert(subject_id: str, tenant_id: str, anomaly_score: float,
                       risk_level: str, profile: Dict[str, Any]) -> None:
    """Publish a UEBA anomaly alert to bis.ml.ueba-alerts."""
    payload = {
        "event_type": "UEBA_ANOMALY_DETECTED",
        "subject_id": subject_id,
        "tenant_id": tenant_id,
        "anomaly_score": anomaly_score,
        "risk_level": risk_level,
        "published_at": datetime.now(timezone.utc).isoformat(),
        "profile": profile,
    }
    key = f"{tenant_id}:{subject_id}"
    ok = _publish(TOPIC_UEBA, key, payload)
    if ok:
        log.info("kafka_producer.ueba_alert_published", subject_id=subject_id, score=anomaly_score)

    # Also publish to the main event bus for cross-service consumption
    _publish(TOPIC_EVENTS, key, {
        "event_type": "UEBA_ANOMALY_DETECTED",
        "subject_ref": subject_id,
        "severity": risk_level,
        "payload": {"anomaly_score": anomaly_score, "tenant_id": tenant_id},
        "source": "bis-ml-enrichment",
        "published_at": datetime.now(timezone.utc).isoformat(),
    })


def publish_adverse_media(subject_id: str, tenant_id: str, analysis: Dict[str, Any]) -> None:
    """Publish adverse media analysis to bis.ml.adverse-media."""
    payload = {
        "event_type": "ADVERSE_MEDIA_ANALYZED",
        "subject_id": subject_id,
        "tenant_id": tenant_id,
        "severity": analysis.get("overall_severity", "none"),
        "article_count": analysis.get("article_count", 0),
        "published_at": datetime.now(timezone.utc).isoformat(),
        "data": analysis,
    }
    key = f"{tenant_id}:{subject_id}"
    ok = _publish(TOPIC_ADVERSE, key, payload)
    if ok:
        log.info("kafka_producer.adverse_published", subject_id=subject_id)


def close() -> None:
    """Flush and close the Kafka producer."""
    global _producer
    if _producer is not None:
        try:
            _producer.flush(timeout=5)
            _producer.close(timeout=5)
        except Exception as exc:
            log.warning("kafka_producer.close_error", error=str(exc))
        _producer = None
