# BIS Platform — API Reference

**Version:** v63 | **Base URL:** `https://bis.example.ng/api` | **Auth:** Bearer token (API key) or session cookie

---

## Authentication

All API endpoints (except `/health`, `/csrf-token`, `/openapi.yaml`, `/docs`) require authentication.

### Bearer Token (API Integration)

```http
Authorization: Bearer bis_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Obtain API tokens from the **Developer Portal** (`/developer`) → API Tokens tab.

### Session Cookie (Web UI)

The web UI uses HTTP-only session cookies set by the OAuth flow. CSRF tokens are required for all mutation requests.

---

## tRPC Procedures

All tRPC procedures are available at `POST /api/trpc/{router}.{procedure}` (batched) or via the generated client SDKs.

### Auth Router (`trpc.auth.*`)

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `auth.me` | Query | Required | Get current authenticated user |
| `auth.logout` | Mutation | Required | Invalidate session |

### Investigations Router (`trpc.investigations.*`)

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `investigations.list` | Query | Required | List investigations with pagination, search, status/priority filter |
| `investigations.get` | Query | Required | Get investigation detail by ID |
| `investigations.create` | Mutation | Required | Create new investigation |
| `investigations.update` | Mutation | Required | Update investigation fields |
| `investigations.addNote` | Mutation | Required | Add note to investigation timeline |
| `investigations.close` | Mutation | Required | Close investigation with outcome |
| `investigations.reopen` | Mutation | Required | Reopen closed investigation |
| `investigations.bulkAssign` | Mutation | Admin | Bulk assign investigations to analyst |
| `investigations.bulkClose` | Mutation | Admin | Bulk close investigations |
| `investigations.bulkExport` | Mutation | Required | Export selected investigations to CSV |
| `investigations.dispatchFieldAgent` | Mutation | Required | Dispatch field agent to investigation location |

### KYC Router (`trpc.kyc.*`)

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `kyc.list` | Query | Required | List KYC records with status/risk filter |
| `kyc.get` | Query | Required | Get KYC record detail |
| `kyc.submit` | Mutation | Required | Submit new KYC verification request |
| `kyc.verify` | Mutation | Required | Trigger verification via NIN/BVN/biometric |
| `kyc.bulkExport` | Mutation | Required | Export KYC records to CSV/PDF |
| `kyc.advancedSearch` | Query | Required | Search by NIN, BVN, name, phone, status |

### Transactions Router (`trpc.transactions.*`)

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `transactions.list` | Query | Required | List transactions with AML score, channel, status filter |
| `transactions.get` | Query | Required | Get transaction detail |
| `transactions.flag` | Mutation | Required | Flag transaction for AML review |
| `transactions.unflag` | Mutation | Required | Remove AML flag from transaction |
| `transactions.block` | Mutation | Admin | Block transaction (prevent settlement) |
| `transactions.resolveAlert` | Mutation | Required | Resolve AML alert on transaction |

### AML Router (`trpc.aml.*`)

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `aml.alerts.list` | Query | Required | List AML alerts with severity/type filter |
| `aml.alerts.get` | Query | Required | Get alert detail |
| `aml.alerts.resolve` | Mutation | Required | Resolve alert with disposition |
| `aml.alerts.escalate` | Mutation | Required | Escalate alert to senior analyst |
| `aml.rules.list` | Query | Required | List alert rules |
| `aml.rules.create` | Mutation | Admin | Create new alert rule |
| `aml.rules.update` | Mutation | Admin | Update alert rule |
| `aml.rules.delete` | Mutation | Admin | Delete alert rule |
| `aml.rules.test` | Mutation | Admin | Test fire alert rule |

### SAR Router (`trpc.sar.*`)

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `sar.list` | Query | Required | List SAR filings |
| `sar.get` | Query | Required | Get SAR filing detail |
| `sar.create` | Mutation | Required | Create new SAR filing (Draft) |
| `sar.submit` | Mutation | Required | Submit SAR for review |
| `sar.approve` | Mutation | Admin | Approve SAR for filing |
| `sar.file` | Mutation | Admin | Mark SAR as filed with NFIU |
| `sar.acknowledge` | Mutation | Admin | Record NFIU acknowledgment |
| `sar.reject` | Mutation | Admin | Reject SAR with reason |

### Payment Rails Router (`trpc.paymentRails.*`)

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `paymentRails.transfers.list` | Query | Required | List transfers with pagination |
| `paymentRails.transfers.get` | Query | Required | Get transfer detail |
| `paymentRails.transfers.create` | Mutation | Required | Initiate new transfer |
| `paymentRails.transfers.reverse` | Mutation | Admin | Reverse/recall transfer |
| `paymentRails.accounts.list` | Query | Required | List TigerBeetle accounts |
| `paymentRails.accounts.get` | Query | Required | Get account with balance history |
| `paymentRails.accounts.freeze` | Mutation | Admin | Freeze account |
| `paymentRails.accounts.unfreeze` | Mutation | Admin | Unfreeze account |
| `paymentRails.batches.list` | Query | Required | List batch jobs |
| `paymentRails.batches.create` | Mutation | Required | Create batch job |
| `paymentRails.batches.cancel` | Mutation | Required | Cancel pending batch |
| `paymentRails.getTransferAnalytics` | Query | Required | Daily/weekly/monthly NGN volume |
| `paymentRails.getReconciliationReport` | Query | Required | Matched/unmatched/exception counts |

### Banking Router (`trpc.banking.*`)

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `banking.tradeFinance.list` | Query | Required | List trade finance LCs |
| `banking.tradeFinance.create` | Mutation | Required | Issue new LC |
| `banking.tradeFinance.update` | Mutation | Required | Update LC status |
| `banking.correspondentBanks.list` | Query | Required | List correspondent banks |
| `banking.correspondentBanks.create` | Mutation | Admin | Add correspondent bank |
| `banking.evidence.list` | Query | Required | List evidence items |
| `banking.evidence.upload` | Mutation | Required | Upload evidence with S3 storage |
| `banking.evidence.transferCustody` | Mutation | Required | Transfer custody of evidence |

### Document Vault Router (`trpc.documentVault.*`)

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `documentVault.list` | Query | Required | List documents with category/search filter |
| `documentVault.get` | Query | Required | Get document with version history |
| `documentVault.upload` | Mutation | Required | Upload document to S3 |
| `documentVault.delete` | Mutation | Admin | Soft-delete document |
| `documentVault.getVersionHistory` | Query | Required | Get document version history |
| `documentVault.getChainOfCustody` | Query | Required | Get chain of custody log |

### Risk Dashboard Router (`trpc.riskDashboard.*`)

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `riskDashboard.getEntityRiskScores` | Query | Required | Entity risk scores with sector/type breakdown |
| `riskDashboard.getRiskDistribution` | Query | Required | Risk score distribution histogram |
| `riskDashboard.getTopRiskEntities` | Query | Required | Top 20 highest-risk entities |
| `riskDashboard.getRiskTrend` | Query | Required | Risk score trend over time |

### LEX Router (`trpc.lex.*`)

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `lex.submissions.list` | Query | Required | List LEX submissions |
| `lex.submissions.create` | Mutation | Required | Create new LEX submission |
| `lex.submissions.get` | Query | Required | Get submission detail |
| `lex.submissions.validate` | Mutation | Required | Validate submission data |
| `lex.submissions.submit` | Mutation | Required | Submit to LEX gateway |
| `lex.submissions.acknowledge` | Mutation | Required | Record agency acknowledgment |

### QuickCheck Router (`trpc.quickcheck.*`)

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `quickcheck.run` | Mutation | Required | Run background vetting check |
| `quickcheck.getResult` | Query | Required | Get vetting result by request ID |
| `quickcheck.history` | Query | Required | List past QuickCheck requests |
| `quickcheck.generatePDF` | Mutation | Required | Generate shareable PDF result card |

### API Tokens Router (`trpc.apiTokens.*`)

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `apiTokens.list` | Query | Required | List API tokens for current tenant |
| `apiTokens.create` | Mutation | Required | Create new API token |
| `apiTokens.revoke` | Mutation | Required | Revoke API token |
| `apiTokens.usageStats` | Query | Required | Per-token usage statistics |

### Platform Router (`trpc.platform.*`)

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `platform.exportSchedules.list` | Query | Required | List export schedules |
| `platform.exportSchedules.create` | Mutation | Required | Create export schedule |
| `platform.exportSchedules.update` | Mutation | Required | Update export schedule |
| `platform.exportSchedules.delete` | Mutation | Required | Delete export schedule |
| `platform.exportSchedules.runNow` | Mutation | Required | Trigger immediate export |

### Admin Router (`trpc.admin.*`)

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `admin.users.list` | Query | Admin | List all users |
| `admin.users.promote` | Mutation | Admin | Promote user to admin |
| `admin.users.suspend` | Mutation | Admin | Suspend user account |
| `admin.auditLog.list` | Query | Admin | List audit log entries |
| `admin.auditLog.export` | Mutation | Admin | Export audit log to CSV |

---

## REST Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/health` | None | Platform health check |
| `GET` | `/api/csrf-token` | None | Get CSRF token |
| `GET` | `/api/openapi.yaml` | None | OpenAPI 3.0 spec (YAML) |
| `GET` | `/api/openapi.json` | None | OpenAPI 3.0 spec (JSON) |
| `GET` | `/api/docs` | None | Swagger UI |
| `GET` | `/api/metrics` | Bearer | Prometheus metrics |
| `POST` | `/api/oauth/callback` | None | OAuth callback handler |
| `POST` | `/api/openclaw/webhook` | Bearer | OpenClaw intelligence webhook |
| `GET` | `/api/v1/*` | Bearer | REST API v1 (token-authenticated) |

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `10001` | 401 | Not authenticated — redirect to login |
| `10002` | 403 | Insufficient permissions (not admin) |
| `10003` | 403 | Demo mode — mutations blocked |
| `10004` | 429 | Rate limit exceeded |
| `10005` | 400 | Invalid input — see `message` for details |
| `10006` | 404 | Resource not found |
| `10007` | 409 | Conflict — duplicate resource |
| `10008` | 503 | Upstream service unavailable |

---

## Rate Limits

| Tier | Requests/min | Burst |
|------|-------------|-------|
| Free | 60 | 10 |
| Standard | 300 | 50 |
| Enterprise | 1,200 | 200 |
| Internal | Unlimited | — |

Rate limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## SDKs

| Language | Package | Install |
|----------|---------|---------|
| Python | `bis-sdk` | `pip install bis-sdk` |
| Node.js | `@bis/sdk` | `npm install @bis/sdk` |
| Go | `github.com/bis-platform/bis-go-sdk` | `go get github.com/bis-platform/bis-go-sdk` |

See `sdk/` directory for source code and usage examples.
