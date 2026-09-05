import { createHash } from "node:crypto";
import { getPgPool } from "../server/db";
import { encryptPiiEnvelope, loadPiiEnvelopeKeyring, piiAad, piiBlindIndex } from "../server/piiEnvelopeCrypto";

const BATCH_SIZE = 100;
if (process.env.BIS_PII_BACKFILL_CONFIRM !== "ENCRYPT_LEGACY_PII") {
  throw new Error("Refusing PII backfill: set BIS_PII_BACKFILL_CONFIRM=ENCRYPT_LEGACY_PII after backup and counsel approval.");
}
if (process.env.BIS_ENV === "production" && process.env.BIS_PII_PRODUCTION_BACKFILL_APPROVED !== "true") {
  throw new Error("Refusing production PII backfill without BIS_PII_PRODUCTION_BACKFILL_APPROVED=true.");
}

function defined(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null && value !== undefined && value !== ""));
}
function normalized(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim().toUpperCase().replace(/[^A-Z0-9@.+-]/g, "");
  return result || null;
}
async function insertEnvelope(client: import("pg").PoolClient, input: { tenantId: number; subjectKind: "candidate_profile" | "criminal_record"; subjectId: number; purpose: string; payload: Record<string, unknown>; keyRegistryId: number; keyring: ReturnType<typeof loadPiiEnvelopeKeyring> }) {
  if (!Object.keys(input.payload).length) return;
  const encrypted = encryptPiiEnvelope(input.keyring, piiAad(input.tenantId, input.subjectKind, input.subjectId, input.purpose), input.payload);
  await client.query(`INSERT INTO pii_envelope_records (tenant_id,subject_kind,subject_id,purpose,ciphertext,nonce,key_registry_id,plaintext_sha256) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id,subject_kind,subject_id,purpose) WHERE retired_at IS NULL DO NOTHING`, [input.tenantId,input.subjectKind,input.subjectId,input.purpose,encrypted.ciphertext,encrypted.nonce,input.keyRegistryId,createHash("sha256").update(JSON.stringify(input.payload)).digest("hex")]);
}
async function insertBlindIndex(client: import("pg").PoolClient, input: { tenantId: number; subjectKind: "candidate_profile" | "criminal_record"; subjectId: number; attribute: "nin" | "bvn" | "passport_number" | "email" | "phone"; value: unknown; keyring: ReturnType<typeof loadPiiEnvelopeKeyring> }) {
  const value = normalized(input.value); if (!value) return;
  await client.query(`INSERT INTO pii_blind_indexes (tenant_id,subject_kind,subject_id,attribute_name,key_version,normalized_hmac) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [input.tenantId,input.subjectKind,input.subjectId,input.attribute,input.keyring.blindIndexVersion,piiBlindIndex(input.keyring,value)]);
}
async function run() {
  const pool = await getPgPool(); if (!pool) throw new Error("PostgreSQL is unavailable.");
  const keyring = loadPiiEnvelopeKeyring(); const client = await pool.connect();
  try {
    const keys = await client.query<{ tenant_id:number; id:number }>(`SELECT tenant_id,id FROM pii_encryption_key_registry WHERE key_version=$1 AND status='active' AND (retires_at IS NULL OR retires_at > NOW())`, [keyring.activeVersion]);
    const byTenant = new Map(keys.rows.map((row) => [row.tenant_id,row.id])); if (!byTenant.size) throw new Error("No active PII key-registry row matches the configured key version.");
    let candidateCursor = 0; for (;;) { const rows = await client.query<any>(`SELECT id,"tenantId",email,phone,nin,bvn,dob,"currentAddress","addressHistory","passportNumber","passportExpiry" FROM candidate_profiles WHERE id>$1 ORDER BY id ASC LIMIT $2`,[candidateCursor,BATCH_SIZE]); if (!rows.rowCount) break; await client.query("BEGIN"); for (const row of rows.rows) { const keyRegistryId=byTenant.get(row.tenantId); if (!keyRegistryId) throw new Error(`No active PII key registry configured for tenant ${row.tenantId}.`); await insertEnvelope(client,{tenantId:row.tenantId,subjectKind:"candidate_profile",subjectId:row.id,purpose:"identity",payload:defined({nin:row.nin,bvn:row.bvn,dob:row.dob,passportNumber:row.passportNumber,passportExpiry:row.passportExpiry}),keyRegistryId,keyring}); await insertEnvelope(client,{tenantId:row.tenantId,subjectKind:"candidate_profile",subjectId:row.id,purpose:"contact",payload:defined({email:row.email,phone:row.phone}),keyRegistryId,keyring}); await insertEnvelope(client,{tenantId:row.tenantId,subjectKind:"candidate_profile",subjectId:row.id,purpose:"address",payload:defined({currentAddress:row.currentAddress,addressHistory:row.addressHistory}),keyRegistryId,keyring}); await insertBlindIndex(client,{tenantId:row.tenantId,subjectKind:"candidate_profile",subjectId:row.id,attribute:"nin",value:row.nin,keyring}); await insertBlindIndex(client,{tenantId:row.tenantId,subjectKind:"candidate_profile",subjectId:row.id,attribute:"bvn",value:row.bvn,keyring}); await insertBlindIndex(client,{tenantId:row.tenantId,subjectKind:"candidate_profile",subjectId:row.id,attribute:"passport_number",value:row.passportNumber,keyring}); await insertBlindIndex(client,{tenantId:row.tenantId,subjectKind:"candidate_profile",subjectId:row.id,attribute:"email",value:row.email,keyring}); await insertBlindIndex(client,{tenantId:row.tenantId,subjectKind:"candidate_profile",subjectId:row.id,attribute:"phone",value:row.phone,keyring}); candidateCursor=row.id; } await client.query("COMMIT"); }
    let criminalCursor = 0; for (;;) { const rows = await client.query<any>(`SELECT id,"tenantId","subjectName",nin,dob,aliases,"offenceDescription","offenceLocation",sentence,"warrantDetails","rawPayload" FROM criminal_records WHERE id>$1 AND "tenantId" IS NOT NULL ORDER BY id ASC LIMIT $2`,[criminalCursor,BATCH_SIZE]); if (!rows.rowCount) break; await client.query("BEGIN"); for (const row of rows.rows) { const keyRegistryId=byTenant.get(row.tenantId); if (!keyRegistryId) throw new Error(`No active PII key registry configured for tenant ${row.tenantId}.`); await insertEnvelope(client,{tenantId:row.tenantId,subjectKind:"criminal_record",subjectId:row.id,purpose:"criminal_record",payload:defined({subjectName:row.subjectName,nin:row.nin,dob:row.dob,aliases:row.aliases,offenceDescription:row.offenceDescription,offenceLocation:row.offenceLocation,sentence:row.sentence,warrantDetails:row.warrantDetails}),keyRegistryId,keyring}); await insertEnvelope(client,{tenantId:row.tenantId,subjectKind:"criminal_record",subjectId:row.id,purpose:"provider_payload",payload:defined({rawPayload:row.rawPayload}),keyRegistryId,keyring}); await insertBlindIndex(client,{tenantId:row.tenantId,subjectKind:"criminal_record",subjectId:row.id,attribute:"nin",value:row.nin,keyring}); criminalCursor=row.id; } await client.query("COMMIT"); }
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; } finally { client.release(); await pool.end(); }
}
run().catch((error) => { process.stderr.write(`PII envelope backfill failed: ${error instanceof Error ? error.message : "unknown error"}\n`); process.exitCode=1; });
