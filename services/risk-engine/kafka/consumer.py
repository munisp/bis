"""
BIS Risk Engine — Kafka Consumer
Subscribes to bis.events and triggers risk re-scoring on relevant events.
"""
import asyncio
import json
import logging
import os
from typing import Any, Dict

logger = logging.getLogger("bis.kafka")

# Try to import kafka-python; fall back gracefully if not installed
try:
    from kafka import KafkaConsumer
    from kafka.errors import NoBrokersAvailable
    KAFKA_AVAILABLE = True
except ImportError:
    KAFKA_AVAILABLE = False
    logger.warning("[Kafka] kafka-python not installed — consumer disabled")


KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
KAFKA_TOPIC = "bis.events"
KAFKA_GROUP = "bis-risk-engine"

# Events that should trigger a risk re-score
RESCORE_EVENTS = {
    "INVESTIGATION_CREATED",
    "KYC_COMPLETED",
    "ALERT_ACKNOWLEDGED",
    "FIELD_TASK_COMPLETED",
}


async def handle_event(event: Dict[str, Any]) -> None:
    """Process a single BIS event."""
    event_type = event.get("event_type", "")
    subject_ref = event.get("subject_ref", "")
    payload = event.get("payload", {})

    logger.info("[Kafka] Received event: %s for %s", event_type, subject_ref)

    if event_type in RESCORE_EVENTS:
        logger.info("[Kafka] Triggering risk re-score for %s", subject_ref)
        # In production: call the /v1/score endpoint with updated signals
        # For now we log the intent
        logger.info("[RiskEngine] Would re-score %s with payload: %s", subject_ref, payload)

    elif event_type == "INVESTIGATION_FLAGGED":
        logger.warning("[Kafka] FLAGGED investigation: %s — escalating to compliance team", subject_ref)

    elif event_type == "REPORT_GENERATED":
        logger.info("[Kafka] Report generated for %s", subject_ref)


def start_consumer() -> None:
    """Start the Kafka consumer in a blocking loop."""
    if not KAFKA_AVAILABLE:
        logger.warning("[Kafka] Consumer not started — kafka-python unavailable")
        return

    logger.info("[Kafka] Connecting to %s, topic=%s, group=%s", KAFKA_BROKERS, KAFKA_TOPIC, KAFKA_GROUP)
    try:
        consumer = KafkaConsumer(
            KAFKA_TOPIC,
            bootstrap_servers=KAFKA_BROKERS.split(","),
            group_id=KAFKA_GROUP,
            auto_offset_reset="latest",
            enable_auto_commit=True,
            value_deserializer=lambda m: json.loads(m.decode("utf-8")),
            consumer_timeout_ms=1000,
        )
        logger.info("[Kafka] Consumer started — listening for events")
        while True:
            for message in consumer:
                try:
                    asyncio.run(handle_event(message.value))
                except Exception as exc:
                    logger.error("[Kafka] Error processing message: %s", exc)
    except NoBrokersAvailable:
        logger.warning("[Kafka] No brokers available at %s — consumer disabled", KAFKA_BROKERS)
    except Exception as exc:
        logger.error("[Kafka] Consumer error: %s", exc)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    start_consumer()
