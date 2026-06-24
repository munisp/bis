"""
app/routers/ueba.py — User and Entity Behaviour Analytics (UEBA) router

Insider-threat prevention via ML-based anomaly detection.

Architecture:
  - Each user accumulates a feature vector from observed events.
  - An IsolationForest model is trained incrementally on the cohort.
  - A /score endpoint returns an anomaly score (0.0 = normal, 1.0 = highly anomalous).
  - A /profile endpoint returns the user's behaviour baseline.
  - A /drift endpoint detects sudden shifts in a user's own behaviour pattern.
  - A /batch-score endpoint processes multiple users at once (for scheduled sweeps).

The model is intentionally lightweight — it runs in-process without a GPU.
For production, swap the in-process IsolationForest for a Kafka consumer that
feeds a Flink job writing scores back to Redis.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from app.services import opensearch_sink, kafka_producer

log = structlog.get_logger(__name__)

router = APIRouter()

# ─── Constants ────────────────────────────────────────────────────────────────

# Minimum number of events before a user profile is considered "established"
MIN_EVENTS_FOR_BASELINE = 20
# Minimum cohort size before the IsolationForest is trained
MIN_COHORT_FOR_TRAINING = 5
# Retrain the global model after this many new events
RETRAIN_INTERVAL = 100
# Number of recent events to keep per user for drift detection
DRIFT_WINDOW = 50
# Anomaly score threshold above which an alert is raised
ALERT_THRESHOLD = 0.70
# Contamination parameter for IsolationForest (expected fraction of outliers)
CONTAMINATION = 0.05

# ─── Feature extraction ───────────────────────────────────────────────────────

HOUR_BUCKETS = 24
DAY_BUCKETS = 7  # 0=Monday … 6=Sunday


def _hour_bucket(ts: datetime) -> int:
    return ts.hour


def _day_bucket(ts: datetime) -> int:
    return ts.weekday()


def _entropy(counts: List[float]) -> float:
    """Shannon entropy of a probability distribution."""
    total = sum(counts)
    if total == 0:
        return 0.0
    probs = [c / total for c in counts if c > 0]
    return -sum(p * math.log2(p) for p in probs)


@dataclass
class UserBehaviourProfile:
    subject_id: str
    event_count: int = 0
    hour_histogram: List[float] = field(default_factory=lambda: [0.0] * HOUR_BUCKETS)
    day_histogram: List[float] = field(default_factory=lambda: [0.0] * DAY_BUCKETS)
    total_payload_bytes: float = 0.0
    priv_change_count: int = 0
    failed_auth_count: int = 0
    unique_ip_count: int = 0
    _ip_set: set = field(default_factory=set, repr=False)
    # Sliding window of recent (timestamp, feature_vector) for drift detection
    _recent_features: deque = field(
        default_factory=lambda: deque(maxlen=DRIFT_WINDOW), repr=False
    )
    created_at: float = field(default_factory=time.time)
    last_updated: float = field(default_factory=time.time)

    def record_event(
        self,
        ts: datetime,
        payload_bytes: float = 0.0,
        is_priv_change: bool = False,
        is_failed_auth: bool = False,
        source_ip: Optional[str] = None,
    ) -> None:
        self.event_count += 1
        self.hour_histogram[_hour_bucket(ts)] += 1.0
        self.day_histogram[_day_bucket(ts)] += 1.0
        self.total_payload_bytes += payload_bytes
        if is_priv_change:
            self.priv_change_count += 1
        if is_failed_auth:
            self.failed_auth_count += 1
        if source_ip:
            self._ip_set.add(source_ip)
            self.unique_ip_count = len(self._ip_set)
        self.last_updated = time.time()
        # Store a snapshot of the current feature vector for drift detection
        self._recent_features.append(self.feature_vector())

    def feature_vector(self) -> np.ndarray:
        """
        Produce a fixed-length feature vector for this user.
        Features (16 dimensions):
          [0]   event_count (log-scaled)
          [1]   avg_events_per_hour (log-scaled)
          [2-7] day_histogram (normalised)
          [8]   hour_entropy  (working-hours spread)
          [9]   day_entropy   (working-days spread)
          [10]  avg_payload_bytes (log-scaled)
          [11]  priv_change_rate
          [12]  failed_auth_rate
          [13]  unique_ip_count (log-scaled)
          [14]  off_hours_ratio  (events outside 08:00-18:00)
          [15]  weekend_ratio
        """
        n = max(self.event_count, 1)
        age_hours = max((time.time() - self.created_at) / 3600.0, 1.0)

        day_total = sum(self.day_histogram) or 1.0
        day_norm = [d / day_total for d in self.day_histogram]

        off_hours = sum(self.hour_histogram[h] for h in range(24) if h < 8 or h >= 18)
        off_hours_ratio = off_hours / n

        weekend = sum(self.day_histogram[5:7])
        weekend_ratio = weekend / day_total

        return np.array(
            [
                math.log1p(self.event_count),
                math.log1p(self.event_count / age_hours),
                *day_norm,
                _entropy(self.hour_histogram),
                _entropy(self.day_histogram),
                math.log1p(self.total_payload_bytes / n),
                self.priv_change_count / n,
                self.failed_auth_count / n,
                math.log1p(self.unique_ip_count),
                off_hours_ratio,
                weekend_ratio,
            ],
            dtype=np.float64,
        )

    def drift_score(self) -> float:
        """
        Measure how much the user's recent behaviour has drifted from their
        historical baseline.  Returns 0.0 (no drift) to 1.0 (maximum drift).
        """
        if len(self._recent_features) < 10:
            return 0.0
        recent = list(self._recent_features)
        half = len(recent) // 2
        baseline = np.array(recent[:half])
        current = np.array(recent[half:])
        # Cosine distance between mean vectors
        b_mean = baseline.mean(axis=0)
        c_mean = current.mean(axis=0)
        dot = float(np.dot(b_mean, c_mean))
        norm = float(np.linalg.norm(b_mean) * np.linalg.norm(c_mean))
        if norm < 1e-9:
            return 0.0
        cosine_sim = dot / norm
        return max(0.0, 1.0 - cosine_sim)


# ─── In-memory model store ────────────────────────────────────────────────────


class UEBAModelStore:
    """
    Thread-safe in-memory store for user profiles and the global IsolationForest.
    In production, profiles would be persisted to Redis/TiDB and the model
    serialised to S3 with versioning.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._profiles: Dict[str, UserBehaviourProfile] = {}
        self._model: Optional[IsolationForest] = None
        self._scaler: Optional[StandardScaler] = None
        self._events_since_retrain: int = 0
        self._model_trained_at: Optional[float] = None
        self._total_events: int = 0

    # ── Profile management ─────────────────────────────────────────────────────

    def get_or_create_profile(self, subject_id: str) -> UserBehaviourProfile:
        with self._lock:
            if subject_id not in self._profiles:
                self._profiles[subject_id] = UserBehaviourProfile(
                    subject_id=subject_id
                )
            return self._profiles[subject_id]

    def record_event(
        self,
        subject_id: str,
        ts: datetime,
        payload_bytes: float = 0.0,
        is_priv_change: bool = False,
        is_failed_auth: bool = False,
        source_ip: Optional[str] = None,
    ) -> UserBehaviourProfile:
        with self._lock:
            profile = self.get_or_create_profile(subject_id)
            profile.record_event(
                ts=ts,
                payload_bytes=payload_bytes,
                is_priv_change=is_priv_change,
                is_failed_auth=is_failed_auth,
                source_ip=source_ip,
            )
            self._events_since_retrain += 1
            self._total_events += 1
            if self._events_since_retrain >= RETRAIN_INTERVAL:
                self._retrain_model()
            return profile

    # ── Model training ─────────────────────────────────────────────────────────

    def _retrain_model(self) -> None:
        """Retrain the IsolationForest on all established user profiles."""
        established = [
            p
            for p in self._profiles.values()
            if p.event_count >= MIN_EVENTS_FOR_BASELINE
        ]
        if len(established) < MIN_COHORT_FOR_TRAINING:
            return
        X = np.array([p.feature_vector() for p in established])
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)
        model = IsolationForest(
            n_estimators=100,
            contamination=CONTAMINATION,
            random_state=42,
            n_jobs=-1,
        )
        model.fit(X_scaled)
        self._scaler = scaler
        self._model = model
        self._events_since_retrain = 0
        self._model_trained_at = time.time()
        log.info(
            "ueba.model_retrained",
            cohort_size=len(established),
            total_events=self._total_events,
        )

    def force_retrain(self) -> bool:
        with self._lock:
            self._retrain_model()
            return self._model is not None

    # ── Scoring ────────────────────────────────────────────────────────────────

    def score(self, subject_id: str) -> Tuple[float, str]:
        """
        Returns (anomaly_score 0-1, reason).
        0.0 = perfectly normal, 1.0 = highly anomalous.
        """
        with self._lock:
            profile = self._profiles.get(subject_id)
            if profile is None:
                return 0.0, "no_profile"
            if profile.event_count < MIN_EVENTS_FOR_BASELINE:
                return 0.0, "insufficient_history"
            if self._model is None or self._scaler is None:
                return 0.0, "model_not_ready"
            fv = profile.feature_vector().reshape(1, -1)
            fv_scaled = self._scaler.transform(fv)
            # IsolationForest.decision_function returns negative scores for outliers
            raw = float(self._model.decision_function(fv_scaled)[0])
            # Normalise to [0, 1]: raw is typically in [-0.5, 0.5]
            score = max(0.0, min(1.0, 0.5 - raw))
            return score, "isolation_forest"

    def profile_snapshot(self, subject_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            p = self._profiles.get(subject_id)
            if p is None:
                return None
            return {
                "subjectId": subject_id,
                "eventCount": p.event_count,
                "hourHistogram": p.hour_histogram,
                "dayHistogram": p.day_histogram,
                "totalPayloadBytes": p.total_payload_bytes,
                "privChangeCount": p.priv_change_count,
                "failedAuthCount": p.failed_auth_count,
                "uniqueIpCount": p.unique_ip_count,
                "offHoursRatio": float(
                    sum(p.hour_histogram[h] for h in range(24) if h < 8 or h >= 18)
                    / max(p.event_count, 1)
                ),
                "driftScore": p.drift_score(),
                "lastUpdated": datetime.fromtimestamp(
                    p.last_updated, tz=timezone.utc
                ).isoformat(),
                "createdAt": datetime.fromtimestamp(
                    p.created_at, tz=timezone.utc
                ).isoformat(),
            }

    def cohort_stats(self) -> Dict[str, Any]:
        with self._lock:
            profiles = list(self._profiles.values())
            established = [p for p in profiles if p.event_count >= MIN_EVENTS_FOR_BASELINE]
            return {
                "totalProfiles": len(profiles),
                "establishedProfiles": len(established),
                "totalEvents": self._total_events,
                "modelTrained": self._model is not None,
                "modelTrainedAt": (
                    datetime.fromtimestamp(
                        self._model_trained_at, tz=timezone.utc
                    ).isoformat()
                    if self._model_trained_at
                    else None
                ),
            }


# Module-level singleton — shared across all requests
_store = UEBAModelStore()


def get_store() -> UEBAModelStore:
    return _store


# ─── Pydantic schemas ─────────────────────────────────────────────────────────


class RecordEventRequest(BaseModel):
    subject_id: str = Field(..., description="Unique user/entity identifier")
    occurred_at: Optional[datetime] = Field(
        None, description="Event timestamp (UTC). Defaults to now."
    )
    payload_bytes: float = Field(0.0, ge=0, description="Approximate payload size in bytes")
    is_priv_change: bool = Field(False, description="True if this is a privilege-change event")
    is_failed_auth: bool = Field(False, description="True if this is a failed authentication")
    source_ip: Optional[str] = Field(None, description="Source IP address of the request")


class ScoreRequest(BaseModel):
    subject_id: str


class BatchScoreRequest(BaseModel):
    subject_ids: List[str] = Field(..., max_length=500)


def _risk_tier(score: float) -> str:
    """Classify a combined anomaly score into a risk tier."""
    if score >= 0.9:
        return "CRITICAL"
    if score >= 0.7:
        return "HIGH"
    if score >= 0.4:
        return "MEDIUM"
    return "LOW"


class AnomalyScoreResponse(BaseModel):
    subject_id: str
    anomaly_score: float = Field(..., ge=0.0, le=1.0)
    drift_score: float = Field(..., ge=0.0, le=1.0)
    is_alert: bool
    reason: str
    risk_tier: str = Field(default="LOW", description="LOW | MEDIUM | HIGH | CRITICAL")
    scored_at: str


class BatchScoreResponse(BaseModel):
    results: List[AnomalyScoreResponse]
    cohort_stats: Dict[str, Any]


# ─── Route handlers ───────────────────────────────────────────────────────────


@router.post(
    "/record",
    summary="Record a user event for UEBA baseline",
    status_code=status.HTTP_202_ACCEPTED,
)
async def record_event(
    req: RecordEventRequest,
    store: UEBAModelStore = Depends(get_store),
) -> Dict[str, Any]:
    """
    Feed a single user event into the UEBA engine.
    Call this for every significant action (login, data access, privilege change, etc.).
    """
    ts = req.occurred_at or datetime.now(tz=timezone.utc)
    profile = store.record_event(
        subject_id=req.subject_id,
        ts=ts,
        payload_bytes=req.payload_bytes,
        is_priv_change=req.is_priv_change,
        is_failed_auth=req.is_failed_auth,
        source_ip=req.source_ip,
    )
    log.info(
        "ueba.event_recorded",
        subject_id=req.subject_id,
        event_count=profile.event_count,
    )
    return {
        "accepted": True,
        "subject_id": req.subject_id,
        "event_count": profile.event_count,
    }


@router.post(
    "/score",
    response_model=AnomalyScoreResponse,
    summary="Score a user's current behaviour against the cohort baseline",
)
async def score_user(
    req: ScoreRequest,
    store: UEBAModelStore = Depends(get_store),
) -> AnomalyScoreResponse:
    """
    Returns an anomaly score for the given user.
    Scores above 0.70 indicate potentially anomalous behaviour.
    """
    anomaly_score, reason = store.score(req.subject_id)
    profile = store._profiles.get(req.subject_id)
    drift = profile.drift_score() if profile else 0.0
    # Combine isolation forest score with drift score
    combined = min(1.0, anomaly_score * 0.7 + drift * 0.3)
    is_alert = combined >= ALERT_THRESHOLD
    if is_alert:
        log.warning(
            "ueba.anomaly_alert",
            subject_id=req.subject_id,
            anomaly_score=anomaly_score,
            drift_score=drift,
            combined=combined,
        )
    result = AnomalyScoreResponse(
        subject_id=req.subject_id,
        anomaly_score=round(combined, 4),
        drift_score=round(drift, 4),
        is_alert=is_alert,
        reason=reason,
        risk_tier=_risk_tier(combined),
        scored_at=datetime.now(tz=timezone.utc).isoformat(),
    )

    # Fire-and-forget: sink to OpenSearch + Kafka
    tenant_id = getattr(request.state, "tenant_id", "default") if hasattr(request, "state") else "default"
    profile_data = result.model_dump()

    async def _sink():
        try:
            opensearch_sink.sink_ueba_profile(req.subject_id, tenant_id, profile_data)
        except Exception as exc:
            log.warning("ueba.opensearch_sink_error", error=str(exc))
        if is_alert:
            try:
                kafka_producer.publish_ueba_alert(
                    req.subject_id, tenant_id, combined, "high" if combined >= 0.9 else "medium", profile_data
                )
            except Exception as exc:
                log.warning("ueba.kafka_publish_error", error=str(exc))

    asyncio.ensure_future(_sink())
    return result


@router.post(
    "/batch-score",
    response_model=BatchScoreResponse,
    summary="Score multiple users in a single request (scheduled sweep)",
)
async def batch_score(
    req: BatchScoreRequest,
    store: UEBAModelStore = Depends(get_store),
) -> BatchScoreResponse:
    """
    Score up to 500 users in a single call.
    Intended for nightly/hourly sweeps triggered by the Temporal scheduler.
    """
    results = []
    for sid in req.subject_ids:
        anomaly_score, reason = store.score(sid)
        profile = store._profiles.get(sid)
        drift = profile.drift_score() if profile else 0.0
        combined = min(1.0, anomaly_score * 0.7 + drift * 0.3)
        results.append(
            AnomalyScoreResponse(
                subject_id=sid,
                anomaly_score=round(combined, 4),
                drift_score=round(drift, 4),
                is_alert=combined >= ALERT_THRESHOLD,
                reason=reason,
                risk_tier=_risk_tier(combined),
                scored_at=datetime.now(tz=timezone.utc).isoformat(),
            )
        )
    return BatchScoreResponse(results=results, cohort_stats=store.cohort_stats())


@router.get(
    "/profile/{subject_id}",
    summary="Return the UEBA behaviour profile for a user",
)
async def get_profile(
    subject_id: str,
    store: UEBAModelStore = Depends(get_store),
) -> Dict[str, Any]:
    snap = store.profile_snapshot(subject_id)
    if snap is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No UEBA profile found for subject_id={subject_id!r}",
        )
    return snap


@router.get(
    "/drift/{subject_id}",
    summary="Return the behaviour drift score for a user",
)
async def get_drift(
    subject_id: str,
    store: UEBAModelStore = Depends(get_store),
) -> Dict[str, Any]:
    profile = store._profiles.get(subject_id)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No UEBA profile found for subject_id={subject_id!r}",
        )
    drift = profile.drift_score()
    return {
        "subject_id": subject_id,
        "drift_score": round(drift, 4),
        "is_alert": drift >= ALERT_THRESHOLD,
        "event_count": profile.event_count,
        "scored_at": datetime.now(tz=timezone.utc).isoformat(),
    }


@router.post(
    "/retrain",
    summary="Force immediate model retraining (admin only)",
    status_code=status.HTTP_200_OK,
)
async def force_retrain(
    store: UEBAModelStore = Depends(get_store),
) -> Dict[str, Any]:
    trained = store.force_retrain()
    stats = store.cohort_stats()
    return {"trained": trained, **stats}


@router.get(
    "/stats",
    summary="Return cohort statistics for the UEBA engine",
)
async def get_stats(
    store: UEBAModelStore = Depends(get_store),
) -> Dict[str, Any]:
    return store.cohort_stats()
