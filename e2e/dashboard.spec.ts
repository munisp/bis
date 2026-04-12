import { test, expect } from "@playwright/test";

/**
 * Dashboard and core page E2E tests.
 * These tests use a pre-authenticated session (set via storageState).
 * To run these tests, first run: pnpm e2e:auth to generate auth.json
 */

// Skip these tests if no auth state is available
test.use({ storageState: "e2e/auth.json" });

test.describe("Dashboard (Authenticated)", () => {
  test.skip(
    !process.env.E2E_AUTH_AVAILABLE,
    "Skipped: run pnpm e2e:auth first to generate auth.json"
  );

  test("Dashboard page loads with KPI widgets", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("h1, h2").filter({ hasText: /dashboard|overview/i })).toBeVisible({
      timeout: 10_000,
    });
    // KPI cards should be present
    await expect(page.locator("[data-testid='kpi-card'], .kpi-card, [class*='card']").first()).toBeVisible();
  });

  test("Investigations list page loads", async ({ page }) => {
    await page.goto("/investigations");
    await expect(page.locator("h1, h2").filter({ hasText: /investigation/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("Cases list page loads", async ({ page }) => {
    await page.goto("/cases");
    await expect(page.locator("h1, h2").filter({ hasText: /case/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("LEX review page loads", async ({ page }) => {
    await page.goto("/lex/review");
    await expect(page.locator("h1, h2").filter({ hasText: /lex|review|submission/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("Alerts page loads", async ({ page }) => {
    await page.goto("/alerts");
    await expect(page.locator("h1, h2").filter({ hasText: /alert/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("goAML wizard page loads", async ({ page }) => {
    await page.goto("/goaml");
    await expect(page.locator("h1, h2").filter({ hasText: /goaml|str|suspicious/i })).toBeVisible({
      timeout: 10_000,
    });
  });
});
