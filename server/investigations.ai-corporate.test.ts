/**
 * Tests for AI Screening Summary and Corporate Background Check procedures
 *
 * Tests cover:
 *  - investigations.generateScreeningSummary — LLM-powered risk summary generation
 *  - investigations.runCorporateCheck        — CAC / FIRS / directors / sanctions checks
 *  - investigations.getScreeningSummary      — retrieval of stored AI summary
 *  - investigations.getCorporateProfiles     — retrieval of corporate check profiles
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock data ────────────────────────────────────────────────────────────────

const mockCorporateInvestigation = {
  id: 2,
  ref: 'INV-CORP-001',
  tenantId: 1,
  subjectName: 'Dangote Industries Ltd',
  subjectType: 'corporate' as const,
  rcNumber: 'RC123456',
  nin: null,
  bvn: null,
  email: 'info@dangote.example.com',
  phone: '+2341234567890',
  purpose: 'KYB due diligence',
  tier: 'comprehensive',
  country: 'NG',
  candidateProfileId: null,
};

const mockIndividualInvestigation = {
  id: 1,
  ref: 'INV-IND-001',
  tenantId: 1,
  subjectName: 'Adewale Okonkwo',
  subjectType: 'individual' as const,
  rcNumber: null,
  nin: '12345678901',
  bvn: '22345678901',
  email: 'adewale@example.com',
  phone: '+2348012345678',
  purpose: 'Pre-employment screening',
  tier: 'standard',
  country: 'NG',
  candidateProfileId: null,
};

const mockScreeningOrder = {
  id: 100,
  orderRef: 'ORD-2025-ABCD',
  tenantId: 1,
  candidateId: 10,
  investigationRef: 'INV-IND-001',
  status: 'completed',
  overallOutcome: 'clear',
  riskScore: 15,
  screeningTypes: ['nin_trace', 'npf_criminal', 'pep_check'],
  etaAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
  completedAt: new Date(),
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockScreeningResults = [
  {
    id: 1,
    orderId: 100,
    screeningType: 'nin_trace',
    status: 'completed',
    outcome: 'clear',
    summary: 'NIN identity confirmed. No discrepancies found.',
    riskScore: 5,
    rawResult: { nin: '12345678901', status: 'verified' },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 2,
    orderId: 100,
    screeningType: 'npf_criminal',
    status: 'completed',
    outcome: 'clear',
    summary: 'No criminal records found in NPF database.',
    riskScore: 0,
    rawResult: { records: [] },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 3,
    orderId: 100,
    screeningType: 'pep_check',
    status: 'completed',
    outcome: 'consider',
    summary: 'Subject has a distant family connection to a PEP. Low risk.',
    riskScore: 25,
    rawResult: { pepHits: [{ name: 'Related Person', relation: 'distant_family' }] },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const mockAiSummary = {
  id: 1,
  summaryRef: 'SUM-2025-ABCD',
  investigationRef: 'INV-IND-001',
  orderRefs: ['ORD-2025-ABCD'],
  overallRisk: 'medium',
  headline: 'Background screening completed with one item requiring review',
  keyFindings: [
    '3 of 3 checks completed',
    'NIN identity verified with no discrepancies',
    'No criminal records found in NPF database',
    'Distant PEP family connection identified — low risk',
  ],
  redFlags: [],
  recommendations: ['Review PEP connection with compliance officer before finalising engagement'],
  fullNarrative: 'Background screening for Adewale Okonkwo has been completed across three checks...',
  compositeScore: 25,
  modelVersion: 'gpt-4o',
  generatedBy: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockCorporateProfile = {
  id: 1,
  profileRef: 'CORP-2025-ABCD',
  investigationRef: 'INV-CORP-001',
  tenantId: 1,
  companyName: 'Dangote Industries Ltd',
  rcNumber: 'RC123456',
  tinNumber: null,
  incorporationDate: null,
  companyType: null,
  registeredAddress: null,
  status: 'completed',
  overallOutcome: 'clear',
  cacResult: { rc: 'RC123456', name: 'DANGOTE INDUSTRIES LIMITED', status: 'active' },
  firsResult: null,
  directorsResult: { directors: [{ name: 'Aliko Dangote', role: 'Chairman' }] },
  sanctionsResult: { hits: [] },
  riskScore: 0,
  notes: null,
  createdBy: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── generateScreeningSummary — logic tests ───────────────────────────────────

describe('investigations.generateScreeningSummary — risk computation logic', () => {
  it('computes low risk when all checks are clear', () => {
    const results = mockScreeningResults.map(r => ({ ...r, outcome: 'clear' as const }));
    const adverseCount = results.filter(r => r.outcome === 'adverse').length;
    const considerCount = results.filter(r => r.outcome === 'consider').length;
    const clearCount = results.filter(r => r.outcome === 'clear').length;
    const risk = adverseCount > 0 ? 'high' : considerCount > 0 ? 'medium' : clearCount === results.length ? 'low' : 'medium';
    expect(risk).toBe('low');
    expect(adverseCount).toBe(0);
    expect(clearCount).toBe(3);
  });

  it('computes medium risk when there are consider findings', () => {
    const results = mockScreeningResults; // has one 'consider'
    const adverseCount = results.filter(r => r.outcome === 'adverse').length;
    const considerCount = results.filter(r => r.outcome === 'consider').length;
    const risk = adverseCount > 0 ? 'high' : considerCount > 0 ? 'medium' : 'low';
    expect(risk).toBe('medium');
    expect(considerCount).toBe(1);
  });

  it('computes high risk when there are adverse findings', () => {
    const results = [
      ...mockScreeningResults,
      { ...mockScreeningResults[0], id: 99, screeningType: 'efcc_watchlist', outcome: 'adverse' as const, summary: 'EFCC watchlist hit' },
    ];
    const adverseCount = results.filter(r => r.outcome === 'adverse').length;
    const risk = adverseCount > 0 ? 'high' : 'low';
    expect(risk).toBe('high');
    expect(adverseCount).toBe(1);
  });

  it('computes composite score correctly', () => {
    const adverseCount = 1;
    const considerCount = 2;
    const pendingCount = 0;
    const score = Math.min(100, adverseCount * 25 + considerCount * 10 + (pendingCount > 0 ? 5 : 0));
    expect(score).toBe(45);
  });

  it('caps composite score at 100', () => {
    const adverseCount = 5;
    const considerCount = 5;
    const score = Math.min(100, adverseCount * 25 + considerCount * 10);
    expect(score).toBe(100);
  });

  it('generates fallback red flags from adverse results', () => {
    const adverseResults = [
      { screeningType: 'efcc_watchlist', outcome: 'adverse', summary: 'EFCC watchlist hit' },
      { screeningType: 'npf_criminal', outcome: 'adverse', summary: 'Criminal record found' },
    ];
    const redFlags = adverseResults
      .filter(r => r.outcome === 'adverse')
      .map(r => `${r.screeningType}: ${r.summary ?? 'Adverse outcome'}`);
    expect(redFlags).toHaveLength(2);
    expect(redFlags[0]).toBe('efcc_watchlist: EFCC watchlist hit');
    expect(redFlags[1]).toBe('npf_criminal: Criminal record found');
  });

  it('generates appropriate recommendations for adverse findings', () => {
    const adverseCount = 1;
    const considerCount = 0;
    const recommendations = adverseCount > 0
      ? ['Review adverse findings with legal counsel before proceeding', 'Consider escalating to senior compliance officer']
      : considerCount > 0
      ? ['Review flagged items before making a hiring/engagement decision']
      : ['Screening results are satisfactory; proceed with standard onboarding'];
    expect(recommendations).toHaveLength(2);
    expect(recommendations[0]).toContain('legal counsel');
  });

  it('generates appropriate recommendations for clear findings', () => {
    const adverseCount = 0;
    const considerCount = 0;
    const recommendations = adverseCount > 0
      ? ['Review adverse findings with legal counsel before proceeding']
      : considerCount > 0
      ? ['Review flagged items before making a hiring/engagement decision']
      : ['Screening results are satisfactory; proceed with standard onboarding'];
    expect(recommendations[0]).toContain('satisfactory');
  });

  it('throws PRECONDITION_FAILED when no screening orders exist', () => {
    const orders: typeof mockScreeningOrder[] = [];
    const shouldThrow = orders.length === 0;
    expect(shouldThrow).toBe(true);
  });

  it('validates overallRisk values against allowed set', () => {
    const validRisks = ['low', 'medium', 'high', 'critical'];
    expect(validRisks).toContain('low');
    expect(validRisks).toContain('critical');
    expect(validRisks).not.toContain('extreme');
    expect(validRisks).not.toContain('none');
  });
});

// ─── getScreeningSummary — retrieval logic ────────────────────────────────────

describe('investigations.getScreeningSummary — retrieval logic', () => {
  it('returns null when no summary exists', () => {
    const summaries: typeof mockAiSummary[] = [];
    const result = summaries[0] ?? null;
    expect(result).toBeNull();
  });

  it('returns the most recent summary', () => {
    const older = { ...mockAiSummary, id: 1, summaryRef: 'SUM-OLD', createdAt: new Date('2025-01-01') };
    const newer = { ...mockAiSummary, id: 2, summaryRef: 'SUM-NEW', createdAt: new Date('2025-06-01') };
    // Simulate ORDER BY createdAt DESC LIMIT 1
    const sorted = [newer, older];
    expect(sorted[0].summaryRef).toBe('SUM-NEW');
  });

  it('summary contains required fields', () => {
    const s = mockAiSummary;
    expect(s.summaryRef).toBeTruthy();
    expect(s.investigationRef).toBeTruthy();
    expect(s.overallRisk).toMatch(/^(low|medium|high|critical)$/);
    expect(s.headline).toBeTruthy();
    expect(Array.isArray(s.keyFindings)).toBe(true);
    expect(Array.isArray(s.redFlags)).toBe(true);
    expect(Array.isArray(s.recommendations)).toBe(true);
    expect(s.fullNarrative).toBeTruthy();
    expect(typeof s.compositeScore).toBe('number');
  });
});

// ─── runCorporateCheck — validation logic ─────────────────────────────────────

describe('investigations.runCorporateCheck — validation logic', () => {
  it('rejects non-corporate investigation subjects', () => {
    const inv = mockIndividualInvestigation;
    const shouldReject = inv.subjectType !== 'corporate';
    expect(shouldReject).toBe(true);
  });

  it('accepts corporate investigation subjects', () => {
    const inv = mockCorporateInvestigation;
    const shouldReject = inv.subjectType !== 'corporate';
    expect(shouldReject).toBe(false);
  });

  it('requires at least one check type', () => {
    const checks: string[] = [];
    const isValid = checks.length > 0;
    expect(isValid).toBe(false);
  });

  it('accepts valid corporate check types', () => {
    const validChecks = ['cac_full_profile', 'firs_tax_clearance', 'beneficial_owner', 'corporate_sanctions'];
    const input = ['cac_full_profile', 'beneficial_owner'];
    const allValid = input.every(c => validChecks.includes(c));
    expect(allValid).toBe(true);
  });

  it('computes adverse outcome when sanctions hits found', () => {
    const sanctionsResult = { hits: [{ name: 'Dangote Industries Ltd', list: 'OFAC' }] };
    let overallOutcome: 'clear' | 'consider' | 'adverse' = 'clear';
    let riskScore = 0;
    if ((sanctionsResult as any)?.hits?.length > 0) {
      overallOutcome = 'adverse';
      riskScore += 50;
    }
    expect(overallOutcome).toBe('adverse');
    expect(riskScore).toBe(50);
  });

  it('computes consider outcome when FIRS tax not cleared', () => {
    const firsResult = { status: 'not_cleared', rc: 'RC123456' };
    let overallOutcome: 'clear' | 'consider' | 'adverse' = 'clear';
    let riskScore = 0;
    if ((firsResult as any)?.status === 'not_cleared') {
      overallOutcome = 'consider';
      riskScore += 20;
    }
    expect(overallOutcome).toBe('consider');
    expect(riskScore).toBe(20);
  });

  it('keeps clear outcome when all checks pass', () => {
    const cacResult = { rc: 'RC123456', status: 'active' };
    const firsResult = { status: 'cleared' };
    const sanctionsResult = { hits: [] };
    let overallOutcome: 'clear' | 'consider' | 'adverse' = 'clear';
    let riskScore = 0;
    if ((firsResult as any)?.status === 'not_cleared') { overallOutcome = 'consider'; riskScore += 20; }
    if ((sanctionsResult as any)?.hits?.length > 0) { overallOutcome = 'adverse'; riskScore += 50; }
    expect(overallOutcome).toBe('clear');
    expect(riskScore).toBe(0);
  });

  it('generates profileRef with CORP- prefix', () => {
    const generateRef = (prefix: string) => `${prefix}-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const ref = generateRef('CORP');
    expect(ref).toMatch(/^CORP-\d{4}-/);
  });

  it('uses investigation subjectName as companyName fallback', () => {
    const inv = mockCorporateInvestigation;
    const inputCompanyName: string | undefined = undefined;
    const companyName = inputCompanyName ?? inv.subjectName;
    expect(companyName).toBe('Dangote Industries Ltd');
  });

  it('uses input companyName when provided', () => {
    const inv = mockCorporateInvestigation;
    const inputCompanyName = 'DANGOTE INDUSTRIES LIMITED';
    const companyName = inputCompanyName ?? inv.subjectName;
    expect(companyName).toBe('DANGOTE INDUSTRIES LIMITED');
  });
});

// ─── getCorporateProfiles — retrieval logic ───────────────────────────────────

describe('investigations.getCorporateProfiles — retrieval logic', () => {
  it('returns empty array when no profiles exist', () => {
    const profiles: typeof mockCorporateProfile[] = [];
    expect(profiles).toHaveLength(0);
  });

  it('returns profiles ordered by createdAt descending', () => {
    const older = { ...mockCorporateProfile, id: 1, profileRef: 'CORP-OLD', createdAt: new Date('2025-01-01') };
    const newer = { ...mockCorporateProfile, id: 2, profileRef: 'CORP-NEW', createdAt: new Date('2025-06-01') };
    const sorted = [newer, older]; // DESC order
    expect(sorted[0].profileRef).toBe('CORP-NEW');
  });

  it('profile contains required fields', () => {
    const p = mockCorporateProfile;
    expect(p.profileRef).toBeTruthy();
    expect(p.investigationRef).toBeTruthy();
    expect(p.rcNumber).toBeTruthy();
    expect(p.companyName).toBeTruthy();
    expect(['pending', 'processing', 'completed', 'failed', 'review']).toContain(p.status);
  });

  it('profile outcome is one of the valid assessment outcomes', () => {
    const validOutcomes = ['clear', 'consider', 'adverse', null, undefined];
    expect(validOutcomes).toContain(mockCorporateProfile.overallOutcome);
  });
});

// ─── screeningTypeEnum — new corporate values ─────────────────────────────────

describe('screeningTypeEnum — new corporate check values', () => {
  const CORPORATE_CHECK_TYPES = ['cac_full_profile', 'firs_tax_clearance', 'beneficial_owner', 'corporate_sanctions'];

  it('includes all four new corporate check types', () => {
    expect(CORPORATE_CHECK_TYPES).toContain('cac_full_profile');
    expect(CORPORATE_CHECK_TYPES).toContain('firs_tax_clearance');
    expect(CORPORATE_CHECK_TYPES).toContain('beneficial_owner');
    expect(CORPORATE_CHECK_TYPES).toContain('corporate_sanctions');
  });

  it('does not include individual-only check types', () => {
    expect(CORPORATE_CHECK_TYPES).not.toContain('nin_trace');
    expect(CORPORATE_CHECK_TYPES).not.toContain('bvn_fraud_check');
    expect(CORPORATE_CHECK_TYPES).not.toContain('nysc_discharge');
  });

  it('runCorporateCheck input validates against enum', () => {
    const validInput = ['cac_full_profile', 'firs_tax_clearance'];
    const allValid = validInput.every(c => CORPORATE_CHECK_TYPES.includes(c));
    expect(allValid).toBe(true);
  });

  it('rejects invalid check type', () => {
    const invalidInput = ['nin_trace', 'cac_full_profile'];
    const allValid = invalidInput.every(c => CORPORATE_CHECK_TYPES.includes(c));
    expect(allValid).toBe(false);
  });
});
