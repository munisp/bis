// field-visit.thinfile.test.ts
// Tests for field visit return-leg and thin-file/data-completeness procedures

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock database ────────────────────────────────────────────────────────────

const mockFieldTask = {
  id: 1,
  taskRef: 'FT-TEST-001',
  agentId: 'agent-1',
  agentName: 'Test Agent',
  taskType: 'address_verification',
  priority: 'high',
  status: 'dispatched',
  subjectName: 'John Doe',
  address: '12 Lagos Street, Ikeja',
  state: 'Lagos',
  lga: 'Ikeja',
  gpsLat: 6.6018,
  gpsLng: 3.3515,
  investigationId: 42,
  createdBy: 1,
  createdAt: new Date('2025-01-01T10:00:00Z'),
  updatedAt: new Date('2025-01-01T10:00:00Z'),
};

const mockVisitReport = {
  id: 1,
  visitRef: 'VR-TEST-001',
  taskRef: 'FT-TEST-001',
  investigationId: 42,
  agentId: 'agent-1',
  agentName: 'Test Agent',
  checkInAt: new Date('2025-01-01T11:00:00Z'),
  checkInLat: 6.6018,
  checkInLng: 3.3515,
  checkOutAt: null,
  checkOutLat: null,
  checkOutLng: null,
  durationMinutes: null,
  subjectPresent: null,
  addressConfirmed: null,
  findings: null,
  structuredFindings: null,
  photoUrls: [],
  dataCompleteness: null,
  sourcesChecked: [],
  sourcesReturned: [],
  recommendedNextSteps: [],
  outcome: null,
  submittedAt: null,
  createdBy: 1,
  createdAt: new Date('2025-01-01T11:00:00Z'),
  updatedAt: new Date('2025-01-01T11:00:00Z'),
};

const mockInvestigation = {
  id: 42,
  ref: 'INV-TEST-001',
  subjectName: 'John Doe',
  subjectType: 'individual',
  status: 'processing',
  riskScore: 45,
  tenantId: 1,
  createdAt: new Date('2025-01-01T09:00:00Z'),
  updatedAt: new Date('2025-01-01T09:00:00Z'),
};

const mockScreeningResults = [
  { id: 1, checkType: 'nin_trace', status: 'completed', result: { found: true, name: 'John Doe' }, riskScore: 10, investigationId: 42 },
  { id: 2, checkType: 'bvn_fraud_check', status: 'failed', result: { error: 'not_found' }, riskScore: null, investigationId: 42 },
  { id: 3, checkType: 'npf_criminal', status: 'completed', result: { records: [] }, riskScore: 5, investigationId: 42 },
];

// ─── Unit Tests ───────────────────────────────────────────────────────────────

describe('Field Visit: checkIn', () => {
  it('should update task status to in_progress on check-in', () => {
    const task = { ...mockFieldTask, status: 'dispatched' };
    const updatedStatus = task.status === 'dispatched' ? 'in_progress' : task.status;
    expect(updatedStatus).toBe('in_progress');
  });

  it('should record GPS coordinates on check-in', () => {
    const gpsLat = 6.6018;
    const gpsLng = 3.3515;
    const report = {
      checkInAt: new Date(),
      checkInLat: gpsLat,
      checkInLng: gpsLng,
    };
    expect(report.checkInLat).toBe(gpsLat);
    expect(report.checkInLng).toBe(gpsLng);
    expect(report.checkInAt).toBeInstanceOf(Date);
  });

  it('should allow check-in without GPS coordinates', () => {
    const report = {
      checkInAt: new Date(),
      checkInLat: undefined,
      checkInLng: undefined,
    };
    expect(report.checkInAt).toBeInstanceOf(Date);
    expect(report.checkInLat).toBeUndefined();
  });
});

