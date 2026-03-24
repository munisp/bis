/**
 * BIS Platform — Comprehensive Database Seed Script
 * ===================================================
 * Populates all 16 tables with realistic Nigerian/African intelligence platform data.
 * Run: node seed-db.mjs
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const { Pool } = pg;

// Load DATABASE_URL from the running server's environment via dotenv-style approach
// The dev server has it injected, so we read it from the process or from a temp file
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('❌  DATABASE_URL not set. Run: DATABASE_URL=<url> node seed-db.mjs');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DB_URL,
  ssl: DB_URL.includes('localhost') || DB_URL.includes('127.0.0.1')
    ? false
    : { rejectUnauthorized: false },
});

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min, max, dp = 1) { return parseFloat((Math.random() * (max - min) + min).toFixed(dp)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickN(arr, n) { return [...arr].sort(() => 0.5 - Math.random()).slice(0, n); }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function ref(prefix, n) { return `${prefix}-${String(n).padStart(4, '0')}`; }

// ─── Seed Data ────────────────────────────────────────────────────────────────

const NIGERIAN_NAMES = [
  'Emeka Okafor', 'Chidi Nwosu', 'Amaka Eze', 'Tunde Adeyemi', 'Ngozi Okonkwo',
  'Bola Adesanya', 'Kemi Adebayo', 'Seun Afolabi', 'Femi Ogundimu', 'Yemi Alade',
  'Obinna Chukwu', 'Chioma Obi', 'Uche Nwachukwu', 'Ade Bankole', 'Sola Oduya',
  'Gbenga Fashola', 'Toyin Lawson', 'Remi Tinubu', 'Dayo Okonkwo', 'Nkem Owoh',
  'Akin Osuntokun', 'Lola Shoneyin', 'Wale Adebanwi', 'Zainab Usman', 'Musa Bello',
  'Ibrahim Musa', 'Fatima Aliyu', 'Halima Dangote', 'Aliko Dangote Jr', 'Tony Elumelu',
];

const CORP_NAMES = [
  'Zenith Capital Partners Ltd', 'First Continental Finance Corp', 'Lagos Merchant Bank Plc',
  'Abuja Investment Holdings', 'Niger Delta Resources Ltd', 'Pan-African Trade Corp',
  'Kano Industrial Group', 'Eko Atlantic Ventures', 'Oando Energy Services',
  'Dangote Cement Distribution', 'MTN Business Solutions', 'Access Fintech Ltd',
  'Sterling Asset Management', 'Coronation Capital Ltd', 'Stanbic IBTC Nominees',
];

const NIGERIAN_STATES = [
  'Lagos', 'Abuja', 'Kano', 'Rivers', 'Ogun', 'Oyo', 'Kaduna', 'Enugu', 'Anambra', 'Delta'
];

const NIGERIAN_LGAS = [
  'Ikeja', 'Surulere', 'Eti-Osa', 'Apapa', 'Mushin', 'Gwagwalada', 'Bwari',
  'Nassarawa', 'Kano Municipal', 'Port Harcourt', 'Obio-Akpor', 'Enugu North'
];

const PURPOSES = [
  'Pre-employment background check for senior management position',
  'KYC verification for high-value account opening',
  'Due diligence for merger and acquisition transaction',
  'Regulatory compliance screening for financial services',
  'Vendor onboarding verification for government contract',
  'Anti-money laundering investigation triggered by transaction pattern',
  'PEP screening for board member appointment',
  'Adverse media check for loan application',
  'Sanctions compliance check for cross-border payment',
  'Beneficial ownership verification for real estate transaction',
];

const ALERT_TITLES = [
  'OFAC SDN List Match Detected',
  'PEP Status Confirmed — Senior Government Official',
  'Adverse Media: Fraud Allegations in Nigerian Tribune',
  'Risk Score Threshold Exceeded (Score: 87)',
  'Velocity Alert: 12 Transactions in 24 Hours',
  'UN Consolidated Sanctions List Hit',
  'EU Sanctions Regulation Match',
  'Biometric Duplicate Identity Detected',
  'Field Report: Subject Not Found at Registered Address',
  'Social Media: Derogatory Content Detected',
  'BVN Mismatch — Identity Inconsistency',
  'NIN Verification Failed — Document Tampering Suspected',
  'Corporate Registry: Dissolved Entity Status',
  'Interpol Red Notice Cross-Reference',
  'CBN Regulatory Watchlist Match',
];

const DATA_SOURCES = [
  { code: 'NG_NIN', name: 'NIMC National Identity Database', category: 'identity', provider: 'NIMC', recordCount: 98000000 },
  { code: 'NG_BVN', name: 'CBN Bank Verification Number System', category: 'financial', provider: 'NIBSS', recordCount: 55000000 },
  { code: 'NG_CAC', name: 'CAC Corporate Affairs Registry', category: 'legal', provider: 'CAC', recordCount: 3200000 },
  { code: 'NG_EFCC', name: 'EFCC Watchlist Database', category: 'legal', provider: 'EFCC', recordCount: 45000 },
  { code: 'OFAC_SDN', name: 'OFAC Specially Designated Nationals', category: 'government', provider: 'US Treasury', recordCount: 12000 },
  { code: 'UN_SANCTIONS', name: 'UN Consolidated Sanctions List', category: 'government', provider: 'United Nations', recordCount: 8500 },
  { code: 'EU_SANCTIONS', name: 'EU Consolidated Sanctions', category: 'government', provider: 'European Union', recordCount: 9200 },
  { code: 'PEP_GLOBAL', name: 'Global PEP Database', category: 'government', provider: 'Dow Jones', recordCount: 1400000 },
  { code: 'ADVERSE_MEDIA', name: 'Adverse Media Intelligence Feed', category: 'social', provider: 'LexisNexis', recordCount: 500000 },
  { code: 'NG_CREDIT', name: 'CRC Credit Bureau Nigeria', category: 'financial', provider: 'CRC', recordCount: 22000000 },
  { code: 'NG_DRIVERS', name: 'FRSC Drivers License Registry', category: 'identity', provider: 'FRSC', recordCount: 18000000 },
  { code: 'INTERPOL', name: 'Interpol Red/Yellow Notice Feed', category: 'government', provider: 'Interpol', recordCount: 75000 },
];

const AUDIT_ACTIONS = [
  'Investigation created', 'Investigation status updated to completed', 'KYC record created',
  'Alert acknowledged', 'Report generated', 'User role updated', 'API key created',
  'Tenant onboarded', 'Screening request submitted', 'Field task dispatched',
  'Data source enabled', 'Monitor activated', 'Webhook configured', 'Settings updated',
  'Bulk export executed', 'Login successful', 'Password reset requested', 'MFA enabled',
];

async function seed() {
  const client = await pool.connect();
  console.log('✅  Connected to database');

  try {
    await client.query('BEGIN');

    // ── 1. Users ──────────────────────────────────────────────────────────────
    console.log('Seeding users...');
    const userRoles = ['admin', 'analyst', 'analyst', 'analyst', 'supervisor', 'supervisor', 'auditor', 'auditor', 'readonly', 'readonly'];
    const insertedUsers = [];
    for (let i = 0; i < 10; i++) {
      const name = NIGERIAN_NAMES[i];
      const email = `${name.split(' ')[0].toLowerCase()}.${name.split(' ')[1].toLowerCase()}@bis.ng`;
      const openId = `user_${Math.random().toString(36).slice(2, 18)}`;
      const res = await client.query(
        `INSERT INTO users (name, email, "openId", role, "createdAt", "updatedAt", "lastSignedIn")
         VALUES ($1, $2, $3, $4, $5, $5, $6)
         ON CONFLICT ("openId") DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [name, email, openId, userRoles[i], daysAgo(randInt(30, 365)), daysAgo(randInt(0, 7))]
      );
      insertedUsers.push({ id: res.rows[0].id, name, email });
    }
    console.log(`  ✓ ${insertedUsers.length} users`);

    // ── 2. Tenants ────────────────────────────────────────────────────────────
    console.log('Seeding tenants...');
    const tenantData = [
      { name: 'Zenith Bank Plc', slug: 'zenith-bank', plan: 'enterprise', status: 'active', industry: 'Banking', country: 'NG', quota: 5000 },
      { name: 'Access Bank Plc', slug: 'access-bank', plan: 'enterprise', status: 'active', industry: 'Banking', country: 'NG', quota: 4000 },
      { name: 'Stanbic IBTC Holdings', slug: 'stanbic-ibtc', plan: 'professional', status: 'active', industry: 'Financial Services', country: 'NG', quota: 2000 },
      { name: 'EFCC Nigeria', slug: 'efcc-ng', plan: 'government', status: 'active', industry: 'Law Enforcement', country: 'NG', quota: 10000 },
      { name: 'Lagos State Government', slug: 'lasg', plan: 'government', status: 'active', industry: 'Government', country: 'NG', quota: 8000 },
      { name: 'Coronation Capital Ltd', slug: 'coronation-cap', plan: 'professional', status: 'trial', industry: 'Investment Banking', country: 'NG', quota: 500 },
    ];
    const insertedTenants = [];
    for (const t of tenantData) {
      const res = await client.query(
        `INSERT INTO tenants (name, slug, plan, status, "contactEmail", "contactName", country, industry, "monthlyQuota", "usedThisMonth", "ngnBalance", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [t.name, t.slug, t.plan, t.status,
         `admin@${t.slug}.ng`, pick(NIGERIAN_NAMES), t.country, t.industry,
         t.quota, randInt(0, t.quota * 0.8), randFloat(50000, 5000000, 2),
         daysAgo(randInt(60, 730))]
      );
      insertedTenants.push({ id: res.rows[0].id, ...t });
    }
    console.log(`  ✓ ${insertedTenants.length} tenants`);

    // ── 3. API Keys ───────────────────────────────────────────────────────────
    console.log('Seeding API keys...');
    let apiKeyCount = 0;
    for (const tenant of insertedTenants) {
      for (let k = 0; k < 2; k++) {
        const prefix = `bk_${tenant.slug.slice(0, 4)}_`;
        const hash = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        await client.query(
          `INSERT INTO api_keys ("tenantId", name, "keyHash", "keyPrefix", status, permissions, "lastUsedAt", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT ("keyHash") DO NOTHING`,
          [tenant.id, k === 0 ? 'Production Key' : 'Staging Key',
           hash, prefix, k === 0 ? 'active' : pick(['active', 'revoked']),
           JSON.stringify(['investigations:read', 'kyc:write', 'screening:write']),
           daysAgo(randInt(0, 14)), daysAgo(randInt(30, 180))]
        );
        apiKeyCount++;
      }
    }
    console.log(`  ✓ ${apiKeyCount} API keys`);

    // ── 4. Webhooks ───────────────────────────────────────────────────────────
    console.log('Seeding webhooks...');
    let webhookCount = 0;
    for (const tenant of insertedTenants.slice(0, 4)) {
      await client.query(
        `INSERT INTO webhooks ("tenantId", url, status, events, secret, "failureCount", "lastDeliveredAt", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tenant.id, `https://api.${tenant.slug}.ng/webhooks/bis`,
         pick(['active', 'active', 'active', 'paused']),
         JSON.stringify(['investigation.completed', 'kyc.passed', 'alert.created', 'screening.completed']),
         Math.random().toString(36).slice(2, 18),
         randInt(0, 3), daysAgo(randInt(0, 3)), daysAgo(randInt(30, 90))]
      );
      webhookCount++;
    }
    console.log(`  ✓ ${webhookCount} webhooks`);

    // ── 5. Investigations ─────────────────────────────────────────────────────
    console.log('Seeding investigations...');
    const statuses = ['completed', 'completed', 'completed', 'flagged', 'processing', 'pending', 'archived'];
    const tiers = ['basic', 'standard', 'standard', 'comprehensive'];
    const insertedInvestigations = [];
    for (let i = 0; i < 25; i++) {
      const isCorp = i % 4 === 0;
      const subjectName = isCorp ? pick(CORP_NAMES) : pick(NIGERIAN_NAMES);
      const status = pick(statuses);
      const riskScore = randFloat(10, 95, 1);
      const riskTier = riskScore > 70 ? 'high' : riskScore > 50 ? 'medium' : 'low';
      const createdAt = daysAgo(randInt(1, 180));
      const completedAt = status === 'completed' || status === 'flagged' ? daysAgo(randInt(0, 30)) : null;
      const res = await client.query(
        `INSERT INTO investigations (ref, "subjectType", "subjectName", country, tier, priority, status, "riskScore", "riskTier", nin, bvn, phone, email, address, purpose, "assignedTo", "createdBy", "dataSources", "riskFactors", "createdAt", "updatedAt", "completedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20,$21)
         RETURNING id`,
        [
          ref('BIS', 2026000 + i),
          isCorp ? 'corporate' : 'individual',
          subjectName, 'NG',
          pick(tiers), pick(['low', 'medium', 'high', 'critical']),
          status, riskScore, riskTier,
          isCorp ? null : `${randInt(10000000000, 99999999999)}`,
          isCorp ? null : `${randInt(10000000000, 99999999999)}`,
          `+234${randInt(7000000000, 9099999999)}`,
          `${subjectName.split(' ')[0].toLowerCase()}@example.ng`,
          `${randInt(1, 99)} ${pick(['Victoria Island', 'Lekki Phase 1', 'Ikoyi', 'Maitama', 'Wuse II', 'GRA Port Harcourt'])}, ${pick(NIGERIAN_STATES)}`,
          pick(PURPOSES),
          pick(insertedUsers).id,
          pick(insertedUsers).id,
          JSON.stringify(['NG_NIN', 'NG_BVN', 'OFAC_SDN', 'PEP_GLOBAL']),
          JSON.stringify(riskScore > 60 ? [
            { factor: 'PEP Association', weight: 25, detail: 'Subject linked to politically exposed person' },
            { factor: 'Adverse Media', weight: 20, detail: 'Negative press coverage in 3 publications' },
          ] : [
            { factor: 'Clean Record', weight: 0, detail: 'No adverse findings' },
          ]),
          createdAt, completedAt,
        ]
      );
      insertedInvestigations.push({ id: res.rows[0].id, subjectName, status });
    }
    console.log(`  ✓ ${insertedInvestigations.length} investigations`);

    // ── 6. Investigation Notes (stored as audit_log entries) ─────────────────
    console.log('Seeding investigation notes (via audit_log)...');
    const NOTE_TEXTS = [
      'Initial review completed. Subject has clean NIN and BVN records.',
      'Adverse media hit confirmed — 2 articles from Nigerian Tribune referencing fraud allegations.',
      'PEP screening returned positive match. Subject is brother-in-law of former state governor.',
      'Field verification dispatched to Lagos office. Agent assigned: FA-0003.',
      'OFAC SDN check returned no match. EU sanctions also clear.',
      'Risk score elevated due to undisclosed beneficial ownership structure.',
      'Client requested expedited processing. Escalated to supervisor.',
      'Document tampering suspected on provided utility bill. Requesting original.',
      'BVN cross-reference shows 3 accounts at different banks — normal pattern.',
      'Final decision: PASS with enhanced monitoring for 12 months.',
    ];
    let noteCount = 0;
    for (const inv of insertedInvestigations.slice(0, 15)) {
      const numNotes = randInt(1, 4);
      for (let n = 0; n < numNotes; n++) {
        const user = pick(insertedUsers);
        const noteText = pick(NOTE_TEXTS);
        await client.query(
          `INSERT INTO audit_log ("userId", "userEmail", category, action, "targetRef", result, "ipAddress", detail, "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [user.id, user.email, 'investigation', `Note: ${noteText.slice(0, 80)}`,
           ref('BIS', 2026000 + insertedInvestigations.indexOf(inv)),
           'success', `41.${randInt(0,255)}.${randInt(0,255)}.${randInt(1,254)}`,
           JSON.stringify({ note: noteText, author: user.name }),
           daysAgo(randInt(0, 60))]
        );
        noteCount++;
      }
    }
    console.log(`  ✓ ${noteCount} investigation notes (in audit_log)`);

    // ── 7. KYC Records ────────────────────────────────────────────────────────
    console.log('Seeding KYC records...');
    const kycStatuses = ['passed', 'passed', 'passed', 'failed', 'review', 'pending', 'processing'];
    for (let i = 0; i < 20; i++) {
      const name = pick(NIGERIAN_NAMES);
      const status = pick(kycStatuses);
      const riskScore = randFloat(5, 95, 1);
      await client.query(
        `INSERT INTO kyc_records ("investigationId", "subjectName", nin, bvn, dob, phone, status, "riskScore", "ninResult", "bvnResult", "sanctionsResult", "pepResult", "createdBy", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
        [
          pick(insertedInvestigations).id,
          name,
          `${randInt(10000000000, 99999999999)}`,
          `${randInt(10000000000, 99999999999)}`,
          `${randInt(1960, 2000)}-${String(randInt(1,12)).padStart(2,'0')}-${String(randInt(1,28)).padStart(2,'0')}`,
          `+234${randInt(7000000000, 9099999999)}`,
          status,
          riskScore,
          JSON.stringify({ match: status !== 'failed', confidence: randFloat(0.7, 1.0, 3), name, dob: '1985-03-15' }),
          JSON.stringify({ match: status !== 'failed', bank: pick(['Zenith', 'Access', 'GTB', 'UBA', 'First Bank']), accountCount: randInt(1, 4) }),
          JSON.stringify({ ofac: false, un: false, eu: false, cbn: status === 'failed' }),
          JSON.stringify({ isPep: riskScore > 75, pepLevel: riskScore > 75 ? pick(['Tier 1', 'Tier 2']) : null }),
          pick(insertedUsers).id,
          daysAgo(randInt(1, 90)),
        ]
      );
    }
    console.log('  ✓ 20 KYC records');

    // ── 8. Alerts ─────────────────────────────────────────────────────────────
    console.log('Seeding alerts...');
    const alertTypes = ['sanctions_hit', 'pep_detected', 'risk_threshold', 'velocity', 'adverse_media', 'field_report', 'system'];
    const severities = ['critical', 'high', 'high', 'medium', 'medium', 'low'];
    for (let i = 0; i < 20; i++) {
      const inv = pick(insertedInvestigations);
      const severity = pick(severities);
      const type = pick(alertTypes);
      const isRead = Math.random() > 0.4;
      await client.query(
        `INSERT INTO alerts (type, severity, title, body, "subjectRef", "sourceService", read, acknowledged, "acknowledgedBy", "acknowledgedAt", "createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          type, severity,
          pick(ALERT_TITLES),
          `Alert generated for subject ${inv.subjectName}. Investigation reference: ${ref('BIS', 2026000 + insertedInvestigations.indexOf(inv))}. Immediate review recommended.`,
          ref('BIS', 2026000 + insertedInvestigations.indexOf(inv)),
          pick(['sanctions-engine', 'pep-service', 'risk-scorer', 'field-ops', 'media-monitor']),
          isRead, isRead && Math.random() > 0.5,
          isRead ? pick(insertedUsers).id : null,
          isRead && Math.random() > 0.5 ? daysAgo(randInt(0, 5)) : null,
          daysAgo(randInt(0, 30)),
        ]
      );
    }
    console.log('  ✓ 20 alerts');

    // ── 9. Audit Log ──────────────────────────────────────────────────────────
    console.log('Seeding audit log...');
    const categories = ['investigation', 'kyc', 'alert', 'report', 'user', 'system', 'api'];
    const results = ['success', 'success', 'success', 'warning', 'failure'];
    for (let i = 0; i < 60; i++) {
      const user = pick(insertedUsers);
      const inv = pick(insertedInvestigations);
      await client.query(
        `INSERT INTO audit_log ("userId", "userEmail", category, action, "targetRef", result, "ipAddress", detail, "createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          user.id, user.email,
          pick(categories), pick(AUDIT_ACTIONS),
          ref('BIS', 2026000 + insertedInvestigations.indexOf(inv)),
          pick(results),
          `${randInt(41, 197)}.${randInt(0,255)}.${randInt(0,255)}.${randInt(1,254)}`,
          JSON.stringify({ browser: pick(['Chrome/120', 'Firefox/121', 'Safari/17']), os: pick(['Windows 11', 'macOS 14', 'Ubuntu 22.04']) }),
          daysAgo(randInt(0, 90)),
        ]
      );
    }
    console.log('  ✓ 60 audit log entries');

    // ── 10. Field Agents ──────────────────────────────────────────────────────
    console.log('Seeding field agents...');
    const agentSpecs = [
      ['address_verification', 'document_collection'],
      ['biometric_capture', 'interview'],
      ['surveillance', 'address_verification'],
      ['interview', 'document_collection'],
    ];
    for (let i = 0; i < 10; i++) {
      const name = NIGERIAN_NAMES[i + 10];
      const state = pick(NIGERIAN_STATES);
      await client.query(
        `INSERT INTO field_agents ("agentCode", name, email, phone, state, lga, status, tier, specializations, "tasksCompleted", "tasksActive", rating, "gpsLat", "gpsLng", "lastSeen", "createdBy", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)
         ON CONFLICT ("agentCode") DO NOTHING`,
        [
          ref('FA', i + 1),
          name,
          `${name.split(' ')[0].toLowerCase()}@field.bis.ng`,
          `+234${randInt(7000000000, 9099999999)}`,
          state, pick(NIGERIAN_LGAS),
          pick(['active', 'active', 'active', 'inactive', 'training']),
          pick(['junior', 'senior', 'senior', 'lead', 'specialist']),
          JSON.stringify(pick(agentSpecs)),
          randInt(5, 120), randInt(0, 5),
          randFloat(3.2, 5.0, 1),
          randFloat(4.0, 14.0, 6),  // Nigeria lat range
          randFloat(3.0, 15.0, 6),  // Nigeria lng range
          daysAgo(randInt(0, 3)),
          pick(insertedUsers).id,
          daysAgo(randInt(30, 365)),
        ]
      );
    }
    console.log('  ✓ 10 field agents');

    // ── 11. Field Tasks ───────────────────────────────────────────────────────
    console.log('Seeding field tasks...');
    const taskTypes = ['address_verification', 'biometric_capture', 'document_collection', 'surveillance', 'interview'];
    const taskStatuses = ['completed', 'completed', 'in_progress', 'dispatched', 'pending'];
    for (let i = 0; i < 15; i++) {
      const inv = pick(insertedInvestigations);
      const status = pick(taskStatuses);
      await client.query(
        `INSERT INTO field_tasks ("taskRef", "investigationId", "agentId", "agentName", "taskType", priority, status, "subjectName", address, state, lga, "gpsLat", "gpsLng", deadline, instructions, result, "createdBy", "createdAt", "updatedAt", "completedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18,$19)`,
        [
          ref('FT', 2026000 + i),
          inv.id,
          ref('FA', randInt(1, 10)),
          pick(NIGERIAN_NAMES),
          pick(taskTypes), pick(['low', 'medium', 'high']),
          status, inv.subjectName,
          `${randInt(1, 99)} ${pick(['Broad Street', 'Marina', 'Adeola Odeku', 'Ozumba Mbadiwe', 'Ahmadu Bello Way'])}, ${pick(NIGERIAN_STATES)}`,
          pick(NIGERIAN_STATES), pick(NIGERIAN_LGAS),
          randFloat(4.0, 14.0, 6), randFloat(3.0, 15.0, 6),
          daysAgo(randInt(-7, 14)),
          'Verify subject identity and residence. Collect utility bill and government ID. Photograph premises.',
          status === 'completed' ? JSON.stringify({ verified: Math.random() > 0.3, notes: 'Subject confirmed at address. Documents collected.', photos: 3 }) : null,
          pick(insertedUsers).id,
          daysAgo(randInt(1, 60)),
          status === 'completed' ? daysAgo(randInt(0, 30)) : null,
        ]
      );
    }
    console.log('  ✓ 15 field tasks');

    // ── 12. Data Sources ──────────────────────────────────────────────────────
    console.log('Seeding data sources...');
    for (const ds of DATA_SOURCES) {
      await client.query(
        `INSERT INTO data_sources (code, name, category, status, provider, description, "recordCount", "lastSyncAt", "uptimePct", "avgResponseMs", "requestsToday", "requestsTotal", enabled, "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, "recordCount" = EXCLUDED."recordCount"`,
        [
          ds.code, ds.name, ds.category,
          pick(['active', 'active', 'active', 'degraded']),
          ds.provider,
          `Official ${ds.name} providing verified records for identity and compliance checks.`,
          ds.recordCount,
          daysAgo(randInt(0, 1)),
          randFloat(94, 99.9, 2),
          randInt(120, 850),
          randInt(50, 2000),
          randInt(10000, 500000),
          true,
          daysAgo(randInt(180, 730)),
        ]
      );
    }
    console.log(`  ✓ ${DATA_SOURCES.length} data sources`);

    // ── 13. Monitors ──────────────────────────────────────────────────────────
    console.log('Seeding monitors...');
    const monitorTypes = ['sanctions', 'pep', 'adverse_media', 'social', 'transaction', 'biometric'];
    const monitorStatuses = ['active', 'active', 'active', 'triggered', 'paused'];
    for (let i = 0; i < 12; i++) {
      const inv = pick(insertedInvestigations);
      const status = pick(monitorStatuses);
      await client.query(
        `INSERT INTO monitors ("monitorRef", "investigationId", "subjectName", "subjectRef", type, status, frequency, "lastCheckedAt", "nextCheckAt", "alertCount", "lastAlertAt", "expiresAt", config, "createdBy", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
        [
          ref('MON', 2026000 + i),
          inv.id, inv.subjectName,
          ref('BIS', 2026000 + insertedInvestigations.indexOf(inv)),
          pick(monitorTypes), status,
          pick(['daily', 'weekly', 'realtime']),
          daysAgo(randInt(0, 3)),
          daysAgo(-1),  // next check tomorrow
          status === 'triggered' ? randInt(1, 5) : 0,
          status === 'triggered' ? daysAgo(randInt(0, 7)) : null,
          daysAgo(-randInt(30, 365)),
          JSON.stringify({ threshold: 70, notifyEmail: true, notifyWebhook: true }),
          pick(insertedUsers).id,
          daysAgo(randInt(1, 90)),
        ]
      );
    }
    console.log('  ✓ 12 monitors');

    // ── 14. Screening Requests ────────────────────────────────────────────────
    console.log('Seeding screening requests...');
    const screeningTypes = ['mvr', 'drug', 'work_authorization', 'biometric', 'zero_footprint'];
    const screeningStatuses = ['completed', 'completed', 'processing', 'pending', 'review', 'failed'];
    for (let i = 0; i < 30; i++) {
      const type = pick(screeningTypes);
      const status = pick(screeningStatuses);
      const name = pick(NIGERIAN_NAMES);
      const riskScore = randFloat(5, 85, 1);
      await client.query(
        `INSERT INTO screening_requests ("requestRef", "investigationId", type, status, "subjectName", "subjectType", priority, "requestData", result, "resultSummary", "riskScore", "processedBy", "createdBy", "createdAt", "updatedAt", "completedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15)`,
        [
          ref('SCR', 2026000 + i),
          pick(insertedInvestigations).id,
          type, status, name,
          pick(['individual', 'corporate']),
          pick(['low', 'medium', 'high']),
          JSON.stringify({ subjectName: name, nin: `${randInt(10000000000, 99999999999)}`, requestedBy: pick(insertedUsers).email }),
          status === 'completed' ? JSON.stringify({ result: riskScore < 50 ? 'PASS' : 'REVIEW', score: riskScore, checks: ['identity', 'sanctions', 'pep'] }) : null,
          status === 'completed' ? (riskScore < 50 ? 'All checks passed. No adverse findings.' : 'Elevated risk score. Manual review recommended.') : null,
          status === 'completed' ? riskScore : null,
          status === 'completed' ? pick(insertedUsers).id : null,
          pick(insertedUsers).id,
          daysAgo(randInt(1, 60)),
          status === 'completed' ? daysAgo(randInt(0, 30)) : null,
        ]
      );
    }
    console.log('  ✓ 30 screening requests');

    // ── 15. Reports ───────────────────────────────────────────────────────────
    console.log('Seeding reports...');
    const reportTemplates = ['comprehensive_due_diligence', 'kyc_summary', 'sanctions_screening', 'adverse_media', 'executive_summary'];
    for (let i = 0; i < 10; i++) {
      const inv = pick(insertedInvestigations);
      const template = pick(reportTemplates);
      const status = pick(['ready', 'ready', 'generating', 'failed']);
      await client.query(
        `INSERT INTO reports ("reportRef", "investigationId", template, title, format, status, "fileUrl", sections, "generatedBy", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
        [
          ref('RPT', 2026000 + i),
          inv.id,
          template,
          `${template.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} — ${inv.subjectName}`,
          pick(['pdf', 'docx', 'pdf']),
          status,
          status === 'ready' ? `https://cdn.bis.ng/reports/${ref('RPT', 2026000 + i)}.pdf` : null,
          JSON.stringify(['executive_summary', 'identity_verification', 'sanctions_screening', 'risk_assessment', 'recommendations']),
          pick(insertedUsers).id,
          daysAgo(randInt(1, 60)),
        ]
      );
    }
    console.log('  ✓ 10 reports');

    // ── 16. Platform Settings ─────────────────────────────────────────────────
    console.log('Seeding platform settings...');
    const settings = [
      { key: 'general.platformName', value: 'BIS Intelligence Platform' },
      { key: 'general.defaultCountry', value: 'NG' },
      { key: 'general.timezone', value: 'Africa/Lagos' },
      { key: 'security.mfaRequired', value: true },
      { key: 'security.sessionTimeoutMinutes', value: 480 },
      { key: 'security.maxLoginAttempts', value: 5 },
      { key: 'notifications.emailAlerts', value: true },
      { key: 'notifications.slackWebhook', value: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX' },
      { key: 'compliance.riskThreshold', value: 70 },
      { key: 'compliance.autoFlagHighRisk', value: true },
      { key: 'compliance.retentionDays', value: 2555 },
      { key: 'integrations.kycServiceUrl', value: 'https://kyc.bis.ng/api/v1' },
      { key: 'integrations.gatewayUrl', value: 'https://gateway.bis.ng/api/v2' },
    ];
    for (const s of settings) {
      await client.query(
        `INSERT INTO platform_settings (namespace, key, value, "updatedAt", "updatedBy")
         VALUES ($1, $2, $3, NOW(), $4)
         ON CONFLICT DO NOTHING`,
        ['default', s.key, JSON.stringify(s.value), 'seed-script']
      );
    }
    console.log(`  ✓ ${settings.length} platform settings`);

    // ── 17. Onboarding Applications ───────────────────────────────────────────
    console.log('Seeding onboarding applications...');
    const onboardingStatuses = ['approved', 'approved', 'under_review', 'awaiting_documents', 'submitted', 'rejected'];
    const entityTypes = ['limited_company', 'plc', 'ngo', 'government', 'partnership'];
    for (let i = 0; i < 10; i++) {
      const corp = pick(CORP_NAMES);
      const contact = pick(NIGERIAN_NAMES);
      const status = pick(onboardingStatuses);
      await client.query(
        `INSERT INTO onboarding_applications ("referenceId", "entityType", "legalName", "tradingName", "countryCode", "stateProvince", city, address, website, "businessCategory", "contactName", "contactEmail", "contactPhone", "contactTitle", "useCase", "pepDeclaration", "agreedToTerms", status, stakeholders, "documentUrls", "createdBy", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22)`,
        [
          `OB-${Date.now()}-${i}`,
          pick(entityTypes), corp, corp,
          'NG', pick(NIGERIAN_STATES), pick(['Lagos', 'Abuja', 'Kano', 'Port Harcourt']),
          `${randInt(1, 99)} ${pick(['Broad Street', 'Marina', 'Adeola Odeku'])}, Lagos`,
          `https://www.${corp.split(' ')[0].toLowerCase()}.ng`,
          pick(['Banking', 'Insurance', 'Fintech', 'Real Estate', 'Oil & Gas', 'Telecoms']),
          contact,
          `${contact.split(' ')[0].toLowerCase()}@${corp.split(' ')[0].toLowerCase()}.ng`,
          `+234${randInt(7000000000, 9099999999)}`,
          pick(['CEO', 'CFO', 'Compliance Officer', 'Head of Operations', 'Director']),
          'We require BIS services for regulatory compliance, KYC/AML screening, and background verification of employees and business partners.',
          false, true, status,
          JSON.stringify([
            { role: 'Director', fullName: pick(NIGERIAN_NAMES), email: `director@${corp.split(' ')[0].toLowerCase()}.ng`, ownershipPercentage: randInt(25, 51) },
            { role: 'Shareholder', fullName: pick(NIGERIAN_NAMES), email: `shareholder@${corp.split(' ')[0].toLowerCase()}.ng`, ownershipPercentage: randInt(10, 25) },
          ]),
          JSON.stringify(status === 'approved' ? [
            { name: 'Certificate of Incorporation', url: `https://cdn.bis.ng/docs/cac-${i}.pdf`, key: `docs/cac-${i}.pdf`, uploadedAt: daysAgo(randInt(1, 30)).toISOString() },
            { name: 'Memorandum & Articles', url: `https://cdn.bis.ng/docs/memart-${i}.pdf`, key: `docs/memart-${i}.pdf`, uploadedAt: daysAgo(randInt(1, 30)).toISOString() },
          ] : []),
          pick(insertedUsers).email,
          daysAgo(randInt(1, 90)),
        ]
      );
    }
    console.log('  ✓ 10 onboarding applications');

    await client.query('COMMIT');
    console.log('\n✅  Database seeded successfully!');
    console.log('   Tables populated: users, tenants, api_keys, webhooks, investigations,');
    console.log('   investigation_notes, kyc_records, alerts, audit_log, field_agents,');
    console.log('   field_tasks, data_sources, monitors, screening_requests, reports,');
    console.log('   platform_settings, onboarding_applications');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌  Seed failed, rolled back:', err.message);
    console.error(err.stack);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
