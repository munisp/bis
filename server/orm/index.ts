/**
 * server/orm/index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * BIS Drizzle ORM Query Layer
 *
 * Provides:
 *  1. getRelationalDb()     — drizzle instance wired with full relations schema
 *  2. withAudit()           — transaction wrapper that auto-appends audit log
 *  3. softDeleteWhere()     — typed soft-delete helper
 *  4. cursorPage()          — cursor-based pagination helper
 *  5. buildFilters()        — composable filter builder for common patterns
 *  6. ftsQuery()            — full-text search query helper
 *  7. Repository<T>         — generic typed repository base class
 *  8. Domain repositories   — InvestigationRepo, CaseRepo, KycRepo, etc.
 */

import {
  eq, and, or, isNull, isNotNull, gt, lt, gte, lte, ilike, desc, asc,
  sql, inArray, count, SQL,
} from "drizzle-orm";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../drizzle/schema";
import * as schemaRelations from "../../drizzle/relations";
import { ENV } from "../_core/env";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BisDb = NodePgDatabase<typeof schema & typeof schemaRelations>;

export interface CursorPageResult<T> {
  items: T[];
  nextCursor: string | null;
  prevCursor: string | null;
  total: number;
  hasMore: boolean;
}

export interface AuditContext {
  userId: number;
  userEmail?: string;
  tenantId?: number;
  ipAddress?: string;
}

export interface SoftDeleteOptions {
  deletedBy?: number;
}

// ─── Singleton relational DB instance ────────────────────────────────────────

let _relDb: BisDb | null = null;
let _pool: Pool | null = null;

export async function getRelationalDb(): Promise<BisDb | null> {
  if (_relDb) return _relDb;
  if (!process.env.DATABASE_URL) return null;
  try {
    const dbUrl = process.env.DATABASE_URL;
    const isLocal = dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1");
    const sslConfig = isLocal ? undefined : { ssl: { rejectUnauthorized: ENV.dbSslStrict } };
    _pool = new Pool({
      connectionString: dbUrl,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ...sslConfig,
    });
    _pool.on("error", (err) => console.error("[ORM Pool] Unexpected error:", err));
    _relDb = drizzle(_pool, { schema: { ...schema, ...schemaRelations } });
    return _relDb;
  } catch (err) {
    console.warn("[ORM] Failed to create relational DB:", err);
    return null;
  }
}

// ─── withAudit() — transactional audit wrapper ────────────────────────────────

/**
 * Wraps a database operation in a transaction and automatically appends an
 * audit log entry on success.
 *
 * @example
 * const result = await withAudit(db, ctx, {
 *   category: "investigation",
 *   action: "create_investigation",
 *   targetRef: inv.ref,
 * }, async (tx) => {
 *   return await tx.insert(investigations).values(data).returning();
 * });
 */
export async function withAudit<T>(
  db: BisDb,
  ctx: AuditContext,
  audit: {
    category: schema.AuditLog["category"];
    action: string;
    targetRef?: string;
    detail?: Record<string, unknown>;
  },
  fn: (tx: BisDb) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const result = await fn(tx as unknown as BisDb);
    await tx.insert(schema.auditLog).values({
      userId: ctx.userId,
      userEmail: ctx.userEmail,
      tenantId: ctx.tenantId,
      ipAddress: ctx.ipAddress,
      category: audit.category,
      action: audit.action,
      targetRef: audit.targetRef,
      result: "success",
      detail: audit.detail ?? null,
    });
    return result;
  });
}

// ─── softDeleteWhere() ────────────────────────────────────────────────────────

/**
 * Performs a soft-delete by setting deletedAt and optionally deletedBy.
 * Works on any table that has deletedAt and deletedBy columns.
 *
 * @example
 * await softDeleteWhere(db, schema.investigations, eq(investigations.id, id), { deletedBy: userId });
 */
export async function softDeleteWhere<T extends { deletedAt: unknown; deletedBy: unknown }>(
  db: BisDb,
  table: T,
  where: SQL,
  opts?: SoftDeleteOptions,
): Promise<void> {
  const updateValues: Record<string, unknown> = {
    deletedAt: new Date(),
  };
  if (opts?.deletedBy !== undefined) {
    updateValues.deletedBy = opts.deletedBy;
  }
  await (db as unknown as NodePgDatabase).update(table as never).set(updateValues as never).where(where);
}

