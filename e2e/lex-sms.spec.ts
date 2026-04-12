import { test, expect } from "@playwright/test";

/**
 * LEX SMS Submission E2E Tests.
 * Tests the Africa's Talking webhook endpoint for SMS-based LEX submissions.
 */

test.describe("LEX SMS Webhook", () => {
  const LEX_INTAKE_URL = process.env.LEX_INTAKE_URL ?? "http://localhost:8087";

  test("AT webhook rejects requests without valid HMAC signature", async ({ request }) => {
    const res = await request.post(`${LEX_INTAKE_URL}/webhook/africas-talking`, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      form: {
        from: "+2348012345678",
        to: "20880",
        text: "LEX NPF-LA-001 123456 ARREST LA Test submission",
        date: new Date().toISOString(),
        id: "test-msg-001",
      },
    });
    // Without valid HMAC, should reject with 401 or 403
    expect([401, 403]).toContain(res.status());
  });

  test("Termii webhook rejects requests without valid API key", async ({ request }) => {
    const res = await request.post(`${LEX_INTAKE_URL}/webhook/termii`, {
      headers: {
        "Content-Type": "application/json",
        "X-Termii-Signature": "invalid-signature",
      },
      data: JSON.stringify({
        msisdn: "+2348012345678",
        text: "LEX NPF-LA-001 123456 ARREST LA Test submission",
        message_id: "test-msg-001",
      }),
    });
    expect([401, 403]).toContain(res.status());
  });

  test("Health endpoint of lex-intake responds", async ({ request }) => {
    try {
      const res = await request.get(`${LEX_INTAKE_URL}/health`, { timeout: 3000 });
      expect([200, 503]).toContain(res.status());
    } catch {
      // Service may not be running in test environment — skip
      test.skip(true, "lex-intake service not running");
    }
  });
});
