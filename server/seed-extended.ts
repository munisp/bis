/**
 * BIS Platform — Extended Seed Script (v60)
 *
 * Covers all tables NOT seeded by server/seed.ts:
 * cases, caseParties, caseDocuments, caseTimeline, caseStakeholders, caseComments,
 * transactions, amlRules, amlAlerts, swiftMessages, sepaPayments, travelRuleRecords,
 * sarFilings, lettersOfCredit, correspondentBanks, nostroAccounts, evidenceItems,
 * regulatoryReports, frozenAccounts, goamlFilings, messagingChannels, incomingReports,
 * socialMonitorConfigs, socialMentions, fieldAgentPlaybooks, duplicateIdentityChecks,
 * hostedVerificationLinks, ollamaModels, lexAgencies, lexSubmitters, lexSubmissions,
 * investigationCaseLinks, notifications, platformSettings, exportSchedules,
 * apiTokens, tokenUsageLog, webhooks, userSessions, userTotpSecrets
 *
 * Usage: pnpm db:seed-extended
 * Safe to re-run: uses ON CONFLICT DO NOTHING or existence checks.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import {
  users,
  investigations,
  cases,
  caseParties,
  caseDocuments,
  caseTimeline,
  caseStakeholders,
  caseComments,
  transactions,
  amlRules,
  amlAlerts,
  swiftMessages,
  sepaPayments,
  travelRuleRecords,
  sarFilings,
  lettersOfCredit,
  correspondentBanks,
  nostroAccounts,
  evidenceItems,
  regulatoryReports,
  frozenAccounts,
  goamlFilings,
  messagingChannels,
  incomingReports,
  socialMonitorConfigs,
  socialMentions,
  fieldAgentPlaybooks,
  duplicateIdentityChecks,
  hostedVerificationLinks,
  ollamaModels,
  lexAgencies,
  lexSubmitters,
  lexSubmissions,
  investigationCaseLinks,
  notifications,
  platformSettings,
  exportSchedules,
  apiTokens,
  tokenUsageLog,
  webhooks,
  userSessions,
  userTotpSecrets,
} from "../drizzle/schema";

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
function rndInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function rndFloat(min: number, max: number, dp = 2): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(dp));
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}
function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
function ref(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(6, "0")}`;
}

const NIGERIAN_BANKS = [
  "Access Bank", "Zenith Bank", "GTBank", "First Bank", "UBA",
  "Fidelity Bank", "Stanbic IBTC", "Union Bank", "Polaris Bank", "Wema Bank",
];
const NIGERIAN_NAMES = [
  "Emeka Okafor", "Fatima Abubakar", "Chidi Nwosu", "Amina Yusuf", "Tunde Adeyemi",
  "Ngozi Eze", "Musa Ibrahim", "Chioma Obi", "Bola Adesanya", "Kemi Adebayo",
  "Yakubu Danjuma", "Adaeze Nnamdi", "Segun Olawale", "Halima Suleiman", "Ifeanyi Okeke",
  "Aisha Mohammed", "Emeka Chukwu", "Funke Akindele", "Sani Abubakar", "Blessing Eze",
];
const CURRENCIES = ["NGN", "USD", "EUR", "GBP", "XOF"];
const COUNTRIES = ["NG", "GH", "KE", "ZA", "US", "GB", "DE", "FR", "CN", "AE"];
const STATES: readonly string[] = [
  "LA", "AB", "KD", "KN", "OG", "ON", "OS", "OY", "RI", "EN",
  "IM", "AN", "BO", "DE", "ED", "BE", "FC", "GO", "NI", "PL",
];

async function seedPlatformSettings() {
  console.log("  → platformSettings");
  const settings = [
    { namespace: "aml", key: "ctr_threshold_ngn", value: 5000000 },
    { namespace: "aml", key: "str_auto_file_score", value: 85 },
    { namespace: "aml", key: "velocity_window_hours", value: 24 },
    { namespace: "aml", key: "max_daily_transactions", value: 50 },
    { namespace: "aml", key: "high_risk_countries", value: ["IR", "KP", "SY", "CU", "VE", "MM"] },
    { namespace: "kyc", key: "nin_verification_enabled", value: true },
    { namespace: "kyc", key: "bvn_verification_enabled", value: true },
    { namespace: "kyc", key: "liveness_check_enabled", value: true },
    { namespace: "kyc", key: "document_ocr_enabled", value: true },
    { namespace: "payments", key: "gateway_sandbox", value: false },
    { namespace: "payments", key: "tb_batch_size", value: 8190 },
    { namespace: "payments", key: "max_transfer_ngn", value: 100000000 },
    { namespace: "payments", key: "swift_enabled", value: true },
    { namespace: "payments", key: "sepa_enabled", value: true },
    { namespace: "compliance", key: "goaml_reporting_url", value: "https://goaml.unodc.org/goaml/en/api" },
    { namespace: "compliance", key: "nfiu_reporting_enabled", value: true },
    { namespace: "compliance", key: "fatf_travel_rule_threshold_usd", value: 1000 },
    { namespace: "compliance", key: "pep_screening_enabled", value: true },
    { namespace: "notifications", key: "slack_alerts_enabled", value: true },
    { namespace: "notifications", key: "email_alerts_enabled", value: true },
    { namespace: "archival", key: "hot_tier_days", value: 90 },
    { namespace: "archival", key: "warm_tier_days", value: 365 },
    { namespace: "archival", key: "cold_tier_days", value: 2555 },
    { namespace: "security", key: "mfa_required_for_admins", value: true },
    { namespace: "security", key: "session_timeout_minutes", value: 480 },
    { namespace: "security", key: "max_login_attempts", value: 5 },
    { namespace: "security", key: "password_min_length", value: 12 },
    { namespace: "security", key: "api_rate_limit_per_minute", value: 100 },
  ];
  for (const s of settings) {
    await db.execute(sql`
      INSERT INTO platform_settings (namespace, key, value, "updatedBy")
      VALUES (${s.namespace}, ${s.key}, ${JSON.stringify(s.value)}::jsonb, 'system')
      ON CONFLICT DO NOTHING
    `);
  }
}

async function seedOllamaModels() {
  console.log("  → ollamaModels");
  const models = [
    { name: "llama3.2:3b", displayName: "Llama 3.2 3B", family: "llama", parameterSize: "3B", quantization: "Q4_K_M", sizeBytes: 1999000000, status: "available", useCase: ["summarization", "classification"], isDefault: false },
    { name: "llama3.2:8b", displayName: "Llama 3.2 8B", family: "llama", parameterSize: "8B", quantization: "Q4_K_M", sizeBytes: 2000000000, status: "available", useCase: ["analysis", "report_generation"], isDefault: true },
    { name: "mistral:7b", displayName: "Mistral 7B", family: "mistral", parameterSize: "7B", quantization: "Q4_K_M", sizeBytes: 2000000000, status: "available", useCase: ["aml_analysis", "narrative_generation"], isDefault: false },
    { name: "phi3:mini", displayName: "Phi-3 Mini", family: "phi", parameterSize: "3.8B", quantization: "Q4_K_M", sizeBytes: 2000000000, status: "available", useCase: ["quick_classification", "entity_extraction"], isDefault: false },
    { name: "gemma2:2b", displayName: "Gemma 2 2B", family: "gemma", parameterSize: "2B", quantization: "Q4_K_M", sizeBytes: 1600000000, status: "available", useCase: ["translation", "summarization"], isDefault: false },
    { name: "nomic-embed-text:latest", displayName: "Nomic Embed Text", family: "nomic", parameterSize: "137M", quantization: "F32", sizeBytes: 274000000, status: "available", useCase: ["embeddings", "semantic_search"], isDefault: false },
  ];
  for (const m of models) {
    await db.execute(sql`
      INSERT INTO ollama_models (name, "displayName", family, "parameterSize", quantization, "sizeBytes", status, "useCase", "isDefault")
      VALUES (${m.name}, ${m.displayName}, ${m.family}, ${m.parameterSize}, ${m.quantization}, ${m.sizeBytes}, ${m.status}, ${JSON.stringify(m.useCase)}::jsonb, ${m.isDefault})
      ON CONFLICT (name) DO NOTHING
    `);
  }
}

async function seedMessagingChannels() {
  console.log("  → messagingChannels");
  const channels = [
    { channelType: "whatsapp", name: "BIS WhatsApp Hotline", identifier: "+2348001234567", status: "active", webhookUrl: "https://api.bis.ng/webhooks/whatsapp", totalReports: 1247, todayReports: 23, activeUsers: 892 },
    { channelType: "telegram", name: "BIS Telegram Bot", identifier: "@BISReportBot", status: "active", webhookUrl: "https://api.bis.ng/webhooks/telegram", totalReports: 456, todayReports: 8, activeUsers: 234 },
    { channelType: "ussd", name: "BIS USSD *737#", identifier: "*737#", status: "active", totalReports: 3891, todayReports: 67, activeUsers: 2100 },
    { channelType: "sms", name: "BIS SMS Gateway", identifier: "20001", status: "active", totalReports: 2234, todayReports: 41, activeUsers: 1567 },
    { channelType: "email", name: "BIS Email Reports", identifier: "reports@bis.ng", status: "active", totalReports: 789, todayReports: 12, activeUsers: 445 },
  ];
  for (const c of channels) {
    await db.execute(sql`
      INSERT INTO messaging_channels ("channelType", name, identifier, status, "webhookUrl", "totalReports", "todayReports", "activeUsers", "lastActivityAt", "createdBy")
      VALUES (${c.channelType}::"channel_type", ${c.name}, ${c.identifier}, ${c.status}::"channel_status", ${c.webhookUrl ?? null}, ${c.totalReports}, ${c.todayReports}, ${c.activeUsers}, NOW() - INTERVAL '2 hours', 1)
      ON CONFLICT DO NOTHING
    `);
  }
}

async function seedCorrespondentBanks() {
  console.log("  → correspondentBanks + nostroAccounts");
  const banks = [
    { bankName: "JPMorgan Chase Bank N.A.", bic: "CHASUS33XXX", country: "US", city: "New York", status: "active", riskRating: "low", services: ["wire_transfer", "fx", "trade_finance"], currencies: ["USD", "EUR", "GBP"] },
    { bankName: "Deutsche Bank AG", bic: "DEUTDEDBXXX", country: "DE", city: "Frankfurt", status: "active", riskRating: "low", services: ["wire_transfer", "sepa", "trade_finance"], currencies: ["EUR", "USD", "GBP"] },
    { bankName: "Standard Chartered Bank", bic: "SCBLGB2LXXX", country: "GB", city: "London", status: "active", riskRating: "low", services: ["wire_transfer", "fx", "correspondent_banking"], currencies: ["GBP", "USD", "EUR"] },
    { bankName: "Citibank N.A.", bic: "CITIUS33XXX", country: "US", city: "New York", status: "active", riskRating: "low", services: ["wire_transfer", "fx", "custody"], currencies: ["USD", "EUR", "NGN"] },
    { bankName: "HSBC Bank plc", bic: "MIDLGB22XXX", country: "GB", city: "London", status: "active", riskRating: "medium", services: ["wire_transfer", "trade_finance"], currencies: ["GBP", "USD", "EUR", "HKD"] },
    { bankName: "Société Générale", bic: "SOGEFRPPXXX", country: "FR", city: "Paris", status: "active", riskRating: "low", services: ["sepa", "fx", "trade_finance"], currencies: ["EUR", "USD"] },
    { bankName: "United Bank for Africa (London)", bic: "UNAFGB2LXXX", country: "GB", city: "London", status: "active", riskRating: "low", services: ["wire_transfer", "africa_corridors"], currencies: ["GBP", "USD", "NGN"] },
    { bankName: "Ecobank Transnational", bic: "ECOCGHACXXX", country: "GH", city: "Accra", status: "active", riskRating: "medium", services: ["wire_transfer", "mobile_money"], currencies: ["GHS", "USD", "XOF"] },
  ];
  const bankIds: number[] = [];
  for (const b of banks) {
    const result = await db.execute(sql`
      INSERT INTO correspondent_banks ("bankName", bic, country, city, status, "riskRating", "relationshipSince", "lastReviewDate", "nextReviewDate", services, currencies, "nostroAccountCount", "annualVolume")
      VALUES (${b.bankName}, ${b.bic}, ${b.country}, ${b.city}, ${b.status}::"correspondent_bank_status", ${b.riskRating}, ${daysAgo(rndInt(365, 2000))}, ${daysAgo(rndInt(30, 180))}, ${daysFromNow(rndInt(90, 365))}, ${JSON.stringify(b.services)}::jsonb, ${JSON.stringify(b.currencies)}::jsonb, ${rndInt(1, 5)}, ${rndFloat(10000000, 500000000)})
      ON CONFLICT (bic) DO NOTHING
      RETURNING id
    `);
    if (result.rows.length > 0) bankIds.push((result.rows[0] as any).id);
  }
  // Nostro accounts for each correspondent bank
  const nostroData = [
    { currency: "USD", balance: rndFloat(1000000, 50000000) },
    { currency: "EUR", balance: rndFloat(500000, 20000000) },
    { currency: "GBP", balance: rndFloat(200000, 10000000) },
  ];
  for (const bankId of bankIds) {
    for (const n of nostroData.slice(0, rndInt(1, 3))) {
      await db.execute(sql`
        INSERT INTO nostro_accounts ("accountNumber", currency, "correspondentBankId", balance, "lastReconciled", status)
        VALUES (${`NOST${bankId}${n.currency}${rndInt(1000, 9999)}`}, ${n.currency}, ${bankId}, ${n.balance}, ${daysAgo(rndInt(1, 7))}, 'active')
        ON CONFLICT DO NOTHING
      `);
    }
  }
}

async function seedTransactions(userIds: number[], investigationIds: number[]) {
  console.log("  → transactions (100 records)");
  const types = ["wire_transfer", "cash_deposit", "cash_withdrawal", "rtgs", "nip", "swift_mt103", "sepa_credit", "mobile_money", "fx_conversion", "card_payment"] as const;
  const statuses = ["pending", "completed", "failed", "reversed", "flagged", "blocked", "under_review"] as const;
  const riskLevels = ["low", "medium", "high", "critical"] as const;
  for (let i = 1; i <= 100; i++) {
    const amount = rndFloat(5000, 50000000);
    const currency = rnd(CURRENCIES);
    const status = rnd(statuses);
    const riskLevel = rnd(riskLevels);
    await db.execute(sql`
      INSERT INTO transactions (
        "txRef", type, status, amount, currency, "amountUsd",
        "originatorName", "originatorAccount", "originatorBank", "originatorCountry",
        "beneficiaryName", "beneficiaryAccount", "beneficiaryBank", "beneficiaryCountry",
        "purposeCode", narration, "amlRiskLevel", "amlScore",
        "valueDate", "createdAt", "updatedAt"
      ) VALUES (
        ${ref("TXN", i + 1000)},
        ${rnd(types)}::"transaction_type",
        ${status}::"transaction_status",
        ${amount}, ${currency}, ${amount * (currency === "USD" ? 1 : currency === "EUR" ? 1.08 : currency === "GBP" ? 1.27 : currency === "NGN" ? 0.00065 : 0.0017)},
        ${rnd(NIGERIAN_NAMES)}, ${`0${rndInt(10, 99)}${rndInt(10000000, 99999999)}`}, ${rnd(NIGERIAN_BANKS)}, ${rnd(COUNTRIES)},
        ${rnd(NIGERIAN_NAMES)}, ${`0${rndInt(10, 99)}${rndInt(10000000, 99999999)}`}, ${rnd(NIGERIAN_BANKS)}, ${rnd(COUNTRIES)},
        ${rnd(["OWN", "SAL", "INV", "REM", "TRD", "FIN"])}, ${`Payment for services - ref ${uuid().slice(0, 8)}`},
        ${riskLevel}::"aml_risk_level", ${rndFloat(0, 100)},
        ${daysAgo(rndInt(0, 90))}, ${daysAgo(rndInt(0, 90))}, ${daysAgo(rndInt(0, 30))}
      )
      ON CONFLICT ("txRef") DO NOTHING
    `);
  }
}

async function seedAmlRulesAndAlerts(userIds: number[]) {
  console.log("  → amlRules + amlAlerts");
  const rules = [
    { name: "Large Cash Threshold (CTR)", description: "Flags cash transactions above ₦5M per CBN CTR requirements", ruleType: "threshold", threshold: 5000000, currency: "NGN", windowHours: 24, riskLevel: "high" },
    { name: "Velocity — 10 Transactions/24h", description: "Flags accounts with more than 10 transactions in 24 hours", ruleType: "velocity", threshold: 10, currency: "NGN", windowHours: 24, riskLevel: "medium" },
    { name: "Structuring Detection", description: "Detects multiple transactions just below CTR threshold", ruleType: "structuring", threshold: 4900000, currency: "NGN", windowHours: 48, riskLevel: "high" },
    { name: "Round-Trip Transaction", description: "Detects funds that return to originator within 72 hours", ruleType: "round_trip", threshold: 1000000, currency: "NGN", windowHours: 72, riskLevel: "critical" },
    { name: "High-Risk Country Transfer", description: "Flags transfers to/from FATF high-risk jurisdictions", ruleType: "high_risk_country", threshold: 100000, currency: "USD", windowHours: 24, riskLevel: "high" },
    { name: "PEP Transaction Monitor", description: "Enhanced monitoring for Politically Exposed Persons", ruleType: "pep_transaction", threshold: 500000, currency: "NGN", windowHours: 24, riskLevel: "high" },
    { name: "Sanctions List Match", description: "Blocks transactions matching OFAC/UN/EU sanctions lists", ruleType: "sanctions_match", threshold: 0, currency: "USD", windowHours: 24, riskLevel: "critical" },
    { name: "Layering Pattern", description: "Detects rapid movement of funds through multiple accounts", ruleType: "layering", threshold: 2000000, currency: "NGN", windowHours: 12, riskLevel: "critical" },
    { name: "Unusual Pattern — Weekend Large Transfer", description: "Large transfers initiated on weekends outside business hours", ruleType: "unusual_pattern", threshold: 10000000, currency: "NGN", windowHours: 48, riskLevel: "medium" },
  ];
  const ruleIds: number[] = [];
  for (const r of rules) {
    const result = await db.execute(sql`
      INSERT INTO aml_rules (name, description, "ruleType", threshold, currency, "windowHours", enabled, "riskLevel", "createdBy")
      VALUES (${r.name}, ${r.description}, ${r.ruleType}::"aml_rule_type", ${r.threshold}, ${r.currency}, ${r.windowHours}, true, ${r.riskLevel}::"aml_risk_level", ${userIds[0]})
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    if (result.rows.length > 0) ruleIds.push((result.rows[0] as any).id);
  }
  // AML Alerts
  const alertStatuses = ["open", "under_review", "escalated", "cleared", "filed", "false_positive"] as const;
  const riskLevels = ["low", "medium", "high", "critical"] as const;
  for (let i = 1; i <= 40; i++) {
    const ruleId = rnd(ruleIds);
    const riskLevel = rnd(riskLevels);
    await db.execute(sql`
      INSERT INTO aml_alerts (
        "alertRef", "ruleId", status, "riskLevel", title, description,
        "triggeredValue", "assignedTo", "createdAt", "updatedAt"
      ) VALUES (
        ${ref("AML", i + 1000)}, ${ruleId}, ${rnd(alertStatuses)}::"aml_alert_status",
        ${riskLevel}::"aml_risk_level",
        ${`AML Alert: ${rnd(["Structuring detected", "Threshold exceeded", "Velocity breach", "High-risk country", "PEP transaction", "Unusual pattern"])}`},
        ${`Automated alert triggered by rule monitoring. Subject: ${rnd(NIGERIAN_NAMES)}. Amount: ₦${rndInt(1000000, 50000000).toLocaleString()}.`},
        ${rndFloat(100000, 50000000)}, ${rnd(userIds)},
        ${daysAgo(rndInt(0, 60))}, ${daysAgo(rndInt(0, 30))}
      )
      ON CONFLICT ("alertRef") DO NOTHING
    `);
  }
}

async function seedSwiftMessages() {
  console.log("  → swiftMessages (30 records)");
  const messageTypes = ["MT103", "MT202", "MT202COV", "MT940", "MT950", "MT900", "MT910"] as const;
  const statuses = ["received", "processing", "completed", "failed", "rejected", "pending_compliance"] as const;
  const bics = ["CHASUS33XXX", "DEUTDEDBXXX", "SCBLGB2LXXX", "CITIUS33XXX", "MIDLGB22XXX", "ACCESSNGLA", "ZENITHNGLA", "GTBINGLA"];
  for (let i = 1; i <= 30; i++) {
    const amount = rndFloat(10000, 5000000);
    const currency = rnd(["USD", "EUR", "GBP"]);
    await db.execute(sql`
      INSERT INTO swift_messages (
        uetr, "messageType", status, "senderBic", "receiverBic",
        amount, currency, "valueDate", "orderingCustomer", "beneficiaryCustomer",
        "remittanceInfo", "complianceStatus", "createdAt", "updatedAt"
      ) VALUES (
        ${uuid()}, ${rnd(messageTypes)}::"swift_message_type", ${rnd(statuses)}::"swift_message_status",
        ${rnd(bics)}, ${rnd(bics)},
        ${amount}, ${currency}, ${daysAgo(rndInt(0, 30))},
        ${rnd(NIGERIAN_NAMES)}, ${rnd(NIGERIAN_NAMES)},
        ${`/ROC/${uuid().slice(0, 8)} Trade settlement payment`},
        ${rnd(["pending", "cleared", "flagged"])},
        ${daysAgo(rndInt(0, 60))}, ${daysAgo(rndInt(0, 30))}
      )
      ON CONFLICT (uetr) DO NOTHING
    `);
  }
}

async function seedSepaPayments() {
  console.log("  → sepaPayments (20 records)");
  const paymentTypes = ["credit_transfer", "direct_debit", "instant_credit"] as const;
  const statuses = ["pending", "accepted", "rejected", "returned", "settled"] as const;
  const europeanNames = ["Hans Müller", "Marie Dupont", "Giovanni Rossi", "Ana García", "Jan Kowalski", "Sofia Andersen", "Luca Bianchi", "Emma Johansson"];
  for (let i = 1; i <= 20; i++) {
    const amount = rndFloat(100, 50000);
    await db.execute(sql`
      INSERT INTO sepa_payments (
        "endToEndId", "paymentType", status, amount, currency,
        "debtorName", "debtorIban", "debtorBic",
        "creditorName", "creditorIban", "creditorBic",
        "remittanceInfo", "executionDate", "settlementDate", "createdAt"
      ) VALUES (
        ${`SEPA${Date.now()}${i}`}, ${rnd(paymentTypes)}::"sepa_payment_type", ${rnd(statuses)}::"sepa_payment_status",
        ${amount}, 'EUR',
        ${rnd(europeanNames)}, ${`DE${rndInt(10, 99)}${rndInt(100000000, 999999999)}${rndInt(1000000000, 9999999999)}`}, 'DEUTDEDBXXX',
        ${rnd(europeanNames)}, ${`GB${rndInt(10, 99)}NWBK${rndInt(10000000, 99999999)}${rndInt(10000000, 99999999)}`}, 'NWBKGB2LXXX',
        ${`Invoice payment ${uuid().slice(0, 8)}`},
        ${daysAgo(rndInt(0, 30))}, ${daysAgo(rndInt(0, 7))}, ${daysAgo(rndInt(0, 30))}
      )
      ON CONFLICT ("endToEndId") DO NOTHING
    `);
  }
}

async function seedTravelRuleRecords() {
  console.log("  → travelRuleRecords (15 records)");
  const statuses = ["pending", "sent", "acknowledged", "rejected", "exempted"] as const;
  for (let i = 1; i <= 15; i++) {
    await db.execute(sql`
      INSERT INTO travel_rule_records (
        "recordRef", status, "thresholdAmount", currency,
        "originatorName", "originatorAccount", "originatorAddress", "originatorCountry", "originatorId",
        "beneficiaryName", "beneficiaryAccount", "beneficiaryAddress", "beneficiaryCountry",
        vasp, "createdAt"
      ) VALUES (
        ${ref("TR", i + 1000)}, ${rnd(statuses)}::"travel_rule_status",
        ${rndFloat(1000, 50000)}, ${rnd(["USD", "EUR"])},
        ${rnd(NIGERIAN_NAMES)}, ${`0${rndInt(10, 99)}${rndInt(10000000, 99999999)}`},
        ${`${rndInt(1, 200)} ${rnd(["Victoria Island", "Lekki", "Ikeja", "Abuja"])} Lagos, Nigeria`},
        'NG', ${uuid().slice(0, 16)},
        ${rnd(NIGERIAN_NAMES)}, ${`0${rndInt(10, 99)}${rndInt(10000000, 99999999)}`},
        ${`${rndInt(1, 500)} ${rnd(["Main Street", "Park Avenue", "High Street", "Broad Street"])}`},
        ${rnd(COUNTRIES)},
        ${rnd(["Binance", "Coinbase", "Kraken", "Bitfinex", "LocalBitcoins"])},
        ${daysAgo(rndInt(0, 60))}
      )
      ON CONFLICT ("recordRef") DO NOTHING
    `);
  }
}

async function seedSarFilings(userIds: number[], investigationIds: number[]) {
  console.log("  → sarFilings (20 records)");
  const statuses = ["draft", "under_review", "approved", "rejected", "filed", "acknowledged", "withdrawn"] as const;
  const categories = ["money_laundering", "terrorist_financing", "fraud", "corruption", "tax_evasion", "sanctions_evasion", "cybercrime", "other"] as const;
  for (let i = 1; i <= 20; i++) {
    const status = rnd(statuses);
    const amount = rndFloat(500000, 100000000);
    await db.execute(sql`
      INSERT INTO sar_filings (
        "sarRef", status, category, title, narrative,
        "subjectName", "subjectNin", "subjectBvn", "subjectAddress", "subjectOccupation",
        "suspiciousAmount", "suspiciousCurrency",
        "activityStartDate", "activityEndDate",
        "relatedInvestigationId", "createdBy",
        "filedWith", "filingReference",
        "createdAt", "updatedAt"
      ) VALUES (
        ${ref("SAR", i + 1000)}, ${status}::"sar_status", ${rnd(categories)}::"sar_category",
        ${`SAR: ${rnd(["Suspected money laundering via real estate", "Unusual cash structuring pattern", "Suspected terrorist financing", "Fraudulent wire transfer scheme", "Corruption-related fund movement"])}`},
        ${`Subject ${rnd(NIGERIAN_NAMES)} has been identified conducting suspicious financial activities. Multiple transactions totaling ₦${amount.toLocaleString()} were observed over a ${rndInt(30, 180)}-day period. The transactions show patterns consistent with layering and structuring. Enhanced due diligence was conducted and the findings support the filing of this SAR with the NFIU.`},
        ${rnd(NIGERIAN_NAMES)}, ${`${rndInt(10000000000, 99999999999)}`}, ${`${rndInt(10000000000, 99999999999)}`},
        ${`${rndInt(1, 200)} ${rnd(["Victoria Island", "Lekki", "Ikeja", "Abuja", "Port Harcourt"])} Nigeria`},
        ${rnd(["Business Owner", "Civil Servant", "Trader", "Contractor", "Politician", "Banker"])},
        ${amount}, 'NGN',
        ${daysAgo(rndInt(90, 365))}, ${daysAgo(rndInt(0, 90))},
        ${investigationIds.length > 0 ? rnd(investigationIds) : null},
        ${rnd(userIds)}, 'NFIU',
        ${status === "filed" || status === "acknowledged" ? `NFIU-${rndInt(100000, 999999)}` : null},
        ${daysAgo(rndInt(0, 90))}, ${daysAgo(rndInt(0, 30))}
      )
      ON CONFLICT ("sarRef") DO NOTHING
    `);
  }
}

async function seedLettersOfCredit(userIds: number[]) {
  console.log("  → lettersOfCredit (15 records)");
  const types = ["sight", "usance", "deferred", "revolving", "standby"] as const;
  const statuses = ["draft", "issued", "advised", "confirmed", "amended", "presented", "accepted", "paid", "discrepant", "rejected", "expired"] as const;
  const goods = ["Agricultural commodities", "Petroleum products", "Industrial machinery", "Pharmaceutical supplies", "Electronics and components", "Textile and garments", "Steel and metals", "Chemical products"];
  const ports = ["Lagos Port", "Apapa Port", "Tin Can Island Port", "Port Harcourt Port", "Onne Port"];
  const foreignPorts = ["Rotterdam", "Hamburg", "Shanghai", "Singapore", "Dubai", "Antwerp", "Houston"];
  for (let i = 1; i <= 15; i++) {
    const amount = rndFloat(100000, 10000000);
    const currency = rnd(["USD", "EUR", "GBP"]);
    await db.execute(sql`
      INSERT INTO letters_of_credit (
        "lcRef", type, status, amount, currency,
        "applicantName", "applicantBank", "applicantCountry",
        "beneficiaryName", "beneficiaryBank", "beneficiaryCountry",
        "issuingBank", "advisingBank", "confirmingBank",
        "goodsDescription", "portOfLoading", "portOfDischarge",
        "latestShipmentDate", "expiryDate", "presentationPeriod",
        "createdBy", "createdAt", "updatedAt"
      ) VALUES (
        ${ref("LC", i + 1000)}, ${rnd(types)}::"lc_type", ${rnd(statuses)}::"lc_status",
        ${amount}, ${currency},
        ${rnd(NIGERIAN_NAMES)}, ${rnd(NIGERIAN_BANKS)}, 'NG',
        ${rnd(["John Smith Trading", "Euro Exports GmbH", "Asia Pacific Ltd", "Global Commodities Inc"])},
        ${rnd(["Deutsche Bank", "HSBC", "Citibank", "Standard Chartered"])},
        ${rnd(["DE", "GB", "US", "CN", "AE"])},
        ${rnd(NIGERIAN_BANKS)}, ${rnd(["Standard Chartered", "HSBC"])}, ${rnd(["Citibank", "JPMorgan"])},
        ${rnd(goods)}, ${rnd(foreignPorts)}, ${rnd(ports)},
        ${daysFromNow(rndInt(30, 180))}, ${daysFromNow(rndInt(60, 210))}, 21,
        ${rnd(userIds)}, ${daysAgo(rndInt(0, 90))}, ${daysAgo(rndInt(0, 30))}
      )
      ON CONFLICT ("lcRef") DO NOTHING
    `);
  }
}

async function seedGoamlFilings(userIds: number[]) {
  console.log("  → goamlFilings (15 records)");
  const statuses = ["draft", "submitted", "accepted", "rejected", "pending_review"] as const;
  for (let i = 1; i <= 15; i++) {
    const status = rnd(statuses);
    await db.execute(sql`
      INSERT INTO goaml_filings (
        "filingRef", status, "reportType", "subjectName", "subjectBvn", "subjectNin",
        "subjectAccountNumber", "subjectBank", "transactionDate", "transactionAmount",
        "transactionCurrency", "suspiciousActivity", "narrativeDetails",
        "goamlReferenceNumber", "submittedAt", "createdBy", "createdAt", "updatedAt"
      ) VALUES (
        ${ref("STR", i + 1000)}, ${status}::"str_status", 'STR',
        ${rnd(NIGERIAN_NAMES)}, ${`${rndInt(10000000000, 99999999999)}`}, ${`${rndInt(10000000000, 99999999999)}`},
        ${`0${rndInt(10, 99)}${rndInt(10000000, 99999999)}`}, ${rnd(NIGERIAN_BANKS)},
        ${daysAgo(rndInt(1, 90))}, ${rndFloat(500000, 50000000)}, 'NGN',
        ${rnd(["Multiple cash deposits below CTR threshold", "Rapid movement of funds through multiple accounts", "Unusual international wire transfers", "Suspected structuring activity", "PEP-related transaction"])},
        ${`Detailed narrative: The subject has been conducting suspicious financial activities. Analysis of transaction patterns over the past ${rndInt(30, 180)} days reveals behavior consistent with money laundering typologies as defined under the Money Laundering (Prevention and Prohibition) Act 2022.`},
        ${status === "accepted" ? `NFIU-STR-${rndInt(100000, 999999)}` : null},
        ${status === "submitted" || status === "accepted" ? daysAgo(rndInt(0, 30)) : null},
        ${rnd(userIds)}, ${daysAgo(rndInt(0, 90))}, ${daysAgo(rndInt(0, 30))}
      )
      ON CONFLICT ("filingRef") DO NOTHING
    `);
  }
}

async function seedCasesAndRelated(userIds: number[], investigationIds: number[]) {
  console.log("  → cases + caseParties + caseDocuments + caseTimeline + caseStakeholders + caseComments");
  const caseTypes = ["fraud", "aml", "kyc_failure", "sanctions", "corruption", "cyber", "regulatory", "other"] as const;
  const caseStatuses = ["draft", "open", "under_review", "pending_decision", "closed", "archived"] as const;
  const priorities = ["low", "medium", "high", "critical"] as const;
  const caseIds: number[] = [];

  for (let i = 1; i <= 25; i++) {
    const status = rnd(caseStatuses);
    const result = await db.execute(sql`
      INSERT INTO cases (
        ref, title, type, status, priority, summary, "legalBasis", jurisdiction,
        "regulatoryFramework", "leadAnalystId", "tenantId", "investigationRefs",
        tags, "dueAt", "riskScore", "createdBy", "createdAt", "updatedAt"
      ) VALUES (
        ${ref("CASE", i + 1000)},
        ${`${rnd(["Investigation into", "Enforcement action:", "Compliance review:", "Regulatory inquiry:"])} ${rnd(NIGERIAN_NAMES)} - ${rnd(["Money Laundering", "Fraud", "KYC Failure", "Sanctions Evasion", "Corruption", "Cybercrime"])}`},
        ${rnd(caseTypes)}::"case_type", ${status}::"case_status", ${rnd(priorities)}::"case_priority",
        ${`This case was opened following ${rnd(["an AML alert", "a regulatory referral", "a suspicious activity report", "a field investigation finding", "a whistleblower tip"])}. The subject has been identified as ${rnd(NIGERIAN_NAMES)} with connections to ${rnd(["real estate", "cryptocurrency", "import/export", "construction", "government contracts"])}.`},
        ${rnd(["MLPPA 2022 s.15", "EFCC Act 2004 s.6", "CBN AML/CFT Regulations 2013", "FATF Recommendation 16", "CAMA 2020 s.131"])},
        ${rnd(["Lagos", "Abuja", "Federal Republic of Nigeria", "International"])},
        ${rnd(["CBN AML/CFT Framework", "NFIU Guidelines", "FATF 40 Recommendations", "Basel AML Index"])},
        ${rnd(userIds)}, 1,
        ${JSON.stringify(investigationIds.slice(0, rndInt(0, 3)).map(id => ref("INV", id + 1000)))}::jsonb,
        ${JSON.stringify(rnd([["aml", "high-risk"], ["fraud", "urgent"], ["kyc", "pep"], ["sanctions", "critical"], ["cyber", "ongoing"]]))}::jsonb,
        ${daysFromNow(rndInt(7, 90))}, ${rndInt(20, 95)},
        ${rnd(userIds)}, ${daysAgo(rndInt(0, 180))}, ${daysAgo(rndInt(0, 30))}
      )
      ON CONFLICT (ref) DO NOTHING
      RETURNING id
    `);
    if (result.rows.length > 0) {
      const caseId = (result.rows[0] as any).id;
      caseIds.push(caseId);

      // Case Parties
      for (let j = 0; j < rndInt(1, 4); j++) {
        const roles = ["subject", "witness", "associate", "victim", "entity"] as const;
        await db.execute(sql`
          INSERT INTO case_parties ("caseId", role, name, nin, bvn, phone, email, address, "entityType", notes, "addedBy", "createdAt")
          VALUES (
            ${caseId}, ${rnd(roles)}::"case_party_role",
            ${rnd(NIGERIAN_NAMES)}, ${`${rndInt(10000000000, 99999999999)}`}, ${`${rndInt(10000000000, 99999999999)}`},
            ${`0${rndInt(700, 909)}${rndInt(1000000, 9999999)}`}, ${`contact${rndInt(1000, 9999)}@email.com`},
            ${`${rndInt(1, 200)} ${rnd(["Victoria Island", "Lekki", "Ikeja", "Abuja"])} Nigeria`},
            ${rnd(["individual", "corporate", "government"])},
            ${`Party identified through ${rnd(["field investigation", "database search", "informant tip", "document analysis"])}`},
            ${rnd(userIds)}, ${daysAgo(rndInt(0, 90))}
          )
          ON CONFLICT DO NOTHING
        `);
      }

      // Case Timeline
      const eventTypes = ["case_created", "status_changed", "party_added", "document_uploaded", "comment_added", "investigation_linked", "alert_triggered", "decision_recorded"] as const;
      for (let j = 0; j < rndInt(2, 6); j++) {
        const eventType = rnd(eventTypes);
        await db.execute(sql`
          INSERT INTO case_timeline ("caseId", "eventType", title, detail, "actorId", "actorName", "actorRole", "createdAt")
          VALUES (
            ${caseId}, ${eventType}::"case_timeline_event_type",
            ${`${eventType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}: ${rnd(["Completed", "Updated", "Reviewed", "Escalated", "Resolved"])}`},
            ${JSON.stringify({ note: `Action taken by analyst on ${new Date().toISOString().split("T")[0]}` })}::jsonb,
            ${rnd(userIds)}, ${rnd(["Analyst A", "Compliance Officer", "Senior Investigator", "Case Manager"])},
            ${rnd(["analyst", "compliance_officer", "investigator", "manager"])},
            ${daysAgo(rndInt(0, 90))}
          )
          ON CONFLICT DO NOTHING
        `);
      }

      // Case Comments
      for (let j = 0; j < rndInt(1, 4); j++) {
        await db.execute(sql`
          INSERT INTO case_comments ("caseId", content, "authorId", "authorName", "authorRole", confidential, "createdAt", "updatedAt")
          VALUES (
            ${caseId},
            ${rnd([
              "Initial review completed. Subject's transaction history shows unusual patterns consistent with structuring.",
              "Field verification confirmed the subject's address. Physical surveillance conducted for 3 days.",
              "Legal team has been briefed. Preparing for potential prosecution referral.",
              "Additional documents received from correspondent bank. Analysis ongoing.",
              "Risk score updated following new intelligence. Case escalated to senior management.",
              "Compliance committee reviewed and approved the SAR filing.",
              "Subject has been placed on enhanced monitoring. All transactions to be reviewed manually.",
            ])},
            ${rnd(userIds)}, ${rnd(["John Adeyemi", "Fatima Suleiman", "Emeka Okafor", "Chioma Nwosu"])},
            ${rnd(["analyst", "compliance_officer", "investigator", "manager"])},
            ${Math.random() > 0.7},
            ${daysAgo(rndInt(0, 90))}, ${daysAgo(rndInt(0, 30))}
          )
          ON CONFLICT DO NOTHING
        `);
      }

      // Case Stakeholders
      const stakeholderRoles = ["lead_analyst", "reviewer", "external_counsel", "regulator", "compliance_officer"] as const;
      await db.execute(sql`
        INSERT INTO case_stakeholders ("caseId", role, name, email, "invitedBy", "createdAt")
        VALUES (
          ${caseId}, ${rnd(stakeholderRoles)}::"case_stakeholder_role",
          ${rnd(NIGERIAN_NAMES)}, ${`stakeholder${rndInt(1000, 9999)}@bis.ng`},
          ${rnd(userIds)}, ${daysAgo(rndInt(0, 90))}
        )
        ON CONFLICT DO NOTHING
      `);
    }
  }

  // Investigation-Case Links
  if (caseIds.length > 0 && investigationIds.length > 0) {
    for (let i = 0; i < Math.min(15, caseIds.length); i++) {
      await db.execute(sql`
        INSERT INTO investigation_case_links ("investigationId", "caseId", "linkedBy", notes, "createdAt")
        VALUES (
          ${rnd(investigationIds)}, ${caseIds[i]}, ${rnd(userIds)},
          ${`Linked during ${rnd(["initial triage", "enhanced review", "cross-referencing", "pattern analysis"])}`},
          ${daysAgo(rndInt(0, 90))}
        )
        ON CONFLICT DO NOTHING
      `);
    }
  }
}

async function seedEvidenceItems(userIds: number[], caseIds: number[]) {
  console.log("  → evidenceItems (30 records)");
  const types = ["document", "photo", "video", "audio", "digital_artifact", "financial_record", "witness_statement", "communication_log"] as const;
  const statuses = ["collected", "in_transit", "secured", "analyzed", "submitted"] as const;
  for (let i = 1; i <= 30; i++) {
    await db.execute(sql`
      INSERT INTO evidence_items (
        "evidenceRef", "caseId", type, status, title, description,
        "fileUrl", "fileHash", "fileSize", "mimeType",
        "collectedBy", "collectedAt", "collectionLocation",
        "chainOfCustody", "integrityVerified", "createdAt", "updatedAt"
      ) VALUES (
        ${ref("EVD", i + 1000)},
        ${caseIds.length > 0 ? rnd(caseIds) : null},
        ${rnd(types)}::"evidence_type", ${rnd(statuses)}::"evidence_status",
        ${rnd(["Bank Statement", "Property Deed", "Corporate Registration", "Phone Records", "Email Correspondence", "CCTV Footage", "Witness Statement", "Financial Audit Report", "Travel Records", "Asset Declaration"])},
        ${`Evidence collected during ${rnd(["field investigation", "digital forensics", "document review", "witness interview", "premises search"])}. Collected from ${rnd(["subject's residence", "business premises", "bank branch", "government office", "digital device"])}.`},
        ${`https://storage.bis.ng/evidence/${uuid()}.pdf`},
        ${uuid().replace(/-/g, "").slice(0, 64)},
        ${rndInt(10000, 10000000)}, ${rnd(["application/pdf", "image/jpeg", "video/mp4", "audio/mp3", "application/vnd.ms-excel"])},
        ${rnd(userIds)}, ${daysAgo(rndInt(0, 90))},
        ${rnd(["Lagos Office", "Abuja Field Office", "Port Harcourt Branch", "Digital Forensics Lab"])},
        ${JSON.stringify([{ action: "collected", by: "Field Agent", at: new Date().toISOString() }, { action: "secured", by: "Evidence Custodian", at: new Date().toISOString() }])}::jsonb,
        ${Math.random() > 0.4},
        ${daysAgo(rndInt(0, 90))}, ${daysAgo(rndInt(0, 30))}
      )
      ON CONFLICT ("evidenceRef") DO NOTHING
    `);
  }
}

async function seedRegulatoryReports(userIds: number[]) {
  console.log("  → regulatoryReports (15 records)");
  const reportTypes = ["CTR", "STR", "goAML_XML", "NFIU_monthly", "CBN_quarterly", "FATF_travel_rule", "PEP_disclosure", "sanctions_screening", "annual_AML_report"] as const;
  const statuses = ["draft", "generated", "reviewed", "submitted", "acknowledged", "rejected"] as const;
  for (let i = 1; i <= 15; i++) {
    const status = rnd(statuses);
    const type = rnd(reportTypes);
    const periodStart = daysAgo(rndInt(30, 365));
    const periodEnd = daysAgo(rndInt(0, 30));
    await db.execute(sql`
      INSERT INTO regulatory_reports (
        "reportRef", type, status, title, "periodStart", "periodEnd",
        "regulatorName", "submissionDeadline", "fileUrl",
        "submittedAt", "submittedBy", "acknowledgementRef",
        "createdBy", "createdAt", "updatedAt"
      ) VALUES (
        ${ref("REG", i + 1000)}, ${type}::"regulatory_report_type", ${status}::"regulatory_report_status",
        ${`${type} Report — ${periodStart.toISOString().slice(0, 7)} to ${periodEnd.toISOString().slice(0, 7)}`},
        ${periodStart}, ${periodEnd},
        ${rnd(["NFIU", "CBN", "FATF", "EFCC", "SEC Nigeria"])},
        ${daysFromNow(rndInt(7, 30))},
        ${status === "submitted" || status === "acknowledged" ? `https://storage.bis.ng/reports/${uuid()}.pdf` : null},
        ${status === "submitted" || status === "acknowledged" ? daysAgo(rndInt(0, 14)) : null},
        ${status === "submitted" || status === "acknowledged" ? rnd(userIds) : null},
        ${status === "acknowledged" ? `ACK-${rndInt(100000, 999999)}` : null},
        ${rnd(userIds)}, ${daysAgo(rndInt(0, 90))}, ${daysAgo(rndInt(0, 30))}
      )
      ON CONFLICT ("reportRef") DO NOTHING
    `);
  }
}

async function seedSocialMonitoring(userIds: number[]) {
  console.log("  → socialMonitorConfigs + socialMentions");
  const platforms = ["twitter", "facebook", "instagram", "tiktok", "linkedin", "news", "youtube"] as const;
  const monitorIds: number[] = [];
  const configs = [
    { name: "High-Profile Subject Monitor", keywords: "Emeka Okafor, money laundering, fraud", platforms: "twitter,facebook,news" },
    { name: "Crypto Fraud Keywords", keywords: "bitcoin scam, crypto fraud, investment fraud Nigeria", platforms: "twitter,telegram,youtube" },
    { name: "PEP Monitoring — Politicians", keywords: "government contract fraud, embezzlement, kickback", platforms: "twitter,facebook,news,linkedin" },
    { name: "BIS Brand Monitoring", keywords: "BIS Nigeria, Bureau of Investigation, financial crime Nigeria", platforms: "twitter,facebook,news" },
    { name: "Terrorism Financing Keywords", keywords: "terrorist financing, hawala, informal value transfer", platforms: "twitter,facebook,news" },
  ];
  for (const c of configs) {
    const result = await db.execute(sql`
      INSERT INTO social_monitor_configs (name, keywords, platforms, "isActive", "alertThreshold", "totalMentions", "criticalMentions", "createdBy", "createdAt", "updatedAt")
      VALUES (${c.name}, ${c.keywords}, ${c.platforms}, true, ${rndInt(50, 90)}, ${rndInt(10, 500)}, ${rndInt(0, 20)}, ${userIds[0]}, ${daysAgo(rndInt(30, 180))}, ${daysAgo(rndInt(0, 30))})
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    if (result.rows.length > 0) monitorIds.push((result.rows[0] as any).id);
  }
  // Social Mentions
  const sentiments = ["positive", "neutral", "negative", "critical"] as const;
  const sampleContent = [
    "Breaking: Nigerian businessman arrested for alleged money laundering involving ₦2.3 billion",
    "EFCC arrests 15 suspects in major cryptocurrency fraud scheme targeting investors",
    "CBN issues warning on suspicious financial activities in real estate sector",
    "Investigation reveals complex web of shell companies used for fund laundering",
    "Whistleblower exposes government contractor's fraudulent billing scheme",
    "Social media influencer charged with promoting unlicensed investment scheme",
    "Bank employee arrested for facilitating ₦500M fraud through insider access",
    "International wire transfer fraud ring dismantled by joint EFCC-Interpol operation",
  ];
  for (let i = 0; i < 40; i++) {
    await db.execute(sql`
      INSERT INTO social_mentions (
        "monitorId", platform, content, author, "authorHandle", "externalUrl",
        sentiment, "riskScore", keywords, "engagementCount", "isVerified",
        language, "isAcknowledged", "publishedAt", "createdAt"
      ) VALUES (
        ${monitorIds.length > 0 ? rnd(monitorIds) : 1},
        ${rnd(platforms)}::"social_platform",
        ${rnd(sampleContent)},
        ${rnd(NIGERIAN_NAMES)}, ${`@user${rndInt(1000, 9999)}`},
        ${`https://twitter.com/user${rndInt(1000, 9999)}/status/${rndInt(1000000000, 9999999999)}`},
        ${rnd(sentiments)}::"mention_sentiment",
        ${rndInt(10, 95)}, ${rnd(["money laundering", "fraud", "crypto scam", "corruption"])},
        ${rndInt(0, 10000)}, ${Math.random() > 0.7},
        'en', ${Math.random() > 0.5},
        ${daysAgo(rndInt(0, 30))}, ${daysAgo(rndInt(0, 30))}
      )
      ON CONFLICT DO NOTHING
    `);
  }
}

async function seedFieldAgentPlaybooks() {
  console.log("  → fieldAgentPlaybooks");
  const playbooks = [
    {
      title: "KYC Physical Verification — Individual",
      category: "kyc_physical",
      description: "Standard operating procedure for physical verification of individual KYC documents at subject's stated address.",
      estimatedHours: 4,
      requiredTier: "junior",
      steps: "1. Confirm appointment with subject\n2. Travel to stated address\n3. Verify government-issued ID (NIN slip, passport, driver's license)\n4. Photograph subject with ID\n5. Verify address with utility bill or bank statement\n6. Capture GPS coordinates\n7. Complete field report\n8. Upload all documents to platform",
      dataToCollect: "Full name, NIN, BVN, address proof, selfie with ID, GPS coordinates, property photos",
      safetyNotes: "Always inform supervisor before visiting high-risk areas. Travel in pairs for Level 3+ investigations.",
      legalNotes: "Subject must provide informed consent. Do not enter premises without invitation.",
      nigeriaContext: "Be aware of area boys in Lagos. Verify through community leaders in northern states.",
    },
    {
      title: "KYB Business Premises Verification",
      category: "kyb_premises",
      description: "Verification of business premises, operations, and key personnel for corporate KYB.",
      estimatedHours: 6,
      requiredTier: "senior",
      steps: "1. Review CAC registration documents\n2. Visit registered business address\n3. Verify physical operations match stated business\n4. Interview key personnel\n5. Photograph premises and signage\n6. Verify utility connections\n7. Check for subletting or shared premises\n8. Complete KYB report",
      dataToCollect: "CAC number, directors list, premises photos, employee count, business activity evidence",
      safetyNotes: "Carry official BIS identification. Do not conduct visits after 6pm.",
      legalNotes: "Corporate verification requires consent from authorized director or company secretary.",
      nigeriaContext: "Many SMEs operate from residential addresses. Verify through CAC records first.",
    },
    {
      title: "Asset Verification — Real Estate",
      category: "asset_verification",
      description: "Physical verification and valuation of real estate assets declared by investigation subjects.",
      estimatedHours: 8,
      requiredTier: "senior",
      steps: "1. Obtain property details from investigation file\n2. Search land registry records\n3. Visit property location\n4. Photograph property from multiple angles\n5. Interview neighbors and local community\n6. Verify ownership documents\n7. Estimate market value\n8. Document any discrepancies",
      dataToCollect: "Title deed, survey plan, property photos, GPS coordinates, estimated value, ownership history",
      safetyNotes: "Engage local security if property is in high-risk area.",
      legalNotes: "Do not trespass. Verify through public records and external observation only.",
      nigeriaContext: "Check with Abuja GIS for FCT properties. Lagos State Land Bureau for Lagos properties.",
    },
    {
      title: "Surveillance — Subject Activity Monitoring",
      category: "surveillance",
      description: "Covert observation of investigation subject's movements and activities.",
      estimatedHours: 12,
      requiredTier: "lead",
      steps: "1. Obtain surveillance authorization from supervisor\n2. Brief team on subject profile\n3. Establish observation posts\n4. Document movements with timestamps\n5. Photograph meetings and associates\n6. Note vehicles and registration numbers\n7. Compile daily surveillance log\n8. Report significant findings immediately",
      dataToCollect: "Movement log, associate contacts, vehicle details, location data, photographic evidence",
      safetyNotes: "Maintain counter-surveillance awareness. Abort if compromised. Emergency extraction protocol in place.",
      legalNotes: "Surveillance must be authorized by senior management. Do not conduct electronic surveillance without legal clearance.",
      nigeriaContext: "Be aware of private security in Lekki/VI. Use public transport for covert operations.",
    },
    {
      title: "Evidence Collection — Digital Forensics",
      category: "evidence_collection",
      description: "Collection and preservation of digital evidence from electronic devices.",
      estimatedHours: 16,
      requiredTier: "specialist",
      steps: "1. Obtain legal authorization for device seizure\n2. Document device condition before collection\n3. Create forensic image of storage media\n4. Verify hash integrity\n5. Store in evidence bag with tamper seal\n6. Complete chain of custody form\n7. Transport to forensics lab\n8. Upload metadata to platform",
      dataToCollect: "Device details, serial numbers, hash values, chain of custody signatures, forensic images",
      safetyNotes: "Wear anti-static gloves. Do not power on devices without forensic preparation.",
      legalNotes: "Digital evidence collection requires court order or subject consent. Follow ACPO guidelines.",
      nigeriaContext: "Nigerian courts accept digital evidence under Evidence Act 2011 s.84.",
    },
    {
      title: "Witness Interview — Financial Crime",
      category: "interview",
      description: "Structured interview of witnesses in financial crime investigations.",
      estimatedHours: 3,
      requiredTier: "senior",
      steps: "1. Prepare interview questions based on case file\n2. Explain witness rights and protections\n3. Conduct PEACE model interview\n4. Record interview with consent\n5. Obtain signed statement\n6. Assess credibility and corroboration needs\n7. Debrief with supervisor\n8. Upload statement to case file",
      dataToCollect: "Signed statement, audio recording, witness contact details, credibility assessment",
      safetyNotes: "Conduct interviews in safe, neutral locations. Have support available for distressed witnesses.",
      legalNotes: "Witnesses cannot be compelled to testify in civil matters. Criminal matters follow ACJA 2015.",
      nigeriaContext: "Witness protection program available for high-risk cases. Contact NFIU for referral.",
    },
  ];
  for (const p of playbooks) {
    await db.execute(sql`
      INSERT INTO field_agent_playbooks (title, category, description, "estimatedHours", "requiredTier", steps, "dataToCollect", "safetyNotes", "legalNotes", "nigeriaContext", "isActive", version, "createdAt", "updatedAt")
      VALUES (
        ${p.title}, ${p.category}::"playbook_category", ${p.description}, ${p.estimatedHours},
        ${p.requiredTier}::"agent_tier", ${p.steps}, ${p.dataToCollect},
        ${p.safetyNotes}, ${p.legalNotes}, ${p.nigeriaContext}, true, 1,
        ${daysAgo(rndInt(30, 365))}, ${daysAgo(rndInt(0, 30))}
      )
      ON CONFLICT DO NOTHING
    `);
  }
}

async function seedLexData(userIds: number[]) {
  console.log("  → lexAgencies + lexSubmitters + lexSubmissions");
  const agencyTypes = ["npf", "efcc", "icpc", "dss", "nscdc", "customs", "immigration", "other"] as const;
  const agencyIds: number[] = [];
  const agencies = [
    { agencyCode: "NPF-LAG-001", name: "Nigeria Police Force — Lagos State Command", type: "npf", state: "LA", lga: "Ikeja", commandUnit: "State CID" },
    { agencyCode: "EFCC-ABJ-001", name: "EFCC — Abuja Zonal Office", type: "efcc", state: "FC", lga: "Central Area", commandUnit: "Financial Crimes Unit" },
    { agencyCode: "ICPC-ABJ-001", name: "ICPC — Headquarters", type: "icpc", state: "FC", lga: "Wuse", commandUnit: "Investigation Department" },
    { agencyCode: "DSS-LAG-001", name: "DSS — Lagos State Office", type: "dss", state: "LA", lga: "Victoria Island", commandUnit: "Counter-Intelligence" },
    { agencyCode: "NSCDC-KD-001", name: "NSCDC — Kaduna State Command", type: "nscdc", state: "KD", lga: "Kaduna North", commandUnit: "Anti-Vandalism Unit" },
    { agencyCode: "NCS-APK-001", name: "Nigeria Customs Service — Apapa Port", type: "customs", state: "LA", lga: "Apapa", commandUnit: "Anti-Smuggling Unit" },
    { agencyCode: "NIS-MMA-001", name: "Nigeria Immigration Service — Murtala Airport", type: "immigration", state: "LA", lga: "Ikeja", commandUnit: "Border Control" },
    { agencyCode: "NPF-KN-001", name: "Nigeria Police Force — Kano State Command", type: "npf", state: "KN", lga: "Kano Municipal", commandUnit: "Criminal Investigation Department" },
  ];
  for (const a of agencies) {
    const result = await db.execute(sql`
      INSERT INTO lex_agencies ("agencyCode", name, type, state, lga, "commandUnit", "contactName", "contactPhone", "contactEmail", status, "registeredBy", "registeredAt")
      VALUES (
        ${a.agencyCode}, ${a.name}, ${a.type}::"lex_agency_type", ${a.state}::"nigerian_state",
        ${a.lga}, ${a.commandUnit},
        ${rnd(NIGERIAN_NAMES)}, ${`0${rndInt(700, 909)}${rndInt(1000000, 9999999)}`}, ${`agency${rndInt(1000, 9999)}@gov.ng`},
        'active'::"lex_agency_status", ${rnd(userIds)}, ${daysAgo(rndInt(30, 365))}
      )
      ON CONFLICT ("agencyCode") DO NOTHING
      RETURNING id
    `);
    if (result.rows.length > 0) agencyIds.push((result.rows[0] as any).id);
  }

  // LEX Submitters
  const submitterIds: number[] = [];
  const ranks = ["Constable", "Corporal", "Sergeant", "Inspector", "ASP", "SP", "CSP", "AIG", "DIG"];
  for (let i = 0; i < 20; i++) {
    const agencyId = agencyIds.length > 0 ? rnd(agencyIds) : 1;
    const result = await db.execute(sql`
      INSERT INTO lex_submitters ("submitterId", "agencyId", name, rank, phone, "pinHash", "reputationScore", status, "totalSubmissions", "validatedSubmissions", "rejectedSubmissions", "createdAt")
      VALUES (
        ${`LEX-${rndInt(100000, 999999)}`}, ${agencyId}, ${rnd(NIGERIAN_NAMES)}, ${rnd(ranks)},
        ${`0${rndInt(700, 909)}${rndInt(1000000, 9999999)}`},
        ${"$2b$10$hashedpin" + rndInt(100000, 999999)},
        ${rndInt(40, 95)}, 'active'::"lex_submitter_status",
        ${rndInt(0, 50)}, ${rndInt(0, 40)}, ${rndInt(0, 5)}, ${daysAgo(rndInt(30, 365))}
      )
      ON CONFLICT ("submitterId") DO NOTHING
      RETURNING id
    `);
    if (result.rows.length > 0) submitterIds.push((result.rows[0] as any).id);
  }

  // LEX Submissions
  const incidentTypes = ["arrest", "seizure", "witness_statement", "court_order", "intel_tip", "fraud", "cybercrime", "other"] as const;
  const submissionStatuses = ["pending", "under_review", "validated", "rejected", "escalated"] as const;
  for (let i = 1; i <= 30; i++) {
    await db.execute(sql`
      INSERT INTO lex_submissions (
        "submissionRef", "agencyId", "submitterId", channel, "incidentType",
        "incidentState", "incidentLga", "incidentAddress", "gpsLat", "gpsLng",
        "incidentDate", "subjectName", "subjectNin", "subjectPhone", "subjectAddress",
        narrative, status, "validationScore", "createdAt", "updatedAt"
      ) VALUES (
        ${ref("LEX", i + 1000)},
        ${agencyIds.length > 0 ? rnd(agencyIds) : 1},
        ${submitterIds.length > 0 ? rnd(submitterIds) : null},
        'web'::"lex_channel", ${rnd(incidentTypes)}::"lex_incident_type",
        ${rnd(STATES)}::"nigerian_state", ${rnd(["Ikeja", "Lekki", "Apapa", "Kano Municipal", "Wuse"])},
        ${`${rndInt(1, 200)} ${rnd(["Main Street", "Market Road", "Government Road"])} Nigeria`},
        ${rndFloat(3.3, 14.5, 6)}, ${rndFloat(3.1, 13.7, 6)},
        ${daysAgo(rndInt(0, 30))},
        ${rnd(NIGERIAN_NAMES)}, ${`${rndInt(10000000000, 99999999999)}`},
        ${`0${rndInt(700, 909)}${rndInt(1000000, 9999999)}`},
        ${`${rndInt(1, 200)} ${rnd(["Victoria Island", "Lekki", "Ikeja"])} Nigeria`},
        ${`Intelligence report: ${rnd(["Suspect observed conducting suspicious financial transactions", "Subject arrested in possession of counterfeit currency", "Witness statement regarding money laundering operation", "Court order obtained for asset freezing", "Intel tip regarding terrorist financing network"])}`},
        ${rnd(submissionStatuses)}::"lex_submission_status",
        ${rndInt(40, 95)},
        ${daysAgo(rndInt(0, 60))}, ${daysAgo(rndInt(0, 30))}
      )
      ON CONFLICT ("submissionRef") DO NOTHING
    `);
  }
}

async function seedDuplicateChecksAndHostedLinks(userIds: number[]) {
  console.log("  → duplicateIdentityChecks + hostedVerificationLinks");
  const checkStatuses = ["pending", "no_match", "possible_match", "confirmed_duplicate"] as const;
  for (let i = 0; i < 20; i++) {
    await db.execute(sql`
      INSERT INTO duplicate_identity_checks (
        "investigationRef", "subjectName", nin, bvn, phone, status,
        "matchCount", "confidenceScore", "requestedBy", "createdAt", "completedAt"
      ) VALUES (
        ${ref("INV", rndInt(1001, 1020))}, ${rnd(NIGERIAN_NAMES)},
        ${`${rndInt(10000000000, 99999999999)}`}, ${`${rndInt(10000000000, 99999999999)}`},
        ${`0${rndInt(700, 909)}${rndInt(1000000, 9999999)}`},
        ${rnd(checkStatuses)}::"duplicate_check_status",
        ${rndInt(0, 5)}, ${rndInt(0, 100)},
        ${rnd(userIds)}, ${daysAgo(rndInt(0, 60))}, ${Math.random() > 0.3 ? daysAgo(rndInt(0, 30)) : null}
      )
      ON CONFLICT DO NOTHING
    `);
  }
  // Hosted Verification Links
  const linkStatuses = ["active", "completed", "expired", "revoked"] as const;
  for (let i = 0; i < 15; i++) {
    await db.execute(sql`
      INSERT INTO hosted_verification_links (
        token, "tenantId", "investigationRef", "subjectName", "requiredChecks",
        "expiresAt", status, "completedAt", "createdBy", "createdAt"
      ) VALUES (
        ${uuid()}, 1, ${ref("INV", rndInt(1001, 1020))},
        ${rnd(NIGERIAN_NAMES)},
        ${rnd(["nin,bvn,liveness", "nin,bvn", "bvn,liveness", "nin,liveness,document"])},
        ${daysFromNow(rndInt(-7, 30))},
        ${rnd(linkStatuses)}::"hosted_link_status",
        ${Math.random() > 0.5 ? daysAgo(rndInt(0, 14)) : null},
        ${rnd(userIds)}, ${daysAgo(rndInt(0, 30))}
      )
      ON CONFLICT (token) DO NOTHING
    `);
  }
}

async function seedNotificationsAndSessions(userIds: number[]) {
  console.log("  → notifications + userSessions + userTotpSecrets");
  const notifTypes = ["alert", "case_update", "task_assigned", "report_ready", "system", "compliance", "payment"] as const;
  for (const userId of userIds.slice(0, 5)) {
    for (let i = 0; i < rndInt(3, 8); i++) {
      await db.execute(sql`
        INSERT INTO notifications ("userId", type, title, body, link, read, "createdAt")
        VALUES (
          ${userId}, ${rnd(notifTypes)},
          ${rnd(["New AML alert requires review", "Case CASE-001234 updated", "Field task assigned to you", "Monthly compliance report ready", "System maintenance scheduled", "New SAR filing approved", "Payment threshold exceeded"])},
          ${rnd(["A new high-risk transaction has been flagged for your review.", "Case status changed to Under Review. Please review and take action.", "You have been assigned a new field verification task.", "The monthly NFIU compliance report is ready for submission.", "System will undergo maintenance on Sunday 02:00-04:00 UTC."])},
          ${rnd(["/aml", "/cases", "/field-tasks", "/reports", "/payment-rails"])},
          ${Math.random() > 0.4},
          ${daysAgo(rndInt(0, 30))}
        )
        ON CONFLICT DO NOTHING
      `);
    }
    // User Sessions
    await db.execute(sql`
      INSERT INTO user_sessions ("userId", "sessionToken", "ipAddress", "userAgent", "deviceName", "lastActiveAt", "expiresAt", "createdAt")
      VALUES (
        ${userId}, ${uuid()},
        ${`${rndInt(102, 197)}.${rndInt(0, 255)}.${rndInt(0, 255)}.${rndInt(1, 254)}`},
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ${rnd(["Windows PC", "MacBook Pro", "iPhone 15", "Android Phone", "iPad"])},
        ${daysAgo(rndInt(0, 7))}, ${daysFromNow(rndInt(1, 30))}, ${daysAgo(rndInt(7, 30))}
      )
      ON CONFLICT ("sessionToken") DO NOTHING
    `);
  }
  // TOTP Secrets (for admin users)
  for (const userId of userIds.slice(0, 3)) {
    await db.execute(sql`
      INSERT INTO user_totp_secrets ("userId", secret, verified, "backupCodes", "enabledAt", "createdAt", "updatedAt")
      VALUES (
        ${userId}, ${`JBSWY3DPEHPK3PXP${rndInt(1000, 9999)}`}, true,
        ${JSON.stringify(Array.from({ length: 8 }, () => rndInt(10000000, 99999999).toString()))}::jsonb,
        ${daysAgo(rndInt(30, 180))}, ${daysAgo(rndInt(30, 180))}, ${daysAgo(rndInt(0, 30))}
      )
      ON CONFLICT ("userId") DO NOTHING
    `);
  }
}

async function seedApiTokensAndUsage(userIds: number[]) {
  console.log("  → apiTokens + tokenUsageLog + webhooks + exportSchedules");
  const tokenIds: number[] = [];
  const tokenData = [
    { name: "Production API Key", scopes: ["read:investigations", "write:investigations", "read:alerts"], rateLimit: 100, tokenQuota: 1000000 },
    { name: "Integration — NIBSS", scopes: ["read:transactions", "write:transactions", "read:kyc"], rateLimit: 500, tokenQuota: 5000000 },
    { name: "Sandbox Test Key", scopes: ["read:*", "write:*"], rateLimit: 60, tokenQuota: 100000 },
    { name: "Reporting Service", scopes: ["read:reports", "read:analytics"], rateLimit: 30, tokenQuota: 500000 },
    { name: "Webhook Consumer", scopes: ["read:webhooks"], rateLimit: 200, tokenQuota: 2000000 },
  ];
  for (const t of tokenData) {
    const result = await db.execute(sql`
      INSERT INTO api_tokens ("tenantId", name, prefix, "tokenHash", scopes, "rateLimit", "usageCount", "tokensConsumed", "tokenQuota", "lastUsedAt", "expiresAt", active, "createdBy", "createdAt", "updatedAt")
      VALUES (
        1, ${t.name}, ${`bisk_live_${uuid().slice(0, 8)}`},
        ${uuid().replace(/-/g, "").slice(0, 64)},
        ${JSON.stringify(t.scopes)}::jsonb, ${t.rateLimit},
        ${rndInt(100, 10000)}, ${rndInt(1000, 100000)}, ${t.tokenQuota},
        ${daysAgo(rndInt(0, 7))}, ${daysFromNow(rndInt(90, 365))},
        true, ${rnd(userIds)}, ${daysAgo(rndInt(30, 180))}, ${daysAgo(rndInt(0, 30))}
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    if (result.rows.length > 0) tokenIds.push((result.rows[0] as any).id);
  }
  // Token Usage Log
  for (const tokenId of tokenIds) {
    for (let i = 0; i < rndInt(5, 20); i++) {
      await db.execute(sql`
        INSERT INTO token_usage_log ("tokenId", endpoint, method, "statusCode", "latencyMs", "ipAddress", "createdAt")
        VALUES (
          ${tokenId},
          ${rnd(["/api/trpc/investigations.list", "/api/trpc/alerts.list", "/api/trpc/transactions.list", "/api/trpc/cases.list", "/api/trpc/aml.getAlerts"])},
          ${rnd(["GET", "POST", "PUT"])}, ${rnd([200, 200, 200, 201, 400, 401, 403, 429])},
          ${rndInt(50, 2000)},
          ${`${rndInt(102, 197)}.${rndInt(0, 255)}.${rndInt(0, 255)}.${rndInt(1, 254)}`},
          ${daysAgo(rndInt(0, 30))}
        )
        ON CONFLICT DO NOTHING
      `);
    }
  }
  // Webhooks
  const webhookEvents = [["alert.created", "alert.updated"], ["transaction.flagged", "transaction.completed"], ["case.created", "case.status_changed"], ["sar.filed", "sar.acknowledged"]];
  for (let i = 0; i < 5; i++) {
    await db.execute(sql`
      INSERT INTO webhooks ("tenantId", url, status, events, secret, "failureCount", "lastDeliveredAt", "createdAt")
      VALUES (
        1, ${`https://hooks.${rnd(["partner1", "partner2", "integration", "monitoring"])}.ng/bis-webhook`},
        'active'::"webhook_status",
        ${JSON.stringify(rnd(webhookEvents))}::jsonb,
        ${uuid().replace(/-/g, "").slice(0, 32)},
        ${rndInt(0, 5)}, ${daysAgo(rndInt(0, 7))}, ${daysAgo(rndInt(30, 180))}
      )
      ON CONFLICT DO NOTHING
    `);
  }
  // Export Schedules
  const exportTypes = ["transactions", "aml_alerts", "cases", "regulatory_reports", "sar_filings"];
  for (const userId of userIds.slice(0, 3)) {
    await db.execute(sql`
      INSERT INTO export_schedules ("userId", name, "exportType", format, filters, "cronExpression", enabled, "nextRunAt", "createdAt", "updatedAt")
      VALUES (
        ${userId},
        ${`Weekly ${rnd(exportTypes)} Export`},
        ${rnd(exportTypes)}, 'csv',
        ${JSON.stringify({ status: "completed", dateRange: "last_7_days" })}::jsonb,
        '0 8 * * 1', true,
        ${daysFromNow(rndInt(1, 7))},
        ${daysAgo(rndInt(30, 90))}, ${daysAgo(rndInt(0, 30))}
      )
      ON CONFLICT DO NOTHING
    `);
  }
}

async function seedFrozenAccounts(userIds: number[]) {
  console.log("  → frozenAccounts (10 records)");
  const reasons = [
    "Suspected money laundering — multiple structuring transactions detected",
    "Sanctions match — subject appears on OFAC SDN list",
    "Court order received — asset preservation order from Federal High Court",
    "Terrorist financing suspicion — transactions linked to designated entity",
    "Fraud investigation — account used as conduit for advance fee fraud",
    "PEP enhanced monitoring — politically exposed person under investigation",
  ];
  for (let i = 1; i <= 10; i++) {
    const isFrozen = Math.random() > 0.4;
    await db.execute(sql`
      INSERT INTO frozen_accounts (
        "accountId", "accountName", reason, "frozenBy", "frozenByName",
        "affectedTransactions", "frozenAt", "unfrozenAt", "unfrozenBy", "unfrozenByName", notes
      ) VALUES (
        ${`ACC${rndInt(1000000000, 9999999999)}`},
        ${rnd(NIGERIAN_NAMES)},
        ${rnd(reasons)},
        ${rnd(userIds)}, ${rnd(["Compliance Officer", "Senior Analyst", "AML Manager"])},
        ${rndInt(1, 50)}, ${daysAgo(rndInt(1, 90))},
        ${isFrozen ? null : daysAgo(rndInt(0, 30))},
        ${isFrozen ? null : rnd(userIds)},
        ${isFrozen ? null : rnd(["Compliance Officer", "Senior Analyst"])},
        ${`Account frozen pending investigation. Case reference: ${ref("CASE", rndInt(1001, 1025))}`}
      )
      ON CONFLICT DO NOTHING
    `);
  }
}

// ─── Case Documents ─────────────────────────────────────────────────────────
async function seedCaseDocuments(userIds: number[], caseIds: number[]) {
  if (caseIds.length === 0) return;
  console.log("  → caseDocuments (30 records)");
  const categories = ["evidence", "legal", "financial", "correspondence", "court_order", "witness_statement", "expert_report", "regulatory"];
  const mimeTypes = ["application/pdf", "image/jpeg", "image/png", "application/vnd.ms-excel", "application/msword", "text/plain"];
  const filenames = [
    "bank_statement_q1_2025.pdf", "property_deed.pdf", "cac_certificate.pdf",
    "nin_slip.jpg", "passport_scan.jpg", "transaction_history.xlsx",
    "witness_statement.pdf", "court_order.pdf", "audit_report.pdf",
    "correspondence_cbn.pdf", "asset_declaration.pdf", "company_accounts.xlsx",
    "phone_records.pdf", "travel_records.pdf", "email_evidence.pdf",
  ];
  for (let i = 1; i <= 30; i++) {
    const filename = rnd(filenames);
    const caseId = rnd(caseIds);
    const fileKey = `cases/${caseId}/docs/${uuid()}-${filename}`;
    await db.execute(sql`
      INSERT INTO case_documents (
        "caseId", filename, "mimeType", "fileKey", url,
        "sizeBytes", category, description, confidential,
        "uploadedBy", "createdAt"
      ) VALUES (
        ${caseId}, ${filename}, ${rnd(mimeTypes)},
        ${fileKey}, ${`https://storage.bis.ng/${fileKey}`},
        ${rndInt(50000, 5000000)}, ${rnd(categories)},
        ${`Document uploaded during ${rnd(["initial case review", "field investigation", "legal proceedings", "regulatory submission", "evidence gathering"])}`},
        ${Math.random() > 0.7},
        ${rnd(userIds)}, ${daysAgo(rndInt(0, 90))}
      )
      ON CONFLICT DO NOTHING
    `);
  }
}

// ─── Incoming Reports ─────────────────────────────────────────────────────────
async function seedIncomingReports() {
  console.log("  → incomingReports (25 records)");
  const statuses = ["new", "in_review", "escalated", "resolved", "dismissed"] as const;
  const languages = ["en", "yo", "ha", "ig"];
  const senders = [
    "+2348012345678", "+2347098765432", "+2349011223344",
    "reporter001@gmail.com", "tipster@yahoo.com",
    "anonymous_user_7823", "concerned_citizen_4521",
  ];
  const contents = [
    "I want to report suspicious financial activity by my neighbour who receives large cash amounts daily with no known business.",
    "A government contractor in my area is collecting bribes from vendors. I have evidence of multiple payments.",
    "My bank account was hacked and N500,000 was transferred without my authorization. Please investigate.",
    "I suspect my employer is involved in money laundering through fake invoices to shell companies.",
    "A local politician is using my community cooperative to launder funds from unknown sources.",
    "I received a suspicious call asking me to transfer money to receive a prize. This seems like fraud.",
    "My company's finance manager has been diverting funds to personal accounts for the past 6 months.",
    "There is a group running a Ponzi scheme in my area promising 50% returns in 30 days.",
    "I have information about a drug dealer who is using a restaurant business to launder proceeds.",
    "A foreign national is running an illegal forex bureau without CBN authorization in Lagos Island.",
  ];
  // Get channel IDs
  const channelRows = await db.execute(sql`SELECT id FROM messaging_channels ORDER BY id LIMIT 5`);
  const channelIds = (channelRows.rows as any[]).map((r: any) => r.id);
  if (channelIds.length === 0) return;
  for (let i = 1; i <= 25; i++) {
    const status = rnd(statuses);
    await db.execute(sql`
      INSERT INTO incoming_reports (
        "channelId", "channelType", sender, content, status,
        "riskScore", language, "attachmentCount",
        "receivedAt", "processedAt", "createdAt", "updatedAt"
      ) VALUES (
        ${rnd(channelIds)},
        ${rnd(["whatsapp", "telegram", "ussd", "sms", "email"])}::"channel_type",
        ${rnd(senders)}, ${rnd(contents)},
        ${status}::"incoming_report_status",
        ${rndInt(10, 95)}, ${rnd(languages)}, ${rndInt(0, 3)},
        ${daysAgo(rndInt(0, 60))},
        ${status !== "new" ? daysAgo(rndInt(0, 30)) : null},
        ${daysAgo(rndInt(0, 60))}, ${daysAgo(rndInt(0, 30))}
      )
      ON CONFLICT DO NOTHING
    `);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🌱 BIS Extended Seed — starting...");

  // Get existing user and investigation IDs
  const userRows = await db.execute(sql`SELECT id FROM users ORDER BY id LIMIT 20`);
  const userIds = (userRows.rows as any[]).map((r) => r.id);
  if (userIds.length === 0) {
    console.error("❌ No users found. Run pnpm db:seed first.");
    process.exit(1);
  }

  const invRows = await db.execute(sql`SELECT id FROM investigations ORDER BY id LIMIT 30`);
  const investigationIds = (invRows.rows as any[]).map((r) => r.id);

  await seedPlatformSettings();
  await seedOllamaModels();
  await seedMessagingChannels();
  await seedCorrespondentBanks();
  await seedTransactions(userIds, investigationIds);
  await seedAmlRulesAndAlerts(userIds);
  await seedSwiftMessages();
  await seedSepaPayments();
  await seedTravelRuleRecords();
  await seedGoamlFilings(userIds);
  await seedSarFilings(userIds, investigationIds);
  await seedLettersOfCredit(userIds);
  await seedCasesAndRelated(userIds, investigationIds);

  // Get case IDs for evidence
  const caseRows = await db.execute(sql`SELECT id FROM cases ORDER BY id LIMIT 25`);
  const caseIds = (caseRows.rows as any[]).map((r) => r.id);

  await seedEvidenceItems(userIds, caseIds);
  await seedRegulatoryReports(userIds);
  await seedSocialMonitoring(userIds);
  await seedFieldAgentPlaybooks();
  await seedLexData(userIds);
  await seedDuplicateChecksAndHostedLinks(userIds);
  await seedNotificationsAndSessions(userIds);
  await seedApiTokensAndUsage(userIds);
  await seedFrozenAccounts(userIds);
  await seedCaseDocuments(userIds, caseIds);
  await seedIncomingReports();
  console.log("✅ BIS Extended Seed complete!");
  await pool.end();
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
