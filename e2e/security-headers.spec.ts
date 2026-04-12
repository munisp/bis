import { test, expect } from "@playwright/test";

/**
 * Security Headers E2E Tests.
 * Verifies that all required security headers are present on responses.
 */

test.describe("Security Headers", () => {
  test("Homepage has required security headers", async ({ request }) => {
    const res = await request.get("/");
    const headers = res.headers();

    // HSTS
    expect(headers["strict-transport-security"]).toBeTruthy();

    // X-Content-Type-Options
    expect(headers["x-content-type-options"]).toBe("nosniff");

    // X-Frame-Options or CSP frame-ancestors
    const hasFrameProtection =
      headers["x-frame-options"] ||
      (headers["content-security-policy"] && headers["content-security-policy"].includes("frame-ancestors"));
    expect(hasFrameProtection).toBeTruthy();

    // X-DNS-Prefetch-Control
    expect(headers["x-dns-prefetch-control"]).toBeTruthy();
  });

  test("API endpoints return correct content-type", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.headers()["content-type"]).toContain("application/json");
  });

  test("Server does not expose version information", async ({ request }) => {
    const res = await request.get("/");
    const headers = res.headers();
    // Should not expose Express version
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("CORS headers are not present for non-CORS requests", async ({ request }) => {
    const res = await request.get("/api/health");
    const headers = res.headers();
    // Access-Control-Allow-Origin should not be set for non-CORS requests
    // (or should be restricted to allowed origins)
    if (headers["access-control-allow-origin"]) {
      expect(headers["access-control-allow-origin"]).not.toBe("*");
    }
  });
});
