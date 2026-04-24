# BIS Platform SDK

The **Background Intelligence System (BIS)** provides official client libraries for Python, Node.js/TypeScript, and Go. All three SDKs share the same design philosophy: zero production dependencies, full TypeScript/type-hint coverage, and identical method signatures across languages.

---

## Overview

| Language | Package | Min Version | Install |
|---|---|---|---|
| Python | `bis-sdk` | Python 3.9+ | `pip install bis-sdk` |
| Node.js | `bis-sdk` | Node.js 18+ | `npm install bis-sdk` |
| Go | `github.com/bis-platform/bis-go-sdk` | Go 1.21+ | `go get github.com/bis-platform/bis-go-sdk` |

All SDKs communicate with the BIS REST API over HTTPS. The base URL defaults to `https://api.bis.example.ng/v1` and can be overridden via the `BIS_API_URL` environment variable.

---

## Authentication

Every request requires a **Bearer API key**. Keys are issued per environment:

- `bis_live_*` — production
- `bis_test_*` — staging / sandbox (returns deterministic mock data)
- `bis_dev_*` — local development

Set the key via environment variable (recommended for CI/CD):

```bash
export BIS_API_KEY="bis_live_your_key_here"
```

Or pass it directly when constructing the client (see language-specific examples below).

---

## Python SDK

### Installation

```bash
pip install bis-sdk
```

### Initialisation

```python
from bis_sdk import BISClient

# From environment variable (recommended)
client = BISClient()

# Explicit key
client = BISClient(api_key="bis_live_your_key_here")

# Custom base URL (e.g., self-hosted)
client = BISClient(api_key="bis_live_your_key_here", base_url="https://bis.internal.corp/api/v1")
```

### Investigations

```python
# List open investigations
result = client.investigations.list(status="open", priority="high", page=1, limit=20)
for inv in result["data"]:
    print(f"{inv['refNumber']}: {inv['subject']['name']} — {inv['status']}")

# Create a new investigation
inv = client.investigations.create(
    subject_name="Emeka Okafor",
    subject_type="individual",
    priority="high",
    description="Suspected structuring activity",
    assigned_to="analyst@bis.example.ng",
)
print(f"Created: {inv['refNumber']}")

# Get a specific investigation
inv = client.investigations.get("INV-2024-00123")

# Update status
client.investigations.update("INV-2024-00123", status="under_review", analyst_notes="Reviewing bank statements")
```

### KYC / Identity Verification

```python
# Run NIN verification
nin_result = client.kyc.verify_nin("12345678901")
print(f"Name: {nin_result['firstName']} {nin_result['lastName']}")
print(f"DOB: {nin_result['dob']}, State: {nin_result['state']}")

# Run BVN verification
bvn_result = client.kyc.verify_bvn("22345678901")
print(f"Banks: {bvn_result['banks']}")

# CAC company lookup
cac_result = client.kyc.verify_rc("RC123456")
print(f"Company: {cac_result['companyName']}, Status: {cac_result['status']}")

# Full QuickCheck (NIN + BVN + sanctions + adverse media)
qc = client.quickcheck.run(
    name="Fatima Ibrahim",
    nin="12345678901",
    bvn="22345678901",
    phone="08012345678",
    dob="1985-06-15",
)
print(f"Risk score: {qc['riskScore']}, Sanctions clear: {qc['sanctionsClear']}")
```

### AML Alerts

```python
# List AML alerts
alerts = client.aml.list_alerts(status="open", risk_level="high")
for alert in alerts["data"]:
    print(f"[{alert['riskLevel'].upper()}] {alert['ruleName']} — {alert['subjectName']}")

# Flag a transaction
client.aml.flag_transaction(
    transaction_ref="TXN-2024-98765",
    reason="Structuring — multiple sub-threshold deposits",
    risk_level="high",
)

# File an STR (Suspicious Transaction Report)
str_ref = client.aml.file_str(
    investigation_id="INV-2024-00123",
    filing_type="STR",
    regulator="NFIU",
    narrative="Subject made 47 cash deposits below ₦5,000,000 threshold over 30 days.",
)
print(f"STR filed: {str_ref['ref']}")
```

### Sanctions Screening

```python
# Screen an individual
result = client.sanctions.screen(name="John Doe", dob="1970-01-01", nationality="NG")
if result["clear"]:
    print("No sanctions hits")
else:
    for hit in result["hits"]:
        print(f"HIT: {hit['listName']} — {hit['entityName']} (score: {hit['score']:.2f})")

# Bulk screening
names = ["Alice Smith", "Bob Jones", "Charlie Brown"]
results = client.sanctions.bulk_screen(names)
for r in results:
    print(f"{r['query']}: {'CLEAR' if r['clear'] else 'HIT'}")
```

