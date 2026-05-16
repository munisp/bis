# BIS Platform — Comprehensive Audit Findings (Sprint v10)

## Security Posture: GOOD (7.5/10)
### Implemented:
- Helmet CSP with nonce-based script-src (production)
- HSTS 1yr + preload, frameguard, noSniff, hidePoweredBy
- CSRF token endpoint + validation middleware on mutations
- Rate limiting: global (300/15min), auth (30/15min), LEX submit (20/hr)
- Paystack webhook HMAC-SHA512 with timingSafeEqual
- Permify PBAC (fail-open when not configured)
- HMAC-SHA256 tamper-evident audit log entries
- Input validation via Zod on all tRPC procedures
- Drizzle ORM parameterised queries (no raw string interpolation)

### Gaps to Fix:
1. CSRF token not fetched/sent by frontend tRPC client
2. Re-enrollment cooldown guard missing (biometric.enroll)
3. Archival dry-run mode missing (triggerArchival)
4. Audit log page missing targetRef filter for archival events
5. ZeroFootprintPage uses screening.create instead of the richer screening.zeroFootprint procedure
6. DrugScreeningPage uses mock result data instead of real result from server
7. MVRCheckPage uses mock result data instead of real result from server

## Orphaned/Stub Features:
- ZeroFootprintPage: uses generic screening.create, not screening.zeroFootprint (LLM-powered)
- DrugScreeningPage: mock result object instead of server-provided result
- MVRCheckPage: mock result object instead of server-provided result
- AuditLogPage: no targetRef filter chip for archival events

## Suggested Fixes (Sprint v10):
1. Wire ZeroFootprintPage to trpc.screening.zeroFootprint
2. Fix DrugScreeningPage and MVRCheckPage to use server result
3. Add targetRef filter to AuditLogPage
4. Add re-enrollment cooldown to biometric.enroll
5. Add dryRun mode to triggerArchival
6. Add CSRF token fetch to tRPC client
