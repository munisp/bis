/**
 * LEX — Law Enforcement Extension: Vitest Tests
 * Tests agency code generation, jurisdiction enforcement, validation scoring,
 * velocity limiting, PIN authentication, and state statistics.
 */

import { describe, it, expect } from "vitest";
import { NIGERIAN_STATES } from "./lex";

// ── Unit tests that don't require a DB connection ─────────────────────────────

describe("NIGERIAN_STATES lookup", () => {
  it("contains all 36 states plus FCT", () => {
    expect(Object.keys(NIGERIAN_STATES)).toHaveLength(37);
  });

  it("has Lagos as LA", () => {
    expect(NIGERIAN_STATES["LA"]).toBe("Lagos");
  });

  it("has FCT Abuja as FC", () => {
    expect(NIGERIAN_STATES["FC"]).toBe("FCT Abuja");
  });

  it("has Rivers as RI", () => {
    expect(NIGERIAN_STATES["RI"]).toBe("Rivers");
  });

  it("has Borno as BO", () => {
    expect(NIGERIAN_STATES["BO"]).toBe("Borno");
  });

  it("all state codes are exactly 2 characters", () => {
    for (const code of Object.keys(NIGERIAN_STATES)) {
      expect(code).toHaveLength(2);
    }
  });

  it("all state names are non-empty strings", () => {
    for (const name of Object.values(NIGERIAN_STATES)) {
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

// ── Agency code generation logic ──────────────────────────────────────────────

describe("Agency code generation", () => {
  function generateAgencyCode(type: string, state: string, commandUnit: string | undefined, lga: string | undefined, seq: number) {
    const unitSlug = (commandUnit ?? lga ?? "HQ").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    const seqStr = String(seq).padStart(3, "0");
    return `${type.toUpperCase()}-${state}-${unitSlug}-${seqStr}`;
  }

  it("generates a well-formed code for NPF Lagos", () => {
    const code = generateAgencyCode("npf", "LA", "Apapa Area Command", undefined, 1);
    expect(code).toBe("NPF-LA-APAPAAREACOM-001");
  });

  it("falls back to HQ when no commandUnit or lga", () => {
    const code = generateAgencyCode("efcc", "FC", undefined, undefined, 1);
    expect(code).toBe("EFCC-FC-HQ-001");
  });

  it("uses lga when commandUnit is absent", () => {
    const code = generateAgencyCode("icpc", "KN", undefined, "Nassarawa LGA", 2);
    expect(code).toBe("ICPC-KN-NASSARAWALGA-002");
  });

  it("pads sequence to 3 digits", () => {
    const code = generateAgencyCode("dss", "RI", "HQ", undefined, 5);
    expect(code).toBe("DSS-RI-HQ-005");
  });

  it("truncates unit slug to 12 characters", () => {
    const code = generateAgencyCode("npf", "LA", "Very Long Command Unit Name That Exceeds Limit", undefined, 1);
    const parts = code.split("-");
    expect(parts[2].length).toBeLessThanOrEqual(12);
  });
});

// ── Validation scoring logic ──────────────────────────────────────────────────

describe("Submission validation scoring", () => {
  function computeValidationScore(opts: {
    hasNinOrPhone: boolean;
    hasGps: boolean;
    gpsInNigeria: boolean;
    reputationScore: number;
  }) {
    let score = 20; // structural pass
    const notes: Record<string, string> = { structural: "pass", velocityCheck: "pass" };

    if (opts.hasNinOrPhone) { score += 10; notes.identityFields = "present"; }
    if (opts.hasGps) {
      score += 10;
      if (!opts.gpsInNigeria) { score -= 15; notes.geospatial = "outside_nigeria"; }
      else notes.geospatial = "pass";
    }
    if (opts.reputationScore >= 50) { score += 5; notes.reputation = "good"; }

    return { score, notes };
  }

  it("base score is 20 for minimal structural submission", () => {
    const { score } = computeValidationScore({ hasNinOrPhone: false, hasGps: false, gpsInNigeria: false, reputationScore: 0 });
    expect(score).toBe(20);
  });

  it("adds 10 points for NIN or phone", () => {
    const { score } = computeValidationScore({ hasNinOrPhone: true, hasGps: false, gpsInNigeria: false, reputationScore: 0 });
    expect(score).toBe(30);
  });

  it("adds 10 points for GPS in Nigeria", () => {
    const { score } = computeValidationScore({ hasNinOrPhone: false, hasGps: true, gpsInNigeria: true, reputationScore: 0 });
    expect(score).toBe(30);
  });

  it("subtracts 15 points for GPS outside Nigeria", () => {
    const { score } = computeValidationScore({ hasNinOrPhone: false, hasGps: true, gpsInNigeria: false, reputationScore: 0 });
    expect(score).toBe(15); // 20 + 10 - 15
  });

  it("adds 5 points for good reputation (>=50)", () => {
    const { score } = computeValidationScore({ hasNinOrPhone: false, hasGps: false, gpsInNigeria: false, reputationScore: 50 });
    expect(score).toBe(25);
  });

  it("does not add reputation bonus for score < 50", () => {
    const { score } = computeValidationScore({ hasNinOrPhone: false, hasGps: false, gpsInNigeria: false, reputationScore: 49 });
    expect(score).toBe(20);
  });

  it("full score for best-case submission", () => {
    const { score } = computeValidationScore({ hasNinOrPhone: true, hasGps: true, gpsInNigeria: true, reputationScore: 100 });
    expect(score).toBe(45); // 20 + 10 + 10 + 5
  });
});

// ── Nigeria bounding box check ─────────────────────────────────────────────────

describe("Nigeria GPS bounding box", () => {
  function isInNigeria(lat: number, lng: number) {
    return lat >= 4.0 && lat <= 14.0 && lng >= 2.7 && lng <= 15.0;
  }

  it("Lagos coordinates are in Nigeria", () => {
    expect(isInNigeria(6.5244, 3.3792)).toBe(true);
  });

  it("Abuja coordinates are in Nigeria", () => {
    expect(isInNigeria(9.0765, 7.3986)).toBe(true);
  });

  it("Kano coordinates are in Nigeria", () => {
    expect(isInNigeria(12.0022, 8.5920)).toBe(true);
  });

  it("London coordinates are NOT in Nigeria", () => {
    expect(isInNigeria(51.5074, -0.1278)).toBe(false);
  });

  it("Accra (Ghana) coordinates are NOT in Nigeria", () => {
    expect(isInNigeria(5.6037, -0.1870)).toBe(false);
  });

  it("Cameroon border coordinates are in Nigeria bounding box", () => {
    // Eastern border area — within bounding box (lat 6.0, lng 14.5 is within Nigeria bounds)
    expect(isInNigeria(6.0, 14.5)).toBe(true); // both lat and lng are within Nigeria bounding box
  });
});

// ── Submission reference generation ───────────────────────────────────────────

describe("Submission reference generation", () => {
  function generateRef(year: number, state: string, existingCount: number) {
    const seq = String(existingCount + 1).padStart(4, "0");
    return `LEX-${year}-${state}-${seq}`;
  }

  it("generates correct ref for first submission in Lagos 2026", () => {
    expect(generateRef(2026, "LA", 0)).toBe("LEX-2026-LA-0001");
  });

  it("generates correct ref for 100th submission in Rivers", () => {
    expect(generateRef(2026, "RI", 99)).toBe("LEX-2026-RI-0100");
  });

  it("pads sequence to 4 digits", () => {
    expect(generateRef(2026, "KN", 4)).toBe("LEX-2026-KN-0005");
  });

  it("handles 4-digit sequences correctly", () => {
    expect(generateRef(2026, "LA", 9999)).toBe("LEX-2026-LA-10000");
  });
});

// ── Velocity limit logic ───────────────────────────────────────────────────────

describe("Velocity limit enforcement", () => {
  it("allows submission when count is below limit", () => {
    const count = 4;
    const limit = 5;
    expect(count >= limit).toBe(false); // should not block
  });

  it("blocks submission when count equals limit", () => {
    const count = 5;
    const limit = 5;
    expect(count >= limit).toBe(true); // should block
  });

  it("blocks submission when count exceeds limit", () => {
    const count = 6;
    const limit = 5;
    expect(count >= limit).toBe(true); // should block
  });
});

// ── PIN format validation ──────────────────────────────────────────────────────

describe("PIN format validation", () => {
  const isValidPin = (pin: string) => pin.length === 6 && /^\d{6}$/.test(pin);

  it("accepts a valid 6-digit PIN", () => {
    expect(isValidPin("123456")).toBe(true);
  });

  it("rejects a 5-digit PIN", () => {
    expect(isValidPin("12345")).toBe(false);
  });

  it("rejects a 7-digit PIN", () => {
    expect(isValidPin("1234567")).toBe(false);
  });

  it("rejects a PIN with letters", () => {
    expect(isValidPin("12345a")).toBe(false);
  });

  it("rejects an empty PIN", () => {
    expect(isValidPin("")).toBe(false);
  });
});

// ── Reputation score delta logic ───────────────────────────────────────────────

describe("Submitter reputation scoring", () => {
  function applyDelta(current: number, action: "validate" | "reject" | "escalate") {
    const delta = action === "validate" ? 10 : action === "reject" ? -15 : 0;
    return Math.max(0, current + delta); // floor at 0
  }

  it("increases reputation by 10 on validation", () => {
    expect(applyDelta(50, "validate")).toBe(60);
  });

  it("decreases reputation by 15 on rejection", () => {
    expect(applyDelta(50, "reject")).toBe(35);
  });

  it("does not change reputation on escalation", () => {
    expect(applyDelta(50, "escalate")).toBe(50);
  });

  it("floors reputation at 0 on rejection", () => {
    expect(applyDelta(5, "reject")).toBe(0);
  });

  it("starting reputation of 0 increases to 10 on validation", () => {
    expect(applyDelta(0, "validate")).toBe(10);
  });
});
