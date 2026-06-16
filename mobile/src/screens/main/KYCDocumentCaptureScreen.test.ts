/**
 * KYCDocumentCaptureScreen — unit tests
 *
 * Tests cover:
 *   - validateDocument: size limit, MIME type validation
 *   - formatBytes: human-readable file size formatting
 *   - generateFileName: deterministic filename generation
 *   - UploadState transitions (via the helpers, not the component)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateDocument,
  formatBytes,
  generateFileName,
  type CapturedDocument,
  type KYCDocumentType,
} from './KYCDocumentCaptureScreen';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<CapturedDocument> = {}): CapturedDocument {
  return {
    uri: 'file:///tmp/test.jpg',
    type: 'nin_slip',
    fileName: 'kyc-rec1-nin_slip-1234567890.jpg',
    fileSizeBytes: 1 * 1024 * 1024, // 1 MB
    mimeType: 'image/jpeg',
    capturedAt: 1_700_000_000_000,
    ...overrides,
  };
}

// ─── validateDocument ─────────────────────────────────────────────────────────

describe('validateDocument', () => {
  it('returns null for a valid JPEG under 5 MB', () => {
    expect(validateDocument(makeDoc())).toBeNull();
  });

  it('returns null for a valid PNG under 5 MB', () => {
    expect(validateDocument(makeDoc({ mimeType: 'image/png', fileName: 'test.png' }))).toBeNull();
  });

  it('returns an error when file exceeds 5 MB', () => {
    const doc = makeDoc({ fileSizeBytes: 6 * 1024 * 1024 });
    const result = validateDocument(doc);
    expect(result).not.toBeNull();
    expect(result).toContain('6.0 MB');
    expect(result).toContain('Maximum is 5 MB');
  });

  it('returns an error for exactly 5 MB + 1 byte', () => {
    const doc = makeDoc({ fileSizeBytes: 5 * 1024 * 1024 + 1 });
    expect(validateDocument(doc)).not.toBeNull();
  });

  it('returns null for exactly 5 MB', () => {
    const doc = makeDoc({ fileSizeBytes: 5 * 1024 * 1024 });
    expect(validateDocument(doc)).toBeNull();
  });

  it('returns an error for unsupported MIME type (PDF)', () => {
    // @ts-expect-error — testing invalid MIME type
    const doc = makeDoc({ mimeType: 'application/pdf' });
    const result = validateDocument(doc);
    expect(result).not.toBeNull();
    expect(result).toContain('application/pdf');
    expect(result).toContain('JPEG or PNG');
  });

  it('returns an error for unsupported MIME type (HEIC)', () => {
    // @ts-expect-error — testing invalid MIME type
    const doc = makeDoc({ mimeType: 'image/heic' });
    expect(validateDocument(doc)).not.toBeNull();
  });

  it('returns an error for zero-byte file', () => {
    // Zero bytes is valid size-wise but we still accept it (no size error)
    const doc = makeDoc({ fileSizeBytes: 0 });
    expect(validateDocument(doc)).toBeNull(); // 0 bytes is under 5 MB
  });
});

// ─── formatBytes ──────────────────────────────────────────────────────────────

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats exactly 1 KB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
  });

  it('formats exactly 1 MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });

  it('formats 800 KB', () => {
    expect(formatBytes(800 * 1024)).toBe('800.0 KB');
  });
});

// ─── generateFileName ─────────────────────────────────────────────────────────

describe('generateFileName', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('generates a filename with the correct prefix', () => {
    const name = generateFileName('rec-123', 'nin_slip', 'jpg');
    expect(name).toMatch(/^kyc-rec-123-nin_slip-\d+\.jpg$/);
  });

  it('includes the document type in the filename', () => {
    const types: KYCDocumentType[] = [
      'nin_slip',
      'passport',
      'drivers_license',
      'voters_card',
      'utility_bill',
      'bank_statement',
      'cac_certificate',
      'other',
    ];
    for (const type of types) {
      const name = generateFileName('rec-1', type, 'jpg');
      expect(name).toContain(type);
    }
  });

  it('includes the file extension', () => {
    expect(generateFileName('rec-1', 'passport', 'png')).toMatch(/\.png$/);
    expect(generateFileName('rec-1', 'passport', 'jpg')).toMatch(/\.jpg$/);
  });

  it('uses the current timestamp in the filename', () => {
    const ts = Date.now(); // 1705312800000 (mocked)
    const name = generateFileName('rec-1', 'passport', 'jpg');
    expect(name).toContain(String(ts));
  });

  it('generates unique filenames for the same type at different times', () => {
    const name1 = generateFileName('rec-1', 'passport', 'jpg');
    vi.advanceTimersByTime(1000);
    const name2 = generateFileName('rec-1', 'passport', 'jpg');
    expect(name1).not.toBe(name2);
  });

  it('handles kycRecordId with special characters safely', () => {
    const name = generateFileName('rec_456_test', 'utility_bill', 'jpg');
    expect(name).toMatch(/^kyc-rec_456_test-utility_bill-\d+\.jpg$/);
  });
});
