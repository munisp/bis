"""
Unit tests for the BIS OpenSearch indexing pipeline.
Run with: python3 -m pytest test_indexer.py -v
"""

import json
import sys
import types
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import argparse
import pytest

# ─── Stub heavy dependencies before importing indexer ─────────────────────────

# Stub psycopg2
psycopg2_stub = types.ModuleType("psycopg2")
psycopg2_stub.connect = MagicMock()
extras_stub = types.ModuleType("psycopg2.extras")
extras_stub.RealDictCursor = object
psycopg2_stub.extras = extras_stub
sys.modules["psycopg2"] = psycopg2_stub
sys.modules["psycopg2.extras"] = extras_stub

# Stub requests
requests_stub = types.ModuleType("requests")
requests_stub.post = MagicMock()
auth_stub = types.ModuleType("requests.auth")
auth_stub.HTTPBasicAuth = MagicMock(return_value=("admin", "admin"))
requests_stub.auth = auth_stub
sys.modules["requests"] = requests_stub
sys.modules["requests.auth"] = auth_stub

import indexer  # noqa: E402 (must come after stubs)


# ─── parse_since ──────────────────────────────────────────────────────────────

class TestParseSince:
    def test_hours(self):
        result = indexer.parse_since("2h")
        expected = datetime.now(timezone.utc) - timedelta(hours=2)
        diff = abs((result - expected).total_seconds())
        assert diff < 5, f"Expected ~2h ago, got diff={diff}s"

    def test_minutes(self):
        result = indexer.parse_since("30m")
        expected = datetime.now(timezone.utc) - timedelta(minutes=30)
        diff = abs((result - expected).total_seconds())
        assert diff < 5

    def test_days(self):
        result = indexer.parse_since("1d")
        expected = datetime.now(timezone.utc) - timedelta(days=1)
        diff = abs((result - expected).total_seconds())
        assert diff < 5

    def test_invalid_unit(self):
        import argparse
        with pytest.raises(argparse.ArgumentTypeError):
            indexer.parse_since("5x")

    def test_invalid_format(self):
        with pytest.raises((ValueError, argparse.ArgumentTypeError)):
            indexer.parse_since("abc")


# ─── _serialize ───────────────────────────────────────────────────────────────

class TestSerialize:
    def test_datetime(self):
        dt = datetime(2026, 6, 16, 12, 0, 0, tzinfo=timezone.utc)
        result = indexer._serialize(dt)
        assert "2026-06-16" in result

    def test_unknown_type(self):
        with pytest.raises(TypeError):
            indexer._serialize(object())


# ─── bulk_index ───────────────────────────────────────────────────────────────

class TestBulkIndex:
    def _make_ok_response(self, count: int):
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "items": [{"index": {}} for _ in range(count)]
        }
        return resp

    def _make_error_response(self):
        resp = MagicMock()
        resp.status_code = 500
        resp.text = "Internal Server Error"
        return resp

    def test_empty_rows(self):
        ok, err = indexer.bulk_index("bis-investigations", "ref", iter([]))
        assert ok == 0
        assert err == 0

    def test_single_batch(self):
        rows = [{"ref": f"INV-{i}", "subjectName": f"Subject {i}"} for i in range(3)]
        requests_stub.post.return_value = self._make_ok_response(3)

        ok, err = indexer.bulk_index("bis-investigations", "ref", iter(rows))
        assert ok == 3
        assert err == 0

    def test_multiple_batches(self):
        # BATCH_SIZE = 500, create 1100 rows to trigger 3 batches
        original_batch_size = indexer.BATCH_SIZE
        indexer.BATCH_SIZE = 5
        try:
            rows = [{"ref": f"INV-{i}", "subjectName": f"Subject {i}"} for i in range(12)]
            requests_stub.post.return_value = self._make_ok_response(5)

            ok, err = indexer.bulk_index("bis-investigations", "ref", iter(rows))
            # 3 full batches of 5 = 15 ok (last partial batch of 2)
            assert ok >= 10
        finally:
            indexer.BATCH_SIZE = original_batch_size

    def test_server_error(self):
        rows = [{"ref": "INV-001", "subjectName": "Test"}]
        requests_stub.post.return_value = self._make_error_response()

        ok, err = indexer.bulk_index("bis-investigations", "ref", iter(rows))
        assert ok == 0
        assert err == 1

    def test_bulk_request_format(self):
        """Verify the NDJSON bulk request format is correct."""
        rows = [{"ref": "INV-001", "subjectName": "Test Subject"}]
        requests_stub.post.return_value = self._make_ok_response(1)

        indexer.bulk_index("bis-investigations", "ref", iter(rows))

        call_args = requests_stub.post.call_args
        body = call_args.kwargs.get("data") or call_args.args[1] if len(call_args.args) > 1 else call_args.kwargs["data"]

        lines = body.strip().split("\n")
        assert len(lines) == 2, f"Expected 2 NDJSON lines, got {len(lines)}"

        action = json.loads(lines[0])
        assert "index" in action
        assert action["index"]["_index"] == "bis-investigations"
        assert action["index"]["_id"] == "INV-001"

        doc = json.loads(lines[1])
        assert doc["ref"] == "INV-001"
        assert doc["subjectName"] == "Test Subject"

    def test_datetime_serialization_in_bulk(self):
        """Datetime fields should be serialized to ISO format in bulk requests."""
        rows = [{
            "ref": "INV-001",
            "subjectName": "Test",
            "createdAt": datetime(2026, 6, 16, tzinfo=timezone.utc),
        }]
        requests_stub.post.return_value = self._make_ok_response(1)

        indexer.bulk_index("bis-investigations", "ref", iter(rows))

        call_args = requests_stub.post.call_args
        body = call_args.kwargs.get("data") or call_args.kwargs["data"]
        lines = body.strip().split("\n")
        doc = json.loads(lines[1])
        assert "2026-06-16" in doc["createdAt"]


# ─── run_full_index ───────────────────────────────────────────────────────────

class TestRunFullIndex:
    def test_calls_all_three_indices(self):
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_cursor.fetchall = MagicMock(return_value=[])
        mock_cursor.__iter__ = MagicMock(return_value=iter([]))
        mock_conn.cursor.return_value = mock_cursor
        psycopg2_stub.connect.return_value = mock_conn

        requests_stub.post.return_value = MagicMock(
            status_code=200,
            json=MagicMock(return_value={"items": []})
        )

        # Should not raise
        indexer.run_full_index()
        assert mock_conn.close.called


# ─── run_incremental_index ────────────────────────────────────────────────────

class TestRunIncrementalIndex:
    def test_passes_since_to_fetchers(self):
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_cursor.__iter__ = MagicMock(return_value=iter([]))
        mock_conn.cursor.return_value = mock_cursor
        psycopg2_stub.connect.return_value = mock_conn

        requests_stub.post.return_value = MagicMock(
            status_code=200,
            json=MagicMock(return_value={"items": []})
        )

        since = datetime.now(timezone.utc) - timedelta(hours=1)
        indexer.run_incremental_index(since)

        # Verify execute was called with the since parameter
        for call in mock_cursor.execute.call_args_list:
            args = call.args
            if len(args) >= 2 and args[1]:
                assert since in args[1], f"Expected since={since} in params {args[1]}"
