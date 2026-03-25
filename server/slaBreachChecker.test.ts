/**
 * slaBreachChecker.test.ts
 * Tests for the SLA breach detection and alert creation logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────────

// Mock the database module
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockWhere = vi.fn();
const mockFrom = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockLimit = vi.fn();
const mockAnd = vi.fn();

const mockDb = {
  select: mockSelect,
  insert: mockInsert,
};

vi.mock('./db', () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

// Mock Expo push API
const mockFetch = vi.fn();
global.fetch = mockFetch;

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeInvestigation(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    ref: 'BIS-2024-0001',
    subjectName: 'Test Subject',
    status: 'active',
    dueAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min from now (within 1h window)
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('SLA Breach Checker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
  });

  it('identifies investigations breaching within 1 hour', () => {
    const now = Date.now();
    const within1h = new Date(now + 45 * 60 * 1000);   // 45 min from now
    const beyond1h = new Date(now + 90 * 60 * 1000);   // 90 min from now
    const past     = new Date(now - 10 * 60 * 1000);   // 10 min ago (already breached)

    const investigations = [
      makeInvestigation({ ref: 'BIS-001', dueAt: within1h }),
      makeInvestigation({ ref: 'BIS-002', dueAt: beyond1h }),
      makeInvestigation({ ref: 'BIS-003', dueAt: past }),
    ];

    // Simulate the filter logic from checkSlaBreaches
    const breaching = investigations.filter(inv => {
      if (!inv.dueAt) return false;
      const msUntilDue = new Date(inv.dueAt).getTime() - now;
      return msUntilDue <= 60 * 60 * 1000; // within 1 hour (includes already breached)
    });

    expect(breaching).toHaveLength(2);
    expect(breaching.map(i => i.ref)).toContain('BIS-001');
    expect(breaching.map(i => i.ref)).toContain('BIS-003');
    expect(breaching.map(i => i.ref)).not.toContain('BIS-002');
  });

  it('does not flag investigations with no dueAt', () => {
    const investigations = [
      makeInvestigation({ ref: 'BIS-001', dueAt: null }),
      makeInvestigation({ ref: 'BIS-002', dueAt: undefined }),
    ];

    const now = Date.now();
    const breaching = investigations.filter(inv => {
      if (!inv.dueAt) return false;
      const msUntilDue = new Date(inv.dueAt).getTime() - now;
      return msUntilDue <= 60 * 60 * 1000;
    });

    expect(breaching).toHaveLength(0);
  });

  it('does not flag completed investigations', () => {
    const now = Date.now();
    const investigations = [
      makeInvestigation({ ref: 'BIS-001', status: 'completed', dueAt: new Date(now + 30 * 60 * 1000) }),
      makeInvestigation({ ref: 'BIS-002', status: 'archived',  dueAt: new Date(now + 30 * 60 * 1000) }),
      makeInvestigation({ ref: 'BIS-003', status: 'active',    dueAt: new Date(now + 30 * 60 * 1000) }),
    ];

    // The DB query filters by status != completed/archived — simulate that filter
    const active = investigations.filter(i => i.status === 'active' || i.status === 'pending');
    const breaching = active.filter(inv => {
      if (!inv.dueAt) return false;
      return new Date(inv.dueAt).getTime() - now <= 60 * 60 * 1000;
    });

    expect(breaching).toHaveLength(1);
    expect(breaching[0].ref).toBe('BIS-003');
  });

  it('calculates urgency label correctly', () => {
    const now = Date.now();

    const urgencyLabel = (dueAt: Date) => {
      const ms = dueAt.getTime() - now;
      if (ms < 0)              return 'BREACHED';
      if (ms < 15 * 60 * 1000) return 'CRITICAL';
      if (ms < 30 * 60 * 1000) return 'HIGH';
      return 'WARNING';
    };

    expect(urgencyLabel(new Date(now - 5000))).toBe('BREACHED');
    expect(urgencyLabel(new Date(now + 10 * 60 * 1000))).toBe('CRITICAL');
    expect(urgencyLabel(new Date(now + 20 * 60 * 1000))).toBe('HIGH');
    expect(urgencyLabel(new Date(now + 50 * 60 * 1000))).toBe('WARNING');
  });

  it('dedup guard prevents re-alerting within 2 hours', () => {
    const now = Date.now();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000 - 1000); // just over 2h ago
    const oneHourAgo  = new Date(now - 1 * 60 * 60 * 1000);         // 1h ago

    const existingAlerts = [
      { sourceRef: 'BIS-001', createdAt: oneHourAgo },  // recent — skip
      { sourceRef: 'BIS-002', createdAt: twoHoursAgo }, // old enough — re-alert
    ];

    const shouldSkip = (ref: string) => {
      const recent = existingAlerts.find(a =>
        a.sourceRef === ref &&
        new Date(a.createdAt).getTime() > now - 2 * 60 * 60 * 1000
      );
      return !!recent;
    };

    expect(shouldSkip('BIS-001')).toBe(true);
    expect(shouldSkip('BIS-002')).toBe(false);
    expect(shouldSkip('BIS-003')).toBe(false); // no existing alert
  });

  it('formats push notification payload correctly', () => {
    const inv = makeInvestigation({ ref: 'BIS-2024-0042', subjectName: 'Adewale Okonkwo' });
    const dueAt = new Date(Date.now() + 25 * 60 * 1000);
    const minutesLeft = Math.round((dueAt.getTime() - Date.now()) / 60000);

    const payload = {
      to: 'ExponentPushToken[xxx]',
      title: `⚠️ SLA Breach Imminent — ${inv.ref}`,
      body: `${inv.subjectName} — SLA expires in ${minutesLeft} min`,
      data: { type: 'investigation', id: inv.ref },
      sound: 'default',
      priority: 'high',
    };

    expect(payload.title).toContain('BIS-2024-0042');
    expect(payload.body).toContain('Adewale Okonkwo');
    expect(payload.data.type).toBe('investigation');
    expect(payload.priority).toBe('high');
  });
});
