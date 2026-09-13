import { describe, expect, it, vi } from "vitest";
import { FORENSIC_EXPORT_MAX_EVENTS, FORENSIC_EXPORT_PAGE_SIZE, iterateVerifiedForensicExport } from "./piiForensicExport";

const event = (id: number) => ({
  id,
  createdAt: "2026-09-06T00:00:00.000Z",
  eventType: "rotation_progress",
  detail: { worker_version: "test" },
  integrityHash: "a".repeat(64),
  integrityScheme: "hmac_sha256_canonical_json_v2",
  incidentRef: null,
  incidentStatus: null,
});

async function collect(iterator: AsyncGenerator<ReturnType<typeof event>, number, void>) {
  const output: ReturnType<typeof event>[] = [];
  for await (const value of iterator) output.push(value);
  return output;
}

describe("iterateVerifiedForensicExport", () => {
  it("streams bounded verified pages without retaining a whole history", async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ events: [event(3), event(2)], nextCursor: "next" })
      .mockResolvedValueOnce({ events: [event(1)], nextCursor: null });
    await expect(collect(iterateVerifiedForensicExport(fetchPage))).resolves.toMatchObject([event(3), event(2), event(1)]);
    expect(fetchPage).toHaveBeenNthCalledWith(1, { limit: FORENSIC_EXPORT_PAGE_SIZE, cursor: undefined, incidentRef: undefined });
    expect(fetchPage).toHaveBeenNthCalledWith(2, { limit: FORENSIC_EXPORT_PAGE_SIZE, cursor: "next", incidentRef: undefined });
  });

  it("fails rather than exporting an unverified duplicate immutable event", async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ events: [event(2)], nextCursor: "next" })
      .mockResolvedValueOnce({ events: [event(2)], nextCursor: null });
    await expect(collect(iterateVerifiedForensicExport(fetchPage))).rejects.toThrow("duplicate or invalid");
  });

  it("propagates an expired-cursor page error without creating a mixed export", async () => {
    const fetchPage = vi.fn().mockRejectedValue(new Error("PII forensic pagination cursor is invalid or expired."));
    await expect(collect(iterateVerifiedForensicExport(fetchPage))).rejects.toThrow("invalid or expired");
  });

  it("rejects unsafe export bounds before requesting a page", async () => {
    const fetchPage = vi.fn();
    await expect(collect(iterateVerifiedForensicExport(fetchPage, { maxEvents: FORENSIC_EXPORT_MAX_EVENTS + 1 }))).rejects.toThrow("forensic export maximum");
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
