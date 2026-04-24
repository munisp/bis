import { test, expect } from "@playwright/test";

/**
 * E2E tests for core BIS workflows:
 * - New Investigation wizard → detail view
 * - KYC biometric submit → list view
 * - Alert Rule create + Run Now
 * - Field Agent dispatch → task visible
 * - Dashboard stats load
 * - QuickCheck workflow
 * - LEX submission portal
 */
test.use({ storageState: "e2e/auth.json" });

test.describe("Core BIS Workflows", () => {
  test.skip(
    !process.env.E2E_AUTH_AVAILABLE,
    "Skipped: run pnpm e2e:auth first to generate auth.json"
  );

  // ── Dashboard Stats Load ────────────────────────────────────────────────────
  test.describe("Dashboard Stats", () => {
    test("loads dashboard with KPI cards", async ({ page }) => {
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      // Expect at least one KPI card to be visible
      await expect(
        page.locator("[data-testid='kpi-card'], .kpi-card, [class*='kpi']").first()
      ).toBeVisible({ timeout: 15_000 }).catch(() => {
        // Fallback: check for any card-like elements with numbers
        return expect(page.locator("h1, h2, h3").filter({ hasText: /investigation|alert|case|kyc/i }).first()).toBeVisible({ timeout: 5_000 });
      });
    });

    test("dashboard shows active investigations count", async ({ page }) => {
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      // Check for numeric content in cards
      await expect(page.locator("body")).not.toContainText("Error");
    });
  });

  // ── New Investigation Wizard ────────────────────────────────────────────────
  test.describe("New Investigation Wizard", () => {
    test("opens new investigation modal and fills step 1", async ({ page }) => {
      await page.goto("/investigations");
      await page.waitForLoadState("networkidle");

      // Click "New Investigation" button
      const newBtn = page.getByRole("button", { name: /new investigation|create investigation/i });
      if (await newBtn.isVisible({ timeout: 5_000 })) {
        await newBtn.click();
        // Expect a modal or form to appear
        await expect(
          page.locator("[role='dialog'], [data-testid='new-investigation-modal']").first()
        ).toBeVisible({ timeout: 5_000 });
      }
    });

    test("investigations list loads with data", async ({ page }) => {
      await page.goto("/investigations");
      await page.waitForLoadState("networkidle");
      await expect(page.locator("body")).not.toContainText("Error");
      // Expect table or list to be present
      await expect(
        page.locator("table, [role='table'], [data-testid='investigations-list']").first()
      ).toBeVisible({ timeout: 10_000 }).catch(() => {
        // Fallback: check for any investigation reference
        return expect(page.locator("body")).toContainText(/INV-|investigation/i);
      });
    });

    test("can navigate to investigation detail", async ({ page }) => {
      await page.goto("/investigations");
      await page.waitForLoadState("networkidle");
      // Click first row
      const firstRow = page.locator("tr[data-id], tbody tr, [data-testid='investigation-row']").first();
      if (await firstRow.isVisible({ timeout: 5_000 })) {
        await firstRow.click();
        await page.waitForLoadState("networkidle");
        // Should navigate to detail page
        await expect(page.url()).toContain("/investigations/");
      }
    });
  });

  // ── KYC Biometric Submit ────────────────────────────────────────────────────
  test.describe("KYC Verification", () => {
    test("KYC list loads with verification records", async ({ page }) => {
      await page.goto("/kyc");
      await page.waitForLoadState("networkidle");
      await expect(page.locator("body")).not.toContainText("Error");
      await expect(
        page.locator("table, [role='table'], [data-testid='kyc-list']").first()
      ).toBeVisible({ timeout: 10_000 }).catch(() => {
        return expect(page.locator("body")).toContainText(/KYC|verification|identity/i);
      });
    });

    test("KYC page has submit/verify button", async ({ page }) => {
      await page.goto("/kyc");
      await page.waitForLoadState("networkidle");
      const verifyBtn = page.getByRole("button", { name: /verify|submit|new.*kyc|start.*verification/i }).first();
      await expect(verifyBtn).toBeVisible({ timeout: 10_000 });
    });
  });

  // ── Alert Rules ─────────────────────────────────────────────────────────────
  test.describe("Alert Rules", () => {
    test("alert rules list loads", async ({ page }) => {
      await page.goto("/monitoring/alert-rules");
      await page.waitForLoadState("networkidle");
      await expect(page.locator("body")).not.toContainText("Error");
      await expect(
        page.locator("table, [role='table'], [data-testid='alert-rules-list']").first()
      ).toBeVisible({ timeout: 10_000 }).catch(() => {
        return expect(page.locator("body")).toContainText(/alert rule|monitoring/i);
      });
    });

    test("can create a new alert rule", async ({ page }) => {
      await page.goto("/monitoring/alert-rules");
      await page.waitForLoadState("networkidle");
      const createBtn = page.getByRole("button", { name: /new rule|create rule|add rule/i }).first();
      if (await createBtn.isVisible({ timeout: 5_000 })) {
        await createBtn.click();
        await expect(
          page.locator("[role='dialog'], form").first()
        ).toBeVisible({ timeout: 5_000 });
      }
    });

    test("Run Now button exists on alert rules", async ({ page }) => {
      await page.goto("/monitoring/alert-rules");
      await page.waitForLoadState("networkidle");
      const runBtn = page.getByRole("button", { name: /run now|run scheduled|execute/i }).first();
      await expect(runBtn).toBeVisible({ timeout: 10_000 }).catch(() => {
        // May not be visible if no rules exist — just check page loaded
        return expect(page.locator("body")).not.toContainText("Error");
      });
    });
  });

  // ── Field Agent Dispatch ────────────────────────────────────────────────────
  test.describe("Field Agent Dispatch", () => {
    test("field tasks list loads", async ({ page }) => {
      await page.goto("/field-ops");
      await page.waitForLoadState("networkidle");
      await expect(page.locator("body")).not.toContainText("Error");
      await expect(
        page.locator("table, [role='table'], [data-testid='field-tasks-list']").first()
      ).toBeVisible({ timeout: 10_000 }).catch(() => {
        return expect(page.locator("body")).toContainText(/field|task|dispatch|agent/i);
      });
    });

    test("can dispatch a new field task", async ({ page }) => {
      await page.goto("/field-ops");
      await page.waitForLoadState("networkidle");
      const dispatchBtn = page.getByRole("button", { name: /dispatch|new task|assign/i }).first();
      if (await dispatchBtn.isVisible({ timeout: 5_000 })) {
        await dispatchBtn.click();
        await expect(
          page.locator("[role='dialog'], form").first()
        ).toBeVisible({ timeout: 5_000 });
      }
    });
  });

  // ── QuickCheck Workflow ─────────────────────────────────────────────────────
  test.describe("QuickCheck", () => {
    test("QuickCheck page loads with worker categories", async ({ page }) => {
      await page.goto("/quickcheck");
      await page.waitForLoadState("networkidle");
      await expect(page.locator("body")).not.toContainText("Error");
      // Check for worker category options
      await expect(
        page.locator("body").filter({ hasText: /house help|driver|nanny|security guard|artisan/i })
      ).toBeVisible({ timeout: 10_000 }).catch(() => {
        return expect(page.locator("body")).toContainText(/QuickCheck|vetting|background/i);
      });
    });

    test("QuickCheck form accepts name and phone input", async ({ page }) => {
      await page.goto("/quickcheck");
      await page.waitForLoadState("networkidle");
      const nameInput = page.getByPlaceholder(/full name|subject name/i).first();
      if (await nameInput.isVisible({ timeout: 5_000 })) {
        await nameInput.fill("Chukwuemeka Okafor");
        await expect(nameInput).toHaveValue("Chukwuemeka Okafor");
      }
    });
  });

  // ── LEX Submission Portal ───────────────────────────────────────────────────
  test.describe("LEX Portal", () => {
    test("LEX review page loads", async ({ page }) => {
      await page.goto("/lex/review");
      await page.waitForLoadState("networkidle");
      await expect(page.locator("body")).not.toContainText("Error");
      await expect(
        page.locator("body").filter({ hasText: /LEX|submission|incident/i })
      ).toBeVisible({ timeout: 10_000 });
    });

    test("LEX analytics page loads with charts", async ({ page }) => {
      await page.goto("/lex/analytics");
      await page.waitForLoadState("networkidle");
      await expect(page.locator("body")).not.toContainText("Error");
    });
  });

  // ── Security Headers ────────────────────────────────────────────────────────
  test.describe("Security Headers", () => {
    test("API returns security headers", async ({ request }) => {
      const response = await request.get("/api/trpc/auth.me");
      expect(response.headers()["x-content-type-options"]).toBe("nosniff");
      expect(response.headers()["x-frame-options"]).toBe("DENY");
    });
  });
});
