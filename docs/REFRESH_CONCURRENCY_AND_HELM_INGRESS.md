# Concurrent Refresh Coordination and Kubernetes Helm/Ingress Deployment

**Author:** Manus AI  
**Status:** Implementation reference. The code and chart below are the recommended target architecture for the BFF-held Keycloak refresh-token model. They are not yet applied to the BIS repository.

## 1. What Happens When Multiple Tabs Refresh Together

The browser-side `refreshInFlight` promise from the previous reference deduplicates refresh calls **within one JavaScript realm**. It does not coordinate two browser tabs, two devices, or requests reaching different BFF pods. Browser coordination is an optimization; the database is the authority.

The BFF needs a durable refresh-session record and a monotonically increasing `refreshVersion`. The signed BIS session cookie contains an opaque `sessionId` and the version at which it was issued. The database record contains the current Keycloak refresh token, encrypted at rest, and the current version.

| Component | Responsibility | Security property |
|---|---|---|
| Each browser tab | Retries one failed request after the BFF returns 204; optionally broadcasts the new cookie state to sibling tabs. | Cannot access Keycloak tokens. |
| BFF pod | Validates BIS cookie and its session version; only one pod claims a refresh lease for a session/version. | Horizontal replicas coordinate through PostgreSQL, not memory. |
| PostgreSQL | Stores token ciphertext, `refreshVersion`, claim lease, and revocation state. | Source of truth across tabs, pods, and restarts. |
| Keycloak | Rotates the refresh token and rejects reused/revoked token families. | Provider remains the authority for token validity. |

### Sequence: Two Tabs, Two BFF Pods

Assume tabs A and B both hold a BIS cookie with `{ sessionId: S, refreshVersion: 7 }`. The database contains session `S` at version 7 with encrypted Keycloak refresh token `R7`.

| Step | Tab A / Pod 1 | Tab B / Pod 2 | Database state |
|---|---|---|---|
| 1 | Gets a 401 and calls `/api/auth/refresh`. | Gets a 401 at nearly the same time and calls the same endpoint. | `version=7`, no lease. |
| 2 | Atomically claims lease `L1` only if version is 7 and no live lease exists. | Atomic claim returns no row because `L1` exists. | `leaseId=L1`, short lease expiry, `version=7`. |
| 3 | Sends `R7` to Keycloak once. | Polls the row briefly or returns `409 refresh_in_progress` with `Retry-After: 1`; it **does not** call Keycloak. | Still version 7. |
| 4 | Keycloak returns `R8`; Pod 1 verifies claims, encrypts `R8`, sets version 8, clears lease, and issues a BIS cookie with version 8. | Observes version 8, issues a fresh BIS cookie without a second Keycloak call, then returns 204. | `version=8`, no lease. |
| 5 | Replays its original API request once. | Replays its original API request once. | Keycloak refresh endpoint was invoked exactly once. |

If Pod 1 crashes or times out after Keycloak has possibly consumed `R7`, the BFF **must not blindly retry `R7`**. Let the lease expire, then treat the session family as suspicious: revoke it locally and require a new interactive login. This conservative failure mode avoids accepting an unknown refresh-token rotation state.

## 2. Database Fields and Atomic Lease Claim

Add these fields to the proposed `keycloak_refresh_sessions` table.

```ts
refreshVersion: integer("refresh_version").notNull().default(1),
refreshLeaseId: uuid("refresh_lease_id"),
refreshLeaseExpiresAt: timestamp("refresh_lease_expires_at", { withTimezone: true }),
```

The transaction below obtains a lease without holding a database transaction open during the remote Keycloak call.

```ts
// server/auth/refreshLease.ts
import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { keycloakRefreshSessions } from "../../drizzle/schema";

const LEASE_MS = 12_000;

export async function claimRefreshLease(db: DrizzleDb, input: {
  sessionId: string;
  expectedVersion: number;
  now: Date;
}) {
  const leaseId = randomUUID();
  const leaseExpiresAt = new Date(input.now.getTime() + LEASE_MS);

  // PostgreSQL's UPDATE predicate is the cross-pod compare-and-swap.
  const [claimed] = await db.update(keycloakRefreshSessions)
    .set({ refreshLeaseId: leaseId, refreshLeaseExpiresAt: leaseExpiresAt, updatedAt: input.now })
    .where(and(
      eq(keycloakRefreshSessions.id, input.sessionId),
      eq(keycloakRefreshSessions.refreshVersion, input.expectedVersion),
      isNull(keycloakRefreshSessions.revokedAt),
      or(
        isNull(keycloakRefreshSessions.refreshLeaseExpiresAt),
        lt(keycloakRefreshSessions.refreshLeaseExpiresAt, input.now),
      ),
    ))
    .returning();

  return claimed ? { kind: "claimed" as const, record: claimed, leaseId } : { kind: "not-claimed" as const };
}

export async function inspectRefreshState(db: DrizzleDb, sessionId: string) {
  const [record] = await db.select().from(keycloakRefreshSessions)
    .where(and(eq(keycloakRefreshSessions.id, sessionId), isNull(keycloakRefreshSessions.revokedAt)))
    .limit(1);
  return record ?? null;
}
```

