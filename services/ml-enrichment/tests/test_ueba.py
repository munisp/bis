"""
tests/test_ueba.py — Unit tests for the UEBA router and UEBAModelStore.
"""
from __future__ import annotations

import math
import time
from datetime import datetime, timezone

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.routers.ueba import (
    MIN_EVENTS_FOR_BASELINE,
    ALERT_THRESHOLD,
    UEBAModelStore,
    UserBehaviourProfile,
    _entropy,
    router,
)
from fastapi import FastAPI

# ─── Helpers ──────────────────────────────────────────────────────────────────

def make_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/ueba")
    return app


def _ts(hour: int = 10) -> datetime:
    return datetime(2024, 6, 15, hour, 0, 0, tzinfo=timezone.utc)


def _populate_store(store: UEBAModelStore, subject_id: str, n: int = MIN_EVENTS_FOR_BASELINE + 5) -> None:
    """Feed n normal business-hours events for a user."""
    for i in range(n):
        store.record_event(
            subject_id=subject_id,
            ts=_ts(hour=9 + (i % 8)),  # 09:00–16:00
            payload_bytes=1024.0,
            source_ip="10.0.0.1",
        )


# ─── Unit tests: UserBehaviourProfile ─────────────────────────────────────────

class TestUserBehaviourProfile:
    def test_initial_state(self):
        p = UserBehaviourProfile(subject_id="u1")
        assert p.event_count == 0
        assert p.unique_ip_count == 0
        assert p.priv_change_count == 0
        assert p.failed_auth_count == 0

    def test_record_event_increments_count(self):
        p = UserBehaviourProfile(subject_id="u1")
        p.record_event(ts=_ts(10))
        assert p.event_count == 1

    def test_hour_histogram_updated(self):
        p = UserBehaviourProfile(subject_id="u1")
        p.record_event(ts=_ts(14))
        assert p.hour_histogram[14] == 1.0

    def test_day_histogram_updated(self):
        p = UserBehaviourProfile(subject_id="u1")
        # 2024-06-15 is a Saturday (weekday=5)
        p.record_event(ts=_ts(10))
        assert p.day_histogram[5] == 1.0

    def test_unique_ip_tracking(self):
        p = UserBehaviourProfile(subject_id="u1")
        p.record_event(ts=_ts(10), source_ip="1.2.3.4")
        p.record_event(ts=_ts(11), source_ip="1.2.3.4")
        p.record_event(ts=_ts(12), source_ip="5.6.7.8")
        assert p.unique_ip_count == 2

    def test_priv_change_flag(self):
        p = UserBehaviourProfile(subject_id="u1")
        p.record_event(ts=_ts(10), is_priv_change=True)
        assert p.priv_change_count == 1

    def test_failed_auth_flag(self):
        p = UserBehaviourProfile(subject_id="u1")
        p.record_event(ts=_ts(10), is_failed_auth=True)
        assert p.failed_auth_count == 1

    def test_feature_vector_length(self):
        p = UserBehaviourProfile(subject_id="u1")
        for i in range(MIN_EVENTS_FOR_BASELINE):
            p.record_event(ts=_ts(9 + i % 8))
        fv = p.feature_vector()
        # 1(event_count) + 1(avg_per_hour) + 7(day_norm) + 1(hour_entropy) + 1(day_entropy)
        # + 1(avg_payload) + 1(priv_rate) + 1(failed_auth_rate) + 1(unique_ip) + 1(off_hours) + 1(weekend) = 17
        assert fv.shape == (17,)
        assert not np.any(np.isnan(fv))
        assert not np.any(np.isinf(fv))

    def test_drift_score_zero_insufficient_history(self):
        p = UserBehaviourProfile(subject_id="u1")
        p.record_event(ts=_ts(10))
        assert p.drift_score() == 0.0

    def test_drift_score_stable_behaviour(self):
        p = UserBehaviourProfile(subject_id="u1")
        # All events at the same hour → very stable
        for _ in range(50):
            p.record_event(ts=_ts(10))
        score = p.drift_score()
        assert 0.0 <= score <= 1.0


# ─── Unit tests: _entropy ─────────────────────────────────────────────────────

