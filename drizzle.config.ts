import { defineConfig } from "drizzle-kit";

// BIS platform uses local PostgreSQL. Always use the local PG URL for migrations.
const rawUrl = process.env.DATABASE_URL ?? "";
const connectionString =
  rawUrl.startsWith("postgresql") || rawUrl.startsWith("postgres")
    ? rawUrl
    : "postgresql://bis_user:bis_secure_2026@localhost:5432/bis_db";

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