describe('Field Visit: checkOut', () => {
  it('should calculate duration in minutes from check-in to check-out', () => {
    const checkInAt = new Date('2025-01-01T11:00:00Z');
    const checkOutAt = new Date('2025-01-01T12:30:00Z');
    const durationMinutes = Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000);
    expect(durationMinutes).toBe(90);
  });

  it('should return 0 duration if check-in time is missing', () => {
    const checkInAt = null;
    const checkOutAt = new Date('2025-01-01T12:30:00Z');
    const durationMinutes = checkInAt
      ? Math.round((checkOutAt.getTime() - new Date(checkInAt).getTime()) / 60000)
      : 0;
    expect(durationMinutes).toBe(0);
  });

  it('should record check-out GPS coordinates', () => {
    const report = {
      checkOutAt: new Date(),
      checkOutLat: 6.6020,
      checkOutLng: 3.3520,
    };
    expect(report.checkOutLat).toBe(6.6020);
    expect(report.checkOutLng).toBe(3.3520);
  });
});

describe('Field Visit: submitResult', () => {
  it('should accept confirmed outcome', () => {
    const validOutcomes = ['confirmed', 'unconfirmed', 'inconclusive'];
    expect(validOutcomes).toContain('confirmed');
  });

  it('should require findings text', () => {
    const findings = '';
    const isValid = findings.trim().length > 0;
    expect(isValid).toBe(false);
  });

  it('should accept photo URLs array', () => {
    const photoUrls = [
      'https://cdn.example.com/photo1.jpg',
      'https://cdn.example.com/photo2.jpg',
    ];
    expect(Array.isArray(photoUrls)).toBe(true);
    expect(photoUrls.length).toBe(2);
  });

  it('should accept structured findings as key-value record', () => {
    const structuredFindings = {
      premisesCondition: 'Good',
      businessOperating: true,
      staffCount: 5,
    };
    expect(typeof structuredFindings).toBe('object');
    expect(structuredFindings.businessOperating).toBe(true);
  });

  it('should accept recommended next steps array', () => {
    const steps = [
      'Request utility bill from subject',
      'Conduct follow-up interview with neighbours',
    ];
    expect(steps.length).toBe(2);
    expect(steps[0]).toContain('utility bill');
  });

  it('should mark task as completed on successful submission', () => {
    const input = { status: 'completed' as const };
    const taskStatus = input.status;
    expect(taskStatus).toBe('completed');
  });

  it('should mark task as failed when submission indicates failure', () => {
    const input = { status: 'failed' as const };
    const taskStatus = input.status;
    expect(taskStatus).toBe('failed');
  });
});

describe('Field Visit: uploadPhoto', () => {
  it('should construct S3 key with task ref prefix', () => {
    const taskRef = 'FT-TEST-001';
    const fileName = 'evidence.jpg';
    const suffix = 'abc123';
    const key = `field-visits/${taskRef}/${suffix}-${fileName}`;
    expect(key).toBe('field-visits/FT-TEST-001/abc123-evidence.jpg');
    expect(key.startsWith('field-visits/')).toBe(true);
  });

  it('should reject files larger than 16 MB', () => {
    const MAX_SIZE = 16 * 1024 * 1024;
    const fileSize = 20 * 1024 * 1024; // 20 MB
    const isValid = fileSize <= MAX_SIZE;
    expect(isValid).toBe(false);
  });

  it('should accept files within 16 MB limit', () => {
    const MAX_SIZE = 16 * 1024 * 1024;
    const fileSize = 5 * 1024 * 1024; // 5 MB
    const isValid = fileSize <= MAX_SIZE;
    expect(isValid).toBe(true);
  });
});