The helper deliberately does not use a process-local mutex or Redis lock as its authority. A local mutex fails when tabs reach separate replicas; a Redis optimization can be added later, but PostgreSQL persists the version and lease through BFF restarts.

## 3. Refresh Route With Cross-Tab Safety

The existing BFF cookie/session reader must return an opaque session ID and its signed `refreshVersion`. Do not derive the version from a client-controlled header.

```ts
// server/_core/sessionRefresh.ts — core flow, abbreviated
app.post("/api/auth/refresh", requireSameOriginCsrf, async (req, res) => {
  const current = await getAuthenticatedBISSession(req);
  if (!current) return res.status(401).json({ error: "session_required" });

  const db = await getDb();
  if (!db) return res.status(503).json({ error: "database_unavailable" });
  const now = new Date();
  const claim = await claimRefreshLease(db, {
    sessionId: current.id,
    expectedVersion: current.refreshVersion,
    now,
  });

  if (claim.kind === "not-claimed") {
    const state = await inspectRefreshState(db, current.id);
    if (!state || state.revokedAt) {
      await clearBISSession(req, res);
      return res.status(401).json({ error: "reauthentication_required" });
    }
    if (state.refreshVersion > current.refreshVersion) {
      // A sibling tab/pod already rotated successfully. No second Keycloak call.
      const claims = await loadCurrentClaimsForSession(state);
      await issueBISSession(req, res, { sessionId: state.id, refreshVersion: state.refreshVersion, claims });
      return res.status(204).end();
    }
    // A live lease is owned by another BFF. The browser waits, then retries once.
    res.setHeader("Retry-After", "1");
    return res.status(409).json({ error: "refresh_in_progress" });
  }

  try {
    const refreshToken = decryptForPurpose(claim.record, "keycloak-refresh-token:v1");
    const refreshed = await refreshAtKeycloak(refreshToken);
    if (!refreshed.refresh_token) throw new Error("provider_did_not_rotate_token");
    const claims = await verifyKeycloakToken(refreshed.access_token);
    if (!claims || claims.sub !== claim.record.keycloakSubject) throw new Error("subject_mismatch");

    const nextVersion = claim.record.refreshVersion + 1;
    const encrypted = encryptForPurpose(refreshed.refresh_token, "keycloak-refresh-token:v1");
    const [saved] = await db.update(keycloakRefreshSessions).set({
      ...encrypted,
      refreshVersion: nextVersion,
      refreshLeaseId: null,
      refreshLeaseExpiresAt: null,
      lastUsedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(keycloakRefreshSessions.id, claim.record.id),
      eq(keycloakRefreshSessions.refreshLeaseId, claim.leaseId),
    )).returning();

    if (!saved) throw new Error("lost_refresh_lease");
    await issueBISSession(req, res, { sessionId: saved.id, refreshVersion: nextVersion, claims });
    return res.status(204).end();
  } catch (error) {
    // invalid_grant, timeout after provider interaction, lease loss, or subject mismatch
    await revokeSessionFamily(db, current.id, "refresh_rotation_failed");
    await clearBISSession(req, res);
    return res.status(401).json({ error: "reauthentication_required" });
  }
});
```

For a Keycloak network outage that occurs **before** a token request is sent, it is acceptable to clear the lease and return `503 refresh_temporarily_unavailable` without revoking. For ambiguous timeouts after request transmission, revoke rather than reuse the prior refresh token.

## 4. Browser Coordination Is an Optimization

Use `BroadcastChannel` only to reduce unnecessary refresh attempts. It is not a security control and must not carry a token, code, verifier, user profile, or raw session value.

