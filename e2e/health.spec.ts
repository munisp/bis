import { test, expect } from "@playwright/test";

/**
 * Health and public endpoint tests.
 * These run without authentication and verify the platform is up.
 */

test.describe("Health & Public Endpoints", () => {
  test("GET /api/health returns 200 with ok status", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.uptime).toBeGreaterThan(0);
    expect(body.version).toBeTruthy();
  });

  test("GET /api/csrf-token returns a token cookie", async ({ request }) => {
    const res = await request.get("/api/csrf-token");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.token.length).toBeGreaterThan(10);
  });

  test("Homepage loads and shows BIS branding", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/BIS|Background Intelligence/i);
  });

  test("404 page shows for unknown routes", async ({ page }) => {
    await page.goto("/this-route-does-not-exist-xyz");
    await expect(page.locator("body")).toContainText(/not found|404/i);
  });

  test("API docs page loads at /api/docs", async ({ page }) => {
    await page.goto("/api/docs");
    // Swagger UI renders an h2 with the API title
    await expect(page.locator("body")).toContainText(/BIS|swagger/i, { timeout: 10_000 });
  });
});