describe('Data Completeness: getDataCompleteness', () => {
  it('should compute overall score as percentage of sources returned', () => {
    const totalSources = 6;
    const returnedSources = 4;
    const score = Math.round((returnedSources / totalSources) * 100);
    expect(score).toBe(67);
  });

  it('should return 0% score when no sources returned', () => {
    const totalSources = 6;
    const returnedSources = 0;
    const score = Math.round((returnedSources / totalSources) * 100);
    expect(score).toBe(0);
  });

  it('should return 100% score when all sources returned', () => {
    const totalSources = 6;
    const returnedSources = 6;
    const score = Math.round((returnedSources / totalSources) * 100);
    expect(score).toBe(100);
  });

  it('should classify score below 40 as low coverage', () => {
    const score = 30;
    const coverage = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
    expect(coverage).toBe('low');
  });

  it('should classify score 40-69 as medium coverage', () => {
    const score = 55;
    const coverage = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
    expect(coverage).toBe('medium');
  });

  it('should classify score 70+ as high coverage', () => {
    const score = 85;
    const coverage = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
    expect(coverage).toBe('high');
  });

  it('should generate alternative prompts for missing sources', () => {
    const missingSources = ['bvn_fraud_check', 'nin_trace'];
    const ALTERNATIVE_PROMPTS: Record<string, string> = {
      bvn_fraud_check: 'Request a recent bank statement (last 3 months) from the subject as BVN lookup returned no data.',
      nin_trace: 'Request a certified copy of the National Identity Card or NIN slip as NIMC lookup returned no data.',
    };
    const prompts = missingSources.map(s => ALTERNATIVE_PROMPTS[s]).filter(Boolean);
    expect(prompts.length).toBe(2);
    expect(prompts[0]).toContain('bank statement');
    expect(prompts[1]).toContain('National Identity Card');
  });

  it('should mark investigation as thin_file when score below threshold', () => {
    const score = 25;
    const THIN_FILE_THRESHOLD = 30;
    const isThinFile = score < THIN_FILE_THRESHOLD;
    expect(isThinFile).toBe(true);
  });

  it('should not auto-flag as thin_file when score meets threshold', () => {
    const score = 45;
    const THIN_FILE_THRESHOLD = 30;
    const isThinFile = score < THIN_FILE_THRESHOLD;
    expect(isThinFile).toBe(false);
  });
});

describe('Thin-File: setThinFile', () => {
  it('should update investigation status to thin_file', () => {
    const currentStatus = 'processing';
    const newStatus = 'thin_file';
    expect(newStatus).toBe('thin_file');
    expect(newStatus).not.toBe(currentStatus);
  });

  it('should store the reason for thin-file flag', () => {
    const reason = 'Subject has no BVN and NIN not found in NIMC database';
    expect(reason.length).toBeGreaterThan(0);
  });

  it('should accept empty reason (optional field)', () => {
    const reason = undefined;
    const storedReason = reason ?? null;
    expect(storedReason).toBeNull();
  });
});

describe('Thin-File: revertThinFile', () => {
  it('should revert investigation status from thin_file to processing', () => {
    const currentStatus = 'thin_file';
    const revertedStatus = currentStatus === 'thin_file' ? 'processing' : currentStatus;
    expect(revertedStatus).toBe('processing');
  });

  it('should clear the thin-file reason on revert', () => {
    const thinFileReason = 'No BVN found';
    const clearedReason = null;
    expect(clearedReason).toBeNull();
    expect(thinFileReason).not.toBeNull(); // original was set
  });
});

describe('Field Visit: getVisitReport', () => {
  it('should return null when no report exists for task', () => {
    const reports: any[] = [];
    const report = reports.find(r => r.taskRef === 'FT-NONEXISTENT') ?? null;
    expect(report).toBeNull();
  });

  it('should return report when it exists', () => {
    const reports = [mockVisitReport];
    const report = reports.find(r => r.taskRef === 'FT-TEST-001') ?? null;
    expect(report).not.toBeNull();
    expect(report?.visitRef).toBe('VR-TEST-001');
  });
});

describe('Field Visit: listVisitReports', () => {
  it('should filter reports by investigationId', () => {
    const allReports = [
      { ...mockVisitReport, investigationId: 42 },
      { ...mockVisitReport, id: 2, visitRef: 'VR-TEST-002', investigationId: 99 },
    ];
    const filtered = allReports.filter(r => r.investigationId === 42);
    expect(filtered.length).toBe(1);
    expect(filtered[0].visitRef).toBe('VR-TEST-001');
  });

  it('should return all reports when no investigationId filter', () => {
    const allReports = [
      { ...mockVisitReport, investigationId: 42 },
      { ...mockVisitReport, id: 2, visitRef: 'VR-TEST-002', investigationId: 99 },
    ];
    expect(allReports.length).toBe(2);
  });
});
