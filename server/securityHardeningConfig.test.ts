import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("enterprise security hardening configuration", () => {
  it("keeps APISIX, OpenAppSec, and Caddy administration ports off the host in the base compose stack", async () => {
    const compose = await readFile(resolve(root, "docker-compose.yml"), "utf8");
    expect(compose).not.toContain('"2019:2019"');
    expect(compose).not.toContain('"9080:9080"');
    expect(compose).not.toContain('"9180:9180"');
    expect(compose).toContain("opa:");
  });

  it("requires Keycloak TOTP enrollment, refresh-token rotation, strict redirect origins, and administrator audit events", async () => {
    const realm = await readFile(resolve(root, "infra/keycloak/bis-realm.json"), "utf8");
    expect(realm).toContain('"revokeRefreshToken": true');
    expect(realm).toContain('"refreshTokenMaxReuse": 0');
    expect(realm).toContain('"authenticator": "auth-otp-form", "requirement": "REQUIRED"');
    expect(realm).toContain('"adminEventsEnabled": true');
    expect(realm).not.toContain("https://*.manus.space/*");
    expect(realm).not.toContain("admin_dev_password");
  });

  it("uses v1beta2 OpenAppSec policy objects and fail-closed OPA checks for gateway privileged actions", async () => {
    const [waf, apisix, opa] = await Promise.all([
      readFile(resolve(root, "infra/open-appsec/local_policy.yaml"), "utf8"),
      readFile(resolve(root, "infra/apisix/conf/apisix.yaml"), "utf8"),
      readFile(resolve(root, "infra/opa/bis.rego"), "utf8"),
    ]);
    expect(waf).toContain("apiVersion: v1beta2");
    expect(waf).toContain("threatPreventionPractices:");
    expect(waf).toContain("accessControlPractices:");
    expect(apisix).toContain("id: privileged-gateway-admin");
    expect(apisix).toContain('policy: "bis/authz"');
    expect(opa).toContain("Force Credit approval requires a successful MFA step-up");
    expect(opa).toContain("input.mfaPassed == true");
    expect(opa).toContain("requires_dual_control if input.action == \"caddy_rate_limit_override\"");
    expect(opa).toContain("has_independent_approver if input.approverId != input.actorId");
    expect(opa).toContain("requires_dual_control if input.action == \"gateway_break_glass\"");
  });

  it("requires real MFA, independent approval, policy authorization, and immutable evidence for Caddy break-glass changes", async () => {
    const caddy = await readFile(resolve(root, "server/caddy.ts"), "utf8");
    expect(caddy).toContain("Break-glass requires an independent approver");
    expect(caddy).toContain("Valid TOTP step-up is required");
    expect(caddy).toContain('action: "caddy_rate_limit_override"');
    expect(caddy).toContain("break_glass_authorized");
    expect(caddy).toContain("break_glass_executed");
  });

  it("authenticates Gateway /v1 traffic and applies live OPA-and-audit privileged middleware", async () => {
    const [caddy, gatewayMain, compose] = await Promise.all([
      readFile(resolve(root, "infra/caddy/Caddyfile"), "utf8"),
      readFile(resolve(root, "services/gateway/main.go"), "utf8"),
      readFile(resolve(root, "docker-compose.yml"), "utf8"),
    ]);
    expect(caddy).toContain("@protected_api path /api/* /v1/*");
    expect(caddy).toContain('header_up X-BIS-MFA-Verified "keycloak-totp-required"');
    expect(gatewayMain).toContain("privilegedControls.PrivilegedAccess(mux)");
    expect(compose).toContain("BIS_BREAK_GLASS_AUDIT_URL: http://bff:3000/api/internal/break-glass-audit");
  });
});
