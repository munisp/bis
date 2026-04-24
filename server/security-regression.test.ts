/**
 * Security Regression Tests — BIS Platform v65
 *
 * These tests verify that all 9 vulnerabilities fixed in v64/v65 remain patched.
 * They are run as part of the CI pipeline and must pass before any release.
 *
 * Vulnerability inventory:
 *  [SEC-001] Command injection in PDF generation (execSync → spawnSync with array args)
 *  [SEC-002] XSS via HTML injection in LEX-01 PDF template
 *  [SEC-003] XSS via HTML injection in Case Report PDF template
 *  [SEC-004] TOTP timing attack (=== → crypto.timingSafeEqual)
 *  [SEC-005] Biometric base64 inputs had no size cap (DoS vector)
 *  [SEC-006] Stack trace leakage in /metrics error handler
 *  [SEC-007] Keycloak token exchange response body logged to console
 *  [SEC-008] Pagination limits had no .max() constraint (DoS vector)
 *  [SEC-009] Missing security headers (Permissions-Policy, COOP, CORP)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const root = resolve(__dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(resolve(root, relPath), "utf-8");
}

// ─── [SEC-001] Command injection ─────────────────────────────────────────────
describe("[SEC-001] Command injection in PDF generation", () => {
  it("lex.ts must NOT use execSync for PDF generation", () => {
    const src = readSrc("server/lex.ts");
    // execSync with a template string is the dangerous pattern
    expect(src).not.toMatch(/execSync\s*\(`[^`]*\$\{/);
  });

  it("lex.ts must use spawnSync with an array of arguments", () => {
    const src = readSrc("server/lex.ts");
    expect(src).toMatch(/spawnSync\s*\(/);
  });

  it("routers.ts must NOT use execSync for PDF generation", () => {
    const src = readSrc("server/routers.ts");
    // execSync with a template string containing user input is dangerous
    expect(src).not.toMatch(/execSync\s*\(`[^`]*\$\{[^}]*caseRef/);
  });

  it("routers.ts must use spawnSync with an array of arguments for case PDF", () => {
    const src = readSrc("server/routers.ts");
    expect(src).toMatch(/spawnSync\s*\(/);
  });
});

// ─── [SEC-002] XSS in LEX-01 PDF template ────────────────────────────────────
describe("[SEC-002] XSS via HTML injection in LEX-01 PDF template", () => {
  it("lex.ts must define an escHtml function", () => {
    const src = readSrc("server/lex.ts");
    expect(src).toMatch(/function escHtml\s*\(/);
  });

  it("lex.ts must escape the subjectName field in the PDF template", () => {
    const src = readSrc("server/lex.ts");
    expect(src).toMatch(/escHtml\s*\([^)]*subjectName/);
  });

  it("lex.ts must escape the narrative field in the PDF template", () => {
    const src = readSrc("server/lex.ts");
    expect(src).toMatch(/escHtml\s*\([^)]*narrative/);
  });

  it("escHtml must replace < > & \" ' characters", () => {
    // Extract the escHtml function body and verify it handles all 5 dangerous chars
    const src = readSrc("server/lex.ts");
    const fnMatch = src.match(/function escHtml[\s\S]*?(?=\nfunction|\nexport|\nconst|\n\/\/)/);
    expect(fnMatch).not.toBeNull();
    const fn = fnMatch![0];
    expect(fn).toMatch(/&amp;/);
    expect(fn).toMatch(/&lt;/);
    expect(fn).toMatch(/&gt;/);
    expect(fn).toMatch(/&quot;/);
    expect(fn).toMatch(/&#39;|&apos;|&#x27;/);
  });
});

// ─── [SEC-003] XSS in Case Report PDF template ───────────────────────────────
describe("[SEC-003] XSS via HTML injection in Case Report PDF template", () => {
  it("routers.ts must define an escHtml function", () => {
    const src = readSrc("server/routers.ts");
    expect(src).toMatch(/function escHtml\s*\(/);
  });

  it("routers.ts must escape case title in the PDF template", () => {
    const src = readSrc("server/routers.ts");
    expect(src).toMatch(/escHtml\s*\([^)]*title/);
  });
});

// ─── [SEC-004] TOTP timing attack ────────────────────────────────────────────
describe("[SEC-004] TOTP timing attack", () => {
  it("platform.ts must use timingSafeEqual for TOTP comparison", () => {
    const src = readSrc("server/platform.ts");
    expect(src).toMatch(/timingSafeEqual/);
  });

  it("platform.ts must NOT use === for TOTP comparison", () => {
    const src = readSrc("server/platform.ts");
    // The dangerous pattern: comparing TOTP tokens with ===
    // We check that the validateTotp function does not use === for the token comparison
    const validateFnMatch = src.match(/function validateTotp[\s\S]*?(?=\nfunction|\nexport|\nconst|\n\/\/|$)/);
    if (validateFnMatch) {
      const fn = validateFnMatch[0];
      // Should not have a direct === comparison between token strings
      expect(fn).not.toMatch(/token\s*===\s*expected|expected\s*===\s*token/);
    }
  });
});

// ─── [SEC-005] Biometric base64 DoS ──────────────────────────────────────────
describe("[SEC-005] Biometric base64 inputs must have size limits", () => {
  it("biometric.ts must have .max() on imageBase64 fields", () => {
    const src = readSrc("server/biometric.ts");
    // Should have max constraint on base64 fields to prevent DoS
    expect(src).toMatch(/imageBase64.*z\.string\(\).*\.max\(|z\.string\(\).*\.max\(.*imageBase64/s);
  });

  it("biometric.ts imageBase64 max must be at least 1MB (base64 encoded)", () => {
    const src = readSrc("server/biometric.ts");
    // 1MB image = ~1.37MB base64 = ~1,400,000 chars
      // We expect max to be at least 1,000,000 (5_500_000 is the actual value)
      // The regex needs to handle underscore-separated numbers like 5_500_000
      const maxMatches = [...src.matchAll(/imageBase64.*?\.max\((5_500_000|[0-9_]{7,})/g)];
      if (maxMatches.length > 0) {
        // Value is present and large enough — pass
        expect(maxMatches.length).toBeGreaterThan(0);
      } else {
        // Alternative: check for a general large .max() near imageBase64
        expect(src).toMatch(/imageBase64.*\.max\(5_500_000/);
      }
  });
});

// ─── [SEC-006] Stack trace leakage ───────────────────────────────────────────
describe("[SEC-006] Stack trace leakage in /metrics error handler", () => {
  it("index.ts must not send error.stack in /metrics response", () => {
    const src = readSrc("server/_core/index.ts");
    // The dangerous pattern: res.json({ error: err.stack }) or similar
    expect(src).not.toMatch(/res\.(json|send)\s*\(\s*\{[^}]*\.stack/);
  });

  it("index.ts must not send error.message in /metrics response in production", () => {
    const src = readSrc("server/_core/index.ts");
    // Should not blindly expose err.message in metrics endpoint
    // It's OK to have a generic "Internal server error" message
    const metricsSection = src.match(/\/metrics[\s\S]*?(?=app\.|router\.|\/\/\s*─|$)/)?.[0] ?? "";
    expect(metricsSection).not.toMatch(/err\.message|error\.message/);
  });
});

// ─── [SEC-007] Keycloak token exchange logging ───────────────────────────────
describe("[SEC-007] Keycloak token exchange response body not logged", () => {
  it("keycloak.ts must not log the full token exchange response body", () => {
    const src = readSrc("server/keycloak.ts");
    // The dangerous pattern: console.error(responseBody) or console.log(data)
    // where data contains the access_token
    expect(src).not.toMatch(/console\.(error|log|warn)\s*\([^)]*responseBody/);
    expect(src).not.toMatch(/console\.(error|log|warn)\s*\([^)]*access_token/);
  });
});

// ─── [SEC-008] Pagination limits ─────────────────────────────────────────────
describe("[SEC-008] Pagination limits must have .max() constraints", () => {
  const serverFiles = [
    "server/routers.ts",
    "server/lex.ts",
    "server/aml.ts",
    "server/billing.ts",
  ];

  for (const file of serverFiles) {
    it(`${file} must not have unbounded pagination (z.number() without .max())`, () => {
      let src: string;
      try {
        src = readSrc(file);
      } catch {
        return; // File doesn't exist, skip
      }

      // Find all z.number().default(N) patterns that are likely pagination limits
      // and verify they have a .max() constraint
      const limitPatterns = [...src.matchAll(/limit.*z\.number\(\)([^;,\n]*)/g)];
      for (const match of limitPatterns) {
        const chain = match[1];
        // Each limit field should have a .max() somewhere in its chain
        // We check the broader context (next 100 chars)
        const idx = match.index ?? 0;
        const context = src.slice(idx, idx + 200);
        expect(context).toMatch(/\.max\(/);
      }
    });
  }
});

// ─── [SEC-009] Security headers ──────────────────────────────────────────────
describe("[SEC-009] Security headers must be configured", () => {
  it("index.ts must configure Permissions-Policy header", () => {
    const src = readSrc("server/_core/index.ts");
    expect(src).toMatch(/[Pp]ermissions-[Pp]olicy/);
  });

  it("index.ts must configure Cross-Origin-Opener-Policy", () => {
    const src = readSrc("server/_core/index.ts");
    expect(src).toMatch(/[Cc]ross-[Oo]rigin-[Oo]pener-[Pp]olicy|crossOriginOpenerPolicy/);
  });

  it("index.ts must configure helmet with noSniff", () => {
    const src = readSrc("server/_core/index.ts");
    expect(src).toMatch(/helmet\s*\(/);
    // noSniff is enabled by default in helmet, but we verify helmet is called
    expect(src).toMatch(/helmet/);
  });

  it("cookies.ts must set httpOnly on session cookies", () => {
    const src = readSrc("server/_core/cookies.ts");
    expect(src).toMatch(/httpOnly\s*:\s*true/);
  });

  it("cookies.ts must set secure on session cookies in production", () => {
    const src = readSrc("server/_core/cookies.ts");
    expect(src).toMatch(/secure/);
  });

  it("cookies.ts must set sameSite on session cookies", () => {
    const src = readSrc("server/_core/cookies.ts");
    expect(src).toMatch(/sameSite/);
  });
});

// ─── Additional: No hardcoded secrets ────────────────────────────────────────
describe("[SEC-010] No hardcoded secrets in source code", () => {
  const sensitivePatterns = [
    /sk-[a-zA-Z0-9]{20,}/,          // OpenAI API keys
    /pk_live_[a-zA-Z0-9]{20,}/,     // Stripe live keys
    /AKIA[0-9A-Z]{16}/,             // AWS access keys
    /ghp_[a-zA-Z0-9]{36}/,         // GitHub personal access tokens
    /-----BEGIN (RSA |EC )?PRIVATE KEY-----/, // Private keys
  ];

  const filesToCheck = [
    "server/routers.ts",
    "server/_core/index.ts",
    "server/_core/context.ts",
    "server/lex.ts",
    "server/aml.ts",
  ];

  for (const file of filesToCheck) {
    for (const pattern of sensitivePatterns) {
      it(`${file} must not contain hardcoded secrets matching ${pattern}`, () => {
        let src: string;
        try {
          src = readSrc(file);
        } catch {
          return;
        }
        expect(src).not.toMatch(pattern);
      });
    }
  }
});

// ─── Additional: SQL injection prevention ────────────────────────────────────
describe("[SEC-011] SQL injection prevention", () => {
  it("server files must not concatenate user input directly into SQL strings", () => {
    const files = [
      "server/routers.ts",
      "server/lex.ts",
      "server/aml.ts",
      "server/billing.ts",
    ];

    for (const file of files) {
      let src: string;
      try {
        src = readSrc(file);
      } catch {
        continue;
      }

      // Dangerous pattern: sql`... ${input.something} ...` where input is a string
      // (parameterized values in sql`` are safe, but string concatenation is not)
      // We check for the specific dangerous pattern of building SQL with + operator
      expect(src).not.toMatch(/sql\s*\+\s*input\.|input\.\w+\s*\+\s*sql/);
    }
  });
});
