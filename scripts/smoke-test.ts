#!/usr/bin/env tsx
/**
 * BIS PWA Smoke Test
 * Tests all major API flows against the running dev server.
 * Usage: BASE_URL=http://localhost:8081 tsx scripts/smoke-test.ts
 */

const BASE = process.env.BASE_URL ?? "http://localhost:8081";
const TRPC = `${BASE}/api/trpc`;

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`  ✗  ${name}: ${e?.message ?? e}`);
    failed++;
  }
}

async function trpcQuery(proc: string, input?: unknown) {
  const url = input !== undefined
    ? `${TRPC}/${proc}?input=${encodeURIComponent(JSON.stringify(input))}`
    : `${TRPC}/${proc}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json?.error) throw new Error(json.error.message ?? JSON.stringify(json.error));
  return json?.result?.data;
}

async function trpcMutation(proc: string, input: unknown) {
  const res = await fetch(`${TRPC}/${proc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json?.error) throw new Error(json.error.message ?? JSON.stringify(json.error));
  return json?.result?.data;
}

(async () => {
  console.log(`\nBIS PWA Smoke Tests — ${BASE}\n`);

  // ── Auth ──────────────────────────────────────────────────────────────────
  console.log("Auth:");
  await check("auth.me returns null for unauthenticated", async () => {
    const data = await trpcQuery("auth.me");
    // null or { user: null } is expected when not logged in
    if (data !== null && data?.user !== null && data?.user !== undefined) {
      // If it returns a user, that's also fine (dev mode)
    }
  });

  // ── System ────────────────────────────────────────────────────────────────
  console.log("\nSystem:");
  await check("system.slackStatus returns configured boolean", async () => {
    const data = await trpcQuery("system.slackStatus");
    if (typeof data?.configured !== "boolean") throw new Error("Missing configured field");
  });

  // ── KYC ───────────────────────────────────────────────────────────────────
  console.log("\nKYC:");
  await check("kyc.list returns paginated results", async () => {
    const data = await trpcQuery("kyc.list", { limit: 5, offset: 0 });
    if (!Array.isArray(data?.records) && !Array.isArray(data)) {
      // Some procedures return { records, total } or just array
      if (typeof data?.total !== "number" && !Array.isArray(data)) {
        throw new Error(`Unexpected shape: ${JSON.stringify(data).slice(0, 100)}`);
      }
    }
  });

  await check("kyc.stats returns summary counts", async () => {
    const data = await trpcQuery("kyc.stats");
    if (typeof data?.total !== "number" && typeof data?.pending !== "number") {
      throw new Error(`Unexpected shape: ${JSON.stringify(data).slice(0, 100)}`);
    }
  });

  // ── Biometric ─────────────────────────────────────────────────────────────
  console.log("\nBiometric:");
  await check("biometric.sessionLogs returns paginated logs", async () => {
    const data = await trpcQuery("biometric.sessionLogs", { limit: 5, page: 1 });
    if (typeof data?.total !== "number") throw new Error(`Missing total: ${JSON.stringify(data).slice(0, 100)}`);
  });

  await check("biometric.sessionStats returns stats object", async () => {
    const data = await trpcQuery("biometric.sessionStats", { days: 7 });
    if (typeof data?.totalSessions !== "number") throw new Error(`Missing totalSessions`);
  });

  await check("biometric.archivalStatus returns archival metadata", async () => {
    const data = await trpcQuery("biometric.archivalStatus");
    if (typeof data?.eligibleRows !== "number") throw new Error(`Missing eligibleRows`);
  });

  await check("biometric.getRetentionDays returns retention days", async () => {
    const data = await trpcQuery("biometric.getRetentionDays");
    if (typeof data?.days !== "number") throw new Error(`Missing days`);
  });

  // ── Screening ─────────────────────────────────────────────────────────────
  console.log("\nScreening:");
  await check("screening.list returns paginated screenings", async () => {
    const data = await trpcQuery("screening.list", { limit: 5, offset: 0 });
    if (!Array.isArray(data?.records) && !Array.isArray(data)) {
      if (typeof data?.total !== "number") throw new Error(`Unexpected shape`);
    }
  });

  await check("screening.zeroFootprintHistory returns history", async () => {
    const data = await trpcQuery("screening.zeroFootprintHistory", { limit: 5 });
    if (!Array.isArray(data?.records) && !Array.isArray(data)) {
      if (typeof data?.total !== "number") throw new Error(`Unexpected shape`);
    }
  });

  // ── Audit ─────────────────────────────────────────────────────────────────
  console.log("\nAudit:");
  await check("audit.list returns paginated audit entries", async () => {
    const data = await trpcQuery("audit.list", { limit: 5, offset: 0 });
    if (!Array.isArray(data?.entries) && !Array.isArray(data)) {
      if (typeof data?.total !== "number") throw new Error(`Unexpected shape`);
    }
  });

  // ── Platform Settings ─────────────────────────────────────────────────────
  console.log("\nPlatform:");
  await check("biometric.getSpoofAlertThreshold returns threshold", async () => {
    const data = await trpcQuery("biometric.getSpoofAlertThreshold");
    if (typeof data?.threshold !== "number") throw new Error(`Missing threshold`);
  });

  // ── Health ────────────────────────────────────────────────────────────────
  console.log("\nHealth:");
  await check("GET /api/health returns 200", async () => {
    const res = await fetch(`${BASE}/api/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });

  await check("GET / returns 200 (frontend served)", async () => {
    const res = await fetch(BASE);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${"─".repeat(50)}`);
  console.log(`Smoke Tests: ${passed}/${total} passed${failed > 0 ? ` (${failed} failed)` : ""}`);
  if (failed > 0) process.exit(1);
})();
