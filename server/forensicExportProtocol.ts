import { z } from "zod";

export const FORENSIC_EXPORT_FORMAT = "bis-pii-forensic-audit-ndjson-v1";
export const FORENSIC_EXPORT_PAGE_SIZE = 200;
export const FORENSIC_EXPORT_MAX_EVENTS = 10_000;
export const FORENSIC_EXPORT_MAX_RECORD_BYTES = 64 * 1024;

export const PII_FORENSIC_EVENT_TYPES = [
  "incident_created",
  "key_contained",
  "key_compromised",
  "rotation_created",
  "rotation_dry_run_completed",
  "rotation_started",
  "rotation_progress",
  "rotation_completed",
  "rotation_failed",
  "access_revoked",
  "recovery_verified",
  "incident_resolved",
  "incident_closed",
] as const;

export const PII_FORENSIC_DETAIL_KEYS = [
  "record_count",
  "registry_id",
  "source_registry_id",
  "target_registry_id",
  "rotation_job_id",
  "reason_code",
  "error_code",
  "actor_role",
  "source_key_version",
  "target_key_version",
  "provider_key_version",
  "evidence_ref",
  "channel",
  "dry_run",
  "checkpoint",
  "state",
  "worker_version",
  "incident_ref",
] as const;

const piiForensicDetailKeySet = new Set<string>(PII_FORENSIC_DETAIL_KEYS);
const forensicPrimitiveSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const isoTimestampSchema = z.string().datetime({ offset: true });
export const forensicIncidentReferenceSchema = z.string().regex(/^BIS-KC-[A-Z0-9]{18}$/);

export const piiForensicDetailSchema = z.record(z.string(), forensicPrimitiveSchema).superRefine((detail, context) => {
  for (const key of Object.keys(detail)) {
    if (!piiForensicDetailKeySet.has(key)) {
      context.addIssue({ code: "custom", message: "forensic event detail contains an unapproved key" });
    }
  }
});

export const forensicExportEventSchema = z.object({
  id: z.number().int().positive(),
  createdAt: isoTimestampSchema,
  eventType: z.enum(PII_FORENSIC_EVENT_TYPES),
  detail: piiForensicDetailSchema,
  integrityHash: z.string().regex(/^[0-9a-f]{64}$/),
  integrityScheme: z.literal("hmac_sha256_canonical_json_v2"),
  incidentRef: forensicIncidentReferenceSchema.nullable(),
  incidentStatus: z.enum(["suspected", "contained", "rotation_queued", "rotating", "recovering", "resolved", "closed"]).nullable(),
}).strict();

export const forensicExportManifestSchema = z.object({
  type: z.literal("manifest"),
  format: z.literal(FORENSIC_EXPORT_FORMAT),
  generatedAt: isoTimestampSchema,
  maxEvents: z.number().int().min(1).max(FORENSIC_EXPORT_MAX_EVENTS),
  incidentRef: forensicIncidentReferenceSchema.nullable(),
}).strict();

export const forensicExportEventRecordSchema = z.object({
  type: z.literal("event"),
  event: forensicExportEventSchema,
}).strict();

export const forensicExportCompleteSchema = z.object({
  type: z.literal("complete"),
  eventCount: z.number().int().min(0).max(FORENSIC_EXPORT_MAX_EVENTS),
}).strict();

export const forensicExportRecordSchema = z.discriminatedUnion("type", [
  forensicExportManifestSchema,
  forensicExportEventRecordSchema,
  forensicExportCompleteSchema,
]);

export type ForensicExportEvent = z.infer<typeof forensicExportEventSchema>;
export type ForensicExportManifest = z.infer<typeof forensicExportManifestSchema>;
export type ForensicExportComplete = z.infer<typeof forensicExportCompleteSchema>;
export type ForensicExportRecord = z.infer<typeof forensicExportRecordSchema>;

export function toForensicExportEvent(value: unknown): ForensicExportEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return forensicExportEventSchema.parse(value);
  const candidate = value as Record<string, unknown>;
  const createdAt = candidate.createdAt instanceof Date ? candidate.createdAt.toISOString() : candidate.createdAt;
  return forensicExportEventSchema.parse({ ...candidate, createdAt });
}

export function serializeForensicExportRecord(value: ForensicExportRecord): string {
  return `${JSON.stringify(forensicExportRecordSchema.parse(value))}\n`;
}
