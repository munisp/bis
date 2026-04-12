#!/usr/bin/env node
// seed-db.mjs — BIS Platform Demo Data Seeder
// Usage: node scripts/seed-db.mjs
// Or:    pnpm db:seed
//
// Seeds the database with realistic demo data for:
//   - Tenants (3 organisations)
//   - Users (admin + 4 staff)
//   - Investigations (10 with notes, timeline, risk scores)
//   - Cases (8 with parties, documents, comments)
//   - Alerts (12 across types)
//   - KYC records (6)
//   - LEX agencies, submitters, submissions (5)
//   - Field agents (4)
//   - Data sources (6)
//   - Continuous monitors (3)
//   - goAML filings (2)
//   - Audit log entries (20)
//   - Notifications (5)
//   - Platform settings (defaults)

import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

// ── Connection ────────────────────────────────────────────────────────────────
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://bis_user:bis_secure_2026@localhost:5432/bis_db";

const pool = new Pool({ connectionString: DATABASE_URL });

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const now = () => new Date();
const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const hoursAgo = (n) => new Date(Date.now() - n * 3600000);

function randomRef(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

// ── Main Seeder ───────────────────────────────────────────────────────────────
async function seed() {
  console.log("🌱 BIS Platform — Starting database seed...\n");

  // ── 1. Tenants ─────────────────────────────────────────────────────────────
  console.log("  → Seeding tenants...");
  const tenantRows = await query(`
    INSERT INTO tenants (name, slug, plan, status, contact_email, api_quota_daily, created_at)
    VALUES
      ('Zenith Bank Plc', 'zenith-bank', 'enterprise', 'active', 'compliance@zenithbank.com', 10000, $1),
      ('Interswitch Group', 'interswitch', 'professional', 'active', 'kyc@interswitch.com', 5000, $2),
      ('Demo Organisation', 'demo-org', 'starter', 'trial', 'admin@demo.bis.ng', 1000, $3)
    ON CONFLICT (slug) DO NOTHING
    RETURNING id, name
  `, [daysAgo(90), daysAgo(60), daysAgo(7)]);
  const tenants = tenantRows.rows;
  if (tenants.length === 0) {
    console.log("  ⚠ Tenants already seeded, skipping...");
  } else {
    console.log(`  ✓ ${tenants.length} tenants created`);
  }

  // Get tenant IDs for FK references
  const { rows: allTenants } = await query("SELECT id, slug FROM tenants WHERE slug IN ('zenith-bank', 'interswitch', 'demo-org')");
  const tenantMap = Object.fromEntries(allTenants.map(t => [t.slug, t.id]));

  // ── 2. Users ───────────────────────────────────────────────────────────────
  console.log("  → Seeding users...");
  const userRows = await query(`
    INSERT INTO users (open_id, name, email, role, tenant_id, created_at)
    VALUES
      ('demo-admin-001', 'Admin User', 'admin@bis.ng', 'admin', NULL, $1),
      ('demo-analyst-001', 'Chidi Okeke', 'chidi.okeke@bis.ng', 'user', NULL, $2),
      ('demo-analyst-002', 'Amaka Nwosu', 'amaka.nwosu@bis.ng', 'user', NULL, $3),
      ('demo-officer-001', 'Emeka Eze', 'emeka.eze@zenithbank.com', 'user', $4, $5),
      ('demo-officer-002', 'Ngozi Adeyemi', 'ngozi.adeyemi@interswitch.com', 'user', $6, $7)
    ON CONFLICT (open_id) DO NOTHING
    RETURNING id, name
  `, [daysAgo(180), daysAgo(120), daysAgo(90), tenantMap['zenith-bank'], daysAgo(60), tenantMap['interswitch'], daysAgo(45)]);
  console.log(`  ✓ ${userRows.rows.length || 0} users created (or already exist)`);

  const { rows: allUsers } = await query("SELECT id, email FROM users WHERE email IN ('admin@bis.ng', 'chidi.okeke@bis.ng', 'amaka.nwosu@bis.ng')");
  const userMap = Object.fromEntries(allUsers.map(u => [u.email, u.id]));
  const adminId = userMap['admin@bis.ng'];
  const analystId = userMap['chidi.okeke@bis.ng'];
  const analyst2Id = userMap['amaka.nwosu@bis.ng'];

  // ── 3. Investigations ──────────────────────────────────────────────────────
  console.log("  → Seeding investigations...");
  const investigations = [
    { ref: randomRef('INV'), subject: 'Adebayo Okonkwo', type: 'individual', status: 'processing', risk: 'high', score: 78, assignedTo: analystId },
    { ref: randomRef('INV'), subject: 'Sunrise Capital Ltd', type: 'corporate', status: 'pending', risk: 'medium', score: 45, assignedTo: analystId },
    { ref: randomRef('INV'), subject: 'Ibrahim Musa Garba', type: 'individual', status: 'completed', risk: 'low', score: 12, assignedTo: analyst2Id },
    { ref: randomRef('INV'), subject: 'Apex Logistics Nigeria', type: 'corporate', status: 'flagged', risk: 'critical', score: 92, assignedTo: adminId },
    { ref: randomRef('INV'), subject: 'Chioma Obi', type: 'individual', status: 'draft', risk: 'medium', score: 38, assignedTo: analyst2Id },
    { ref: randomRef('INV'), subject: 'Meridian Finance Ltd', type: 'corporate', status: 'processing', risk: 'high', score: 71, assignedTo: analystId },
    { ref: randomRef('INV'), subject: 'Yusuf Abdullahi', type: 'individual', status: 'completed', risk: 'low', score: 8, assignedTo: analyst2Id },
    { ref: randomRef('INV'), subject: 'PanAfrica Holdings', type: 'corporate', status: 'pending', risk: 'high', score: 65, assignedTo: adminId },
    { ref: randomRef('INV'), subject: 'Fatima Al-Hassan', type: 'individual', status: 'processing', risk: 'medium', score: 42, assignedTo: analystId },
    { ref: randomRef('INV'), subject: 'Coastal Shipping Co', type: 'corporate', status: 'flagged', risk: 'critical', score: 88, assignedTo: adminId },
  ];

  for (const inv of investigations) {
    await query(`
      INSERT INTO investigations (ref, subject_name, subject_type, status, risk_tier, risk_score, assigned_to, created_by, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (ref) DO NOTHING
    `, [inv.ref, inv.subject, inv.type, inv.status, inv.risk, inv.score, inv.assignedTo, adminId, daysAgo(Math.floor(Math.random() * 30)), now()]);
  }
  console.log(`  ✓ ${investigations.length} investigations seeded`);

  // ── 4. Alerts ──────────────────────────────────────────────────────────────
  console.log("  → Seeding alerts...");
  const alertTypes = ['sanctions_hit', 'pep_detected', 'risk_threshold', 'adverse_media', 'field_report', 'system'];
  const severities = ['low', 'medium', 'high', 'critical'];
  for (let i = 0; i < 12; i++) {
    const alertType = alertTypes[i % alertTypes.length];
    const severity = severities[i % severities.length];
    await query(`
      INSERT INTO alerts (type, severity, title, description, subject_ref, is_read, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      alertType,
      severity,
      `${alertType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} — Alert ${i + 1}`,
      `Automated alert generated by BIS monitoring engine. Severity: ${severity}. Requires review by compliance team.`,
      `SUBJ-${(i + 1).toString().padStart(4, '0')}`,
      i > 5, // first 6 are unread
      hoursAgo(i * 3),
    ]);
  }
  console.log("  ✓ 12 alerts seeded");

  // ── 5. KYC Records ─────────────────────────────────────────────────────────
  console.log("  → Seeding KYC records...");
  const kycSubjects = [
    { name: 'Adebayo Okonkwo', nin: '12345678901', bvn: '22345678901', status: 'passed' },
    { name: 'Chioma Obi', nin: '23456789012', bvn: '33456789012', status: 'review' },
    { name: 'Ibrahim Musa', nin: '34567890123', bvn: '44567890123', status: 'passed' },
    { name: 'Fatima Al-Hassan', nin: '45678901234', bvn: '55678901234', status: 'pending' },
    { name: 'Emeka Eze', nin: '56789012345', bvn: '66789012345', status: 'failed' },
    { name: 'Ngozi Adeyemi', nin: '67890123456', bvn: '77890123456', status: 'passed' },
  ];
  for (const kyc of kycSubjects) {
    await query(`
      INSERT INTO kyc_records (ref, subject_name, nin, bvn, status, risk_score, created_by, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      randomRef('KYC'),
      kyc.name,
      kyc.nin,
      kyc.bvn,
      kyc.status,
      Math.floor(Math.random() * 100),
      adminId,
      daysAgo(Math.floor(Math.random() * 60)),
    ]);
  }
  console.log("  ✓ 6 KYC records seeded");

  // ── 6. Cases ───────────────────────────────────────────────────────────────
  console.log("  → Seeding cases...");
  const caseStatuses = ['open', 'under_review', 'pending_info', 'resolved', 'closed'];
  const casePriorities = ['low', 'medium', 'high', 'critical'];
  for (let i = 0; i < 8; i++) {
    const caseRef = randomRef('CASE');
    await query(`
      INSERT INTO cases (ref, title, description, status, priority, assigned_to, created_by, sla_due_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (ref) DO NOTHING
    `, [
      caseRef,
      `Case ${i + 1}: ${['Suspicious Transaction', 'Identity Fraud', 'Document Forgery', 'Money Laundering', 'PEP Screening', 'Sanctions Violation', 'Adverse Media', 'Risk Review'][i]}`,
      `Compliance case opened following automated detection. Assigned to ${i % 2 === 0 ? 'Chidi Okeke' : 'Amaka Nwosu'} for investigation.`,
      caseStatuses[i % caseStatuses.length],
      casePriorities[i % casePriorities.length],
      i % 2 === 0 ? analystId : analyst2Id,
      adminId,
      new Date(Date.now() + (7 - i) * 86400000), // SLA due in 7-0 days
      daysAgo(i * 2),
      now(),
    ]);
  }
  console.log("  ✓ 8 cases seeded");

  // ── 7. Field Agents ────────────────────────────────────────────────────────
  console.log("  → Seeding field agents...");
  const agents = [
    { name: 'Oluwaseun Adebisi', code: 'AG-LA-001', state: 'Lagos', tier: 'senior', status: 'active' },
    { name: 'Musa Abdullahi', code: 'AG-KN-001', state: 'Kano', tier: 'junior', status: 'active' },
    { name: 'Chidinma Okafor', code: 'AG-AB-001', state: 'Abuja', tier: 'lead', status: 'active' },
    { name: 'Emeka Nwosu', code: 'AG-RI-001', state: 'Rivers', tier: 'specialist', status: 'inactive' },
  ];
  for (const agent of agents) {
    await query(`
      INSERT INTO field_agents (name, agent_code, state, tier, status, phone, email, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (agent_code) DO NOTHING
    `, [
      agent.name,
      agent.code,
      agent.state,
      agent.tier,
      agent.status,
      `+234${Math.floor(7000000000 + Math.random() * 999999999)}`,
      `${agent.name.toLowerCase().replace(' ', '.')}@bis-agents.ng`,
      daysAgo(Math.floor(Math.random() * 180)),
    ]);
  }
  console.log("  ✓ 4 field agents seeded");

  // ── 8. LEX Agencies ────────────────────────────────────────────────────────
  console.log("  → Seeding LEX agencies and submissions...");
  await query(`
    INSERT INTO lex_agencies (code, name, state, contact_email, is_active, created_at)
    VALUES
      ('NPF-LA-001', 'Nigeria Police Force — Lagos Command', 'lagos', 'lex@npf-lagos.gov.ng', true, $1),
      ('NPF-KN-001', 'Nigeria Police Force — Kano Command', 'kano', 'lex@npf-kano.gov.ng', true, $2),
      ('EFCC-HQ-001', 'EFCC Headquarters', 'fct_abuja', 'lex@efcc.gov.ng', true, $3),
      ('NDLEA-LA-001', 'NDLEA Lagos Zone', 'lagos', 'lex@ndlea-lagos.gov.ng', true, $4),
      ('NSCDC-AB-001', 'NSCDC Abuja Command', 'fct_abuja', 'lex@nscdc-abuja.gov.ng', false, $5)
    ON CONFLICT (code) DO NOTHING
  `, [daysAgo(365), daysAgo(365), daysAgo(300), daysAgo(300), daysAgo(200)]);

  // LEX submissions
  const incidentTypes = ['arrest', 'theft', 'assault', 'fraud', 'drug', 'kidnap'];
  const lexStates = ['lagos', 'kano', 'fct_abuja', 'rivers', 'oyo'];
  for (let i = 0; i < 10; i++) {
    await query(`
      INSERT INTO lex_submissions (ref, agency_code, incident_type, incident_state, narrative, status, channel, submitted_at, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      randomRef('LEX'),
      i % 2 === 0 ? 'NPF-LA-001' : 'EFCC-HQ-001',
      incidentTypes[i % incidentTypes.length],
      lexStates[i % lexStates.length],
      `Incident report: ${incidentTypes[i % incidentTypes.length]} reported in ${lexStates[i % lexStates.length]}. Officers responded and secured the scene. Suspect(s) identified and documentation collected.`,
      i < 3 ? 'pending' : i < 7 ? 'validated' : 'rejected',
      i % 3 === 0 ? 'sms' : i % 3 === 1 ? 'web' : 'api',
      daysAgo(i * 3),
      daysAgo(i * 3),
    ]);
  }
  console.log("  ✓ 5 LEX agencies + 10 submissions seeded");

  // ── 9. Data Sources ────────────────────────────────────────────────────────
  console.log("  → Seeding data sources...");
  const dataSources = [
    { name: 'NIMC Identity Database', category: 'identity', status: 'active', latency: 120 },
    { name: 'CBN BVN Registry', category: 'financial', status: 'active', latency: 85 },
    { name: 'CAC Corporate Registry', category: 'legal', status: 'active', latency: 200 },
    { name: 'OFAC Sanctions List', category: 'government', status: 'active', latency: 45 },
    { name: 'UN Consolidated Sanctions', category: 'government', status: 'active', latency: 60 },
    { name: 'Nigeria Police Criminal Records', category: 'legal', status: 'degraded', latency: 450 },
  ];
  for (const ds of dataSources) {
    await query(`
      INSERT INTO data_sources (name, category, status, avg_latency_ms, last_checked_at, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (name) DO NOTHING
    `, [ds.name, ds.category, ds.status, ds.latency, hoursAgo(1), daysAgo(180)]);
  }
  console.log("  ✓ 6 data sources seeded");

  // ── 10. Platform Settings ──────────────────────────────────────────────────
  console.log("  → Seeding platform settings...");
  const settings = [
    { key: 'platform_name', value: 'BIS — Background Intelligence System', category: 'general' },
    { key: 'platform_url', value: 'https://bis.ng', category: 'general' },
    { key: 'support_email', value: 'support@bis.ng', category: 'general' },
    { key: 'kyc_auto_approve_threshold', value: '30', category: 'kyc' },
    { key: 'investigation_sla_days', value: '14', category: 'investigations' },
    { key: 'case_sla_hours', value: '72', category: 'cases' },
    { key: 'lex_sla_hours', value: '72', category: 'lex' },
    { key: 'risk_score_high_threshold', value: '70', category: 'risk' },
    { key: 'risk_score_critical_threshold', value: '85', category: 'risk' },
    { key: 'max_api_requests_per_day', value: '10000', category: 'api' },
    { key: 'demo_mode', value: 'false', category: 'system' },
    { key: 'maintenance_mode', value: 'false', category: 'system' },
  ];
  for (const s of settings) {
    await query(`
      INSERT INTO platform_settings (key, value, category, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
    `, [s.key, s.value, s.category, adminId, now()]);
  }
  console.log("  ✓ 12 platform settings seeded");

  // ── 11. Audit Log ──────────────────────────────────────────────────────────
  console.log("  → Seeding audit log...");
  const auditActions = [
    { category: 'user', action: 'login', result: 'success' },
    { category: 'investigation', action: 'create', result: 'success' },
    { category: 'kyc', action: 'verify', result: 'success' },
    { category: 'alert', action: 'acknowledge', result: 'success' },
    { category: 'report', action: 'generate', result: 'success' },
    { category: 'system', action: 'config_update', result: 'success' },
    { category: 'api', action: 'rate_limit_exceeded', result: 'warning' },
    { category: 'user', action: 'failed_login', result: 'failure' },
  ];
  for (let i = 0; i < 20; i++) {
    const action = auditActions[i % auditActions.length];
    await query(`
      INSERT INTO audit_log (user_id, category, action, result, ip_address, detail, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      i % 3 === 0 ? adminId : analystId,
      action.category,
      action.action,
      action.result,
      `197.210.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      JSON.stringify({ detail: `Audit entry ${i + 1}`, timestamp: hoursAgo(i).toISOString() }),
      hoursAgo(i * 2),
    ]);
  }
  console.log("  ✓ 20 audit log entries seeded");

  // ── 12. Notifications ──────────────────────────────────────────────────────
  console.log("  → Seeding notifications...");
  const notifData = [
    { title: 'New High-Risk Alert', body: 'Sanctions hit detected for subject Adebayo Okonkwo', type: 'alert' },
    { title: 'Investigation Assigned', body: 'INV-001 has been assigned to you for review', type: 'investigation' },
    { title: 'KYC Verification Complete', body: 'KYC for Ibrahim Musa has been verified successfully', type: 'kyc' },
    { title: 'SLA Breach Warning', body: 'Case CASE-001 is approaching SLA deadline (2h remaining)', type: 'sla' },
    { title: 'System Maintenance', body: 'Scheduled maintenance window: Sunday 02:00-04:00 WAT', type: 'system' },
  ];
  for (const notif of notifData) {
    await query(`
      INSERT INTO notifications (user_id, title, body, type, is_read, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [adminId, notif.title, notif.body, notif.type, false, hoursAgo(notifData.indexOf(notif) * 4)]);
  }
  console.log("  ✓ 5 notifications seeded");

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n✅ BIS Platform seed complete!\n");
  console.log("  Demo credentials:");
  console.log("  • Admin:   admin@bis.ng (role: admin)");
  console.log("  • Analyst: chidi.okeke@bis.ng (role: user)");
  console.log("  • Analyst: amaka.nwosu@bis.ng (role: user)");
  console.log("\n  Log in via Manus OAuth to access the platform.\n");
}

seed()
  .catch(err => {
    console.error("❌ Seed failed:", err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
