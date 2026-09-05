import { getPgPool } from "../server/db";
import { encryptPiiEnvelope, loadPiiEnvelopeKeyring, piiAad, piiBlindIndex } from "../server/piiEnvelopeCrypto";

const BATCH_SIZE = 100;
const isProduction = process.env.NODE_ENV === "production" || process.env.BIS_ENV === "production";

if (process.env.BIS_PII_BACKFILL_CONFIRM !== "ENCRYPT_LEGACY_PII") {
  throw new Error("Refusing PII backfill: set BIS_PII_BACKFILL_CONFIRM=ENCRYPT_LEGACY_PII after backup and counsel approval.");
}
if (isProduction && process.env.BIS_PII_PRODUCTION_BACKFILL_APPROVED !== "true") {
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

type Keyring = ReturnType<typeof loadPiiEnvelopeKeyring>;
type SubjectKind = "candidate_profile" | "criminal_record";
type BlindAttribute = "nin" | "bvn" | "passport_number" | "email" | "phone";

async function insertEnvelope(client: import("pg").PoolClient, input: {
  tenantId: number; subjectKind: SubjectKind; subjectId: number; purpose: string;
  payload: Record<string, unknown>; keyRegistryId: number; keyring: Keyring;
}): Promise<void> {
  if (!Object.keys(input.payload).length) return;
  const encrypted = encryptPiiEnvelope(input.keyring, piiAad(input.tenantId, input.subjectKind, input.subjectId, input.purpose), input.payload);
  await client.query(
    `INSERT INTO pii_envelope_records
       (tenant_id, subject_kind, subject_id, purpose, ciphertext, nonce, key_registry_id, key_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (tenant_id,subject_kind,subject_id,purpose) WHERE retired_at IS NULL DO NOTHING`,
    [input.tenantId, input.subjectKind, input.subjectId, input.purpose, encrypted.ciphertext, encrypted.nonce, input.keyRegistryId, encrypted.keyVersion],
  );
}

async function insertBlindIndex(client: import("pg").PoolClient, input: {
  tenantId: number; subjectKind: SubjectKind; subjectId: number; attribute: BlindAttribute;
  value: unknown; keyRegistryId: number; keyring: Keyring;
}): Promise<void> {
  const value = normalized(input.value);
  if (!value) return;
  await client.query(
    `INSERT INTO pii_blind_indexes
       (tenant_id,subject_kind,subject_id,attribute_name,key_version,key_registry_id,normalized_hmac)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT DO NOTHING`,
    [input.tenantId, input.subjectKind, input.subjectId, input.attribute, input.keyring.blindIndexVersion, input.keyRegistryId, piiBlindIndex(input.keyring, value)],
  );
}

async function activeKeyRegistryByTenant(client: import("pg").PoolClient, table: "pii_encryption_key_registry" | "pii_blind_index_key_registry", keyVersion: string): Promise<Map<number, number>> {
  const rows = await client.query<{ tenant_id: number; id: number }>(
    `SELECT tenant_id, id FROM ${table}
      WHERE key_version = $1 AND status = 'active' AND (retires_at IS NULL OR retires_at > NOW())`,
    [keyVersion],
  );
  const byTenant = new Map(rows.rows.map((row) => [row.tenant_id, row.id]));
  if (!byTenant.size) throw new Error(`No active ${table} row matches the configured key version.`);
  return byTenant;
}

async function run(): Promise<void> {
  const pool = await getPgPool();
  if (!pool) throw new Error("PostgreSQL is unavailable.");
  const keyring = loadPiiEnvelopeKeyring();
  const client = await pool.connect();
  try {
    const encryptionKeys = await activeKeyRegistryByTenant(client, "pii_encryption_key_registry", keyring.activeVersion);
    const blindIndexKeys = await activeKeyRegistryByTenant(client, "pii_blind_index_key_registry", keyring.blindIndexVersion);
    let candidateCursor = 0;
    for (;;) {
      const rows = await client.query<Record<string, unknown>>(
        `SELECT id,"tenantId",email,phone,nin,bvn,dob,"currentAddress","addressHistory","passportNumber","passportExpiry"
           FROM candidate_profiles WHERE id > $1 ORDER BY id ASC LIMIT $2`,
        [candidateCursor, BATCH_SIZE],
      );
      if (!rows.rowCount) break;
      await client.query("BEGIN");
      for (const row of rows.rows) {
        const subjectId = Number(row.id); const tenantId = Number(row.tenantId);
        const encryptionKeyRegistryId = encryptionKeys.get(tenantId); const blindIndexKeyRegistryId = blindIndexKeys.get(tenantId);
        if (!encryptionKeyRegistryId || !blindIndexKeyRegistryId) throw new Error(`No active PII encryption and blind-index key registries are configured for tenant ${tenantId}.`);
        await insertEnvelope(client, { tenantId, subjectKind: "candidate_profile", subjectId, purpose: "identity", payload: defined({ nin: row.nin, bvn: row.bvn, dob: row.dob, passportNumber: row.passportNumber, passportExpiry: row.passportExpiry }), keyRegistryId: encryptionKeyRegistryId, keyring });
        await insertEnvelope(client, { tenantId, subjectKind: "candidate_profile", subjectId, purpose: "contact", payload: defined({ email: row.email, phone: row.phone }), keyRegistryId: encryptionKeyRegistryId, keyring });
        await insertEnvelope(client, { tenantId, subjectKind: "candidate_profile", subjectId, purpose: "address", payload: defined({ currentAddress: row.currentAddress, addressHistory: row.addressHistory }), keyRegistryId: encryptionKeyRegistryId, keyring });
        for (const [attribute, value] of [["nin", row.nin], ["bvn", row.bvn], ["passport_number", row.passportNumber], ["email", row.email], ["phone", row.phone]] as const) {
          await insertBlindIndex(client, { tenantId, subjectKind: "candidate_profile", subjectId, attribute, value, keyRegistryId: blindIndexKeyRegistryId, keyring });
        }
        candidateCursor = subjectId;
      }
      await client.query("COMMIT");
    }

    let criminalCursor = 0;
    for (;;) {
      const rows = await client.query<Record<string, unknown>>(
        `SELECT id,"tenantId","subjectName",nin,dob,aliases,"offenceDescription","offenceLocation",sentence,"warrantDetails","rawPayload"
           FROM criminal_records WHERE id > $1 AND "tenantId" IS NOT NULL ORDER BY id ASC LIMIT $2`,
        [criminalCursor, BATCH_SIZE],
      );
      if (!rows.rowCount) break;
      await client.query("BEGIN");
      for (const row of rows.rows) {
        const subjectId = Number(row.id); const tenantId = Number(row.tenantId);
        const encryptionKeyRegistryId = encryptionKeys.get(tenantId); const blindIndexKeyRegistryId = blindIndexKeys.get(tenantId);
        if (!encryptionKeyRegistryId || !blindIndexKeyRegistryId) throw new Error(`No active PII encryption and blind-index key registries are configured for tenant ${tenantId}.`);
        await insertEnvelope(client, { tenantId, subjectKind: "criminal_record", subjectId, purpose: "criminal_record", payload: defined({ subjectName: row.subjectName, nin: row.nin, dob: row.dob, aliases: row.aliases, offenceDescription: row.offenceDescription, offenceLocation: row.offenceLocation, sentence: row.sentence, warrantDetails: row.warrantDetails }), keyRegistryId: encryptionKeyRegistryId, keyring });
        await insertEnvelope(client, { tenantId, subjectKind: "criminal_record", subjectId, purpose: "provider_payload", payload: defined({ rawPayload: row.rawPayload }), keyRegistryId: encryptionKeyRegistryId, keyring });
        await insertBlindIndex(client, { tenantId, subjectKind: "criminal_record", subjectId, attribute: "nin", value: row.nin, keyRegistryId: blindIndexKeyRegistryId, keyring });
        criminalCursor = subjectId;
      }
      await client.query("COMMIT");
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
