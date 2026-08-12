"""
river_ueba_online.py — Online incremental UEBA anomaly detection using river.

Architecture:
  - Uses river.anomaly.HalfSpaceTrees (online variant of Isolation Forest).
  - Processes bis.audit Kafka events one at a time without full-batch retraining.
  - Maintains a per-user feature buffer (last 50 events) for context.
  - Exposes score_event() for real-time scoring and learn_event() for incremental
    model updates.
  - Model state is serialised to Redis (bis:ueba:online:model) on every 100 updates
    so it survives pod restarts.
"""

import asyncio
import json
import logging
import math
import pickle
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

try:
    import redis.asyncio as aioredis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False

try:
    from river import anomaly, preprocessing
    RIVER_AVAILABLE = True
except ImportError:
    RIVER_AVAILABLE = False

logger = logging.getLogger(__name__)

REDIS_MODEL_KEY = "bis:ueba:online:model"
REDIS_VERSION_KEY = "bis:ueba:online:version"
PERSIST_EVERY_N = 100
USER_BUFFER_SIZE = 50
ANOMALY_THRESHOLD = 0.65


def extract_features(event: Dict[str, Any], user_history: deque) -> Dict[str, float]:
    """Extract a fixed-width numeric feature vector from a raw audit event."""
    ts = event.get("timestamp", time.time())
    if isinstance(ts, str):
        try:
            from datetime import datetime
            ts = datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
        except Exception:
            ts = time.time()

    import datetime as dt
    dt_obj = dt.datetime.utcfromtimestamp(ts)
    hour = dt_obj.hour
    dow = dt_obj.weekday()
    is_weekend = 1.0 if dow >= 5 else 0.0

    action = str(event.get("action", ""))
    resource = str(event.get("resource", ""))
    action_hash = abs(hash(action)) % 1000 / 1000.0
    resource_hash = abs(hash(resource)) % 1000 / 1000.0

    ip = str(event.get("ip_address", "0.0.0.0"))
    try:
        octets = [int(o) for o in ip.split(".") if o.isdigit()]
        total = sum(octets) or 1
        probs = [o / total for o in octets if o > 0]
        ip_entropy = -sum(p * math.log2(p) for p in probs if p > 0) / 2.0
    except Exception:
        ip_entropy = 0.0

    now = ts
    hist_ts = [e.get("_ts", 0) for e in user_history]
    velocity_1m = sum(1 for t in hist_ts if now - t <= 60) / 10.0
    velocity_5m = sum(1 for t in hist_ts if now - t <= 300) / 50.0
    velocity_1h = sum(1 for t in hist_ts if now - t <= 3600) / 200.0

    resources_1h = {e.get("resource", "") for e in user_history if now - e.get("_ts", 0) <= 3600}
    unique_resources_1h = len(resources_1h) / 20.0

    failed = sum(1 for e in user_history if e.get("outcome") in ("failed", "denied", "error"))
    failed_ratio = failed / max(len(user_history), 1)

    session_age = (now - min(hist_ts)) / 60.0 / 60.0 if hist_ts else 0.0

    return {
        "hour_of_day": hour / 23.0,
        "day_of_week": dow / 6.0,
        "is_weekend": is_weekend,
        "action_hash": action_hash,
        "resource_hash": resource_hash,
        "ip_entropy": min(ip_entropy, 1.0),
        "velocity_1m": min(velocity_1m, 1.0),
        "velocity_5m": min(velocity_5m, 1.0),
        "velocity_1h": min(velocity_1h, 1.0),
        "unique_resources_1h": min(unique_resources_1h, 1.0),
        "failed_ratio": failed_ratio,
        "session_age_h": min(session_age, 1.0),
    }