/**
 * Returns a SQL condition that filters out soft-deleted rows.
 * Use in .where() clauses to exclude deleted records.
 *
 * @example
 * db.select().from(investigations).where(and(notDeleted(investigations), eq(investigations.status, "pending")))
 */
export function notDeleted(table: { deletedAt: unknown }): SQL {
  return isNull(table.deletedAt as never);
}

// ─── Cursor-based pagination ──────────────────────────────────────────────────

/**
 * Performs cursor-based pagination on any Drizzle table.
 * Uses the row's `id` (serial) as the cursor for stable ordering.
 *
 * @example
 * const page = await cursorPage(db, schema.investigations, {
 *   cursor: req.cursor,
 *   limit: 25,
 *   where: and(eq(investigations.tenantId, tenantId), notDeleted(investigations)),
 *   orderBy: desc(investigations.createdAt),
 * });
 */
export async function cursorPage<TTable extends { id: unknown }>(
  db: BisDb,
  table: TTable,
  opts: {
    cursor?: string | null;
    limit?: number;
    where?: SQL;
    orderBy?: SQL;
    direction?: "forward" | "backward";
  },
): Promise<CursorPageResult<Record<string, unknown>>> {
  const limit = Math.min(opts.limit ?? 25, 200);
  const direction = opts.direction ?? "forward";

  // Decode cursor (base64-encoded JSON: { id, createdAt })
  let cursorCondition: SQL | undefined;
  if (opts.cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(opts.cursor, "base64url").toString("utf8"));
      if (decoded.id) {
        cursorCondition = direction === "forward"
          ? lt(table.id as never, decoded.id)
          : gt(table.id as never, decoded.id);
      }
    } catch {
      // Invalid cursor — ignore and start from beginning
    }
  }

  const where = and(...[opts.where, cursorCondition].filter(Boolean) as SQL[]);
  const orderBy = opts.orderBy ?? desc(table.id as never);

  // Fetch limit+1 to detect hasMore
  const rows = await (db as unknown as NodePgDatabase)
    .select()
    .from(table as never)
    .where(where)
    .orderBy(orderBy)
    .limit(limit + 1) as Record<string, unknown>[];

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  // Count total (without cursor condition for accurate totals)
  const countResult = await (db as unknown as NodePgDatabase)
    .select({ total: count() })
    .from(table as never)
    .where(opts.where) as unknown;
  const total = Array.isArray(countResult) && countResult.length > 0
    ? Number((countResult[0] as { total: unknown }).total ?? 0)
    : 0;

  const encodeCursor = (row: Record<string, unknown>) =>
    Buffer.from(JSON.stringify({ id: row.id, createdAt: row.createdAt })).toString("base64url");

  return {
    items,
    nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null,
    prevCursor: opts.cursor && items.length > 0 ? encodeCursor(items[0]) : null,
    total,
    hasMore,
  };
}

// ─── buildFilters() — composable filter builder ───────────────────────────────

/**
 * Builds a composable array of SQL conditions from a filter object.
 * Undefined values are automatically skipped.
 *
 * @example
 * const filters = buildFilters([
 *   opts.status ? eq(investigations.status, opts.status) : undefined,
 *   opts.tenantId ? eq(investigations.tenantId, opts.tenantId) : undefined,
 *   opts.search ? ftsQuery(investigations, opts.search) : undefined,
 *   notDeleted(investigations),
 * ]);
 * db.select().from(investigations).where(and(...filters));
 */
export function buildFilters(conditions: (SQL | undefined | null | false)[]): SQL[] {
  return conditions.filter((c): c is SQL => !!c);
}

// ─── ftsQuery() — full-text search helper ────────────────────────────────────

/**
 * Generates a PostgreSQL full-text search condition using to_tsquery.
 * Automatically handles multi-word queries by joining with &.
 *
 * @example
 * const searchCondition = ftsQuery("investigations", "john doe");
 * // Produces: to_tsvector('english', ...) @@ to_tsquery('english', 'john & doe')
 */
