import type { PoolClient } from "pg";
import { TRPCError } from "@trpc/server";
import type { TransitKeyReference } from "./piiEnvelopeCrypto";

export type EncryptionRegistry = TransitKeyReference & {
  id: number;
  tenantId: number;
  provider: "vault_transit";
  providerKeyName: string;
  providerKeyVersion: number;
  status: "active" | "retiring" | "retired" | "compromised" | "staged";
};
export type BlindIndexRegistry = TransitKeyReference & {
  id: number;
  tenantId: number;
  provider: "vault_transit";
  providerKeyName: string;
  providerKeyVersion: number;
  status: "active" | "retiring" | "retired" | "compromised" | "staged";
};

type RegistryRow = {
  id: string | number;
  tenant_id: number;
  key_version: string;
  external_key_ref: string;
  provider: string;
  provider_key_name: string | null;
  provider_key_version: number | null;
  status: string;
};

function unavailable(message: string): never {
  throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message });
}

function rowToRegistry<T extends EncryptionRegistry | BlindIndexRegistry>(row: RegistryRow, tenantId: number, label: string): T {
  if (row.tenant_id !== tenantId || row.provider !== "vault_transit" || !row.provider_key_name || !row.provider_key_version || !["active", "retiring", "retired", "compromised", "staged"].includes(row.status)) {
    unavailable(`${label} key registry is not a valid tenant-scoped Vault Transit key.`);
  }
  return {
    id: Number(row.id),
    tenantId: row.tenant_id,
    keyVersion: row.key_version,
    externalKeyRef: row.external_key_ref,
    provider: "vault_transit",
    providerKeyName: row.provider_key_name,
    providerKeyVersion: row.provider_key_version,
    status: row.status as T["status"],
  } as T;
}

export async function activeTenantEncryptionRegistry(client: PoolClient, tenantId: number): Promise<EncryptionRegistry> {
  const result = await client.query<RegistryRow>(
    `SELECT id,tenant_id,key_version,external_key_ref,provider,provider_key_name,provider_key_version,status
       FROM pii_encryption_key_registry
      WHERE tenant_id=$1 AND status='active' AND provider='vault_transit' AND (retires_at IS NULL OR retires_at > NOW())
      FOR SHARE`,
    [tenantId],
  );
  if (result.rowCount !== 1) unavailable("Exactly one active tenant Vault Transit encryption key registry is required.");
  return rowToRegistry<EncryptionRegistry>(result.rows[0]!, tenantId, "Encryption");
}

export async function activeTenantBlindIndexRegistry(client: PoolClient, tenantId: number): Promise<BlindIndexRegistry> {
  const result = await client.query<RegistryRow>(
    `SELECT id,tenant_id,key_version,external_key_ref,provider,provider_key_name,provider_key_version,status
       FROM pii_blind_index_key_registry
      WHERE tenant_id=$1 AND status='active' AND provider='vault_transit' AND (retires_at IS NULL OR retires_at > NOW())
      FOR SHARE`,
    [tenantId],
  );
  if (result.rowCount !== 1) unavailable("Exactly one active tenant Vault Transit blind-index key registry is required.");
  return rowToRegistry<BlindIndexRegistry>(result.rows[0]!, tenantId, "Blind-index");
}

export async function tenantEncryptionRegistryById(client: PoolClient, tenantId: number, id: number, allowedStatuses: EncryptionRegistry["status"][] = ["active", "retiring"]): Promise<EncryptionRegistry> {
  const result = await client.query<RegistryRow>(
    `SELECT id,tenant_id,key_version,external_key_ref,provider,provider_key_name,provider_key_version,status
       FROM pii_encryption_key_registry WHERE id=$1 FOR SHARE`,
    [id],
  );
  if (result.rowCount !== 1) unavailable("Tenant encryption key registry is unavailable.");
  const registry = rowToRegistry<EncryptionRegistry>(result.rows[0]!, tenantId, "Encryption");
  if (!allowedStatuses.includes(registry.status)) unavailable("Tenant encryption key registry is not available for this operation.");
  return registry;
}

export async function tenantBlindIndexRegistryById(client: PoolClient, tenantId: number, id: number, allowedStatuses: BlindIndexRegistry["status"][] = ["active", "retiring"]): Promise<BlindIndexRegistry> {
  const result = await client.query<RegistryRow>(
    `SELECT id,tenant_id,key_version,external_key_ref,provider,provider_key_name,provider_key_version,status
       FROM pii_blind_index_key_registry WHERE id=$1 FOR SHARE`,
    [id],
  );
  if (result.rowCount !== 1) unavailable("Tenant blind-index key registry is unavailable.");
  const registry = rowToRegistry<BlindIndexRegistry>(result.rows[0]!, tenantId, "Blind-index");
  if (!allowedStatuses.includes(registry.status)) unavailable("Tenant blind-index key registry is not available for this operation.");
  return registry;
}