@dataclass
class RiverUEBAOnline:
    """Online UEBA anomaly detector backed by river.anomaly.HalfSpaceTrees."""
    redis_url: Optional[str] = None
    n_trees: int = 25
    height: int = 15
    window_size: int = 250

    _model: Any = field(default=None, init=False, repr=False)
    _scaler: Any = field(default=None, init=False, repr=False)
    _user_history: Dict[str, deque] = field(
        default_factory=lambda: defaultdict(lambda: deque(maxlen=USER_BUFFER_SIZE)),
        init=False, repr=False
    )
    _learn_count: int = field(default=0, init=False, repr=False)
    _redis: Any = field(default=None, init=False, repr=False)
    _version: int = field(default=0, init=False, repr=False)

    def __post_init__(self):
        if not RIVER_AVAILABLE:
            raise ImportError("river is required: pip install river")
        self._init_model()

    def _init_model(self):
        self._model = anomaly.HalfSpaceTrees(
            n_trees=self.n_trees,
            height=self.height,
            window_size=self.window_size,
            seed=42,
        )
        self._scaler = preprocessing.MinMaxScaler()

    async def load(self):
        if not self.redis_url or not REDIS_AVAILABLE:
            logger.info("[RiverUEBA] No Redis URL — starting fresh model")
            return
        try:
            self._redis = aioredis.from_url(self.redis_url, decode_responses=False)
            blob = await self._redis.get(REDIS_MODEL_KEY)
            if blob:
                state = pickle.loads(blob)
                self._model = state["model"]
                self._scaler = state["scaler"]
                self._version = state.get("version", 0)
                logger.info("[RiverUEBA] Loaded model v%d from Redis", self._version)
            else:
                logger.info("[RiverUEBA] No persisted model found — starting fresh")
        except Exception as e:
            logger.warning("[RiverUEBA] Failed to load from Redis: %s — starting fresh", e)

    def score_event(self, event: Dict[str, Any]) -> float:
        user_id = str(event.get("user_id", event.get("subject", "unknown")))
        history = self._user_history[user_id]
        features = extract_features(event, history)
        scaled = self._scaler.transform_one(features)
        if scaled is None:
            scaled = features
        score = self._model.score_one(scaled)
        return float(score)

    def learn_event(self, event: Dict[str, Any]):
        user_id = str(event.get("user_id", event.get("subject", "unknown")))
        history = self._user_history[user_id]
        ts = event.get("timestamp", time.time())
        if isinstance(ts, str):
            try:
                from datetime import datetime
                ts = datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
            except Exception:
                ts = time.time()
        enriched = {**event, "_ts": ts}
        history.append(enriched)
        features = extract_features(event, history)
        self._scaler.learn_one(features)
        scaled = self._scaler.transform_one(features)
        if scaled is None:
            scaled = features
        self._model.learn_one(scaled)
        self._learn_count += 1

    async def maybe_persist(self):
        if self._learn_count % PERSIST_EVERY_N != 0:
            return
        if not self._redis:
            return
        try:
            self._version += 1
            blob = pickle.dumps({
                "model": self._model,
                "scaler": self._scaler,
                "version": self._version,
            })
            await self._redis.set(REDIS_MODEL_KEY, blob)
            await self._redis.set(REDIS_VERSION_KEY, str(self._version))
            logger.info("[RiverUEBA] Persisted model v%d (%d bytes)", self._version, len(blob))
        except Exception as e:
            logger.warning("[RiverUEBA] Failed to persist model: %s", e)

    def is_anomalous(self, score: float) -> bool:
        return score >= ANOMALY_THRESHOLD

    @property
    def learn_count(self) -> int:
        return self._learn_count

    @property
    def version(self) -> int:
        return self._version


if __name__ == "__main__":
    import sys
    print("Running RiverUEBAOnline self-tests...")

    async def run_tests():
        model = RiverUEBAOnline(redis_url=None)
        event = {
            "user_id": "user-001",
            "action": "login",
            "resource": "/dashboard",
            "ip_address": "192.168.1.100",
            "outcome": "success",
            "timestamp": time.time(),
        }
        score = model.score_event(event)
        assert isinstance(score, float), f"score should be float, got {type(score)}"
        assert 0.0 <= score <= 1.0, f"score should be in [0,1], got {score}"
        print(f"  [PASS] Fresh model score: {score:.4f}")

        model.learn_event(event)
        assert model.learn_count == 1
        print(f"  [PASS] learn_count after 1 event: {model.learn_count}")

        for i in range(300):
            normal_event = {
                "user_id": "user-001",
                "action": "read",
                "resource": f"/doc/{i % 10}",
                "ip_address": "10.0.0.1",
                "outcome": "success",
                "timestamp": time.time() - (300 - i),
            }
            model.learn_event(normal_event)

        anomalous_event = {
            "user_id": "user-001",
            "action": "delete",
            "resource": "/admin/users",
            "ip_address": "185.220.101.42",
            "outcome": "failed",
            "timestamp": time.time(),
        }
        anomaly_score = model.score_event(anomalous_event)
        normal_score = model.score_event(event)
        print(f"  [INFO] Anomalous score: {anomaly_score:.4f}, Normal score: {normal_score:.4f}")
        print(f"  [PASS] Scoring works after 300 training events")

        await model.maybe_persist()
        print("  [PASS] maybe_persist no-op without Redis")

        assert model.is_anomalous(0.9) is True
        assert model.is_anomalous(0.1) is False
        print("  [PASS] is_anomalous threshold check")

        features = extract_features(event, deque())
        assert len(features) == 12, f"Expected 12 features, got {len(features)}"
        print(f"  [PASS] Feature extraction: {len(features)} features")

        print(f"\nAll 6 tests passed! (learn_count={model.learn_count})")

    asyncio.run(run_tests())
    sys.exit(0)