```ts
// client/src/lib/sessionRecovery.ts
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("bis-session");
let refreshInFlight: Promise<boolean> | null = null;

channel?.addEventListener("message", event => {
  if (event.data?.type === "session-refreshed") {
    // Invalidate cookie-backed tRPC/React Query state; do not receive a token.
    window.dispatchEvent(new Event("bis:session-refreshed"));
  }
});

export async function recoverSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/auth/refresh", {
      method: "POST", credentials: "include", headers: csrfHeaders(),
    }).then(async response => {
      if (response.status === 204) {
        channel?.postMessage({ type: "session-refreshed" });
        return true;
      }
      if (response.status === 409) {
        await new Promise(resolve => setTimeout(resolve, 900));
        // One retry; the database version is the authoritative coordination point.
        return (await fetch("/api/auth/refresh", {
          method: "POST", credentials: "include", headers: csrfHeaders(),
        })).status === 204;
      }
      return false;
    }).catch(() => false).finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}
```

## 5. Helm Chart Layout

```text
charts/bis-auth/
  Chart.yaml
  values.yaml
  templates/
    _helpers.tpl
    serviceaccount.yaml
    bff-deployment.yaml
    bff-service.yaml
    nginx-configmap.yaml
    nginx-deployment.yaml
    nginx-service.yaml
    ingress.yaml
    pdb.yaml
    hpa.yaml
    networkpolicy.yaml
```

### `Chart.yaml`

```yaml
apiVersion: v2
name: bis-auth
description: BIS BFF plus internal Nginx authentication proxy
type: application
version: 0.1.0
appVersion: "immutable-image-tag-required"
```

### `values.yaml`

```yaml
nameOverride: ""
fullnameOverride: ""

imagePullSecrets: []

bff:
  replicaCount: 3
  image:
    repository: registry.example.com/munisp/bis
    tag: "REPLACE_WITH_IMMUTABLE_DIGEST_OR_TAG"
    pullPolicy: IfNotPresent
  existingSecret: bis-auth-runtime
  publicOrigin: https://bis.example.com
  resources:
    requests: { cpu: 250m, memory: 512Mi }
    limits: { cpu: "1", memory: 1Gi }
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70

nginx:
  replicaCount: 2
  image: nginx:1.28-alpine
  resources:
    requests: { cpu: 100m, memory: 128Mi }
    limits: { cpu: 500m, memory: 256Mi }

ingress:
  enabled: true
  className: nginx
  host: bis.example.com
  tls:
    secretName: bis-example-com-tls
  certManagerClusterIssuer: letsencrypt-prod

# CIDRs occupied by the ingress controller / nodes that may reach the Nginx Service.
trustedIngressCidrs: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
```

### Runtime Secret

Create `bis-auth-runtime` through External Secrets, a cloud secret manager integration, or an out-of-band CI/CD secret command. Do not place secret literals in `values.yaml`. Kubernetes Secrets are not encrypted at rest by default, so encryption at rest, RBAC, and narrowly scoped pod access are required. [4]

```yaml
# Example keys only; values must come from the secret manager.
apiVersion: v1
kind: Secret
metadata:
  name: bis-auth-runtime
type: Opaque
stringData:
  BIS_DATABASE_URL: REPLACE_OUT_OF_BAND
  BIS_SESSION_SIGNING_SECRET: REPLACE_OUT_OF_BAND
  KEYCLOAK_TOKEN_ENCRYPTION_KEY: REPLACE_OUT_OF_BAND
  KEYCLOAK_URL: https://id.example.com
  KEYCLOAK_REALM: bis
  KEYCLOAK_CLIENT_ID: bis-bff
  KEYCLOAK_CLIENT_SECRET: REPLACE_OUT_OF_BAND
```

### BFF Deployment and Service

