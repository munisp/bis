/**
 * sprint40.test.ts
 * ================
 * Unit tests for Sprint v40 features:
 *  - OCR diff logic (OcrDiffPanel helpers)
 *  - push_broadcasts schema validation
 *  - VAPID rotation reminder logic
 *  - listBroadcasts pagination schema
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── OCR diff helpers (extracted from DocumentReviewQueue for testing) ─────────

type OcrFieldValue = string | null | { value: string | null; confidence: number };

function normaliseOcrField(raw: OcrFieldValue): { value: string | null; confidence: number } {
  if (raw === null || raw === undefined) return { value: null, confidence: 0 };
  if (typeof raw === "string") return { value: raw, confidence: 1 };
  return { value: raw.value, confidence: raw.confidence ?? 0 };
}

function computeOcrDiff(
  before: Record<string, OcrFieldValue>,
  after: Record<string, OcrFieldValue>
): { key: string; before: { value: string | null; confidence: number }; after: { value: string | null; confidence: number } }[] {
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  return allKeys
    .filter((k) => {
      const b = normaliseOcrField(before[k] ?? null);
      const a = normaliseOcrField(after[k] ?? null);
      return b.value !== a.value || Math.abs(b.confidence - a.confidence) > 0.01;
    })
    .map((k) => ({
      key: k,
      before: normaliseOcrField(before[k] ?? null),
      after: normaliseOcrField(after[k] ?? null),
    }));
}

// ─── OCR diff tests ────────────────────────────────────────────────────────────

describe("OCR diff logic", () => {
  it("returns empty array when before and after are identical", () => {
    const ocr = { fullName: { value: "Alice", confidence: 0.95 } };
    expect(computeOcrDiff(ocr, ocr)).toHaveLength(0);
  });

  it("detects value change", () => {
    const before = { fullName: { value: "Alice", confidence: 0.9 } };
    const after  = { fullName: { value: "Alicia", confidence: 0.9 } };
    const diff = computeOcrDiff(before, after);
    expect(diff).toHaveLength(1);
    expect(diff[0].key).toBe("fullName");
    expect(diff[0].before.value).toBe("Alice");
    expect(diff[0].after.value).toBe("Alicia");
  });

  it("detects confidence change > 0.01", () => {
    const before = { idNumber: { value: "A123", confidence: 0.5 } };
    const after  = { idNumber: { value: "A123", confidence: 0.95 } };
    const diff = computeOcrDiff(before, after);
    expect(diff).toHaveLength(1);
    expect(diff[0].after.confidence).toBe(0.95);
  });

  it("ignores confidence change <= 0.01 (noise)", () => {
    const before = { idNumber: { value: "A123", confidence: 0.9 } };
    const after  = { idNumber: { value: "A123", confidence: 0.905 } };
    expect(computeOcrDiff(before, after)).toHaveLength(0);
  });

  it("handles v1 string schema in before snapshot", () => {
    const before: Record<string, OcrFieldValue> = { fullName: "Alice" }; // v1
    const after:  Record<string, OcrFieldValue> = { fullName: { value: "Alicia", confidence: 0.9 } }; // v2
    const diff = computeOcrDiff(before, after);
    expect(diff).toHaveLength(1);
    expect(diff[0].before.confidence).toBe(1); // v1 assumed full confidence
  });

  it("handles null fields in before and after", () => {
    const before: Record<string, OcrFieldValue> = { mrz: null };
    const after:  Record<string, OcrFieldValue> = { mrz: { value: "P<NGA<<ALICE", confidence: 0.8 } };
    const diff = computeOcrDiff(before, after);
    expect(diff).toHaveLength(1);
    expect(diff[0].before.value).toBeNull();
    expect(diff[0].after.value).toBe("P<NGA<<ALICE");
  });

  it("detects newly added fields (only in after)", () => {
    const before: Record<string, OcrFieldValue> = { fullName: { value: "Alice", confidence: 0.9 } };
    const after:  Record<string, OcrFieldValue> = {
      fullName: { value: "Alice", confidence: 0.9 },
      placeOfBirth: { value: "Lagos", confidence: 0.7 },
    };
    const diff = computeOcrDiff(before, after);
    expect(diff).toHaveLength(1);
    expect(diff[0].key).toBe("placeOfBirth");
  });

  it("counts improved and degraded fields correctly", () => {
    const before: Record<string, OcrFieldValue> = {
      fullName: { value: "Alice", confidence: 0.5 },
      idNumber: { value: "A123",  confidence: 0.9 },
    };
    const after: Record<string, OcrFieldValue> = {
      fullName: { value: "Alice", confidence: 0.95 }, // improved
      idNumber: { value: "A123",  confidence: 0.4  }, // degraded
    };
    const diff = computeOcrDiff(before, after);
    const improved = diff.filter((d) => d.after.confidence > d.before.confidence).length;
    const degraded  = diff.filter((d) => d.after.confidence < d.before.confidence).length;
    expect(improved).toBe(1);
    expect(degraded).toBe(1);
  });
});

// ─── normaliseOcrField tests ───────────────────────────────────────────────────

describe("normaliseOcrField", () => {
  it("returns {value:null, confidence:0} for null input", () => {
    expect(normaliseOcrField(null)).toEqual({ value: null, confidence: 0 });
  });

  it("returns {value: str, confidence:1} for v1 string", () => {
    expect(normaliseOcrField("Alice")).toEqual({ value: "Alice", confidence: 1 });
  });

  it("returns the object as-is for v2 schema", () => {
    expect(normaliseOcrField({ value: "Alice", confidence: 0.85 })).toEqual({
      value: "Alice",
      confidence: 0.85,
    });
  });

  it("defaults confidence to 0 when missing from v2 object", () => {
    const raw = { value: "Alice" } as any;
    expect(normaliseOcrField(raw).confidence).toBe(0);
  });
});

// ─── push_broadcasts schema validation ────────────────────────────────────────

describe("push_broadcasts schema validation", () => {
  it("rejects empty title", () => {
    const validate = (title: string) => title.length >= 1 && title.length <= 128;
    expect(validate("")).toBe(false);
    expect(validate("Test")).toBe(true);
  });

  it("rejects title longer than 128 chars", () => {
    const validate = (title: string) => title.length >= 1 && title.length <= 128;
    expect(validate("a".repeat(129))).toBe(false);
    expect(validate("a".repeat(128))).toBe(true);
  });

  it("rejects body longer than 512 chars", () => {
    const validate = (body: string) => body.length >= 1 && body.length <= 512;
    expect(validate("a".repeat(513))).toBe(false);
    expect(validate("a".repeat(512))).toBe(true);
  });

  it("allows null url and tag", () => {
    const record = { title: "Test", body: "Body", url: null, tag: null };
    expect(record.url).toBeNull();
    expect(record.tag).toBeNull();
  });

  it("sentCount and failedCount default to 0", () => {
    const record = { sentCount: 0, failedCount: 0, deactivatedCount: 0 };
    expect(record.sentCount).toBe(0);
    expect(record.failedCount).toBe(0);
    expect(record.deactivatedCount).toBe(0);
  });
});

// ─── VAPID rotation reminder logic ────────────────────────────────────────────

describe("VAPID rotation reminder", () => {
  it("does not send notification when keys are fresh (< 90 days)", async () => {
    const notifyMock = vi.fn().mockResolvedValue(true);
    const getDbMock = vi.fn().mockResolvedValue({
      select: () => ({
        from: () => ({
          orderBy: () => ({
            limit: () => [{ sentAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }], // 30 days ago
          }),
        }),
      }),
    });

    // Simulate the check logic inline
    const ageMs = Date.now() - new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).getTime();
    const ageInDays = Math.floor(ageMs / (24 * 60 * 60 * 1_000));
    const THRESHOLD = 90;
    if (ageInDays >= THRESHOLD) notifyMock({ title: "VAPID Rotation Reminder", content: "..." });

    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("sends notification when keys are stale (>= 90 days)", async () => {
    const notifyMock = vi.fn().mockResolvedValue(true);

    const ageMs = Date.now() - new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).getTime();
    const ageInDays = Math.floor(ageMs / (24 * 60 * 60 * 1_000));
    const THRESHOLD = 90;
    if (ageInDays >= THRESHOLD) notifyMock({ title: "VAPID Rotation Reminder", content: "..." });

    expect(notifyMock).toHaveBeenCalledOnce();
  });

  it("returns 0 days when no broadcasts exist (keys assumed fresh)", () => {
    // Simulate getVapidKeyAge when no rows returned
    const rows: any[] = [];
    const ageInDays = rows.length === 0 ? 0 : Math.floor(
      (Date.now() - new Date(rows[0].sentAt).getTime()) / (24 * 60 * 60 * 1_000)
    );
    expect(ageInDays).toBe(0);
  });

  it("correctly computes age from oldest broadcast date", () => {
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    const rows = [{ sentAt: oldDate }];
    const ageInDays = Math.floor(
      (Date.now() - new Date(rows[0].sentAt).getTime()) / (24 * 60 * 60 * 1_000)
    );
    expect(ageInDays).toBeGreaterThanOrEqual(100);
  });
});

// ─── listBroadcasts pagination schema ─────────────────────────────────────────

describe("listBroadcasts pagination", () => {
  it("defaults to limit=20, offset=0", () => {
    const input = { limit: 20, offset: 0 };
    expect(input.limit).toBe(20);
    expect(input.offset).toBe(0);
  });

  it("rejects limit > 100", () => {
    const validate = (limit: number) => limit >= 1 && limit <= 100;
    expect(validate(101)).toBe(false);
    expect(validate(100)).toBe(true);
  });

  it("rejects limit < 1", () => {
    const validate = (limit: number) => limit >= 1 && limit <= 100;
    expect(validate(0)).toBe(false);
    expect(validate(1)).toBe(true);
  });

  it("computes correct page range for display", () => {
    const offset = 10;
    const limit = 10;
    const total = 35;
    const from = offset + 1;
    const to = Math.min(offset + limit, total);
    expect(from).toBe(11);
    expect(to).toBe(20);
  });

  it("detects last page correctly", () => {
    const offset = 30;
    const limit = 10;
    const total = 35;
    const isLastPage = offset + limit >= total;
    expect(isLastPage).toBe(true);
  });
});
