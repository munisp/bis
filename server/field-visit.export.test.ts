// field-visit.export.test.ts
// Tests for the toGeoJSON and toCSV export helpers in FieldVisitMapPage

import { describe, it, expect } from 'vitest';

// ─── Inline copies of the export helpers (mirrors FieldVisitMapPage.tsx) ─────
// We duplicate the pure functions here so they can be tested without a DOM.

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

function toGeoJSON(points: VisitPoint[]): string {
  const features = points
    .filter(p => p.checkInLat != null && p.checkInLng != null)
    .map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.checkInLng!, p.checkInLat!] },
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
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
}

function toCSV(points: VisitPoint[]): string {
  const header = [
    'visitRef','taskRef','agentId','agentName',
    'checkInLat','checkInLng','checkOutLat','checkOutLng',
    'outcome','subjectPresent','addressConfirmed',
    'durationMinutes','findings','submittedAt','createdAt',
  ].join(',');
  const rows = points.map(p => [
    p.visitRef,
    p.taskRef,
    p.agentId,
    `"${p.agentName.replace(/"/g, '""')}"`,
    p.checkInLat ?? '',
    p.checkInLng ?? '',
    p.checkOutLat ?? '',
    p.checkOutLng ?? '',
    p.outcome ?? '',
    p.subjectPresent == null ? '' : p.subjectPresent ? 'true' : 'false',
    p.addressConfirmed == null ? '' : p.addressConfirmed ? 'true' : 'false',
    p.durationMinutes ?? '',
    `"${(p.findings ?? '').replace(/"/g, '""')}"`,
    p.submittedAt?.toISOString() ?? '',
    p.createdAt.toISOString(),
  ].join(','));
  return [header, ...rows].join('\n');
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makePoint = (overrides: Partial<VisitPoint> = {}): VisitPoint => ({
  visitRef: 'VR-001',
  taskRef: 'FT-001',
  agentId: 'agent-1',
  agentName: 'Emeka Obi',
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

// ─── toGeoJSON tests ──────────────────────────────────────────────────────────

describe('toGeoJSON', () => {
  it('returns a valid FeatureCollection wrapper', () => {
    const json = JSON.parse(toGeoJSON([makePoint()]));
    expect(json.type).toBe('FeatureCollection');
    expect(Array.isArray(json.features)).toBe(true);
  });

  it('produces one Feature per GPS-valid point', () => {
    const points = [makePoint(), makePoint({ visitRef: 'VR-002' })];
    const json = JSON.parse(toGeoJSON(points));
    expect(json.features).toHaveLength(2);
  });

  it('excludes points with null checkInLat', () => {
    const points = [makePoint({ checkInLat: null }), makePoint({ visitRef: 'VR-002' })];
    const json = JSON.parse(toGeoJSON(points));
    expect(json.features).toHaveLength(1);
    expect(json.features[0].properties.visitRef).toBe('VR-002');
  });

  it('excludes points with null checkInLng', () => {
    const points = [makePoint({ checkInLng: null }), makePoint({ visitRef: 'VR-002' })];
    const json = JSON.parse(toGeoJSON(points));
    expect(json.features).toHaveLength(1);
  });

  it('uses [lng, lat] coordinate order (GeoJSON spec)', () => {
    const json = JSON.parse(toGeoJSON([makePoint()]));
    const coords = json.features[0].geometry.coordinates;
    expect(coords[0]).toBe(3.3792); // lng first
    expect(coords[1]).toBe(6.5244); // lat second
  });

  it('Feature geometry type is Point', () => {
    const json = JSON.parse(toGeoJSON([makePoint()]));
    expect(json.features[0].geometry.type).toBe('Point');
  });

  it('includes all required property fields', () => {
    const json = JSON.parse(toGeoJSON([makePoint()]));
    const props = json.features[0].properties;
    expect(props).toHaveProperty('visitRef', 'VR-001');
    expect(props).toHaveProperty('taskRef', 'FT-001');
    expect(props).toHaveProperty('agentId', 'agent-1');
    expect(props).toHaveProperty('agentName', 'Emeka Obi');
    expect(props).toHaveProperty('outcome', 'confirmed');
    expect(props).toHaveProperty('subjectPresent', true);
    expect(props).toHaveProperty('addressConfirmed', true);
    expect(props).toHaveProperty('durationMinutes', 45);
    expect(props).toHaveProperty('findings', 'Subject found at address.');
    expect(props).toHaveProperty('submittedAt');
    expect(props).toHaveProperty('createdAt');
  });

  it('serialises submittedAt as ISO string', () => {
    const json = JSON.parse(toGeoJSON([makePoint()]));
    expect(json.features[0].properties.submittedAt).toBe('2025-03-01T12:00:00.000Z');
  });

  it('serialises null submittedAt as null', () => {
    const json = JSON.parse(toGeoJSON([makePoint({ submittedAt: null })]));
    expect(json.features[0].properties.submittedAt).toBeNull();
  });

  it('returns empty features array for empty input', () => {
    const json = JSON.parse(toGeoJSON([]));
    expect(json.features).toHaveLength(0);
  });

  it('returns empty features array when all points lack GPS', () => {
    const json = JSON.parse(toGeoJSON([makePoint({ checkInLat: null, checkInLng: null })]));
    expect(json.features).toHaveLength(0);
  });

  it('output is valid JSON (no parse errors)', () => {
    expect(() => JSON.parse(toGeoJSON([makePoint()]))).not.toThrow();
  });
});

// ─── toCSV tests ──────────────────────────────────────────────────────────────

describe('toCSV', () => {
  it('first line is the header row', () => {
    const csv = toCSV([makePoint()]);
    const firstLine = csv.split('\n')[0];
    expect(firstLine).toContain('visitRef');
    expect(firstLine).toContain('checkInLat');
    expect(firstLine).toContain('outcome');
  });

  it('produces header + one data row for a single point', () => {
    const lines = toCSV([makePoint()]).split('\n');
    expect(lines).toHaveLength(2);
  });

  it('produces header + N data rows for N points', () => {
    const points = [makePoint(), makePoint({ visitRef: 'VR-002' }), makePoint({ visitRef: 'VR-003' })];
    const lines = toCSV(points).split('\n');
    expect(lines).toHaveLength(4); // header + 3 rows
  });

  it('includes GPS coordinates in data row', () => {
    const csv = toCSV([makePoint()]);
    expect(csv).toContain('6.5244');
    expect(csv).toContain('3.3792');
  });

  it('escapes double-quotes in agentName', () => {
    const csv = toCSV([makePoint({ agentName: 'O\'Brien "Agent"' })]);
    expect(csv).toContain('""Agent""');
  });

  it('escapes double-quotes in findings', () => {
    const csv = toCSV([makePoint({ findings: 'Said "hello"' })]);
    expect(csv).toContain('""hello""');
  });

  it('renders null checkOutLat as empty string', () => {
    const csv = toCSV([makePoint({ checkOutLat: null, checkOutLng: null })]);
    const dataRow = csv.split('\n')[1];
    const cols = dataRow.split(',');
    // checkOutLat is column index 6 (0-based)
    expect(cols[6]).toBe('');
  });

  it('renders null outcome as empty string', () => {
    const csv = toCSV([makePoint({ outcome: null })]);
    const dataRow = csv.split('\n')[1];
    expect(dataRow).toContain(',,');
  });

  it('renders subjectPresent true as "true"', () => {
    const csv = toCSV([makePoint({ subjectPresent: true })]);
    expect(csv).toContain('true');
  });

  it('renders subjectPresent false as "false"', () => {
    const csv = toCSV([makePoint({ subjectPresent: false })]);
    expect(csv).toContain('false');
  });

  it('renders null subjectPresent as empty string', () => {
    const csv = toCSV([makePoint({ subjectPresent: null })]);
    const dataRow = csv.split('\n')[1];
    const cols = dataRow.split(',');
    // subjectPresent is column index 9 (0-based: visitRef,taskRef,agentId,agentName,checkInLat,checkInLng,checkOutLat,checkOutLng,outcome,subjectPresent,...)
    expect(cols[9]).toBe('');
  });

  it('returns only header for empty input', () => {
    const csv = toCSV([]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('visitRef');
  });

  it('serialises createdAt as ISO string', () => {
    const csv = toCSV([makePoint()]);
    expect(csv).toContain('2025-03-01T11:00:00.000Z');
  });

  it('serialises null submittedAt as empty string', () => {
    const csv = toCSV([makePoint({ submittedAt: null })]);
    const dataRow = csv.split('\n')[1];
    // submittedAt is second-to-last column; createdAt is last
    expect(dataRow).toContain(',2025-03-01T11:00:00.000Z');
  });

  it('header has exactly 15 columns', () => {
    const header = toCSV([]).split('\n')[0];
    expect(header.split(',').length).toBe(15);
  });
});
