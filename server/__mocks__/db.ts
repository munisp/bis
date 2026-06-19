/**
 * Vitest mock for server/db.ts
 *
 * Stateful in-memory store so create-then-read patterns work correctly.
 * The mock resets between test files automatically via Vitest module isolation.
 *
 * Usage in test files:
 *   vi.mock("./db");
 */
import { vi } from "vitest";

// ─── In-memory store ──────────────────────────────────────────────────────────

interface Row { id: number; [key: string]: unknown }

class MemStore {
  private tables = new Map<string, Row[]>();
  private nextId = 1;

  reset() {
    this.tables.clear();
    this.nextId = 1;
  }

  insert(table: string, data: Record<string, unknown>): Row {
    if (!this.tables.has(table)) this.tables.set(table, []);
    const row: Row = { id: this.nextId++, createdAt: new Date(), updatedAt: new Date(), ...data };
    this.tables.get(table)!.push(row);
    return row;
  }

  findById(table: string, id: number): Row | undefined {
    return this.tables.get(table)?.find(r => r.id === id);
  }

  findAll(table: string): Row[] {
    return this.tables.get(table) ?? [];
  }

  update(table: string, id: number, data: Record<string, unknown>): Row | undefined {
    const rows = this.tables.get(table);
    if (!rows) return undefined;
    const idx = rows.findIndex(r => r.id === id);
    if (idx === -1) return undefined;
    rows[idx] = { ...rows[idx], ...data, updatedAt: new Date() };
    return rows[idx];
  }

  delete(table: string, id: number): boolean {
    const rows = this.tables.get(table);
    if (!rows) return false;
    const idx = rows.findIndex(r => r.id === id);
    if (idx === -1) return false;
    rows.splice(idx, 1);
    return true;
  }
}

const store = new MemStore();

// Track the last inserted row so select() can return it for create-then-read patterns
let lastInsertedRow: Row | null = null;

// ─── Chainable proxy ──────────────────────────────────────────────────────────

