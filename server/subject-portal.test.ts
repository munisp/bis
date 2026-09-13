/**
 * server/subject-portal.test.ts
 *
 * WP3 subject portal tests. Uses the repo's established pool-mock precedent
 * (see consumerDisputeDeadlineEscalation.test.ts): a stateful in-memory SQL
 * dispatch so token lifecycle, consent gating, dispute wiring, tenant
 * isolation, and minimal disclosure are exercised against real router logic.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const release = vi.fn();
const connect = vi.fn(async () => ({ query, release }));

// Drizzle handle fake: computeDataCompleteness selects by table identity.
const drizzleRows = new Map<unknown, Record<string, unknown>[]>();
const drizzleInsert = vi.fn(async () => []);
const fakeDrizzle = {
  select: (_fields?: unknown) => ({
    from: (table: unknown) => {
      const result = drizzleRows.get(table) ?? [];
      const chain: any = {
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(result).then(res, rej),
      };
      return chain;
    },
  }),
  insert: (_table: unknown) => ({ values: (_vals: unknown) => drizzleInsert() }),
};

vi.mock("./db", () => ({
  getPgPool: vi.fn(async () => ({ connect })),
  getDb: vi.fn(async () => fakeDrizzle),
}));
vi.mock("./permify", () => ({ permifyCheck: vi.fn(async () => true) }));
vi.mock("./_core/env", () => ({
  ENV: {
    isProduction: false,
    auditHmacSecret: "test-audit-hmac-key",
    eventProcessorUrl: "http://localhost:8083",
    bisGatewayKey: "test-gateway-key",
  },
}));
vi.mock("./piiKeyRegistry", () => ({
  activeTenantEncryptionRegistry: vi.fn(async () => ({
    id: 1, tenantId: 7, keyVersion: "kv1", externalKeyRef: "transit/keys/bis-t7",
    provider: "vault_transit", providerKeyName: "bis-t7", providerKeyVersion: 3, status: "active",
  })),
}));
vi.mock("./piiEnvelopeCrypto", () => ({
  piiAad: vi.fn(() => "bis-pii-envelope:v2|7|candidate_profile|41|subject-dispute:test"),
  encryptPiiEnvelope: vi.fn(async () => ({
    ciphertext: Buffer.from("vault:v3:dGVzdC1jaXBoZXJ0ZXh0", "utf8"),
    nonce: null,
    keyVersion: "kv1",
    providerKeyVersion: 3,
    plaintextSha256: "0".repeat(64),
    cryptoProvider: "vault_transit",
  })),
}));

const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
vi.stubGlobal("fetch", fetchMock);

import { subjectPortalRouter } from "./subjectPortal";
import { fieldVisitReports, investigations, kycRecords, screeningOrders, screeningResults } from "../drizzle/schema";

// ─── Stateful in-memory "PostgreSQL" ─────────────────────────────────────────

const TENANT = 7;
const OTHER_TENANT = 8;

type Store = {
  tokens: any[];
  disputes: any[];
  cases: any[];
  caseEvents: any[];
  candidates: any[];
  consents: any[];
  investigations: any[];
  references: any[];
  nextCandidateId: number;
};
let store: Store;

function resetStore() {
  store = {
    tokens: [], disputes: [], cases: [], caseEvents: [],
    candidates: [], consents: [], investigations: [], references: [],
    nextCandidateId: 41,
  };
}

function installSqlBehavior() {
  query.mockImplementation(async (stmt: string, params: any[] = []) => {
    if (stmt === "BEGIN" || stmt === "COMMIT" || stmt === "ROLLBACK") return { rows: [], rowCount: 0 };

    if (stmt.includes("FROM tenants")) {
      return params[0] === TENANT || params[0] === OTHER_TENANT
        ? { rows: [{ id: params[0] }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (stmt.includes("SELECT id FROM candidate_profiles")) {
      const found = store.candidates.find(c => c.tenantId === params[0] && (c.nin === params[1] || c.bvn === params[1]));
      return { rows: found ? [{ id: found.id }] : [], rowCount: found ? 1 : 0 };
    }
    if (stmt.includes("INSERT INTO candidate_profiles")) {
      const row = { id: store.nextCandidateId++, tenantId: params[1], nin: params[6], bvn: params[7] };
      store.candidates.push(row);
      return { rows: [{ id: row.id }], rowCount: 1 };
    }
    if (stmt.includes("INSERT INTO candidate_consents")) {
      store.consents.push({ consentRef: params[0], candidateId: params[1], purpose: "consumer_self_check", consentText: params[2], signedAt: new Date(), revokedAt: null });
      return { rows: [], rowCount: 1 };
    }
    if (stmt.includes("INSERT INTO investigations")) {
      store.investigations.push({ ref: params[0], subjectName: params[1], phone: params[2], tenantId: params[3], candidateProfileId: params[5], status: "pending", createdAt: new Date() });
      return { rows: [], rowCount: 1 };
    }
    if (stmt.includes("INSERT INTO subject_access_tokens")) {
      store.tokens.push({ id: params[0], tenant_id: params[1], candidate_id: params[2], token_hash: params[3], purpose: "self_check", expires_at: params[4], revoked_at: null });
      return { rows: [], rowCount: 1 };
    }
    if (stmt.includes("FROM subject_access_tokens")) {
      const row = store.tokens.find(t => t.token_hash === params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (stmt.includes("FROM investigations")) {
      const rows = store.investigations
        .filter(i => i.candidateProfileId === params[0] && i.tenantId === params[1])
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return { rows: rows.slice(0, 1), rowCount: rows.length > 0 ? 1 : 0 };
    }
    if (stmt.includes("FROM informal_references")) {
      const rows = store.references.filter(r => r.candidate_id === params[0] && r.tenant_id === params[1] && !r.withdrawn_at);
      return { rows, rowCount: rows.length };
    }
    if (stmt.includes("INSERT INTO subject_disputes")) {
      store.disputes.push({ id: params[0], tenant_id: params[1], candidate_id: params[2], case_id: null, statement_sha256: params[3], statement_enc: params[4], status: "received" });
      return { rows: [], rowCount: 1 };
    }
    if (stmt.includes("UPDATE subject_disputes SET case_id")) {
      const d = store.disputes.find(x => x.id === params[1]);
      if (d) d.case_id = params[0];
      return { rows: [], rowCount: d ? 1 : 0 };
    }
    if (stmt.includes("SELECT id FROM informal_verification_cases")) {
      const allowed = ["collecting", "under_review", "completed"];
      const rows = store.cases.filter(c =>
        c.tenant_id === params[0] && c.candidate_id === params[1] && allowed.includes(c.status)
        && (params.length < 3 || c.id === params[2]));
      return { rows: rows.slice(0, 1).map(c => ({ id: c.id })), rowCount: rows.length > 0 ? 1 : 0 };
    }
    if (stmt.includes("UPDATE informal_verification_cases")) {
      const c = store.cases.find(x => x.id === params[0] && x.tenant_id === params[1]
        && ["collecting", "under_review", "completed"].includes(x.status));
      if (c) c.status = "disputed";
      return { rows: [], rowCount: c ? 1 : 0 };
    }
    if (stmt.includes("INSERT INTO informal_reference_events")) {
      store.caseEvents.push({ id: params[0], case_id: params[1], tenant_id: params[2], event_type: "subject_correction_submitted", event_sha256: params[3], metadata: params[4] });
      return { rows: [], rowCount: 1 };
    }
    if (stmt.includes("UPDATE subject_disputes")) { // resolveDispute
      const d = store.disputes.find(x => x.id === params[1] && x.tenant_id === params[2] && x.status !== "resolved");
      if (d) { d.status = "resolved"; d.resolution = params[0]; }
      return { rows: d ? [{ id: d.id }] : [], rowCount: d ? 1 : 0 };
    }
    throw new Error(`Unexpected SQL: ${stmt}`);
  });
}

function ctxFor(ip: string) {
  return { req: { ip, headers: {} }, user: null, tenantId: null, isDemo: false } as any;
}
const OPERATOR_CTX = { req: { ip: "10.9.9.1", headers: {} }, user: { id: 99, role: "supervisor", email: "sup@bis.test" }, tenantId: TENANT, isDemo: false } as any;

const VALID_INTAKE = {
  tenantId: TENANT,
  fullName: "Adaeze Okonkwo",
  ninOrBvn: "12345678901",
  idType: "nin" as const,
  phone: "08031234567",
  consentText: "I, Adaeze Okonkwo, consent to BIS verifying my identity and informal references for a consumer self-check.",
};

async function issueToken(ip = "10.0.0.1") {
  const caller = subjectPortalRouter.createCaller(ctxFor(ip));
  return caller.requestSelfCheck(VALID_INTAKE);
}

beforeEach(() => {
  resetStore();
  query.mockReset();
  installSqlBehavior();
  connect.mockClear();
  drizzleInsert.mockClear();
  drizzleRows.clear();
  drizzleRows.set(investigations, [{ id: 555, ref: "", subjectType: "individual" }]);
  drizzleRows.set(screeningOrders, []);
  drizzleRows.set(screeningResults, []);
  drizzleRows.set(kycRecords, []);
  drizzleRows.set(fieldVisitReports, []);
});

describe("subjectPortal.requestSelfCheck", () => {
  it("issues a bis_sp_ token, persists ONLY its SHA-256 hash, and creates consent + investigation atomically", async () => {
    const result = await issueToken();
    expect(result.token).toMatch(/^bis_sp_[A-Za-z0-9_-]{32}$/);
    expect(result.investigationRef).toMatch(/^BIS-\d{4}-[0-9A-F]{6}$/);
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now() + 71 * 60 * 60 * 1000);

    const expectedHash = createHash("sha256").update(result.token).digest("hex");
    expect(store.tokens).toHaveLength(1);
    expect(store.tokens[0].token_hash).toBe(expectedHash);
    expect(JSON.stringify(store.tokens)).not.toContain(result.token);

    expect(store.consents).toHaveLength(1);
    expect(store.consents[0].consentText).toBe(VALID_INTAKE.consentText);
    expect(store.consents[0].signedAt).toBeTruthy();
    expect(store.consents[0].revokedAt).toBeNull();
    expect(store.investigations).toHaveLength(1);
    expect(store.investigations[0].status).toBe("pending");
    expect(store.tokens[0].candidate_id).toBe(store.investigations[0].candidateProfileId);
  });

  it("rejects when consent text is absent/too short — before touching PostgreSQL (no consent → no case)", async () => {
    const caller = subjectPortalRouter.createCaller(ctxFor("10.0.1.1"));
    await expect(caller.requestSelfCheck({ ...VALID_INTAKE, consentText: "ok" })).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
    expect(store.cases).toHaveLength(0);
    expect(store.tokens).toHaveLength(0);
  });

  it("rejects malformed NIN/BVN before touching PostgreSQL", async () => {
    const caller = subjectPortalRouter.createCaller(ctxFor("10.0.1.2"));
    await expect(caller.requestSelfCheck({ ...VALID_INTAKE, ninOrBvn: "12345" })).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects an unknown tenant", async () => {
    const caller = subjectPortalRouter.createCaller(ctxFor("10.0.1.3"));
    await expect(caller.requestSelfCheck({ ...VALID_INTAKE, tenantId: 999 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("upserts an existing candidate matched by NIN instead of duplicating", async () => {
    store.candidates.push({ id: 77, tenantId: TENANT, nin: VALID_INTAKE.ninOrBvn, bvn: null });
    await issueToken("10.0.1.4");
    expect(store.candidates).toHaveLength(1);
    expect(store.tokens[0].candidate_id).toBe(77);
  });

  it("rate-limits bursts from a single IP", async () => {
    const caller = subjectPortalRouter.createCaller(ctxFor("10.0.2.1"));
    let lastError: any;
    for (let i = 0; i < 12; i++) {
      try { await caller.requestSelfCheck(VALID_INTAKE); } catch (e) { lastError = e; }
    }
    expect(lastError).toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("subjectPortal.getMyStatus — token lifecycle + minimal disclosure", () => {
  async function seedStatusWorld() {
    const { token, investigationRef } = await issueToken("10.1.0.1");
    const candidateId = store.tokens[0].candidate_id;
    const caseId = "11111111-2222-4333-8444-555555555555";
    store.cases.push({ id: caseId, tenant_id: TENANT, candidate_id: candidateId, status: "collecting" });
    store.references.push(
      { candidate_id: candidateId, tenant_id: TENANT, provenance_status: "claimed", withdrawn_at: null, source_display_name: "Musa the landlord", contact: "08099998888" },
      { candidate_id: candidateId, tenant_id: TENANT, provenance_status: "independently_confirmed", withdrawn_at: null, source_display_name: "Cooperative chair", contact: "coop@x.ng" },
      { candidate_id: candidateId, tenant_id: TENANT, provenance_status: "contradicted", withdrawn_at: new Date(), source_display_name: "Withdrawn ref" },
    );
    drizzleRows.set(investigations, [{ id: 555, ref: investigationRef, subjectType: "individual" }]);
    return { token, investigationRef, candidateId, caseId };
  }

  it("returns status + completeness + provenance labels for a valid token", async () => {
    const { token, investigationRef } = await seedStatusWorld();
    const caller = subjectPortalRouter.createCaller(ctxFor("10.1.0.2"));
    const status = await caller.getMyStatus({ token });
    expect(status.investigationRef).toBe(investigationRef);
    expect(status.investigationStatus).toBe("pending");
    expect(status.thinFile).toBe(true); // no screening/KYC/field data yet
    expect(status.dataCompleteness.score).toBe(0);
    expect(status.referenceProvenance).toEqual(["claimed", "independently_confirmed"]); // withdrawn excluded
  });

  it("never discloses PII or referee identity/contact (minimal-disclosure assertion)", async () => {
    const { token } = await seedStatusWorld();
    const caller = subjectPortalRouter.createCaller(ctxFor("10.1.0.3"));
    const serialized = JSON.stringify(await caller.getMyStatus({ token }));
    const forbidden = [
      "source_display_name", "sourceDisplayName", "contact", "Musa", "Cooperative chair",
      "nin", "bvn", "phone", "email", "fullName", "subjectName", "statement",
      "08099998888", "08031234567", "12345678901", "Adaeze",
    ];
    for (const key of forbidden) expect(serialized).not.toContain(key);
  });

  it("rejects an expired token (fail closed)", async () => {
    const { token } = await seedStatusWorld();
    store.tokens[0].expires_at = new Date(Date.now() - 1000);
    const caller = subjectPortalRouter.createCaller(ctxFor("10.1.0.4"));
    await expect(caller.getMyStatus({ token })).rejects.toMatchObject({ code: "UNAUTHORIZED", message: expect.stringContaining("expired") });
  });

  it("rejects a revoked token (fail closed)", async () => {
    const { token } = await seedStatusWorld();
    store.tokens[0].revoked_at = new Date();
    const caller = subjectPortalRouter.createCaller(ctxFor("10.1.0.5"));
    await expect(caller.getMyStatus({ token })).rejects.toMatchObject({ code: "UNAUTHORIZED", message: expect.stringContaining("revoked") });
  });

  it("rejects unknown and malformed tokens (fail closed)", async () => {
    await seedStatusWorld();
    const caller = subjectPortalRouter.createCaller(ctxFor("10.1.0.6"));
    await expect(caller.getMyStatus({ token: "bis_sp_forged" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.getMyStatus({ token: "bearer-whatever" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("subjectPortal.submitDispute — informal-verification wiring", () => {
  it("encrypts the statement, stores only the envelope, and transitions the candidate's case to 'disputed'", async () => {
    const { token } = await issueToken("10.2.0.1");
    const candidateId = store.tokens[0].candidate_id;
    const caseId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    store.cases.push({ id: caseId, tenant_id: TENANT, candidate_id: candidateId, status: "under_review" });

    const caller = subjectPortalRouter.createCaller(ctxFor("10.2.0.2"));
    const statement = "The landlord reference overstates my tenancy period by two years.";
    const result = await caller.submitDispute({ token, statement });
    expect(result).toEqual({ disputeId: expect.any(String), status: "received", caseDisputed: true });

    const dispute = store.disputes[0];
    expect(dispute.case_id).toBe(caseId);
    expect(dispute.statement_sha256).toBe(createHash("sha256").update(statement).digest("hex"));
    expect(dispute.statement_enc).toContain("vault:v3:");
    expect(JSON.stringify(store.disputes)).not.toContain(statement);

    expect(store.cases[0].status).toBe("disputed");
    expect(store.caseEvents).toHaveLength(1);
    expect(store.caseEvents[0].event_type).toBe("subject_correction_submitted");
    expect(store.caseEvents[0].event_sha256).toMatch(/^[0-9a-f]{64}$/);

    expect(drizzleInsert).toHaveBeenCalled(); // audit log write
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/events"),
      expect.objectContaining({ body: expect.stringContaining("SUBJECT_DISPUTE_SUBMITTED") }),
    );
  });

  it("still records the dispute when no informal case exists (no spurious case creation)", async () => {
    const { token } = await issueToken("10.2.1.1");
    const caller = subjectPortalRouter.createCaller(ctxFor("10.2.1.2"));
    const result = await caller.submitDispute({ token, statement: "My NIN trace shows an address I never lived at." });
    expect(result.caseDisputed).toBe(false);
    expect(store.disputes).toHaveLength(1);
    expect(store.cases).toHaveLength(0);
  });

  it("never transitions a case belonging to another tenant (wrong-tenant rejection)", async () => {
    const { token } = await issueToken("10.2.2.1");
    const otherCase = "cccccccc-dddd-4eee-8fff-000000000000";
    store.cases.push({ id: otherCase, tenant_id: OTHER_TENANT, candidate_id: store.tokens[0].candidate_id, status: "collecting" });
    const caller = subjectPortalRouter.createCaller(ctxFor("10.2.2.2"));
    const result = await caller.submitDispute({ token, caseId: otherCase, statement: "This report confuses me with another person entirely." });
    expect(result.caseDisputed).toBe(false);
    expect(store.cases[0].status).toBe("collecting"); // untouched
    expect(store.disputes[0].case_id).toBeNull();
  });

  it("rejects a purpose-mismatched token usage pattern via expiry/revocation of the same hash store", async () => {
    const { token } = await issueToken("10.2.3.1");
    store.tokens[0].purpose = "status"; // a status-only token may not dispute
    const caller = subjectPortalRouter.createCaller(ctxFor("10.2.3.2"));
    await expect(caller.submitDispute({ token, statement: "Attempting dispute with a status-only token." }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(store.disputes).toHaveLength(0);
  });
});

describe("subjectPortal.resolveDispute — operator resolution", () => {
  async function seedDispute() {
    const { token } = await issueToken("10.3.0.1");
    const caller = subjectPortalRouter.createCaller(ctxFor("10.3.0.2"));
    const { disputeId } = await caller.submitDispute({ token, statement: "The adverse-media hit is a namesake, not me." });
    return disputeId;
  }

  it("resolves a dispute under the operator tenant with audit + event", async () => {
    const disputeId = await seedDispute();
    const caller = subjectPortalRouter.createCaller(OPERATOR_CTX);
    await expect(caller.resolveDispute({ disputeId, resolution: "Reinvestigated with source; adverse item removed." }))
      .resolves.toEqual({ disputeId, status: "resolved" });
    expect(store.disputes[0].status).toBe("resolved");
    expect(store.disputes[0].resolution).toContain("Reinvestigated");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/events"),
      expect.objectContaining({ body: expect.stringContaining("SUBJECT_DISPUTE_RESOLVED") }),
    );
  });

  it("rejects operators from another tenant (tenant-scoped, fail closed)", async () => {
    const disputeId = await seedDispute();
    const caller = subjectPortalRouter.createCaller({ ...OPERATOR_CTX, tenantId: OTHER_TENANT });
    await expect(caller.resolveDispute({ disputeId, resolution: "Attempting cross-tenant resolution here." }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(store.disputes[0].status).toBe("received");
  });

  it("denies analyst accounts the resolution control", async () => {
    const disputeId = await seedDispute();
    const caller = subjectPortalRouter.createCaller({ ...OPERATOR_CTX, user: { id: 41, role: "analyst" } });
    await expect(caller.resolveDispute({ disputeId, resolution: "Analysts must not resolve subject disputes." }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is idempotent against double resolution", async () => {
    const disputeId = await seedDispute();
    const caller = subjectPortalRouter.createCaller(OPERATOR_CTX);
    await caller.resolveDispute({ disputeId, resolution: "First resolution, properly investigated." });
    await expect(caller.resolveDispute({ disputeId, resolution: "Second resolution attempt should fail." }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });
});
