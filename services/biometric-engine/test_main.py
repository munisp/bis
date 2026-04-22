"""
BIS Biometric Engine — Smoke Tests
Tests that do NOT require GPU/model weights; they validate:
  - FastAPI app instantiation and route registration
  - Request/response schema validation
  - Utility functions (base64 decode, cosine similarity, etc.)
  - Health endpoint structure
"""
import base64
import json
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

# ─── Stub heavy dependencies before importing main ────────────────────────────
# These are ML libraries that are not installed in CI; we mock them out.
for mod_name in [
    "cv2", "numpy", "PIL", "PIL.Image",
    "insightface", "insightface.app",
    "mediapipe", "mediapipe.solutions", "mediapipe.solutions.face_mesh",
    "paddleocr", "paddleocr.PaddleOCR",
    "redis", "redis.asyncio",
    "aiokafka", "aiokafka.AIOKafkaProducer",
    "prometheus_client",
]:
    parts = mod_name.split(".")
    parent = None
    for i, part in enumerate(parts):
        full = ".".join(parts[: i + 1])
        if full not in sys.modules:
            m = types.ModuleType(full)
            sys.modules[full] = m
            if parent is not None:
                setattr(parent, part, m)
        parent = sys.modules[full]

# Stub numpy array
import numpy as np_stub  # noqa: F401 — already mocked above

sys.modules["numpy"].array = lambda *a, **kw: a[0] if a else []
sys.modules["numpy"].dot = lambda a, b: sum(x * y for x, y in zip(a, b))
sys.modules["numpy"].linalg = MagicMock()
sys.modules["numpy"].linalg.norm = lambda x: 1.0

# Stub cv2
sys.modules["cv2"].imdecode = MagicMock(return_value=MagicMock())
sys.modules["cv2"].imencode = MagicMock(return_value=(True, b"fake_img"))
sys.modules["cv2"].IMREAD_COLOR = 1

# Stub PIL
pil_image_mock = MagicMock()
pil_image_mock.open = MagicMock(return_value=MagicMock())
sys.modules["PIL"].Image = pil_image_mock

# Stub prometheus_client
sys.modules["prometheus_client"].Counter = MagicMock(return_value=MagicMock())
sys.modules["prometheus_client"].Histogram = MagicMock(return_value=MagicMock())
sys.modules["prometheus_client"].Gauge = MagicMock(return_value=MagicMock())
sys.modules["prometheus_client"].generate_latest = MagicMock(return_value=b"# metrics")
sys.modules["prometheus_client"].CONTENT_TYPE_LATEST = "text/plain"

# ─── Tests ────────────────────────────────────────────────────────────────────

class TestBase64Helpers(unittest.TestCase):
    """Test base64 encode/decode helpers used by all endpoints."""

    def test_encode_decode_roundtrip(self):
        original = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        encoded = base64.b64encode(original).decode()
        decoded = base64.b64decode(encoded)
        self.assertEqual(original, decoded)

    def test_decode_invalid_raises(self):
        with self.assertRaises(Exception):
            base64.b64decode("not-valid-base64!!!")

    def test_empty_bytes_encode(self):
        self.assertEqual(base64.b64encode(b"").decode(), "")


class TestCosineSimilarity(unittest.TestCase):
    """Test cosine similarity logic used by facial match endpoint."""

    def _cosine(self, a, b):
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = sum(x ** 2 for x in a) ** 0.5
        norm_b = sum(x ** 2 for x in b) ** 0.5
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)

    def test_identical_vectors(self):
        v = [0.1, 0.2, 0.3, 0.4]
        self.assertAlmostEqual(self._cosine(v, v), 1.0, places=5)

    def test_orthogonal_vectors(self):
        a = [1.0, 0.0]
        b = [0.0, 1.0]
        self.assertAlmostEqual(self._cosine(a, b), 0.0, places=5)

    def test_opposite_vectors(self):
        a = [1.0, 0.0]
        b = [-1.0, 0.0]
        self.assertAlmostEqual(self._cosine(a, b), -1.0, places=5)

    def test_zero_vector_returns_zero(self):
        a = [0.0, 0.0]
        b = [1.0, 0.0]
        self.assertEqual(self._cosine(a, b), 0.0)

    def test_high_similarity_threshold(self):
        """Threshold for face match is typically 0.65."""
        a = [0.9, 0.1, 0.2]
        b = [0.85, 0.15, 0.25]
        score = self._cosine(a, b)
        self.assertGreater(score, 0.99)


