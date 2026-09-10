import { getPgPool } from "../server/db";
import { encryptPiiEnvelope, piiAad, piiBlindIndex, type BlindAttribute, type SubjectKind } from "../server/piiEnvelopeCrypto";
import { activeTenantBlindIndexRegistry, activeTenantEncryptionRegistry } from "../server/piiKeyRegistry";
import { beginTenantTransaction } from "../server/tenantRls";

const BATCH_SIZE = 100;
const isProduction = process.env.NODE_ENV === "production" || process.env.BIS_ENV === "production";

if (process.env.BIS_PII_BACKFILL_CONFIRM !== "ENCRYPT_LEGACY_PII") {
  throw new Error("Refusing PII backfill: set BIS_PII_BACKFILL_CONFIRM=ENCRYPT_LEGACY_PII after backup and counsel approval.");
}
if (isProduction && process.env.BIS_PII_PRODUCTION_BACKFILL_APPROVED !== "true") {
  throw new Error("Refusing production PII backfill without BIS_PII_PRODUCTION_BACKFILL_APPROVED=true.");
}
if ((process.env.BIS_PII_CRYPTO_PROVIDER ?? "") !== "vault_transit") {
  throw new Error("Refusing PII backfill unless direct Vault Transit encryption is configured.");
}

function defined(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null && value !== undefined && value !== ""));
}
function normalized(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim().toUpperCase().replace(/[^A-Z0-9@.+-]/g, "");
  return result || null;
}

async function insertEnvelope(client: import("pg").PoolClient, input: { tenantId: number; subjectKind: SubjectKind; subjectId: number; purpose: string; payload: Record<string, unknown> }): Promise<void> {
  if (!Object.keys(input.payload).length) return;
  const key = await activeTenantEncryptionRegistry(client, input.tenantId);
  const encrypted = await encryptPiiEnvelope(key, piiAad(input.tenantId, input.subjectKind, input.subjectId, input.purpose), input.payload);
  await client.query(
    `INSERT INTO pii_envelope_records
       (tenant_id,subject_kind,subject_id,purpose,ciphertext,nonce,key_registry_id,key_version,crypto_provider,provider_key_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (tenant_id,subject_kind,subject_id,purpose) WHERE retired_at IS NULL DO NOTHING`,
    [input.tenantId, input.subjectKind, input.subjectId, input.purpose, encrypted.ciphertext, encrypted.nonce, key.id, encrypted.keyVersion, encrypted.cryptoProvider, encrypted.providerKeyVersion],
  );
}

async function insertBlindIndex(client: import("pg").PoolClient, input: { tenantId: number; subjectKind: SubjectKind; subjectId: number; attribute: BlindAttribute; value: unknown }): Promise<void> {
  const value = normalized(input.value);
  if (!value) return;
  const key = await activeTenantBlindIndexRegistry(client, input.tenantId);
  const index = await piiBlindIndex(key, input.tenantId, input.attribute, value);
  await client.query(
    `INSERT INTO pii_blind_indexes
       (tenant_id,subject_kind,subject_id,attribute_name,key_version,key_registry_id,normalized_hmac,crypto_provider,provider_key_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT DO NOTHING`,
    [input.tenantId, input.subjectKind, input.subjectId, input.attribute, index.keyVersion, key.id, index.normalizedHmac, index.cryptoProvider, index.providerKeyVersion],
  );
}

async function run(): Promise<void> {
  const pool = await getPgPool();
  if (!pool) throw new Error("PostgreSQL is unavailable.");
  const client = await pool.connect();
  try {
    let candidateCursor = 0;
    for (;;) {
      const rows = await client.query<Record<string, unknown>>(
        `SELECT id,"tenantId",email,phone,nin,bvn,dob,"currentAddress","addressHistory","passportNumber","passportExpiry"
           FROM candidate_profiles WHERE id > $1 ORDER BY id ASC LIMIT $2`,
        [candidateCursor, BATCH_SIZE],
      );
      if (!rows.rowCount) break;
      for (const row of rows.rows) {
        const subjectId = Number(row.id); const tenantId = Number(row.tenantId);
        if (!Number.isInteger(tenantId) || tenantId < 1) throw new Error("Candidate profile tenant is invalid.");
        await beginTenantTransaction(client, tenantId);
        try {
          await insertEnvelope(client, { tenantId, subjectKind: "candidate_profile", subjectId, purpose: "identity", payload: defined({ nin: row.nin, bvn: row.bvn, dob: row.dob, passportNumber: row.passportNumber, passportExpiry: row.passportExpiry }) });
          await insertEnvelope(client, { tenantId, subjectKind: "candidate_profile", subjectId, purpose: "contact", payload: defined({ email: row.email, phone: row.phone }) });
          await insertEnvelope(client, { tenantId, subjectKind: "candidate_profile", subjectId, purpose: "address", payload: defined({ currentAddress: row.currentAddress, addressHistory: row.addressHistory }) });
          for (const [attribute, value] of [["nin", row.nin], ["bvn", row.bvn], ["passport_number", row.passportNumber], ["email", row.email], ["phone", row.phone]] as const) {
            await insertBlindIndex(client, { tenantId, subjectKind: "candidate_profile", subjectId, attribute, value });
          }
          await client.query("COMMIT");
        } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
        candidateCursor = subjectId;
      }
    }

    let criminalCursor = 0;
    for (;;) {
      const rows = await client.query<Record<string, unknown>>(
        `SELECT id,"tenantId","subjectName",nin,dob,aliases,"offenceDescription","offenceLocation",sentence,"warrantDetails","rawPayload"
           FROM criminal_records WHERE id > $1 AND "tenantId" IS NOT NULL ORDER BY id ASC LIMIT $2`,
        [criminalCursor, BATCH_SIZE],
      );
      if (!rows.rowCount) break;
      for (const row of rows.rows) {
        const subjectId = Number(row.id); const tenantId = Number(row.tenantId);
        if (!Number.isInteger(tenantId) || tenantId < 1) throw new Error("Criminal record tenant is invalid.");
        await beginTenantTransaction(client, tenantId);
        try {
          await insertEnvelope(client, { tenantId, subjectKind: "criminal_record", subjectId, purpose: "criminal_record", payload: defined({ subjectName: row.subjectName, nin: row.nin, dob: row.dob, aliases: row.aliases, offenceDescription: row.offenceDescription, offenceLocation: row.offenceLocation, sentence: row.sentence, warrantDetails: row.warrantDetails }) });
          await insertEnvelope(client, { tenantId, subjectKind: "criminal_record", subjectId, purpose: "provider_payload", payload: defined({ rawPayload: row.rawPayload }) });
          await insertBlindIndex(client, { tenantId, subjectKind: "criminal_record", subjectId, attribute: "nin", value: row.nin });
          await client.query("COMMIT");
        } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
        criminalCursor = subjectId;
      }
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(`PII envelope backfill failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
