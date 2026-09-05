import type { PoolClient } from "pg";

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
  await client.query("SELECT set_config('bis.tenant_id', $1, true)", [String(tenantId)]);
  const verified = await client.query<{ tenant_id: string | null }>("SELECT current_setting('bis.tenant_id', true) AS tenant_id");
  if (verified.rows[0]?.tenant_id !== String(tenantId)) {
    throw new Error("PostgreSQL RLS tenant context could not be verified.");
  }
}

/**
 * Starts an RLS-scoped transaction. Callers must use the returned client for all
 * protected-table queries and must finish with commitTenantTransaction or
 * rollbackTenantTransaction before releasing the client.
 */
export async function beginTenantTransaction(client: TenantScopedClient, tenantId: number): Promise<void> {
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
