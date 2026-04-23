"""
BIS Python SDK — Main Client
"""

from __future__ import annotations

import os
import time
import json
from typing import Any, Dict, List, Optional, Union
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin

from .exceptions import BISError, BISAuthError, BISRateLimitError, BISNotFoundError


DEFAULT_BASE_URL = "https://bis.example.ng/api/v1"
DEFAULT_TIMEOUT = 30


class _Resource:
    def __init__(self, client: "BISClient"):
        self._client = client

    def _get(self, path: str, params: Optional[Dict] = None) -> Any:
        return self._client._request("GET", path, params=params)

    def _post(self, path: str, body: Optional[Dict] = None) -> Any:
        return self._client._request("POST", path, body=body)

    def _patch(self, path: str, body: Optional[Dict] = None) -> Any:
        return self._client._request("PATCH", path, body=body)

    def _delete(self, path: str) -> Any:
        return self._client._request("DELETE", path)


class InvestigationsResource(_Resource):
    """Manage investigations."""

    def list(
        self,
        status: Optional[str] = None,
        priority: Optional[str] = None,
        search: Optional[str] = None,
        page: int = 1,
        limit: int = 20,
    ) -> Dict:
        """List investigations with optional filters."""
        params = {"page": page, "limit": limit}
        if status:
            params["status"] = status
        if priority:
            params["priority"] = priority
        if search:
            params["search"] = search
        return self._get("/investigations", params=params)

    def get(self, investigation_id: str) -> Dict:
        """Get a single investigation by ID."""
        return self._get(f"/investigations/{investigation_id}")

    def create(
        self,
        subject_name: str,
        priority: str = "medium",
        nin: Optional[str] = None,
        bvn: Optional[str] = None,
        phone: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> Dict:
        """Open a new investigation."""
        body: Dict[str, Any] = {
            "subject": {"name": subject_name},
            "priority": priority,
        }
        if nin:
            body["subject"]["nin"] = nin
        if bvn:
            body["subject"]["bvn"] = bvn
        if phone:
            body["subject"]["phone"] = phone
        if notes:
            body["notes"] = notes
        return self._post("/investigations", body=body)


class KYCResource(_Resource):
    """KYC verification records."""

    def list(self, status: Optional[str] = None, page: int = 1) -> Dict:
        """List KYC records."""
        params: Dict[str, Any] = {"page": page}
        if status:
            params["status"] = status
        return self._get("/kyc", params=params)

    def submit(
        self,
        nin: str,
        bvn: Optional[str] = None,
        document_type: Optional[str] = None,
    ) -> Dict:
        """Submit a new KYC verification."""
        body: Dict[str, Any] = {"nin": nin}
        if bvn:
            body["bvn"] = bvn
        if document_type:
            body["documentType"] = document_type
        return self._post("/kyc", body=body)


class AlertsResource(_Resource):
    """AML and compliance alerts."""

    def list(
        self,
        severity: Optional[str] = None,
        is_read: Optional[bool] = None,
        alert_type: Optional[str] = None,
    ) -> Dict:
        """List alerts."""
        params: Dict[str, Any] = {}
        if severity:
            params["severity"] = severity
        if is_read is not None:
            params["isRead"] = str(is_read).lower()
        if alert_type:
            params["type"] = alert_type
        return self._get("/alerts", params=params)

    def mark_read(self, alert_id: str) -> Dict:
        """Mark an alert as read."""
        return self._post(f"/alerts/{alert_id}/read")


class TransactionsResource(_Resource):
    """Payment transaction monitoring."""

    def list(
        self,
        status: Optional[str] = None,
        min_aml_score: Optional[float] = None,
        channel: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> Dict:
        """List transactions."""
        params: Dict[str, Any] = {}
        if status:
            params["status"] = status
        if min_aml_score is not None:
            params["minAmlScore"] = min_aml_score
        if channel:
            params["channel"] = channel
        if date_from:
            params["dateFrom"] = date_from
        if date_to:
            params["dateTo"] = date_to
        return self._get("/transactions", params=params)

    def flag(self, transaction_id: str, reason: Optional[str] = None) -> Dict:
        """Flag a transaction for AML review."""
        body = {"reason": reason} if reason else {}
        return self._post(f"/transactions/{transaction_id}/flag", body=body)

    def block(self, transaction_id: str) -> Dict:
        """Block a transaction."""
        return self._post(f"/transactions/{transaction_id}/block")


class SARResource(_Resource):
    """SAR/STR/CTR regulatory filings."""

    def list(self) -> Dict:
        """List SAR filings."""
        return self._get("/sar")

    def submit(
        self,
        report_type: str,
        subject_name: str,
        amount_involved: float,
        narrative: str,
        currency: str = "NGN",
    ) -> Dict:
        """Submit a SAR/STR/CTR filing."""
        return self._post("/sar", body={
            "reportType": report_type,
            "subjectName": subject_name,
            "amountInvolved": amount_involved,
            "narrative": narrative,
            "currency": currency,
        })


class QuickCheckResource(_Resource):
    """Consumer background vetting service."""

    def run(
        self,
        name: str,
        phone: Optional[str] = None,
        nin: Optional[str] = None,
        bvn: Optional[str] = None,
        category: str = "general",
        tier: str = "basic",
    ) -> Dict:
        """
        Run a QuickCheck background vetting.

        Args:
            name: Full name of the subject
            phone: Nigerian phone number (e.g. 08012345678)
            nin: 11-digit National Identification Number
            bvn: 11-digit Bank Verification Number
            category: Subject category (house_help, driver, nanny, etc.)
            tier: Check tier — basic (₦500), standard (₦1,500), premium (₦3,000)

        Returns:
            QuickCheck result with verdict, risk score, and PDF report URL
        """
        body: Dict[str, Any] = {"name": name, "category": category, "tier": tier}
        if phone:
            body["phone"] = phone
        if nin:
            body["nin"] = nin
        if bvn:
            body["bvn"] = bvn
        return self._post("/quickcheck", body=body)


class LEXResource(_Resource):
    """Law Enforcement Extension — incident reporting."""

    def list(
        self,
        state: Optional[str] = None,
        status: Optional[str] = None,
        incident_type: Optional[str] = None,
    ) -> Dict:
        """List LEX submissions."""
        params: Dict[str, Any] = {}
        if state:
            params["state"] = state
        if status:
            params["status"] = status
        if incident_type:
            params["incidentType"] = incident_type
        return self._get("/lex/submissions", params=params)

    def submit(
        self,
        agency_code: str,
        state: str,
        incident_type: str,
        narrative: str,
        subject_name: Optional[str] = None,
        subject_nin: Optional[str] = None,
        subject_phone: Optional[str] = None,
        gps_lat: Optional[float] = None,
        gps_lng: Optional[float] = None,
    ) -> Dict:
        """Submit a LEX incident report."""
        body: Dict[str, Any] = {
            "agencyCode": agency_code,
            "state": state,
            "incidentType": incident_type,
            "narrative": narrative,
        }
        if subject_name:
            body["subjectName"] = subject_name
        if subject_nin:
            body["subjectNin"] = subject_nin
        if subject_phone:
            body["subjectPhone"] = subject_phone
        if gps_lat is not None:
            body["gpsLat"] = gps_lat
        if gps_lng is not None:
            body["gpsLng"] = gps_lng
        return self._post("/lex/submissions", body=body)


class AnalyticsResource(_Resource):
    """Platform analytics and reporting."""

    def transfer_volume(
        self,
        period: str = "daily",
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> Dict:
        """Get transfer volume analytics."""
        params: Dict[str, Any] = {"period": period}
        if date_from:
            params["dateFrom"] = date_from
        if date_to:
            params["dateTo"] = date_to
        return self._get("/analytics/transfers", params=params)

    def risk_distribution(self) -> Dict:
        """Get risk score distribution by sector."""
        return self._get("/analytics/risk")


class BISClient:
    """
    BIS Python SDK Client.

    Args:
        api_key: Your BIS API key (from the Developer Portal)
        base_url: API base URL (default: https://bis.example.ng/api/v1)
        timeout: Request timeout in seconds (default: 30)

    Example:
        >>> from bis_sdk import BISClient
        >>> client = BISClient(api_key="bis_live_your_key_here")
        >>> result = client.investigations.list(status="open")
        >>> print(result["data"])
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: int = DEFAULT_TIMEOUT,
    ):
        self.api_key = api_key or os.environ.get("BIS_API_KEY", "")
        if not self.api_key:
            raise BISAuthError("api_key is required. Set BIS_API_KEY env var or pass api_key=")
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

        # Resource namespaces
        self.investigations = InvestigationsResource(self)
        self.kyc = KYCResource(self)
        self.alerts = AlertsResource(self)
        self.transactions = TransactionsResource(self)
        self.sar = SARResource(self)
        self.quickcheck = QuickCheckResource(self)
        self.lex = LEXResource(self)
        self.analytics = AnalyticsResource(self)

    def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict] = None,
        body: Optional[Dict] = None,
    ) -> Any:
        url = self.base_url + path
        if params:
            url += "?" + urlencode({k: v for k, v in params.items() if v is not None})

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "bis-python-sdk/1.0.0",
        }

        data = json.dumps(body).encode("utf-8") if body else None
        req = Request(url, data=data, headers=headers, method=method)

        try:
            with urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            error_body = {}
            try:
                error_body = json.loads(e.read().decode("utf-8"))
            except Exception:
                pass

            if e.code == 401:
                raise BISAuthError(error_body.get("message", "Unauthorized")) from e
            elif e.code == 429:
                retry_after = int(e.headers.get("Retry-After", 60))
                raise BISRateLimitError(
                    error_body.get("message", "Rate limit exceeded"),
                    retry_after=retry_after,
                ) from e
            elif e.code == 404:
                raise BISNotFoundError(error_body.get("message", "Not found")) from e
            else:
                raise BISError(
                    error_body.get("message", f"HTTP {e.code}"),
                    status_code=e.code,
                ) from e
        except URLError as e:
            raise BISError(f"Network error: {e.reason}") from e
