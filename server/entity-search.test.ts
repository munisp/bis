// entity-search.test.ts
// Tests for WP1 unified one-box entity search + related-persons graph:
//   - query-type detection matrix
//   - per-source failure isolation (one failing source must not sink the rest)
//   - tenant isolation (every query scoped to ctx.tenantId; no tenant → fail closed)
//   - confidence classification (direct_documented=high / declared=medium / shared_attribute=low)

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getPgPool: vi.fn() }));

import { getPgPool } from "./db";
import {
  entitySearchRouter,
  detectQueryType,
  normalizeRcNumber,
  phoneVariants,
  confidenceForEvidenceKind,
  evidenceKindForReferenceType,
  extractBeneficialOwners,
} from "./entitySearch";
import type { TrpcContext } from "./_core/context";

// ─── Test fixtures ────────────────────────────────────────────────────────────

const TENANT = 42;

function tenantContext(tenantId: number | null = TENANT): TrpcContext {
  return {
    user: {
      id: 21, openId: "entity-search-user", email: "analyst@example.test", name: "Search Analyst",
      loginMethod: "keycloak", role: "analyst", tenantId, pushToken: null,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    tenantId, isDemo: false, authMethod: "keycloak",
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function anonymousContext(): TrpcContext {
  return {
    user: null, tenantId: null, isDemo: false, authMethod: "keycloak",
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

type QueryHandler = (text: string, params: unknown[]) => { rows: unknown[]; rowCount?: number };

interface CapturedQuery { text: string; params: unknown[] }

function makePool(handler: QueryHandler) {
  const queries: CapturedQuery[] = [];
  const query = vi.fn(async (text: string, params: unknown[] = []) => {
    queries.push({ text, params });
    return handler(text, params);
  });
  return { pool: { query }, queries };
}

const emptyHandler: QueryHandler = () => ({ rows: [] });

function mockPool(pool: unknown) {
  vi.mocked(getPgPool).mockResolvedValue(pool as never);
}

// ─── Query-type detection matrix ─────────────────────────────────────────────

describe("Entity Search: detectQueryType", () => {
  it.each([
    ["12345678901", "nin_bvn"],           // 11 digits → dual NIN/BVN
    ["98765432109", "nin_bvn"],
    [" 12345678901 ", "nin_bvn"],         // whitespace tolerated
    ["08031234567", "phone"],             // 11 digits starting 0 → NG local mobile
    ["+2348031234567", "phone"],          // international format
    ["2348031234567", "phone"],
    ["0803 123 4567", "phone"],           // separators stripped
    ["RC123456", "cac"],                  // RC prefix → CAC
    ["rc7654321", "cac"],                 // case-insensitive
    ["RC-123456", "cac"],
    ["RC 123456", "cac"],
    ["John Doe", "name"],
    ["adewale ogunleye", "name"],
    ["O'Connor", "name"],
  ])("classifies %j as %s", (input, expected) => {
    expect(detectQueryType(input)).toBe(expected);
  });
});

describe("Entity Search: input normalization", () => {
  it("normalizes RC variants to a canonical RC number", () => {
    expect(normalizeRcNumber("rc 123456")).toBe("RC123456");
    expect(normalizeRcNumber("RC-7654321")).toBe("RC7654321");
  });

  it("generates Nigerian phone variants so 0…/234…/+234… all match", () => {
    expect(phoneVariants("08031234567")).toEqual(expect.arrayContaining(["08031234567", "+2348031234567", "2348031234567"]));
    expect(phoneVariants("+2348031234567")).toEqual(expect.arrayContaining(["+2348031234567", "08031234567"]));
  });
});

// ─── Confidence classification ───────────────────────────────────────────────

describe("Entity Search: confidence classification", () => {
  it("maps evidence kinds to confidence levels", () => {
    expect(confidenceForEvidenceKind("direct_documented")).toBe("high");
    expect(confidenceForEvidenceKind("declared")).toBe("medium");
    expect(confidenceForEvidenceKind("shared_attribute")).toBe("low");
  });

  it("treats a signed guarantor as direct_documented (high)", () => {
    expect(confidenceForEvidenceKind(evidenceKindForReferenceType("guarantor"))).toBe("high");
  });

  it("treats self-nominated referees and other references as declared (medium)", () => {
    for (const t of ["self_nominated_referee", "landlord", "trade_association", "cooperative", "neighbour", "field_observation"]) {
      expect(confidenceForEvidenceKind(evidenceKindForReferenceType(t))).toBe("medium");
    }
  });
});

describe("Entity Search: extractBeneficialOwners", () => {
  it("extracts owners/directors/shareholders from CAC payloads", () => {
    const owners = extractBeneficialOwners({
      data: {
        beneficial_owners: [{ name: "Aisha Bello", shareholding: "60%" }],
        directors: [{ fullName: "Tunde Adeyemi" }, "Aisha Bello"],
      },
    });
    expect(owners).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Aisha Bello", role: "beneficial_owner", shareholding: "60%" }),
      expect.objectContaining({ name: "Tunde Adeyemi", role: "director" }),
      expect.objectContaining({ name: "Aisha Bello", role: "director" }),
    ]));
  });

  it("returns an empty list for empty or malformed payloads", () => {
    expect(extractBeneficialOwners(null)).toEqual([]);
    expect(extractBeneficialOwners({ error: "HTTP 502" })).toEqual([]);
    expect(extractBeneficialOwners({ directors: [{}] })).toEqual([]);
  });
});

// ─── Router-level: search fan-out, failure isolation, tenant scope ────────────

describe("Entity Search: search procedure", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fans a name query across investigations, kyc_records and candidate_profiles with per-source status", async () => {
    const { pool, queries } = makePool((text) => {
      if (text.includes("FROM investigations")) return { rows: [{ id: 1, ref: "INV-1", subjectName: "John Doe" }] };
      if (text.includes("FROM kyc_records")) return { rows: [{ id: 7, subjectName: "John Doe", subjectRef: "KYC-7" }] };
      return { rows: [] };
    });
    mockPool(pool);

    const result = await entitySearchRouter.createCaller(tenantContext()).search({ query: "John Doe" });

    expect(result.queryType).toBe("name");
    expect(result.investigations).toHaveLength(1);
    expect(result.kyc).toHaveLength(1);
    expect(result.sources.map((s) => s.source).sort()).toEqual(["candidate_profiles", "investigations", "kyc_records"]);
    expect(result.sources.every((s) => s.status === "ok" && s.latencyMs >= 0)).toBe(true);

    // Tenant scope: every data query filtered by the ctx tenant, never client input
    const dataQueries = queries.filter((q) => !q.text.includes("INSERT INTO audit_log"));
    expect(dataQueries.length).toBeGreaterThan(0);
    for (const q of dataQueries) {
      expect(q.text).toContain('"tenantId" = $1');
      expect(q.params[0]).toBe(TENANT);
    }

    // Every search is audit-logged (who searched what), tenant-scoped
    const audit = queries.find((q) => q.text.includes("INSERT INTO audit_log"));
    expect(audit).toBeDefined();
    expect(audit!.params[0]).toBe(TENANT);
    expect(audit!.params[1]).toBe(21);
    expect(audit!.params[3]).toBe("Entity search performed");
    expect(JSON.parse(audit!.params[6] as string)).toMatchObject({ query: "John Doe", queryType: "name" });
  });

  it("runs a dual NIN+BVN gateway lookup for 11-digit queries and isolates a gateway outage", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("gateway unreachable"); });
    vi.stubGlobal("fetch", fetchMock);
    const { pool } = makePool((text) => {
      if (text.includes("FROM kyc_records")) return { rows: [{ id: 3, nin: "12345678901", subjectName: "Ada Lovelace" }] };
      return { rows: [] };
    });
    mockPool(pool);

    const result = await entitySearchRouter.createCaller(tenantContext()).search({ query: "12345678901" });

    expect(result.queryType).toBe("nin_bvn");
    // Gateway failed for BOTH lookups — but DB sources still returned
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bySource = Object.fromEntries(result.sources.map((s) => [s.source, s]));
    expect(bySource.gateway_nin.status).toBe("error");
    expect(bySource.gateway_bvn.status).toBe("error");
    expect(bySource.gateway_nin.error).toContain("gateway unreachable");
    expect(bySource.investigations.status).toBe("ok");
    expect(bySource.kyc_records.status).toBe("ok");
    expect(bySource.candidate_profiles.status).toBe("ok");
    // The failing sources did not sink the search
    expect(result.kyc).toHaveLength(1);
  });

  it("records successful gateway identities when the gateway responds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ found: true, firstName: "Ada" }),
    })));
    const { pool } = makePool(emptyHandler);
    mockPool(pool);

    const result = await entitySearchRouter.createCaller(tenantContext()).search({ query: "12345678901" });

    expect(result.sources.every((s) => s.status === "ok")).toBe(true);
    expect(result.identities).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "nin", reference: "12345678901" }),
      expect.objectContaining({ type: "bvn", reference: "12345678901" }),
    ]));
  });

  it("routes RC queries to the CAC gateway and corporate profiles", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ companyName: "ACME LTD" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const { pool, queries } = makePool((text) => {
      if (text.includes("FROM corporate_screening_profiles")) {
        return { rows: [{ id: 9, profileRef: "CSP-9", companyName: "ACME LTD", rcNumber: "RC123456" }] };
      }
      return { rows: [] };
    });
    mockPool(pool);

    const result = await entitySearchRouter.createCaller(tenantContext()).search({ query: "rc 123456" });

    expect(result.queryType).toBe("cac");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/v1/cac/RC123456"), expect.anything());
    expect(result.identities).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "cac", reference: "RC123456" }),
      expect.objectContaining({ type: "corporate_profile", reference: "CSP-9" }),
    ]));
    const profileQuery = queries.find((q) => q.text.includes("corporate_screening_profiles"));
    expect(profileQuery!.params).toEqual([TENANT, "RC123456"]);
  });

  it("matches phone queries against all Nigerian variants", async () => {
    const { pool, queries } = makePool(emptyHandler);
    mockPool(pool);

    const result = await entitySearchRouter.createCaller(tenantContext()).search({ query: "08031234567" });

    expect(result.queryType).toBe("phone");
    const phoneQuery = queries.find((q) => q.text.includes("FROM kyc_records"));
    expect(phoneQuery!.params[0]).toBe(TENANT);
    expect(phoneQuery!.params[1]).toEqual(expect.arrayContaining(["08031234567", "+2348031234567", "2348031234567"]));
  });

  it("fails closed when the tenant context is missing", async () => {
    const { pool } = makePool(emptyHandler);
    mockPool(pool);
    await expect(entitySearchRouter.createCaller(tenantContext(null)).search({ query: "John Doe" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects anonymous callers", async () => {
    const { pool } = makePool(emptyHandler);
    mockPool(pool);
    await expect(entitySearchRouter.createCaller(anonymousContext()).search({ query: "John Doe" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ─── Router-level: related-persons graph ─────────────────────────────────────

describe("Entity Search: getAssociates", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const investigationRow = {
    id: 100, ref: "INV-2026-ABC123", subjectName: "John Doe", phone: "08031234567",
    address: "12 Marina Road, Lagos", nin: "12345678901", bvn: null, candidateProfileId: 55,
  };
  const candidateRow = {
    id: 55, candidateRef: "CAND-55", firstName: "John", lastName: "Doe",
    phone: "08031234567", currentAddress: "12 Marina Road, Lagos", nin: "12345678901", bvn: null,
  };

  function associatesPool() {
    return makePool((text, params) => {
      if (text.includes("FROM investigations WHERE ref =")) return { rows: [investigationRow] };
      if (text.includes("FROM candidate_profiles WHERE id =")) return { rows: [candidateRow] };
      if (text.includes("FROM corporate_screening_profiles")) return { rows: [{
        profileRef: "CSP-1", companyName: "DOE VENTURES LTD",
        directorsResult: { data: { beneficial_owners: [{ name: "Jane Owner", shareholding: "70%" }] } },
        cacResult: { directors: ["James Director"] },
      }] };
      if (text.includes("FROM informal_references")) return { rows: [
        { id: "ref-guarantor-1", source_type: "guarantor", source_display_name: "Gambi Musa", relationship_to_subject: "Signed guarantor", provenance_status: "independently_confirmed" },
        { id: "ref-referee-2", source_type: "self_nominated_referee", source_display_name: "Ngozi Eze", relationship_to_subject: "Former colleague", provenance_status: "claimed" },
      ] };
      if (text.includes("FROM kyc_records")) return { rows: [
        { id: 88, subjectName: "Shared Phone Person", subjectRef: "KYC-88", phone: "+2348031234567" },
      ] };
      if (text.includes("FROM investigations")) return { rows: [
        { id: 101, ref: "INV-2026-XYZ999", subjectName: "Same Address Subject", phone: null, address: "12 Marina Road, Lagos" },
      ] };
      return { rows: [] };
    });
  }

  it("assembles a provenance-labelled graph with high/medium/low confidence edges", async () => {
    const { pool } = associatesPool();
    mockPool(pool);

    const result = await entitySearchRouter.createCaller(tenantContext()).getAssociates({ investigationRef: "INV-2026-ABC123" });

    // Subject node present
    const subject = result.nodes.find((n) => n.type === "subject");
    expect(subject).toBeDefined();
    expect(subject!.name).toBe("John Doe");

    const edgeByTarget = (name: string) => {
      const node = result.nodes.find((n) => n.name === name);
      expect(node, `node ${name}`).toBeDefined();
      return result.edges.find((e) => e.from === node!.id);
    };

    // direct_documented → high: beneficial owner, CAC director, signed guarantor
    expect(edgeByTarget("Jane Owner")).toMatchObject({ confidence: "high", relationship: "beneficial_owner_of_subject_entity", evidenceRef: "CSP-1" });
    expect(edgeByTarget("James Director")).toMatchObject({ confidence: "high", relationship: "director_of_subject_entity" });
    expect(edgeByTarget("Gambi Musa")).toMatchObject({ confidence: "high", evidenceRef: "ref-guarantor-1" });
    // declared → medium: self-nominated referee
    expect(edgeByTarget("Ngozi Eze")).toMatchObject({ confidence: "medium", evidenceRef: "ref-referee-2" });
    // shared_attribute → low: same phone, same address
    expect(edgeByTarget("Shared Phone Person")).toMatchObject({ confidence: "low", relationship: "shared_phone", evidenceRef: "KYC-88" });
    expect(edgeByTarget("Same Address Subject")).toMatchObject({ confidence: "low", relationship: "shared_address", evidenceRef: "INV-2026-XYZ999" });
  });

  it("scopes every association query to the caller's tenant", async () => {
    const { pool, queries } = associatesPool();
    mockPool(pool);

    await entitySearchRouter.createCaller(tenantContext()).getAssociates({ investigationRef: "INV-2026-ABC123" });

    const dataQueries = queries.filter((q) => !q.text.includes("INSERT INTO audit_log"));
    expect(dataQueries.length).toBeGreaterThan(0);
    for (const q of dataQueries) {
      expect(q.params[0] === TENANT || q.params[1] === TENANT).toBe(true);
    }
    for (const q of dataQueries) {
      expect(q.text.toLowerCase()).toContain("tenant");
    }
  });

  it("resolves the subject from a candidateId alone", async () => {
    const { pool } = makePool((text) => {
      if (text.includes("FROM candidate_profiles WHERE id =")) return { rows: [candidateRow] };
      if (text.includes("FROM informal_references")) return { rows: [
        { id: "ref-9", source_type: "landlord", source_display_name: "Chief Landlord", relationship_to_subject: "Landlord (3 yrs)", provenance_status: "attested" },
      ] };
      return { rows: [] };
    });
    mockPool(pool);

    const result = await entitySearchRouter.createCaller(tenantContext()).getAssociates({ candidateId: 55 });

    const landlord = result.nodes.find((n) => n.name === "Chief Landlord");
    expect(landlord).toBeDefined();
    expect(result.edges.find((e) => e.from === landlord!.id)).toMatchObject({ confidence: "medium" });
  });

  it("returns NOT_FOUND for another tenant's investigation", async () => {
    const { pool } = makePool(emptyHandler); // tenant filter applied in SQL → no rows
    mockPool(pool);
    await expect(entitySearchRouter.createCaller(tenantContext()).getAssociates({ investigationRef: "INV-OTHER-TENANT" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("fails closed without a tenant context", async () => {
    const { pool } = makePool(emptyHandler);
    mockPool(pool);
    await expect(entitySearchRouter.createCaller(tenantContext(null)).getAssociates({ candidateId: 55 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires an investigationRef or candidateId", async () => {
    const { pool } = makePool(emptyHandler);
    mockPool(pool);
    await expect(entitySearchRouter.createCaller(tenantContext()).getAssociates({}))
      .rejects.toThrow();
  });
});

// ─── Router-level: search history ────────────────────────────────────────────

describe("Entity Search: searchHistory", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the tenant's audit-logged searches with a next cursor when the page is full", async () => {
    const rows = [
      { id: 102, userId: 21, action: "Entity search performed", detail: { query: "John Doe" }, createdAt: new Date() },
      { id: 101, userId: 21, action: "Entity search performed", detail: { query: "RC123456" }, createdAt: new Date() },
    ];
    const { pool, queries } = makePool((text) => text.includes("FROM audit_log") ? { rows } : { rows: [] });
    mockPool(pool);

    const result = await entitySearchRouter.createCaller(tenantContext()).searchHistory({ limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe(101);
    const historyQuery = queries.find((q) => q.text.includes("FROM audit_log"));
    expect(historyQuery!.params[0]).toBe(TENANT); // tenant-scoped
    expect(historyQuery!.text).toContain("category = 'api'");
  });

  it("returns null cursor on the last page and honours the cursor filter", async () => {
    const { pool, queries } = makePool((text) => text.includes("FROM audit_log") ? { rows: [{ id: 50 }] } : { rows: [] });
    mockPool(pool);

    const result = await entitySearchRouter.createCaller(tenantContext()).searchHistory({ limit: 20, cursor: 101 });

    expect(result.nextCursor).toBeNull();
    const historyQuery = queries.find((q) => q.text.includes("FROM audit_log"));
    expect(historyQuery!.params[1]).toBe(101);
  });

  it("fails closed without a tenant context", async () => {
    const { pool } = makePool(emptyHandler);
    mockPool(pool);
    await expect(entitySearchRouter.createCaller(tenantContext(null)).searchHistory({ limit: 20 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
