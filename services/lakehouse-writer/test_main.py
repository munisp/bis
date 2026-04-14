"""
test_main.py — pytest suite for bis-lakehouse-writer
Tests the data models, utility functions, and API endpoints.
"""
import json
import os
import sys
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

# ─── Patch heavy dependencies before importing main ──────────────────────────
sys.modules.setdefault("duckdb", MagicMock())
sys.modules.setdefault("pandas", MagicMock())
sys.modules.setdefault("pyarrow", MagicMock())
sys.modules.setdefault("deltalake", MagicMock())
sys.modules.setdefault("aiokafka", MagicMock())

os.environ.setdefault("LAKEHOUSE_BASE_PATH", "/tmp/test-lakehouse")
os.environ.setdefault("BIS_GATEWAY_KEY", "test-gateway-key-lakehouse")

from fastapi.testclient import TestClient
import main as lw

client = TestClient(lw.app)

# ─── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def mock_write_row():
    with patch.object(lw, "write_row", return_value=None) as m:
        yield m

@pytest.fixture(autouse=True)
def mock_ensure_table_dirs():
    with patch.object(lw, "ensure_table_dirs", return_value=None):
        yield

# ─── Health endpoint ─────────────────────────────────────────────────────────

class TestHealthEndpoint:
    def test_health_returns_200(self):
        with patch.object(lw, "get_row_count", return_value=0):
            resp = client.get("/health")
        assert resp.status_code == 200

    def test_health_returns_ok_status(self):
        with patch.object(lw, "get_row_count", return_value=5):
            resp = client.get("/health")
        data = resp.json()
        assert data["status"] == "ok"

    def test_health_contains_service_name(self):
        with patch.object(lw, "get_row_count", return_value=0):
            resp = client.get("/health")
        data = resp.json()
        assert "lakehouse" in data.get("service", "").lower()

    def test_health_contains_tables_list(self):
        with patch.object(lw, "get_row_count", return_value=0):
            resp = client.get("/health")
        data = resp.json()
        assert "tables" in data
        assert isinstance(data["tables"], list)

# ─── Tables endpoint ─────────────────────────────────────────────────────────

class TestTablesEndpoint:
    def test_tables_returns_200(self):
        with patch.object(lw, "get_row_count", return_value=10):
            resp = client.get("/tables")
        assert resp.status_code == 200

    def test_tables_returns_dict_with_tables(self):
        with patch.object(lw, "get_row_count", return_value=10):
            resp = client.get("/tables")
        data = resp.json()
        # /tables returns a dict with "tables" key
        assert "tables" in data

    def test_tables_contains_expected_table_names(self):
        with patch.object(lw, "get_row_count", return_value=0):
            resp = client.get("/tables")
        data = resp.json()
        # /tables returns {"tables": [{"table": "investigations", ...}, ...]}
        tables = data.get("tables", []) if isinstance(data, dict) else data
        # Each entry uses "table" key (not "name")
        table_names = [t.get("table", t.get("name", str(t))) if isinstance(t, dict) else str(t) for t in tables]
        assert "investigations" in table_names
        assert "alerts" in table_names
        assert "kyc" in table_names

# ─── InvestigationRow model ───────────────────────────────────────────────────

class TestInvestigationRowModel:
    def test_valid_investigation_row(self):
        row = lw.InvestigationRow(
            id=1,
            ref="INV-2026-001",
            subject_name="John Doe",
            subject_type="individual",
            status="open",
            priority="high",
        )
        assert row.id == 1
        assert row.ref == "INV-2026-001"
        assert row.subject_name == "John Doe"

    def test_investigation_row_defaults(self):
        row = lw.InvestigationRow(
            id=2,
            ref="INV-2026-002",
            subject_name="Jane Smith",
        )
        assert row.country == "NG"
        assert row.status == "open"
        assert row.priority == "medium"

    def test_investigation_row_risk_score_default(self):
        row = lw.InvestigationRow(
            id=3,
            ref="INV-2026-003",
            subject_name="Test Corp",
        )
        assert row.risk_score == 0.0
        assert row.risk_tier == "low"

# ─── AlertRow model ──────────────────────────────────────────────────────────

class TestAlertRowModel:
    def test_valid_alert_row(self):
        row = lw.AlertRow(
            id=1,
            title="AML Alert: Suspicious Transaction",
            type="aml",
            severity="high",
        )
        assert row.id == 1
        assert row.severity == "high"
        assert row.title == "AML Alert: Suspicious Transaction"

    def test_alert_row_defaults(self):
        row = lw.AlertRow(
            id=2,
            title="Test Alert",
        )
        assert row.read is False
        assert row.acknowledged is False
        assert row.resolved is False
        assert row.dismissed is False

# ─── KycRow model ────────────────────────────────────────────────────────────

