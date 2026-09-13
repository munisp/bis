/**
 * Minimal table-backed fake of the drizzle DB handle used in router unit
 * tests. Select queries are filtered by the (column, value) equality pairs
 * discovered in the drizzle condition tree (see ./conditionScan), so tests
 * genuinely exercise tenant-isolation filters: a query missing
 * `eq(table.tenantId, ctx.tenantId)` will return cross-tenant rows and fail
 * the test.
 */
import { getTableName } from "drizzle-orm";
import { collectEqPairs } from "./conditionScan";

export type FakeRow = Record<string, unknown> & { id: number };

export interface FakeDb {
  captured: { table: string; cond: unknown }[];
  select: (fields?: unknown) => { from: (table: unknown) => any };
  insert: (table: unknown) => { values: (vals: Record<string, unknown>) => any };
  update: (table: unknown) => { set: (vals: Record<string, unknown>) => any };
  delete: (table: unknown) => { where: (cond: unknown) => Promise<unknown[]> };
}

function tableNameOf(table: unknown): string {
  try {
    return getTableName(table as Parameters<typeof getTableName>[0]);
  } catch {
    return "unknown";
  }
}

export function createFakeDb(initial: Record<string, FakeRow[]>): FakeDb {
  const tables: Record<string, FakeRow[]> = Object.fromEntries(
    Object.entries(initial).map(([k, v]) => [k, v.map(r => ({ ...r }))]),
  );
  const captured: { table: string; cond: unknown }[] = [];

  function runSelect(table: unknown, cond: unknown): FakeRow[] {
    const name = tableNameOf(table);
    let rows = [...(tables[name] ?? [])];
    if (cond) {
      for (const { column, value } of collectEqPairs(cond)) {
        rows = rows.filter(r => r[column] === value);
      }
    }
    return rows;
  }

  function makeSelectChain(table: unknown, cond?: unknown): any {
    const chain: any = {
      where(c: unknown) { cond = c; return chain; },
      orderBy() { return chain; },
      groupBy() { return chain; },
      limit() { return chain; },
      offset() { return chain; },
      innerJoin() { return chain; },
      leftJoin() { return chain; },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        captured.push({ table: tableNameOf(table), cond });
        return Promise.resolve(runSelect(table, cond)).then(res, rej);
      },
    };
    return chain;
  }

  return {
    captured,
    select: (_fields?: unknown) => ({
      from: (table: unknown) => makeSelectChain(table),
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const name = tableNameOf(table);
        const row = { id: (tables[name]?.length ?? 0) + 1000, createdAt: new Date(), ...vals } as FakeRow;
        (tables[name] = tables[name] ?? []).push(row);
        return {
          returning: () => Promise.resolve([row]),
          then: (res: (v: unknown) => unknown) => Promise.resolve([row]).then(res),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const rows = runSelect(table, cond);
          for (const r of rows) Object.assign(r, vals);
          return {
            returning: () => Promise.resolve(rows),
            then: (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res),
          };
        },
        returning: () => Promise.resolve([]),
      }),
    }),
    delete: (table: unknown) => ({
      where: (cond: unknown) => {
        const rows = runSelect(table, cond);
        const name = tableNameOf(table);
        tables[name] = (tables[name] ?? []).filter(r => !rows.includes(r));
        return Promise.resolve(rows);
      },
    }),
  };
}
