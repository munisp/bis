import { describe, expect, it } from "vitest";
import { configurePostgresDatabaseUrl } from "./productionDatabaseConfig";

describe("production PostgreSQL configuration", () => {
  it("uses the local PostgreSQL topology only outside production", () => {
    const environment = { NODE_ENV: "development" };
    expect(configurePostgresDatabaseUrl(environment)).toContain("localhost:5432/bis_db");
    expect(environment.DATABASE_URL).toContain("localhost:5432/bis_db");
  });

  it("rejects missing production database configuration instead of substituting localhost", () => {
    expect(() => configurePostgresDatabaseUrl({ NODE_ENV: "production" })).toThrow(/localhost fallback is disabled/);
  });

  it("prefers the explicit BIS PostgreSQL URL over an injected non-PostgreSQL platform URL", () => {
    const environment = {
      NODE_ENV: "production",
      DATABASE_URL: "mysql://platform-injected-url",
      BIS_DATABASE_URL: "postgresql://bis:secret@managed-db.example/bis",
    };
    expect(configurePostgresDatabaseUrl(environment)).toBe(environment.BIS_DATABASE_URL);
    expect(environment.DATABASE_URL).toBe(environment.BIS_DATABASE_URL);
  });
});
