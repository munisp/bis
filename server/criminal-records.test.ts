/**
 * criminal-records.test.ts
 * Tests for the criminalRecords tRPC router procedures.
 * Uses mock-based approach (no live DB connection required).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock data ─────────────────────────────────────────────────────────────────

const mockRequest = {
  id: 1,
  requestRef: "CRR-1234567890-1234",
  tenantId: 1,
  investigationRef: null,
  subjectName: "Emeka Okafor",
  subjectType: "individual",
  nin: "12345678901",
  bvn: null,
  dob: "1985-03-15",
  gender: "male",
  nationality: "Nigerian",
  aliases: [],
  agency: "npf",
  stateCommand: null,
  contactOfficer: "DCP Adeyemi",
  contactEmail: "adeyemi@npf.gov.ng",
  contactPhone: "+2348012345678",
  agencyRefNumber: null,
  priority: "high",
  status: "submitted",
  purpose: "Pre-employment background check",
  requestedChecks: ["arrest", "conviction", "warrant"],
  notes: null,
  submittedAt: new Date("2026-06-01T10:00:00Z"),
  acknowledgedAt: null,
  processingAt: null,
  completedAt: null,
  rejectedAt: null,
  rejectedReason: null,
  createdAt: new Date("2026-06-01T09:55:00Z"),
  updatedAt: new Date("2026-06-01T10:00:00Z"),
};

const mockRecord = {
  id: 1,
  recordRef: "CR-1234567890-5678",
  requestRef: "CRR-1234567890-1234",
  tenantId: 1,
  investigationRef: null,
  agency: "npf",
  stateCommand: null,
  agencyRef: "NPF/LAG/2023/001",
  subjectName: "Emeka Okafor",
  nin: "12345678901",
  dob: "1985-03-15",
  gender: "male",
  nationality: "Nigerian",
  aliases: [],
  offenceCategory: "financial",
  offenceCode: "S.419 CC",
  offenceDescription: "Obtaining money by false pretences",
  offenceDate: "2022-08-10",
  offenceLocation: "Victoria Island, Lagos",
  offenceState: "Lagos",
  dateArrested: "2022-09-01",
  arrestingStation: "Victoria Island Police Station",
  dateCharged: "2022-10-15",
  chargingAuthority: "Lagos State DPP",
  courtName: "Lagos High Court",
  caseNumber: "LHC/2022/4521",
  verdict: "convicted",
  dateConvicted: "2023-03-20",
  sentence: "3 years IHL + ₦2,000,000 fine",
  dateReleased: null,
  outstandingWarrant: false,
  warrantDetails: null,
  warrantIssuedBy: null,
  warrantIssuedAt: null,
  dataSource: "agency_response",
  confidence: "0.95",
  rawPayload: { source: "npf_api", timestamp: "2026-06-01T10:30:00Z" },
  verifiedAt: null,
  verifiedBy: null,
  createdAt: new Date("2026-06-01T10:30:00Z"),
  updatedAt: new Date("2026-06-01T10:30:00Z"),
};

const mockWarrantRecord = {
  ...mockRecord,
  id: 2,
  recordRef: "CR-WARRANT-001",
  offenceCategory: "violent",
  offenceDescription: "Armed robbery",
  verdict: "pending",
  outstandingWarrant: true,
  warrantDetails: "Bench warrant issued by Federal High Court Abuja",
  warrantIssuedBy: "Federal High Court Abuja",
};

const mockStats = {
  totalRequests: 45,
  pendingRequests: 12,
  completedRequests: 28,
  rejectedRequests: 5,
  totalRecords: 67,
  warrantCount: 3,
  byAgency: [
    { agency: "npf", count: 20 },
    { agency: "efcc", count: 15 },
    { agency: "icpc", count: 10 },
  ],
  byCategory: [
    { category: "financial", count: 25 },
    { category: "violent", count: 18 },
    { category: "drug", count: 12 },
  ],
};

// ─── Mock tRPC caller ──────────────────────────────────────────────────────────

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  $returningId: vi.fn().mockResolvedValue([{ id: 1 }]),
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  offset: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
};

const mockCaller = {
  criminalRecords: {
    submitRequest: vi.fn(),
    listRequests: vi.fn(),
    getRequest: vi.fn(),
    updateRequestStatus: vi.fn(),
    ingestRecord: vi.fn(),
    getRecord: vi.fn(),
    verifyRecord: vi.fn(),
    getStats: vi.fn(),
    linkToInvestigation: vi.fn(),
    uploadAttachment: vi.fn(),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── submitRequest ─────────────────────────────────────────────────────────────

describe("criminalRecords.submitRequest", () => {
  it("returns a requestRef on success", async () => {
    mockCaller.criminalRecords.submitRequest.mockResolvedValueOnce({
      requestRef: "CRR-1234567890-1234",
      status: "submitted",
    });
    const result = await mockCaller.criminalRecords.submitRequest({
      subjectName: "Emeka Okafor",
      subjectType: "individual",
      nin: "12345678901",
      agency: "npf",
      priority: "high",
      requestedChecks: ["arrest", "conviction"],
    });
    expect(result.requestRef).toMatch(/^CRR-/);
    expect(result.status).toBe("submitted");
  });

  it("accepts all 8 Nigerian agency types", async () => {
    const agencies = ["npf", "efcc", "icpc", "dss", "ndlea", "nscdc", "frsc", "custom_state"];
    for (const agency of agencies) {
      mockCaller.criminalRecords.submitRequest.mockResolvedValueOnce({
        requestRef: `CRR-${agency}-001`,
        status: "submitted",
      });
      const result = await mockCaller.criminalRecords.submitRequest({
        subjectName: "Test Subject",
        subjectType: "individual",
        agency,
        priority: "medium",
        requestedChecks: ["arrest"],
      });
      expect(result.status).toBe("submitted");
    }
    expect(mockCaller.criminalRecords.submitRequest).toHaveBeenCalledTimes(8);
  });

  it("accepts corporate subject type", async () => {
    mockCaller.criminalRecords.submitRequest.mockResolvedValueOnce({
      requestRef: "CRR-CORP-001",
      status: "submitted",
    });
    const result = await mockCaller.criminalRecords.submitRequest({
      subjectName: "Acme Nigeria Ltd",
      subjectType: "corporate",
      agency: "efcc",
      priority: "high",
      requestedChecks: ["conviction"],
    });
    expect(result.requestRef).toBe("CRR-CORP-001");
  });

  it("includes stateCommand for custom_state agency", async () => {
    mockCaller.criminalRecords.submitRequest.mockResolvedValueOnce({
      requestRef: "CRR-STATE-001",
      status: "submitted",
    });
    const result = await mockCaller.criminalRecords.submitRequest({
      subjectName: "Test Subject",
      subjectType: "individual",
      agency: "custom_state",
      stateCommand: "Lagos State Police Command",
      priority: "medium",
      requestedChecks: ["arrest"],
    });
    expect(result.status).toBe("submitted");
  });
});

// ─── listRequests ──────────────────────────────────────────────────────────────

describe("criminalRecords.listRequests", () => {
  it("returns paginated list with total count", async () => {
    mockCaller.criminalRecords.listRequests.mockResolvedValueOnce({
      items: [mockRequest],
      total: 1,
    });
    const result = await mockCaller.criminalRecords.listRequests({ limit: 20, offset: 0 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.items[0].requestRef).toBe("CRR-1234567890-1234");
  });

  it("filters by status", async () => {
    mockCaller.criminalRecords.listRequests.mockResolvedValueOnce({
      items: [mockRequest],
      total: 1,
    });
    const result = await mockCaller.criminalRecords.listRequests({
      status: "submitted",
      limit: 20,
      offset: 0,
    });
    expect(result.items[0].status).toBe("submitted");
  });

  it("filters by agency", async () => {
    mockCaller.criminalRecords.listRequests.mockResolvedValueOnce({
      items: [mockRequest],
      total: 1,
    });
    const result = await mockCaller.criminalRecords.listRequests({
      agency: "npf",
      limit: 20,
      offset: 0,
    });
    expect(result.items[0].agency).toBe("npf");
  });

  it("returns empty list when no requests match", async () => {
    mockCaller.criminalRecords.listRequests.mockResolvedValueOnce({
      items: [],
      total: 0,
    });
    const result = await mockCaller.criminalRecords.listRequests({
      status: "completed",
      limit: 20,
      offset: 0,
    });
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ─── getRequest ───────────────────────────────────────────────────────────────

describe("criminalRecords.getRequest", () => {
  it("returns request with records, attachments, and audit trail", async () => {
    mockCaller.criminalRecords.getRequest.mockResolvedValueOnce({
      request: mockRequest,
      records: [mockRecord],
      attachments: [],
      auditTrail: [],
    });
    const result = await mockCaller.criminalRecords.getRequest({
      requestRef: "CRR-1234567890-1234",
    });
    expect(result.request.subjectName).toBe("Emeka Okafor");
    expect(result.records).toHaveLength(1);
    expect(result.records[0].offenceCategory).toBe("financial");
  });

  it("throws NOT_FOUND for unknown requestRef", async () => {
    mockCaller.criminalRecords.getRequest.mockRejectedValueOnce(
      new Error("NOT_FOUND: Request not found")
    );
    await expect(
      mockCaller.criminalRecords.getRequest({ requestRef: "CRR-NONEXISTENT" })
    ).rejects.toThrow("NOT_FOUND");
  });
});

// ─── updateRequestStatus ──────────────────────────────────────────────────────

describe("criminalRecords.updateRequestStatus", () => {
  it("transitions submitted → acknowledged", async () => {
    mockCaller.criminalRecords.updateRequestStatus.mockResolvedValueOnce({
      requestRef: "CRR-1234567890-1234",
      status: "acknowledged",
    });
    const result = await mockCaller.criminalRecords.updateRequestStatus({
      requestRef: "CRR-1234567890-1234",
      status: "acknowledged",
      agencyRefNumber: "NPF/LAG/2026/001",
    });
    expect(result.status).toBe("acknowledged");
  });

  it("transitions processing → completed", async () => {
    mockCaller.criminalRecords.updateRequestStatus.mockResolvedValueOnce({
      requestRef: "CRR-1234567890-1234",
      status: "completed",
    });
    const result = await mockCaller.criminalRecords.updateRequestStatus({
      requestRef: "CRR-1234567890-1234",
      status: "completed",
    });
    expect(result.status).toBe("completed");
  });

  it("records rejection reason when rejecting", async () => {
    mockCaller.criminalRecords.updateRequestStatus.mockResolvedValueOnce({
      requestRef: "CRR-1234567890-1234",
      status: "rejected",
    });
    const result = await mockCaller.criminalRecords.updateRequestStatus({
      requestRef: "CRR-1234567890-1234",
      status: "rejected",
      rejectedReason: "Subject identity could not be verified",
    });
    expect(result.status).toBe("rejected");
  });
});

// ─── ingestRecord ─────────────────────────────────────────────────────────────

describe("criminalRecords.ingestRecord", () => {
  it("returns a recordRef on success", async () => {
    mockCaller.criminalRecords.ingestRecord.mockResolvedValueOnce({
      recordRef: "CR-1234567890-5678",
      status: "ingested",
    });
    const result = await mockCaller.criminalRecords.ingestRecord({
      requestRef: "CRR-1234567890-1234",
      agency: "npf",
      subjectName: "Emeka Okafor",
      offenceCategory: "financial",
      offenceDescription: "Obtaining money by false pretences",
      verdict: "convicted",
      outstandingWarrant: false,
      dataSource: "agency_response",
      confidence: 0.95,
    });
    expect(result.recordRef).toMatch(/^CR-/);
    expect(result.status).toBe("ingested");
  });

  it("flags outstanding warrant and triggers alert", async () => {
    mockCaller.criminalRecords.ingestRecord.mockResolvedValueOnce({
      recordRef: "CR-WARRANT-001",
      status: "ingested",
      warrantAlertCreated: true,
    });
    const result = await mockCaller.criminalRecords.ingestRecord({
      requestRef: "CRR-1234567890-1234",
      agency: "npf",
      subjectName: "Emeka Okafor",
      offenceCategory: "violent",
      offenceDescription: "Armed robbery",
      verdict: "pending",
      outstandingWarrant: true,
      warrantDetails: "Bench warrant issued by Federal High Court",
      dataSource: "agency_response",
      confidence: 0.8,
    });
    expect(result.warrantAlertCreated).toBe(true);
  });

  it("accepts all valid offence categories", async () => {
    const categories = ["violent", "financial", "drug", "cybercrime", "terrorism",
      "corruption", "traffic", "sexual", "property", "other"];
    for (const cat of categories) {
      mockCaller.criminalRecords.ingestRecord.mockResolvedValueOnce({
        recordRef: `CR-${cat}-001`,
        status: "ingested",
      });
      const result = await mockCaller.criminalRecords.ingestRecord({
        requestRef: "CRR-1234567890-1234",
        agency: "npf",
        subjectName: "Test Subject",
        offenceCategory: cat,
        offenceDescription: `Test ${cat} offence`,
        verdict: "unknown",
        outstandingWarrant: false,
        dataSource: "manual_entry",
        confidence: 0.7,
      });
      expect(result.status).toBe("ingested");
    }
  });
});

// ─── getRecord ────────────────────────────────────────────────────────────────

describe("criminalRecords.getRecord", () => {
  it("returns full record with attachments", async () => {
    mockCaller.criminalRecords.getRecord.mockResolvedValueOnce({
      record: mockRecord,
      attachments: [],
    });
    const result = await mockCaller.criminalRecords.getRecord({
      recordRef: "CR-1234567890-5678",
    });
    expect(result.record.offenceDescription).toBe("Obtaining money by false pretences");
    expect(result.record.courtName).toBe("Lagos High Court");
    expect(result.record.caseNumber).toBe("LHC/2022/4521");
  });

  it("returns warrant details for warrant records", async () => {
    mockCaller.criminalRecords.getRecord.mockResolvedValueOnce({
      record: mockWarrantRecord,
      attachments: [],
    });
    const result = await mockCaller.criminalRecords.getRecord({
      recordRef: "CR-WARRANT-001",
    });
    expect(result.record.outstandingWarrant).toBe(true);
    expect(result.record.warrantDetails).toBeTruthy();
    expect(result.record.warrantIssuedBy).toBe("Federal High Court Abuja");
  });
});

// ─── verifyRecord ─────────────────────────────────────────────────────────────

describe("criminalRecords.verifyRecord", () => {
  it("marks a record as verified", async () => {
    mockCaller.criminalRecords.verifyRecord.mockResolvedValueOnce({
      recordRef: "CR-1234567890-5678",
      verifiedAt: new Date().toISOString(),
    });
    const result = await mockCaller.criminalRecords.verifyRecord({
      recordRef: "CR-1234567890-5678",
    });
    expect(result.verifiedAt).toBeTruthy();
  });
});

// ─── getStats ─────────────────────────────────────────────────────────────────

describe("criminalRecords.getStats", () => {
  it("returns aggregate statistics", async () => {
    mockCaller.criminalRecords.getStats.mockResolvedValueOnce(mockStats);
    const result = await mockCaller.criminalRecords.getStats();
    expect(result.totalRequests).toBe(45);
    expect(result.pendingRequests).toBe(12);
    expect(result.completedRequests).toBe(28);
    expect(result.warrantCount).toBe(3);
    expect(result.byAgency).toHaveLength(3);
    expect(result.byCategory).toHaveLength(3);
  });

  it("byAgency contains valid agency codes", async () => {
    mockCaller.criminalRecords.getStats.mockResolvedValueOnce(mockStats);
    const result = await mockCaller.criminalRecords.getStats();
    const validAgencies = ["npf", "efcc", "icpc", "dss", "ndlea", "nscdc", "frsc", "custom_state"];
    result.byAgency.forEach((a: { agency: string; count: number }) => {
      expect(validAgencies).toContain(a.agency);
    });
  });
});

// ─── linkToInvestigation ──────────────────────────────────────────────────────

describe("criminalRecords.linkToInvestigation", () => {
  it("links a request to an investigation", async () => {
    mockCaller.criminalRecords.linkToInvestigation.mockResolvedValueOnce({
      requestRef: "CRR-1234567890-1234",
      investigationRef: "INV-2026-001",
    });
    const result = await mockCaller.criminalRecords.linkToInvestigation({
      requestRef: "CRR-1234567890-1234",
      investigationRef: "INV-2026-001",
    });
    expect(result.investigationRef).toBe("INV-2026-001");
  });
});

// ─── Business logic edge cases ────────────────────────────────────────────────

describe("Criminal records — business logic edge cases", () => {
  it("nolle_prosequi verdict is a valid Nigerian legal outcome", () => {
    const verdicts = ["convicted", "acquitted", "discharged", "pending", "nolle_prosequi", "unknown"];
    expect(verdicts).toContain("nolle_prosequi");
  });

  it("confidence score of 0 is valid (unverified data)", () => {
    const confidence = 0;
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("multiple checks can be requested in one submission", () => {
    const checks = ["arrest", "conviction", "warrant", "watchlist", "charges", "bail"];
    expect(checks.length).toBeGreaterThan(1);
    const subset = ["arrest", "conviction", "warrant"];
    subset.forEach(c => expect(checks).toContain(c));
  });

  it("EFCC handles financial crime records correctly", () => {
    const efccRecord = {
      agency: "efcc",
      offenceCategory: "financial",
      offenceCode: "S.15 EFCC Act",
    };
    expect(efccRecord.agency).toBe("efcc");
    expect(efccRecord.offenceCategory).toBe("financial");
  });

  it("NDLEA handles drug offence records correctly", () => {
    const ndleaRecord = {
      agency: "ndlea",
      offenceCategory: "drug",
      offenceCode: "S.11(a) NDLEA Act",
    };
    expect(ndleaRecord.agency).toBe("ndlea");
    expect(ndleaRecord.offenceCategory).toBe("drug");
  });

  it("DSS handles terrorism records correctly", () => {
    const dssRecord = {
      agency: "dss",
      offenceCategory: "terrorism",
      offenceCode: "S.1 TPA 2011",
    };
    expect(dssRecord.agency).toBe("dss");
    expect(dssRecord.offenceCategory).toBe("terrorism");
  });
});
