/**
 * Pure helper functions for FieldVisitMapPage.
 * Kept in a separate file so server-side vitest can import them
 * without pulling in the React component tree.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type VisitPoint = {
  visitRef: string;
  taskRef: string;
  agentId: string;
  agentName: string;
  investigationId: number | null;
  checkInLat: number | null;
  checkInLng: number | null;
  checkOutLat: number | null;
  checkOutLng: number | null;
  outcome: string | null;
  subjectPresent: boolean | null;
  addressConfirmed: boolean | null;
  findings: string | null;
  durationMinutes: number | null;
  submittedAt: Date | null;
  createdAt: Date;
};

export type AgentSummary = {
  agentId: string;
  agentName: string;
  total: number;
  confirmed: number;
  confirmedPct: number;
  avgDuration: number;
  weeklyFrequency: number[];
};

export type StateDensity = {
  stateName: string;
  count: number;
};

// ─── Choropleth density helpers ───────────────────────────────────────────────

/**
 * Compute visit counts per Nigerian state using pre-computed state labels.
 * @param points - All visit points
 * @param stateLabels - Map from visitRef to resolved state name
 */
export function computeStateDensity(
  points: VisitPoint[],
  stateLabels: Map<string, string>
): StateDensity[] {
  const counts = new Map<string, number>();
  for (const p of points) {
    const state = stateLabels.get(p.visitRef);
    if (!state) continue;
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([stateName, count]) => ({ stateName, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Map a density value to a choropleth fill colour (indigo gradient).
 * Returns an rgba string.
 */
export function densityToColor(count: number, maxCount: number): string {
  if (maxCount === 0) return "rgba(99,102,241,0.08)";
  const ratio = count / maxCount;
  const alpha = 0.08 + ratio * 0.72;
  const r = Math.round(99 - ratio * 60);
  const g = Math.round(102 - ratio * 70);
  const b = Math.round(241 - ratio * 40);
  return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
}

// ─── Agent summary helpers ────────────────────────────────────────────────────

export function buildAgentSummaries(points: VisitPoint[]): AgentSummary[] {
  const now = Date.now();
  const agentMap = new Map<string, VisitPoint[]>();
  for (const p of points) {
    const arr = agentMap.get(p.agentId) ?? [];
    arr.push(p);
    agentMap.set(p.agentId, arr);
  }

  return Array.from(agentMap.entries())
    .map(([agentId, visits]) => {
      const total = visits.length;
      const confirmed = visits.filter(v => v.outcome === "confirmed").length;
      const confirmedPct = total > 0 ? Math.round((confirmed / total) * 100) : 0;
      const durRows = visits.filter(v => v.durationMinutes != null);
      const avgDuration = durRows.length > 0
        ? Math.round(durRows.reduce((s, v) => s + (v.durationMinutes ?? 0), 0) / durRows.length)
        : 0;

      const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
      const weeklyFrequency = Array.from({ length: 8 }, (_, i) => {
        const weekStart = now - (8 - i) * WEEK_MS;
        const weekEnd = weekStart + WEEK_MS;
        return visits.filter(v => {
          const t = new Date(v.createdAt).getTime();
          return t >= weekStart && t < weekEnd;
        }).length;
      });

      return { agentId, agentName: visits[0].agentName, total, confirmed, confirmedPct, avgDuration, weeklyFrequency };
    })
    .sort((a, b) => b.total - a.total);
}

// ─── Time-lapse helpers ───────────────────────────────────────────────────────

export function sortByCreatedAt(points: VisitPoint[]): VisitPoint[] {
  return [...points].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export function sliceUpTo(sorted: VisitPoint[], index: number): VisitPoint[] {
  return sorted.slice(0, index + 1);
}

// ─── Export helpers ───────────────────────────────────────────────────────────

export function toGeoJSON(points: VisitPoint[]): string {
  const features = points
    .filter(p => p.checkInLat != null && p.checkInLng != null)
    .map(p => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.checkInLng!, p.checkInLat!] },
      properties: {
        visitRef: p.visitRef,
        taskRef: p.taskRef,
        agentId: p.agentId,
        agentName: p.agentName,
        outcome: p.outcome,
        subjectPresent: p.subjectPresent,
        addressConfirmed: p.addressConfirmed,
        durationMinutes: p.durationMinutes,
        findings: p.findings,
        submittedAt: p.submittedAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      },
    }));
  return JSON.stringify({ type: "FeatureCollection", features }, null, 2);
}

export function toCSV(points: VisitPoint[]): string {
  const header = [
    "visitRef","taskRef","agentId","agentName",
    "checkInLat","checkInLng","checkOutLat","checkOutLng",
    "outcome","subjectPresent","addressConfirmed",
    "durationMinutes","findings","submittedAt","createdAt",
  ].join(",");
  const rows = points.map(p => [
    p.visitRef,
    p.taskRef,
    p.agentId,
    `"${p.agentName.replace(/"/g, '""')}"`,
    p.checkInLat ?? "",
    p.checkInLng ?? "",
    p.checkOutLat ?? "",
    p.checkOutLng ?? "",
    p.outcome ?? "",
    p.subjectPresent == null ? "" : p.subjectPresent ? "true" : "false",
    p.addressConfirmed == null ? "" : p.addressConfirmed ? "true" : "false",
    p.durationMinutes ?? "",
    `"${(p.findings ?? "").replace(/"/g, '""')}"`,
    p.submittedAt?.toISOString() ?? "",
    p.createdAt.toISOString(),
  ].join(","));
  return [header, ...rows].join("\n");
}
