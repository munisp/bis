/**
 * End-to-End NIN/BVN Verification Test
 * =====================================
 * Exercises the full identity verification flow through the YouVerify API.
 * Reports success or documents the exact failure for credential troubleshooting.
 *
 * Usage: node scripts/e2e-verify-nin-bvn.mjs
 * Requires: YOUVERIFY_API_KEY and YOUVERIFY_BASE_URL env vars
 */

const YOUVERIFY_BASE_URL = process.env.YOUVERIFY_BASE_URL || "https://api.youverify.co/v2";
const YOUVERIFY_API_KEY = process.env.YOUVERIFY_API_KEY || "";

const TEST_CASES = [
  {
    name: "NIN Verification (test identity)",
    endpoint: `${YOUVERIFY_BASE_URL}/identity/ng/nin`,
    payload: { id: "00000000000", isSubjectConsent: true, premiumBVN: false },
    type: "NIN",
  },
  {
    name: "BVN Verification (test identity)",
    endpoint: `${YOUVERIFY_BASE_URL}/identity/ng/bvn`,
    payload: { id: "00000000000", isSubjectConsent: true },
    type: "BVN",
  },
];

async function runTest(testCase) {
  const result = {
    name: testCase.name,
    type: testCase.type,
    endpoint: testCase.endpoint,
    timestamp: new Date().toISOString(),
    success: false,
    httpStatus: null,
    response: null,
    error: null,
    authoritative: false,
  };

  if (!YOUVERIFY_API_KEY || YOUVERIFY_API_KEY.startsWith("bis-")) {
    result.error = "YOUVERIFY_API_KEY is a placeholder — replace with production key from https://os.youverify.co/settings/api-keys";
    return result;
  }

  try {
    const res = await fetch(testCase.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: YOUVERIFY_API_KEY,
      },
      body: JSON.stringify(testCase.payload),
      signal: AbortSignal.timeout(15000),
    });

    result.httpStatus = res.status;
    const body = await res.json().catch(() => null);
    result.response = body;

    if (res.ok && body) {
      result.success = true;
      result.authoritative = true;
      // YouVerify returns { success: true/false, statusCode: 200, data: {...} }
      if (body.success === false) {
        result.success = false;
        result.error = body.message || "Verification returned success=false";
      }
    } else {
      result.error = `HTTP ${res.status}: ${body?.message || res.statusText}`;
      // 401/403 means key is invalid, 404 means endpoint wrong
      if (res.status === 401 || res.status === 403) {
        result.error += " — API key is invalid or expired";
      }
    }
  } catch (e) {
    result.error = e.message;
  }

  return result;
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║     BIS End-to-End NIN/BVN Verification Test                ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║ YouVerify URL: ${YOUVERIFY_BASE_URL.padEnd(44)}║`);
  console.log(`║ API Key:       ${YOUVERIFY_API_KEY ? (YOUVERIFY_API_KEY.slice(0, 8) + "..." + YOUVERIFY_API_KEY.slice(-4)).padEnd(44) : "NOT SET".padEnd(44)}║`);
  console.log("╠══════════════════════════════════════════════════════════════╣");

  const results = [];
  for (const tc of TEST_CASES) {
    const r = await runTest(tc);
    results.push(r);
    const status = r.success ? "PASS (authoritative)" : r.error?.includes("placeholder") ? "SKIP (placeholder key)" : `FAIL: ${r.error?.slice(0, 40)}`;
    console.log(`║ ${r.name.padEnd(35)} ${status.padEnd(23)}║`);
  }

  console.log("╚══════════════════════════════════════════════════════════════╝");

  // Summary
  const passed = results.filter(r => r.success).length;
  const skipped = results.filter(r => r.error?.includes("placeholder")).length;
  const failed = results.length - passed - skipped;

  console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped`);

  if (skipped > 0) {
    console.log("\n⚠️  To run live verification:");
    console.log("   1. Get your API key from https://os.youverify.co/settings/api-keys");
    console.log("   2. Set it: export YOUVERIFY_API_KEY=your-production-key");
    console.log("   3. Re-run: node scripts/e2e-verify-nin-bvn.mjs");
    console.log("\n   Or update via Manus secrets management:");
    console.log("   The system will prompt for the key when it detects the placeholder.");
  }

  if (passed > 0) {
    console.log("\n✅ Live verification confirmed — YouVerify API is returning authoritative results.");
    console.log("   The fail-closed policy ensures these are the ONLY paths that can produce identity decisions.");
  }

  // Write report
  const fs = await import("fs");
  const report = { timestamp: new Date().toISOString(), results, summary: { passed, failed, skipped } };
  fs.writeFileSync("/home/ubuntu/bis-pwa/docs/e2e-verification-report.json", JSON.stringify(report, null, 2));
  console.log("\nReport saved to docs/e2e-verification-report.json");
}

main().catch(console.error);
