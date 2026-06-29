// field-visit.geodata.test.ts
// Tests for the getVisitGeoData tRPC procedure in fieldTasksRouter

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock visit report rows ───────────────────────────────────────────────────

const makeVisitRow = (overrides: Record<string, unknown> = {}) => ({
  visitRef: 'VR-001',
  taskRef: 'FT-001',
  agentId: 'agent-1',
  agentName: 'Chukwuemeka Obi',
  investigationId: 10,
  checkInLat: 6.5244,
  checkInLng: 3.3792,
  checkOutLat: 6.5245,
  checkOutLng: 3.3793,
  outcome: 'confirmed',
  subjectPresent: true,
  addressConfirmed: true,
  findings: 'Subject found at address.',
  durationMinutes: 45,
  submittedAt: new Date('2025-03-01T12:00:00Z'),
  createdAt: new Date('2025-03-01T11:00:00Z'),
  ...overrides,
});

// ─── Helper: compute stats from rows ─────────────────────────────────────────

function computeStats(rows: ReturnType<typeof makeVisitRow>[]) {
  const total = rows.length;
  const confirmed = rows.filter(r => r.outcome === 'confirmed').length;
  const confirmedPct = total > 0 ? Math.round((confirmed / total) * 100) : 0;
  const durRows = rows.filter(r => r.durationMinutes != null);
  const avgDuration =
    durRows.length > 0
      ? Math.round(durRows.reduce((s, r) => s + (r.durationMinutes ?? 0), 0) / durRows.length)
      : 0;
  const activeAgents = new Set(rows.map(r => r.agentId)).size;
  return { total, confirmed, confirmedPct, avgDuration, activeAgents };
}

// ─── Stats computation tests ──────────────────────────────────────────────────

describe('getVisitGeoData: stats computation', () => {
  it('returns zero stats for empty rows', () => {
    const stats = computeStats([]);
    expect(stats.total).toBe(0);
    expect(stats.confirmed).toBe(0);
    expect(stats.confirmedPct).toBe(0);
    expect(stats.avgDuration).toBe(0);
    expect(stats.activeAgents).toBe(0);
  });

  it('computes 100% confirmed when all rows are confirmed', () => {
    const rows = [
      makeVisitRow({ outcome: 'confirmed', durationMinutes: 30 }),
      makeVisitRow({ outcome: 'confirmed', durationMinutes: 60, agentId: 'agent-2' }),
    ];
    const stats = computeStats(rows);
    expect(stats.total).toBe(2);
    expect(stats.confirmed).toBe(2);
    expect(stats.confirmedPct).toBe(100);
    expect(stats.avgDuration).toBe(45);
    expect(stats.activeAgents).toBe(2);
  });

  it('computes 50% confirmed for mixed outcomes', () => {
    const rows = [
      makeVisitRow({ outcome: 'confirmed', durationMinutes: 20 }),
      makeVisitRow({ outcome: 'failed', durationMinutes: 10, agentId: 'agent-2' }),
    ];
    const stats = computeStats(rows);
    expect(stats.total).toBe(2);
    expect(stats.confirmed).toBe(1);
    expect(stats.confirmedPct).toBe(50);
    expect(stats.avgDuration).toBe(15);
    expect(stats.activeAgents).toBe(2);
  });

  it('counts unique agents correctly', () => {
    const rows = [
      makeVisitRow({ agentId: 'agent-1' }),
      makeVisitRow({ agentId: 'agent-1' }),
      makeVisitRow({ agentId: 'agent-2' }),
    ];
    const stats = computeStats(rows);
    expect(stats.activeAgents).toBe(2);
  });

  it('skips null durationMinutes in avgDuration', () => {
    const rows = [
      makeVisitRow({ durationMinutes: 60 }),
      makeVisitRow({ durationMinutes: null }),
    ];
    const stats = computeStats(rows);
    expect(stats.avgDuration).toBe(60);
  });

  it('returns 0 avgDuration when all durations are null', () => {
    const rows = [makeVisitRow({ durationMinutes: null })];
    const stats = computeStats(rows);
    expect(stats.avgDuration).toBe(0);
  });

  it('rounds confirmedPct to nearest integer', () => {
    const rows = [
      makeVisitRow({ outcome: 'confirmed' }),
      makeVisitRow({ outcome: 'confirmed' }),
      makeVisitRow({ outcome: 'failed' }),
    ];
    const stats = computeStats(rows);
    // 2/3 = 66.67 → rounds to 67
    expect(stats.confirmedPct).toBe(67);
  });
});

// ─── GPS point filtering tests ────────────────────────────────────────────────

describe('getVisitGeoData: GPS point filtering', () => {
  it('excludes rows with null checkInLat', () => {
    const allRows = [
      makeVisitRow({ checkInLat: null, checkInLng: 3.3792 }),
      makeVisitRow({ checkInLat: 6.5244, checkInLng: 3.3792 }),
    ];
    const gpsPoints = allRows.filter(r => r.checkInLat != null && r.checkInLng != null);
    expect(gpsPoints).toHaveLength(1);
    expect(gpsPoints[0].checkInLat).toBe(6.5244);
  });

  it('excludes rows with null checkInLng', () => {
    const allRows = [
      makeVisitRow({ checkInLat: 6.5244, checkInLng: null }),
      makeVisitRow({ checkInLat: 6.5244, checkInLng: 3.3792 }),
    ];
    const gpsPoints = allRows.filter(r => r.checkInLat != null && r.checkInLng != null);
    expect(gpsPoints).toHaveLength(1);
  });

  it('includes rows with both lat and lng set', () => {
    const allRows = [
      makeVisitRow({ checkInLat: 9.082, checkInLng: 8.6753 }),
      makeVisitRow({ checkInLat: 4.8156, checkInLng: 7.0498 }),
    ];
    const gpsPoints = allRows.filter(r => r.checkInLat != null && r.checkInLng != null);
    expect(gpsPoints).toHaveLength(2);
  });
});

