"""
Tests for lex-matcher service.
Run with: pytest test_main.py -v
"""
import pytest
from fastapi.testclient import TestClient
from main import app, name_similarity, normalize_phone, hash_id_field

client = TestClient(app)
AUTH_HEADERS = {"Authorization": "Bearer lex-matcher-internal-key"}

# ── Unit tests ────────────────────────────────────────────────────────────────
class TestNameSimilarity:
    def test_exact_match(self):
        assert name_similarity("John Doe", "John Doe") == 1.0

    def test_case_insensitive(self):
        assert name_similarity("JOHN DOE", "john doe") == 1.0

    def test_word_order(self):
        score = name_similarity("Doe John", "John Doe")
        assert score >= 0.85, f"Expected >= 0.85, got {score}"

    def test_phonetic_variant(self):
        # Chukwuemeka vs Chukwuemeka — same name
        score = name_similarity("Chukwuemeka Obi", "Chukwuemeka Obi")
        assert score == 1.0

    def test_abbreviation(self):
        score = name_similarity("Emeka Obi", "Chukwuemeka Obi")
        assert score >= 0.50, f"Expected >= 0.50, got {score}"

    def test_completely_different(self):
        score = name_similarity("John Smith", "Amina Mohammed")
        assert score < 0.50, f"Expected < 0.50, got {score}"

    def test_empty_string(self):
        assert name_similarity("", "John Doe") == 0.0
        assert name_similarity("John Doe", "") == 0.0

    def test_typo_tolerance(self):
        score = name_similarity("Adebayo Okonkwo", "Adebayo Okonkwu")
        assert score >= 0.85, f"Expected >= 0.85, got {score}"


class TestNormalizePhone:
    def test_nigerian_0_prefix(self):
        assert normalize_phone("08012345678") == "+2348012345678"

    def test_international_format(self):
        assert normalize_phone("+2348012345678") == "+2348012345678"

    def test_234_prefix(self):
        assert normalize_phone("2348012345678") == "+2348012345678"

    def test_none(self):
        assert normalize_phone(None) is None

    def test_empty(self):
        assert normalize_phone("") is None


class TestHashIdField:
    def test_consistent_hash(self):
        h1 = hash_id_field("12345678901")
        h2 = hash_id_field("12345678901")
        assert h1 == h2

    def test_different_values(self):
        h1 = hash_id_field("12345678901")
        h2 = hash_id_field("12345678902")
        assert h1 != h2

    def test_none(self):
        assert hash_id_field(None) is None

    def test_strips_whitespace(self):
        h1 = hash_id_field("12345678901")
        h2 = hash_id_field("  12345678901  ")
        assert h1 == h2


# ── API tests ─────────────────────────────────────────────────────────────────
class TestHealthEndpoint:
    def test_health(self):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


class TestMatchEndpoint:
    def test_requires_auth(self):
        r = client.post("/match", json={"candidate": {}, "corpus": []})
        assert r.status_code == 401

    def test_exact_name_match(self):
        payload = {
            "candidate": {
                "id": 1, "referenceNumber": "LEX-001",
                "subjectName": "John Doe",
            },
            "corpus": [
                {"id": 2, "referenceNumber": "LEX-002", "subjectName": "John Doe"},
                {"id": 3, "referenceNumber": "LEX-003", "subjectName": "Jane Smith"},
            ],
            "threshold": 0.75,
        }
        r = client.post("/match", json=payload, headers=AUTH_HEADERS)
        assert r.status_code == 200
        data = r.json()
        assert len(data["matches"]) >= 1
        assert data["matches"][0]["reference_number"] == "LEX-002"
        assert data["matches"][0]["name_score"] == 1.0

    def test_nin_match_boosts_score(self):
        payload = {
            "candidate": {
                "id": 1, "referenceNumber": "LEX-001",
                "subjectName": "Adebayo Okonkwo",
                "subjectNin": "12345678901",
            },
            "corpus": [
                {
                    "id": 2, "referenceNumber": "LEX-002",
                    "subjectName": "Adebayo Okonkwo",
                    "subjectNin": "12345678901",
                },
            ],
            "threshold": 0.75,
        }
        r = client.post("/match", json=payload, headers=AUTH_HEADERS)
        assert r.status_code == 200
        data = r.json()
        assert data["is_duplicate"] is True
        assert data["matches"][0]["nin_match"] is True

    def test_no_matches_below_threshold(self):
        payload = {
            "candidate": {
                "id": 1, "referenceNumber": "LEX-001",
                "subjectName": "John Smith",
            },
            "corpus": [
                {"id": 2, "referenceNumber": "LEX-002", "subjectName": "Amina Mohammed"},
                {"id": 3, "referenceNumber": "LEX-003", "subjectName": "Emeka Okafor"},
            ],
            "threshold": 0.75,
        }
        r = client.post("/match", json=payload, headers=AUTH_HEADERS)
        assert r.status_code == 200
        data = r.json()
        assert len(data["matches"]) == 0
        assert data["is_duplicate"] is False

    def test_self_excluded(self):
        """Candidate should not match itself in corpus."""
        payload = {
            "candidate": {
                "id": 1, "referenceNumber": "LEX-001",
                "subjectName": "John Doe",
            },
            "corpus": [
                {"id": 1, "referenceNumber": "LEX-001", "subjectName": "John Doe"},
            ],
            "threshold": 0.75,
        }
        r = client.post("/match", json=payload, headers=AUTH_HEADERS)
        assert r.status_code == 200
        assert len(r.json()["matches"]) == 0


