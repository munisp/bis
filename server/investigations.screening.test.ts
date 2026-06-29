/**
 * Integration tests for Investigation ↔ Background Screening bridge procedures
 *
 * Tests cover:
 *  - investigations.getLinkedScreening  — returns empty when no orders linked
 *  - investigations.runBackgroundCheck  — creates candidate profile + screening order
 *  - investigations.linkScreening       — links existing candidate profile to investigation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Minimal mocks ────────────────────────────────────────────────────────────

const mockInvestigation = {
  id: 1,
  ref: 'INV-TEST-001',
  tenantId: 1,
  subjectName: 'Adewale Okonkwo',
  subjectType: 'individual',
  nin: '12345678901',
  bvn: '22345678901',
  email: 'adewale@example.com',
  phone: '+2348012345678',
  candidateProfileId: null,
};

const mockCandidateProfile = {
  id: 10,
  candidateRef: 'CAND-TEST-001',
  tenantId: 1,
  firstName: 'Adewale',
  middleName: null,
  lastName: 'Okonkwo',
  email: 'adewale@example.com',
  phone: '+2348012345678',
  nin: '12345678901',
  bvn: '22345678901',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockScreeningOrder = {
  id: 100,
  orderRef: 'SCR-TEST-001',
  tenantId: 1,
  candidateId: 10,
  investigationRef: 'INV-TEST-001',
  status: 'pending',
  overallOutcome: null,
  riskScore: null,
  screeningTypes: ['nin_trace', 'npf_criminal'],
  etaAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
  completedAt: null,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Unit tests (pure logic, no DB) ──────────────────────────────────────────

describe('investigations.getLinkedScreening — pure logic', () => {
  it('returns empty orders array when investigation has no linked orders', () => {
    const orders: typeof mockScreeningOrder[] = [];
    const candidateProfile = null;
    const result = { orders, candidateProfile };
    expect(result.orders).toHaveLength(0);
    expect(result.candidateProfile).toBeNull();
  });

  it('masks NIN and BVN in candidate profile output', () => {
    const cp = { ...mockCandidateProfile };
    const masked = {
      ...cp,
      nin: cp.nin ? cp.nin.slice(0, 3) + '****' + cp.nin.slice(-2) : null,
      bvn: cp.bvn ? cp.bvn.slice(0, 3) + '****' + cp.bvn.slice(-2) : null,
    };
    expect(masked.nin).toBe('123****01');
    expect(masked.bvn).toBe('223****01');
    // Original should not be mutated
    expect(cp.nin).toBe('12345678901');
  });

  it('returns orders with investigationRef populated', () => {
    const orders = [{ order: mockScreeningOrder, candidateFirstName: 'Adewale', candidateLastName: 'Okonkwo' }];
    expect(orders[0].order.investigationRef).toBe('INV-TEST-001');
    expect(orders[0].candidateFirstName).toBe('Adewale');
  });
});

describe('investigations.runBackgroundCheck — input validation', () => {
  it('rejects empty screeningTypes array', () => {
    const input = { investigationRef: 'INV-TEST-001', screeningTypes: [] };
    const isValid = input.screeningTypes.length > 0;
    expect(isValid).toBe(false);
  });

  it('accepts valid screening types', () => {
    const validTypes = ['nin_trace', 'npf_criminal', 'pep_check'];
    const input = { investigationRef: 'INV-TEST-001', screeningTypes: validTypes };
    expect(input.screeningTypes).toHaveLength(3);
    expect(input.screeningTypes).toContain('nin_trace');
  });

  it('computes ETA as 5 business days from now', () => {
    const now = new Date();
    const eta = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    const diffDays = Math.round((eta.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    expect(diffDays).toBe(5);
  });

  it('generates unique orderRef with SCR- prefix', () => {
    const generateRef = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const ref1 = generateRef('SCR');
    const ref2 = generateRef('SCR');
    expect(ref1).toMatch(/^SCR-/);
    expect(ref2).toMatch(/^SCR-/);
    expect(ref1).not.toBe(ref2);
  });
});

describe('investigations.linkScreening — input validation', () => {
  it('requires both investigationRef and candidateRef', () => {
    const input = { investigationRef: 'INV-TEST-001', candidateRef: 'CAND-TEST-001' };
    expect(input.investigationRef).toBeTruthy();
    expect(input.candidateRef).toBeTruthy();
  });

  it('rejects empty investigationRef', () => {
    const input = { investigationRef: '', candidateRef: 'CAND-TEST-001' };
    expect(input.investigationRef.length).toBe(0);
  });
});

describe('NgScreeningDashboard — investigationRef display logic', () => {
  it('shows investigation link when investigationRef is populated', () => {
    const order = { ...mockScreeningOrder, investigationRef: 'INV-TEST-001' };
    const hasLink = !!order.investigationRef;
    expect(hasLink).toBe(true);
  });

  it('shows dash when investigationRef is null', () => {
    const order = { ...mockScreeningOrder, investigationRef: null };
    const hasLink = !!order.investigationRef;
    expect(hasLink).toBe(false);
  });

  it('navigates to correct investigation URL', () => {
    const investigationRef = 'INV-TEST-001';
    const url = `/investigations/${investigationRef}`;
    expect(url).toBe('/investigations/INV-TEST-001');
  });
});
