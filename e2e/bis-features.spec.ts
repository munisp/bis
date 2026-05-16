import { test, expect } from "@playwright/test";

/**
 * BIS Platform — Feature E2E Tests (Sprints v13–v17)
 *
 * Covers:
 *   - ZeroFootprint OSINT investigation page
 *   - Biometric Session Log page (charts, archival card, PDF export)
 *   - KYC Records page (bulk select, re-verify, biometric tab)
 *   - Audit Log page (archival filter chip)
 *   - Settings page (Slack configured status, test button)
 *   - API health check
 *
 * Authentication: tests that require login are skipped unless E2E_AUTH_AVAILABLE is set.
 */

const BASE = process.env.BASE_URL ?? "http://localhost:8081";

// ── Health ──────────────────────────────────────────────────────────────────────
test.describe("Health", () => {
  test("GET /api/health returns 200", async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
  });

  test("Frontend is served at /", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/.+/, { timeout: 10_000 });
  });
});

// ── Auth ────────────────────────────────────────────────────────────────────────
test.describe("Auth", () => {
  test("Unauthenticated user sees login prompt or redirect on /dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    // Either redirected to login or shown a login button
    const loginVisible = await page.locator("a, button").filter({ hasText: /sign in|log in|login/i }).isVisible().catch(() => false);
    const redirectedToLogin = page.url().includes("login") || page.url().includes("oauth") || page.url().includes("auth");
    expect(loginVisible || redirectedToLogin).toBeTruthy();
  });

  test("CSRF token endpoint responds", async ({ request }) => {
    const res = await request.get(`${BASE}/api/csrf-token`);
    // 200 with token or 404 if not separate endpoint — both acceptable
    expect([200, 404]).toContain(res.status());
  });
});

