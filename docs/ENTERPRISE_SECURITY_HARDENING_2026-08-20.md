# BIS Enterprise Security Hardening

## Scope and security posture

This hardening pass establishes **layered, fail-closed controls** for hostile internet traffic, privilege misuse, and application-layer denial-of-service. It does not make BIS invulnerable. DDoS mitigation still requires upstream network capacity and a managed edge service, and every infrastructure control must be deployed and monitored before it can be treated as operational protection.

| Layer | Implemented control | Enforcement outcome |
| --- | --- | --- |
| Internet edge | Caddy terminates TLS, strips caller-supplied security context, attaches edge provenance, applies rate limits, and exposes only ports 80/443 in production | Direct gateway and management access is removed from the host-published topology |
| Web application firewall | OpenAppSec uses a v1beta2 local policy with prevent-learn mode, request limits, rate limits, and privacy-safe logging | Malicious or anomalous application requests are blocked before APISIX when the WAF is deployed |
| API gateway | APISIX provides secondary OIDC/JWT checks, connection/request limits, request IDs, audit logging, and OPA authorization on sensitive routes | Gateway denial or a missing required edge/WAF marker rejects traffic rather than bypassing controls |
| Identity | Keycloak requires TOTP enrollment, refresh-token rotation, strict redirect origins, short session lifetimes, brute-force lockout, and administrator event logging | Password-only sign-in cannot complete for users who have not configured required MFA |
| Authorization | OPA policy decisions supplement existing Permify relationships and BFF role checks | Privileged requests require an administrator decision; Force Credit approval additionally requires a successful step-up MFA signal |
| Financial insider controls | Dual approval, designated approvers, TOTP step-up, immutable event records, and OPA decision evidence remain on Force Credit flows | A requester cannot self-approve and a denied/unavailable policy service prevents the privileged action |

## Deployment order

The production composition must be started with Caddy, OpenAppSec, OPA, APISIX, Keycloak, Redis, and the BFF on a private network. Only Caddy should publish ports 80 and 443. The OpenAppSec and APISIX management interfaces, the Caddy Admin API, databases, queues, and service ports must not be host-published.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml config
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Before traffic is enabled, set strong unique production values for `BIS_EDGE_TOKEN_SECRET`, `APISIX_ADMIN_KEY`, `APISIX_VIEWER_KEY`, `KEYCLOAK_ADMIN_PASSWORD`, `CADDY_ACME_EMAIL`, `BIS_DATABASE_URL`, and `OPA_URL`. Do not use any development defaults. The Keycloak realm import is intended for a fresh realm or a controlled migration; production administrators must avoid importing it over an existing realm without a backup and tested migration procedure.

## Required release gates

The following gates are mandatory before treating these controls as live:

| Gate | Evidence required |
| --- | --- |
| Edge isolation | A port scan from outside the deployment exposes only 80/443; Caddy, OpenAppSec, APISIX admin, databases, and brokers are unreachable |
| WAF enforcement | OpenAppSec reports that the v1beta2 policy was applied; benign replay traffic is observed during learn mode before any production policy is switched to prevent mode |
| OPA availability | `/v1/data/bis/authz` returns an allow decision only for the expected role/MFA combinations; policy-service outage blocks Force Credit operations |
| Keycloak MFA | A password-only account is redirected to TOTP enrollment and cannot obtain a BFF session until enrollment completes |
| Financial control | A Force Credit request demonstrates different requester/approver identities, TOTP step-up, OPA decision evidence, and a TigerBeetle transfer in the immutable event history |
| DDoS exercise | Load testing confirms 429 or 403 responses at Caddy/OpenAppSec/APISIX before BFF saturation, while health checks and queued financial reconciliation continue operating |

## Residual limitations

The managed BIS deployment currently has no deployed PostgreSQL dependency path and returns health failures. Consequently, the new persistence-dependent Keycloak and onboarding controls, and the Docker-based edge/WAF/OPA stack, cannot yet be certified live on the published service. The source configuration and regression tests are implementation evidence only until the required PostgreSQL and dedicated ingress topology are provisioned.

For volumetric layer-3/4 DDoS, place Caddy behind a DDoS-capable CDN, cloud load balancer, or network provider with scrubbing capacity. The application-level controls in this repository do not absorb a bandwidth-exhaustion attack by themselves. For high-assurance production, use an orchestrator or managed ingress with network policies, workload identity, encrypted service-to-service traffic, centralized secret rotation, immutable off-host audit retention, and a monitored backup/restore program.