export function ftsQuery(tableName: "investigations" | "cases" | "kyc_records", query: string): SQL {
  const tsVectorCol: Record<string, string> = {
    investigations: `to_tsvector('english', coalesce("subjectName", '') || ' ' || coalesce("ref", '') || ' ' || coalesce("nin", '') || ' ' || coalesce("bvn", ''))`,
    cases: `to_tsvector('english', coalesce("title", '') || ' ' || coalesce("ref", '') || ' ' || coalesce("description", ''))`,
    kyc_records: `to_tsvector('english', coalesce("subjectName", '') || ' ' || coalesce("nin", '') || ' ' || coalesce("bvn", ''))`,
  };
  // Sanitize and join query terms with &
  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean)
    .join(" & ");

  if (!terms) return sql`TRUE`;

  const tsVec = tsVectorCol[tableName] ?? `to_tsvector('english', '')`;
  return sql.raw(`(${tsVec}) @@ to_tsquery('english', '${terms}:*')`);
}

// ─── Generic Repository Base ──────────────────────────────────────────────────

/**
 * Generic typed repository base providing standard CRUD operations.
 * Domain repositories extend this class.
 */
export abstract class Repository<
  TSelect extends Record<string, unknown>,
  TInsert extends Record<string, unknown>,
> {
  constructor(
    protected readonly db: BisDb,
    protected readonly table: Record<string, unknown>,
  ) {}

  async findById(id: number): Promise<TSelect | undefined> {
    const rows = await (this.db as unknown as NodePgDatabase)
      .select()
      .from(this.table as never)
      .where(eq((this.table as Record<string, unknown>).id as never, id))
      .limit(1) as TSelect[];
    return rows[0];
  }

  async findAll(opts?: {
    where?: SQL;
    limit?: number;
    offset?: number;
    orderBy?: SQL;
  }): Promise<TSelect[]> {
    let q = (this.db as unknown as NodePgDatabase)
      .select()
      .from(this.table as never)
      .$dynamic();
    if (opts?.where) q = q.where(opts.where);
    if (opts?.orderBy) q = q.orderBy(opts.orderBy);
    if (opts?.limit) q = q.limit(opts.limit);
    if (opts?.offset) q = q.offset(opts.offset);
    return q as unknown as TSelect[];
  }

  async create(data: TInsert): Promise<TSelect> {
    const [row] = await (this.db as unknown as NodePgDatabase)
      .insert(this.table as never)
      .values(data as never)
      .returning() as TSelect[];
    return row;
  }

  async update(id: number, data: Partial<TInsert>): Promise<TSelect | undefined> {
    const [row] = await (this.db as unknown as NodePgDatabase)
      .update(this.table as never)
      .set({ ...data, updatedAt: new Date() } as never)
      .where(eq((this.table as Record<string, unknown>).id as never, id))
      .returning() as TSelect[];
    return row;
  }

  async delete(id: number): Promise<void> {
    await (this.db as unknown as NodePgDatabase)
      .delete(this.table as never)
      .where(eq((this.table as Record<string, unknown>).id as never, id));
  }

  async count(where?: SQL): Promise<number> {
    const [{ total }] = await (this.db as unknown as NodePgDatabase)
      .select({ total: count() })
      .from(this.table as never)
      .where(where) as [{ total: number }];
    return total;
  }

  async exists(where: SQL): Promise<boolean> {
    const [{ total }] = await (this.db as unknown as NodePgDatabase)
      .select({ total: count() })
      .from(this.table as never)
      .where(where)
      .limit(1) as [{ total: number }];
    return total > 0;
  }
}

// ─── InvestigationRepository ──────────────────────────────────────────────────

export class InvestigationRepository extends Repository<schema.Investigation, schema.InsertInvestigation> {
  constructor(db: BisDb) {
    super(db, schema.investigations);
  }

  async findByRef(ref: string): Promise<schema.Investigation | undefined> {
    const rows = await this.db
      .select()
      .from(schema.investigations)
      .where(and(eq(schema.investigations.ref, ref), isNull(schema.investigations.deletedAt)))
      .limit(1);
    return rows[0];
  }

