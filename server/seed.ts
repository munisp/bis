/**
 * BIS Platform — Comprehensive Seed Script
 *
 * Usage:  pnpm db:seed
 *
 * Populates all tables with realistic synthetic data for demo / development.
 * Safe to re-run: existing rows are skipped via ON CONFLICT DO NOTHING or
 * explicit existence checks.
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import {
  users,
  investigations,
  alerts,
  kycRecords,
  auditLog,
  fieldTasks,
  reports,
  fieldAgents,
  dataSources,
  monitors,
  screeningRequests,
  tenants,
  apiKeys,
  webhooks,
  alertRules,
  ruleEvaluations,
  onboardingApplications,
} from "../drizzle/schema";

// ─── DB connection ────────────────────────────────────────────────────────────
// The app's DATABASE_URL may be a MySQL/TiDB URL (for the hosted environment).
// The seed script always targets the local PostgreSQL instance used for
// development and migrations (same DB that drizzle.config.ts points to).

const rawUrl = process.env.DATABASE_URL ?? "";
const DATABASE_URL =
  rawUrl.startsWith("postgresql") || rawUrl.startsWith("postgres")
    ? rawUrl
    : "postgresql://bis_user:bis_secure_2026@localhost:5432/bis_db";

const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rnd<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rndFloat(min: number, max: number, dp = 1): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(dp));
}

function rndInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function hoursAgo(n: number): Date {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d;
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

// ─── Reference data ───────────────────────────────────────────────────────────

const NG_STATES = [
  "Lagos", "Abuja", "Kano", "Rivers", "Oyo", "Delta", "Anambra",
  "Enugu", "Kaduna", "Imo", "Ogun", "Edo", "Kogi", "Borno", "Plateau",
];

const NG_LGAS: Record<string, string[]> = {
  Lagos: ["Ikeja", "Surulere", "Eti-Osa", "Lagos Island", "Alimosho"],
  Abuja: ["Abuja Municipal", "Gwagwalada", "Kuje", "Bwari"],
  Kano: ["Kano Municipal", "Fagge", "Dala", "Gwale"],
  Rivers: ["Port Harcourt", "Obio-Akpor", "Eleme", "Ikwerre"],
};

const FIRST_NAMES = [
  "Emeka", "Ngozi", "Chukwuemeka", "Adaeze", "Babatunde", "Folake",
  "Segun", "Amina", "Usman", "Fatima", "Chidi", "Ifeoma", "Tunde",
  "Yewande", "Olumide", "Chioma", "Ifeanyi", "Blessing", "Kelechi",
  "Nkechi", "Abdullahi", "Hauwa", "Suleiman", "Zainab", "Obinna",
];

const LAST_NAMES = [
  "Okafor", "Adeyemi", "Ibrahim", "Nwachukwu", "Bello", "Okonkwo",
  "Abubakar", "Eze", "Olawale", "Musa", "Chukwu", "Adebayo",
  "Nwosu", "Lawal", "Obi", "Hassan", "Onyekachi", "Sani", "Ugwu",
];

const CORP_NAMES = [
  "Zenith Capital Partners Ltd", "First Continental Holdings", "Apex Resources Nigeria",
  "BlueStar Petroleum Ltd", "Meridian Logistics Group", "Pinnacle Finance Corp",
  "Sunridge Properties Ltd", "Nexus Technology Solutions", "Delta Agro-Allied Ltd",
  "Crescent Insurance Brokers", "Vanguard Trading Co.", "Horizon Energy Ltd",
  "Landmark Real Estate Ltd", "Prestige Shipping Nigeria", "Silverline Investments",
];

function randomName(): string {
  return `${rnd(FIRST_NAMES)} ${rnd(LAST_NAMES)}`;
}

function randomNIN(): string {
  return String(rndInt(10000000000, 99999999999));
}

function randomBVN(): string {
  return String(rndInt(20000000000, 29999999999));
}

function randomPhone(): string {
  return `080${rndInt(10000000, 99999999)}`;
}

// ─── 1. Users ─────────────────────────────────────────────────────────────────

async function seedUsers() {
  console.log("  Seeding users…");

  const SEED_USERS = [
    { openId: "seed-admin-001",     name: "Adaeze Okonkwo",    email: "adaeze.okonkwo@bis.gov.ng",   role: "admin"      as const },
    { openId: "seed-admin-002",     name: "Emeka Chukwu",      email: "emeka.chukwu@bis.gov.ng",     role: "admin"      as const },
    { openId: "seed-analyst-001",   name: "Ngozi Nwachukwu",   email: "ngozi.n@bis.gov.ng",          role: "analyst"    as const },
    { openId: "seed-analyst-002",   name: "Babatunde Adeyemi", email: "babatunde.a@bis.gov.ng",      role: "analyst"    as const },
    { openId: "seed-analyst-003",   name: "Chioma Okafor",     email: "chioma.o@bis.gov.ng",         role: "analyst"    as const },
    { openId: "seed-analyst-004",   name: "Segun Lawal",       email: "segun.l@bis.gov.ng",          role: "analyst"    as const },
    { openId: "seed-analyst-005",   name: "Ifeoma Eze",        email: "ifeoma.e@bis.gov.ng",         role: "analyst"    as const },
    { openId: "seed-supervisor-001",name: "Usman Bello",       email: "usman.bello@bis.gov.ng",      role: "supervisor" as const },
    { openId: "seed-supervisor-002",name: "Folake Olawale",    email: "folake.o@bis.gov.ng",         role: "supervisor" as const },
    { openId: "seed-auditor-001",   name: "Amina Ibrahim",     email: "amina.ibrahim@bis.gov.ng",    role: "auditor"    as const },
    { openId: "seed-auditor-002",   name: "Kelechi Ugwu",      email: "kelechi.u@bis.gov.ng",        role: "auditor"    as const },
    { openId: "seed-readonly-001",  name: "Hauwa Musa",        email: "hauwa.musa@bis.gov.ng",       role: "readonly"   as const },
    { openId: "seed-readonly-002",  name: "Suleiman Sani",     email: "suleiman.s@bis.gov.ng",       role: "readonly"   as const },
    { openId: "seed-user-001",      name: "Blessing Nwosu",    email: "blessing.n@bis.gov.ng",       role: "user"       as const },
    { openId: "seed-user-002",      name: "Obinna Obi",        email: "obinna.obi@bis.gov.ng",       role: "user"       as const },
  ];

  for (const u of SEED_USERS) {
    await db.execute(sql`
      INSERT INTO users ("openId", name, email, "loginMethod", role)
      VALUES (${u.openId}, ${u.name}, ${u.email}, 'seed', ${u.role})
      ON CONFLICT ("openId") DO NOTHING
    `);
  }

  const allUsers = await db.select({ id: users.id }).from(users);
  console.log(`    ✓ ${allUsers.length} users`);
  return allUsers.map(u => u.id);
}

// ─── 2. Tenants ───────────────────────────────────────────────────────────────

async function seedTenants() {
  console.log("  Seeding tenants…");

  const SEED_TENANTS = [
    {
      name: "Central Bank of Nigeria",        slug: "cbn",          plan: "government"     as const, status: "active"    as const,
      contactEmail: "compliance@cbn.gov.ng",  contactName: "Dr. Emeka Uche",
      country: "Nigeria", industry: "Central Banking", monthlyQuota: 10000, ngnBalance: 5000000,
      primaryColor: "#006400", reportFooter: "Central Bank of Nigeria — Confidential Intelligence Report",
    },
    {
      name: "EFCC Nigeria",                   slug: "efcc",         plan: "government"     as const, status: "active"    as const,
      contactEmail: "intel@efcc.gov.ng",      contactName: "Mrs. Fatima Bello",
      country: "Nigeria", industry: "Law Enforcement", monthlyQuota: 5000, ngnBalance: 2500000,
      primaryColor: "#8B0000", reportFooter: "Economic and Financial Crimes Commission — For Official Use Only",
    },
    {
      name: "Zenith Bank Plc",                slug: "zenith-bank",  plan: "enterprise"     as const, status: "active"    as const,
      contactEmail: "kyc@zenithbank.com",     contactName: "Chidi Okonkwo",
      country: "Nigeria", industry: "Commercial Banking", monthlyQuota: 2000, ngnBalance: 1200000,
      primaryColor: "#DC143C", reportFooter: "Zenith Bank Plc — KYC Intelligence Division",
    },
    {
      name: "First Bank Nigeria",             slug: "first-bank",   plan: "professional"   as const, status: "active"    as const,
      contactEmail: "aml@firstbanknigeria.com", contactName: "Ngozi Adeyemi",
      country: "Nigeria", industry: "Commercial Banking", monthlyQuota: 1500, ngnBalance: 800000,
      primaryColor: "#00008B", reportFooter: "First Bank of Nigeria Ltd — AML Compliance Unit",
    },
    {
      name: "NSIA Insurance",                 slug: "nsia",         plan: "starter"        as const, status: "trial"     as const,
      contactEmail: "risk@nsia.com.ng",       contactName: "Tunde Olawale",
      country: "Nigeria", industry: "Insurance", monthlyQuota: 500, ngnBalance: 150000,
      primaryColor: "#FF8C00", reportFooter: "NSIA Insurance — Risk Intelligence Report",
    },
  ];

  for (const t of SEED_TENANTS) {
    await db.execute(sql`
      INSERT INTO tenants (name, slug, plan, status, "contactEmail", "contactName", country, industry,
                           "monthlyQuota", "ngnBalance", "primaryColor", "reportFooter")
      VALUES (${t.name}, ${t.slug}, ${t.plan}, ${t.status}, ${t.contactEmail}, ${t.contactName},
              ${t.country}, ${t.industry}, ${t.monthlyQuota}, ${t.ngnBalance},
              ${t.primaryColor}, ${t.reportFooter})
      ON CONFLICT (slug) DO NOTHING
    `);
  }

  const allTenants = await db.select({ id: tenants.id }).from(tenants);
  console.log(`    ✓ ${allTenants.length} tenants`);
  return allTenants.map(t => t.id);
}

// ─── 3. API Keys ──────────────────────────────────────────────────────────────

async function seedApiKeys(tenantIds: number[]) {
  console.log("  Seeding API keys…");
  let count = 0;
  for (const tid of tenantIds) {
    const existing = await db.execute(sql`SELECT id FROM api_keys WHERE "tenantId" = ${tid} LIMIT 1`);
    if ((existing.rows as any[]).length > 0) continue;
    await db.execute(sql`
      INSERT INTO api_keys ("tenantId", name, "keyHash", "keyPrefix", status, permissions)
      VALUES (${tid}, 'Primary Key', md5(random()::text), 'bisk_' || substr(md5(random()::text), 1, 8),
              'active', '["investigations:read","kyc:write","alerts:read"]')
    `);
    count++;
  }
  console.log(`    ✓ ${count} new API keys`);
}

// ─── 4. Field Agents ──────────────────────────────────────────────────────────

async function seedFieldAgents() {
  console.log("  Seeding field agents…");

  const AGENTS = [
    { code: "FA-001", name: "Chukwuemeka Obi",    email: "c.obi@bis-field.ng",       state: "Lagos",  tier: "lead"       as const, lat: 6.5244,  lng: 3.3792  },
    { code: "FA-002", name: "Yewande Adebayo",    email: "y.adebayo@bis-field.ng",   state: "Abuja",  tier: "senior"     as const, lat: 9.0579,  lng: 7.4951  },
    { code: "FA-003", name: "Ifeanyi Nwosu",      email: "i.nwosu@bis-field.ng",     state: "Rivers", tier: "senior"     as const, lat: 4.8156,  lng: 7.0498  },
    { code: "FA-004", name: "Zainab Hassan",      email: "z.hassan@bis-field.ng",    state: "Kano",   tier: "junior"     as const, lat: 12.0022, lng: 8.5920  },
    { code: "FA-005", name: "Olumide Onyekachi",  email: "o.onyekachi@bis-field.ng", state: "Lagos",  tier: "specialist" as const, lat: 6.4281,  lng: 3.4219  },
    { code: "FA-006", name: "Nkechi Ugwu",        email: "n.ugwu@bis-field.ng",      state: "Enugu",  tier: "junior"     as const, lat: 6.4584,  lng: 7.5464  },
    { code: "FA-007", name: "Abdullahi Sani",     email: "a.sani@bis-field.ng",      state: "Kaduna", tier: "senior"     as const, lat: 10.5105, lng: 7.4165  },
    { code: "FA-008", name: "Chidinma Eze",       email: "c.eze@bis-field.ng",       state: "Anambra",tier: "junior"     as const, lat: 6.2104,  lng: 7.0681  },
    { code: "FA-009", name: "Musa Lawal",         email: "m.lawal@bis-field.ng",     state: "Oyo",    tier: "senior"     as const, lat: 7.3775,  lng: 3.9470  },
    { code: "FA-010", name: "Adaora Chukwu",      email: "a.chukwu@bis-field.ng",    state: "Delta",  tier: "lead"       as const, lat: 5.5320,  lng: 5.8987  },
    { code: "FA-011", name: "Emeka Bello",        email: "e.bello@bis-field.ng",     state: "Lagos",  tier: "junior"     as const, lat: 6.5958,  lng: 3.3451  },
    { code: "FA-012", name: "Fatima Okafor",      email: "f.okafor@bis-field.ng",    state: "Abuja",  tier: "senior"     as const, lat: 9.0765,  lng: 7.3986  },
    { code: "FA-013", name: "Seun Adeyemi",       email: "s.adeyemi@bis-field.ng",   state: "Ogun",   tier: "junior"     as const, lat: 6.9980,  lng: 3.4737  },
    { code: "FA-014", name: "Blessing Ibrahim",   email: "b.ibrahim@bis-field.ng",   state: "Imo",    tier: "specialist" as const, lat: 5.4836,  lng: 7.0333  },
    { code: "FA-015", name: "Tunde Musa",         email: "t.musa@bis-field.ng",      state: "Kogi",   tier: "junior"     as const, lat: 7.7337,  lng: 6.6906  },
    { code: "FA-016", name: "Ngozi Okonkwo",      email: "n.okonkwo@bis-field.ng",   state: "Lagos",  tier: "lead"       as const, lat: 6.4698,  lng: 3.5852  },
    { code: "FA-017", name: "Uche Nwachukwu",     email: "u.nwachukwu@bis-field.ng", state: "Rivers", tier: "senior"     as const, lat: 4.7799,  lng: 7.0134  },
    { code: "FA-018", name: "Halima Bello",       email: "h.bello@bis-field.ng",     state: "Borno",  tier: "junior"     as const, lat: 11.8333, lng: 13.1500 },
    { code: "FA-019", name: "Obinna Eze",         email: "o.eze@bis-field.ng",       state: "Plateau",tier: "senior"     as const, lat: 9.8965,  lng: 8.8583  },
    { code: "FA-020", name: "Kemi Olawale",       email: "k.olawale@bis-field.ng",   state: "Edo",    tier: "junior"     as const, lat: 6.3350,  lng: 5.6037  },
  ];

  for (const a of AGENTS) {
    const hoursBack = rndInt(1, 48);
    const tasksCompleted = rndInt(5, 120);
    const tasksActive = rndInt(0, 4);
    const rating = rndFloat(3.5, 5.0);
    const lat = a.lat + rndFloat(-0.05, 0.05, 4);
    const lng = a.lng + rndFloat(-0.05, 0.05, 4);
    const phone = randomPhone();
    const lga = rnd(NG_LGAS[a.state] ?? ["Central"]);
    await db.execute(
      sql.raw(`
        INSERT INTO field_agents ("agentCode", name, email, phone, state, lga, status, tier,
                                  specializations, "tasksCompleted", "tasksActive", rating,
                                  "gpsLat", "gpsLng", "lastSeen", "createdBy")
        VALUES (
          '${a.code}', '${a.name}', '${a.email}', '${phone}', '${a.state}',
          '${lga}', 'active', '${a.tier}',
          '["document_collection","address_verification"]',
          ${tasksCompleted}, ${tasksActive}, ${rating},
          ${lat}, ${lng},
          NOW() - INTERVAL '${hoursBack} hours', 1
        )
        ON CONFLICT ("agentCode") DO NOTHING
      `)
    );
  }

  const all = await db.select({ id: fieldAgents.id }).from(fieldAgents);
  console.log(`    ✓ ${all.length} field agents`);
  return all.map(a => a.id);
}

// ─── 5. Investigations ────────────────────────────────────────────────────────

async function seedInvestigations(userIds: number[]) {
  console.log("  Seeding investigations…");

  const STATUSES = ["pending", "processing", "completed", "flagged", "archived"] as const;
  const TIERS    = ["basic", "standard", "comprehensive"] as const;
  const PRIORITIES = ["low", "medium", "high", "critical"] as const;
  const RISK_TIERS = ["low", "medium", "high", "critical"] as const;

  const invRefs: string[] = [];

  for (let i = 1; i <= 50; i++) {
    const ref = `INV-2026-${pad(i, 4)}`;
    const isCorpRate = Math.random() < 0.3;
    const subjectName = isCorpRate ? rnd(CORP_NAMES) : randomName();
    const subjectType = isCorpRate ? "corporate" : "individual";
    const riskScore = rndFloat(10, 95);
    const riskTier = riskScore >= 75 ? "critical" : riskScore >= 55 ? "high" : riskScore >= 35 ? "medium" : "low";
    const status = rnd(STATUSES);
    const createdDaysAgo = rndInt(1, 90);
    const updatedDaysAgo = rndInt(0, createdDaysAgo);
    const tier = rnd(TIERS);
    const priority = rnd(PRIORITIES);
    const nin = subjectType === "individual" ? randomNIN() : null;
    const bvn = subjectType === "individual" ? randomBVN() : null;
    const phone = randomPhone();
    const email = subjectName.toLowerCase().replace(/\s+/g, ".").replace(/[^a-z.]/g, "") + "@example.com";
    const address = `${rndInt(1, 100)} ${rnd(NG_STATES)} Street, ${rnd(NG_STATES)}`;
    const assignedTo = rnd(userIds);
    const createdBy = rnd(userIds);

    const ninVal = nin ? `'${nin}'` : "NULL";
    const bvnVal = bvn ? `'${bvn}'` : "NULL";

    await db.execute(
      sql.raw(`
        INSERT INTO investigations (ref, "subjectType", "subjectName", country, tier, priority, status,
                                    "riskScore", "riskTier", nin, bvn, phone, email, address, purpose,
                                    "assignedTo", "createdBy", "createdAt", "updatedAt")
        VALUES (
          '${ref}', '${subjectType}', '${subjectName.replace(/'/g, "''")}', 'NG',
          '${tier}', '${priority}', '${status}',
          ${riskScore}, '${riskTier}',
          ${ninVal}, ${bvnVal},
          '${phone}', '${email}',
          '${address.replace(/'/g, "''")}',
          'Background verification for compliance purposes',
          ${assignedTo}, ${createdBy},
          NOW() - INTERVAL '${createdDaysAgo} days',
          NOW() - INTERVAL '${updatedDaysAgo} days'
        )
        ON CONFLICT (ref) DO NOTHING
      `)
    );
    invRefs.push(ref);
  }

  const all = await db.select({ id: investigations.id, ref: investigations.ref }).from(investigations);
  console.log(`    ✓ ${all.length} investigations`);
  return all;
}

// ─── 6. Alerts ────────────────────────────────────────────────────────────────

async function seedAlerts(invRows: { id: number; ref: string }[]) {
  console.log("  Seeding alerts…");

  const TYPES = ["sanctions_hit", "pep_detected", "risk_threshold", "velocity", "adverse_media", "field_report", "system"] as const;
  const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;

  const ALERT_TEMPLATES = [
    { type: "sanctions_hit",    title: "OFAC Sanctions Match",         body: "Subject matched OFAC SDN list with 94% confidence." },
    { type: "pep_detected",     title: "PEP Detected",                 body: "Subject identified as Politically Exposed Person (Tier 2)." },
    { type: "risk_threshold",   title: "Risk Score Threshold Breached", body: "Composite risk score exceeded configured threshold of 75." },
    { type: "velocity",         title: "Velocity Anomaly Detected",    body: "Unusual transaction velocity detected: 47 transactions in 2 hours." },
    { type: "adverse_media",    title: "Adverse Media Alert",          body: "Negative news coverage detected across 3 major publications." },
    { type: "field_report",     title: "Field Agent Report",           body: "Field agent confirmed address discrepancy during site visit." },
    { type: "system",           title: "System Health Warning",        body: "NIMC data source response time degraded (P99 > 3s)." },
  ];

  for (let i = 0; i < 40; i++) {
    const inv = rnd(invRows);
    const tpl = rnd(ALERT_TEMPLATES);
    const severity = rnd(SEVERITIES);
    const hoursBack = rndInt(1, 720);
    const isRead = Math.random() > 0.4;
    const isAck = Math.random() > 0.6;
    const isResolved = Math.random() > 0.8;

    await db.execute(
      sql.raw(`
        INSERT INTO alerts ("investigationId", type, severity, title, body, "subjectRef",
                            "sourceService", read, acknowledged, resolved, dismissed, "createdAt")
        VALUES (
          ${inv.id}, '${tpl.type}', '${severity}', '${tpl.title.replace(/'/g, "''")}', '${tpl.body.replace(/'/g, "''")}',
          '${inv.ref}', 'bis-bff', ${isRead}, ${isAck},
          ${isResolved}, false,
          NOW() - INTERVAL '${hoursBack} hours'
        )
      `)
    );
  }

  const all = await db.select({ id: alerts.id }).from(alerts);
  console.log(`    ✓ ${all.length} alerts`);
}

// ─── 7. KYC Records ───────────────────────────────────────────────────────────

async function seedKycRecords(invRows: { id: number; ref: string }[], userIds: number[]) {
  console.log("  Seeding KYC records…");

  const STATUSES = ["pending", "processing", "passed", "failed", "review"] as const satisfies readonly string[];

  for (let i = 0; i < 100; i++) {
    const inv = rnd(invRows);
    const status = rnd(STATUSES);
    const riskScore = rndFloat(5, 98);
    const name = randomName();
    const nin = randomNIN();
    const bvn = randomBVN();
    const dob = `${rndInt(1960, 2000)}-${pad(rndInt(1, 12))}-${pad(rndInt(1, 28))}`;
    const phone = randomPhone();
    const ninResult = JSON.stringify({ verified: status === "passed", confidence: rndFloat(0.7, 0.99) }).replace(/'/g, "''");
    const bvnResult = JSON.stringify({ verified: status === "passed", confidence: rndFloat(0.7, 0.99) }).replace(/'/g, "''");
    const sanctionsResult = JSON.stringify({ matched: Math.random() > 0.9, lists: [] }).replace(/'/g, "''");
    const createdBy = rnd(userIds);
    const daysBack = rndInt(1, 60);

    await db.execute(
      sql.raw(`
        INSERT INTO kyc_records ("investigationId", "subjectName", nin, bvn, dob, phone, status,
                                 "riskScore", "ninResult", "bvnResult", "sanctionsResult",
                                 "createdBy", "createdAt")
        VALUES (
          ${inv.id}, '${name.replace(/'/g, "''")}', '${nin}', '${bvn}',
          '${dob}', '${phone}', '${status}', ${riskScore},
          '${ninResult}', '${bvnResult}', '${sanctionsResult}',
          ${createdBy},
          NOW() - INTERVAL '${daysBack} days'
        )
      `)
    );
  }

  const all = await db.select({ id: kycRecords.id }).from(kycRecords);
  console.log(`    ✓ ${all.length} KYC records`);
}

// ─── 8. Field Tasks ───────────────────────────────────────────────────────────

async function seedFieldTasks(invRows: { id: number; ref: string }[], userIds: number[]) {
  console.log("  Seeding field tasks…");

  const TASK_TYPES = ["address_verification", "biometric_capture", "document_collection", "surveillance", "interview"] as const satisfies readonly string[];
  const TASK_STATUSES = ["pending", "dispatched", "in_progress", "completed", "failed"] as const satisfies readonly string[];

  const AGENT_CODES = [
    "FA-001","FA-002","FA-003","FA-004","FA-005",
    "FA-006","FA-007","FA-008","FA-009","FA-010",
  ];
  const AGENT_NAMES = [
    "Chukwuemeka Obi","Yewande Adebayo","Ifeanyi Nwosu","Zainab Hassan","Olumide Onyekachi",
    "Nkechi Ugwu","Abdullahi Sani","Chidinma Eze","Musa Lawal","Adaora Chukwu",
  ];

  for (let i = 1; i <= 50; i++) {
    const inv = rnd(invRows);
    const agentIdx = rndInt(0, AGENT_CODES.length - 1);
    const state = rnd(NG_STATES);
    const taskRef = `FT-2026-${pad(i, 4)}`;
    const taskType = rnd(TASK_TYPES);
    const priority = rnd(["low","medium","high","critical"] as const);
    const taskStatus = rnd(TASK_STATUSES);
    const subjectName = randomName();
    const streets = ["Allen Avenue","Broad Street","Victoria Island","Lekki Phase 1","Wuse II"];
    const address = `${rndInt(1, 200)} ${rnd(streets)}`;
    const lga = rnd(NG_LGAS[state] ?? ["Central"]);
    const gpsLat = rndFloat(4.0, 13.0, 4);
    const gpsLng = rndFloat(3.0, 14.0, 4);
    const createdBy = rnd(userIds);
    const daysBack = rndInt(1, 30);

    await db.execute(
      sql.raw(`
        INSERT INTO field_tasks ("taskRef", "investigationId", "agentId", "agentName", "taskType",
                                 priority, status, "subjectName", address, state, lga,
                                 "gpsLat", "gpsLng", instructions, "createdBy", "createdAt")
        VALUES (
          '${taskRef}', ${inv.id}, '${AGENT_CODES[agentIdx]}', '${AGENT_NAMES[agentIdx]}',
          '${taskType}', '${priority}', '${taskStatus}',
          '${subjectName.replace(/'/g, "''")}',
          '${address}', '${state}', '${lga}',
          ${gpsLat}, ${gpsLng},
          'Verify subject address and collect supporting documents.',
          ${createdBy},
          NOW() - INTERVAL '${daysBack} days'
        )
        ON CONFLICT ("taskRef") DO NOTHING
      `)
    );
  }

  const all = await db.select({ id: fieldTasks.id }).from(fieldTasks);
  console.log(`    ✓ ${all.length} field tasks`);
}

// ─── 9. Screening Requests ────────────────────────────────────────────────────

async function seedScreeningRequests(invRows: { id: number; ref: string }[], userIds: number[]) {
  console.log("  Seeding screening requests…");

  const TYPES = ["mvr", "drug", "work_authorization", "biometric", "zero_footprint"] as const satisfies readonly string[];
  const STATUSES2 = ["pending", "processing", "completed", "failed", "review"] as const satisfies readonly string[];

  for (let i = 1; i <= 30; i++) {
    const inv = rnd(invRows);
    const type = rnd(TYPES);
    const status = rnd(STATUSES2);
    const ref = `SCR-2026-${pad(i, 4)}`;
    const priority = rnd(["low","medium","high","critical"] as const);
    const resultSummary = status === "completed" ? "'Screening completed. No adverse findings.'" : "NULL";
    const riskScore = status === "completed" ? rndFloat(10, 90) : "NULL";
    const createdBy = rnd(userIds);
    const daysBack = rndInt(1, 45);

    await db.execute(
      sql.raw(`
        INSERT INTO screening_requests ("requestRef", "investigationId", type, status, "subjectName",
                                        "subjectType", priority, "resultSummary", "riskScore",
                                        "createdBy", "createdAt")
        VALUES (
          '${ref}', ${inv.id}, '${type}', '${status}', '${randomName().replace(/'/g, "''")}',
          'individual', '${priority}',
          ${resultSummary}, ${riskScore},
          ${createdBy},
          NOW() - INTERVAL '${daysBack} days'
        )
        ON CONFLICT ("requestRef") DO NOTHING
      `)
    );
  }

  const all = await db.select({ id: screeningRequests.id }).from(screeningRequests);
  console.log(`    ✓ ${all.length} screening requests`);
}

// ─── 10. Monitors ─────────────────────────────────────────────────────────────

async function seedMonitors(invRows: { id: number; ref: string }[], userIds: number[]) {
  console.log("  Seeding monitors…");

  const TYPES = ["sanctions", "pep", "adverse_media", "social", "transaction", "biometric"] as const satisfies readonly string[];
  const STATUSES = ["active", "paused", "triggered", "expired"] as const;
  const FREQS = ["hourly", "daily", "weekly", "monthly"];

  for (let i = 1; i <= 20; i++) {
    const inv = rnd(invRows);
    const ref = `MON-2026-${pad(i, 4)}`;
    const status = rnd(STATUSES);
    const monType = rnd(TYPES);
    const freq = rnd(FREQS);
    const subjectName = randomName();
    const alertCount = rndInt(0, 12);
    const createdBy = rnd(userIds);
    const daysBack = rndInt(1, 60);

    await db.execute(
      sql.raw(`
        INSERT INTO monitors ("monitorRef", "investigationId", "subjectName", "subjectRef", type, status,
                              frequency, "alertCount", "createdBy", "createdAt")
        VALUES (
          '${ref}', ${inv.id}, '${subjectName.replace(/'/g, "''")}', '${inv.ref}',
          '${monType}', '${status}', '${freq}', ${alertCount}, ${createdBy},
          NOW() - INTERVAL '${daysBack} days'
        )
        ON CONFLICT ("monitorRef") DO NOTHING
      `)
    );
  }

  const all = await db.select({ id: monitors.id }).from(monitors);
  console.log(`    ✓ ${all.length} monitors`);
}

// ─── 11. Reports ──────────────────────────────────────────────────────────────

async function seedReports(invRows: { id: number; ref: string }[], userIds: number[]) {
  console.log("  Seeding reports…");

  const TEMPLATES = ["full_background", "kyc_summary", "sanctions_check", "risk_assessment", "field_report", "compliance_pack"];
  const STATUSES = ["generating", "ready", "failed"] as const satisfies readonly string[];

  for (let i = 1; i <= 20; i++) {
    const inv = rnd(invRows);
    const ref = `RPT-2026-${pad(i, 4)}`;
    const template = rnd(TEMPLATES);
    const status = rnd(STATUSES);
    const title = `${template.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())} — ${inv.ref}`;
    const generatedBy = rnd(userIds);
    const daysBack = rndInt(1, 30);

    await db.execute(
      sql.raw(`
        INSERT INTO reports ("reportRef", "investigationId", template, title, format, status,
                             "generatedBy", "createdAt")
        VALUES (
          '${ref}', ${inv.id}, '${template}',
          '${title.replace(/'/g, "''")}',
          'pdf', '${status}', ${generatedBy},
          NOW() - INTERVAL '${daysBack} days'
        )
        ON CONFLICT ("reportRef") DO NOTHING
      `)
    );
  }

  const all = await db.select({ id: reports.id }).from(reports);
  console.log(`    ✓ ${all.length} reports`);
}

// ─── 12. Audit Log ────────────────────────────────────────────────────────────

async function seedAuditLog(invRows: { id: number; ref: string }[], userIds: number[]) {
  console.log("  Seeding audit log…");

  const ACTIONS = [
    { cat: "investigation", act: "Investigation created",          result: "success" as const },
    { cat: "investigation", act: "Investigation status updated",   result: "success" as const },
    { cat: "investigation", act: "Investigation assigned",         result: "success" as const },
    { cat: "kyc",           act: "KYC verification initiated",     result: "success" as const },
    { cat: "kyc",           act: "KYC document extracted",         result: "success" as const },
    { cat: "alert",         act: "Alert acknowledged",             result: "success" as const },
    { cat: "alert",         act: "Alert escalated",                result: "success" as const },
    { cat: "report",        act: "Report generated",               result: "success" as const },
    { cat: "user",          act: "User role updated",              result: "success" as const },
    { cat: "api",           act: "API key rotated",                result: "success" as const },
    { cat: "system",        act: "Scheduled rule evaluation run",  result: "success" as const },
    { cat: "investigation", act: "PDF export generated",           result: "success" as const },
    { cat: "kyc",           act: "Bulk KYC re-verify triggered",   result: "warning" as const },
    { cat: "system",        act: "Data source health check",       result: "warning" as const },
    { cat: "api",           act: "API rate limit exceeded",        result: "failure" as const },
  ];

  for (let i = 0; i < 200; i++) {
    const inv = rnd(invRows);
    const uid = rnd(userIds);
    const entry = rnd(ACTIONS);
    const ip = `197.${rndInt(1,254)}.${rndInt(1,254)}.${rndInt(1,254)}`;
    const hoursBack = rndInt(1, 2160);

    await db.execute(
      sql.raw(`
        INSERT INTO audit_log ("userId", "userEmail", category, action, "targetRef", result,
                               "ipAddress", "createdAt")
        VALUES (
          ${uid}, 'user${uid}@bis.gov.ng',
          '${entry.cat}', '${entry.act.replace(/'/g, "''")}', '${inv.ref}', '${entry.result}',
          '${ip}',
          NOW() - INTERVAL '${hoursBack} hours'
        )
      `)
    );
  }

  const all = await db.select({ id: auditLog.id }).from(auditLog);
  console.log(`    ✓ ${all.length} audit log entries`);
}

// ─── 13. Alert Rules ──────────────────────────────────────────────────────────

async function seedAlertRules() {
  console.log("  Seeding alert rules…");

  const RULES = [
    { name: "High Risk Score",          metric: "risk_score",              operator: "gte", threshold: 75,  severity: "critical", autoEscalate: true  },
    { name: "Elevated Risk Score",      metric: "risk_score",              operator: "gte", threshold: 55,  severity: "high",     autoEscalate: false },
    { name: "Sanctions Confidence",     metric: "sanctions_confidence",    operator: "gte", threshold: 0.8, severity: "critical", autoEscalate: true  },
    { name: "PEP Confidence",           metric: "pep_confidence",          operator: "gte", threshold: 0.7, severity: "high",     autoEscalate: false },
    { name: "Adverse Media Spike",      metric: "adverse_media_count",     operator: "gte", threshold: 5,   severity: "high",     autoEscalate: false },
    { name: "Hourly Velocity Alert",    metric: "velocity_hourly",         operator: "gte", threshold: 30,  severity: "medium",   autoEscalate: false },
    { name: "Daily Velocity Alert",     metric: "velocity_daily",          operator: "gte", threshold: 200, severity: "high",     autoEscalate: false },
    { name: "Low Credit Score",         metric: "credit_score",            operator: "lte", threshold: 300, severity: "medium",   autoEscalate: false },
    { name: "Duplicate Identity",       metric: "duplicate_identity_score",operator: "gte", threshold: 0.9, severity: "critical", autoEscalate: true  },
    { name: "Critical Risk Threshold",  metric: "risk_score",              operator: "gte", threshold: 90,  severity: "critical", autoEscalate: true  },
  ];

  for (const r of RULES) {
    await db.execute(sql`
      INSERT INTO alert_rules (name, description, metric, operator, threshold, severity,
                               enabled, "autoEscalate", "notifyOwner", "createdBy")
      VALUES (
        ${r.name},
        ${`Triggers when ${r.metric} is ${r.operator} ${r.threshold}`},
        ${r.metric}, ${r.operator}, ${r.threshold}, ${r.severity},
        true, ${r.autoEscalate}, true, 'seed-admin-001'
      )
      ON CONFLICT DO NOTHING
    `);
  }

  const all = await db.select({ id: alertRules.id }).from(alertRules);
  console.log(`    ✓ ${all.length} alert rules`);
  return all.map(r => r.id);
}

// ─── 14. Rule Evaluations ─────────────────────────────────────────────────────

async function seedRuleEvaluations(ruleIds: number[], invRows: { id: number; ref: string }[]) {
  console.log("  Seeding rule evaluations…");

  for (let i = 0; i < 30; i++) {
    const ruleId = rnd(ruleIds);
    const inv = rnd(invRows);
    const value = rndFloat(10, 100);
    const threshold = rndFloat(40, 80);
    const triggered = value >= threshold;
    const alertCreated = triggered && Math.random() > 0.3;
    const hoursBack = rndInt(1, 168);

    await db.execute(
      sql.raw(`
        INSERT INTO rule_evaluations ("ruleId", "subjectRef", metric, value, threshold,
                                     triggered, "alertCreated", context, "createdAt")
        VALUES (
          ${ruleId}, '${inv.ref}', 'risk_score', ${value}, ${threshold},
          ${triggered}, ${alertCreated},
          'Scheduled evaluation — avg risk score over last 24h',
          NOW() - INTERVAL '${hoursBack} hours'
        )
      `)
    );
  }

  const all = await db.select({ id: ruleEvaluations.id }).from(ruleEvaluations);
  console.log(`    ✓ ${all.length} rule evaluations`);
}

// ─── 15. Onboarding Applications ─────────────────────────────────────────────

async function seedOnboardingApplications() {
  console.log("  Seeding onboarding applications…");

  const APPS = [
    {
      refId: "ONB-2026-001", entityType: "corporate", legalName: "Apex Fintech Ltd",
      tradingName: "ApexPay", countryCode: "NG", stateProvince: "Lagos", city: "Ikeja",
      businessCategory: "Fintech", contactName: "Chidi Okonkwo", contactEmail: "chidi@apexfintech.ng",
      contactPhone: "08012345678", status: "approved" as const,
    },
    {
      refId: "ONB-2026-002", entityType: "corporate", legalName: "BlueStar Insurance Ltd",
      tradingName: "BlueStar", countryCode: "NG", stateProvince: "Abuja", city: "Wuse",
      businessCategory: "Insurance", contactName: "Ngozi Adeyemi", contactEmail: "ngozi@bluestar.ng",
      contactPhone: "08098765432", status: "under_review" as const,
    },
    {
      refId: "ONB-2026-003", entityType: "individual", legalName: "Emeka Nwosu",
      tradingName: null, countryCode: "NG", stateProvince: "Rivers", city: "Port Harcourt",
      businessCategory: "Consulting", contactName: "Emeka Nwosu", contactEmail: "emeka@nwosu.ng",
      contactPhone: "08055554444", status: "submitted" as const,
    },
    {
      refId: "ONB-2026-004", entityType: "corporate", legalName: "Meridian Logistics Group",
      tradingName: "MeriLog", countryCode: "NG", stateProvince: "Lagos", city: "Apapa",
      businessCategory: "Logistics", contactName: "Tunde Lawal", contactEmail: "tunde@meridian.ng",
      contactPhone: "08033221100", status: "awaiting_documents" as const,
    },
    {
      refId: "ONB-2026-005", entityType: "corporate", legalName: "Crescent Insurance Brokers",
      tradingName: "Crescent", countryCode: "NG", stateProvince: "Oyo", city: "Ibadan",
      businessCategory: "Insurance", contactName: "Fatima Hassan", contactEmail: "fatima@crescent.ng",
      contactPhone: "08077889900", status: "rejected" as const,
    },
  ];

  for (const a of APPS) {
    await db.execute(sql`
      INSERT INTO onboarding_applications (
        "referenceId", "entityType", "legalName", "tradingName", "countryCode",
        "stateProvince", city, "businessCategory", "contactName", "contactEmail",
        "contactPhone", status, "agreedToTerms", "pepDeclaration", "createdBy"
      )
      VALUES (
        ${a.refId}, ${a.entityType}, ${a.legalName}, ${a.tradingName ?? null},
        ${a.countryCode}, ${a.stateProvince}, ${a.city}, ${a.businessCategory},
        ${a.contactName}, ${a.contactEmail}, ${a.contactPhone}, ${a.status},
        true, false, 'seed-admin-001'
      )
      ON CONFLICT DO NOTHING
    `);
  }

  const all = await db.select({ id: onboardingApplications.id }).from(onboardingApplications);
  console.log(`    ✓ ${all.length} onboarding applications`);
}

// ─── 16. Data Sources ─────────────────────────────────────────────────────────

async function seedDataSources() {
  console.log("  Seeding data sources…");

  const DS = [
    { code: "NIMC_NIN",   name: "NIMC — National Identity",     cat: "identity",    status: "active",      provider: "NIMC",   uptime: 99.7, avgMs: 320  },
    { code: "NIBSS_BVN",  name: "NIBSS — Bank Verification",    cat: "financial",   status: "active",      provider: "NIBSS",  uptime: 99.9, avgMs: 280  },
    { code: "CAC_RC",     name: "CAC — Corporate Affairs",       cat: "legal",       status: "active",      provider: "CAC",    uptime: 98.5, avgMs: 450  },
    { code: "EFCC_WL",    name: "EFCC — Watchlist",             cat: "legal",       status: "active",      provider: "EFCC",   uptime: 99.1, avgMs: 210  },
    { code: "OFAC_SDN",   name: "OFAC — SDN Sanctions",         cat: "legal",       status: "active",      provider: "OFAC",   uptime: 99.9, avgMs: 180  },
    { code: "UN_CONS",    name: "UN Consolidated Sanctions",     cat: "legal",       status: "active",      provider: "UN",     uptime: 99.8, avgMs: 195  },
    { code: "EU_CONS",    name: "EU Consolidated Sanctions",     cat: "legal",       status: "active",      provider: "EU",     uptime: 99.6, avgMs: 200  },
    { code: "NCC_SIM",    name: "NCC — SIM Registration",       cat: "identity",    status: "active",      provider: "NCC",    uptime: 97.3, avgMs: 380  },
    { code: "FIRS_TIN",   name: "FIRS — Tax ID",                cat: "government",  status: "active",      provider: "FIRS",   uptime: 96.8, avgMs: 520  },
    { code: "FRSC_DL",    name: "FRSC — Driver's Licence",      cat: "identity",    status: "active",      provider: "FRSC",   uptime: 95.2, avgMs: 610  },
    { code: "NIS_PASS",   name: "NIS — Passport",               cat: "identity",    status: "degraded",    provider: "NIS",    uptime: 89.4, avgMs: 1200 },
    { code: "INEC_VR",    name: "INEC — Voter Registration",    cat: "government",  status: "active",      provider: "INEC",   uptime: 94.1, avgMs: 480  },
    { code: "CBN_BVN2",   name: "CBN — BVN Verification",       cat: "financial",   status: "active",      provider: "CBN",    uptime: 99.5, avgMs: 260  },
    { code: "CRC_CR",     name: "CRC Credit Bureau",            cat: "financial",   status: "active",      provider: "CRC",    uptime: 98.8, avgMs: 340  },
    { code: "FIRSTCENT",  name: "First Central Credit Bureau",  cat: "financial",   status: "active",      provider: "FCMB",   uptime: 98.2, avgMs: 360  },
    { code: "CREDITREG",  name: "Credit Registry",              cat: "financial",   status: "active",      provider: "CR",     uptime: 97.9, avgMs: 390  },
    { code: "INTERPOL",   name: "Interpol Notices",             cat: "legal",       status: "active",      provider: "ICPO",   uptime: 99.9, avgMs: 150  },
    { code: "PEP_GLOBAL", name: "Global PEP Database",          cat: "government",  status: "active",      provider: "Refinitiv", uptime: 99.7, avgMs: 220 },
    { code: "ADVERSE_NLP",name: "Adverse Media NLP Engine",     cat: "social",      status: "active",      provider: "BIS-ML", uptime: 99.3, avgMs: 890  },
    { code: "SOCIAL_OSINT",name:"Social OSINT Aggregator",      cat: "social",      status: "active",      provider: "BIS",    uptime: 98.1, avgMs: 1100 },
    { code: "BIOMETRIC_DB",name:"Biometric Enrollment DB",      cat: "biometric",   status: "active",      provider: "BIS",    uptime: 99.8, avgMs: 140  },
    { code: "LIVENESS_AI", name:"Liveness Detection AI",        cat: "biometric",   status: "active",      provider: "BIS-ML", uptime: 99.5, avgMs: 760  },
    { code: "FACE_MATCH",  name:"Facial Recognition Engine",    cat: "biometric",   status: "active",      provider: "BIS-ML", uptime: 99.4, avgMs: 820  },
    { code: "VESSEL_REG",  name:"Nigerian Vessel Registry",     cat: "commercial",  status: "maintenance", provider: "NIMASA", uptime: 82.0, avgMs: 1800 },
    { code: "LAND_REG",    name:"Land Registry (Lagos)",        cat: "commercial",  status: "active",      provider: "LASRERA",uptime: 91.3, avgMs: 950  },
  ];

  for (const d of DS) {
    await db.execute(sql`
      INSERT INTO data_sources (code, name, category, status, provider, "uptimePct", "avgResponseMs",
                                "requestsToday", "requestsTotal", enabled, "recordCount")
      VALUES (
        ${d.code}, ${d.name}, ${d.cat}, ${d.status}, ${d.provider},
        ${d.uptime}, ${d.avgMs}, ${rndInt(50, 2000)}, ${rndInt(5000, 500000)},
        true, ${rndInt(100000, 50000000)}
      )
      ON CONFLICT (code) DO NOTHING
    `);
  }

  const all = await db.select({ id: dataSources.id }).from(dataSources);
  console.log(`    ✓ ${all.length} data sources`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🌱  BIS Platform — Seed Script\n");
  console.log(`  Database: ${DATABASE_URL.replace(/:[^@]+@/, ":***@")}\n`);

  try {
    const userIds    = await seedUsers();
    const tenantIds  = await seedTenants();
    await seedApiKeys(tenantIds);
    await seedFieldAgents();
    const invRows    = await seedInvestigations(userIds);
    await seedAlerts(invRows);
    await seedKycRecords(invRows, userIds);
    await seedFieldTasks(invRows, userIds);
    await seedScreeningRequests(invRows, userIds);
    await seedMonitors(invRows, userIds);
    await seedReports(invRows, userIds);
    await seedAuditLog(invRows, userIds);
    const ruleIds    = await seedAlertRules();
    await seedRuleEvaluations(ruleIds, invRows);
    await seedOnboardingApplications();
    await seedDataSources();

    console.log("\n✅  Seed complete!\n");
  } catch (err) {
    console.error("\n❌  Seed failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
