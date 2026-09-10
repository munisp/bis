import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { Transform, type Readable } from "node:stream";
import {
  FORENSIC_EXPORT_MAX_EVENTS,
  FORENSIC_EXPORT_MAX_RECORD_BYTES,
  forensicExportCompleteSchema,
  forensicExportEventRecordSchema,
  forensicExportManifestSchema,
  forensicExportRecordSchema,
  type ForensicExportManifest,
} from "../server/forensicExportProtocol";

export class ForensicExportVerificationError extends Error {
  constructor() {
    super("Forensic export is invalid or incomplete.");
  }
}

export type VerifiedForensicExport = {
  format: string;
  generatedAt: string;
  eventCount: number;
  incidentRef: string | null;
};

function invalidExport(): never {
  throw new ForensicExportVerificationError();
}

function recordLengthGuard(input: Readable): Transform {
  let recordBytes = 0;
  const guard = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      for (const byte of bytes) {
        if (byte === 0x0a) {
          recordBytes = 0;
          continue;
        }
        recordBytes += 1;
        if (recordBytes > FORENSIC_EXPORT_MAX_RECORD_BYTES) {
          callback(new ForensicExportVerificationError());
          return;
        }
      }
      callback(null, chunk);
    },
  });
  input.once("error", (error) => guard.destroy(error));
  input.pipe(guard);
  return guard;
}

export async function verifyForensicExport(input: Readable): Promise<VerifiedForensicExport> {
  const reader = createInterface({ input: recordLengthGuard(input), crlfDelay: Infinity });
  let manifest: ForensicExportManifest | null = null;
  let eventCount = 0;
  let complete = false;
  const immutableEventIds = new Set<number>();

  for await (const line of reader) {
    if (complete || !line || Buffer.byteLength(line, "utf8") > FORENSIC_EXPORT_MAX_RECORD_BYTES) invalidExport();
    let candidate: unknown;
    try {
      candidate = JSON.parse(line);
    } catch {
      invalidExport();
    }
    const parsed = forensicExportRecordSchema.safeParse(candidate);
    if (!parsed.success) invalidExport();

    if (parsed.data.type === "manifest") {
      if (manifest !== null) invalidExport();
      manifest = forensicExportManifestSchema.parse(parsed.data);
      continue;
    }
    if (manifest === null) invalidExport();

    if (parsed.data.type === "event") {
      const record = forensicExportEventRecordSchema.parse(parsed.data);
      if (eventCount >= manifest.maxEvents || immutableEventIds.has(record.event.id) || (manifest.incidentRef !== null && record.event.incidentRef !== manifest.incidentRef)) invalidExport();
      immutableEventIds.add(record.event.id);
      eventCount += 1;
      continue;
    }

    const record = forensicExportCompleteSchema.parse(parsed.data);
    if (record.eventCount !== eventCount) invalidExport();
    complete = true;
  }

  if (manifest === null || !complete || eventCount > FORENSIC_EXPORT_MAX_EVENTS) invalidExport();
  return { format: manifest.format, generatedAt: manifest.generatedAt, eventCount, incidentRef: manifest.incidentRef };
}

function usage(): void {
  process.stderr.write("Usage: pnpm exec tsx scripts/verify-forensic-export.ts <export.ndjson|->\n");
}

export async function main(args: string[]): Promise<number> {
  if (args.length !== 1 || !args[0] || (args[0].startsWith("-") && args[0] !== "-")) {
    usage();
    return 64;
  }
  try {
    const summary = await verifyForensicExport(args[0] === "-" ? process.stdin : createReadStream(resolve(args[0])));
    process.stdout.write(`${JSON.stringify({ status: "valid_complete", ...summary })}\n`);
    return 0;
  } catch {
    process.stderr.write("INVALID: forensic export is invalid or incomplete.\n");
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2)).then((exitCode) => { process.exitCode = exitCode; });
}