### Error Handling

```python
from bis_sdk.exceptions import BISAuthError, BISNotFoundError, BISRateLimitError, BISAPIError

try:
    inv = client.investigations.get("INV-DOES-NOT-EXIST")
except BISNotFoundError:
    print("Investigation not found")
except BISAuthError:
    print("Invalid API key")
except BISRateLimitError as e:
    print(f"Rate limited — retry after {e.retry_after}s")
except BISAPIError as e:
    print(f"API error {e.status_code}: {e.message}")
```

---

## Node.js / TypeScript SDK

### Installation

```bash
npm install bis-sdk
# or
pnpm add bis-sdk
```

### Initialisation

```typescript
import { BISClient } from 'bis-sdk';

// From environment variable
const client = new BISClient();

// Explicit key
const client = new BISClient({ apiKey: 'bis_live_your_key_here' });

// Custom base URL
const client = new BISClient({
  apiKey: 'bis_live_your_key_here',
  baseUrl: 'https://bis.internal.corp/api/v1',
  timeout: 30_000, // ms
});
```

### Investigations

```typescript
// List investigations
const { data, total } = await client.investigations.list({
  status: 'open',
  priority: 'high',
  page: 1,
  limit: 20,
});

// Create
const inv = await client.investigations.create({
  subjectName: 'Emeka Okafor',
  subjectType: 'individual',
  priority: 'high',
  description: 'Suspected structuring activity',
});
console.log(`Created: ${inv.refNumber}`);

// Update
await client.investigations.update('INV-2024-00123', {
  status: 'under_review',
  analystNotes: 'Reviewing bank statements',
});
```

### KYC / Identity Verification

```typescript
// NIN verification
const nin = await client.kyc.verifyNIN('12345678901');
console.log(`${nin.firstName} ${nin.lastName}, DOB: ${nin.dob}`);

// BVN verification
const bvn = await client.kyc.verifyBVN('22345678901');
console.log(`Banks: ${bvn.banks.join(', ')}`);

// CAC company lookup
const cac = await client.kyc.verifyRC('RC123456');
console.log(`${cac.companyName} — ${cac.status}`);

// QuickCheck
const qc = await client.quickcheck.run({
  name: 'Fatima Ibrahim',
  nin: '12345678901',
  bvn: '22345678901',
  phone: '08012345678',
});
console.log(`Risk: ${qc.riskScore}, Clear: ${qc.sanctionsClear}`);
```

### AML Alerts

```typescript
// List alerts
const { data } = await client.aml.listAlerts({ status: 'open', riskLevel: 'high' });

// Flag a transaction
await client.aml.flagTransaction({
  transactionRef: 'TXN-2024-98765',
  reason: 'Structuring',
  riskLevel: 'high',
});

// File STR
const str = await client.aml.fileSTR({
  investigationId: 'INV-2024-00123',
  filingType: 'STR',
  regulator: 'NFIU',
  narrative: 'Subject made 47 cash deposits below threshold.',
});
```

### Error Handling

```typescript
import { BISAuthError, BISNotFoundError, BISRateLimitError } from 'bis-sdk';

try {
  const inv = await client.investigations.get('INV-DOES-NOT-EXIST');
} catch (err) {
  if (err instanceof BISNotFoundError) {
    console.error('Not found');
  } else if (err instanceof BISRateLimitError) {
    console.error(`Rate limited, retry after ${err.retryAfter}s`);
  } else if (err instanceof BISAuthError) {
    console.error('Invalid API key');
  }
}
```

---

## Go SDK

### Installation

```bash
go get github.com/bis-platform/bis-go-sdk
```

### Initialisation

```go
package main

import (
    "context"
    "fmt"
    "log"

    "github.com/bis-platform/bis-go-sdk/bis"
)

func main() {
    // From environment variable BIS_API_KEY
    client, err := bis.NewClient(bis.Config{})
    if err != nil {
        log.Fatal(err)
    }

    // Explicit key
    client, err = bis.NewClient(bis.Config{
        APIKey:  "bis_live_your_key_here",
        BaseURL: "https://api.bis.example.ng/v1", // optional override
        Timeout: 30,                               // seconds
    })
}
```

### Investigations

```go
ctx := context.Background()

// List investigations
result, err := client.Investigations.List(ctx, bis.ListInvestigationsParams{
    Status:   "open",
    Priority: "high",
    Page:     1,
    Limit:    20,
})
if err != nil {
    log.Fatal(err)
}
for _, inv := range result.Data {
    fmt.Printf("%s: %s — %s\n", inv.RefNumber, inv.Subject.Name, inv.Status)
}

// Create
inv, err := client.Investigations.Create(ctx, bis.CreateInvestigationRequest{
    SubjectName: "Emeka Okafor",
    SubjectType: "individual",
    Priority:    "high",
    Description: "Suspected structuring activity",
})
fmt.Printf("Created: %s\n", inv.RefNumber)
```

