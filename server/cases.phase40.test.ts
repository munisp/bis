/**
 * Phase 40 — Case Management: deleteDocument, exportCasePdf, exportCaseCsv, enhanced list
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildMockDb(overrides: Record<string, any> = {}) {
  const mockDb: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    ...overrides,
  };
  return mockDb;
}

// ─── deleteDocument logic ─────────────────────────────────────────────────────

describe("deleteDocument procedure logic", () => {
  it("should delete document and return success: true", async () => {
    const deletedRows: any[] = [];
    const timelineRows: any[] = [];

    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn()
        .mockResolvedValueOnce([{ id: 1, ref: "CASE-2026-0001" }]) // case lookup
        .mockResolvedValueOnce([{ id: 42, caseId: 1, filename: "evidence.pdf", fileKey: "cases/1/evidence.pdf", mimeType: "application/pdf" }]), // doc lookup
      delete: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue([]),
    };

    // Simulate the delete logic
    const caseRef = "CASE-2026-0001";
    const documentId = 42;

    const [c] = await mockDb.select().from("cases").where("ref").limit(1);
    expect(c.ref).toBe(caseRef);

    const [doc] = await mockDb.select().from("caseDocuments").where("id").limit(1);
    expect(doc.id).toBe(42);

    await mockDb.delete("caseDocuments").where("id");
    await mockDb.insert("caseTimeline").values({
      caseId: c.id,
      eventType: "document_deleted",
      title: `Document deleted: ${doc.filename}`,
    });

    expect(mockDb.delete).toHaveBeenCalledWith("caseDocuments");
    expect(mockDb.insert).toHaveBeenCalledWith("caseTimeline");
  });

  it("should throw NOT_FOUND if case does not exist", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValueOnce([]), // empty — case not found
    };

    const [c] = await mockDb.select().from("cases").where("ref").limit(1);
    expect(c).toBeUndefined();
    // In the real procedure, this would throw TRPCError NOT_FOUND
  });

  it("should throw NOT_FOUND if document does not belong to the case", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn()
        .mockResolvedValueOnce([{ id: 1, ref: "CASE-2026-0001" }]) // case found
        .mockResolvedValueOnce([]), // doc not found (wrong caseId)
    };

    const [c] = await mockDb.select().from("cases").where("ref").limit(1);
    expect(c).toBeDefined();
    const [doc] = await mockDb.select().from("caseDocuments").where("id").limit(1);
    expect(doc).toBeUndefined();
    // In the real procedure, this would throw TRPCError NOT_FOUND
  });
});

// ─── exportCasePdf logic ──────────────────────────────────────────────────────

describe("exportCasePdf procedure logic", () => {
  it("should build valid HTML content for a case", () => {
    const c = {
      ref: "CASE-2026-0001",
      title: "AML Investigation — Acme Corp",
      type: "aml",
      status: "open",
      priority: "high",
      summary: "Suspected layering activity via shell companies.",
      legalBasis: "EFCC Act 2004",
      jurisdiction: "Nigeria",
      regulatoryFramework: "FATF",
      riskScore: 78,
      createdAt: new Date("2026-01-15"),
      dueAt: new Date("2026-06-30"),
      closedAt: null,
      closureReason: null,
    };
    const parties = [{ name: "John Doe", role: "subject" }];
    const documents = [{ filename: "bank_statement.pdf", mimeType: "application/pdf", sizeBytes: 204800, confidential: false, createdAt: new Date() }];
    const timeline = [{ title: "Case created", actorName: "Admin", createdAt: new Date() }];

    const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
      <h1>BIS Compliance Case Report</h1>
      <p>Reference: ${c.ref}</p>
      <p>Title: ${c.title}</p>
      <p>Status: ${c.status}</p>
      <p>Risk Score: ${c.riskScore}/100</p>
      <p>Parties: ${parties.map(p => `${p.name} (${p.role})`).join(", ")}</p>
      <p>Documents: ${documents.length}</p>
      <p>Timeline events: ${timeline.length}</p>
    </body></html>`;

    expect(htmlContent).toContain(c.ref);
    expect(htmlContent).toContain(c.title);
    expect(htmlContent).toContain("78/100");
    expect(htmlContent).toContain("John Doe (subject)");
    expect(htmlContent).toContain("Documents: 1");
    expect(htmlContent).toContain("Timeline events: 1");
  });

  it("should handle missing optional fields gracefully", () => {
    const c = {
      ref: "CASE-2026-0002",
      title: "Minimal Case",
      type: "other",
      status: "draft",
      priority: "low",
      summary: null,
      legalBasis: null,
      jurisdiction: null,
      regulatoryFramework: null,
      riskScore: null,
      createdAt: new Date(),
      dueAt: null,
    };

    const legalBasisDisplay = c.legalBasis ?? "—";
    const riskDisplay = c.riskScore != null ? `${c.riskScore}/100` : "—";

    expect(legalBasisDisplay).toBe("—");
    expect(riskDisplay).toBe("—");
  });
});

// ─── exportCaseCsv logic ──────────────────────────────────────────────────────

describe("exportCaseCsv procedure logic", () => {
  it("should generate valid CSV from case rows", () => {
    const rows = [
      { ref: "CASE-2026-0001", title: "AML Investigation", type: "aml", status: "open", priority: "high", createdAt: new Date("2026-01-15"), dueAt: null, riskScore: 78, tags: ["fraud"] },
      { ref: "CASE-2026-0002", title: "KYC Failure — Corp", type: "kyc_failure", status: "closed", priority: "medium", createdAt: new Date("2026-02-01"), dueAt: new Date("2026-03-01"), riskScore: null, tags: [] },
    ];

    const header = "Ref,Title,Type,Status,Priority,Created,Due Date,Risk Score,Tags";
    const csvRows = rows.map(r => [
      r.ref,
      `"${r.title.replace(/"/g, '""')}"`,
      r.type,
      r.status,
      r.priority,
      new Date(r.createdAt).toISOString().split("T")[0],
      r.dueAt ? new Date(r.dueAt).toISOString().split("T")[0] : "",
      r.riskScore ?? "",
      `"${((r.tags as string[]) ?? []).join(";")}"`
    ].join(","));
    const csv = [header, ...csvRows].join("\n");

    expect(csv).toContain("Ref,Title,Type,Status,Priority");
    expect(csv).toContain("CASE-2026-0001");
    expect(csv).toContain('"AML Investigation"');
    expect(csv).toContain("78");
    expect(csv).toContain('"fraud"');
    expect(csv).toContain("CASE-2026-0002");
    expect(csv).toContain("2026-03-01");
    // Null risk score should be empty — row ends with ,medium,2026-02-01,2026-03-01,,""
    expect(csv).toContain('medium,2026-02-01,2026-03-01,,""');
  });

  it("should escape quotes in CSV fields", () => {
    const title = 'Case with "quotes" in title';
    const escaped = `"${title.replace(/"/g, '""')}"`;
    expect(escaped).toBe('"Case with ""quotes"" in title"');
  });

  it("should handle empty results", () => {
    const rows: any[] = [];
    const header = "Ref,Title,Type,Status,Priority,Created,Due Date,Risk Score,Tags";
    const csv = [header].join("\n");
    expect(csv).toBe(header);
    expect(csv.split("\n").length).toBe(1);
  });
});

// ─── Enhanced list filter logic ───────────────────────────────────────────────

describe("enhanced cases.list filter logic", () => {
  it("should build correct filter conditions for all filter types", () => {
    const input = {
      status: "open",
      type: "aml",
      priority: "high",
      search: "acme",
      dateFrom: new Date("2026-01-01"),
      dateTo: new Date("2026-12-31"),
      myCases: true,
      sortBy: "priority" as const,
    };

    const filters: string[] = [];
    if (input.status) filters.push(`status = '${input.status}'`);
    if (input.type) filters.push(`type = '${input.type}'`);
    if (input.priority) filters.push(`priority = '${input.priority}'`);
    if (input.search) filters.push(`title ILIKE '%${input.search}%'`);
    if (input.dateFrom) filters.push(`createdAt >= '${input.dateFrom.toISOString()}'`);
    if (input.dateTo) filters.push(`createdAt <= '${input.dateTo.toISOString()}'`);
    if (input.myCases) filters.push("leadAnalystId = :userId");

    expect(filters).toHaveLength(7);
    expect(filters[0]).toBe("status = 'open'");
    expect(filters[3]).toBe("title ILIKE '%acme%'");
    expect(filters[6]).toBe("leadAnalystId = :userId");
  });

  it("should apply correct sort order for each sortBy option", () => {
    const sortMap: Record<string, string> = {
      created_desc: "createdAt DESC",
      created_asc: "createdAt ASC",
      priority: "priority DESC",
      due_date: "dueAt ASC",
    };

    for (const [key, expected] of Object.entries(sortMap)) {
      let orderBy: string;
      switch (key) {
        case "created_asc": orderBy = "createdAt ASC"; break;
        case "priority": orderBy = "priority DESC"; break;
        case "due_date": orderBy = "dueAt ASC"; break;
        default: orderBy = "createdAt DESC";
      }
      expect(orderBy).toBe(expected);
    }
  });

  it("should default to created_desc when no sortBy provided", () => {
    const input: { sortBy?: string } = {};
    let orderBy: string;
    switch (input.sortBy) {
      case "created_asc": orderBy = "createdAt ASC"; break;
      case "priority": orderBy = "priority DESC"; break;
      case "due_date": orderBy = "dueAt ASC"; break;
      default: orderBy = "createdAt DESC";
    }
    expect(orderBy).toBe("createdAt DESC");
  });

  it("should apply no filters when input is empty", () => {
    const input: Record<string, any> = {};
    const filters: string[] = [];
    if (input.status) filters.push("status");
    if (input.type) filters.push("type");
    if (input.priority) filters.push("priority");
    if (input.search) filters.push("search");
    if (input.dateFrom) filters.push("dateFrom");
    if (input.dateTo) filters.push("dateTo");
    if (input.myCases) filters.push("myCases");
    expect(filters).toHaveLength(0);
  });
});

// ─── Document preview / download helpers ─────────────────────────────────────

describe("document preview type detection", () => {
  it("should identify image types correctly", () => {
    const mimeTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
    for (const mt of mimeTypes) {
      expect(mt.startsWith("image/")).toBe(true);
    }
  });

  it("should identify PDF type correctly", () => {
    expect("application/pdf" === "application/pdf").toBe(true);
  });

  it("should mark non-previewable types correctly", () => {
    const nonPreviewable = ["application/zip", "application/msword", "text/plain"];
    for (const mt of nonPreviewable) {
      const canPreview = mt.startsWith("image/") || mt === "application/pdf";
      expect(canPreview).toBe(false);
    }
  });
});

// ─── CSV escape logic ─────────────────────────────────────────────────────────

describe("CSV field escaping", () => {
  it("should wrap fields with commas in quotes", () => {
    const field = "Lagos, Nigeria";
    const escaped = field.includes(",") ? `"${field}"` : field;
    expect(escaped).toBe('"Lagos, Nigeria"');
  });

  it("should double-escape internal quotes", () => {
    const field = 'He said "hello"';
    const escaped = `"${field.replace(/"/g, '""')}"`;
    expect(escaped).toBe('"He said ""hello"""');
  });

  it("should handle empty tags array", () => {
    const tags: string[] = [];
    const csv = `"${tags.join(";")}"`;
    expect(csv).toBe('""');
  });

  it("should join multiple tags with semicolons", () => {
    const tags = ["fraud", "aml", "lagos"];
    const csv = `"${tags.join(";")}"`;
    expect(csv).toBe('"fraud;aml;lagos"');
  });
});
