# Keycloak Latency and Packet-Loss Chaos Drill with PIR/RCA Framework

**Author:** Manus AI  
**Status:** Staging-only implementation reference. This is not a production fault-injection instruction. Run it only after a change approval, an outage owner, a finite expiry, a verified delete path, synthetic identities, and an explicit staging-cluster admission policy.

## 1. Experiment Objective and Safety Boundary

The experiment simulates impaired **BFF-to-Keycloak** traffic during a synthetic authentication load period. It validates that the BFF applies its configured provider timeout, circuit-breaker behavior, refresh lease rules, availability responses, telemetry, and recovery checks without exposing credentials or causing an unbounded retry loop. Chaos Mesh supports `NetworkChaos` for delay and packet-loss faults, and directed selectors can bound the fault to a source workload and a destination workload. [1]

> **Do not interpret “peak user authentication traffic” as permission to test production.** Use a staging-only synthetic load profile that reproduces the approved request rate, test realm, and session behavior. No production session, user, refresh token, authorization code, or browser profile may be reused.

| Safety gate | Required proof before `kubectl apply` |
|---|---|
| Cluster/environment | Current context is `bis-staging`; namespace label is `environment=staging`; admission policy rejects production namespaces. |
| Scope | BFF selector includes `app.kubernetes.io/component=bff` and `environment=staging`; target includes `app.kubernetes.io/name=keycloak` in `identity-staging`. |
| Load | Synthetic accounts only; test harness redacts cookies and provider parameters; request rate is approved and capped. |
| Reversibility | The exact manifest is versioned; `kubectl delete -f` is tested; an owner and expiry timestamp are present. |
| Observability | Refresh outcome, provider-unavailable, lease contention, BFF readiness, database health, and alert receiver checks are green at baseline. |
| Abort | Namespace/selector mismatch, credential leakage, unexpected privilege success, database impact, or a failed recovery probe ends the experiment immediately. |

## 2. Sample Chaos Mesh CRD: Directed Keycloak Latency and Loss

This CRD applies `netem` impairment **from BFF pods to Keycloak pods**, rather than corrupting all Keycloak networking. The values below deliberately model meaningful but recoverable impairment: 350 ms added latency, 75 ms jitter, and 15% packet loss for four minutes. Change values only through the approved staging change record; do not set `duration` to an open-ended value.

```yaml
# chaos/staging/keycloak-auth-latency-loss.yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: bff-to-keycloak-auth-latency-loss
  namespace: bis-staging
  labels:
    environment: staging
    app.kubernetes.io/part-of: bis
    owner: identity-platform
    change-ticket: CHG-STG-AUTH-LATENCY-001
  annotations:
    chaos.bis.example.com/expires-at: "2026-08-18T19:30:00Z"
    chaos.bis.example.com/synthetic-load: "auth-peak-v1"
    chaos.bis.example.com/abort-runbook: "docs/KEYCLOAK_OUTAGE_CICD_AND_SECURITY_PLAYBOOK.md"
spec:
  action: netem
  mode: all
  duration: "4m"
  selector:
    namespaces:
      - bis-staging
    labelSelectors:
      app.kubernetes.io/name: bis-auth
      app.kubernetes.io/component: bff
      environment: staging
  direction: to
  target:
    mode: all
    selector:
      namespaces:
        - identity-staging
      labelSelectors:
        app.kubernetes.io/name: keycloak
        environment: staging
  delay:
    latency: "350ms"
    jitter: "75ms"
    correlation: "25"
  loss:
    loss: "15"
    correlation: "25"
```

### 2.1 Loss escalation variant

Use a separate change record and experiment run for total loss. Do not increase latency and loss beyond the expected recovery envelope in the same first exercise. This manifest uses the same selectors but changes only impairment fields:

```yaml
# For a separate, finite total-loss drill after the partial-loss drill passes.
spec:
  action: netem
  mode: all
  duration: "2m"
  selector:
    namespaces: [bis-staging]
    labelSelectors:
      app.kubernetes.io/name: bis-auth
      app.kubernetes.io/component: bff
      environment: staging
  direction: to
  target:
    mode: all
    selector:
      namespaces: [identity-staging]
      labelSelectors:
        app.kubernetes.io/name: keycloak
        environment: staging
  loss:
    loss: "100"
    correlation: "100"
```

### 2.2 Preflight, load, and recovery procedure

