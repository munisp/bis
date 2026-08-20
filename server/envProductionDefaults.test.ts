import { describe, expect, it } from "vitest";
import { resolveEnvironmentValue } from "./_core/env";

describe("production environment defaults", () => {
  it("retains local service defaults only in development", () => {
    expect(resolveEnvironmentValue("RISK_ENGINE_URL", "http://localhost:8082", { NODE_ENV: "development" })).toBe("http://localhost:8082");
  });

  it("does not synthesize localhost endpoints or development secrets in production", () => {
    const production = { NODE_ENV: "production" };
    expect(resolveEnvironmentValue("RISK_ENGINE_URL", "http://localhost:8082", production)).toBe("");
    expect(resolveEnvironmentValue("BIS_GATEWAY_KEY", "dev-gateway-key-change-in-prod", production)).toBe("");
    expect(resolveEnvironmentValue("AT_USERNAME", "sandbox", production)).toBe("");
  });

  it("preserves explicitly supplied production configuration", () => {
    expect(resolveEnvironmentValue("RISK_ENGINE_URL", "http://localhost:8082", { NODE_ENV: "production", RISK_ENGINE_URL: "https://risk.internal.example" })).toBe("https://risk.internal.example");
  });
});
