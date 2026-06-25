"""
app/services/opensearch_sink.py — OpenSearch sink for ML enrichment results.

Writes UEBA profiles, risk scores, and adverse media results to OpenSearch
for full-text search and analytics dashboards.

Indices:
  bis-ueba-profiles     — UEBA anomaly profiles per subject
  bis-risk-scores       — Composite risk score history
  bis-adverse-media     — Adverse media analysis results
  bis-ml-enrichment     — General enrichment audit trail

Environment variables:
  OPENSEARCH_URL        — OpenSearch base URL (default: http://localhost:9200)
  OPENSEARCH_USER       — Basic auth username (default: admin)
  OPENSEARCH_PASSWORD   — Basic auth password (default: admin)
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

# ─── Config ───────────────────────────────────────────────────────────────────

OPENSEARCH_URL = os.environ.get("OPENSEARCH_URL", "http://localhost:9200")
OPENSEARCH_USER = os.environ.get("OPENSEARCH_USER", "admin")
OPENSEARCH_PASSWORD = os.environ.get("OPENSEARCH_PASSWORD", "admin")

INDEX_UEBA = "bis-ueba-profiles"
INDEX_RISK = "bis-risk-scores"
INDEX_ADVERSE = "bis-adverse-media"
INDEX_ENRICHMENT = "bis-ml-enrichment"

# ─── HTTP client (lazy import) ────────────────────────────────────────────────

_session: Optional[Any] = None
_available: Optional[bool] = None


def _get_session():
    """Return a requests.Session or None if requests is unavailable."""
    global _session, _available
    if _available is False:
        return None
    if _session is not None:
        return _session
    try:
        import requests
        from requests.auth import HTTPBasicAuth
        s = requests.Session()
        s.auth = HTTPBasicAuth(OPENSEARCH_USER, OPENSEARCH_PASSWORD)
        s.headers.update({"Content-Type": "application/json"})
        # Probe connectivity
        resp = s.get(f"{OPENSEARCH_URL}/_cluster/health", timeout=3)
        if resp.status_code < 300:
            log.info("opensearch_sink.connected", url=OPENSEARCH_URL)
            _session = s
            _available = True
        else:
            log.warning("opensearch_sink.unhealthy", status=resp.status_code)
            _available = False
    except Exception as exc:
        log.warning("opensearch_sink.unavailable", error=str(exc))
        _available = False
    return _session


def _ensure_index(index: str, mappings: Dict[str, Any]) -> None:
    """Create index with mappings if it does not exist."""
    s = _get_session()
    if s is None:
        return
    try:
        resp = s.head(f"{OPENSEARCH_URL}/{index}", timeout=5)
        if resp.status_code == 200:
            return  # already exists
        body = {
            "settings": {"number_of_shards": 1, "number_of_replicas": 1},
            "mappings": {"properties": mappings},
        }
        s.put(f"{OPENSEARCH_URL}/{index}", json=body, timeout=10)
        log.info("opensearch_sink.index_created", index=index)
    except Exception as exc:
        log.warning("opensearch_sink.index_create_failed", index=index, error=str(exc))


def _index_doc(index: str, doc_id: str, doc: Dict[str, Any]) -> bool:
    """Index a single document. Returns True on success."""
    s = _get_session()
    if s is None:
        return False
    try:
        url = f"{OPENSEARCH_URL}/{index}/_doc/{doc_id}"
        resp = s.put(url, json=doc, timeout=10)
        if resp.status_code in (200, 201):
            return True
        log.warning("opensearch_sink.index_failed", index=index, doc_id=doc_id, status=resp.status_code)
        return False
    except Exception as exc:
        log.warning("opensearch_sink.index_error", index=index, doc_id=doc_id, error=str(exc))
        return False


# ─── Public API ───────────────────────────────────────────────────────────────

def sink_ueba_profile(subject_id: str, tenant_id: str, profile: Dict[str, Any]) -> None:
    """Write a UEBA profile to OpenSearch."""
    _ensure_index(INDEX_UEBA, {
        "subject_id":     {"type": "keyword"},
        "tenant_id":      {"type": "keyword"},
        "anomaly_score":  {"type": "float"},
        "risk_level":     {"type": "keyword"},
        "event_count":    {"type": "integer"},
        "indexed_at":     {"type": "date"},
    })
    doc = {
        **profile,
        "subject_id": subject_id,
        "tenant_id": tenant_id,
        "indexed_at": datetime.now(timezone.utc).isoformat(),
    }
    doc_id = f"{tenant_id}-{subject_id}"
    ok = _index_doc(INDEX_UEBA, doc_id, doc)
    if ok:
        log.info("opensearch_sink.ueba_indexed", subject_id=subject_id)


def sink_risk_score(subject_id: str, tenant_id: str, score_data: Dict[str, Any]) -> None:
    """Write a risk score result to OpenSearch."""
    _ensure_index(INDEX_RISK, {
        "subject_id":       {"type": "keyword"},
        "tenant_id":        {"type": "keyword"},
        "composite_score":  {"type": "integer"},
        "risk_level":       {"type": "keyword"},
        "model_version":    {"type": "keyword"},
        "indexed_at":       {"type": "date"},
    })
    doc = {
        **score_data,
        "subject_id": subject_id,
        "tenant_id": tenant_id,
        "indexed_at": datetime.now(timezone.utc).isoformat(),
    }
    # Use timestamp-based ID to keep history
    doc_id = f"{tenant_id}-{subject_id}-{int(time.time())}"
    ok = _index_doc(INDEX_RISK, doc_id, doc)
    if ok:
        log.info("opensearch_sink.risk_indexed", subject_id=subject_id, score=score_data.get("composite_score"))


def sink_adverse_media(subject_id: str, tenant_id: str, analysis: Dict[str, Any]) -> None:
    """Write adverse media analysis to OpenSearch."""
    _ensure_index(INDEX_ADVERSE, {
        "subject_id":    {"type": "keyword"},
        "tenant_id":     {"type": "keyword"},
        "subject_name":  {"type": "text"},
        "severity":      {"type": "keyword"},
        "article_count": {"type": "integer"},
        "indexed_at":    {"type": "date"},
    })
    doc = {
        **analysis,
        "subject_id": subject_id,
        "tenant_id": tenant_id,
        "indexed_at": datetime.now(timezone.utc).isoformat(),
    }
    doc_id = f"{tenant_id}-{subject_id}-{int(time.time())}"
    ok = _index_doc(INDEX_ADVERSE, doc_id, doc)
    if ok:
        log.info("opensearch_sink.adverse_indexed", subject_id=subject_id)


def sink_enrichment_event(event_type: str, subject_id: str, tenant_id: str, data: Dict[str, Any]) -> None:
    """Write a general enrichment audit event to OpenSearch."""
    _ensure_index(INDEX_ENRICHMENT, {
        "event_type":  {"type": "keyword"},
        "subject_id":  {"type": "keyword"},
        "tenant_id":   {"type": "keyword"},
        "indexed_at":  {"type": "date"},
    })
    doc = {
        "event_type": event_type,
        "subject_id": subject_id,
        "tenant_id": tenant_id,
        "data": data,
        "indexed_at": datetime.now(timezone.utc).isoformat(),
    }
    doc_id = f"{event_type}-{tenant_id}-{subject_id}-{int(time.time() * 1000)}"
    _index_doc(INDEX_ENRICHMENT, doc_id, doc)