The load generator must exercise authorization and refresh behavior through a test realm without printing redirects, cookies, codes, or credentials. A browser-driven test is preferable when the full authorization-code journey matters; a service-level synthetic refresh probe is sufficient for the refresh path. Keep them separately labeled in results.

```bash
#!/usr/bin/env bash
# scripts/chaos/run-keycloak-latency-loss.sh
set -Eeuo pipefail

[[ "${KUBE_CONTEXT:-}" == "bis-staging" ]] || { echo "refusing non-staging context" >&2; exit 64; }
kubectl config current-context | grep -qx bis-staging
kubectl get namespace bis-staging -o jsonpath='{.metadata.labels.environment}' | grep -qx staging
./scripts/chaos/preflight-keycloak-outage.sh
./scripts/chaos/capture-baseline.sh artifacts

# Starts only a capped synthetic test-realm workload. It must redact all credential material.
./scripts/chaos/start-auth-load.sh --profile auth-peak-v1 --environment staging
trap './scripts/chaos/stop-auth-load.sh; kubectl delete -f chaos/staging/keycloak-auth-latency-loss.yaml --ignore-not-found' EXIT

kubectl apply -f chaos/staging/keycloak-auth-latency-loss.yaml
./scripts/chaos/assert-auth-latency-contract.sh --environment staging --artifacts artifacts
kubectl delete -f chaos/staging/keycloak-auth-latency-loss.yaml --ignore-not-found
./scripts/chaos/stop-auth-load.sh
./scripts/synthetic-auth-check.sh staging post-chaos
./scripts/assert-refresh-leases-clean.sh staging
```

| Probe | Partial latency/loss expected result | Total-loss expected result | Recovery proof |
|---|---|---|---|
| Existing permitted local session | Works only for route-policy-approved requests; it does not cause implicit refresh. | Same. | Normal local expiry still applies. |
| New OIDC login | May be slower or fail according to bounded timeout; no BIS session is issued on an incomplete callback. | Fails with a bounded provider-availability result. | New PKCE transaction completes after fault deletion. |
| Refresh lease | One holder performs a bounded provider attempt; peers wait or receive a controlled result. | Lease expires/clears per policy; no replay storm. | New post-fault rotation wins exactly once. |
| High-risk action | Requires fresh assurance and denies safely if unavailable. | Denies safely. | Fresh assurance succeeds after recovery. |
| Alerts | Dependency latency/error and user-impact thresholds may alert per policy. | Provider-unavailable/user-impact alerts should fire. | Alerts resolve only after synthetic recovery and metrics normalization. |

## 3. Operational Evidence Pack

Collect the following evidence by correlation ID, UTC timestamp, deployment revision, synthetic actor class, and experiment manifest digest. Do **not** collect raw tokens, codes, refresh ciphertext, KMS output, cookies, user emails, or full provider responses.

| Evidence class | Keycloak outage evidence | Token-compromise evidence |
|---|---|---|
| Service condition | BFF readiness, Keycloak readiness, provider timeout/circuit state, synthetic login/refresh outcome. | Revocation status, session version/epoch transition, provider logout result, affected route denial. |
| Database | Lease count, stale lease cleanup result, refresh outcome category, migration revision. | Session-family identifier, encryption key version, scoped/global invalidation transaction ID, audit event chain. |
| Network/chaos | Namespace, selector digest, duration, controller owner, apply/delete times, abort status. | Not applicable unless compromise coincides with a network or provider event. |
| Communications | Incident declaration, user impact wording, next update time, recovery confirmation. | Containment scope, customer/legal/privacy approval, forced-reauth messaging, regulator decision record. |

## 4. Post-Incident Review Template

Google SRE's postmortem example captures summary, impact, root causes, trigger, resolution, detection, action items, lessons learned, a UTC timeline, and supporting evidence. [2] The template below adapts that evidence-oriented structure to Keycloak outage and refresh-token compromise events while keeping credentials out of the record.

