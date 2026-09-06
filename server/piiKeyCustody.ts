import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getPgPool } from "./db";
import { ENV } from "./_core/env";
import { router, writeProcedure, protectedProcedure } from "./_core/trpc";
import { permifyCheck } from "./permify";
import { appendPiiForensicAuditEvent, readVerifiedPiiForensicEvents } from "./piiForensicAudit";
import { assertTransitKeyReference } from "./piiEnvelopeCrypto";
import { loadVaultTransitClient, parseVaultTransitRef } from "./vaultTransit";
import { beginTenantTransaction } from "./tenantRls";

const registryKindSchema = z.enum(["encryption", "blind_index"]);
const modeSchema = z.enum(["transit_rewrap", "transit_reencrypt", "legacy_cutover"]);
const severitySchema = z.enum(["low", "medium", "high", "critical"]);
const incidentRefSchema = z.string().regex(/^BIS-KC-[A-Z0-9]{18}$/);
const rotationRefSchema = z.string().regex(/^BIS-PR-[A-Z0-9]{18}$/);

function incidentRef(): string { return `BIS-KC-${randomUUID().replace(/-/g, "").slice(0, 18).toUpperCase()}`; }
function rotationRef(): string { return `BIS-PR-${randomUUID().replace(/-/g, "").slice(0, 18).toUpperCase()}`; }
function tenant(ctx: { tenantId: number | null }): number { if (!ctx.tenantId) throw new TRPCError({ code: "FORBIDDEN", message: "Tenant context is required." }); return ctx.tenantId; }
async function pool() { const db = await getPgPool(); if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "PostgreSQL is unavailable." }); return db; }
function assertEnabled(): void {
  if (ENV.isProduction && process.env.BIS_PII_KEY_CUSTODY_ENABLED !== "true") throw new TRPCError({ code: "FORBIDDEN", message: "PII key-custody operations are disabled pending security approval." });
  if (ENV.isProduction && process.env.BIS_PII_CRYPTO_PROVIDER !== "vault_transit") throw new TRPCError({ code: "FORBIDDEN", message: "PII key-custody requires direct Vault Transit configuration." });
}
function custodyProcedure(permission: "manage_pii_key_custody" | "supervise_pii_key_custody", roles: string[]) {
  return writeProcedure.use(async ({ ctx, next }) => {
    const tenantId = tenant(ctx); assertEnabled();
    if (!ctx.user || !roles.includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "A designated PII key-custody role is required." });
    if (ENV.isProduction && !(await permifyCheck("platform", String(tenantId), permission, String(ctx.user.id)))) throw new TRPCError({ code: "FORBIDDEN", message: "PII key-custody permission denied." });
    return next({ ctx });
  });
}
const custodianProcedure = custodyProcedure("manage_pii_key_custody", ["supervisor"]);
const commanderProcedure = custodyProcedure("supervise_pii_key_custody", ["supervisor"]);

