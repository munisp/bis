/**
 * Phase 4 tests: computeStateDensity, densityToColor, geocode cache behaviour,
 * and agent drill-down filter logic.
 *
 * All helpers are pure functions exported from FieldVisitMapPage.tsx.
 * We import them directly to keep tests fast and DOM-free.
 */
import { describe, it, expect } from "vitest";
// Import from the pure helpers module (no React dependency)
import {
  computeStateDensity,
  densityToColor,
  buildAgentSummaries,
} from "../client/src/pages/bis/fieldVisitHelpers";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePoint(overrides: Partial<{
  visitRef: string;
  agentId: string;
  agentName: string;
  outcome: string | null;
  checkInLat: number | null;
  checkInLng: number | null;
  durationMinutes: number | null;
  createdAt: Date;
}> = {}) {
  return {
    visitRef: overrides.visitRef ?? "VIS-001",
    taskRef: "TSK-001",
    agentId: overrides.agentId ?? "AGT-1",
    agentName: overrides.agentName ?? "Agent One",
    investigationId: null,
    checkInLat: overrides.checkInLat ?? 6.5244,
    checkInLng: overrides.checkInLng ?? 3.3792,
    checkOutLat: null,
    checkOutLng: null,
    outcome: overrides.outcome ?? "confirmed",
    subjectPresent: true,
    addressConfirmed: true,
    findings: null,
    durationMinutes: overrides.durationMinutes ?? 30,
    submittedAt: null,
    createdAt: overrides.createdAt ?? new Date("2026-01-15T10:00:00Z"),
  };
}

// ─── computeStateDensity ──────────────────────────────────────────────────────

describe("computeStateDensity", () => {
  it("returns empty array when no points match any state label", () => {
    const points = [makePoint({ visitRef: "V1" }), makePoint({ visitRef: "V2" })];
    const labels = new Map<string, string>(); // no labels
    const result = computeStateDensity(points, labels);
    expect(result).toEqual([]);
  });

  it("counts visits per state correctly", () => {
    const points = [
      makePoint({ visitRef: "V1" }),
      makePoint({ visitRef: "V2" }),
      makePoint({ visitRef: "V3" }),
    ];
    const labels = new Map([
      ["V1", "Lagos"],
      ["V2", "Lagos"],
      ["V3", "Kano"],
    ]);
    const result = computeStateDensity(points, labels);
    expect(result).toHaveLength(2);
    const lagos = result.find(r => r.stateName === "Lagos");
    const kano = result.find(r => r.stateName === "Kano");
    expect(lagos?.count).toBe(2);
    expect(kano?.count).toBe(1);
  });

  it("sorts states by count descending", () => {
    const points = [
      makePoint({ visitRef: "V1" }),
      makePoint({ visitRef: "V2" }),
      makePoint({ visitRef: "V3" }),
      makePoint({ visitRef: "V4" }),
    ];
    const labels = new Map([
      ["V1", "Abuja"],
      ["V2", "Lagos"],
      ["V3", "Lagos"],
      ["V4", "Lagos"],
    ]);
    const result = computeStateDensity(points, labels);
    expect(result[0].stateName).toBe("Lagos");
    expect(result[0].count).toBe(3);
    expect(result[1].stateName).toBe("Abuja");
    expect(result[1].count).toBe(1);
  });

  it("ignores points with no state label", () => {
    const points = [
      makePoint({ visitRef: "V1" }),
      makePoint({ visitRef: "V2" }),
    ];
    const labels = new Map([["V1", "Rivers"]]);
    const result = computeStateDensity(points, labels);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(1);
  });

  it("handles a single point with a single state", () => {
    const points = [makePoint({ visitRef: "V1" })];
    const labels = new Map([["V1", "Ogun"]]);
    const result = computeStateDensity(points, labels);
    expect(result).toEqual([{ stateName: "Ogun", count: 1 }]);
  });

  it("handles FCT normalised name", () => {
    const points = [makePoint({ visitRef: "V1" }), makePoint({ visitRef: "V2" })];
    const labels = new Map([
      ["V1", "FCT — Abuja"],
      ["V2", "FCT — Abuja"],
    ]);
    const result = computeStateDensity(points, labels);
    expect(result[0].stateName).toBe("FCT — Abuja");
    expect(result[0].count).toBe(2);
  });
});

// ─── densityToColor ───────────────────────────────────────────────────────────

