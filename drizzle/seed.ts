/**
 * drizzle/seed.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * BIS Platform Seed Data
 *
 * Populates a fresh database with:
 *  - Default tenant (platform admin tenant)
 *  - Default platform admin user
 *  - Default alert rules (velocity, sanctions, PEP, risk threshold)
 *  - Default data sources (NIBSS, CAC, EFCC, INTERPOL, etc.)
 *  - Default screening packages (Basic, Standard, Comprehensive)
 *  - Default platform settings
 *  - Default Temporal workflow namespaces
 *  - Default LEX agency (EFCC)
 *  - Default AML rules
 *
 * Usage:
 *   pnpm tsx drizzle/seed.ts
 *   DATABASE_URL=postgresql://... pnpm tsx drizzle/seed.ts
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import * as schemaRelations from "./relations";

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });
  const db = drizzle(pool, { schema: { ...schema, ...schemaRelations } });

  console.log("🌱 Starting BIS seed...\n");

  // ── 1. Default Tenant ──────────────────────────────────────────────────────
  console.log("  → Seeding default tenant...");
  const [tenant] = await db
    .insert(schema.tenants)
    .values({
      name: "BIS Platform",
      slug: "bis-platform",
      plan: "enterprise",
      status: "active",
      country: "NG",
      creditBalance: 100000,
      settings: {
        defaultCurrency: "NGN",
        timezone: "Africa/Lagos",
        mfaRequired: true,
        sessionTimeoutMinutes: 480,
      },
    })
    .onConflictDoNothing()
    .returning();
  const tenantId = tenant?.id ?? 1;
  console.log(`     Tenant ID: ${tenantId}`);

  // ── 2. Default Platform Admin User ────────────────────────────────────────
  console.log("  → Seeding default admin user...");
  await db
    .insert(schema.users)
    .values({
      tenantId: null, // Platform admin — no tenant
      openId: "platform-admin-seed",
      name: "Platform Administrator",
      email: "admin@bis.platform",
      loginMethod: "keycloak",
      role: "admin",
    })
    .onConflictDoNothing();

  // ── 3. Default Alert Rules ────────────────────────────────────────────────
  console.log("  → Seeding default alert rules...");
  const alertRules = [
    {
      tenantId,
      name: "High Risk Score Threshold",
      description: "Trigger alert when investigation risk score exceeds 75",
      ruleType: "threshold" as const,
      conditions: { field: "riskScore", operator: "gt", value: 75 },
      actions: { createAlert: true, severity: "high", notifyAnalyst: true },
      severity: "high" as const,
      enabled: true,
    },
    {
      tenantId,
      name: "Critical Risk Score Threshold",
      description: "Trigger critical alert when investigation risk score exceeds 90",
      ruleType: "threshold" as const,
      conditions: { field: "riskScore", operator: "gt", value: 90 },
      actions: { createAlert: true, severity: "critical", escalateToSupervisor: true },
      severity: "critical" as const,
      enabled: true,
    },
    {
      tenantId,
      name: "Sanctions Hit Detection",
      description: "Alert when subject matches OFAC/UN/EU sanctions list",
      ruleType: "sanctions" as const,
      conditions: { matchType: "exact", lists: ["OFAC", "UN", "EU", "EFCC"] },
      actions: { createAlert: true, severity: "critical", freezeAccount: false },
      severity: "critical" as const,
      enabled: true,
    },
    {
      tenantId,
      name: "PEP Detection",
      description: "Alert when subject is identified as Politically Exposed Person",
      ruleType: "pep" as const,
      conditions: { pepTiers: [1, 2, 3] },
      actions: { createAlert: true, severity: "high", requireEnhancedDueDiligence: true },
      severity: "high" as const,
      enabled: true,
    },
    {
      tenantId,
      name: "Transaction Velocity",
      description: "Alert on unusual transaction velocity (>10 transactions in 1 hour)",
      ruleType: "velocity" as const,
      conditions: { windowMinutes: 60, maxTransactions: 10, maxAmount: 5000000 },
      actions: { createAlert: true, severity: "medium", blockTransaction: false },
      severity: "medium" as const,
      enabled: true,
    },
    {
      tenantId,
      name: "Adverse Media Detection",
      description: "Alert when adverse media is found for subject",
      ruleType: "adverse_media" as const,
      conditions: { categories: ["fraud", "corruption", "terrorism", "money_laundering"] },
      actions: { createAlert: true, severity: "high" },
      severity: "high" as const,
      enabled: true,
    },
  ];

  for (const rule of alertRules) {
    await db.insert(schema.alertRules).values(rule).onConflictDoNothing();
  }
  console.log(`     Seeded ${alertRules.length} alert rules`);

  // ── 4. Default Data Sources ───────────────────────────────────────────────
  console.log("  → Seeding default data sources...");
  const dataSources = [
    {
      name: "NIBSS BVN",
      code: "nibss_bvn",
      category: "identity" as const,
      status: "active" as const,
      baseUrl: "https://api.nibss-plc.com.ng/bvn",
      enabled: true,
      priority: 1,
      description: "Nigeria Inter-Bank Settlement System — Bank Verification Number lookup",
      country: "NG",
      slaMs: 5000,
    },
    {
      name: "NIMC NIN",
      code: "nimc_nin",
      category: "identity" as const,
      status: "active" as const,
      baseUrl: "https://api.nimc.gov.ng/nin",
      enabled: true,
      priority: 1,
      description: "National Identity Management Commission — National Identification Number",
      country: "NG",
      slaMs: 8000,
    },
    {
      name: "CAC Corporate Registry",
      code: "cac_registry",
      category: "legal" as const,
      status: "active" as const,
      baseUrl: "https://search.cac.gov.ng/api",
      enabled: true,
      priority: 2,
      description: "Corporate Affairs Commission — company registration lookup",
      country: "NG",
      slaMs: 10000,
    },
    {
      name: "OFAC Sanctions",
      code: "ofac_sanctions",
      category: "legal" as const,
      status: "active" as const,
      baseUrl: "https://api.ofac.treasury.gov",
      enabled: true,
      priority: 1,
      description: "US Treasury OFAC Specially Designated Nationals list",
      country: "US",
      slaMs: 3000,
    },
    {
      name: "UN Sanctions",
      code: "un_sanctions",
      category: "legal" as const,
      status: "active" as const,
      baseUrl: "https://scsanctions.un.org/api",
      enabled: true,
      priority: 1,
      description: "United Nations Security Council Consolidated Sanctions List",
      country: "UN",
      slaMs: 3000,
    },
    {
      name: "WorldCheck PEP",
      code: "worldcheck_pep",
      category: "commercial" as const,
      status: "active" as const,
      baseUrl: "https://api.worldcheck.com/v2",
      enabled: true,
      priority: 2,
      description: "Refinitiv WorldCheck — PEP and adverse media screening",
      country: "GB",
      slaMs: 5000,
    },
    {
      name: "INTERPOL Notices",
      code: "interpol_notices",
      category: "legal" as const,
      status: "active" as const,
      baseUrl: "https://ws-public.interpol.int/notices",
      enabled: true,
      priority: 1,
      description: "INTERPOL public notices — Red, Blue, Yellow notices",
      country: "FR",
      slaMs: 5000,
    },
    {
      name: "CRC Credit Bureau",
      code: "crc_credit",
      category: "financial" as const,
      status: "active" as const,
      baseUrl: "https://api.crccreditbureau.com",
      enabled: true,
      priority: 3,
      description: "CRC Credit Bureau Nigeria — credit history lookup",
      country: "NG",
      slaMs: 8000,
    },
    {
      name: "EFCC Watchlist",
      code: "efcc_watchlist",
      category: "legal" as const,
      status: "active" as const,
      baseUrl: "https://api.efcc.gov.ng/watchlist",
      enabled: true,
      priority: 1,
      description: "Economic and Financial Crimes Commission — wanted persons list",
      country: "NG",
      slaMs: 5000,
    },
    {
      name: "NPC Passport",
      code: "npc_passport",
      category: "government" as const,
      status: "active" as const,
      baseUrl: "https://api.immigration.gov.ng/passport",
      enabled: true,
      priority: 2,
      description: "Nigeria Immigration Service — passport verification",
      country: "NG",
      slaMs: 10000,
    },
  ];

  for (const ds of dataSources) {
    await db.insert(schema.dataSources).values(ds).onConflictDoNothing();
  }
  console.log(`     Seeded ${dataSources.length} data sources`);

  // ── 5. Default Screening Packages ─────────────────────────────────────────
  console.log("  → Seeding default screening packages...");
  const packages = [
    {
      tenantId,
      name: "Basic Identity Check",
      code: "basic",
      description: "BVN + NIN verification with sanctions screening",
      checks: ["bvn", "nin", "sanctions_ofac", "sanctions_un"],
      price: 500,
      currency: "NGN",
      turnaroundHours: 2,
      active: true,
    },
    {
      tenantId,
      name: "Standard Background Check",
      code: "standard",
      description: "Full identity, credit, criminal, and PEP screening",
      checks: ["bvn", "nin", "credit_crc", "criminal_records", "sanctions_ofac", "sanctions_un", "pep_worldcheck", "adverse_media"],
      price: 2500,
      currency: "NGN",
      turnaroundHours: 24,
      active: true,
    },
    {
      tenantId,
      name: "Comprehensive Due Diligence",
      code: "comprehensive",
      description: "Full background check with field visit and corporate registry",
      checks: ["bvn", "nin", "credit_crc", "criminal_records", "sanctions_ofac", "sanctions_un", "sanctions_eu", "pep_worldcheck", "adverse_media", "cac_registry", "field_visit", "interpol"],
      price: 15000,
      currency: "NGN",
      turnaroundHours: 72,
      active: true,
    },
    {
      tenantId,
      name: "AML Enhanced Due Diligence",
      code: "aml_edd",
      description: "Enhanced due diligence for high-risk customers and PEPs",
      checks: ["bvn", "nin", "credit_crc", "criminal_records", "sanctions_ofac", "sanctions_un", "sanctions_eu", "pep_worldcheck", "adverse_media", "cac_registry", "field_visit", "interpol", "efcc_watchlist", "source_of_funds"],
      price: 35000,
      currency: "NGN",
      turnaroundHours: 120,
      active: true,
    },
  ];

  for (const pkg of packages) {
    await db.insert(schema.screeningPackages).values(pkg).onConflictDoNothing();
  }
  console.log(`     Seeded ${packages.length} screening packages`);

  // ── 6. Default Platform Settings ──────────────────────────────────────────
  console.log("  → Seeding default platform settings...");
  const settings = [
    { key: "platform.name", value: "BIS — Background Investigation System", category: "general" },
    { key: "platform.country", value: "NG", category: "general" },
    { key: "platform.currency", value: "NGN", category: "general" },
    { key: "platform.timezone", value: "Africa/Lagos", category: "general" },
    { key: "platform.mfa_required", value: "true", category: "security" },
    { key: "platform.session_timeout_minutes", value: "480", category: "security" },
    { key: "platform.max_login_attempts", value: "5", category: "security" },
    { key: "platform.lockout_duration_minutes", value: "30", category: "security" },
    { key: "platform.kyc_expiry_days", value: "365", category: "kyc" },
    { key: "platform.kyc_rerun_threshold_days", value: "30", category: "kyc" },
    { key: "platform.risk_score_high_threshold", value: "75", category: "risk" },
    { key: "platform.risk_score_critical_threshold", value: "90", category: "risk" },
    { key: "platform.aml_transaction_threshold_ngn", value: "5000000", category: "aml" },
    { key: "platform.sar_filing_auto_threshold", value: "90", category: "aml" },
    { key: "platform.goaml_institution_id", value: "", category: "aml" },
    { key: "platform.biometric_liveness_threshold", value: "0.85", category: "biometric" },
    { key: "platform.biometric_match_threshold", value: "0.90", category: "biometric" },
    { key: "platform.field_visit_photo_required", value: "true", category: "field" },
    { key: "platform.field_visit_gps_required", value: "true", category: "field" },
    { key: "platform.report_retention_days", value: "2555", category: "retention" }, // 7 years
    { key: "platform.audit_log_retention_days", value: "2555", category: "retention" },
    { key: "platform.transaction_retention_days", value: "3650", category: "retention" }, // 10 years
  ];

  for (const setting of settings) {
    await db.insert(schema.platformSettings).values(setting).onConflictDoNothing();
  }
  console.log(`     Seeded ${settings.length} platform settings`);

  // ── 7. Default AML Rules ──────────────────────────────────────────────────
  console.log("  → Seeding default AML rules...");
  const amlRules = [
    {
      tenantId,
      name: "Large Cash Transaction",
      description: "Flag cash transactions above NGN 5,000,000 (CBN threshold)",
      ruleType: "threshold",
      conditions: { transactionType: "cash", amountNgn: { gte: 5000000 } },
      severity: "high" as const,
      autoSar: false,
      enabled: true,
    },
    {
      tenantId,
      name: "Structuring Detection",
      description: "Flag multiple transactions just below reporting threshold within 24h",
      ruleType: "structuring",
      conditions: { windowHours: 24, maxAmount: 4999999, minCount: 3 },
      severity: "critical" as const,
      autoSar: true,
      enabled: true,
    },
    {
      tenantId,
      name: "Rapid Fund Movement",
      description: "Flag funds received and transferred out within 24 hours",
      ruleType: "velocity",
      conditions: { windowHours: 24, inOutRatio: 0.9 },
      severity: "high" as const,
      autoSar: false,
      enabled: true,
    },
    {
      tenantId,
      name: "High-Risk Jurisdiction Transfer",
      description: "Flag transfers to/from FATF high-risk jurisdictions",
      ruleType: "jurisdiction",
      conditions: { jurisdictions: ["IR", "KP", "MM", "SY", "YE"] },
      severity: "critical" as const,
      autoSar: true,
      enabled: true,
    },
    {
      tenantId,
      name: "PEP Transaction Monitoring",
      description: "Enhanced monitoring for all PEP-linked transactions",
      ruleType: "pep_monitoring",
      conditions: { pepTiers: [1, 2] },
      severity: "high" as const,
      autoSar: false,
      enabled: true,
    },
  ];

  for (const rule of amlRules) {
    await db.insert(schema.amlRules).values(rule).onConflictDoNothing();
  }
  console.log(`     Seeded ${amlRules.length} AML rules`);

  // ── 8. Default LEX Agency ─────────────────────────────────────────────────
  console.log("  → Seeding default LEX agencies...");
  const lexAgencies = [
    {
      name: "Economic and Financial Crimes Commission",
      code: "EFCC",
      country: "NG",
      agencyType: "law_enforcement",
      contactEmail: "intel@efcc.gov.ng",
      active: true,
    },
    {
      name: "Independent Corrupt Practices Commission",
      code: "ICPC",
      country: "NG",
      agencyType: "law_enforcement",
      contactEmail: "intel@icpc.gov.ng",
      active: true,
    },
    {
      name: "Nigerian Financial Intelligence Unit",
      code: "NFIU",
      country: "NG",
      agencyType: "fiu",
      contactEmail: "intel@nfiu.gov.ng",
      active: true,
    },
    {
      name: "Central Bank of Nigeria",
      code: "CBN",
      country: "NG",
      agencyType: "regulator",
      contactEmail: "compliance@cbn.gov.ng",
      active: true,
    },
  ];

  for (const agency of lexAgencies) {
    await db.insert(schema.lexAgencies).values(agency).onConflictDoNothing();
  }
  console.log(`     Seeded ${lexAgencies.length} LEX agencies`);

  // ── 9. Default Screening Geos (Nigerian states) ──────────────────────────
  console.log("  → Seeding default screening geographies (Nigerian states)...");
  const geos = [
    { state: "Lagos", screeningType: "criminal_records" as const, lookbackYears: 7, requiresConsent: true, isActive: true },
    { state: "Abuja", screeningType: "criminal_records" as const, lookbackYears: 7, requiresConsent: true, isActive: true },
    { state: "Kano", screeningType: "criminal_records" as const, lookbackYears: 7, requiresConsent: true, isActive: true },
    { state: "Rivers", screeningType: "criminal_records" as const, lookbackYears: 7, requiresConsent: true, isActive: true },
    { state: "Ogun", screeningType: "criminal_records" as const, lookbackYears: 7, requiresConsent: true, isActive: true },
    { state: "Lagos", screeningType: "mvr" as const, lookbackYears: 3, requiresConsent: true, isActive: true },
    { state: "Abuja", screeningType: "mvr" as const, lookbackYears: 3, requiresConsent: true, isActive: true },
  ];

  for (const geo of geos) {
    await db.insert(schema.screeningGeos).values(geo).onConflictDoNothing();
  }
  console.log(`     Seeded ${geos.length} screening geographies`);

  console.log("\n✅ BIS seed complete!\n");
  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