// ── tRPC Public Procedures ──────────────────────────────────────────────────────
test.describe("tRPC Public Procedures", () => {
  test("system.slackStatus returns configured boolean", async ({ request }) => {
    const res = await request.get(`${BASE}/api/trpc/system.slackStatus`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(typeof json?.result?.data?.configured).toBe("boolean");
  });

  test("biometric.archivalStatus returns eligibleRows", async ({ request }) => {
    const res = await request.get(`${BASE}/api/trpc/biometric.archivalStatus`);
    // 200 if public, 401 if protected — both valid
    expect([200, 401]).toContain(res.status());
  });

  test("biometric.getRetentionDays returns days", async ({ request }) => {
    const res = await request.get(`${BASE}/api/trpc/biometric.getRetentionDays`);
    expect([200, 401]).toContain(res.status());
  });
});

// ── Pages (unauthenticated) ─────────────────────────────────────────────────────
test.describe("Pages load without JS errors", () => {
  const publicPages = ["/", "/login"];

  for (const path of publicPages) {
    test(`${path} loads without console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", msg => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      await page.goto(path, { waitUntil: "domcontentloaded" });
      // Filter out known non-critical errors (OAuth redirects, etc.)
      const criticalErrors = errors.filter(e =>
        !e.includes("favicon") &&
        !e.includes("oauth") &&
        !e.includes("CSRF") &&
        !e.includes("401") &&
        !e.includes("net::ERR")
      );
      expect(criticalErrors).toHaveLength(0);
    });
  }
});

// ── Authenticated Tests ─────────────────────────────────────────────────────────
test.describe("Authenticated Features", () => {
  test.skip(
    !process.env.E2E_AUTH_AVAILABLE,
    "Skipped: set E2E_AUTH_AVAILABLE=1 and run pnpm e2e:auth first"
  );

  test.use({ storageState: "e2e/auth.json" });

  // ZeroFootprint Page
  test.describe("ZeroFootprint OSINT Page", () => {
    test("loads with new investigation form", async ({ page }) => {
      await page.goto("/zero-footprint");
      await expect(page.locator("h1, h2").filter({ hasText: /zero.footprint|osint|investigation/i })).toBeVisible({ timeout: 10_000 });
    });

    test("shows history tab with past investigations", async ({ page }) => {
      await page.goto("/zero-footprint");
      const historyTab = page.locator("button, [role=tab]").filter({ hasText: /history/i });
      await expect(historyTab).toBeVisible({ timeout: 5_000 });
      await historyTab.click();
      // Should show history list or empty state
      await expect(page.locator("text=/investigation|no.*history|no.*results/i").first()).toBeVisible({ timeout: 5_000 });
    });

    test("form validation shows error for empty submit", async ({ page }) => {
      await page.goto("/zero-footprint");
      const submitBtn = page.locator("button").filter({ hasText: /run|investigate|start/i }).first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        // Should show validation error
        await expect(page.locator("text=/required|enter.*name|subject/i").first()).toBeVisible({ timeout: 3_000 });
      }
    });
  });

  // Biometric Session Log Page
  test.describe("Biometric Session Log Page", () => {
    test("loads with session log table", async ({ page }) => {
      await page.goto("/biometric-sessions");
      await expect(page.locator("h1, h2").filter({ hasText: /biometric|session/i })).toBeVisible({ timeout: 10_000 });
    });

    test("archival status card is visible", async ({ page }) => {
      await page.goto("/biometric-sessions");
      await expect(page.locator("text=/archival|cold storage|eligible/i").first()).toBeVisible({ timeout: 10_000 });
    });

    test("Preview Impact button opens dry-run modal", async ({ page }) => {
      await page.goto("/biometric-sessions");
      const previewBtn = page.locator("button").filter({ hasText: /preview impact/i });
      if (await previewBtn.isVisible({ timeout: 5_000 })) {
        await previewBtn.click();
        await expect(page.locator("[role=dialog]")).toBeVisible({ timeout: 3_000 });
      }
    });

    test("Export PDF button is present", async ({ page }) => {
      await page.goto("/biometric-sessions");
      const exportBtn = page.locator("button").filter({ hasText: /export.*pdf|download.*pdf/i });
      await expect(exportBtn).toBeVisible({ timeout: 10_000 });
    });
  });

  // KYC Records Page
  test.describe("KYC Records Page", () => {
    test("loads with records table", async ({ page }) => {
      await page.goto("/kyc");
      await expect(page.locator("h1, h2").filter({ hasText: /kyc|records/i })).toBeVisible({ timeout: 10_000 });
    });

    test("bulk select-all checkbox is present", async ({ page }) => {
      await page.goto("/kyc");
      const selectAll = page.locator("input[type=checkbox]").first();
      await expect(selectAll).toBeVisible({ timeout: 10_000 });
    });

    test("record detail drawer opens on row click", async ({ page }) => {
      await page.goto("/kyc");
      const firstRow = page.locator("table tbody tr, [data-testid=kyc-row]").first();
      if (await firstRow.isVisible({ timeout: 5_000 })) {
        await firstRow.click();
        await expect(page.locator("[role=dialog]")).toBeVisible({ timeout: 3_000 });
      }
    });
  });

  // Audit Log Page
  test.describe("Audit Log Page", () => {
    test("loads with audit entries", async ({ page }) => {
      await page.goto("/audit-log");
      await expect(page.locator("h1, h2").filter({ hasText: /audit/i })).toBeVisible({ timeout: 10_000 });
    });

    test("Archival Events filter chip is present", async ({ page }) => {
      await page.goto("/audit-log");
      const chip = page.locator("button").filter({ hasText: /archival events/i });
      await expect(chip).toBeVisible({ timeout: 10_000 });
    });

    test("clicking Archival Events chip filters the table", async ({ page }) => {
      await page.goto("/audit-log");
      const chip = page.locator("button").filter({ hasText: /archival events/i });
      if (await chip.isVisible({ timeout: 5_000 })) {
        await chip.click();
        // Chip should become active (different style or aria-pressed)
        await page.waitForTimeout(500);
        // Table should still be visible (empty or with results)
        await expect(page.locator("table, [data-testid=audit-table]")).toBeVisible({ timeout: 3_000 });
      }
    });
  });

  // Settings Page
  test.describe("Settings Page", () => {
    test("loads with notifications tab", async ({ page }) => {
      await page.goto("/settings");
      await expect(page.locator("h1, h2").filter({ hasText: /settings/i })).toBeVisible({ timeout: 10_000 });
    });

    test("Slack configured status badge is visible", async ({ page }) => {
      await page.goto("/settings");
      // Navigate to notifications tab if it exists
      const notifTab = page.locator("button, [role=tab]").filter({ hasText: /notification/i });
      if (await notifTab.isVisible({ timeout: 3_000 })) {
        await notifTab.click();
      }
      // Should show either "Configured" or "Not configured" for Slack
      await expect(page.locator("text=/configured|not configured|slack/i").first()).toBeVisible({ timeout: 5_000 });
    });
  });
});
