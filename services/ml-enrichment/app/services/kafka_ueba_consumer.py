"""
app/services/kafka_ueba_consumer.py — Incremental UEBA retraining via Kafka consumer.

Architecture:
  - Consumes from `bis.events` and `bis.ml.ueba-alerts` topics.
  - For every BIS event, extracts behavioural features and calls
    UEBAModelStore.ingest() to update the user profile.
  - Every RETRAIN_INTERVAL events (default 200), triggers an incremental
    IsolationForest refit using the accumulated feature matrix.
  - Implements a river-style online learning loop:
      1. Consume event from Kafka.
      2. Extract features (hour_of_day, day_of_week, payload_bytes, event_type_code).
      3. Call store.ingest() to update the rolling window.
      4. If retrain threshold reached, call store.force_retrain() in a thread pool.
  - Runs as a background asyncio task started at application startup.
  - Gracefully handles Kafka unavailability (logs warning, retries every 30s).

Usage:
  from app.services.kafka_ueba_consumer import start_consumer
  # In FastAPI lifespan:
  asyncio.create_task(start_consumer(store))
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import structlog

log = structlog.get_logger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "kafka:9092")
TOPIC_BIS_EVENTS = "bis.events"
TOPIC_UEBA_ALERTS = "bis.ml.ueba-alerts"
CONSUMER_GROUP = "bis-ml-ueba-retrain"
POLL_TIMEOUT_MS = 1000
RECONNECT_DELAY_S = 30
# Trigger incremental retrain every N events consumed from Kafka
KAFKA_RETRAIN_INTERVAL = int(os.getenv("UEBA_KAFKA_RETRAIN_INTERVAL", "200"))

# ── Feature extraction ────────────────────────────────────────────────────────

# Map event_type strings to numeric codes for the feature vector.
_EVENT_TYPE_CODES: Dict[str, int] = {
    "INVESTIGATION_CREATED": 1,
    "INVESTIGATION_FLAGGED": 2,
    "INVESTIGATION_COMPLETED": 3,
    "KYC_COMPLETED": 4,
    "KYC_FAILED": 5,
    "ALERT_TRIGGERED": 6,
    "ALERT_ACKNOWLEDGED": 7,
    "SANCTIONS_HIT": 8,
    "PEP_DETECTED": 9,
    "FIELD_TASK_DISPATCHED": 10,
    "FIELD_TASK_COMPLETED": 11,
    "REPORT_GENERATED": 12,
    "USER_LOGIN": 13,
    "API_KEY_ROTATED": 14,
    "BIOMETRIC_LIVENESS_CHECKED": 15,
    "BIOMETRIC_FACE_MATCHED": 16,
    "BIOMETRIC_ENROLLED": 17,
    "BIOMETRIC_REVOKED": 18,
    "INSIDER_THREAT_ALERT": 19,
    "PRIVILEGED_ACCESS_USED": 20,
    "DATA_EXFILTRATION_SUSPECTED": 21,
    "ANOMALOUS_HOUR_ACCESS": 22,
    "PRIVILEGE_ESCALATION": 23,
    "UEBA_ANOMALY_DETECTED": 24,
}


def _extract_features(message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Extract behavioural features from a BIS event message.

    Returns a dict compatible with UEBAModelStore.ingest(), or None if the
    message cannot be parsed.
    """
    subject_id = (
        message.get("subject_id")
        or message.get("subject_ref")
        or message.get("subjectId")
    )
    if not subject_id:
        return None

    # Parse timestamp
    ts_str = (
        message.get("published_at")
        or message.get("occurred_at")
        or message.get("occurredAt")
    )
    try:
        if ts_str:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        else:
            ts = datetime.now(tz=timezone.utc)
    except (ValueError, TypeError):
        ts = datetime.now(tz=timezone.utc)

    event_type_raw = (
        message.get("event_type")
        or message.get("eventType")
        or "UNKNOWN"
    ).upper()
    event_type_code = _EVENT_TYPE_CODES.get(event_type_raw, 0)

    # Payload size as a proxy for data volume
    payload = message.get("payload") or message.get("data") or {}
    payload_bytes = len(json.dumps(payload).encode("utf-8"))

    severity_map = {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
    severity_raw = str(message.get("severity", "info")).lower()
    severity_code = severity_map.get(severity_raw, 0)

    return {
        "subject_id": subject_id,
        "event_type": event_type_raw,
        "hour_of_day": ts.hour,
        "day_of_week": ts.weekday(),
        "payload_bytes": payload_bytes,
        "event_type_code": event_type_code,
        "severity_code": severity_code,
        "occurred_at": ts,
    }


# ── Consumer loop ─────────────────────────────────────────────────────────────


async def start_consumer(store: Any) -> None:
    """
    Start the Kafka consumer loop as an asyncio background task.

    Runs indefinitely; reconnects automatically on broker failure.
    `store` must be a UEBAModelStore instance with .ingest() and .force_retrain().
    """
    log.info("kafka_ueba_consumer.starting", brokers=KAFKA_BROKERS)

    while True:
        consumer = _build_consumer()
        if consumer is None:
            log.warning(
                "kafka_ueba_consumer.unavailable",
                reason="kafka-python not installed or broker unreachable",
                retry_in_s=RECONNECT_DELAY_S,
            )
            await asyncio.sleep(RECONNECT_DELAY_S)
            continue

        try:
            await _consume_loop(consumer, store)
        except Exception as exc:
            log.warning(
                "kafka_ueba_consumer.error",
                error=str(exc),
                retry_in_s=RECONNECT_DELAY_S,
            )
        finally:
            try:
                consumer.close()
            except Exception:
                pass

        await asyncio.sleep(RECONNECT_DELAY_S)


def _build_consumer() -> Optional[Any]:
    """Build a KafkaConsumer or return None if kafka-python is unavailable."""
    try:
        from kafka import KafkaConsumer  # type: ignore
        from kafka.errors import NoBrokersAvailable  # type: ignore

        consumer = KafkaConsumer(
            TOPIC_BIS_EVENTS,
            TOPIC_UEBA_ALERTS,
            bootstrap_servers=KAFKA_BROKERS.split(","),
            group_id=CONSUMER_GROUP,
            auto_offset_reset="latest",
            enable_auto_commit=True,
            auto_commit_interval_ms=5000,
            value_deserializer=lambda v: _safe_json(v),
            consumer_timeout_ms=POLL_TIMEOUT_MS,
            session_timeout_ms=30000,
            heartbeat_interval_ms=10000,
            max_poll_records=100,
        )
        log.info("kafka_ueba_consumer.connected", brokers=KAFKA_BROKERS)
        return consumer
    except ImportError:
        log.warning("kafka_ueba_consumer.import_error", reason="kafka-python not installed")
        return None
    except Exception as exc:
        log.warning("kafka_ueba_consumer.connect_failed", error=str(exc))
        return None


def _safe_json(raw: bytes) -> Optional[Dict[str, Any]]:
    """Deserialise JSON bytes; return None on parse error."""
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None


async def _consume_loop(consumer: Any, store: Any) -> None:
    """
    Inner consume loop — runs until an exception is raised.

    Uses asyncio.get_event_loop().run_in_executor() to call the blocking
    Kafka poll in a thread pool so the event loop stays responsive.
    """
    loop = asyncio.get_event_loop()
    events_consumed = 0
    events_ingested = 0
    retrain_count = 0

    log.info(
        "kafka_ueba_consumer.loop_started",
        topics=[TOPIC_BIS_EVENTS, TOPIC_UEBA_ALERTS],
        retrain_interval=KAFKA_RETRAIN_INTERVAL,
    )

    while True:
        # Poll in a thread pool to avoid blocking the event loop
        records = await loop.run_in_executor(None, _poll_once, consumer)

        for record in records:
            events_consumed += 1
            message = record.value
            if not message:
                continue

            features = _extract_features(message)
            if features is None:
                continue

            # Ingest into the UEBA store (updates rolling window + profile)
            try:
                is_priv_change = features["event_type"] in {
                    "PRIVILEGE_ESCALATION", "API_KEY_ROTATED", "PRIVILEGED_ACCESS_USED"
                }
                is_failed_auth = features["event_type"] in {
                    "KYC_FAILED", "BIOMETRIC_REVOKED"
                }
                store.record_event(
                    subject_id=features["subject_id"],
                    ts=features["occurred_at"],
                    payload_bytes=float(features["payload_bytes"]),
                    is_priv_change=is_priv_change,
                    is_failed_auth=is_failed_auth,
                )
                events_ingested += 1
            except Exception as exc:
                log.warning(
                    "kafka_ueba_consumer.ingest_error",
                    subject_id=features.get("subject_id"),
                    error=str(exc),
                )
                continue

            # Incremental retrain: trigger every KAFKA_RETRAIN_INTERVAL events
            if events_ingested > 0 and events_ingested % KAFKA_RETRAIN_INTERVAL == 0:
                try:
                    trained = await loop.run_in_executor(None, store.force_retrain)
                    retrain_count += 1
                    log.info(
                        "kafka_ueba_consumer.retrain_triggered",
                        events_consumed=events_consumed,
                        events_ingested=events_ingested,
                        retrain_count=retrain_count,
                        trained=trained,
                        model_version=store.model_version(),
                    )
                except Exception as exc:
                    log.warning("kafka_ueba_consumer.retrain_error", error=str(exc))

        # Yield control to the event loop between polls
        await asyncio.sleep(0.01)


def _poll_once(consumer: Any) -> list:
    """
    Call consumer.__iter__() for one batch of records.

    KafkaConsumer with consumer_timeout_ms set will raise StopIteration
    when no messages arrive within the timeout — we catch that and return [].
    """
    records = []
    try:
        for record in consumer:
            records.append(record)
            if len(records) >= 100:
                break
    except StopIteration:
        pass
    except Exception as exc:
        log.warning("kafka_ueba_consumer.poll_error", error=str(exc))
        raise
    return records


# ── Tests ─────────────────────────────────────────────────────────────────────

def _test_feature_extraction() -> None:
    """Smoke test for _extract_features."""
    msg = {
        "event_type": "USER_LOGIN",
        "subject_id": "user-001",
        "published_at": "2026-01-15T08:30:00Z",
        "payload": {"ip": "192.168.1.1"},
        "severity": "info",
    }
    features = _extract_features(msg)
    assert features is not None
    assert features["subject_id"] == "user-001"
    assert features["hour_of_day"] == 8
    assert features["event_type_code"] == _EVENT_TYPE_CODES["USER_LOGIN"]
    assert features["severity_code"] == 0
    print("_test_feature_extraction: PASSED")


def _test_missing_subject_id() -> None:
    """Messages without a subject_id should return None."""
    msg = {"event_type": "USER_LOGIN", "published_at": "2026-01-15T08:30:00Z"}
    assert _extract_features(msg) is None
    print("_test_missing_subject_id: PASSED")


def _test_unknown_event_type() -> None:
    """Unknown event types should map to code 0."""
    msg = {
        "event_type": "TOTALLY_UNKNOWN_EVENT",
        "subject_id": "user-002",
        "published_at": "2026-01-15T10:00:00Z",
    }
    features = _extract_features(msg)
    assert features is not None
    assert features["event_type_code"] == 0
    print("_test_unknown_event_type: PASSED")


if __name__ == "__main__":
    _test_feature_extraction()
    _test_missing_subject_id()
    _test_unknown_event_type()
    print("All kafka_ueba_consumer tests passed.")
