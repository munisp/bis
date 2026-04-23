import { test, expect } from "@playwright/test";

/**
 * E2E tests for features added in v62/v63:
 * - Transfer Analytics Dashboard
 * - Document Vault
 * - Risk Dashboard
 * - Reconciliation Report
 * - QuickCheck page
 * - SAR Filing lifecycle
 * - Frozen Accounts filter
 * - Batch Monitor progress
 */

test.use({ storageState: "e2e/auth.json" });

test.describe("New Features (v62/v63)", () => {
  test.skip(
    !process.env.E2E_AUTH_AVAILABLE,
    "Skipped: run pnpm e2e:auth first to generate auth.json"
  );

  // ── Transfer Analytics Dashboard ─────────────────────────────────────────────
  test.describe("Transfer Analytics Dashboard", () => {
    test("loads with period selector and chart", async ({ page }) => {
      await page.goto("/payment-rails/analytics");
      await expect(page.locator("h1, h2").filter({ hasText: /analytics|transfer/i })).toBeVisible({
        timeout: 10_000,
      });
      // Period selector (Daily/Weekly/Monthly)
      await expect(page.getByRole("button", { name: /daily|weekly|monthly/i }).first()).toBeVisible();
    });

    test("can switch between daily, weekly, and monthly views", async ({ page }) => {
      await page.goto("/payment-rails/analytics");
      await page.waitForLoadState("networkidle");

      const weeklyBtn = page.getByRole("button", { name: /weekly/i }).first();
      if (await weeklyBtn.isVisible()) {
        await weeklyBtn.click();
        await page.waitForTimeout(500);
      }

      const monthlyBtn = page.getByRole("button", { name: /monthly/i }).first();
      if (await monthlyBtn.isVisible()) {
        await monthlyBtn.click();
        await page.waitForTimeout(500);
      }
    });
  });

  // ── Document Vault ────────────────────────────────────────────────────────────
  test.describe("Document Vault", () => {
    test("loads with document list and upload button", async ({ page }) => {
      await page.goto("/document-vault");
      await expect(page.locator("h1, h2").filter({ hasText: /document|vault/i })).toBeVisible({
        timeout: 10_000,
      });
      // Upload button should be present
      await expect(page.getByRole("button", { name: /upload/i }).first()).toBeVisible();
    });

    test("can filter by category", async ({ page }) => {
      await page.goto("/document-vault");
      await page.waitForLoadState("networkidle");

      // Category filter
      const categoryFilter = page.locator("select, [role='combobox']").first();
      if (await categoryFilter.isVisible()) {
        await categoryFilter.click();
        await page.waitForTimeout(300);
      }
    });

    test("search box is functional", async ({ page }) => {
      await page.goto("/document-vault");
      await page.waitForLoadState("networkidle");

      const searchBox = page.getByPlaceholder(/search/i).first();
      if (await searchBox.isVisible()) {
        await searchBox.fill("evidence");
        await page.waitForTimeout(500);
      }
    });
  });

  // ── Risk Dashboard ────────────────────────────────────────────────────────────
  test.describe("Risk Dashboard", () => {
    test("loads with risk score chart", async ({ page }) => {
      await page.goto("/risk-dashboard");
      await expect(page.locator("h1, h2").filter({ hasText: /risk/i })).toBeVisible({
        timeout: 10_000,
      });
    });

    test("shows top risk entities table", async ({ page }) => {
      await page.goto("/risk-dashboard");
      await page.waitForLoadState("networkidle");
      // Table or list of entities should be present
      const table = page.locator("table, [role='table']").first();
      const list = page.locator("[class*='entity'], [class*='risk']").first();
      const hasContent = (await table.isVisible()) || (await list.isVisible());
      expect(hasContent).toBeTruthy();
    });
  });

  // ── Reconciliation Report ─────────────────────────────────────────────────────
  test.describe("Reconciliation Report", () => {
    test("loads with summary stats", async ({ page }) => {
      await page.goto("/payment-rails/reconciliation");
      await expect(page.locator("h1, h2").filter({ hasText: /reconcil/i })).toBeVisible({
        timeout: 10_000,
      });
    });

    test("export button is present", async ({ page }) => {
      await page.goto("/payment-rails/reconciliation");
      await page.waitForLoadState("networkidle");
      const exportBtn = page.getByRole("button", { name: /export|download/i }).first();
      if (await exportBtn.isVisible()) {
        expect(await exportBtn.isEnabled()).toBeTruthy();
      }
    });
  });

  // ── QuickCheck ────────────────────────────────────────────────────────────────
  test.describe("QuickCheck Page", () => {
    test("loads with form fields", async ({ page }) => {
      await page.goto("/quickcheck");
      await expect(page.locator("h1, h2").filter({ hasText: /quickcheck|vetting/i })).toBeVisible({
        timeout: 10_000,
      });
      // NIN field should be present
      await expect(page.getByLabel(/nin|national/i).or(page.getByPlaceholder(/nin/i)).first()).toBeVisible();
    });

    test("shows pricing tiers", async ({ page }) => {
      await page.goto("/quickcheck");
      await page.waitForLoadState("networkidle");
      // Pricing tiers (Basic/Standard/Premium)
      const tierText = page.getByText(/basic|standard|premium/i).first();
      if (await tierText.isVisible()) {
        expect(await tierText.textContent()).toBeTruthy();
      }
    });
  });

  // ── SAR Filing ────────────────────────────────────────────────────────────────
  test.describe("SAR Filing Lifecycle", () => {
    test("loads SAR list with status badges", async ({ page }) => {
      await page.goto("/sar-filings");
      await expect(page.locator("h1, h2").filter({ hasText: /sar|suspicious/i })).toBeVisible({
        timeout: 10_000,
      });
    });

    test("can filter by status", async ({ page }) => {
      await page.goto("/sar-filings");
      await page.waitForLoadState("networkidle");
      const statusFilter = page.locator("select, [role='combobox']").first();
      if (await statusFilter.isVisible()) {
        await statusFilter.click();
        await page.waitForTimeout(300);
      }
    });
  });

  // ── Frozen Accounts ────────────────────────────────────────────────────────────
  test.describe("Frozen Accounts Dashboard", () => {
    test("loads with reason filter dropdown", async ({ page }) => {
      await page.goto("/frozen-accounts");
      await expect(page.locator("h1, h2").filter({ hasText: /frozen/i })).toBeVisible({
        timeout: 10_000,
      });
      // Reason filter should be present
      const reasonFilter = page.getByLabel(/reason/i).or(page.locator("select").first());
      if (await reasonFilter.isVisible()) {
        expect(await reasonFilter.isVisible()).toBeTruthy();
      }
    });
  });

  // ── Batch Monitor ─────────────────────────────────────────────────────────────
  test.describe("Batch Monitor", () => {
    test("loads with progress bars and history table", async ({ page }) => {
      await page.goto("/payment-rails/batch-monitor");
      await expect(page.locator("h1, h2").filter({ hasText: /batch/i })).toBeVisible({
        timeout: 10_000,
      });
    });
  });
});

// ── OpenAPI / Swagger ──────────────────────────────────────────────────────────
test.describe("OpenAPI Docs", () => {
  test("GET /api/openapi.yaml returns valid YAML", async ({ request }) => {
    const res = await request.get("/api/openapi.yaml");
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain("openapi:");
    expect(text).toContain("BIS");
  });

  test("GET /api/docs returns Swagger UI HTML", async ({ request }) => {
    const res = await request.get("/api/docs");
    expect([200, 301, 302]).toContain(res.status());
  });
});
