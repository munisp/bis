import type { PoolClient } from "pg";
import { piiRlsPoolContextResidualTotal, recordTenantRlsContextSetup } from "./piiRlsMetrics";

export type TenantScopedClient = PoolClient;

function assertTenantId(tenantId: number): void {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
    throw new Error("A positive trusted tenant ID is required for PostgreSQL RLS context.");
  }
}

/**
 * Sets the PostgreSQL RLS context for the current transaction only. `set_config`
 * receives `true`, so COMMIT or ROLLBACK clears the setting before the client can
 * be returned to the shared pool.
 */
export async function setTenantRlsContext(client: TenantScopedClient, tenantId: number): Promise<void> {
  assertTenantId(tenantId);
  try {
    await client.query("SELECT set_config('bis.tenant_id', $1, true)", [String(tenantId)]);
  } catch (error) {
    recordTenantRlsContextSetup("set_failed", "tenant_rls");
    throw error;
  }
  const verified = await client.query<{ tenant_id: string | null }>("SELECT current_setting('bis.tenant_id', true) AS tenant_id");
  if (verified.rows[0]?.tenant_id !== String(tenantId)) {
    recordTenantRlsContextSetup("verify_failed", "tenant_rls");
    throw new Error("PostgreSQL RLS tenant context could not be verified.");
  }
  recordTenantRlsContextSetup("success", "tenant_rls");
}

/**
 * Starts an RLS-scoped transaction. Callers must use the returned client for all
 * protected-table queries and must finish with commitTenantTransaction or
 * rollbackTenantTransaction before releasing the client.
 */
async function clearSessionTenantRlsContext(client: TenantScopedClient): Promise<void> {
  try {
    await client.query("RESET bis.tenant_id");
  } catch (error) {
    recordTenantRlsContextSetup("reset_failed", "tenant_rls");
    throw error;
  }
  const verified = await client.query<{ tenant_id: string | null }>("SELECT current_setting('bis.tenant_id', true) AS tenant_id");
  if (verified.rows[0]?.tenant_id) {
    piiRlsPoolContextResidualTotal.inc({ component: "tenant_rls" });
    recordTenantRlsContextSetup("residual_detected", "tenant_rls");
    throw new Error("PostgreSQL pooled session retained an unexpected tenant context.");
  }
}

export async function beginTenantTransaction(client: TenantScopedClient, tenantId: number): Promise<void> {
  // Clear an accidental session-level SET before BEGIN. This protects the next
  // transaction even if a legacy query path contaminated a pooled connection.
  await clearSessionTenantRlsContext(client);
  await client.query("BEGIN");
  try {
    await setTenantRlsContext(client, tenantId);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function commitTenantTransaction(client: TenantScopedClient): Promise<void> {
  await client.query("COMMIT");
}

export async function rollbackTenantTransaction(client: TenantScopedClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}

/**
 * Gives a caller a single transaction-local tenant scope and guarantees cleanup.
 * It intentionally does not accept arbitrary setting names or caller-controlled
 * tenant text.
 */
export async function withTenantTransaction<T>(client: TenantScopedClient, tenantId: number, work: (tenantClient: TenantScopedClient) => Promise<T>): Promise<T> {
  await beginTenantTransaction(client, tenantId);
  try {
    const result = await work(client);
    await commitTenantTransaction(client);
    return result;
  } catch (error) {
    await rollbackTenantTransaction(client);
    throw error;
  }
}
