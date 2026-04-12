#!/usr/bin/env node
// seed-db.mjs — BIS Platform Demo Data Seeder (PostgreSQL)
// Usage: node scripts/seed-db.mjs
// Or:    pnpm db:seed
//
// Seeds the database with realistic demo data for:
//   - Tenants (3 organisations)
//   - Users (admin + 4 staff)
//   - Investigations (10 with notes, timeline, risk scores)
//   - Cases (8 with parties, comments)
//   - Alerts (12 across types)
//   - KYC records (6)
//   - LEX agencies, submitters, submissions (8)
//   - Field agents (4)
//   - Notifications (5)
//   - Audit log entries (10)

import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

// ── Connection ────────────────────────────────────────────────────────────────
// Always seed against local PostgreSQL (the platform's actual DB)
const DATABASE_URL =
  process.env.DATABASE_URL?.startsWith("mysql")
    ? "postgresql://bis_user:bis_secure_2026@localhost:5432/bis_db"
    : (process.env.DATABASE_URL ?? "postgresql://bis_user:bis_secure_2026@localhost:5432/bis_db");

const pool = new Pool({ connectionString: DATABASE_URL });

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const now = () => new Date();
const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const hoursAgo = (n) => new Date(Date.now() - n * 3600000);
const daysFromNow = (n) => new Date(Date.now() + n * 86400000);