  async findByTenant(tenantId: number, opts?: {
    status?: schema.Investigation["status"];
    search?: string;
    cursor?: string;
    limit?: number;
  }): Promise<CursorPageResult<Record<string, unknown>>> {
    const conditions = buildFilters([
      eq(schema.investigations.tenantId, tenantId),
      notDeleted(schema.investigations),
      opts?.status ? eq(schema.investigations.status, opts.status) : undefined,
      opts?.search ? ftsQuery("investigations", opts.search) : undefined,
    ]);
    return cursorPage(this.db, schema.investigations, {
      cursor: opts?.cursor,
      limit: opts?.limit,
      where: and(...conditions),
      orderBy: desc(schema.investigations.createdAt),
    });
  }

  async softDelete(id: number, deletedBy: number): Promise<void> {
    await softDeleteWhere(
      this.db,
      schema.investigations as never,
      eq(schema.investigations.id, id),
      { deletedBy },
    );
  }

  async withAuditCreate(
    data: schema.InsertInvestigation,
    ctx: AuditContext,
  ): Promise<schema.Investigation> {
    return withAudit(this.db, ctx, {
      category: "investigation",
      action: "create_investigation",
      targetRef: data.ref,
      detail: { subjectName: data.subjectName, tier: data.tier },
    }, async (tx) => {
      const [inv] = await tx.insert(schema.investigations).values(data).returning();
      return inv;
    });
  }
}

// ─── CaseRepository ───────────────────────────────────────────────────────────

export class CaseRepository extends Repository<schema.Case, schema.InsertCase> {
  constructor(db: BisDb) {
    super(db, schema.cases);
  }

  async findByRef(ref: string): Promise<schema.Case | undefined> {
    const rows = await this.db
      .select()
      .from(schema.cases)
      .where(and(eq(schema.cases.ref, ref), isNull(schema.cases.deletedAt)))
      .limit(1);
    return rows[0];
  }

  async findWithRelations(id: number) {
    return this.db.query.cases.findFirst({
      where: and(eq(schema.cases.id, id), isNull(schema.cases.deletedAt)),
      with: {
        parties: true,
        documents: true,
        timeline: { orderBy: desc(schema.caseTimeline.createdAt) },
        stakeholders: true,
        comments: { orderBy: desc(schema.caseComments.createdAt) },
        investigationLinks: { with: { investigation: true } },
      },
    });
  }

  async findByTenant(tenantId: number, opts?: {
    status?: string;
    search?: string;
    cursor?: string;
    limit?: number;
  }): Promise<CursorPageResult<Record<string, unknown>>> {
    const conditions = buildFilters([
      eq(schema.cases.tenantId, tenantId),
      notDeleted(schema.cases),
      opts?.status ? eq(schema.cases.status as never, opts.status) : undefined,
      opts?.search ? ftsQuery("cases", opts.search) : undefined,
    ]);
    return cursorPage(this.db, schema.cases, {
      cursor: opts?.cursor,
      limit: opts?.limit,
      where: and(...conditions),
      orderBy: desc(schema.cases.createdAt),
    });
  }

  async softDelete(id: number, deletedBy: number): Promise<void> {
    await softDeleteWhere(
      this.db,
      schema.cases as never,
      eq(schema.cases.id, id),
      { deletedBy },
    );
  }
}

// ─── KycRepository ────────────────────────────────────────────────────────────

export class KycRepository extends Repository<schema.KycRecord, schema.InsertKycRecord> {
  constructor(db: BisDb) {
    super(db, schema.kycRecords);
  }

  async findWithDocuments(id: number) {
    return this.db.query.kycRecords.findFirst({
      where: and(eq(schema.kycRecords.id, id), isNull(schema.kycRecords.deletedAt)),
      with: {
        documents: true,
        ocrHistory: { orderBy: desc(schema.kycOcrHistory.createdAt) },
        biometricSessions: { orderBy: desc(schema.biometricSessionLogs.createdAt) },
      },
    });
  }

  async findByNinOrBvn(nin?: string, bvn?: string): Promise<schema.KycRecord[]> {
    const conditions = buildFilters([
      nin ? eq(schema.kycRecords.nin, nin) : undefined,
      bvn ? eq(schema.kycRecords.bvn, bvn) : undefined,
      notDeleted(schema.kycRecords),
    ]);
    if (conditions.length === 0) return [];
    return this.db
      .select()
      .from(schema.kycRecords)
      .where(or(...conditions));
  }

