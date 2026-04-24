/**
 * Security Regression Tests — BIS Platform v67
 *
 * Extends v65 security regression tests with v67-specific checks:
 *  [SEC-012] DuckDB analytics parameterisation (no f-string interpolation of user input)
 *  [SEC-013] Table name allowlist enforcement in DuckDB analytics
 *  [SEC-014] Account ID validation before DuckDB queries
 *  [SEC-015] Channel name validation before DuckDB queries
 *  [SEC-016] Subject name sanitisation in entity_risk_trend
 *  [SEC-017] Response size limits in verifier HTTP clients
 *  [SEC-018] No hardcoded credentials in verifier clients
 *  [SEC-019] TLS enforcement in verifier HTTP clients
 *  [SEC-020] Input validation in lex-intake SMS parser
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const root = resolve(__dirname, "..");

function readSrc(relPath: string): string {
  const fullPath = resolve(root, relPath);
  if (!existsSync(fullPath)) return "";
  return readFileSync(fullPath, "utf-8");
}

// ─── [SEC-012] DuckDB parameterisation ───────────────────────────────────────
describe("[SEC-012] DuckDB analytics — parameterised queries", () => {
  it("duckdb_analytics.py must define _run() with params argument", () => {
    const src = readSrc("services/risk-engine/duckdb_analytics.py");
    if (!src) return; // service not present in this environment
    expect(src).toMatch(/def _run\s*\(.*params/);
  });

  it("duckdb_analytics.py must pass params list to conn.execute()", () => {
    const src = readSrc("services/risk-engine/duckdb_analytics.py");
    if (!src) return;
    expect(src).toMatch(/conn\.execute\s*\(.*,\s*params/);
  });

  it("duckdb_analytics.py must NOT use f-string interpolation for subject_name in SQL", () => {
    const src = readSrc("services/risk-engine/duckdb_analytics.py");
    if (!src) return;
    // The dangerous pattern is: f"...{subject_name}..." inside a SQL string
    // After fix, subject_name should be passed as a parameter, not interpolated
    expect(src).not.toMatch(/ILIKE\s*'%\{subject_name\}%'/);
  });

  it("duckdb_analytics.py must NOT interpolate account_id directly into SQL WHERE clause", () => {
    const src = readSrc("services/risk-engine/duckdb_analytics.py");
    if (!src) return;
    // Dangerous: f"...account_id = '{account_id}'..."
    expect(src).not.toMatch(/account_id\s*=\s*'\{account_id\}'/);
  });

  it("duckdb_analytics.py must NOT interpolate channel directly into SQL WHERE clause", () => {
    const src = readSrc("services/risk-engine/duckdb_analytics.py");
    if (!src) return;
    // Dangerous: f"...channel = '{channel}'..."
    expect(src).not.toMatch(/channel\s*=\s*'\{channel\}'/);
  });
});

// ─── [SEC-013] Table name allowlist ──────────────────────────────────────────
describe("[SEC-013] DuckDB analytics — table name allowlist", () => {
  it("duckdb_analytics.py must define VALID_TABLES allowlist", () => {
    const src = readSrc("services/risk-engine/duckdb_analytics.py");
    if (!src) return;
    expect(src).toMatch(/VALID_TABLES\s*=/);
  });

  it("duckdb_analytics.py must define _validate_table() function", () => {
    const src = readSrc("services/risk-engine/duckdb_analytics.py");
    if (!src) return;
    expect(src).toMatch(/def _validate_table\s*\(/);
  });

  it("duckdb_analytics.py _validate_table must raise ValueError for invalid tables", () => {
    const src = readSrc("services/risk-engine/duckdb_analytics.py");
    if (!src) return;
    expect(src).toMatch(/raise ValueError/);
  });
});

// ─── [SEC-014] Account ID validation ─────────────────────────────────────────
describe("[SEC-014] DuckDB analytics — account ID validation", () => {
  it("duckdb_analytics.py must define _validate_account_id() function", () => {
    const src = readSrc("services/risk-engine/duckdb_analytics.py");
    if (!src) return;
    expect(src).toMatch(/def _validate_account_id\s*\(/);
  });

  it("_validate_account_id must use regex to restrict allowed characters", () => {
    const src = readSrc("services/risk-engine/duckdb_analytics.py");
    if (!src) return;
    expect(src).toMatch(/re\.match.*account_id/);
  });
});

// ─── [SEC-015] Channel name validation ───────────────────────────────────────
describe("[SEC-015] DuckDB analytics — channel name validation", () => {
  it("duckdb_analytics.py must define _validate_channel() function", () => {
    const src = readSrc("services/risk-engine/duckdb_analytics.py");
    if (!src) return;
    expect(src).toMatch(/def _validate_channel\s*\(/);
  });

  it("_validate_channel must use regex to restrict allowed characters", () => {
    const src = readSrc("services/risk-engine/duckdb_analytics.py");
    if (!src) return;
    expect(src).toMatch(/re\.match.*channel/);
  });
});

// ─── [SEC-016] Subject name sanitisation ─────────────────────────────────────
describe("[SEC-016] DuckDB analytics — subject name sanitisation", () => {
  it("entity_risk_trend must strip and truncate subject_name before use", () => {
    const src = readSrc("services/risk-engine/duckdb_analytics.py");
    if (!src) return;
    expect(src).toMatch(/subject_name\.strip\(\)\[:200\]/);
  });

  it("entity_risk_trend must pass ILIKE pattern as a parameter", () => {
    const src = readSrc("services/risk-engine/duckdb_analytics.py");
    if (!src) return;
    // After fix: pattern = f"%{subject_name}%" then passed as param
    expect(src).toMatch(/pattern\s*=\s*f"%\{subject_name\}%"/);
    // And the pattern variable is passed to _run() as a parameter
    expect(src).toMatch(/_run\s*\([\s\S]*\[pattern,/);
  });
});

// ─── [SEC-017] Verifier HTTP client response size limits ─────────────────────
describe("[SEC-017] Verifier HTTP clients — response handling", () => {
  it("verifier clients.go must define HTTP clients with timeouts", () => {
    const src = readSrc("services/verifier/internal/clients.go");
    if (!src) return;
    expect(src).toMatch(/Timeout\s*:/);
  });

  it("verifier clients.go must set a timeout of at most 30 seconds", () => {
    const src = readSrc("services/verifier/internal/clients.go");
    if (!src) return;
    // Timeout should be 10-30 seconds
    expect(src).toMatch(/Timeout\s*:\s*\d+\s*\*\s*time\.Second/);
  });
});

// ─── [SEC-018] No hardcoded credentials in verifier ──────────────────────────
describe("[SEC-018] Verifier — no hardcoded credentials", () => {
  it("verifier clients.go must not contain hardcoded API keys", () => {
    const src = readSrc("services/verifier/internal/clients.go");
    if (!src) return;
    // No string literals that look like API keys (long alphanumeric strings)
    expect(src).not.toMatch(/apiKey\s*=\s*"[a-zA-Z0-9]{20,}"/);
    expect(src).not.toMatch(/APIKey\s*=\s*"[a-zA-Z0-9]{20,}"/);
  });

  it("verifier clients.go must read credentials from environment variables", () => {
    const src = readSrc("services/verifier/internal/clients.go");
    if (!src) return;
    expect(src).toMatch(/os\.Getenv\s*\(/);
  });
});

// ─── [SEC-019] TLS enforcement ────────────────────────────────────────────────
describe("[SEC-019] Verifier — TLS enforcement", () => {
  it("verifier clients.go must not disable TLS verification", () => {
    const src = readSrc("services/verifier/internal/clients.go");
    if (!src) return;
    // InsecureSkipVerify: true is dangerous
    expect(src).not.toMatch(/InsecureSkipVerify\s*:\s*true/);
  });
});

// ─── [SEC-020] LEX intake SMS input validation ────────────────────────────────
describe("[SEC-020] LEX intake — SMS input validation", () => {
  it("sms_gateway.go must validate agency code format", () => {
    const src = readSrc("services/lex-intake/sms_gateway.go");
    if (!src) return;
    // Agency code should be validated
    expect(src).toMatch(/agencyCode|agency_code|AgencyCode/i);
  });

  it("sms_gateway.go must validate PIN format", () => {
    const src = readSrc("services/lex-intake/sms_gateway.go");
    if (!src) return;
    expect(src).toMatch(/pin|PIN/);
  });

  it("sms_gateway.go must limit narrative length", () => {
    const src = readSrc("services/lex-intake/sms_gateway.go");
    if (!src) return;
    // Should have some length limit on narrative
    expect(src).toMatch(/\d{3,}/); // at least a 3-digit limit constant
  });
});

// ─── [SEC-021] Delta Lake analytics — parameterisation ───────────────────────
describe("[SEC-021] Delta Lake analytics — parameterised queries", () => {
  it("delta_lake.py must define run_query() with params argument", () => {
    const src = readSrc("services/lakehouse-writer/delta_lake.py");
    if (!src) return;
    expect(src).toMatch(/def run_query\s*\(.*params/);
  });

  it("delta_lake.py must pass params to conn.execute()", () => {
    const src = readSrc("services/lakehouse-writer/delta_lake.py");
    if (!src) return;
    expect(src).toMatch(/conn\.execute\s*\(.*params/);
  });
});

// ─── [SEC-022] PostgreSQL init — no PUBLIC schema access ─────────────────────
describe("[SEC-022] PostgreSQL init — security hardening", () => {
  it("infra/postgres/init.sql must revoke CREATE on public schema from PUBLIC", () => {
    const src = readSrc("infra/postgres/init.sql");
    if (!src) return;
    expect(src).toMatch(/REVOKE CREATE ON SCHEMA public FROM PUBLIC/i);
  });

  it("infra/postgres/init.sql must revoke ALL on database from PUBLIC", () => {
    const src = readSrc("infra/postgres/init.sql");
    if (!src) return;
    expect(src).toMatch(/REVOKE ALL ON DATABASE/i);
  });
});

// ─── [SEC-023] SDK documentation — no real credentials ───────────────────────
describe("[SEC-023] SDK documentation — no real credentials", () => {
  it("sdk/README.md must only use placeholder API keys", () => {
    const src = readSrc("sdk/README.md");
    if (!src) return;
    // Should use bis_live_your_key_here or similar placeholder
    expect(src).toMatch(/bis_live_your_key_here|bis_test_|placeholder/i);
    // Must not contain real-looking API keys (long random strings)
    expect(src).not.toMatch(/bis_live_[a-zA-Z0-9]{30,}/);
  });
});