function makeChain(result: unknown): unknown {
  const thenable = {
    then(onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
    catch(onRejected?: (e: unknown) => unknown) {
      return Promise.resolve(result).catch(onRejected);
    },
    finally(onFinally?: () => void) {
      return Promise.resolve(result).finally(onFinally);
    },
  };
  return new Proxy(thenable, {
    get(target, prop) {
      if (prop === "then" || prop === "catch" || prop === "finally") {
        return (target as Record<string | symbol, unknown>)[prop];
      }
      if (prop === Symbol.toPrimitive || prop === Symbol.iterator || prop === Symbol.toStringTag) {
        return undefined;
      }
      return (..._args: unknown[]) => makeChain(result);
    },
  });
}

// ─── Mock DB factory ──────────────────────────────────────────────────────────

function makeMockDb() {
  return {
    select: vi.fn((fields?: unknown) => {
      const isCount = fields != null && typeof fields === "object" &&
        Object.keys(fields as object).some(k => ["c", "count", "total", "cnt"].includes(k));
      // For count queries return 0; for single-record lookups return lastInsertedRow if available
      const defaultResult = isCount
        ? [{ c: 0, count: 0, total: 0 }]
        : lastInsertedRow != null ? [lastInsertedRow] : [];
      return makeChain(defaultResult);
    }),
    insert: vi.fn((_table: unknown) => ({
      values: vi.fn((vals: Record<string, unknown>) => ({
        returning: vi.fn(() => {
          const tableName = (_table as { _?: { name?: string } })?._?.name ?? "unknown";
          const row = store.insert(tableName, vals);
          lastInsertedRow = row;
          return Promise.resolve([row]);
        }),
        onConflictDoNothing: vi.fn(() => Promise.resolve([])),
        onConflictDoUpdate: vi.fn(() => {
          const tableName = (_table as { _?: { name?: string } })?._?.name ?? "unknown";
          const row = store.insert(tableName, vals);
          lastInsertedRow = row;
          return Promise.resolve([row]);
        }),
      })),
    })),
    update: vi.fn((_table: unknown) => ({
      set: vi.fn((vals: Record<string, unknown>) => {
        // Merge set values with lastInsertedRow for realistic update behavior
        const mergedRow = lastInsertedRow != null
          ? { ...lastInsertedRow, ...vals }
          : { id: 1, acknowledged: true, enabled: true, ...vals };
        // Also update lastInsertedRow so subsequent selects see the update
        lastInsertedRow = mergedRow as Row;
        return {
          where: vi.fn((_cond: unknown) => ({
            returning: vi.fn(() => Promise.resolve([mergedRow])),
            then: (resolve: (v: unknown) => unknown) =>
              Promise.resolve([mergedRow]).then(resolve),
          })),
          returning: vi.fn(() => Promise.resolve([mergedRow])),
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve([mergedRow]).then(resolve),
        };
      }),
    })),
    delete: vi.fn((_table: unknown) => ({
      where: vi.fn((_cond: unknown) => Promise.resolve([])),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeMockDb())),
    execute: vi.fn(() => Promise.resolve({ rows: [] })),
  };
}

const mockDb = makeMockDb();

// ─── Core ─────────────────────────────────────────────────────────────────────

export const getDb = vi.fn(async () => mockDb);
export const closeDb = vi.fn(async () => {});

// ─── User ─────────────────────────────────────────────────────────────────────

export const upsertUser = vi.fn(async () => {});
export const getUserByOpenId = vi.fn(async () => null);

// ─── Investigations ───────────────────────────────────────────────────────────

export const createInvestigation = vi.fn(async (data: Record<string, unknown>) => ({
  id: 1, ref: "BIS-001", status: "open", createdAt: new Date(), updatedAt: new Date(),
  ...data,
}));
export const getInvestigations = vi.fn(async () => []);
export const getInvestigationById = vi.fn(async () => null);
export const updateInvestigation = vi.fn(async (id: number, data: Record<string, unknown>) => ({
  id, createdAt: new Date(), updatedAt: new Date(),
  ...data,
}));

// ─── Alerts ───────────────────────────────────────────────────────────────────

export const createAlert = vi.fn(async () => ({ id: 1 }));
export const getAlerts = vi.fn(async () => []);
export const markAlertRead = vi.fn(async () => {});

// ─── KYC ─────────────────────────────────────────────────────────────────────

export const createKycRecord = vi.fn(async (data: Record<string, unknown>) => ({
  id: 1, status: "passed", createdAt: new Date(), updatedAt: new Date(),
  ...data,
}));
export const getKycRecords = vi.fn(async () => []);
export const updateKycRecord = vi.fn(async (id: number, data: Record<string, unknown>) => ({
  id, createdAt: new Date(), updatedAt: new Date(),
  ...data,
}));

// ─── Audit ────────────────────────────────────────────────────────────────────

export const appendAuditLog = vi.fn(async () => {});
export const getAuditLog = vi.fn(async () => ({ items: [], total: 0 }));

// ─── Field Tasks ──────────────────────────────────────────────────────────────

export const createFieldTask = vi.fn(async (data: Record<string, unknown>) => ({
  id: 1, taskRef: "FT-001", status: "dispatched", createdAt: new Date(), updatedAt: new Date(),
  ...data,
}));
export const getFieldTasks = vi.fn(async () => []);
export const updateFieldTask = vi.fn(async () => ({ id: 1 }));

// ─── Reports ──────────────────────────────────────────────────────────────────

export const createReport = vi.fn(async () => ({ id: 1 }));
export const getReports = vi.fn(async () => []);

// ─── Dashboard ────────────────────────────────────────────────────────────────

export const getDashboardStats = vi.fn(async () => ({
  totalInvestigations: 0,
  activeInvestigations: 0,
  completedToday: 0,
  flaggedCritical: 0,
  biometricEnrollments: 0,
  duplicatesDetected: 0,
  kycVerificationsToday: 0,
  kycPassRate: 0,
  activeMonitors: 0,
  alertsToday: 0,
  avgProcessingTimeMin: 4.7,
  avgRiskScore: 34.2,
  totalCases: 0,
  openCases: 0,
  casesBreachingSLA: 0,
  pendingLexSubmissions: 0,
  validatedLexSubmissions: 0,
}));

// ─── Field Agents ─────────────────────────────────────────────────────────────

const MOCK_AGENTS = Array.from({ length: 15 }, (_, i) => ({
  id: i + 1,
  agentCode: `FA-${String(i + 1).padStart(3, "0")}`,
  name: `Mock Agent ${i + 1}`,
  status: "active",
  state: "Lagos",
  lga: "Ikeja",
  phone: `0800000${String(i).padStart(4, "0")}`,
  email: `agent${i + 1}@bis.test`,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

export const createFieldAgent = vi.fn(async (data: Record<string, unknown>) => ({
  id: 1, createdAt: new Date(), updatedAt: new Date(), status: "active",
  ...data,
}));
export const getFieldAgents = vi.fn(async () => MOCK_AGENTS);
export const getFieldAgentById = vi.fn(async () => MOCK_AGENTS[0]);
export const updateFieldAgent = vi.fn(async (id: number, data: Record<string, unknown>) => ({
  id, createdAt: new Date(), updatedAt: new Date(), status: "active",
  ...data,
}));

// ─── Data Sources ─────────────────────────────────────────────────────────────

const MOCK_DATA_SOURCES = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1,
  code: `DS-${String(i + 1).padStart(3, "0")}`,
  name: `Mock Data Source ${i + 1}`,
  status: "active",
  category: "identity",
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

export const createDataSource = vi.fn(async (data: Record<string, unknown>) => {
  const row = { id: 1, createdAt: new Date(), updatedAt: new Date(), enabled: true, status: "active", ...data };
  lastInsertedRow = row as Row;
  return row;
});
export const getDataSources = vi.fn(async () => MOCK_DATA_SOURCES);
export const updateDataSource = vi.fn(async (id: number, data: Record<string, unknown>) => ({
  id, createdAt: new Date(), updatedAt: new Date(), enabled: true, status: "active",
  ...(lastInsertedRow ?? {}),
  ...data,
}));
export const seedDataSources = vi.fn(async () => ({ seeded: 25 }));

// ─── Monitors ─────────────────────────────────────────────────────────────────

export const createMonitor = vi.fn(async (data: Record<string, unknown>) => ({
  id: 1, createdAt: new Date(), updatedAt: new Date(), status: "active",
  ...data,
}));
export const getMonitors = vi.fn(async () => [{ id: 1, name: "Mock Monitor", status: "active", type: "entity" }]);
export const updateMonitor = vi.fn(async (id: number, data: Record<string, unknown>) => ({
  id, createdAt: new Date(), updatedAt: new Date(),
  ...data,
}));

// ─── Screening ────────────────────────────────────────────────────────────────

export const createScreeningRequest = vi.fn(async () => ({ id: 1 }));
export const getScreeningRequests = vi.fn(async () => []);
export const updateScreeningRequest = vi.fn(async () => ({ id: 1 }));

// ─── Biometric ────────────────────────────────────────────────────────────────

export const insertBiometricSessionLog = vi.fn(async () => 1);
export const getBiometricSessionLogs = vi.fn(async () => []);
export const markBiometricSessionKafkaPublished = vi.fn(async () => {});
export const getBiometricSessionStats = vi.fn(async () => ({
  total: 0, passed: 0, failed: 0, pending: 0,
}));

// ─── Store reset helper (for test cleanup) ────────────────────────────────────

export const __resetStore = () => { store.reset(); lastInsertedRow = null; };
export const __clearLastInserted = () => { lastInsertedRow = null; };
