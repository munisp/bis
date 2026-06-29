// field-visit.phase3.test.ts
// Tests for Phase 3 helpers: buildAgentSummaries, sortByCreatedAt, sliceUpTo

import { describe, it, expect } from 'vitest';

// ─── Inline copies of the helpers (mirrors FieldVisitMapPage.tsx) ─────────────

type VisitPoint = {
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

type AgentSummary = {
  agentId: string;
  agentName: string;
  total: number;
  confirmed: number;
  confirmedPct: number;
  avgDuration: number;
  weeklyFrequency: number[];
};

function buildAgentSummaries(points: VisitPoint[]): AgentSummary[] {
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
      const confirmed = visits.filter(v => v.outcome === 'confirmed').length;
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

function sortByCreatedAt(points: VisitPoint[]): VisitPoint[] {
  return [...points].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function sliceUpTo(sorted: VisitPoint[], index: number): VisitPoint[] {
  return sorted.slice(0, index + 1);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let _seq = 0;
const makePoint = (overrides: Partial<VisitPoint> = {}): VisitPoint => ({
  visitRef: `VR-${++_seq}`,
  taskRef: 'FT-001',
  agentId: 'agent-1',
  agentName: 'Emeka Obi',
  investigationId: null,
  checkInLat: 6.5244,
  checkInLng: 3.3792,
  checkOutLat: null,
  checkOutLng: null,
  outcome: 'confirmed',
  subjectPresent: true,
  addressConfirmed: true,
  findings: null,
  durationMinutes: 30,
  submittedAt: null,
  createdAt: new Date('2025-03-01T10:00:00Z'),
  ...overrides,
});

// ─── buildAgentSummaries tests ────────────────────────────────────────────────

describe('buildAgentSummaries', () => {
  it('returns empty array for empty input', () => {
    expect(buildAgentSummaries([])).toEqual([]);
  });

  it('returns one summary per unique agentId', () => {
    const points = [
      makePoint({ agentId: 'a1', agentName: 'Alice' }),
      makePoint({ agentId: 'a2', agentName: 'Bob' }),
      makePoint({ agentId: 'a1', agentName: 'Alice' }),
    ];
    const summaries = buildAgentSummaries(points);
    expect(summaries).toHaveLength(2);
  });

  it('counts total visits correctly', () => {
    const points = [
      makePoint({ agentId: 'a1' }),
      makePoint({ agentId: 'a1' }),
      makePoint({ agentId: 'a1' }),
    ];
    const [s] = buildAgentSummaries(points);
    expect(s.total).toBe(3);
  });

  it('counts confirmed visits correctly', () => {
    const points = [
      makePoint({ agentId: 'a1', outcome: 'confirmed' }),
      makePoint({ agentId: 'a1', outcome: 'confirmed' }),
      makePoint({ agentId: 'a1', outcome: 'failed' }),
    ];
    const [s] = buildAgentSummaries(points);
    expect(s.confirmed).toBe(2);
  });

  it('calculates confirmedPct as a rounded percentage', () => {
    const points = [
      makePoint({ agentId: 'a1', outcome: 'confirmed' }),
      makePoint({ agentId: 'a1', outcome: 'confirmed' }),
      makePoint({ agentId: 'a1', outcome: 'failed' }),
    ];
    const [s] = buildAgentSummaries(points);
    expect(s.confirmedPct).toBe(67); // 2/3 = 66.7 → rounded to 67
  });

  it('returns confirmedPct of 0 when no confirmed visits', () => {
    const points = [makePoint({ agentId: 'a1', outcome: 'failed' })];
    const [s] = buildAgentSummaries(points);
    expect(s.confirmedPct).toBe(0);
  });

  it('returns confirmedPct of 100 when all confirmed', () => {
    const points = [
      makePoint({ agentId: 'a1', outcome: 'confirmed' }),
      makePoint({ agentId: 'a1', outcome: 'confirmed' }),
    ];
    const [s] = buildAgentSummaries(points);
    expect(s.confirmedPct).toBe(100);
  });

  it('calculates avgDuration correctly', () => {
    const points = [
      makePoint({ agentId: 'a1', durationMinutes: 20 }),
      makePoint({ agentId: 'a1', durationMinutes: 40 }),
    ];
    const [s] = buildAgentSummaries(points);
    expect(s.avgDuration).toBe(30);
  });

  it('excludes null durationMinutes from avgDuration calculation', () => {
    const points = [
      makePoint({ agentId: 'a1', durationMinutes: 60 }),
      makePoint({ agentId: 'a1', durationMinutes: null }),
    ];
    const [s] = buildAgentSummaries(points);
    expect(s.avgDuration).toBe(60);
  });

  it('returns avgDuration of 0 when all durations are null', () => {
    const points = [makePoint({ agentId: 'a1', durationMinutes: null })];
    const [s] = buildAgentSummaries(points);
    expect(s.avgDuration).toBe(0);
  });

  it('weeklyFrequency has exactly 8 elements', () => {
    const [s] = buildAgentSummaries([makePoint({ agentId: 'a1' })]);
    expect(s.weeklyFrequency).toHaveLength(8);
  });

  it('sorts summaries by total visits descending', () => {
    const points = [
      makePoint({ agentId: 'a1' }),
      makePoint({ agentId: 'a2' }),
      makePoint({ agentId: 'a2' }),
      makePoint({ agentId: 'a3' }),
      makePoint({ agentId: 'a3' }),
      makePoint({ agentId: 'a3' }),
    ];
    const summaries = buildAgentSummaries(points);
    expect(summaries[0].agentId).toBe('a3');
    expect(summaries[1].agentId).toBe('a2');
    expect(summaries[2].agentId).toBe('a1');
  });

  it('preserves agentName from first visit', () => {
    const points = [makePoint({ agentId: 'a1', agentName: 'Ngozi Adeyemi' })];
    const [s] = buildAgentSummaries(points);
    expect(s.agentName).toBe('Ngozi Adeyemi');
  });

  it('all weeklyFrequency values are non-negative integers', () => {
    const [s] = buildAgentSummaries([makePoint({ agentId: 'a1' })]);
    for (const v of s.weeklyFrequency) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

// ─── sortByCreatedAt tests ────────────────────────────────────────────────────

describe('sortByCreatedAt', () => {
  it('returns empty array for empty input', () => {
    expect(sortByCreatedAt([])).toEqual([]);
  });

  it('returns single-element array unchanged', () => {
    const p = makePoint();
    const result = sortByCreatedAt([p]);
    expect(result).toHaveLength(1);
    expect(result[0].visitRef).toBe(p.visitRef);
  });

  it('sorts two points in ascending order', () => {
    const early = makePoint({ createdAt: new Date('2025-01-01T00:00:00Z') });
    const late  = makePoint({ createdAt: new Date('2025-06-01T00:00:00Z') });
    const result = sortByCreatedAt([late, early]);
    expect(result[0].createdAt.getTime()).toBeLessThan(result[1].createdAt.getTime());
  });

  it('sorts multiple points in ascending order', () => {
    const dates = ['2025-03-01', '2025-01-01', '2025-06-01', '2025-02-01'];
    const points = dates.map(d => makePoint({ createdAt: new Date(d) }));
    const sorted = sortByCreatedAt(points);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1].createdAt.getTime()).toBeLessThanOrEqual(sorted[i].createdAt.getTime());
    }
  });

  it('does not mutate the original array', () => {
    const p1 = makePoint({ createdAt: new Date('2025-06-01') });
    const p2 = makePoint({ createdAt: new Date('2025-01-01') });
    const original = [p1, p2];
    sortByCreatedAt(original);
    expect(original[0].visitRef).toBe(p1.visitRef); // unchanged
  });

  it('handles equal timestamps without throwing', () => {
    const ts = new Date('2025-04-01T12:00:00Z');
    const points = [makePoint({ createdAt: ts }), makePoint({ createdAt: ts })];
    expect(() => sortByCreatedAt(points)).not.toThrow();
  });
});

// ─── sliceUpTo tests ──────────────────────────────────────────────────────────

describe('sliceUpTo', () => {
  const sorted = [
    makePoint({ visitRef: 'VR-A', createdAt: new Date('2025-01-01') }),
    makePoint({ visitRef: 'VR-B', createdAt: new Date('2025-02-01') }),
    makePoint({ visitRef: 'VR-C', createdAt: new Date('2025-03-01') }),
    makePoint({ visitRef: 'VR-D', createdAt: new Date('2025-04-01') }),
  ];

  it('returns first element when index is 0', () => {
    const result = sliceUpTo(sorted, 0);
    expect(result).toHaveLength(1);
    expect(result[0].visitRef).toBe('VR-A');
  });

  it('returns first two elements when index is 1', () => {
    const result = sliceUpTo(sorted, 1);
    expect(result).toHaveLength(2);
    expect(result[1].visitRef).toBe('VR-B');
  });

  it('returns all elements when index equals length - 1', () => {
    const result = sliceUpTo(sorted, sorted.length - 1);
    expect(result).toHaveLength(sorted.length);
  });

  it('returns empty array for empty input at index 0', () => {
    expect(sliceUpTo([], 0)).toEqual([]);
  });

  it('does not mutate the original array', () => {
    const copy = [...sorted];
    sliceUpTo(sorted, 2);
    expect(sorted).toHaveLength(copy.length);
  });

  it('preserves order of elements in the slice', () => {
    const result = sliceUpTo(sorted, 2);
    expect(result.map(p => p.visitRef)).toEqual(['VR-A', 'VR-B', 'VR-C']);
  });

  it('handles index beyond array length gracefully (returns full array)', () => {
    const result = sliceUpTo(sorted, 100);
    expect(result).toHaveLength(sorted.length);
  });
});
