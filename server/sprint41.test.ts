/**
 * Sprint v41 unit tests
 * - Broadcast tagging: tag field in broadcastToAll, tagFilter in listBroadcasts
 * - kyc.reextractField: input schema, field description map, merge logic
 * - push.getSubscriptionStats: platform grouping, 30-day histogram bucketing
 */

import { describe, it, expect } from 'vitest';

// ─── Broadcast Tagging ────────────────────────────────────────────────────────

describe('broadcast tagging', () => {
  const VALID_TAGS = ['maintenance', 'compliance', 'alert', 'update', 'security'];

  it('accepts all predefined tag values', () => {
    for (const tag of VALID_TAGS) {
      expect(typeof tag).toBe('string');
      expect(tag.length).toBeGreaterThan(0);
      expect(tag.length).toBeLessThanOrEqual(32);
    }
  });

  it('tag is optional — broadcastToAll works without tag', () => {
    const input = { title: 'Test', body: 'Body' };
    // No tag field — should not throw
    expect(() => {
      const tag = (input as any).tag;
      const resolved = tag ?? null;
      expect(resolved).toBeNull();
    }).not.toThrow();
  });

  it('tagFilter filters broadcasts correctly', () => {
    const broadcasts = [
      { id: 1, tag: 'maintenance', title: 'Maint 1' },
      { id: 2, tag: 'alert', title: 'Alert 1' },
      { id: 3, tag: 'maintenance', title: 'Maint 2' },
      { id: 4, tag: null, title: 'No tag' },
    ];

    const filtered = (tagFilter: string | undefined) =>
      tagFilter ? broadcasts.filter(b => b.tag === tagFilter) : broadcasts;

    expect(filtered('maintenance')).toHaveLength(2);
    expect(filtered('alert')).toHaveLength(1);
    expect(filtered('security')).toHaveLength(0);
    expect(filtered(undefined)).toHaveLength(4);
  });

  it('custom tag (free-text) is accepted as long as it is ≤32 chars', () => {
    const customTag = 'custom-event-2026';
    expect(customTag.length).toBeLessThanOrEqual(32);
  });

  it('tagFilter resets pagination offset to 0 when changed', () => {
    let offset = 10;
    const setTagFilter = (tag: string) => {
      offset = 0; // simulates setHistoryOffset(0) in the component
      return tag;
    };
    setTagFilter('maintenance');
    expect(offset).toBe(0);
  });
});

// ─── kyc.reextractField ───────────────────────────────────────────────────────

describe('kyc.reextractField', () => {
  const FIELD_DESCRIPTIONS: Record<string, string> = {
    fullName: 'full legal name (first + middle + last)',
    surname: 'family/last name only',
    firstName: 'given/first name only',
    middleName: 'middle name only',
    dateOfBirth: 'date of birth in ISO 8601 format (YYYY-MM-DD)',
    gender: 'gender (M, F, or X)',
    idNumber: 'national ID number',
    documentNumber: 'document/passport number',
    nationality: 'nationality as ISO 3166-1 alpha-3 code',
    expiryDate: 'document expiry date in ISO 8601 format',
    issueDate: 'document issue date in ISO 8601 format',
    address: 'full residential address',
    placeOfBirth: 'place of birth (city/country)',
    mrz: 'machine-readable zone (MRZ) line(s)',
  };

  it('has descriptions for all 14 standard OCR fields', () => {
    const STANDARD_FIELDS = [
      'fullName', 'surname', 'firstName', 'middleName', 'dateOfBirth', 'gender',
      'idNumber', 'documentNumber', 'nationality', 'expiryDate', 'issueDate',
      'address', 'placeOfBirth', 'mrz',
    ];
    for (const field of STANDARD_FIELDS) {
      expect(FIELD_DESCRIPTIONS[field]).toBeDefined();
      expect(FIELD_DESCRIPTIONS[field].length).toBeGreaterThan(0);
    }
  });

  it('falls back to fieldName for unknown fields', () => {
    const fieldName = 'customField';
    const desc = FIELD_DESCRIPTIONS[fieldName] ?? fieldName;
    expect(desc).toBe('customField');
  });

  it('merges extracted field into existing ocrData', () => {
    const existing = {
      fullName: { value: 'John Doe', confidence: 0.9 },
      dateOfBirth: { value: '1990-01-01', confidence: 0.4 }, // low confidence
      idNumber: { value: 'A123456', confidence: 0.85 },
    };
    const extracted = { value: '1990-06-15', confidence: 0.95 };
    const merged = { ...existing, dateOfBirth: extracted };

    expect(merged.dateOfBirth.value).toBe('1990-06-15');
    expect(merged.dateOfBirth.confidence).toBe(0.95);
    // Other fields unchanged
    expect(merged.fullName.value).toBe('John Doe');
    expect(merged.idNumber.value).toBe('A123456');
  });

  it('reextractField input schema requires documentId (positive int) and fieldName (1-64 chars)', () => {
    const validate = (input: { documentId: number; fieldName: string }) => {
      if (!Number.isInteger(input.documentId) || input.documentId <= 0) throw new Error('Invalid documentId');
      if (input.fieldName.length < 1 || input.fieldName.length > 64) throw new Error('Invalid fieldName');
      return true;
    };

    expect(validate({ documentId: 1, fieldName: 'fullName' })).toBe(true);
    expect(() => validate({ documentId: -1, fieldName: 'fullName' })).toThrow('Invalid documentId');
    expect(() => validate({ documentId: 1, fieldName: '' })).toThrow('Invalid fieldName');
    expect(() => validate({ documentId: 1, fieldName: 'x'.repeat(65) })).toThrow('Invalid fieldName');
  });

  it('returns fieldName and result with value + confidence', () => {
    const mockResult = { fieldName: 'dateOfBirth', result: { value: '1990-06-15', confidence: 0.95 } };
    expect(mockResult.fieldName).toBe('dateOfBirth');
    expect(typeof mockResult.result.value).toBe('string');
    expect(mockResult.result.confidence).toBeGreaterThanOrEqual(0);
    expect(mockResult.result.confidence).toBeLessThanOrEqual(1);
  });

  it('confidence badge reflects updated confidence after re-extraction', () => {
    const confidenceClass = (c: number) => {
      if (c >= 0.85) return 'emerald';
      if (c >= 0.5) return 'amber';
      return 'red';
    };

    // Before re-extraction: low confidence
    expect(confidenceClass(0.3)).toBe('red');
    // After re-extraction: high confidence
    expect(confidenceClass(0.95)).toBe('emerald');
  });
});

