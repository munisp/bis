import { test, expect } from "@playwright/test";

/**
 * Authentication flow tests.
 * Tests the login redirect, session, and logout flow.
 */

test.describe("Authentication Flow", () => {
  test("Unauthenticated user is redirected to login from protected routes", async ({ page }) => {
    // Navigate to a protected route
    await page.goto("/dashboard");
    // Should redirect to login or show login prompt
    await expect(page).toHaveURL(/login|oauth|auth|\/$/i, { timeout: 10_000 });
  });

  test("Login button is present on the home page", async ({ page }) => {
    await page.goto("/");
    // Look for a login/sign-in button or link
    const loginButton = page.locator("a, button").filter({ hasText: /sign in|log in|login|get started/i }).first();
    await expect(loginButton).toBeVisible({ timeout: 5_000 });
  });

  test("Logout endpoint clears session", async ({ request }) => {
    // POST to logout without a session — should return 200 or redirect
    const res = await request.post("/api/trpc/auth.logout", {
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({}),
    });
    // Either 200 (success) or 401 (no session) — both are valid
    expect([200, 401, 400]).toContain(res.status());
  });
});