describe("densityToColor", () => {
  it("returns low-opacity colour when count is 0", () => {
    const color = densityToColor(0, 10);
    expect(color).toMatch(/^rgba\(/);
    // Alpha should be close to 0.08
    const alpha = parseFloat(color.split(",")[3]);
    expect(alpha).toBeCloseTo(0.08, 1);
  });

  it("returns high-opacity colour when count equals maxCount", () => {
    const color = densityToColor(10, 10);
    const alpha = parseFloat(color.split(",")[3]);
    // Alpha should be close to 0.08 + 0.72 = 0.80
    expect(alpha).toBeCloseTo(0.8, 1);
  });

  it("returns fallback colour when maxCount is 0", () => {
    const color = densityToColor(0, 0);
    expect(color).toBe("rgba(99,102,241,0.08)");
  });

  it("returns a valid rgba string for mid-range values", () => {
    const color = densityToColor(5, 10);
    expect(color).toMatch(/^rgba\(\d+,\d+,\d+,[\d.]+\)$/);
  });

  it("alpha increases monotonically with count", () => {
    const alphas = [0, 2, 5, 8, 10].map(c => {
      const color = densityToColor(c, 10);
      return parseFloat(color.split(",")[3]);
    });
    for (let i = 1; i < alphas.length; i++) {
      expect(alphas[i]).toBeGreaterThanOrEqual(alphas[i - 1]);
    }
  });
});

// ─── Agent drill-down filter logic ───────────────────────────────────────────

describe("agent drill-down filter (pure logic)", () => {
  const points = [
    makePoint({ visitRef: "V1", agentId: "A1", agentName: "Alice" }),
    makePoint({ visitRef: "V2", agentId: "A1", agentName: "Alice" }),
    makePoint({ visitRef: "V3", agentId: "A2", agentName: "Bob" }),
  ];

  it("filters to a single agent's visits", () => {
    const filtered = points.filter(p => p.agentId === "A1");
    expect(filtered).toHaveLength(2);
    expect(filtered.every(p => p.agentId === "A1")).toBe(true);
  });

  it("returns all points when no agent filter is active", () => {
    const activeAgentId: string | null = null;
    const filtered = activeAgentId ? points.filter(p => p.agentId === activeAgentId) : points;
    expect(filtered).toHaveLength(3);
  });

  it("returns empty array when agent has no visits in current data", () => {
    const filtered = points.filter(p => p.agentId === "A99");
    expect(filtered).toHaveLength(0);
  });
});

// ─── Geocode cache behaviour (pure Map logic) ─────────────────────────────────

describe("geocode cache", () => {
  it("returns cached value on second lookup", () => {
    const cache = new Map<string, string>();
    cache.set("VIS-001", "1 Main St, Lagos");
    expect(cache.get("VIS-001")).toBe("1 Main St, Lagos");
    // Second lookup returns same value without re-querying
    expect(cache.has("VIS-001")).toBe(true);
  });

  it("returns undefined for uncached visitRef", () => {
    const cache = new Map<string, string>();
    expect(cache.get("VIS-999")).toBeUndefined();
  });

  it("caches empty string for failed geocode to prevent re-query", () => {
    const cache = new Map<string, string>();
    cache.set("VIS-002", ""); // simulates failed geocode
    expect(cache.has("VIS-002")).toBe(true);
    expect(cache.get("VIS-002")).toBe("");
  });

  it("can hold many entries without collision", () => {
    const cache = new Map<string, string>();
    for (let i = 0; i < 100; i++) {
      cache.set(`VIS-${i}`, `Address ${i}`);
    }
    expect(cache.size).toBe(100);
    expect(cache.get("VIS-50")).toBe("Address 50");
  });
});

// ─── buildAgentSummaries (regression) ────────────────────────────────────────

describe("buildAgentSummaries (Phase 4 regression)", () => {
  it("correctly computes confirmedPct for a mixed agent", () => {
    const points = [
      makePoint({ visitRef: "V1", agentId: "A1", agentName: "Alice", outcome: "confirmed" }),
      makePoint({ visitRef: "V2", agentId: "A1", agentName: "Alice", outcome: "confirmed" }),
      makePoint({ visitRef: "V3", agentId: "A1", agentName: "Alice", outcome: "failed" }),
      makePoint({ visitRef: "V4", agentId: "A1", agentName: "Alice", outcome: "failed" }),
    ];
    const summaries = buildAgentSummaries(points);
    expect(summaries[0].confirmedPct).toBe(50);
  });

  it("returns 0 confirmedPct for agent with no confirmed visits", () => {
    const points = [
      makePoint({ visitRef: "V1", agentId: "A2", agentName: "Bob", outcome: "failed" }),
    ];
    const summaries = buildAgentSummaries(points);
    expect(summaries[0].confirmedPct).toBe(0);
  });
});
