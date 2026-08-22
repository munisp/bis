import { describe, expect, it } from "vitest";
import { configuredOrDevelopmentDefault, missingProductionConfig, resolveDatabaseUrl } from "./_core/env";

describe("production environment defaults", () => {
  it("retains a local development default outside production", () => {
    expect(configuredOrDevelopmentDefault(
      "BIS_GATEWAY_URL",
      "http://localhost:8081",
      { NODE_ENV: "development" },
    )).toBe("http://localhost:8081");
  });

  it("rejects implicit localhost and development-secret defaults in production", () => {
    expect(configuredOrDevelopmentDefault(
      "BIS_GATEWAY_URL",
      "http://localhost:8081",
      { NODE_ENV: "production" },
    )).toBe("");
    expect(configuredOrDevelopmentDefault(
      "BIS_GATEWAY_KEY",
      "dev-gateway-key-change-in-prod",
      { NODE_ENV: "production" },
    )).toBe("");
  });

  it("uses an explicit production configuration value", () => {
    expect(configuredOrDevelopmentDefault(
      "BIS_GATEWAY_URL",
      "http://localhost:8081",
      { NODE_ENV: "production", BIS_GATEWAY_URL: "https://gateway.internal.example" },
    )).toBe("https://gateway.internal.example");
  });

  it("selects local PostgreSQL for development when the platform injects TiDB", () => {
    expect(resolveDatabaseUrl({
      NODE_ENV: "development",
      DATABASE_URL: "mysql://platform-injected.example/bis",
    })).toBe("postgresql://bis_user:bis_secure_2026@localhost:5432/bis_db");
  });

  it("accepts only an explicit PostgreSQL override over injected TiDB in production", () => {
    expect(resolveDatabaseUrl({
      NODE_ENV: "production",
      DATABASE_URL: "mysql://platform-injected.example/bis",
    })).toBe("mysql://platform-injected.example/bis");
    expect(resolveDatabaseUrl({
      NODE_ENV: "production",
      DATABASE_URL: "mysql://platform-injected.example/bis",
      BIS_DATABASE_URL: "postgresql://managed.example/bis",
    })).toBe("postgresql://managed.example/bis");
  });

  it("identifies every mandatory production secret or service endpoint that is absent", () => {
    expect(missingProductionConfig({
      BIS_GATEWAY_KEY: "gateway-key",
      BIS_GATEWAY_URL: "https://gateway.internal.example",
      TIGERBEETLE_HTTP_URL: "https://ledger.internal.example",
      PERMIFY_URL: "https://permify.internal.example",
      KEYCLOAK_URL: "https://identity.internal.example",
      REDIS_URL: "rediss://cache.internal.example",
      BIS_WAF_KEY: "waf-key",
      BIS_EDGE_TOKEN_SECRET: "edge-secret",
      AUDIT_HMAC_SECRET: "audit-secret",
      GRAFANA_WEBHOOK_SECRET: "grafana-secret",
    })).toEqual([]);
    expect(missingProductionConfig({ BIS_GATEWAY_KEY: "gateway-key" })).toContain("TIGERBEETLE_HTTP_URL");
  });
});
