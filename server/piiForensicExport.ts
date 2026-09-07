export type VerifiedForensicExportEvent = {
  id: number;
  createdAt: Date | string;
  eventType: string;
  detail: Record<string, string | number | boolean | null>;
  integrityHash: string;
  integrityScheme: string;
  incidentRef: string | null;
  incidentStatus: string | null;
};

type VerifiedForensicPage = { events: VerifiedForensicExportEvent[]; nextCursor: string | null };

export const FORENSIC_EXPORT_PAGE_SIZE = 200;
export const FORENSIC_EXPORT_MAX_EVENTS = 10_000;

export async function* iterateVerifiedForensicExport(
  fetchPage: (input: { limit: number; cursor?: string; incidentRef?: string }) => Promise<VerifiedForensicPage>,
  input: { incidentRef?: string; maxEvents?: number } = {},
): AsyncGenerator<VerifiedForensicExportEvent, number, void> {
  const maxEvents = input.maxEvents ?? FORENSIC_EXPORT_MAX_EVENTS;
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > FORENSIC_EXPORT_MAX_EVENTS) {
    throw new Error(`forensic export maximum must be an integer from 1 through ${FORENSIC_EXPORT_MAX_EVENTS}`);
  }
  let cursor: string | undefined;
  let emitted = 0;
  const ids = new Set<number>();
  do {
    const remaining = maxEvents - emitted;
    const page = await fetchPage({ limit: Math.min(FORENSIC_EXPORT_PAGE_SIZE, remaining), cursor, incidentRef: input.incidentRef });
    if (!Array.isArray(page.events) || typeof page.nextCursor !== "string" && page.nextCursor !== null) {
      throw new Error("verified forensic export received an invalid page shape");
    }
    for (const event of page.events) {
      if (!Number.isSafeInteger(event.id) || event.id <= 0 || ids.has(event.id)) {
        throw new Error("verified forensic export received a duplicate or invalid immutable event ID");
      }
      ids.add(event.id);
      yield event;
      emitted += 1;
      if (emitted === maxEvents) return emitted;
    }
    if (page.events.length === 0 && page.nextCursor) throw new Error("verified forensic export received an empty continuation page");
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return emitted;
}
