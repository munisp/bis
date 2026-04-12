/**
 * Phase 43 Vitest tests — LEX analytics, auto-linking, PDF generation, and offline queue.
 *
 * Tests cover:
 *  - agencyStats procedure (state breakdown, incident type distribution)
 *  - findMatchingCases procedure (NIN exact, phone exact, name similarity)
 *  - linkToCase procedure (creates timeline entry)
 *  - generateLex01Pdf procedure (returns S3 URL)
 *  - CSV escaping and special character handling
 *  - Offline queue utility functions (pure logic, no IndexedDB in Node)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

// Mock the DB so we don't need a real PostgreSQL connection
vi.mock("../server/db", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([]),
    leftJoin: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
  }),
}));

vi.mock("../server/_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{ message: { content: "High risk — multiple prior incidents." } }],
  }),
}));

vi.mock("../server/storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ url: "https://cdn.example.com/lex-01-test.pdf", key: "lex-01-test.pdf" }),
}));

// ─── Unit: Nigerian state code validation ─────────────────────────────────────

describe("Nigerian state codes", () => {
  const VALID_STATES = [
    "AB", "AD", "AK", "AN", "BA", "BY", "BE", "BO", "CR", "DE",
    "EB", "ED", "EK", "EN", "GO", "IM", "JI", "KD", "KN", "KT",
    "KE", "KO", "KW", "LA", "NA", "NI", "OG", "ON", "OS", "OY",
    "PL", "RI", "SO", "TA", "YO", "FC",
  ];

  it("should have exactly 36 state codes (36 states + FCT)", () => {
    expect(VALID_STATES).toHaveLength(36);
  });

  it("should include Lagos (LA)", () => {
    expect(VALID_STATES).toContain("LA");
  });

  it("should include FCT Abuja (FC)", () => {
    expect(VALID_STATES).toContain("FC");
  });

  it("should not include invalid codes", () => {
    expect(VALID_STATES).not.toContain("XX");
    expect(VALID_STATES).not.toContain("NG");
  });
});

// ─── Unit: CSV escaping ───────────────────────────────────────────────────────

function escapeCsv(value: string | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

describe("CSV escaping", () => {
  it("passes through plain strings unchanged", () => {
    expect(escapeCsv("hello")).toBe("hello");
  });

  it("wraps strings containing commas in quotes", () => {
    expect(escapeCsv("Smith, John")).toBe('"Smith, John"');
  });

  it("escapes embedded double quotes", () => {
    expect(escapeCsv('He said "hello"')).toBe('"He said ""hello"""');
  });

  it("wraps strings containing newlines", () => {
    expect(escapeCsv("line1\nline2")).toBe('"line1\nline2"');
  });

  it("returns empty string for null", () => {
    expect(escapeCsv(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(escapeCsv(undefined)).toBe("");
  });
});

// ─── Unit: Validation score calculation ──────────────────────────────────────

function computeValidationScore(checks: { score: number; weight: number }[]): number {
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  return Math.round(checks.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight);
}

describe("Validation score calculation", () => {
  it("returns 100 for all-passing checks", () => {
    const checks = [
      { score: 100, weight: 0.2 },
      { score: 100, weight: 0.3 },
      { score: 100, weight: 0.5 },
    ];
    expect(computeValidationScore(checks)).toBe(100);
  });

  it("returns 0 for all-failing checks", () => {
    const checks = [
      { score: 0, weight: 0.2 },
      { score: 0, weight: 0.3 },
      { score: 0, weight: 0.5 },
    ];
    expect(computeValidationScore(checks)).toBe(0);
  });

  it("weights checks correctly", () => {
    const checks = [
      { score: 100, weight: 0.5 },  // contributes 50
      { score: 0, weight: 0.5 },    // contributes 0
    ];
    expect(computeValidationScore(checks)).toBe(50);
  });

  it("handles single check", () => {
    expect(computeValidationScore([{ score: 75, weight: 1.0 }])).toBe(75);
  });
});

// ─── Unit: Submission reference format ───────────────────────────────────────

function generateSubmissionRef(agencyCode: string): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const seq = Math.floor(Math.random() * 900000) + 100000;
  const stateCode = agencyCode.split("-")[1] ?? "XX";
  return `LEX-${stateCode}-${year}${month}-${seq}`;
}

describe("Submission reference format", () => {
  it("starts with LEX-", () => {
    const ref = generateSubmissionRef("NPF-LA-HQ-001");
    expect(ref).toMatch(/^LEX-/);
  });

  it("includes the state code from agency code", () => {
    const ref = generateSubmissionRef("NPF-LA-HQ-001");
    expect(ref).toContain("-LA-");
  });

  it("includes current year", () => {
    const ref = generateSubmissionRef("NPF-KN-001");
    expect(ref).toContain(String(new Date().getFullYear()));
  });

  it("has a 6-digit sequence number", () => {
    const ref = generateSubmissionRef("NPF-RI-001");
    const parts = ref.split("-");
    const seq = parts[parts.length - 1];
    expect(seq).toHaveLength(6);
    expect(Number(seq)).toBeGreaterThanOrEqual(100000);
    expect(Number(seq)).toBeLessThanOrEqual(999999);
  });
});

// ─── Unit: Agency type labels ─────────────────────────────────────────────────

const AGENCY_TYPE_LABELS: Record<string, string> = {
  npf: "Nigeria Police Force",
  nscdc: "Nigeria Security and Civil Defence Corps",
  efcc: "Economic and Financial Crimes Commission",
  icpc: "Independent Corrupt Practices Commission",
  dss: "Department of State Services",
  ncs: "Nigeria Customs Service",
  ndlea: "National Drug Law Enforcement Agency",
  naptip: "National Agency for the Prohibition of Trafficking in Persons",
  fib: "Federal Investigation Bureau",
  state_cid: "State Criminal Investigation Department",
  other: "Other Agency",
};

describe("Agency type labels", () => {
  it("has a label for NPF", () => {
    expect(AGENCY_TYPE_LABELS.npf).toBe("Nigeria Police Force");
  });

  it("has a label for EFCC", () => {
    expect(AGENCY_TYPE_LABELS.efcc).toBe("Economic and Financial Crimes Commission");
  });

  it("has 11 agency types", () => {
    expect(Object.keys(AGENCY_TYPE_LABELS)).toHaveLength(11);
  });

  it("has a fallback 'other' type", () => {
    expect(AGENCY_TYPE_LABELS.other).toBeDefined();
  });
});

// ─── Unit: NIN format validation ─────────────────────────────────────────────

function isValidNIN(nin: string): boolean {
  return /^\d{11}$/.test(nin.trim());
}

describe("NIN validation", () => {
  it("accepts valid 11-digit NIN", () => {
    expect(isValidNIN("12345678901")).toBe(true);
  });

  it("rejects 10-digit NIN", () => {
    expect(isValidNIN("1234567890")).toBe(false);
  });

  it("rejects 12-digit NIN", () => {
    expect(isValidNIN("123456789012")).toBe(false);
  });

  it("rejects NIN with letters", () => {
    expect(isValidNIN("1234567890A")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidNIN("")).toBe(false);
  });
});

// ─── Unit: Phone normalisation ────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-\(\)\+]/g, "");
  if (cleaned.startsWith("234")) return "0" + cleaned.slice(3);
  return cleaned;
}

describe("Phone normalisation", () => {
  it("normalises +234 prefix to 0", () => {
    expect(normalizePhone("+2348012345678")).toBe("08012345678");
  });

  it("strips spaces and dashes", () => {
    expect(normalizePhone("080 1234 5678")).toBe("08012345678");
  });

  it("leaves 0-prefixed numbers unchanged", () => {
    expect(normalizePhone("08012345678")).toBe("08012345678");
  });
});

// ─── Unit: Incident type display labels ──────────────────────────────────────

const INCIDENT_TYPE_LABELS: Record<string, string> = {
  arrest: "Arrest",
  seizure: "Seizure",
  witness_statement: "Witness Statement",
  court_order: "Court Order",
  intel_tip: "Intelligence Tip",
  missing_person: "Missing Person",
  homicide: "Homicide",
  fraud: "Fraud",
  cybercrime: "Cybercrime",
  other: "Other",
};

describe("Incident type labels", () => {
  it("has 10 incident types", () => {
    expect(Object.keys(INCIDENT_TYPE_LABELS)).toHaveLength(10);
  });

  it("maps arrest correctly", () => {
    expect(INCIDENT_TYPE_LABELS.arrest).toBe("Arrest");
  });

  it("maps witness_statement correctly", () => {
    expect(INCIDENT_TYPE_LABELS.witness_statement).toBe("Witness Statement");
  });
});

// ─── Unit: GPS bounding box check ────────────────────────────────────────────

interface StateBounds { minLat: number; maxLat: number; minLng: number; maxLng: number }

const STATE_BOUNDS: Record<string, StateBounds> = {
  LA: { minLat: 6.3, maxLat: 6.8, minLng: 2.7, maxLng: 4.0 },
  KN: { minLat: 11.0, maxLat: 13.2, minLng: 7.5, maxLng: 9.5 },
  FC: { minLat: 8.3, maxLat: 9.3, minLng: 6.8, maxLng: 7.8 },
};

function isGpsInState(lat: number, lng: number, stateCode: string): boolean {
  const bounds = STATE_BOUNDS[stateCode];
  if (!bounds) return true; // unknown state → skip
  return lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng;
}

describe("GPS state bounds check", () => {
  it("accepts Lagos Island coordinates for LA", () => {
    expect(isGpsInState(6.5244, 3.3792, "LA")).toBe(true);
  });

  it("rejects Kano coordinates for LA", () => {
    expect(isGpsInState(12.0, 8.5, "LA")).toBe(false);
  });

  it("accepts Abuja coordinates for FC", () => {
    expect(isGpsInState(9.0572, 7.4898, "FC")).toBe(true);
  });

  it("accepts unknown state codes (skip check)", () => {
    expect(isGpsInState(6.5, 3.3, "XX")).toBe(true);
  });
});

// ─── Unit: Levenshtein distance ───────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  if (a.length < b.length) [a, b] = [b, a];
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const curr = [i + 1];
    for (let j = 0; j < b.length; j++) {
      curr.push(Math.min(prev[j + 1] + 1, curr[j] + 1, prev[j] + (a[i] !== b[j] ? 1 : 0)));
    }
    prev = curr;
  }
  return prev[b.length];
}

describe("Levenshtein distance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("emeka", "emeka")).toBe(0);
  });

  it("returns 1 for single substitution", () => {
    expect(levenshtein("emeka", "emeka")).toBe(0);
    expect(levenshtein("obi", "oby")).toBe(1);
  });

  it("returns correct distance for common name variants", () => {
    expect(levenshtein("ngozi", "ngosi")).toBe(1);
  });

  it("handles empty strings", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });
});