```yaml
{{- /* templates/bff-deployment.yaml */ -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "bis-auth.fullname" . }}-bff
spec:
  replicas: {{ .Values.bff.replicaCount }}
  revisionHistoryLimit: 3
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxUnavailable: 0, maxSurge: 1 }
  selector:
    matchLabels: { app.kubernetes.io/name: {{ include "bis-auth.name" . }}, app.kubernetes.io/component: bff }
  template:
    metadata:
      labels: { app.kubernetes.io/name: {{ include "bis-auth.name" . }}, app.kubernetes.io/component: bff }
    spec:
      automountServiceAccountToken: false
      securityContext: { seccompProfile: { type: RuntimeDefault } }
      containers:
        - name: bff
          image: "{{ .Values.bff.image.repository }}:{{ .Values.bff.image.tag }}"
          imagePullPolicy: {{ .Values.bff.image.pullPolicy }}
          command: ["node", "dist/index.js"]
          ports: [{ name: http, containerPort: 3000 }]
          env:
            - { name: NODE_ENV, value: production }
            - { name: PORT, value: "3000" }
            - { name: PUBLIC_APP_ORIGIN, value: {{ .Values.bff.publicOrigin | quote }} }
            - { name: TRUST_PROXY_HOPS, value: "1" }
          envFrom: [{ secretRef: { name: {{ .Values.bff.existingSecret }} } }]
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            capabilities: { drop: ["ALL"] }
          volumeMounts: [{ name: tmp, mountPath: /tmp }]
          startupProbe:
            httpGet: { path: /healthz, port: http }
            failureThreshold: 30
            periodSeconds: 10
          readinessProbe:
            httpGet: { path: /readyz, port: http }
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:
            httpGet: { path: /healthz, port: http }
            periodSeconds: 15
            failureThreshold: 3
          resources: {{- toYaml .Values.bff.resources | nindent 12 }}
      volumes: [{ name: tmp, emptyDir: { medium: Memory, sizeLimit: 64Mi } }]
---
apiVersion: v1
kind: Service
metadata:
  name: {{ include "bis-auth.fullname" . }}-bff
spec:
  type: ClusterIP
  selector: { app.kubernetes.io/name: {{ include "bis-auth.name" . }}, app.kubernetes.io/component: bff }
  ports: [{ name: http, port: 3000, targetPort: http }]
```

Kubernetes Deployments support controlled rolling replacement of Pods; `maxUnavailable: 0` preserves all ready BFF replicas during a normal rollout. [1] Readiness probes keep pods out of service endpoints until they can serve traffic, while liveness probes restart unhealthy containers. [3]

### Nginx ConfigMap, Deployment, and Service

The Kubernetes Ingress controller terminates external TLS. Nginx is a second, internal BFF proxy whose job is path policy, rate limits, security headers, and a single trusted proxy hop to the BFF. The BFF must set `trust proxy` to exactly one hop and never receive public traffic directly.

```yaml
{{- /* templates/nginx-configmap.yaml */ -}}
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "bis-auth.fullname" . }}-nginx
data:
  default.conf: |
    limit_req_zone $binary_remote_addr zone=auth:10m rate=10r/m;
    limit_req_zone $binary_remote_addr zone=refresh:10m rate=30r/m;
    upstream bff { server {{ include "bis-auth.fullname" . }}-bff:3000; keepalive 32; }
    server {
      listen 8080;
      server_tokens off;
      client_max_body_size 50m;
      add_header X-Content-Type-Options "nosniff" always;
      add_header Referrer-Policy "no-referrer" always;
      add_header X-Frame-Options "DENY" always;
      add_header Cache-Control "no-store" always;

      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Host $host;
      # Forward external scheme supplied by the trusted ingress controller.
      proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
      proxy_set_header X-Forwarded-Port $http_x_forwarded_port;
      proxy_set_header Connection "";
      proxy_connect_timeout 5s;
      proxy_send_timeout 30s;
      proxy_read_timeout 60s;

      location ^~ /api/auth/keycloak/ { limit_req zone=auth burst=5 nodelay; proxy_pass http://bff; }
      location = /api/auth/refresh { limit_req zone=refresh burst=10 nodelay; proxy_pass http://bff; }
      location / { proxy_pass http://bff; }
    }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "bis-auth.fullname" . }}-nginx
spec:
  replicas: {{ .Values.nginx.replicaCount }}
  strategy: { type: RollingUpdate, rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } }
  selector:
    matchLabels: { app.kubernetes.io/name: {{ include "bis-auth.name" . }}, app.kubernetes.io/component: nginx }
  template:
    metadata:
      labels: { app.kubernetes.io/name: {{ include "bis-auth.name" . }}, app.kubernetes.io/component: nginx }
    spec:
      automountServiceAccountToken: false
      containers:
        - name: nginx
          image: {{ .Values.nginx.image }}
          ports: [{ name: http, containerPort: 8080 }]
          securityContext:
            runAsNonRoot: true
            runAsUser: 101
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          volumeMounts:
            - { name: config, mountPath: /etc/nginx/conf.d, readOnly: true }
            - { name: cache, mountPath: /var/cache/nginx }
            - { name: run, mountPath: /var/run }
          readinessProbe: { httpGet: { path: /healthz, port: http }, periodSeconds: 5 }
          livenessProbe: { httpGet: { path: /healthz, port: http }, periodSeconds: 15 }
          resources: {{- toYaml .Values.nginx.resources | nindent 12 }}
      volumes:
        - { name: config, configMap: { name: {{ include "bis-auth.fullname" . }}-nginx } }
        - { name: cache, emptyDir: {} }
        - { name: run, emptyDir: {} }
---
apiVersion: v1
kind: Service
metadata:
  name: {{ include "bis-auth.fullname" . }}-nginx
spec:
  type: ClusterIP
  selector: { app.kubernetes.io/name: {{ include "bis-auth.name" . }}, app.kubernetes.io/component: nginx }
  ports: [{ name: http, port: 80, targetPort: http }]
```

