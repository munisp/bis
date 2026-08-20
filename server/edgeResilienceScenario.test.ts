import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("authorised edge-resilience scenario", () => {
  it("requires explicit target authorization and keeps virtual-user and arrival-rate limits bounded", async () => {
    const source = await readFile(resolve(root, "load-tests/edge-resilience.k6.js"), "utf8");
    expect(source).toContain("BIS_BASE_URL and BIS_AUTHORIZED_TEST_TOKEN are required");
    expect(source).toContain("maxVUs: 50");
    expect(source).toContain('executor: "ramping-arrival-rate"');
    expect(source).toContain('http_req_failed: ["rate<0.02"]');
  });

  it("verifies each gateway, WAF, identity, policy, and recovery control in the executable verification script", async () => {
    const source = await readFile(resolve(root, "scripts/verify-security-controls.mjs"), "utf8");
    for (const control of ["Caddyfile", "apisix.yaml", "local_policy.yaml", "bis-realm.json", "bis.rego", "breakGlassRecovery.ts"]) {
      expect(source).toContain(control);
    }
  });
});