function randomRef(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

// ── Main Seeder ───────────────────────────────────────────────────────────────
async function seed() {
  console.log("🌱 BIS Platform — Starting database seed...\n");

  // ── 1. Tenants ─────────────────────────────────────────────────────────────
  console.log("  → Seeding tenants...");
  await query(`
    INSERT INTO tenants (name, slug, plan, status, "contactEmail", "monthlyQuota", "createdAt", "updatedAt")
    VALUES
      ('Zenith Bank Plc', 'zenith-bank', 'enterprise', 'active', 'compliance@zenithbank.com', 10000, $1, $2),
      ('Interswitch Group', 'interswitch', 'professional', 'active', 'kyc@interswitch.com', 5000, $3, $4),
      ('Demo Organisation', 'demo-org', 'starter', 'trial', 'admin@demo.bis.ng', 1000, $5, $6)
    ON CONFLICT (slug) DO NOTHING
  `, [daysAgo(90), now(), daysAgo(60), now(), daysAgo(7), now()]);

  const tenants = await query("SELECT id, slug FROM tenants WHERE slug IN ('zenith-bank', 'interswitch', 'demo-org')");
  const tenantMap = Object.fromEntries(tenants.map(t => [t.slug, t.id]));
  console.log(`  ✓ Tenants ready (${Object.keys(tenantMap).length} found/created)`);

  // ── 2. Users ───────────────────────────────────────────────────────────────
  console.log("  → Seeding users...");
  await query(`
    INSERT INTO users ("openId", name, email, role, "createdAt", "updatedAt", "lastSignedIn")
    VALUES
      ('demo-admin-001', 'Admin User', 'admin@bis.ng', 'admin', $1, $2, $3),
      ('demo-analyst-001', 'Chidi Okeke', 'chidi.okeke@bis.ng', 'analyst', $4, $5, $6),
      ('demo-analyst-002', 'Amaka Nwosu', 'amaka.nwosu@bis.ng', 'analyst', $7, $8, $9),
      ('demo-supervisor-001', 'Babatunde Adeyemi', 'bade.adeyemi@bis.ng', 'supervisor', $10, $11, $12),
      ('demo-auditor-001', 'Ngozi Eze', 'ngozi.eze@bis.ng', 'auditor', $13, $14, $15)
    ON CONFLICT ("openId") DO NOTHING
  `, [
    daysAgo(180), now(), daysAgo(1),
    daysAgo(120), now(), daysAgo(2),
    daysAgo(90), now(), daysAgo(3),
    daysAgo(60), now(), daysAgo(1),
    daysAgo(45), now(), daysAgo(5),
  ]);

  const users = await query("SELECT id, email FROM users WHERE email IN ('admin@bis.ng', 'chidi.okeke@bis.ng', 'amaka.nwosu@bis.ng', 'bade.adeyemi@bis.ng', 'ngozi.eze@bis.ng')");
  const userMap = Object.fromEntries(users.map(u => [u.email, u.id]));
  const adminId = userMap['admin@bis.ng'];
  const analystId = userMap['chidi.okeke@bis.ng'];
  const analyst2Id = userMap['amaka.nwosu@bis.ng'];
  console.log(`  ✓ Users ready (${Object.keys(userMap).length} found/created)`);

  // ── 3. Investigations ──────────────────────────────────────────────────────
  console.log("  → Seeding investigations...");
  const investigations = [
    { subject: 'Adebayo Okonkwo', type: 'individual', status: 'processing', risk: 'high', score: 78, assignedTo: analystId },
    { subject: 'Sunrise Capital Ltd', type: 'corporate', status: 'pending', risk: 'medium', score: 45, assignedTo: analystId },
    { subject: 'Ibrahim Musa Garba', type: 'individual', status: 'completed', risk: 'low', score: 12, assignedTo: analyst2Id },
    { subject: 'Apex Logistics Nigeria', type: 'corporate', status: 'flagged', risk: 'critical', score: 92, assignedTo: adminId },
    { subject: 'Chioma Obi', type: 'individual', status: 'draft', risk: 'medium', score: 38, assignedTo: analyst2Id },
    { subject: 'Meridian Finance Ltd', type: 'corporate', status: 'processing', risk: 'high', score: 71, assignedTo: analystId },
    { subject: 'Yusuf Abdullahi', type: 'individual', status: 'completed', risk: 'low', score: 8, assignedTo: analyst2Id },
    { subject: 'PanAfrica Holdings', type: 'corporate', status: 'pending', risk: 'high', score: 65, assignedTo: adminId },
    { subject: 'Fatima Al-Hassan', type: 'individual', status: 'processing', risk: 'medium', score: 42, assignedTo: analystId },
    { subject: 'Coastal Shipping Co', type: 'corporate', status: 'flagged', risk: 'critical', score: 88, assignedTo: adminId },
  ];

  for (const inv of investigations) {
    const ref = randomRef('INV');
    const createdAt = daysAgo(Math.floor(Math.random() * 30) + 1);
    await query(`
      INSERT INTO investigations (ref, "subjectName", "subjectType", status, "riskTier", "riskScore", "assignedTo", "createdBy", "createdAt", "updatedAt", country)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'NG')
      ON CONFLICT (ref) DO NOTHING
    `, [ref, inv.subject, inv.type, inv.status, inv.risk, inv.score, inv.assignedTo, adminId, createdAt, now()]);
  }
  console.log(`  ✓ ${investigations.length} investigations seeded`);

  const invRows = await query("SELECT id FROM investigations ORDER BY \"createdAt\" DESC LIMIT 10");
  const invIds = invRows.map(r => r.id);

  // ── 4. Alerts ──────────────────────────────────────────────────────────────
  console.log("  → Seeding alerts...");
  const alertTypes = ['sanctions_hit', 'pep_detected', 'risk_threshold', 'adverse_media', 'field_report', 'system'];
  const severities = ['low', 'medium', 'high', 'critical'];
  for (let i = 0; i < 12; i++) {
    const alertType = alertTypes[i % alertTypes.length];
    const severity = severities[i % severities.length];
    const invId = invIds[i % invIds.length] || null;
    await query(`
      INSERT INTO alerts ("investigationId", type, severity, title, body, "subjectRef", read, acknowledged, resolved, dismissed, "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      invId, alertType, severity,
      `${alertType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} — Alert ${i + 1}`,
      `Automated alert generated by BIS monitoring engine. Severity: ${severity}. Requires review by compliance team.`,
      `SUBJ-${(i + 1).toString().padStart(4, '0')}`,
      i > 5, false, false, false,
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
    const invId = invIds[Math.floor(Math.random() * invIds.length)] || null;
    await query(`
      INSERT INTO kyc_records ("investigationId", "subjectName", nin, bvn, status, "riskScore", "createdBy", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      invId, kyc.name, kyc.nin, kyc.bvn, kyc.status,
      Math.floor(Math.random() * 100), adminId,
      daysAgo(Math.floor(Math.random() * 60) + 1), now(),
    ]);
  }
  console.log("  ✓ 6 KYC records seeded");

  // ── 6. Cases ───────────────────────────────────────────────────────────────
  console.log("  → Seeding cases...");
  const caseStatuses = ['draft', 'open', 'under_review', 'pending_decision', 'closed'];
  const casePriorities = ['low', 'medium', 'high', 'critical'];
  const caseTypes = ['fraud', 'aml', 'kyc_failure', 'sanctions', 'corruption', 'cyber', 'regulatory', 'other'];
  const caseTitles = [
    'Suspicious Transaction Pattern — Adebayo Okonkwo',
    'Identity Fraud — Sunrise Capital Ltd',
    'Document Forgery — Ibrahim Musa Garba',
    'Money Laundering — Apex Logistics Nigeria',
    'PEP Screening — Chioma Obi',
    'Sanctions Violation — Meridian Finance Ltd',
    'Adverse Media — PanAfrica Holdings',
    'Risk Review — Coastal Shipping Co',
  ];
  const caseIds = [];
  for (let i = 0; i < 8; i++) {
    const caseRef = randomRef('CASE');
    const createdAt = daysAgo(i * 2 + 1);
    const rows = await query(`
      INSERT INTO cases (ref, title, type, status, priority, summary, "leadAnalystId", "createdBy", "dueAt", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (ref) DO NOTHING
      RETURNING id
    `, [
      caseRef, caseTitles[i], caseTypes[i],
      caseStatuses[i % caseStatuses.length],
      casePriorities[i % casePriorities.length],
      'Compliance case opened following automated detection. Assigned for investigation and review.',
      i % 2 === 0 ? analystId : analyst2Id,
      adminId, daysFromNow(7 - i), createdAt, now(),
    ]);
    if (rows[0]) caseIds.push(rows[0].id);
  }
  console.log(`  ✓ ${caseIds.length} cases seeded`);

  // ── 7. Case Parties ────────────────────────────────────────────────────────
  console.log("  → Seeding case parties...");
  const partyNames = ['Adebayo Okonkwo', 'Sunrise Capital Ltd', 'Ibrahim Musa', 'Apex Logistics', 'Chioma Obi'];
  for (let i = 0; i < Math.min(caseIds.length, 5); i++) {
    await query(`
      INSERT INTO case_parties ("caseId", role, name, "entityType", "addedBy", "createdAt")
      VALUES ($1, 'subject', $2, $3, $4, $5)
    `, [caseIds[i], partyNames[i], i % 2 === 0 ? 'individual' : 'corporate', adminId, daysAgo(i + 1)]);
  }
  console.log("  ✓ 5 case parties seeded");

  // ── 8. Case Comments ───────────────────────────────────────────────────────
  console.log("  → Seeding case comments...");
  const comments = [
    'Initial review completed. Subject has multiple flagged transactions in the past 30 days.',
    'KYC documents received and verified. Proceeding to enhanced due diligence.',
    'Escalated to compliance committee for final decision. Risk score: HIGH.',
    'Field agent dispatched to verify address. Report expected within 48 hours.',
    'Sanctions screening completed — no direct hits. Monitoring for indirect exposure.',
  ];
  for (let i = 0; i < Math.min(caseIds.length, 5); i++) {
    await query(`
      INSERT INTO case_comments ("caseId", content, "authorId", "authorName", "authorRole", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, 'analyst', $5, $6)
    `, [caseIds[i], comments[i],
        i % 2 === 0 ? analystId : analyst2Id,
        i % 2 === 0 ? 'Chidi Okeke' : 'Amaka Nwosu',
        daysAgo(i), now()]);
  }
  console.log("  ✓ 5 case comments seeded");

  // ── 9. Field Agents ────────────────────────────────────────────────────────
  console.log("  → Seeding field agents...");
  const agents = [
    { name: 'Oluwaseun Adebisi', code: 'AG-LA-001', state: 'LA', tier: 'senior', status: 'active', email: 'o.adebisi@bis-agents.ng' },
    { name: 'Musa Abdullahi', code: 'AG-KN-001', state: 'KN', tier: 'junior', status: 'active', email: 'm.abdullahi@bis-agents.ng' },
    { name: 'Chidinma Okafor', code: 'AG-FC-001', state: 'FC', tier: 'lead', status: 'active', email: 'c.okafor@bis-agents.ng' },
    { name: 'Emeka Nwosu', code: 'AG-RI-001', state: 'RI', tier: 'specialist', status: 'inactive', email: 'e.nwosu@bis-agents.ng' },
  ];
  for (const agent of agents) {
    await query(`
      INSERT INTO field_agents ("agentCode", name, email, phone, state, tier, status, "createdBy", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT ("agentCode") DO NOTHING
    `, [
      agent.code, agent.name, agent.email,
      `+2347${Math.floor(10000000 + Math.random() * 89999999)}`,
      agent.state, agent.tier, agent.status,
      adminId, daysAgo(Math.floor(Math.random() * 180) + 1), now(),
    ]);
  }
  console.log("  ✓ 4 field agents seeded");

  // ── 10. LEX Agencies ───────────────────────────────────────────────────────
  console.log("  → Seeding LEX agencies...");
  const lexAgencies = [
    { code: 'NPF-LA-001', name: 'Nigeria Police Force — Lagos Command', type: 'npf', state: 'LA', email: 'lex@npf-lagos.gov.ng' },
    { code: 'NPF-KN-001', name: 'Nigeria Police Force — Kano Command', type: 'npf', state: 'KN', email: 'lex@npf-kano.gov.ng' },
    { code: 'EFCC-HQ-001', name: 'EFCC Headquarters', type: 'efcc', state: 'FC', email: 'lex@efcc.gov.ng' },
    { code: 'NDLEA-LA-001', name: 'NDLEA Lagos Zone', type: 'other', state: 'LA', email: 'lex@ndlea-lagos.gov.ng' },
    { code: 'NSCDC-AB-001', name: 'NSCDC Abuja Command', type: 'nscdc', state: 'FC', email: 'lex@nscdc-abuja.gov.ng' },
  ];
  for (const agency of lexAgencies) {
    await query(`
      INSERT INTO lex_agencies ("agencyCode", name, type, state, "contactEmail", status, "registeredAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, 'active', $6, $7)
      ON CONFLICT ("agencyCode") DO NOTHING
    `, [agency.code, agency.name, agency.type, agency.state, agency.email, daysAgo(365), now()]);
  }

  const agencyRows = await query("SELECT id, \"agencyCode\" FROM lex_agencies WHERE \"agencyCode\" IN ('NPF-LA-001', 'EFCC-HQ-001', 'NPF-KN-001')");
  const agencyMap = Object.fromEntries(agencyRows.map(a => [a.agencyCode, a.id]));
  console.log(`  ✓ ${lexAgencies.length} LEX agencies seeded`);

  // ── 11. LEX Submitters ─────────────────────────────────────────────────────
  console.log("  → Seeding LEX submitters...");
  const submitters = [
    { id: 'SUBM-NPF-LA-001', agencyCode: 'NPF-LA-001', name: 'Sgt. Kunle Adeyemi', rank: 'Sergeant', phone: '+2348012345678' },
    { id: 'SUBM-EFCC-001', agencyCode: 'EFCC-HQ-001', name: 'Det. Amara Okafor', rank: 'Detective', phone: '+2348023456789' },
    { id: 'SUBM-NPF-KN-001', agencyCode: 'NPF-KN-001', name: 'Cpl. Musa Yusuf', rank: 'Corporal', phone: '+2348034567890' },
  ];
  for (const sub of submitters) {
    const agencyId = agencyMap[sub.agencyCode];
    if (!agencyId) continue;
    await query(`
      INSERT INTO lex_submitters ("submitterId", "agencyId", name, rank, phone, "pinHash", status, "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)
      ON CONFLICT ("submitterId") DO NOTHING
    `, [sub.id, agencyId, sub.name, sub.rank, sub.phone, '$2b$10$demo.hash.for.seed.data.only', daysAgo(180)]);
  }
  console.log("  ✓ 3 LEX submitters seeded");

  // ── 12. LEX Submissions ────────────────────────────────────────────────────
  console.log("  → Seeding LEX submissions...");
  const incidentTypes = ['arrest', 'seizure', 'fraud', 'cybercrime', 'intel_tip'];
  const submissionStatuses = ['pending', 'under_review', 'validated', 'rejected'];
  const submitterRows = await query("SELECT id FROM lex_submitters LIMIT 3");
  const submitterIds = submitterRows.map(r => r.id);
  const agencyIds = Object.values(agencyMap);

  for (let i = 0; i < 8; i++) {
    const agencyId = agencyIds[i % Math.max(agencyIds.length, 1)];
    const submitterId = submitterIds[i % Math.max(submitterIds.length, 1)] || null;
    const ref = randomRef('LEX');
    await query(`
      INSERT INTO lex_submissions ("submissionRef", "agencyId", "submitterId", channel, "incidentType", "incidentState", "incidentLga", narrative, status, "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT ("submissionRef") DO NOTHING
    `, [
      ref, agencyId, submitterId,
      i % 3 === 0 ? 'sms' : 'web',
      incidentTypes[i % incidentTypes.length],
      ['LA', 'KN', 'FC', 'RI', 'AN'][i % 5],
      ['Ikeja', 'Kano Municipal', 'Garki', 'Port Harcourt', 'Onitsha'][i % 5],
      `Incident report ${i + 1}: Subject was apprehended in connection with suspected financial crime activities. Full report attached. Officer badge number: ${1000 + i}.`,
      submissionStatuses[i % submissionStatuses.length],
      daysAgo(i * 3 + 1), now(),
    ]);
  }
  console.log("  ✓ 8 LEX submissions seeded");

  // ── 13. Notifications ──────────────────────────────────────────────────────
  console.log("  → Seeding notifications...");
  const notifData = [
    { title: 'New High-Risk Alert', body: 'Apex Logistics Nigeria has been flagged as critical risk. Immediate review required.', type: 'alert' },
    { title: 'Investigation Completed', body: 'Investigation for Ibrahim Musa Garba has been completed with low risk rating.', type: 'system' },
    { title: 'LEX Submission Received', body: 'New LEX submission from NPF Lagos Command awaiting review.', type: 'lex' },
    { title: 'SLA Breach Warning', body: 'A case is approaching SLA deadline. Action required within 24 hours.', type: 'sla' },
    { title: 'Field Agent Report', body: 'Agent Oluwaseun Adebisi has submitted field verification report.', type: 'field' },
  ];
  for (const notif of notifData) {
    await query(`
      INSERT INTO notifications ("userId", title, body, type, read, "createdAt")
      VALUES ($1, $2, $3, $4, false, $5)
    `, [adminId, notif.title, notif.body, notif.type, daysAgo(Math.floor(Math.random() * 7))]);
  }
  console.log("  ✓ 5 notifications seeded");

  // ── 14. Audit Log ──────────────────────────────────────────────────────────
  console.log("  → Seeding audit log entries...");
  const auditActions = [
    { action: 'investigation.create', category: 'investigation', result: 'success', detail: 'Created investigation for Adebayo Okonkwo' },
    { action: 'investigation.update', category: 'investigation', result: 'success', detail: 'Updated risk score to HIGH' },
    { action: 'kyc.verify', category: 'kyc', result: 'success', detail: 'KYC verification completed for Ibrahim Musa' },
    { action: 'alert.acknowledge', category: 'alert', result: 'success', detail: 'Acknowledged sanctions hit alert' },
    { action: 'user.login', category: 'user', result: 'success', detail: 'User logged in from 41.58.x.x' },
    { action: 'report.generate', category: 'report', result: 'success', detail: 'Generated PDF report for Apex Logistics' },
    { action: 'api.call', category: 'api', result: 'success', detail: 'External API call to SmileID verification' },
    { action: 'investigation.delete', category: 'investigation', result: 'warning', detail: 'Attempted to delete active investigation — blocked' },
    { action: 'user.role_change', category: 'user', result: 'success', detail: 'User role updated from user to analyst' },
    { action: 'system.backup', category: 'system', result: 'success', detail: 'Automated database backup completed' },
  ];
  const userIds = Object.values(userMap);
  for (let i = 0; i < auditActions.length; i++) {
    const entry = auditActions[i];
    const userId = userIds[i % userIds.length];
    await query(`
      INSERT INTO audit_log ("userId", action, category, result, detail, "ipAddress", "createdAt")
      VALUES ($1, $2, $3, $4, $5::json, $6, $7)
    `, [userId, entry.action, entry.category, entry.result, JSON.stringify({ message: entry.detail }), `41.58.${i}.${i * 3}`, daysAgo(i)]);
  }
  console.log("  ✓ 10 audit log entries seeded");

  // ── Done ───────────────────────────────────────────────────────────────────
  await pool.end();

  console.log("\n✅ BIS Platform seed completed successfully!");
  console.log("\n📊 Summary:");
  console.log("   3 tenants (Zenith Bank, Interswitch, Demo Org)");
  console.log("   5 users (admin, 2 analysts, supervisor, auditor)");
  console.log("   10 investigations (various risk levels)");
  console.log("   12 alerts (across all severity levels)");
  console.log("   6 KYC records");
  console.log("   8 cases (with parties and comments)");
  console.log("   4 field agents");
  console.log("   5 LEX agencies + 3 submitters + 8 submissions");
  console.log("   5 notifications");
  console.log("   10 audit log entries");
  console.log("\n🔑 Login: admin@bis.ng (admin role)");
  console.log("   Or use Manus OAuth to authenticate\n");
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err.message);
  pool?.end().catch(() => {});
  process.exit(1);
});
