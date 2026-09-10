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
 * Clears and validates the server session assigned to the active transaction.
 * In PgBouncer transaction-pooling mode, it must be called only after BEGIN so
 * the reset and transaction-local RLS binding apply to the same backend session.
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
  // Reject malformed runtime values before issuing any query on a pooled client.
  assertTenantId(tenantId);
  // PgBouncer transaction pooling may assign the backend only after BEGIN. Keep
  // reset, verification, and SET LOCAL in the same transaction/backend session.
  await client.query("BEGIN");
  try {
    await clearSessionTenantRlsContext(client);
    await setTenantRlsContext(client, tenantId);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    // RESET inside a failed transaction is rolled back with it. Best-effort
    // cleanup after rollback protects direct node-postgres pooled clients while
    // preserving the original fail-closed setup error for the caller.
    await clearSessionTenantRlsContext(client).catch(() => undefined);
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