class TestEntropy:
    def test_uniform_distribution_max_entropy(self):
        counts = [1.0] * 8
        e = _entropy(counts)
        assert abs(e - 3.0) < 0.01  # log2(8) = 3

    def test_single_bucket_zero_entropy(self):
        counts = [0.0] * 7 + [10.0]
        e = _entropy(counts)
        assert e == 0.0

    def test_empty_zero_entropy(self):
        assert _entropy([0.0, 0.0]) == 0.0


# ─── Unit tests: UEBAModelStore ───────────────────────────────────────────────

class TestUEBAModelStore:
    def test_get_or_create_profile(self):
        store = UEBAModelStore()
        p = store.get_or_create_profile("u1")
        assert p.subject_id == "u1"
        # Second call returns same object
        assert store.get_or_create_profile("u1") is p

    def test_record_event_creates_profile(self):
        store = UEBAModelStore()
        store.record_event("u1", _ts(10))
        assert "u1" in store._profiles

    def test_score_no_profile_returns_zero(self):
        store = UEBAModelStore()
        score, reason = store.score("nobody")
        assert score == 0.0
        assert reason == "no_profile"

    def test_score_insufficient_history(self):
        store = UEBAModelStore()
        store.record_event("u1", _ts(10))
        score, reason = store.score("u1")
        assert score == 0.0
        assert reason == "insufficient_history"

    def test_score_model_not_ready(self):
        store = UEBAModelStore()
        _populate_store(store, "u1")
        # Model not trained yet (cohort too small)
        score, reason = store.score("u1")
        assert score == 0.0
        assert reason == "model_not_ready"

    def test_force_retrain_with_sufficient_cohort(self):
        store = UEBAModelStore()
        for i in range(6):
            _populate_store(store, f"user_{i}")
        trained = store.force_retrain()
        assert trained is True
        assert store._model is not None

    def test_score_after_training(self):
        store = UEBAModelStore()
        for i in range(6):
            _populate_store(store, f"user_{i}")
        store.force_retrain()
        score, reason = store.score("user_0")
        assert reason == "isolation_forest"
        assert 0.0 <= score <= 1.0

    def test_profile_snapshot_returns_dict(self):
        store = UEBAModelStore()
        _populate_store(store, "u1")
        snap = store.profile_snapshot("u1")
        assert snap is not None
        assert snap["subjectId"] == "u1"
        assert "hourHistogram" in snap
        assert "driftScore" in snap

    def test_profile_snapshot_missing_returns_none(self):
        store = UEBAModelStore()
        assert store.profile_snapshot("nobody") is None

    def test_cohort_stats(self):
        store = UEBAModelStore()
        _populate_store(store, "u1")
        stats = store.cohort_stats()
        assert stats["totalProfiles"] == 1
        assert stats["totalEvents"] >= MIN_EVENTS_FOR_BASELINE


# ─── Integration tests: FastAPI endpoints ─────────────────────────────────────

class TestUEBAEndpoints:
    def setup_method(self):
        self.app = make_app()
        self.client = TestClient(self.app)

    def test_record_event_returns_202(self):
        resp = self.client.post(
            "/api/v1/ueba/record",
            json={"subject_id": "u1"},
        )
        assert resp.status_code == 202
        body = resp.json()
        assert body["accepted"] is True
        assert body["subject_id"] == "u1"

    def test_score_unknown_user_returns_200(self):
        resp = self.client.post(
            "/api/v1/ueba/score",
            json={"subject_id": "nobody"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["anomaly_score"] == 0.0
        assert body["is_alert"] is False

    def test_profile_missing_returns_404(self):
        resp = self.client.get("/api/v1/ueba/profile/nobody")
        assert resp.status_code == 404

    def test_drift_missing_returns_404(self):
        resp = self.client.get("/api/v1/ueba/drift/nobody")
        assert resp.status_code == 404

    def test_stats_returns_cohort_info(self):
        resp = self.client.get("/api/v1/ueba/stats")
        assert resp.status_code == 200
        body = resp.json()
        assert "totalProfiles" in body

    def test_batch_score_empty_list(self):
        resp = self.client.post(
            "/api/v1/ueba/batch-score",
            json={"subject_ids": []},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["results"] == []

    def test_retrain_endpoint(self):
        resp = self.client.post("/api/v1/ueba/retrain")
        assert resp.status_code == 200
        body = resp.json()
        assert "trained" in body
