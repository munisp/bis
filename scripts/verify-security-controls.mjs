import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.env.BIS_SECURITY_CONFIG_ROOT ?? process.cwd();
const required = [
  ["infra/caddy/Caddyfile", "@protected_api path /api/* /v1/*"],
  ["infra/apisix/conf/apisix.yaml", "opa"],
  ["infra/open-appsec/local_policy.yaml", "v1beta2"],
  ["infra/keycloak/bis-realm.json", "CONFIGURE_TOTP"],
  ["infra/opa/bis.rego", "gateway_break_glass"],
  ["server/breakGlassRecovery.ts", "break_glass_execution_recovery_required"],
];

for (const [file, expected] of required) {
  const content = readFileSync(resolve(root, file), "utf8");
  if (!content.includes(expected)) throw new Error(`Security control missing: ${file} must contain ${expected}`);
}
console.log(JSON.stringify({ ok: true, verifiedControls: required.length }));
