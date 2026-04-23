# BIS Node.js SDK

Official TypeScript/JavaScript client for the [Background Intelligence System (BIS)](https://bis.example.ng) API.

## Installation

```bash
npm install bis-sdk
# or
yarn add bis-sdk
# or
pnpm add bis-sdk
```

Zero production dependencies. Requires Node.js 18+ (uses built-in `fetch`).

## Quick Start

```typescript
import { BISClient } from 'bis-sdk';

const client = new BISClient({ apiKey: 'bis_live_your_key_here' });
// Or set BIS_API_KEY environment variable

// List open investigations
const { data } = await client.investigations.list({ status: 'open', priority: 'high' });
for (const inv of data) {
  console.log(`${inv.refNumber}: ${inv.subject.name} — ${inv.status}`);
}

// Run a QuickCheck background vetting
const result = await client.quickcheck.run({
  name: 'John Doe',
  phone: '08012345678',
  nin: '12345678901',
  category: 'driver',
  tier: 'standard',
});
console.log(`Verdict: ${result.verdict} | Risk Score: ${result.riskScore}`);
console.log(`PDF Report: ${result.reportUrl}`);

// Submit a SAR filing
const sar = await client.sar.submit({
  reportType: 'STR',
  subjectName: 'Jane Smith',
  amountInvolved: 5_000_000,
  narrative: 'Customer made 47 cash deposits of ₦500,000 each over 30 days...',
});
console.log(`SAR Reference: ${sar.filingRef}`);
```

## API Reference

All methods return Promises. Full TypeScript types are included.

| Resource | Methods |
|----------|---------|
| `client.investigations` | `list(params?)`, `get(id)`, `create(data)` |
| `client.kyc` | `list(params?)`, `submit(data)` |
| `client.alerts` | `list(params?)`, `markRead(id)` |
| `client.transactions` | `list(params?)`, `flag(id, reason?)`, `block(id)` |
| `client.sar` | `list()`, `submit(data)` |
| `client.quickcheck` | `run(data)` |
| `client.lex` | `list(params?)`, `submit(data)` |
| `client.analytics` | `transferVolume(params?)`, `riskDistribution()` |

## Error Handling

```typescript
import { BISClient, BISAuthError, BISRateLimitError, BISNotFoundError } from 'bis-sdk';

try {
  const inv = await client.investigations.get('non-existent');
} catch (err) {
  if (err instanceof BISNotFoundError) console.log('Not found');
  else if (err instanceof BISRateLimitError) console.log(`Retry after ${err.retryAfter}s`);
  else if (err instanceof BISAuthError) console.log('Invalid API key');
  else throw err;
}
```

## Sandbox

```typescript
const client = new BISClient({
  apiKey: 'bis_test_your_sandbox_key',
  baseUrl: 'https://sandbox.bis.example.ng/api/v1',
});
```
