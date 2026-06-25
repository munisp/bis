"""
app/main.py — BIS ML Enrichment Service (Python + FastAPI)

Responsibilities:
  1. Risk scoring: composite ML-based risk score for subjects (0-100)
  2. Adverse media NLP: entity extraction + sentiment + category classification
  3. Ollama integration: route LLM requests to local Ollama or cloud fallback
  4. Lakehouse AI query: natural-language queries over the BIS data lakehouse
  5. Case enrichment: auto-populate case fields from investigation data
  6. UEBA: incremental IsolationForest retraining via Kafka consumer
"""

import asyncio
import logging
from contextlib import asynccontextmanager

import structlog
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import risk, adverse_media, ollama_proxy, lakehouse, case_enrichment, ueba
from app.services.ollama_client import OllamaClient
from app.services import kafka_ueba_consumer
from app.models.config import Settings

# ── Logging ───────────────────────────────────────────────────────────────────
structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    logger_factory=structlog.stdlib.LoggerFactory(),
)
log = structlog.get_logger(__name__)

# ── Settings ──────────────────────────────────────────────────────────────────
settings = Settings()


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle."""
    log.info("bis_ml_enrichment.startup", ollama_url=settings.ollama_url)

    # Warm up Ollama client
    client = OllamaClient(base_url=settings.ollama_url)
    app.state.ollama = client
    app.state.settings = settings

    # ── Start Kafka UEBA consumer for incremental retraining ──────────────────
    # The consumer subscribes to bis.events and bis.ml.ueba-alerts, ingests
    # behavioural features into the UEBA store, and triggers incremental
    # IsolationForest retraining every UEBA_KAFKA_RETRAIN_INTERVAL events.
    # If Kafka is unavailable the consumer logs a warning and retries every 30s.
    ueba_store = ueba.get_store()
    consumer_task = asyncio.create_task(
        kafka_ueba_consumer.start_consumer(ueba_store),
        name="kafka-ueba-consumer",
    )
    log.info("bis_ml_enrichment.kafka_consumer_started")

    yield

    # ── Graceful shutdown ─────────────────────────────────────────────────────
    consumer_task.cancel()
    try:
        await consumer_task
    except asyncio.CancelledError:
        pass
    log.info("bis_ml_enrichment.shutdown")


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="BIS ML Enrichment Service",
    description=(
        "Machine learning enrichment pipeline for the BIS platform. "
        "Provides risk scoring, adverse media NLP, Ollama LLM routing, "
        "and Lakehouse AI query capabilities."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(risk.router, prefix="/api/v1/risk", tags=["Risk Scoring"])
app.include_router(adverse_media.router, prefix="/api/v1/adverse-media", tags=["Adverse Media"])
app.include_router(ollama_proxy.router, prefix="/api/v1/ollama", tags=["Ollama LLM"])
app.include_router(lakehouse.router, prefix="/api/v1/lakehouse", tags=["Lakehouse AI"])
app.include_router(case_enrichment.router, prefix="/api/v1/cases", tags=["Case Enrichment"])
app.include_router(ueba.router, prefix="/api/v1/ueba", tags=["UEBA"])


@app.get("/health", tags=["System"])
async def health():
    return {
        "status": "ok",
        "service": "bis-ml-enrichment",
        "version": "1.0.0",
        "ollama_url": settings.ollama_url,
    }


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.port,
        reload=settings.env == "development",
        log_level="info",
    )