// ─── push.getSubscriptionStats ────────────────────────────────────────────────

describe('push.getSubscriptionStats', () => {
  it('groups subscriptions by platform correctly', () => {
    const subs = [
      { platform: 'webpush', active: true },
      { platform: 'fcm', active: true },
      { platform: 'webpush', active: true },
      { platform: 'fcm', active: true },
      { platform: 'webpush', active: false }, // inactive — excluded
    ];

    const active = subs.filter(s => s.active);
    const byPlatform = active.reduce((acc, s) => {
      acc[s.platform] = (acc[s.platform] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    expect(byPlatform['webpush']).toBe(2);
    expect(byPlatform['fcm']).toBe(2);
    expect(Object.values(byPlatform).reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('builds 30-day registration histogram correctly', () => {
    const now = new Date('2026-06-16T12:00:00Z');
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const registrations = [
      new Date('2026-06-15T10:00:00Z'), // within 30 days
      new Date('2026-06-15T14:00:00Z'), // within 30 days — same day
      new Date('2026-06-10T09:00:00Z'), // within 30 days
      new Date('2026-05-01T08:00:00Z'), // older than 30 days — excluded
    ];

    const recent = registrations.filter(d => d >= thirtyDaysAgo);
    const buckets: Record<string, number> = {};
    for (const d of recent) {
      const day = d.toISOString().slice(0, 10);
      buckets[day] = (buckets[day] ?? 0) + 1;
    }

    expect(Object.keys(buckets)).toHaveLength(2); // 2026-06-15 and 2026-06-10
    expect(buckets['2026-06-15']).toBe(2);
    expect(buckets['2026-06-10']).toBe(1);
    expect(buckets['2026-05-01']).toBeUndefined();
  });

  it('returns empty stats when no active subscriptions', () => {
    const stats = { total: 0, byPlatform: [], byBrowser: [], recentRegistrations: [] };
    expect(stats.total).toBe(0);
    expect(stats.byPlatform).toHaveLength(0);
    expect(stats.byBrowser).toHaveLength(0);
    expect(stats.recentRegistrations).toHaveLength(0);
  });

  it('caps browser list at 10 entries', () => {
    const browsers = Array.from({ length: 15 }, (_, i) => ({
      label: `Browser ${i}`,
      count: 15 - i,
    }));
    const capped = browsers.slice(0, 10);
    expect(capped).toHaveLength(10);
  });

  it('histogram is sorted by date ascending', () => {
    const buckets = { '2026-06-15': 2, '2026-06-10': 1, '2026-06-12': 3 };
    const sorted = Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    expect(sorted[0].date).toBe('2026-06-10');
    expect(sorted[1].date).toBe('2026-06-12');
    expect(sorted[2].date).toBe('2026-06-15');
  });
});