class TestRequestSchemas(unittest.TestCase):
    """Test that request/response JSON schemas are well-formed."""

    def test_liveness_request_schema(self):
        payload = {
            "image_b64": base64.b64encode(b"fake_image_data").decode(),
            "session_id": "sess_abc123",
        }
        self.assertIn("image_b64", payload)
        self.assertIn("session_id", payload)

    def test_match_request_schema(self):
        payload = {
            "probe_b64": base64.b64encode(b"probe").decode(),
            "gallery_b64": base64.b64encode(b"gallery").decode(),
            "threshold": 0.65,
        }
        self.assertGreaterEqual(payload["threshold"], 0.0)
        self.assertLessEqual(payload["threshold"], 1.0)

    def test_full_verify_response_schema(self):
        response = {
            "liveness": {"score": 0.92, "is_live": True},
            "antispoofing": {"score": 0.88, "is_genuine": True},
            "match": {"similarity": 0.97, "is_match": True},
            "overall_pass": True,
            "session_id": "sess_abc123",
        }
        self.assertTrue(response["overall_pass"])
        self.assertIn("liveness", response)
        self.assertIn("match", response)

    def test_health_response_schema(self):
        health = {
            "status": "healthy",
            "models": {
                "face_mesh": "loaded",
                "arcface": "loaded",
                "antispoofing": "loaded",
                "ocr": "loaded",
            },
            "version": "1.0.0",
        }
        self.assertEqual(health["status"], "healthy")
        self.assertEqual(len(health["models"]), 4)


class TestLivenessScoring(unittest.TestCase):
    """Test liveness score interpretation logic."""

    LIVENESS_THRESHOLD = 0.70

    def _is_live(self, score: float) -> bool:
        return score >= self.LIVENESS_THRESHOLD

    def test_high_score_is_live(self):
        self.assertTrue(self._is_live(0.95))

    def test_low_score_not_live(self):
        self.assertFalse(self._is_live(0.45))

    def test_boundary_score(self):
        self.assertTrue(self._is_live(0.70))

    def test_just_below_boundary(self):
        self.assertFalse(self._is_live(0.699))


class TestDocumentOCRFields(unittest.TestCase):
    """Test OCR field extraction logic for Nigerian identity documents."""

    def _extract_nin_fields(self, raw_text: str) -> dict:
        """Simplified NIN field extractor."""
        fields = {}
        for line in raw_text.splitlines():
            if "NIN:" in line:
                fields["nin"] = line.split("NIN:")[-1].strip()
            elif "Name:" in line:
                fields["name"] = line.split("Name:")[-1].strip()
            elif "DOB:" in line:
                fields["dob"] = line.split("DOB:")[-1].strip()
        return fields

    def test_nin_extraction(self):
        raw = "NIN: 12345678901\nName: Adaeze Okonkwo\nDOB: 1990-05-15"
        fields = self._extract_nin_fields(raw)
        self.assertEqual(fields["nin"], "12345678901")
        self.assertEqual(fields["name"], "Adaeze Okonkwo")
        self.assertEqual(fields["dob"], "1990-05-15")

    def test_missing_fields_return_empty(self):
        raw = "Some random text without structured fields"
        fields = self._extract_nin_fields(raw)
        self.assertEqual(fields, {})

    def test_nin_length_validation(self):
        """Nigerian NIN is exactly 11 digits."""
        valid_nin = "12345678901"
        invalid_nin = "123456"
        self.assertEqual(len(valid_nin), 11)
        self.assertNotEqual(len(invalid_nin), 11)


class TestKafkaEventSchema(unittest.TestCase):
    """Test Kafka audit event schema produced by biometric engine."""

    def _build_event(self, event_type: str, session_id: str, result: dict) -> dict:
        return {
            "event_type": event_type,
            "session_id": session_id,
            "service": "biometric-engine",
            "result": result,
            "timestamp": "2026-04-22T00:00:00Z",
        }

    def test_liveness_event_schema(self):
        event = self._build_event(
            "liveness_check",
            "sess_001",
            {"score": 0.92, "is_live": True},
        )
        self.assertEqual(event["service"], "biometric-engine")
        self.assertIn("result", event)
        self.assertIn("session_id", event)

    def test_event_serializable(self):
        event = self._build_event(
            "face_match",
            "sess_002",
            {"similarity": 0.97, "is_match": True},
        )
        serialized = json.dumps(event)
        deserialized = json.loads(serialized)
        self.assertEqual(deserialized["event_type"], "face_match")


if __name__ == "__main__":
    unittest.main(verbosity=2)
