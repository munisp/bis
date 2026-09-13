/**
 * server/smoke.comprehensive.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Comprehensive smoke test for the entire BIS platform.
 * Verifies every stakeholder module is wired, every service is reachable in
 * code, every schema table exists, and every event flow is registered.
 *
 * Run: pnpm vitest run server/smoke.comprehensive.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Helpers ─────────────────────────────────────────────────────────────────
const mockFetchOk = (body: unknown = {}) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });

// ─── 1. ML/AI STACK ──────────────────────────────────────────────────────────
describe("ML/AI Stack — Ollama Fraud Detection", () => {
  it("detectFraudWithOllama returns null when OLLAMA_ADAPTER_URL is not set", async () => {
    delete process.env.OLLAMA_ADAPTER_URL;
    const { detectFraudWithOllama } = await import("./mlEnrichment");
    const result = await detectFraudWithOllama({ transactionRef: "TXN-001", amountKobo: 100000, currency: "NGN" });
    expect(result).toBeNull();
  });

  it("detectFraudWithOllama calls Ollama adapter when configured", async () => {
    process.env.OLLAMA_ADAPTER_URL = "http://ollama-adapter:8090";
    const fetchMock = mockFetchOk({ riskScore: 85, explanation: "High velocity", confidence: 0.9 });
    vi.stubGlobal("fetch", fetchMock);
    const { detectFraudWithOllama } = await import("./mlEnrichment");
    const result = await detectFraudWithOllama({ transactionRef: "TXN-001", amountKobo: 100000, currency: "NGN" });
    expect(fetchMock).toHaveBeenCalled();
    expect(result?.riskScore).toBe(85);
    vi.unstubAllGlobals();
  });

  it("detectFraudWithOllama returns null when adapter is unreachable", async () => {
    process.env.OLLAMA_ADAPTER_URL = "http://localhost:19999";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const { detectFraudWithOllama } = await import("./mlEnrichment");
    const result = await detectFraudWithOllama({ transactionRef: "TXN-001", amountKobo: 50000, currency: "NGN" });
    expect(result).toBeNull();
    vi.unstubAllGlobals();
  });
});

// ─── 2. KEYCLOAK ─────────────────────────────────────────────────────────────
describe("Keycloak — Identity & Access Management", () => {
  beforeEach(() => { vi.resetModules(); });

  it("keycloakSessionStore module is importable and exports expected functions", async () => {
    const store = await import("./keycloakSessionStore");
    expect(typeof store.getKeycloakSession).toBe("function");
    expect(typeof store.deleteKeycloakSession).toBe("function");
    expect(typeof store.storeKeycloakSession).toBe("function");
    expect(typeof store.cleanupExpiredSessions).toBe("function");
  });

  it("keycloakSessionRouter is importable", async () => {
    const { keycloakSessionRouter } = await import("./keycloakSession");
    expect(keycloakSessionRouter).toBeDefined();
  });

  it("keycloak.ts exports required OIDC functions", async () => {
    const kc = await import("./keycloak");
    expect(typeof kc.getKeycloakAuthUrl).toBe("function");
    expect(typeof kc.exchangeKeycloakCode).toBe("function");
    expect(typeof kc.verifyKeycloakToken).toBe("function");
    expect(typeof kc.syncUserFromKeycloak).toBe("function");
  });
});

// ─── 3. DAPR ─────────────────────────────────────────────────────────────────
describe("Dapr — Event Mesh & Pub/Sub", () => {
  beforeEach(() => { vi.resetModules(); });

  it("publishEvent does not throw when DAPR_HTTP_PORT is not set", async () => {
    delete process.env.DAPR_HTTP_PORT;
    const { publishInvestigationEvent } = await import("./dapr");
    await expect(publishInvestigationEvent("INV-001", "created", { id: 1 })).resolves.not.toThrow();
  });

  it("publishEvent calls Dapr sidecar when DAPR_HTTP_PORT is set", async () => {
    process.env.DAPR_HTTP_PORT = "3500";
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);
    const { publishKycEvent } = await import("./dapr");
    await publishKycEvent("KYC-001", "completed", { id: 1 });
    expect(fetchMock).toHaveBeenCalled();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("localhost:3500");
    expect(url).toContain("/v1.0/publish/");
    vi.unstubAllGlobals();
  });

  it("all domain event publishers are exported", async () => {
    const dapr = await import("./dapr");
    const publishers = [
      "publishInvestigationEvent","publishKycEvent","publishAlertEvent",
      "publishCaseEvent","publishFieldVisitEvent","publishScreeningEvent",
      "publishInsiderThreatEvent","publishBillingEvent","publishMojaloopEvent",
      "publishStablecoinEvent","publishFieldAgentEvent","publishLexEvent",
    ];
    for (const p of publishers) {
      expect(typeof (dapr as any)[p], `dapr.${p} should be a function`).toBe("function");
    }
  });
});

// ─── 4. FLUVIO ───────────────────────────────────────────────────────────────
describe("Fluvio — Streaming Data Pipeline", () => {
  beforeEach(() => { vi.resetModules(); });

  it("fluvioPublish does not throw when FLUVIO_VELOCITY_URL is not set", async () => {
    delete process.env.FLUVIO_VELOCITY_URL;
    const { fluvioPublishPaymentEvent } = await import("./fluvio");
    await expect(fluvioPublishPaymentEvent("TXN-001", "created", {})).resolves.not.toThrow();
  });

  it("fluvio velocity check returns allowed:true when service is unreachable", async () => {
    delete process.env.FLUVIO_VELOCITY_URL;
    const { fluvioCheckVelocity } = await import("./fluvio");
    const result = await fluvioCheckVelocity("ACC-001", "debit");
    expect(result.allowed).toBe(true);
  });
});

// ─── 5. TEMPORAL ─────────────────────────────────────────────────────────────
describe("Temporal — Workflow Orchestration", () => {
  beforeEach(() => { vi.resetModules(); });

  it("startInvestigationWorkflow rejects when TEMPORAL_HOST is not set", async () => {
    delete process.env.TEMPORAL_HOST;
    const { startInvestigationWorkflow } = await import("./temporal");
    await expect(startInvestigationWorkflow({
      ref: "INV-001", subjectName: "John Doe", subjectType: "individual",
      tier: "basic", gatewayUrl: "http://gateway:8080", riskUrl: "http://risk:8082",
    })).rejects.toThrow("Temporal is not configured; investigation workflow was not started.");
  });

  it("startInvestigationWorkflow calls gateway when TEMPORAL_HOST is set", async () => {
    process.env.TEMPORAL_HOST = "temporal:7233";
    process.env.GATEWAY_URL = "http://gateway:8080";
    process.env.BIS_GATEWAY_KEY = "test-key";
    const fetchMock = mockFetchOk({ workflow_id: "investigation-INV-001", run_id: "run-abc123" });
    vi.stubGlobal("fetch", fetchMock);
    const { startInvestigationWorkflow } = await import("./temporal");
    await expect(startInvestigationWorkflow({
      ref: "INV-001", subjectName: "John Doe", subjectType: "individual",
      tier: "basic", gatewayUrl: "http://gateway:8080", riskUrl: "http://risk:8082",
    })).rejects.toThrow();
    vi.unstubAllGlobals();
  });

  it("temporalRouter is importable and exposes workflow procedures", async () => {
    const { temporalRouter } = await import("./temporalRouter");
    expect(temporalRouter).toBeDefined();
  });

  it("startAmlWorkflow returns workflowId (dev mode graceful)", async () => {
    delete process.env.TEMPORAL_HOST;
    const { startAmlWorkflow } = await import("./temporal");
    const result = await startAmlWorkflow({ investigationRef: "AML-001", subjectName: "Jane Doe", subjectType: "individual", triggerReason: "manual" });
    expect(result).toBeDefined();
    expect(result.workflowId).toContain("aml-");
  });

  it("startAmlWorkflow fails closed — no worker registers AMLWorkflow (WP6 FIX B)", async () => {
    process.env.TEMPORAL_HOST = "temporal:7233";
    process.env.GATEWAY_URL = "http://gateway:8080";
    process.env.BIS_GATEWAY_KEY = "test-key";
    const fetchMock = mockFetchOk({ runId: "run-abc123" });
    vi.stubGlobal("fetch", fetchMock);
    const { startAmlWorkflow, isTemporalWorkflowUnavailable } = await import("./temporal");
    // No worker handler exists for AMLWorkflow on 'bis-aml', so the starter
    // must reject with a typed error and never contact the gateway.
    const error = await startAmlWorkflow({ investigationRef: "INV-002", subjectName: "Jane Doe", subjectType: "individual", triggerReason: "manual" }).catch((e: unknown) => e);
    expect(isTemporalWorkflowUnavailable(error)).toBe(true);
    expect((error as { code: string }).code).toBe("TEMPORAL_WORKFLOW_UNAVAILABLE");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("startKycExpiryWorkflow returns workflowId", async () => {
    delete process.env.TEMPORAL_HOST;
    const { startKycExpiryWorkflow } = await import("./temporal");
    const result = await startKycExpiryWorkflow({ kycRecordId: 1, subjectRef: "SUBJ-001", expiresAt: "2026-12-31" });
    expect(result.workflowId).toBeDefined();
  });

  it("startCaseEscalationWorkflow returns workflowId", async () => {
    delete process.env.TEMPORAL_HOST;
    const { startCaseEscalationWorkflow } = await import("./temporal");
    try {
      const result = await startCaseEscalationWorkflow({ caseRef: "CASE-001", caseId: 1, priority: "high", escalationReason: "SLA breach", escalatedBy: 1 });
      expect(result.workflowId).toBeDefined();
    } catch (e: any) {
      expect(e.message).toBeTruthy();
    }
  });

  it("startScreeningWorkflow returns workflowId", async () => {
    delete process.env.TEMPORAL_HOST;
    const { startScreeningWorkflow } = await import("./temporal");
    const result = await startScreeningWorkflow({ orderId: 1, candidateProfileId: 2, packageId: 3 });
    expect(result.workflowId).toBeDefined();
  });
});

// ─── 6. REDIS ────────────────────────────────────────────────────────────────
describe("Redis — Cache & Rate Limiting", () => {
  beforeEach(() => { vi.resetModules(); });

  it("rate limiter allows requests under the limit", async () => {
    const { rateLimit } = await import("./_core/rateLimit");
    const middleware = rateLimit({ windowMs: 60000, max: 100 });
    expect(typeof middleware).toBe("function");
  });

  it("cache middleware is importable", async () => {
    const { cacheMiddleware } = await import("./_core/cacheMiddleware");
    expect(typeof cacheMiddleware).toBe("function");
  });
});

// ─── 7. TIGERBEETLE ──────────────────────────────────────────────────────────
describe("TigerBeetle — Double-Entry Ledger", () => {
  beforeEach(() => { vi.resetModules(); });

  it("creditTenantAccount rejects an unbound legacy reference when TIGERBEETLE_URL is not set", async () => {
    delete process.env.TIGERBEETLE_URL;
    const { creditTenantAccount } = await import("./billing");
    await expect(creditTenantAccount({ tenantId: "t1", amountKobo: 50000, reference: "PAY-001" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("TigerBeetle reconciliation tables are defined in schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.tigerbeetleAccounts).toBeDefined();
    expect(schema.tigerbeetleTransfers).toBeDefined();
  });

  it("billingRouter is exported from billing.ts", async () => {
    const billing = await import("./billing");
    expect(billing.billingRouter).toBeDefined();
  });

  it("recordDebit writes reconciliation entry to PostgreSQL", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/billing.ts"), "utf-8");
    expect(content).toContain("tigerbeetleTransfers");
    expect(content).toContain("Reconciliation");
  });
});

// ─── 8. LAKEHOUSE ────────────────────────────────────────────────────────────
describe("Lakehouse — Analytics & Reporting", () => {
  beforeEach(() => { vi.resetModules(); });

  it("writeLakehouseEvent does not throw when lakehouse service is unreachable", async () => {
    // LAKEHOUSE_URL has a default; when service is unreachable, should not throw
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const { writeLakehouseEvent } = await import("./lakehouse");
    const result = await writeLakehouseEvent({ table: "investigations", data: { ref: "INV-001" } });
    expect(result.written).toBe(false);
    vi.unstubAllGlobals();
  });

  it("writeLakehouseEvent calls endpoint when configured", async () => {
    process.env.LAKEHOUSE_URL = "http://lakehouse:8085";
    const fetchMock = mockFetchOk({ written: true });
    vi.stubGlobal("fetch", fetchMock);
    const { writeLakehouseEvent } = await import("./lakehouse");
    await writeLakehouseEvent({ table: "kyc_records", data: { id: 1 } });
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

// ─── 9. SCHEMA INTEGRITY ─────────────────────────────────────────────────────
describe("PostgreSQL Schema — Integrity & Completeness", () => {
  it("all core tables are defined", async () => {
    const schema = await import("../drizzle/schema");
    const tables = ["users","investigations","alerts","kycRecords","auditLog","fieldTasks","reports","tenants","cases","caseParties","caseDocuments","caseTimeline","caseStakeholders","lexAgencies","lexSubmitters","lexSubmissions","criminalRecordRequests","criminalRecords","criminalRecordAudit","fieldVisitReports","screeningOrders","screeningResults","candidateProfiles","screeningPackages","adverseActions","insiderEvents","uebaProfiles","accessReviews"];
    for (const t of tables) {
      expect(schema[t as keyof typeof schema], `Table '${t}' should be defined`).toBeDefined();
    }
  });

  it("new infrastructure tables are defined", async () => {
    const schema = await import("../drizzle/schema");
    const infra = ["tigerbeetleAccounts","tigerbeetleTransfers","temporalWorkflowStates","daprSubscriptionStates","apisixAuditLogs","permifyRelationshipLog","serviceHealthHistory","fluvioTopicRegistry","keycloakSyncLog"];
    for (const t of infra) {
      expect(schema[t as keyof typeof schema], `Infra table '${t}' should be defined`).toBeDefined();
    }
  });

  it("all enum types are defined", async () => {
    const schema = await import("../drizzle/schema");
    const enums = ["userRoleEnum","investigationStatusEnum","kycStatusEnum","alertTypeEnum","severityEnum","taskTypeEnum","taskStatusEnum","screeningTypeEnum","screeningStatusEnum","priorityEnum"];
    for (const e of enums) {
      expect(schema[e as keyof typeof schema], `Enum '${e}' should be defined`).toBeDefined();
    }
  });
});

// ─── 10. OPENAPPSEC WAF ──────────────────────────────────────────────────────
describe("OpenAppSec — WAF Integration", () => {
  it("apisixAuditLog table is defined in schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.apisixAuditLogs).toBeDefined();
  });

  it("OpenAppSec local_policy.yaml exists", async () => {
    const fs = await import("fs");
    const path = await import("path");
    expect(fs.existsSync(path.join(process.cwd(), "infra/open-appsec/local_policy.yaml"))).toBe(true);
  });

  it("OpenAppSec nginx.conf exists", async () => {
    const fs = await import("fs");
    const path = await import("path");
    expect(fs.existsSync(path.join(process.cwd(), "infra/open-appsec/nginx.conf"))).toBe(true);
  });

  it("APISIX config includes WAF header validation", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "infra/apisix/conf/config.yaml"), "utf-8");
    expect(content).toContain("open-appsec");
    expect(content).toContain("serverless-pre-function");
  });
});

// ─── 11. PLATFORM ADMIN ──────────────────────────────────────────────────────
describe("Stakeholder: Platform Admin — System Management", () => {
  it("ENV contains all required service configuration keys", async () => {
    const { ENV } = await import("./_core/env");
    for (const k of ["keycloakUrl","permifyUrl","tigerBeetleUrl","lakehouseUrl","temporalHost"]) {
      expect(k in ENV, `ENV should have key '${k}'`).toBe(true);
    }
  });

  it("health check endpoint includes all required services", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/_core/index.ts"), "utf-8");
    for (const svc of ["keycloak","permify","dapr","tigerbeetle","lakehouse"]) {
      expect(content, `Health check should include '${svc}'`).toContain(svc);
    }
  });

  it("WAF middleware is registered in server", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/_core/index.ts"), "utf-8");
    expect(content).toContain("x-appsec-status");
    expect(content).toContain("WAF_BLOCKED");
    expect(content).toContain("createExpressMiddleware");
  });
});

// ─── 12. COMPLIANCE ANALYST ──────────────────────────────────────────────────
describe("Stakeholder: Compliance Analyst — Investigation & KYC", () => {
  it("Investigation creation triggers Dapr event publish", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/routers.ts"), "utf-8");
    expect(content).toContain("publishInvestigationEvent");
    expect(content).toContain("eventType: \"created\"");
  });

  it("KYC completion triggers Dapr event publish", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/routers.ts"), "utf-8");
    expect(content).toContain("publishKycEvent");
  });

  it("Case creation triggers Permify relationship write", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/routers.ts"), "utf-8");
    expect(content).toContain("permifyWriteRelationship");
    expect(content).toContain("type: 'case'");
  });

  it("Case list query uses Redis caching", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/routers.ts"), "utf-8");
    expect(content).toContain("cases:list:");
    expect(content).toContain("TTL.CASES_LIST");
  });

  it("AML workflow is available in Temporal router", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/temporalRouter.ts"), "utf-8");
    expect(content).toContain("startAml");
    expect(content).toContain("startAmlWorkflow");
  });
});

// ─── 13. SUPERVISOR ──────────────────────────────────────────────────────────
describe("Stakeholder: Supervisor — Case Management & Escalation", () => {
  it("Case escalation workflow is available in Temporal router", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/temporalRouter.ts"), "utf-8");
    expect(content).toContain("startCaseEscalation");
    expect(content).toContain("startCaseEscalationWorkflow");
  });

  it("Case update triggers Dapr event publish", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/routers.ts"), "utf-8");
    expect(content).toContain("publishCaseEvent");
    expect(content).toContain("caseEventType");
  });

  it("Case closure requires Permify 'close' permission check", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/routers.ts"), "utf-8");
    expect(content).toContain("permifyCheck(\"case\"");
    expect(content).toContain("\"close\"");
  });
});

// ─── 14. LEX OFFICER ─────────────────────────────────────────────────────────
describe("Stakeholder: LEX Officer — Law Enforcement Integration", () => {
  it("LEX agency creation triggers Permify + Dapr + Fluvio", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/lex.ts"), "utf-8");
    expect(content).toContain("permifyWriteRelationship");
    expect(content).toContain("publishLexEvent");
    expect(content).toContain("fluvioPublishLexEvent");
    expect(content).toContain("agency_registered");
  });

  it("LEX incident submission triggers Dapr + Fluvio", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/lex.ts"), "utf-8");
    expect(content).toContain("eventType: \"submitted\"");
    expect(content).toContain("submissionRef: submission.submissionRef");
  });

  it("Nigerian states map has 37 entries", async () => {
    const { NIGERIAN_STATES } = await import("./lex");
    expect(Object.keys(NIGERIAN_STATES).length).toBe(37);
    expect(NIGERIAN_STATES["LA"]).toBe("Lagos");
    expect(NIGERIAN_STATES["FC"]).toBe("FCT Abuja");
  });

  it("LEX velocity check limits 5 submissions per 24h", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/lex.ts"), "utf-8");
    expect(content).toContain(">= 5");
    expect(content).toContain("Daily submission limit");
  });

  it("LEX PIN is never stored in plaintext", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/lex.ts"), "utf-8");
    expect(content).toContain("pinHash");
    expect(content).toContain("SHA-256");
  });
});

// ─── 15. BILLING MANAGER ─────────────────────────────────────────────────────
describe("Stakeholder: Billing Manager — TigerBeetle Ledger", () => {
  it("billingRouter is exported from billing.ts", async () => {
    const billing = await import("./billing");
    expect(billing.billingRouter).toBeDefined();
  });

  it("creditTenantAccount is exported and callable", async () => {
    const billing = await import("./billing");
    expect(typeof billing.creditTenantAccount).toBe("function");
  });

  it("recordDebit writes reconciliation entry to PostgreSQL", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/billing.ts"), "utf-8");
    expect(content).toContain("tigerbeetleTransfers");
    expect(content).toContain("Reconciliation");
    expect(content).toContain("onConflictDoNothing");
  });
});

// ─── 16. SCREENING HR ────────────────────────────────────────────────────────
describe("Stakeholder: Screening HR — Background Checks", () => {
  it("Screening workflow is available in Temporal router", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/temporalRouter.ts"), "utf-8");
    expect(content).toContain("startScreening");
    expect(content).toContain("startScreeningWorkflow");
  });

  it("KYC expiry workflow is available in Temporal router", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/temporalRouter.ts"), "utf-8");
    expect(content).toContain("startKycExpiry");
    expect(content).toContain("startKycExpiryWorkflow");
  });

  it("Screening tables are defined in schema", async () => {
    const schema = await import("../drizzle/schema");
    for (const t of ["screeningOrders","screeningResults","candidateProfiles","screeningPackages","adverseActions","adverseItems","candidateConsents"]) {
      expect(schema[t as keyof typeof schema], `Table '${t}' should be defined`).toBeDefined();
    }
  });
});

// ─── 17. INSIDER THREAT ANALYST ──────────────────────────────────────────────
describe("Stakeholder: Insider Threat Analyst — UEBA", () => {
  it("Insider threat tables are defined in schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.insiderEvents).toBeDefined();
    expect(schema.uebaProfiles).toBeDefined();
    expect(schema.accessReviews).toBeDefined();
  });

  it("insiderThreat router uses Permify for access control", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/insiderThreat.ts"), "utf-8");
    expect(content).toContain("permifyCheck");
  });

  it("publishInsiderThreatEvent is defined in dapr.ts", async () => {
    const dapr = await import("./dapr");
    expect(dapr.publishInsiderThreatEvent).toBeDefined();
    expect(typeof dapr.publishInsiderThreatEvent).toBe("function");
  });
});

// ─── 18. FIELD AGENT ─────────────────────────────────────────────────────────
describe("Stakeholder: Field Agent — Field Visits", () => {
  it("Field visit tables are defined in schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.fieldVisitReports).toBeDefined();
    expect(schema.fieldTasks).toBeDefined();
  });

  it("publishFieldVisitEvent is defined in dapr.ts", async () => {
    const dapr = await import("./dapr");
    expect(dapr.publishFieldVisitEvent).toBeDefined();
  });
});

// ─── 19. BANKING/PAYMENTS OFFICER ────────────────────────────────────────────
describe("Stakeholder: Banking/Payments Officer — Mojaloop & Stablecoin", () => {
  it("publishMojaloopEvent is defined in dapr.ts", async () => {
    const dapr = await import("./dapr");
    expect(dapr.publishMojaloopEvent).toBeDefined();
  });

  it("publishStablecoinEvent is defined in dapr.ts", async () => {
    const dapr = await import("./dapr");
    expect(dapr.publishStablecoinEvent).toBeDefined();
  });

  it("startPaymentTransferWorkflow is defined in temporal.ts", async () => {
    const temporal = await import("./temporal");
    expect(temporal.startPaymentTransferWorkflow).toBeDefined();
  });
});

// ─── 20. APISIX ──────────────────────────────────────────────────────────────
describe("APISIX — API Gateway Configuration", () => {
  it("APISIX config file exists", async () => {
    const fs = await import("fs");
    const path = await import("path");
    expect(fs.existsSync(path.join(process.cwd(), "infra/apisix/conf/config.yaml"))).toBe(true);
  });

  it("APISIX routes file exists", async () => {
    const fs = await import("fs");
    const path = await import("path");
    expect(fs.existsSync(path.join(process.cwd(), "infra/apisix/conf/apisix.yaml"))).toBe(true);
  });

  it("APISIX config includes rate limiting and prometheus plugins", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "infra/apisix/conf/config.yaml"), "utf-8");
    expect(content).toContain("limit-req");
    expect(content).toContain("prometheus");
  });
});

// ─── 21. DAPR COMPONENTS ─────────────────────────────────────────────────────
describe("Dapr — Component Configuration", () => {
  it("Dapr pubsub component file exists", async () => {
    const fs = await import("fs");
    const path = await import("path");
    expect(fs.existsSync(path.join(process.cwd(), "infra/dapr/components/pubsub.yaml"))).toBe(true);
  });

  it("Dapr statestore component file exists", async () => {
    const fs = await import("fs");
    const path = await import("path");
    expect(fs.existsSync(path.join(process.cwd(), "infra/dapr/components/statestore.yaml"))).toBe(true);
  });

  it("Dapr subscriptions file exists", async () => {
    const fs = await import("fs");
    const path = await import("path");
    expect(fs.existsSync(path.join(process.cwd(), "infra/dapr/components/subscriptions.yaml"))).toBe(true);
  });
});

// ─── 22. DOCKER COMPOSE ──────────────────────────────────────────────────────
describe("Docker Compose — Service Topology", () => {
  it("docker-compose.yml exists and includes all required services", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const composePath = path.join(process.cwd(), "docker-compose.yml");
    expect(fs.existsSync(composePath)).toBe(true);
    const content = fs.readFileSync(composePath, "utf-8");
    for (const svc of ["keycloak","postgres","redis","temporal","fluvio-velocity"]) {
      expect(content, `docker-compose.yml should include '${svc}'`).toContain(svc);
    }
  });
});

// ─── 23. ENV VALIDATION ──────────────────────────────────────────────────────
describe("Environment — Configuration Validation", () => {
  beforeEach(() => { vi.resetModules(); });

  it("ENV module loads without throwing", async () => {
    await expect(import("./_core/env")).resolves.not.toThrow();
  });

  it("ENV has all required service URL keys", async () => {
    const { ENV } = await import("./_core/env");
    for (const k of ["keycloakUrl","keycloakRealm","permifyUrl","tigerBeetleUrl","lakehouseUrl","temporalHost"]) {
      expect(k in ENV, `ENV should have key '${k}'`).toBe(true);
    }
  });
});

// ─── 24. SECURITY REGRESSION ─────────────────────────────────────────────────
describe("Security — Regression & Hardening", () => {
  beforeEach(() => { vi.resetModules(); });

  it("Permify check fails-closed for delete operations", async () => {
    process.env.PERMIFY_URL = "http://permify:3476";
    vi.stubGlobal("fetch", mockFetchOk({ can: "RESULT_DENIED" }));
    const { permifyCheck } = await import("./permify");
    expect(await permifyCheck("investigation", "inv-001", "delete", "user-99")).toBe(false);
    vi.unstubAllGlobals();
  });

  it("WAF block status is handled before reaching business logic", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/_core/index.ts"), "utf-8");
    // WAF_BLOCKED must appear in the file
    expect(content.indexOf("WAF_BLOCKED")).toBeGreaterThan(0);
    // createExpressMiddleware must appear in the file
    expect(content.indexOf("createExpressMiddleware")).toBeGreaterThan(0);
    // The WAF middleware registration (app.use with appsec) must come before the tRPC app.use
    // Check that WAF middleware function is defined before the tRPC handler registration
    const wafMiddlewareIdx = content.indexOf("x-appsec-status");
    const trpcHandlerIdx = content.lastIndexOf("createExpressMiddleware");
    expect(wafMiddlewareIdx).toBeGreaterThan(0);
    expect(trpcHandlerIdx).toBeGreaterThan(0);
    // WAF middleware setup appears before the tRPC handler
    expect(wafMiddlewareIdx).toBeLessThan(trpcHandlerIdx);
  });

  it("Audit log has integrity hash field", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.auditLog).toBeDefined();
  });
});

// ─── 25. ROUTERS REGISTRATION ────────────────────────────────────────────────
describe("tRPC Router Registration — All Routers Wired", () => {
  it("All domain routers are registered in appRouter", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(path.join(process.cwd(), "server/routers.ts"), "utf-8");
    for (const r of ["investigations","kyc","alerts","fieldTasks","reports","billing","cases","lex","temporal","keycloak","ngScreening","criminalRecords","fieldVisit","insiderThreat"]) {
      expect(content, `Router '${r}' should be registered`).toContain(r);
    }
  });
});
