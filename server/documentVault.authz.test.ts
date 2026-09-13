/**
 * Document Vault — authorization regression tests.
 *
 * - list must scope documents to the caller's tenant (via the parent case).
 * - get must verify the document's case belongs to the caller's tenant.
 * - upload must require an explicit caseId that belongs to the caller's
 *   tenant — it must never silently attach to "the first available case".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { createFakeDb, type FakeDb } from "./test-utils/fakeDb";
import { hasColumnCondition, hasEqCondition } from "./test-utils/conditionScan";

const dbHolder = vi.hoisted(() => ({ current: null as unknown as FakeDb }));

vi.mock("./db", () => ({
  getDb: vi.fn(async () => dbHolder.current),
}));
vi.mock("./storage", () => ({
  storagePut: vi.fn(async (fileKey: string) => ({ url: `https://s3.example/${fileKey}`, key: fileKey })),
}));

import { documentVaultRouter } from "./documentVault";

const CASE_T7 = { id: 1, ref: "CASE-2026-000A", tenantId: 7 };
const CASE_T8 = { id: 2, ref: "CASE-2026-000B", tenantId: 8 };
const DOC_T7 = { id: 501, caseId: 1, filename: "t7.pdf", mimeType: "application/pdf", confidential: false };
const DOC_T8 = { id: 502, caseId: 2, filename: "t8.pdf", mimeType: "application/pdf", confidential: false };

function ctxFor(user: { id: number; role: string; tenantId: number | null }): TrpcContext {
  return {
    user: { name: "Test User", email: "user@test.dev", ...user } as TrpcContext["user"],
    tenantId: user.tenantId,
    isDemo: false,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

const tenant7 = { id: 11, role: "analyst", tenantId: 7 };
const admin = { id: 1, role: "admin", tenantId: null };

beforeEach(() => {
  dbHolder.current = createFakeDb({
    cases: [CASE_T7 as any, CASE_T8 as any],
    case_documents: [DOC_T7 as any, DOC_T8 as any],
    audit_log: [],
  });
});

describe("documentVault.get tenant scoping", () => {
  it("returns a document whose case belongs to the caller's tenant", async () => {
    const caller = documentVaultRouter.createCaller(ctxFor(tenant7));
    const result = await caller.get({ id: 501 });
    expect(result.document.id).toBe(501);
  });

  it("returns NOT_FOUND for a document whose case belongs to another tenant", async () => {
    const caller = documentVaultRouter.createCaller(ctxFor(tenant7));
    await expect(caller.get({ id: 502 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("allows platform admins to read any document", async () => {
    const caller = documentVaultRouter.createCaller(ctxFor(admin));
    const result = await caller.get({ id: 502 });
    expect(result.document.id).toBe(502);
  });
});

describe("documentVault.list tenant scoping", () => {
  it("restricts results to documents on the caller's tenant's cases", async () => {
    const caller = documentVaultRouter.createCaller(ctxFor(tenant7));
    const result = await caller.list({});
    const filenames = result.documents.map((d: any) => d.filename);
    expect(filenames).toContain("t7.pdf");
    expect(filenames).not.toContain("t8.pdf");

    // The tenant's case IDs are resolved through a tenant-scoped cases query
    const casesQuery = dbHolder.current.captured.find(c => c.table === "cases");
    expect(casesQuery).toBeDefined();
    expect(hasEqCondition(casesQuery!.cond, "tenantId", 7)).toBe(true);

    // Documents are restricted via the parent case FK
    const docQueries = dbHolder.current.captured.filter(c => c.table === "case_documents");
    expect(docQueries.length).toBeGreaterThan(0);
    for (const q of docQueries) {
      expect(hasColumnCondition(q.cond, "caseId")).toBe(true);
    }
  });

  it("applies no tenant restriction for platform admins", async () => {
    const caller = documentVaultRouter.createCaller(ctxFor(admin));
    await caller.list({});
    const queries = dbHolder.current.captured.filter(c => c.table === "case_documents");
    for (const q of queries) {
      expect(hasColumnCondition(q.cond ?? {}, "tenantId")).toBe(false);
    }
  });
});

describe("documentVault.upload case attachment", () => {
  const pdfBase64 = Buffer.from("%PDF-1.4 test").toString("base64");

  it("rejects uploads without a caseId at input validation", async () => {
    const caller = documentVaultRouter.createCaller(ctxFor(tenant7));
    await expect(
      caller.upload({
        filename: "evidence.pdf",
        mimeType: "application/pdf",
        base64Content: pdfBase64,
        sizeBytes: 12,
        category: "other",
      } as any),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects uploads targeting another tenant's case", async () => {
    const caller = documentVaultRouter.createCaller(ctxFor(tenant7));
    await expect(
      caller.upload({
        filename: "evidence.pdf",
        mimeType: "application/pdf",
        base64Content: pdfBase64,
        sizeBytes: 12,
        category: "other",
        caseId: 2,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("attaches uploads to an explicit same-tenant case", async () => {
    const caller = documentVaultRouter.createCaller(ctxFor(tenant7));
    const doc = await caller.upload({
      filename: "evidence.pdf",
      mimeType: "application/pdf",
      base64Content: pdfBase64,
      sizeBytes: 12,
      category: "investigation_evidence",
      caseId: 1,
    });
    expect(doc.caseId).toBe(1);
  });
});

describe("documentVault.update tenant scoping", () => {
  it("rejects metadata updates to another tenant's document", async () => {
    const caller = documentVaultRouter.createCaller(ctxFor(tenant7));
    await expect(
      caller.update({ id: 502, description: "tampered" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
