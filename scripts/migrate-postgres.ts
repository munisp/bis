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

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const migrationDirectory = resolve(repositoryRoot, "drizzle");
const journalPath = resolve(migrationDirectory, "meta", "_journal.json");
const databaseUrl = process.env.BIS_DATABASE_URL ?? process.env.DATABASE_URL ?? "";

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

async function applyMigration(client: Client, migration: MigrationEntry, sql: string, checksum: string): Promise<void> {
  const hasConcurrentIndex = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i.test(sql)
    || /\bDROP\s+INDEX\s+CONCURRENTLY\b/i.test(sql);
  const applyStatements = async () => {
    for (const statement of statements(sql)) {
      await client.query(statement);
    }
    await client.query(
      `INSERT INTO bis_migrations.schema_migrations (migration_index, tag, checksum, applied_at)
       VALUES ($1, $2, $3, NOW())`,
      [migration.idx, migration.tag, checksum],
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

    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as MigrationJournal;
    for (const migration of journal.entries.sort((left, right) => left.idx - right.idx)) {
      const path = resolve(migrationDirectory, `${migration.tag}.sql`);
      if (!existsSync(path)) {
        throw new Error(`Migration ${migration.tag} is listed in the journal but does not exist`);
      }
      const sql = readFileSync(path, "utf8");
      const checksum = sha256(sql);
      const prior = await client.query<{ checksum: string }>(
        "SELECT checksum FROM bis_migrations.schema_migrations WHERE migration_index = $1",
        [migration.idx],
      );
      if (prior.rowCount) {
        if (prior.rows[0].checksum !== checksum) {
          throw new Error(`Migration ${migration.tag} checksum differs from its recorded value`);
        }
        continue;
      }
      await applyMigration(client, migration, sql, checksum);
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