```markdown
# PIR — [INCIDENT-ID] [Keycloak outage | refresh-token compromise]

## Document control
| Field | Value |
|---|---|
| Incident ID | `INC-YYYY-NNN` |
| Severity / classification | `SEV-? / availability or security` |
| Incident commander | Name and role |
| Security lead | Name and role |
| Review owner | Name and role |
| Status | Draft / reviewed / actions in progress / closed |
| UTC window | Start, detection, mitigation, recovery, close |

## Executive summary
State what happened, which user journeys were affected, the containment scope, and current risk. Do not include tokens, codes, cookies, or unredacted provider responses.

## Impact
| Population / journey | Observed impact | Start–end UTC | Evidence link |
|---|---|---|---|
| New sign-in | | | |
| Session refresh | | | |
| High-risk assurance | | | |
| Existing local session routes | | | |
| Security scope (if compromise) | | | |

## Detection and escalation
Record the alert, synthetic probe, customer report, or security signal; state why it was or was not detected earlier.

## Timeline (UTC)
| Time | Actor/system | Observation | Decision/action | Evidence ID |
|---|---|---|---|---|

## Technical narrative
Describe the failed dependency, trust boundary, BFF behavior, refresh-lease state, Keycloak outcome, database state, proxy/network condition, and recovery decision.

## Root cause and contributing factors
Use the RCA framework below. Separate the initiating trigger from systemic causes, detection gaps, and contributing conditions.

## What went well / what went poorly / where we were lucky
Use observable evidence. Avoid personal blame or unsupported causal claims.

## Corrective actions
| ID | Type | Action | Owner | Due date | Verification evidence | Status |
|---|---|---|---|---|---|---|

## Communication and approvals
List internal updates, customer notices, legal/privacy/security approvals, and any regulatory decision record.

## Follow-up validation
State the test, chaos drill, restore rehearsal, security regression, or audit review that proves each closed action.
```

## 5. Root Cause Analysis Framework

Use a causal analysis that respects evidence and separates **trigger**, **root cause**, **contributing factors**, and **control gaps**. A single “five whys” chain is useful only when it is grounded in evidence; a fault tree is better for multi-cause identity incidents.

### 5.1 RCA flow

| Stage | Key question | Evidence required |
|---|---|---|
| Define event | What exact user/security contract failed? | Bounded impact statement and UTC timeline. |
| Identify trigger | What immediately initiated the event? | Provider health, network change, deployment, credential signal, or detected replay event. |
| Build causal graph | Which technical and operational conditions were necessary or sufficient? | Configuration revisions, dependency state, lease/audit records, network/chaos metadata, alerts, change approvals. |
| Classify gaps | Was prevention, detection, containment, recovery, or communication inadequate? | Expected versus actual control behavior. |
| Select actions | Which actions remove or reduce a cause, not merely the visible symptom? | Owner, deadline, evidence-based acceptance test, and risk acceptance if unresolved. |
| Validate closure | What exercise proves the change? | Test run, staging chaos drill, restore rehearsal, audit log, and monitoring output. |

### 5.2 Keycloak outage prompts

1. Did the outage originate in Keycloak, DNS, TLS, network policy, BFF egress, proxy routing, certificate trust, or an overload/circuit-breaker configuration?
2. Did BFF timeouts and circuit behavior keep latency bounded, and did any request exceed retry limits?
3. Which local-session routes remained available, and did any privileged or fresh-assurance action succeed contrary to policy?
4. Did every expired or failed refresh lease clear according to the documented recovery policy?
5. Were alerts based on user-impact signals, and did they identify the dependency boundary quickly enough?

### 5.3 Token compromise prompts

1. What signal established suspicion: replay pattern, device anomaly, secret exposure, database access alert, KMS event, or external notification?
2. Which session family, key version, release revision, and trust boundary were involved? Record identifiers or hashes—not token values.
3. Was a targeted family revocation sufficient, or did evidence require cohort/global epoch invalidation and root rotation?
4. Did audit events prove who authorized containment and whether all relevant provider/BFF sessions were terminated?
5. Did telemetry, ticketing, logs, backups, or communications leak credential material during response?

## 6. PIR Facilitation Rules

The PIR should be blameless, evidence-led, and time-bounded. It must distinguish confirmed facts from hypotheses, track action completion through a named owner and verification test, and explicitly record risk accepted by an accountable authority. Security-sensitive appendices belong in an access-controlled incident system; the broadly shared PIR contains redacted identifiers and safe conclusions only.

## References

[1] [Chaos Mesh: Simulate Network Faults](https://chaos-mesh.org/docs/simulate-network-chaos-on-kubernetes/)  
[2] [Google SRE: Example Postmortem](https://sre.google/sre-book/example-postmortem/)