### KYC / Identity Verification

```go
// NIN verification
nin, err := client.KYC.VerifyNIN(ctx, "12345678901")
if err != nil {
    log.Fatal(err)
}
fmt.Printf("%s %s, DOB: %s\n", nin.FirstName, nin.LastName, nin.DOB)

// BVN verification
bvn, err := client.KYC.VerifyBVN(ctx, "22345678901")
fmt.Printf("Banks: %v\n", bvn.Banks)

// CAC company lookup
cac, err := client.KYC.VerifyRC(ctx, "RC123456")
fmt.Printf("%s — %s\n", cac.CompanyName, cac.Status)
```

### Sanctions Screening

```go
result, err := client.Sanctions.Screen(ctx, bis.SanctionsScreenRequest{
    Name:        "John Doe",
    DateOfBirth: "1970-01-01",
    Nationality: "NG",
})
if err != nil {
    log.Fatal(err)
}
if result.Clear {
    fmt.Println("No sanctions hits")
} else {
    for _, hit := range result.Hits {
        fmt.Printf("HIT: %s — %s (%.2f)\n", hit.ListName, hit.EntityName, hit.Score)
    }
}
```

### Error Handling

```go
import "github.com/bis-platform/bis-go-sdk/bis"

inv, err := client.Investigations.Get(ctx, "INV-DOES-NOT-EXIST")
if err != nil {
    var apiErr *bis.APIError
    if errors.As(err, &apiErr) {
        switch apiErr.Code {
        case bis.ErrNotFound:
            fmt.Println("Not found")
        case bis.ErrUnauthorized:
            fmt.Println("Invalid API key")
        case bis.ErrRateLimit:
            fmt.Printf("Rate limited, retry after %ds\n", apiErr.RetryAfter)
        default:
            fmt.Printf("API error %d: %s\n", apiErr.StatusCode, apiErr.Message)
        }
    }
}
```

---

## Rate Limits

| Tier | Requests / minute | Burst |
|---|---|---|
| Free | 60 | 10 |
| Standard | 600 | 50 |
| Enterprise | 6,000 | 200 |

All SDKs surface rate limit errors with a `retryAfter` field (seconds). Implement exponential backoff for production workloads.

---

## Pagination

All list endpoints return a standard pagination envelope:

```json
{
  "data": [...],
  "total": 1234,
  "page": 1,
  "limit": 20,
  "hasMore": true
}
```

All SDKs accept `page` and `limit` parameters. The maximum `limit` is 100 per request.

---

## Webhook Events

The BIS platform can push real-time events to your endpoint. Configure webhooks in the Developer Portal under **Settings → Webhooks**.

| Event | Description |
|---|---|
| `investigation.created` | New investigation opened |
| `investigation.status_changed` | Investigation status updated |
| `aml.alert.triggered` | AML rule fired on a transaction |
| `aml.str.filed` | STR/CTR filed with regulator |
| `kyc.verification.completed` | KYC verification result available |
| `sanctions.hit` | Sanctions screening returned a hit |

Webhook payloads are signed with HMAC-SHA256. Verify signatures using the `BIS-Signature` header.

---

## Sandbox Mode

All API keys prefixed with `bis_test_` operate in sandbox mode:

- NIN/BVN/CAC lookups return deterministic mock data based on the input
- Sanctions screening returns a hit only for names containing `SANCTIONED`
- No real external API calls are made
- Rate limits are relaxed (1,000 requests/minute)

---

## Changelog

| Version | Date | Notes |
|---|---|---|
| 1.0.0 | 2024-01-15 | Initial release |
| 1.1.0 | 2024-03-01 | Added bulk sanctions screening, QuickCheck API |
| 1.2.0 | 2024-06-01 | Added CAC RC lookup, webhook signature verification |
| 1.3.0 | 2024-09-01 | Added STR/CTR filing, AML alert management |
| 1.4.0 | 2025-01-01 | Added field agent endpoints, biometric enrollment |
| 1.5.0 | 2025-04-01 | Added Delta Lake analytics query endpoint |

---

## Support

- **Documentation**: https://docs.bis.example.ng
- **API Reference**: https://api.bis.example.ng/docs
- **GitHub Issues**: https://github.com/bis-platform/bis-sdk/issues
- **Email**: support@bis.example.ng
- **Status Page**: https://status.bis.example.ng
