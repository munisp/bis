import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

type MigrationEntry = {
  idx: number;
  tag: string;
  when: number;
};

type MigrationJournal = {
  entries: MigrationEntry[];
};

type MigrationMaterial = MigrationEntry & {
  sql: string;
  checksum: string;
};

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const migrationDirectory = resolve(repositoryRoot, "drizzle");
const journalPath = resolve(migrationDirectory, "meta", "_journal.json");
const databaseUrl = process.env.BIS_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const adoptExisting = process.env.BIS_POSTGRES_ADOPT_EXISTING === "1";
const backupId = process.env.BIS_POSTGRES_BACKUP_ID?.trim() ?? "";

function requirePostgresUrl(url: string): string {
  if (!url.startsWith("postgresql://") && !url.startsWith("postgres://")) {
    throw new Error("BIS_DATABASE_URL or DATABASE_URL must be a PostgreSQL URL");
  }
  return url;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function statements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function loadMigrations(): MigrationMaterial[] {
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as MigrationJournal;
  return journal.entries
    .sort((left, right) => left.idx - right.idx)
    .map((migration) => {
      const path = resolve(migrationDirectory, `${migration.tag}.sql`);
      if (!existsSync(path)) {
        throw new Error(`Migration ${migration.tag} is listed in the journal but does not exist`);
      }
      const sql = readFileSync(path, "utf8");
      return { ...migration, sql, checksum: sha256(sql) };
    });
}

function requiredPublicTables(sql: string): string[] {
  const tables = new Set<string>();
  const expression = /CREATE TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;
  for (const match of sql.matchAll(expression)) {
    tables.add(match[1]);
  }
  return [...tables].sort();
}

async function applyMigration(client: Client, migration: MigrationMaterial): Promise<void> {
  const hasConcurrentIndex = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i.test(migration.sql)
    || /\bDROP\s+INDEX\s+CONCURRENTLY\b/i.test(migration.sql);
  const applyStatements = async () => {
    for (const statement of statements(migration.sql)) {
      await client.query(statement);
    }
    await client.query(
      `INSERT INTO bis_migrations.schema_migrations (migration_index, tag, checksum, applied_at)
       VALUES ($1, $2, $3, NOW())`,
      [migration.idx, migration.tag, migration.checksum],
    );
  };

  if (hasConcurrentIndex) {
    await applyStatements();
    return;
  }

  await client.query("BEGIN");
  try {
    await applyStatements();
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function existingPublicTableCount(client: Client): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  return Number.parseInt(result.rows[0]?.count ?? "0", 10);
}

async function assertLegacySchemaCompatible(client: Client, baseline: MigrationMaterial): Promise<void> {
  const required = requiredPublicTables(baseline.sql);
  if (required.length === 0) {
    throw new Error("Canonical baseline has no discoverable public tables; adoption is disabled");
  }
  const result = await client.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  const existing = new Set(result.rows.map((row) => row.table_name));
  const missing = required.filter((table) => !existing.has(table));
  if (missing.length > 0) {
    throw new Error(
      `Existing PostgreSQL schema is not compatible with canonical baseline; missing ${missing.length} required tables: ${missing.slice(0, 12).join(", ")}`,
    );
  }
}

async function adoptLegacySchema(client: Client, baseline: MigrationMaterial): Promise<void> {
  if (!adoptExisting) {
    throw new Error(
      "Existing PostgreSQL schema detected. Refusing to apply an empty-environment baseline. After a verified backup, rerun with BIS_POSTGRES_ADOPT_EXISTING=1 and BIS_POSTGRES_BACKUP_ID=<immutable-backup-identifier> to perform compatibility-checked adoption.",
    );
  }
  if (!backupId) {
    throw new Error("BIS_POSTGRES_BACKUP_ID is required for existing-schema adoption");
  }
  await assertLegacySchemaCompatible(client, baseline);
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO bis_migrations.schema_migrations (migration_index, tag, checksum, applied_at)
       VALUES ($1, $2, $3, NOW())`,
      [baseline.idx, baseline.tag, baseline.checksum],
    );
    await client.query("COMMIT");
    process.stdout.write(`Adopted existing PostgreSQL schema at ${baseline.tag} using backup ${backupId}\n`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: requirePostgresUrl(databaseUrl) });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('bis_postgres_migrations_v1'))");
    await client.query("CREATE SCHEMA IF NOT EXISTS bis_migrations");
    await client.query(`
      CREATE TABLE IF NOT EXISTS bis_migrations.schema_migrations (
        migration_index integer PRIMARY KEY,
        tag text NOT NULL UNIQUE,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL
      )
    `);

    const migrations = loadMigrations();
    const recorded = await client.query<{ migration_index: number; checksum: string }>(
      "SELECT migration_index, checksum FROM bis_migrations.schema_migrations ORDER BY migration_index",
    );
    const recordedChecksums = new Map(recorded.rows.map((row) => [row.migration_index, row.checksum]));
    for (const migration of migrations) {
      const priorChecksum = recordedChecksums.get(migration.idx);
      if (priorChecksum && priorChecksum !== migration.checksum) {
        throw new Error(`Migration ${migration.tag} checksum differs from its recorded value`);
      }
    }

    if (recorded.rowCount === 0 && await existingPublicTableCount(client) > 0) {
      const baseline = migrations[0];
      if (!baseline || baseline.idx !== 0) {
        throw new Error("A canonical baseline migration at index zero is required for existing-schema adoption");
      }
      await adoptLegacySchema(client, baseline);
      recordedChecksums.set(baseline.idx, baseline.checksum);
    }

    for (const migration of migrations) {
      if (recordedChecksums.has(migration.idx)) continue;
      await applyMigration(client, migration);
      process.stdout.write(`Applied ${migration.tag}\n`);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('bis_postgres_migrations_v1'))").catch(() => undefined);
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`PostgreSQL migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