Implement `/healthz` as a process liveness route that does not disclose database status and `/readyz` as a readiness route that confirms the required database pool can serve a bounded query. Nginx’s own health path should return 200 without proxying only if it is used to assess the proxy itself; otherwise proxy to BFF readiness.

### Ingress and TLS

```yaml
{{- /* templates/ingress.yaml */ -}}
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "bis-auth.fullname" . }}
  annotations:
    cert-manager.io/cluster-issuer: {{ .Values.ingress.certManagerClusterIssuer | quote }}
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
    nginx.ingress.kubernetes.io/proxy-connect-timeout: "5"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "30"
spec:
  ingressClassName: {{ .Values.ingress.className }}
  tls:
    - hosts: [{{ .Values.ingress.host | quote }}]
      secretName: {{ .Values.ingress.tls.secretName }}
  rules:
    - host: {{ .Values.ingress.host | quote }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "bis-auth.fullname" . }}-nginx
                port: { number: 80 }
{{- end }}
```

The Kubernetes `Ingress` API routes HTTP(S) host/path traffic to Services and requires an installed controller; it is stable but frozen, so use this chart only if the cluster’s platform standard is Ingress and plan a Gateway API migration when feasible. [2]

### Pod Disruption Budget, Autoscaling, and Network Policy

```yaml
{{- /* templates/pdb.yaml */ -}}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: { name: {{ include "bis-auth.fullname" . }}-bff }
spec:
  minAvailable: 2
  selector: { matchLabels: { app.kubernetes.io/name: {{ include "bis-auth.name" . }}, app.kubernetes.io/component: bff } }
---
{{- /* templates/hpa.yaml */ -}}
{{- if .Values.bff.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: {{ include "bis-auth.fullname" . }}-bff }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: {{ include "bis-auth.fullname" . }}-bff }
  minReplicas: {{ .Values.bff.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.bff.autoscaling.maxReplicas }}
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: {{ .Values.bff.autoscaling.targetCPUUtilizationPercentage }} } }
{{- end }}
---
{{- /* templates/networkpolicy.yaml */ -}}
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: {{ include "bis-auth.fullname" . }}-bff }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: {{ include "bis-auth.name" . }}, app.kubernetes.io/component: bff } }
  policyTypes: ["Ingress", "Egress"]
  ingress:
    - from:
        - podSelector: { matchLabels: { app.kubernetes.io/name: {{ include "bis-auth.name" . }}, app.kubernetes.io/component: nginx } }
      ports: [{ protocol: TCP, port: 3000 }]
  egress:
    # Restrict further with your CNI / egress gateway to managed PostgreSQL, Keycloak, DNS, and approved providers.
    - {}
```

The final `egress: - {}` is intentionally permissive until the cluster has an approved egress gateway or precise provider CIDRs/FQDN policy. Do not present it as a final zero-trust policy; tighten it before production approval.

## 6. Release and Failure Tests

| Test | Expected behavior |
|---|---|
| Ten concurrent tab refreshes across at least two BFF pods | One Keycloak refresh; one version increment; remaining calls receive 204 after observing the increment or a bounded 409/retry. |
| Lease-holder pod termination | Lease expiry causes conservative reauthentication if rotation state is ambiguous; no retry of a potentially consumed token. |
| Rolling deployment during refresh | PDB keeps two BFF replicas ready; database state allows a new pod to observe existing lease/version. |
| Ingress HTTPS request | BFF sees `X-Forwarded-Proto=https`; it emits `Secure` session cookie. |
| Direct BFF access | Fails because BFF is ClusterIP-only and NetworkPolicy allows ingress from Nginx pods only. |
| Secret access review | Only BFF ServiceAccount can read/mount `bis-auth-runtime`; encryption at rest and external secrets are enabled. |
| Helm render | `helm lint`, `helm template`, schema validation, and a policy check confirm no literal secret, `latest` image, privileged pod, or public BFF service. |

## References

[1] [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)  
[2] [Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)  
[3] [Kubernetes Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)  
[4] [Kubernetes Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)  
[5] [Keycloak: Securing applications and services with OpenID Connect](https://www.keycloak.org/securing-apps/oidc-layers)