async function registryForUpdate(client: import("pg").PoolClient, tenantId: number, kind: "encryption" | "blind_index", registryId: number) {
  const table = kind === "encryption" ? "pii_encryption_key_registry" : "pii_blind_index_key_registry";
  const row = await client.query<{ id: number; key_version: string; external_key_ref: string; provider: string; provider_key_name: string | null; provider_key_version: number | null; status: string; created_by: number }>(`SELECT id,key_version,external_key_ref,provider,provider_key_name,provider_key_version,status,created_by FROM ${table} WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [registryId, tenantId]);
  if (!row.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant key registry not found." });
  return { table, row: row.rows[0] };
}

export const piiKeyCustodyRouter = router({
  registerStagedVaultKey: custodianProcedure.input(z.object({ kind: registryKindSchema, keyVersion: z.string().trim().regex(/^[A-Za-z0-9._-]{1,64}$/), externalKeyRef: z.string().trim().min(20).max(512) })).mutation(async ({ ctx, input }) => {
    const tenantId = tenant(ctx); const db = await pool(); const client = await db.connect();
    try {
      await beginTenantTransaction(client, tenantId);
      const vault = loadVaultTransitClient();
      const parsed = parseVaultTransitRef(input.externalKeyRef, vault.mount);
      const metadata = input.kind === "encryption"
        ? await vault.assertDerivedAes256Gcm(parsed.keyName)
        : await vault.assertDerivedHmac(parsed.keyName);
      const table = input.kind === "encryption" ? "pii_encryption_key_registry" : "pii_blind_index_key_registry";
      const algorithm = input.kind === "encryption" ? "VAULT-TRANSIT-AES256-GCM96" : "VAULT-TRANSIT-HMAC-SHA256";
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO ${table} (tenant_id,key_version,external_key_ref,algorithm,status,created_by,provider,provider_key_name,provider_key_version)
         VALUES ($1,$2,$3,$4,'staged',$5,'vault_transit',$6,$7) RETURNING id`,
        [tenantId, input.keyVersion, input.externalKeyRef, algorithm, ctx.user.id, parsed.keyName, metadata.latestVersion],
      );
      await appendPiiForensicAuditEvent(client, { tenantId, actorUserId: ctx.user.id, eventType: "rotation_created", detail: { registry_id: inserted.rows[0]!.id, target_key_version: input.keyVersion, provider_key_version: metadata.latestVersion, state: "staged", worker_version: "pii-key-custody-v1" } });
      await client.query("COMMIT"); return { registryId: inserted.rows[0]!.id, kind: input.kind, status: "staged" as const };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),

  activateStagedVaultKey: commanderProcedure.input(z.object({ kind: registryKindSchema, registryId: z.number().int().positive(), evidenceReference: z.string().trim().min(12).max(256) })).mutation(async ({ ctx, input }) => {
    const tenantId = tenant(ctx); const db = await pool(); const client = await db.connect();
    try {
      await beginTenantTransaction(client, tenantId);
      const { table, row } = await registryForUpdate(client, tenantId, input.kind, input.registryId);
      if (row.status !== "staged" || row.provider !== "vault_transit" || !row.provider_key_version) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only a staged Vault Transit registry can be activated." });
      if (row.created_by === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "A separate authorized incident commander must activate a staged Vault Transit key." });
      const vault = loadVaultTransitClient();
      await assertTransitKeyReference(vault, { keyVersion: row.key_version, externalKeyRef: row.external_key_ref, providerKeyVersion: row.provider_key_version }, input.kind);
      await client.query(`UPDATE ${table} SET status='retiring',retires_at=COALESCE(retires_at,NOW()+INTERVAL '90 days') WHERE tenant_id=$1 AND status='active'`, [tenantId]);
      await client.query(`UPDATE ${table} SET status='active',activated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND status='staged'`, [input.registryId, tenantId]);
      await appendPiiForensicAuditEvent(client, { tenantId, actorUserId: ctx.user.id, eventType: "recovery_verified", detail: { registry_id: input.registryId, target_key_version: row.key_version, provider_key_version: row.provider_key_version, evidence_ref: input.evidenceReference, state: "active", worker_version: "pii-key-custody-v1" } });
      await client.query("COMMIT"); return { registryId: input.registryId, status: "active" as const };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),

  reportSuspectedCompromise: commanderProcedure.input(z.object({ severity: severitySchema, encryptionRegistryIds: z.array(z.number().int().positive()).min(1).max(20), blindIndexRegistryIds: z.array(z.number().int().positive()).max(20).default([]), counselReference: z.string().trim().min(12).max(256).optional(), evidenceReference: z.string().trim().min(12).max(256) })).mutation(async ({ ctx, input }) => {
    const tenantId = tenant(ctx); const db = await pool(); const client = await db.connect();
    try {
      await beginTenantTransaction(client, tenantId);
      const incident = await client.query<{ id: string; incident_ref: string }>(`INSERT INTO pii_key_compromise_incidents (incident_ref,tenant_id,severity,reported_by,commander_user_id,counsel_reference,evidence_reference) VALUES ($1,$2,$3,$4,$4,$5,$6) RETURNING id,incident_ref`, [incidentRef(), tenantId, input.severity, ctx.user.id, input.counselReference ?? null, input.evidenceReference]);
      const incidentRow = incident.rows[0]!;
      for (const id of input.encryptionRegistryIds) {
        const { row } = await registryForUpdate(client, tenantId, "encryption", id);
        if (["retired", "compromised"].includes(row.status)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "An impacted encryption registry is already retired or compromised." });
        await client.query(`UPDATE pii_encryption_key_registry SET status='compromised',compromised_at=NOW(),compromise_incident_id=$1 WHERE id=$2 AND tenant_id=$3`, [incidentRow.id, id, tenantId]);
        await client.query(`INSERT INTO pii_key_compromise_impacts (incident_id,encryption_key_registry_id,impact_scope) VALUES ($1,$2,'encryption')`, [incidentRow.id, id]);
        await appendPiiForensicAuditEvent(client, { incidentId: incidentRow.id, tenantId, actorUserId: ctx.user.id, eventType: "key_compromised", detail: { registry_id: id, reason_code: "SUSPECTED_KEY_COMPROMISE", evidence_ref: input.evidenceReference, incident_ref: incidentRow.incident_ref } });
      }
      for (const id of input.blindIndexRegistryIds) {
        const { row } = await registryForUpdate(client, tenantId, "blind_index", id);
        if (["retired", "compromised"].includes(row.status)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "An impacted blind-index registry is already retired or compromised." });
        await client.query(`UPDATE pii_blind_index_key_registry SET status='compromised',compromised_at=NOW(),compromise_incident_id=$1 WHERE id=$2 AND tenant_id=$3`, [incidentRow.id, id, tenantId]);
        await client.query(`INSERT INTO pii_key_compromise_impacts (incident_id,blind_index_key_registry_id,impact_scope) VALUES ($1,$2,'blind_index')`, [incidentRow.id, id]);
        await appendPiiForensicAuditEvent(client, { incidentId: incidentRow.id, tenantId, actorUserId: ctx.user.id, eventType: "key_contained", detail: { registry_id: id, reason_code: "SUSPECTED_BLIND_INDEX_KEY_COMPROMISE", evidence_ref: input.evidenceReference, incident_ref: incidentRow.incident_ref } });
      }
      await client.query(`UPDATE pii_key_compromise_incidents SET status='contained',contained_at=NOW(),updated_at=NOW() WHERE id=$1`, [incidentRow.id]);
      await appendPiiForensicAuditEvent(client, { incidentId: incidentRow.id, tenantId, actorUserId: ctx.user.id, eventType: "incident_created", detail: { incident_ref: incidentRow.incident_ref, evidence_ref: input.evidenceReference, state: "contained" } });
      await client.query("COMMIT"); return { incidentRef: incidentRow.incident_ref, status: "contained" as const };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),

  createRotationJob: commanderProcedure.input(z.object({ sourceEncryptionRegistryId: z.number().int().positive(), targetEncryptionRegistryId: z.number().int().positive(), sourceBlindIndexRegistryId: z.number().int().positive().optional(), targetBlindIndexRegistryId: z.number().int().positive().optional(), incidentRef: incidentRefSchema.optional(), mode: modeSchema, dryRun: z.boolean().default(true), maxBatchSize: z.number().int().min(1).max(200).default(50) })).mutation(async ({ ctx, input }) => {
    if ((input.sourceBlindIndexRegistryId === undefined) !== (input.targetBlindIndexRegistryId === undefined)) throw new TRPCError({ code: "BAD_REQUEST", message: "Blind-index rotation requires both source and target key registries." });
    if (!input.dryRun && process.env.BIS_PII_ROTATION_CREATE_CONFIRM !== "CREATE_PII_ROTATION") throw new TRPCError({ code: "FORBIDDEN", message: "Non-dry-run rotation requires explicit change approval." });
    if (!input.dryRun && ENV.isProduction && process.env.BIS_PII_PRODUCTION_ROTATION_APPROVED !== "true") throw new TRPCError({ code: "FORBIDDEN", message: "Production PII rotation requires recorded production approval." });
    const tenantId = tenant(ctx); const db = await pool(); const client = await db.connect();
    try {
      await beginTenantTransaction(client, tenantId);
      const source = await registryForUpdate(client, tenantId, "encryption", input.sourceEncryptionRegistryId);
      const target = await registryForUpdate(client, tenantId, "encryption", input.targetEncryptionRegistryId);
      if (target.row.status !== "active" || target.row.provider !== "vault_transit") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Rotation target must be an active tenant Vault Transit key registry." });
      if (input.mode === "transit_rewrap" && (source.row.provider !== "vault_transit" || source.row.external_key_ref !== target.row.external_key_ref)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Transit rewrap requires source and target registry references to the same Transit key." });
      let incidentId: string | null = null;
      if (input.incidentRef) {
        const incident = await client.query<{ id: string; status: string }>(`SELECT id,status FROM pii_key_compromise_incidents WHERE incident_ref=$1 AND tenant_id=$2 FOR UPDATE`, [input.incidentRef, tenantId]);
        if (!incident.rows[0] || !["contained", "rotation_queued", "rotating"].includes(incident.rows[0].status)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Tenant incident is not eligible for a rotation job." });
        incidentId = incident.rows[0].id;
      }
      if (input.sourceBlindIndexRegistryId) {
        await registryForUpdate(client, tenantId, "blind_index", input.sourceBlindIndexRegistryId);
        const blindTarget = await registryForUpdate(client, tenantId, "blind_index", input.targetBlindIndexRegistryId!);
        if (blindTarget.row.status !== "active" || blindTarget.row.provider !== "vault_transit") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Blind-index rotation target must be an active tenant Vault Transit registry." });
      }
      const inserted = await client.query<{ id: string; rotation_ref: string }>(`INSERT INTO pii_rotation_jobs (rotation_ref,tenant_id,source_encryption_key_registry_id,target_encryption_key_registry_id,source_blind_index_key_registry_id,target_blind_index_key_registry_id,compromise_incident_id,mode,dry_run,max_batch_size,requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,rotation_ref`, [rotationRef(), tenantId, input.sourceEncryptionRegistryId, input.targetEncryptionRegistryId, input.sourceBlindIndexRegistryId ?? null, input.targetBlindIndexRegistryId ?? null, incidentId, input.mode, input.dryRun, input.maxBatchSize, ctx.user.id]);
      if (incidentId) await client.query(`UPDATE pii_key_compromise_incidents SET status='rotation_queued',updated_at=NOW() WHERE id=$1 AND status='contained'`, [incidentId]);
      await appendPiiForensicAuditEvent(client, { incidentId, tenantId, rotationJobId: inserted.rows[0]!.id, actorUserId: ctx.user.id, eventType: "rotation_created", detail: { source_registry_id: input.sourceEncryptionRegistryId, target_registry_id: input.targetEncryptionRegistryId, dry_run: input.dryRun, state: "queued" } });
      await client.query("COMMIT"); return { rotationRef: inserted.rows[0]!.rotation_ref, dryRun: input.dryRun };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),

  closeIncident: commanderProcedure.input(z.object({ incidentRef: incidentRefSchema, resolutionReference: z.string().trim().min(12).max(256), close: z.boolean().default(false) })).mutation(async ({ ctx, input }) => {
    const tenantId = tenant(ctx); const db = await pool(); const client = await db.connect();
    try {
      await beginTenantTransaction(client, tenantId);
      const incident = await client.query<{ id: string; status: string }>(`SELECT id,status FROM pii_key_compromise_incidents WHERE incident_ref=$1 AND tenant_id=$2 FOR UPDATE`, [input.incidentRef, tenantId]);
      const row = incident.rows[0];
      if (!row || !["contained", "rotation_queued", "rotating", "recovering", "resolved"].includes(row.status)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Incident cannot be resolved from its current state." });
      const next = input.close ? "closed" : "resolved";
      await client.query(`UPDATE pii_key_compromise_incidents SET status=$2,resolved_at=NOW(),updated_at=NOW(),evidence_reference=$3 WHERE id=$1`, [row.id, next, input.resolutionReference]);
      await appendPiiForensicAuditEvent(client, { incidentId: row.id, tenantId, actorUserId: ctx.user.id, eventType: input.close ? "incident_closed" : "incident_resolved", detail: { incident_ref: input.incidentRef, evidence_ref: input.resolutionReference, state: next } });
      await client.query("COMMIT"); return { incidentRef: input.incidentRef, status: next };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }),

  listForensics: protectedProcedure.input(z.object({ incidentRef: incidentRefSchema.optional(), limit: z.number().int().min(1).max(200).default(100) })).query(async ({ ctx, input }) => {
    const tenantId = tenant(ctx); assertEnabled();
    if (!ctx.user || !["admin", "supervisor", "auditor"].includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: "A designated PII forensic-read role is required." });
    if (ENV.isProduction && !(await permifyCheck("platform", String(tenantId), "view_pii_forensics", String(ctx.user.id)))) throw new TRPCError({ code: "FORBIDDEN", message: "PII forensic-read permission denied." });
    const db = await pool();
    const client = await db.connect();
    try {
      await beginTenantTransaction(client, tenantId);
      const events = await readVerifiedPiiForensicEvents(client, tenantId, input.incidentRef, input.limit);
      await client.query("COMMIT");
      return events;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "PII forensic audit verification failed.", cause: error });
    } finally {
      client.release();
    }
  }),
});