class TestKycRowModel:
    def test_valid_kyc_row(self):
        row = lw.KycRow(
            id=1,
            subject_name="Alice Corp",
            status="verified",
        )
        assert row.id == 1
        assert row.subject_name == "Alice Corp"
        assert row.status == "verified"

    def test_kyc_row_optional_fields(self):
        row = lw.KycRow(
            id=2,
            subject_name="Bob Ltd",
        )
        assert row.nin is None
        assert row.bvn is None
        assert row.status == "pending"

# ─── Ingest investigation endpoint ───────────────────────────────────────────

class TestIngestInvestigation:
    def test_ingest_investigation_success(self, mock_write_row):
        payload = {
            "id": 101,
            "ref": "INV-2026-TEST",
            "subject_name": "Test Subject",
            "subject_type": "individual",
            "status": "open",
            "priority": "high",
        }
        resp = client.post("/ingest/investigation", json=payload)
        assert resp.status_code == 200
        mock_write_row.assert_called_once()

    def test_ingest_investigation_calls_write_row_with_correct_table(self, mock_write_row):
        payload = {
            "id": 102,
            "ref": "INV-2026-002",
            "subject_name": "Test Corp",
        }
        client.post("/ingest/investigation", json=payload)
        args = mock_write_row.call_args
        assert args[0][0] == "investigations"

    def test_ingest_investigation_missing_required_fields(self):
        resp = client.post("/ingest/investigation", json={"ref": "INV-003"})
        assert resp.status_code == 422

# ─── Ingest alert endpoint ───────────────────────────────────────────────────

class TestIngestAlert:
    def test_ingest_alert_success(self, mock_write_row):
        payload = {
            "id": 201,
            "title": "Critical AML Alert",
            "type": "aml",
            "severity": "critical",
        }
        resp = client.post("/ingest/alert", json=payload)
        assert resp.status_code == 200
        mock_write_row.assert_called_once()

    def test_ingest_alert_calls_write_row_with_alerts_table(self, mock_write_row):
        payload = {
            "id": 202,
            "title": "Sanctions Hit",
            "type": "sanctions",
            "severity": "high",
        }
        client.post("/ingest/alert", json=payload)
        args = mock_write_row.call_args
        assert args[0][0] == "alerts"

# ─── Ingest KYC endpoint ─────────────────────────────────────────────────────

class TestIngestKyc:
    def test_ingest_kyc_success(self, mock_write_row):
        payload = {
            "id": 301,
            "subject_name": "Test Corp Ltd",
            "status": "verified",
        }
        resp = client.post("/ingest/kyc", json=payload)
        assert resp.status_code == 200
        mock_write_row.assert_called_once()

    def test_ingest_kyc_calls_write_row_with_kyc_table(self, mock_write_row):
        payload = {
            "id": 302,
            "subject_name": "Another Corp",
        }
        client.post("/ingest/kyc", json=payload)
        args = mock_write_row.call_args
        assert args[0][0] == "kyc"

# ─── DuckDB query endpoint ────────────────────────────────────────────────────

class TestDuckDBQuery:
    def test_query_duckdb_success(self):
        mock_results = [{'id': 1, 'ref': 'INV-2026-001'}]
        with patch.object(lw, "run_duckdb_query", return_value=mock_results):
            resp = client.post("/query/duckdb", json={"sql": "SELECT * FROM investigations LIMIT 10"})
        assert resp.status_code == 200
        data = resp.json()
        # /query/duckdb returns {"ok": True, "row_count": N, "rows": [...]}
        if isinstance(data, dict):
            assert data.get("ok") is True
            assert "rows" in data
        else:
            assert isinstance(data, list)

    def test_query_duckdb_rejects_drop_statement(self):
        resp = client.post("/query/duckdb", json={"sql": "DROP TABLE investigations"})
        assert resp.status_code in (400, 422, 500)

    def test_query_duckdb_rejects_insert_statement(self):
        resp = client.post("/query/duckdb", json={"sql": "INSERT INTO investigations VALUES (1)"})
        assert resp.status_code in (400, 422, 500)

# ─── Utility functions ────────────────────────────────────────────────────────

class TestUtilityFunctions:
    def test_partition_cols_returns_dict(self):
        ts = datetime(2026, 4, 14, 10, 30, 0, tzinfo=timezone.utc)
        result = lw._partition_cols(ts)
        assert isinstance(result, dict)
        assert result.get("year") == 2026
        assert result.get("month") == 4
        assert result.get("day") == 14

    def test_partition_cols_different_dates(self):
        ts1 = datetime(2026, 1, 1, tzinfo=timezone.utc)
        ts2 = datetime(2026, 12, 31, tzinfo=timezone.utc)
        r1 = lw._partition_cols(ts1)
        r2 = lw._partition_cols(ts2)
        assert r1["month"] == 1
        assert r2["month"] == 12
        assert r1["day"] == 1
        assert r2["day"] == 31

    def test_partition_cols_year_boundary(self):
        ts = datetime(2025, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
        result = lw._partition_cols(ts)
        assert result["year"] == 2025
        assert result["month"] == 12
        assert result["day"] == 31
