"""
BIS Python SDK
==============
Official Python client for the Background Intelligence System (BIS) API.

Installation:
    pip install bis-sdk

Quick start:
    from bis_sdk import BISClient
    client = BISClient(api_key="bis_live_your_key_here")
    investigations = client.investigations.list(status="open")
"""

from .client import BISClient
from .exceptions import BISError, BISAuthError, BISRateLimitError, BISNotFoundError

__version__ = "1.0.0"
__all__ = ["BISClient", "BISError", "BISAuthError", "BISRateLimitError", "BISNotFoundError"]
