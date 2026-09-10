import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  FORENSIC_EXPORT_FORMAT,
  forensicExportEventSchema,
  serializeForensicExportRecord,
} from "./forensicExportProtocol";
import { ForensicExportVerificationError, verifyForensicExport } from "../scripts/verify-forensic-export";

const event = (id: number) => ({
  id,
  createdAt: "2026-09-06T00:00:00.000Z",
  eventType: "rotation_progress" as const,
  detail: { worker_version: "offline-verifier-test" },
  integrityHash: "a".repeat(64),
  integrityScheme: "hmac_sha256_canonical_json_v2" as const,
  incidentRef: null,
  incidentStatus: null,
});

function stream(...records: string[]): Readable {
  return Readable.from(records);
}

function manifest(maxEvents = 10) {
  return serializeForensicExportRecord({
    type: "manifest",
    format: FORENSIC_EXPORT_FORMAT,
    generatedAt: "2026-09-06T00:00:00.000Z",
    maxEvents,
    incidentRef: null,
  });
}

function eventRecord(id: number) {
  return serializeForensicExportRecord({ type: "event", event: event(id) });
}

function complete(eventCount: number) {
  return serializeForensicExportRecord({ type: "complete", eventCount });
}

describe("forensic NDJSON protocol", () => {
  it("accepts a complete bounded export with exact duplicate detection", async () => {
    await expect(verifyForensicExport(stream(manifest(), eventRecord(2), eventRecord(1), complete(2)))).resolves.toEqual({
      format: FORENSIC_EXPORT_FORMAT,
      generatedAt: "2026-09-06T00:00:00.000Z",
      eventCount: 2,
      incidentRef: null,
    });
  });

  it("rejects a truncated stream that lacks a completion record", async () => {
    await expect(verifyForensicExport(stream(manifest(), eventRecord(1)))).rejects.toBeInstanceOf(ForensicExportVerificationError);
  });

  it("rejects duplicate immutable IDs without retaining unbounded data", async () => {
    await expect(verifyForensicExport(stream(manifest(), eventRecord(1), eventRecord(1), complete(2)))).rejects.toBeInstanceOf(ForensicExportVerificationError);
  });

  it("rejects a mismatched completion count and post-completion data", async () => {
    await expect(verifyForensicExport(stream(manifest(), eventRecord(1), complete(2)))).rejects.toBeInstanceOf(ForensicExportVerificationError);
    await expect(verifyForensicExport(stream(manifest(), eventRecord(1), complete(1), eventRecord(2)))).rejects.toBeInstanceOf(ForensicExportVerificationError);
  });

  it("rejects an event outside the manifest incident scope", async () => {
    const incidentRef = "BIS-KC-1234567890ABCDEFGH";
    const scopedManifest = serializeForensicExportRecord({ type: "manifest", format: FORENSIC_EXPORT_FORMAT, generatedAt: "2026-09-06T00:00:00.000Z", maxEvents: 1, incidentRef });
    await expect(verifyForensicExport(stream(scopedManifest, eventRecord(1), complete(1)))).rejects.toBeInstanceOf(ForensicExportVerificationError);
  });

  it("rejects an oversized unterminated record before readline can buffer it", async () => {
    await expect(verifyForensicExport(stream("{" + "x".repeat(64 * 1024 + 1)))).rejects.toBeInstanceOf(ForensicExportVerificationError);
  });

  it("rejects unapproved detail keys and unexpected record fields", () => {
    expect(() => forensicExportEventSchema.parse({ ...event(1), detail: { subject_name: "must-not-export" } })).toThrow();
    expect(() => JSON.parse(serializeForensicExportRecord({ type: "complete", eventCount: 0, extra: true } as never))).toThrow();
  });
});