  async searchByName(query: string, tenantId?: number): Promise<schema.KycRecord[]> {
    const conditions = buildFilters([
      ftsQuery("kyc_records", query),
      tenantId ? eq(schema.kycRecords.tenantId, tenantId) : undefined,
      notDeleted(schema.kycRecords),
    ]);
    return this.db
      .select()
      .from(schema.kycRecords)
      .where(and(...conditions))
      .orderBy(desc(schema.kycRecords.createdAt))
      .limit(50);
  }
}

// ─── AlertRepository ──────────────────────────────────────────────────────────

export class AlertRepository extends Repository<schema.Alert, schema.InsertAlert> {
  constructor(db: BisDb) {
    super(db, schema.alerts);
  }

  async findUnacknowledged(tenantId: number, limit = 50): Promise<schema.Alert[]> {
    return this.db
      .select()
      .from(schema.alerts)
      .where(and(
        eq(schema.alerts.tenantId, tenantId),
        eq(schema.alerts.acknowledged, false),
        eq(schema.alerts.dismissed, false),
        isNull(schema.alerts.deletedAt),
      ))
      .orderBy(desc(schema.alerts.createdAt))
      .limit(limit);
  }

  async bulkAcknowledge(ids: number[], acknowledgedBy: number): Promise<void> {
    await this.db
      .update(schema.alerts)
      .set({ acknowledged: true, acknowledgedBy, acknowledgedAt: new Date() })
      .where(inArray(schema.alerts.id, ids));
  }
}

// ─── InvestigationRepository with relational queries ─────────────────────────

export class InvestigationRelationalRepository {
  constructor(private readonly db: BisDb) {}

  async findWithFullContext(id: number) {
    return this.db.query.investigations.findFirst({
      where: and(eq(schema.investigations.id, id), isNull(schema.investigations.deletedAt)),
      with: {
        alerts: { where: eq(schema.alerts.dismissed, false) },
        kycRecords: { with: { documents: true } },
        fieldTasks: true,
        reports: true,
        caseLinks: { with: { case: true } },
        amlAlerts: true,
        fieldVisitReports: true,
        criminalRecordRequests: { with: { records: true } },
        temporalWorkflows: true,
      },
    });
  }

  async findByTenantWithAlerts(tenantId: number, limit = 20) {
    return this.db.query.investigations.findMany({
      where: and(
        eq(schema.investigations.tenantId, tenantId),
        isNull(schema.investigations.deletedAt),
      ),
      with: {
        alerts: {
          where: and(eq(schema.alerts.acknowledged, false), eq(schema.alerts.dismissed, false)),
          limit: 5,
        },
      },
      orderBy: desc(schema.investigations.createdAt),
      limit,
    });
  }
}

// ─── ScreeningRepository ──────────────────────────────────────────────────────

export class ScreeningRepository extends Repository<schema.ScreeningOrder, schema.InsertScreeningOrder> {
  constructor(db: BisDb) {
    super(db, schema.screeningOrders);
  }

  async findWithResults(orderId: number) {
    return this.db.query.screeningOrders.findFirst({
      where: and(
        eq(schema.screeningOrders.id, orderId),
        isNull(schema.screeningOrders.deletedAt),
      ),
      with: {
        candidate: true,
        package: true,
        results: true,
        adverseActions: { with: { items: true } },
        assessments: true,
      },
    });
  }
}

// ─── Factory — create all repositories from a single db instance ──────────────

export interface BisRepositories {
  investigations: InvestigationRepository;
  investigationsRelational: InvestigationRelationalRepository;
  cases: CaseRepository;
  kyc: KycRepository;
  alerts: AlertRepository;
  screening: ScreeningRepository;
}

export function createRepositories(db: BisDb): BisRepositories {
  return {
    investigations: new InvestigationRepository(db),
    investigationsRelational: new InvestigationRelationalRepository(db),
    cases: new CaseRepository(db),
    kyc: new KycRepository(db),
    alerts: new AlertRepository(db),
    screening: new ScreeningRepository(db),
  };
}