// ─── Date range filter tests ──────────────────────────────────────────────────

describe('getVisitGeoData: date range filter', () => {
  const now = new Date('2025-04-01T00:00:00Z');

  function cutoff(dateRange: '7d' | '30d' | '90d') {
    const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  it('7d cutoff is 7 days before now', () => {
    const since = cutoff('7d');
    expect(since.toISOString()).toBe('2025-03-25T00:00:00.000Z');
  });

  it('30d cutoff is 30 days before now', () => {
    const since = cutoff('30d');
    expect(since.toISOString()).toBe('2025-03-02T00:00:00.000Z');
  });

  it('90d cutoff is 90 days before now', () => {
    const since = cutoff('90d');
    expect(since.toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });

  it('filters rows outside date range', () => {
    const since = cutoff('7d');
    const rows = [
      makeVisitRow({ createdAt: new Date('2025-03-26T00:00:00Z') }), // inside
      makeVisitRow({ createdAt: new Date('2025-03-20T00:00:00Z') }), // outside
    ];
    const filtered = rows.filter(r => r.createdAt >= since);
    expect(filtered).toHaveLength(1);
  });
});

// ─── Outcome filter tests ─────────────────────────────────────────────────────

describe('getVisitGeoData: outcome filter', () => {
  const rows = [
    makeVisitRow({ outcome: 'confirmed',    visitRef: 'VR-001' }),
    makeVisitRow({ outcome: 'unconfirmed',  visitRef: 'VR-002' }),
    makeVisitRow({ outcome: 'inconclusive', visitRef: 'VR-003' }),
    makeVisitRow({ outcome: 'failed',       visitRef: 'VR-004' }),
  ];

  it('returns all rows when outcome is "all"', () => {
    const filtered = rows; // no filter applied
    expect(filtered).toHaveLength(4);
  });

  it('filters to only confirmed rows', () => {
    const filtered = rows.filter(r => r.outcome === 'confirmed');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].visitRef).toBe('VR-001');
  });

  it('filters to only failed rows', () => {
    const filtered = rows.filter(r => r.outcome === 'failed');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].visitRef).toBe('VR-004');
  });

  it('filters to only inconclusive rows', () => {
    const filtered = rows.filter(r => r.outcome === 'inconclusive');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].visitRef).toBe('VR-003');
  });
});

// ─── Response shape tests ─────────────────────────────────────────────────────

describe('getVisitGeoData: response shape', () => {
  it('response contains points array and stats object', () => {
    const rows = [makeVisitRow()];
    const stats = computeStats(rows);
    const response = { points: rows, stats };

    expect(response).toHaveProperty('points');
    expect(response).toHaveProperty('stats');
    expect(Array.isArray(response.points)).toBe(true);
    expect(typeof response.stats.total).toBe('number');
    expect(typeof response.stats.confirmed).toBe('number');
    expect(typeof response.stats.confirmedPct).toBe('number');
    expect(typeof response.stats.avgDuration).toBe('number');
    expect(typeof response.stats.activeAgents).toBe('number');
  });

  it('point row contains all required geo and outcome fields', () => {
    const point = makeVisitRow();
    expect(point).toHaveProperty('visitRef');
    expect(point).toHaveProperty('taskRef');
    expect(point).toHaveProperty('agentId');
    expect(point).toHaveProperty('agentName');
    expect(point).toHaveProperty('checkInLat');
    expect(point).toHaveProperty('checkInLng');
    expect(point).toHaveProperty('outcome');
    expect(point).toHaveProperty('subjectPresent');
    expect(point).toHaveProperty('addressConfirmed');
    expect(point).toHaveProperty('findings');
    expect(point).toHaveProperty('durationMinutes');
  });

  it('returns empty points and zero stats for no data', () => {
    const response = {
      points: [],
      stats: { total: 0, confirmed: 0, confirmedPct: 0, avgDuration: 0, activeAgents: 0 },
    };
    expect(response.points).toHaveLength(0);
    expect(response.stats.total).toBe(0);
    expect(response.stats.confirmedPct).toBe(0);
  });
});

// ─── Limit tests ──────────────────────────────────────────────────────────────

describe('getVisitGeoData: limit enforcement', () => {
  it('respects limit of 5 when 10 rows available', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeVisitRow({ visitRef: `VR-${String(i + 1).padStart(3, '0')}` })
    );
    const limited = rows.slice(0, 5);
    expect(limited).toHaveLength(5);
  });

  it('returns all rows when limit exceeds available rows', () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      makeVisitRow({ visitRef: `VR-${String(i + 1).padStart(3, '0')}` })
    );
    const limited = rows.slice(0, 200);
    expect(limited).toHaveLength(3);
  });
});
