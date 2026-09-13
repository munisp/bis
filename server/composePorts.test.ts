/**
 * server/composePorts.test.ts — WP6 FIX A regression test.
 *
 * Phase-1 audit found nine host-port collisions across the compose files
 * (e.g. Keycloak and open-appsec both binding host 8080; three services on
 * 8090; InfluxDB and verifier on 8086). Colliding host ports make
 * `docker compose up` fail with "port is already allocated".
 *
 * This test parses every docker-compose*.yml at the repo root and asserts
 * that no host port is bound by two different services in the same file.
 * Container ports are intentionally NOT checked — only host bindings collide.
 *
 * Run: pnpm vitest run server/composePorts.test.ts
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const COMPOSE_FILES = fs
  .readdirSync(REPO_ROOT)
  .filter((f) => /^docker-compose.*\.ya?ml$/.test(f))
  .sort();

interface ComposeDoc {
  services?: Record<
    string,
    { ports?: Array<string | { published?: number | string; target?: number | string }> }
  >;
}

/** Extract the host (published) port from a compose port mapping. */
function hostPort(mapping: string | { published?: number | string }): string | null {
  if (typeof mapping === "object" && mapping !== null) {
    return mapping.published != null ? String(mapping.published) : null;
  }
  // Short syntax: "[IP:]HOST:CONTAINER[/proto]" or "CONTAINER" (no host bind)
  const noProto = String(mapping).split("/")[0];
  const parts = noProto.split(":");
  if (parts.length === 1) return null; // container port only, not host-bound
  if (parts.length === 2) return parts[0];
  return parts[parts.length - 2]; // IP:HOST:CONTAINER
}

describe("docker-compose host port allocation (WP6 FIX A)", () => {
  it("at least one compose file exists at the repo root", () => {
    expect(COMPOSE_FILES.length).toBeGreaterThan(0);
  });

  for (const file of COMPOSE_FILES) {
    it(`${file}: no host port is bound by more than one service`, () => {
      const doc = yaml.load(fs.readFileSync(path.join(REPO_ROOT, file), "utf8")) as ComposeDoc;
      const byPort = new Map<string, string[]>();
      for (const [service, def] of Object.entries(doc.services ?? {})) {
        for (const mapping of def.ports ?? []) {
          const host = hostPort(mapping);
          if (!host) continue;
          // Skip port ranges (e.g. "9000-9010:9000") — none used today.
          if (host.includes("-")) continue;
          const owners = byPort.get(host) ?? [];
          owners.push(service);
          byPort.set(host, owners);
        }
      }
      const collisions = [...byPort.entries()].filter(([, owners]) => owners.length > 1);
      expect(
        collisions,
        `${file} has host port collisions: ${collisions
          .map(([p, s]) => `${p} <- ${s.join(", ")}`)
          .join("; ")}`,
      ).toEqual([]);
    });
  }

  it("docker-compose.prod.yml does not reintroduce the nginx/apisix 443 collision", () => {
    const doc = yaml.load(
      fs.readFileSync(path.join(REPO_ROOT, "docker-compose.prod.yml"), "utf8"),
    ) as ComposeDoc;
    const apisixPorts = (doc.services?.apisix?.ports ?? []).map((p) => hostPort(p));
    const nginxPorts = (doc.services?.nginx?.ports ?? []).map((p) => hostPort(p));
    expect(apisixPorts).not.toContain("443");
    expect(nginxPorts).toContain("443");
  });
});