class TestDeduplicateEndpoint:
    def test_requires_auth(self):
        r = client.post("/deduplicate", json={"candidate": {}, "corpus": []})
        assert r.status_code == 401

    def test_strict_nin_duplicate(self):
        payload = {
            "candidate": {
                "id": 1, "referenceNumber": "LEX-001",
                "subjectName": "Emeka Okafor",
                "subjectNin": "99988877766",
            },
            "corpus": [
                {
                    "id": 2, "referenceNumber": "LEX-002",
                    "subjectName": "Emeka Okafor",
                    "subjectNin": "99988877766",
                },
            ],
            "strict": True,
        }
        r = client.post("/deduplicate", json=payload, headers=AUTH_HEADERS)
        assert r.status_code == 200
        data = r.json()
        assert data["is_duplicate"] is True
        assert data["duplicate_of"] == "LEX-002"
        assert data["confidence"] == 1.0

    def test_not_duplicate(self):
        payload = {
            "candidate": {
                "id": 1, "referenceNumber": "LEX-001",
                "subjectName": "John Smith",
            },
            "corpus": [
                {"id": 2, "referenceNumber": "LEX-002", "subjectName": "Amina Mohammed"},
            ],
            "strict": False,
        }
        r = client.post("/deduplicate", json=payload, headers=AUTH_HEADERS)
        assert r.status_code == 200
        assert r.json()["is_duplicate"] is False


class TestCrossRefEndpoint:
    def test_requires_auth(self):
        r = client.post("/cross-ref", json={"corpus": []})
        assert r.status_code == 401

    def test_nin_cross_ref(self):
        payload = {
            "nin": "12345678901",
            "corpus": [
                {"id": 1, "referenceNumber": "LEX-001", "subjectName": "A", "subjectNin": "12345678901"},
                {"id": 2, "referenceNumber": "LEX-002", "subjectName": "B", "subjectNin": "99999999999"},
            ],
        }
        r = client.post("/cross-ref", json=payload, headers=AUTH_HEADERS)
        assert r.status_code == 200
        data = r.json()
        assert data["nin_hits"] == 1
        assert len(data["hits"]) == 1
        assert data["hits"][0]["referenceNumber"] == "LEX-001"

    def test_phone_cross_ref(self):
        payload = {
            "phone": "08012345678",
            "corpus": [
                {"id": 1, "referenceNumber": "LEX-001", "subjectName": "A", "subjectPhone": "+2348012345678"},
                {"id": 2, "referenceNumber": "LEX-002", "subjectName": "B", "subjectPhone": "08099999999"},
            ],
        }
        r = client.post("/cross-ref", json=payload, headers=AUTH_HEADERS)
        assert r.status_code == 200
        data = r.json()
        assert data["phone_hits"] == 1
        assert data["hits"][0]["referenceNumber"] == "LEX-001"
