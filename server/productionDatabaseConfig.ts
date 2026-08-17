export type DatabaseEnvironment = Record<string, string | undefined>;

const LOCAL_DEVELOPMENT_DATABASE_URL = "postgresql://bis_user:bis_secure_2026@localhost:5432/bis_db";

export function resolvePostgresDatabaseUrl(source: DatabaseEnvironment = process.env): string {
  return source.BIS_DATABASE_URL ?? source.DATABASE_URL ?? "";
}

export function configurePostgresDatabaseUrl(source: DatabaseEnvironment = process.env): string {
  const databaseUrl = resolvePostgresDatabaseUrl(source);
  const isPostgres = databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://");

  if (isPostgres) {
    source.DATABASE_URL = databaseUrl;
    return databaseUrl;
  }

  if (source.NODE_ENV === "production") {
    throw new Error(
      "[BIS] Production requires BIS_DATABASE_URL or DATABASE_URL to be an explicit PostgreSQL connection string; localhost fallback is disabled.",
    );
  }

  source.DATABASE_URL = LOCAL_DEVELOPMENT_DATABASE_URL;
  return LOCAL_DEVELOPMENT_DATABASE_URL;
}
