# BIS Python SDK

Official Python client for the [Background Intelligence System (BIS)](https://bis.example.ng) API.

## Installation

```bash
pip install bis-sdk
```

Zero dependencies — uses Python standard library only.

## Quick Start

```python
from bis_sdk import BISClient

# Initialize with your API key
client = BISClient(api_key="bis_live_your_key_here")
# Or set BIS_API_KEY environment variable

# List open investigations
investigations = client.investigations.list(status="open", priority="high")
for inv in investigations["data"]:
    print(f"{inv['refNumber']}: {inv['subject']['name']} — {inv['status']}")

# Run a QuickCheck background vetting
result = client.quickcheck.run(
    name="John Doe",
    phone="08012345678",
    nin="12345678901",
    category="driver",
    tier="standard",
)
print(f"Verdict: {result['verdict']} | Risk Score: {result['riskScore']}")
print(f"PDF Report: {result['reportUrl']}")

# Submit a SAR filing
sar = client.sar.submit(
    report_type="STR",
    subject_name="Jane Smith",
    amount_involved=5_000_000,
    narrative="Customer made 47 cash deposits of ₦500,000 each over 30 days...",
)
print(f"SAR Reference: {sar['filingRef']}")

# Flag a suspicious transaction
client.transactions.flag("txn-uuid-here", reason="Structuring pattern detected")
```

## Resources

| Resource | Methods |
|----------|---------|
| `client.investigations` | `list()`, `get()`, `create()` |
| `client.kyc` | `list()`, `submit()` |
| `client.alerts` | `list()`, `mark_read()` |
| `client.transactions` | `list()`, `flag()`, `block()` |
| `client.sar` | `list()`, `submit()` |
| `client.quickcheck` | `run()` |
| `client.lex` | `list()`, `submit()` |
| `client.analytics` | `transfer_volume()`, `risk_distribution()` |

## Error Handling

```python
from bis_sdk import BISClient, BISAuthError, BISRateLimitError, BISNotFoundError, BISError
import time

client = BISClient(api_key="bis_live_your_key")

try:
    result = client.investigations.get("non-existent-id")
except BISNotFoundError:
    print("Investigation not found")
except BISRateLimitError as e:
    print(f"Rate limited. Retry after {e.retry_after}s")
    time.sleep(e.retry_after)
except BISAuthError:
    print("Invalid API key")
except BISError as e:
    print(f"API error {e.status_code}: {e.message}")
```

## Configuration

| Parameter | Environment Variable | Default |
|-----------|---------------------|---------|
| `api_key` | `BIS_API_KEY` | Required |
| `base_url` | — | `https://bis.example.ng/api/v1` |
| `timeout` | — | `30` seconds |

## Sandbox

Use the sandbox environment for testing:

```python
client = BISClient(
    api_key="bis_test_your_sandbox_key",
    base_url="https://sandbox.bis.example.ng/api/v1",
)
```

## License

Proprietary — see [Terms of Service](https://bis.example.ng/terms).
