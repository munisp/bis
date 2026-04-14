/**
 * BIS Platform — Banking Domain Seed Script
 * Seeds: transactions(100), aml_rules(10), aml_alerts(40), swift_messages(30),
 *        sepa_payments(20), travel_rule_records(15), sar_filings(15),
 *        letters_of_credit(10), correspondent_banks(8), nostro_accounts(12),
 *        evidence_items(20), regulatory_reports(8)
 *
 * Usage: DATABASE_URL=postgresql://... npx tsx server/seed-banking.ts
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import {
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
function rndFloat(min: number, max: number): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(2));
}
function rndInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${rndInt(1000, 9999)}`;
}

const CURRENCIES = ["USD", "EUR", "GBP", "NGN", "ZAR", "KES", "GHS"] as const;
const COUNTRIES = ["NG", "ZA", "KE", "GH", "US", "GB", "DE", "FR", "AE", "CN", "SG"] as const;
const BANKS = [
  { name: "Access Bank Plc", bic: "ABNGNGLA", country: "NG" },
  { name: "Zenith Bank Plc", bic: "ZEIBNGLA", country: "NG" },
  { name: "GTBank Plc", bic: "GTBINGLA", country: "NG" },
  { name: "Standard Bank", bic: "SBZAZAJJ", country: "ZA" },
  { name: "Equity Bank Kenya", bic: "EQBLKENA", country: "KE" },
  { name: "Barclays Bank", bic: "BARCGB22", country: "GB" },
  { name: "Deutsche Bank", bic: "DEUTDEDB", country: "DE" },
  { name: "Citibank N.A.", bic: "CITIUS33", country: "US" },
] as const;
const FIRST_NAMES = ["John", "Amara", "Chidi", "Fatima", "David", "Sarah", "Mohammed", "Ngozi"] as const;
const LAST_NAMES = ["Smith", "Okafor", "Adeyemi", "Hassan", "Williams", "Nwosu", "Abubakar", "Johnson"] as const;

// ─── Seed AML Rules ───────────────────────────────────────────────────────────
async function seedAmlRules(): Promise<number[]> {
  console.log("  Seeding AML rules…");
  const rules = [
    { name: "Large Cash Transaction", description: "Single cash transaction exceeding CTR threshold", ruleType: "threshold" as const, threshold: 10000, currency: "USD", timeWindowHours: 24, isActive: true },
    { name: "Structuring Detection", description: "Multiple transactions just below reporting threshold", ruleType: "structuring" as const, threshold: 9500, currency: "USD", timeWindowHours: 72, isActive: true },
    { name: "High-Risk Jurisdiction", description: "Transaction involving FATF high-risk jurisdiction", ruleType: "high_risk_country" as const, threshold: 1000, currency: "USD", timeWindowHours: 24, isActive: true },
    { name: "PEP Transaction", description: "Transaction involving a Politically Exposed Person", ruleType: "pep_transaction" as const, threshold: 5000, currency: "USD", timeWindowHours: 24, isActive: true },
    { name: "Sanctions Screening", description: "Transaction involving OFAC/UN/EU sanctioned entity", ruleType: "sanctions_match" as const, threshold: 0.01, currency: "USD", timeWindowHours: 1, isActive: true },
    { name: "Rapid Fund Movement", description: "Funds received and immediately transferred out", ruleType: "velocity" as const, threshold: 50000, currency: "USD", timeWindowHours: 48, isActive: true },
    { name: "Round Amount Transactions", description: "Unusually round transaction amounts", ruleType: "unusual_pattern" as const, threshold: 10000, currency: "USD", timeWindowHours: 168, isActive: true },
    { name: "Cross-Border Wire Cluster", description: "Multiple cross-border wires to same beneficiary", ruleType: "velocity" as const, threshold: 25000, currency: "USD", timeWindowHours: 168, isActive: true },
    { name: "Dormant Account Activation", description: "Sudden large activity on previously dormant account", ruleType: "unusual_pattern" as const, threshold: 20000, currency: "USD", timeWindowHours: 720, isActive: true },
    { name: "Trade-Based ML Indicator", description: "Over/under-invoicing in trade finance", ruleType: "threshold" as const, threshold: 100000, currency: "USD", timeWindowHours: 720, isActive: false },
  ];

  const inserted: number[] = [];
  for (const rule of rules) {
    const ex = await db.execute(sql`SELECT id FROM aml_rules WHERE name = ${rule.name} LIMIT 1`);
    if ((ex.rows as unknown[]).length > 0) {
      inserted.push((ex.rows[0] as { id: number }).id);
      continue;
    }
    const res = await db.insert(amlRules).values(rule).returning({ id: amlRules.id });
    inserted.push(res[0].id);
  }
  console.log(`    ✓ ${inserted.length} AML rules`);
  return inserted;
}

// ─── Seed Transactions ────────────────────────────────────────────────────────
async function seedTransactions(): Promise<number[]> {
  console.log("  Seeding transactions (100)…");
  const ex = await db.execute(sql`SELECT COUNT(*) as cnt FROM transactions`);
  const count = parseInt((ex.rows[0] as { cnt: string }).cnt);
  if (count >= 100) {
    const ids = await db.execute(sql`SELECT id FROM transactions LIMIT 100`);
    console.log(`    ✓ ${count} transactions (already seeded)`);
    return (ids.rows as { id: number }[]).map(r => r.id);
  }

  const txTypes = ["wire_transfer", "swift_mt103", "swift_mt202", "sepa_credit", "cash_deposit", "rtgs", "nip", "mobile_money"] as const;
  const statuses = ["pending", "completed", "flagged", "blocked", "reversed", "under_review"] as const;
  const inserted: number[] = [];

  for (let i = 0; i < 100; i++) {
    const amount = rndFloat(100, 500000);
    const currency = rnd(CURRENCIES);
    const originatorCountry = rnd(COUNTRIES);
    const beneficiaryCountry = rnd(COUNTRIES);
    const txType = rnd(txTypes);
    const status = i < 8 ? "flagged" : i < 3 ? "blocked" : rnd(statuses);

    const res = await db.insert(transactions).values({
      txRef: uid("TXN"),
      type: txType,
      amount,
      currency,
      originatorAccount: `${originatorCountry}${rndInt(10000000000000000, 99999999999999999)}`,
      originatorName: `${rnd(FIRST_NAMES)} ${rnd(LAST_NAMES)}`,
      originatorCountry,
      originatorBank: rnd(BANKS).name,
      beneficiaryAccount: `${beneficiaryCountry}${rndInt(10000000000000000, 99999999999999999)}`,
      beneficiaryName: `${rnd(["Global", "International", "Pan-Africa", "Trans", "Metro"])} ${rnd(["Trading Ltd", "Holdings Corp", "Finance SA", "Ventures Ltd"])}`,
      beneficiaryCountry,
      beneficiaryBank: rnd(BANKS).name,
      status,
      amlRiskLevel: i < 8 ? "high" : i < 15 ? "medium" : "low",
      amlScore: i < 8 ? rndFloat(70, 100) : rndFloat(0, 50),
      amlFlags: i < 8 ? JSON.stringify(["high_risk_jurisdiction", "large_amount"]) : null,
    }).returning({ id: transactions.id });
    inserted.push(res[0].id);
  }
  console.log(`    ✓ ${inserted.length} transactions`);
  return inserted;
}

// ─── Seed AML Alerts ──────────────────────────────────────────────────────────
async function seedAmlAlerts(txIds: number[], ruleIds: number[]): Promise<void> {
  console.log("  Seeding AML alerts (40)…");
  const ex = await db.execute(sql`SELECT COUNT(*) as cnt FROM aml_alerts`);
  if (parseInt((ex.rows[0] as { cnt: string }).cnt) >= 40) {
    console.log("    ✓ AML alerts (already seeded)"); return;
  }

  const riskLevels = ["low", "medium", "high", "critical"] as const;
  const statuses = ["open", "under_review", "escalated", "cleared", "filed", "false_positive"] as const;

  for (let i = 0; i < 40; i++) {
    const riskLevel = i < 5 ? "critical" : i < 15 ? "high" : i < 25 ? "medium" : "low";
    await db.insert(amlAlerts).values({
      alertRef: uid("AML"),
      transactionId: rnd(txIds),
      ruleId: rnd(ruleIds),
      riskLevel,
      title: `${rnd(["Large Amount", "High-Risk Jurisdiction", "Velocity Pattern", "Structuring Indicator", "PEP Involvement"])} Alert`,
      description: `Alert triggered by ${rnd(["large amount", "high-risk jurisdiction", "velocity pattern", "structuring indicator", "PEP involvement"])} detection.`,
      status: i < 10 ? "open" : i < 20 ? "under_review" : rnd(statuses),
      triggeredValue: riskLevel === "critical" ? rndFloat(90, 100) : riskLevel === "high" ? rndFloat(70, 89) : rndFloat(40, 69),
    });
  }
  console.log("    ✓ 40 AML alerts");
}

// ─── Seed SWIFT Messages ──────────────────────────────────────────────────────
async function seedSwiftMessages(): Promise<void> {
  console.log("  Seeding SWIFT messages (30)…");
  const ex = await db.execute(sql`SELECT COUNT(*) as cnt FROM swift_messages`);
  if (parseInt((ex.rows[0] as { cnt: string }).cnt) >= 30) {
    console.log("    ✓ SWIFT messages (already seeded)"); return;
  }

  const mtTypes = ["MT103", "MT202", "MT202COV", "MT199", "MT299"] as const;
  const statuses = ["received", "processing", "completed", "rejected", "pending_compliance"] as const;

  for (let i = 0; i < 30; i++) {
    const sender = rnd(BANKS);
    const receiver = rnd(BANKS.filter(b => b.bic !== sender.bic));
    await db.insert(swiftMessages).values({
      uetr: `${uid("UETR").toLowerCase()}`,
      messageType: rnd(mtTypes),
      senderBic: sender.bic,
      receiverBic: receiver.bic,
      amount: rndFloat(5000, 2000000),
      currency: rnd(["USD", "EUR", "GBP"] as const),
      valueDate: daysAgo(rndInt(0, 90)),
      status: rnd(statuses),
      orderingCustomer: `${rnd(FIRST_NAMES)} ${rnd(LAST_NAMES)}`,
      beneficiaryCustomer: `${rnd(["Global", "International", "Trans"])} ${rnd(["Trading Ltd", "Holdings Corp", "Finance SA"])}`,
      remittanceInfo: `Invoice ${rndInt(10000, 99999)} payment`,
      rawMessage: `{1:F01${sender.bic}XXXX0000000000}{2:I103${receiver.bic}XXXXN}{4:\n:20:${uid("REF")}\n:23B:CRED\n-}`,
      complianceStatus: i < 5 ? "flagged" : "clear",
    });
  }
  console.log("    ✓ 30 SWIFT messages");
}

// ─── Seed SEPA Payments ───────────────────────────────────────────────────────
async function seedSepaPayments(): Promise<void> {
  console.log("  Seeding SEPA payments (20)…");
  const ex = await db.execute(sql`SELECT COUNT(*) as cnt FROM sepa_payments`);
  if (parseInt((ex.rows[0] as { cnt: string }).cnt) >= 20) {
    console.log("    ✓ SEPA payments (already seeded)"); return;
  }

  const paymentTypes = ["credit_transfer", "direct_debit", "instant_credit"] as const;
  const statuses = ["pending", "accepted", "rejected", "returned", "settled"] as const;
  const euCountries = ["DE", "FR", "NL", "BE", "ES", "IT", "AT", "PT"] as const;

  for (let i = 0; i < 20; i++) {
    const dc = rnd(euCountries);
    const cc = rnd(euCountries);
    await db.insert(sepaPayments).values({
      endToEndId: uid("SEPA"),
      paymentType: rnd(paymentTypes),
      amount: rndFloat(100, 50000),
      currency: "EUR",
      debtorName: `${rnd(FIRST_NAMES)} ${rnd(LAST_NAMES)}`,
      debtorIban: `${dc}${rndInt(10, 99)}${rndInt(1000000000000000, 9999999999999999)}`,
      debtorBic: rnd(BANKS).bic,
      creditorName: `${rnd(["Euro", "Pan", "Trans"])} ${rnd(["Trading GmbH", "Services SA", "Holdings BV"])}`,
      creditorIban: `${cc}${rndInt(10, 99)}${rndInt(1000000000000000, 9999999999999999)}`,
      creditorBic: rnd(BANKS).bic,
      remittanceInfo: `Invoice ${rndInt(10000, 99999)} - Q${rndInt(1, 4)} ${new Date().getFullYear()}`,
      status: rnd(statuses),
      executionDate: daysAgo(rndInt(0, 60)),
      settlementDate: daysAgo(rndInt(0, 55)),
    });
  }
  console.log("    ✓ 20 SEPA payments");
}

// ─── Seed Travel Rule Records ─────────────────────────────────────────────────
async function seedTravelRuleRecords(): Promise<void> {
  console.log("  Seeding travel rule records (15)…");
  const ex = await db.execute(sql`SELECT COUNT(*) as cnt FROM travel_rule_records`);
  if (parseInt((ex.rows[0] as { cnt: string }).cnt) >= 15) {
    console.log("    ✓ Travel rule records (already seeded)"); return;
  }

  const statuses = ["pending", "sent", "acknowledged", "rejected", "exempted"] as const;

  for (let i = 0; i < 15; i++) {
    const oc = rnd(COUNTRIES);
    const bc = rnd(COUNTRIES);
    await db.insert(travelRuleRecords).values({
      recordRef: uid("TR"),
      status: rnd(statuses),
      thresholdAmount: 1000,
      currency: rnd(CURRENCIES),
      originatorName: `${rnd(FIRST_NAMES)} ${rnd(LAST_NAMES)}`,
      originatorAccount: `${oc}${rndInt(10000000000000000, 99999999999999999)}`,
      originatorCountry: oc,
      beneficiaryName: `${rnd(["Global", "International"])} ${rnd(["Trading Ltd", "Finance SA"])}`,
      beneficiaryAccount: `${bc}${rndInt(10000000000000000, 99999999999999999)}`,
      beneficiaryCountry: bc,
      vasp: rnd(BANKS).bic,
      sentAt: i < 10 ? daysAgo(rndInt(0, 90)) : null,
    });
  }
  console.log("    ✓ 15 travel rule records");
}

// ─── Seed SAR Filings ─────────────────────────────────────────────────────────
async function seedSarFilings(): Promise<void> {
  console.log("  Seeding SAR filings (15)…");
  const ex = await db.execute(sql`SELECT COUNT(*) as cnt FROM sar_filings`);
  if (parseInt((ex.rows[0] as { cnt: string }).cnt) >= 15) {
    console.log("    ✓ SAR filings (already seeded)"); return;
  }

  const statuses = ["draft", "under_review", "approved", "rejected", "filed", "acknowledged"] as const;
  const categories = ["money_laundering", "terrorist_financing", "fraud", "corruption", "sanctions_evasion", "cybercrime"] as const;

  for (let i = 0; i < 15; i++) {
    const status = i < 3 ? "draft" : i < 6 ? "under_review" : i < 9 ? "approved" : i < 12 ? "filed" : rnd(statuses);
    await db.insert(sarFilings).values({
      sarRef: `SAR-${new Date().getFullYear()}-${String(i + 1).padStart(4, "0")}`,
      status,
      category: rnd(categories),
      title: `Suspicious ${rnd(["Wire Transfer", "Cash Deposit", "Crypto Transaction", "Trade Payment", "Account Activity"])} — ${rnd(FIRST_NAMES)} ${rnd(LAST_NAMES)}`,
      narrative: `Suspicious ${rnd(["wire transfers", "cash deposits", "cryptocurrency transactions", "trade payments"])} detected. Subject conducted ${rndInt(3, 20)} transactions totaling $${rndFloat(50000, 5000000).toLocaleString()} over ${rndInt(7, 90)} days. ${rnd(["Pattern consistent with layering.", "Structuring indicators present.", "High-risk jurisdiction involvement.", "PEP connection identified."])}`,
      subjectName: `${rnd(FIRST_NAMES)} ${rnd(LAST_NAMES)}`,
      subjectOccupation: rnd(["Business Owner", "Government Official", "Trader", "Contractor", "Unknown"]),
      suspiciousAmount: rndFloat(50000, 5000000),
      suspiciousCurrency: rnd(CURRENCIES),
      activityStartDate: daysAgo(rndInt(30, 180)),
      activityEndDate: daysAgo(rndInt(0, 29)),
      filedWith: "NFIU",
      filingReference: ["filed", "acknowledged"].includes(status) ? `NFIU-${new Date().getFullYear()}-${rndInt(10000, 99999)}` : null,
      filedAt: ["filed", "acknowledged"].includes(status) ? daysAgo(rndInt(0, 30)) : null,
      acknowledgedAt: status === "acknowledged" ? daysAgo(rndInt(0, 14)) : null,
    });
  }
  console.log("    ✓ 15 SAR filings");
}

// ─── Seed Letters of Credit ───────────────────────────────────────────────────
async function seedLettersOfCredit(): Promise<void> {
  console.log("  Seeding letters of credit (10)…");
  const ex = await db.execute(sql`SELECT COUNT(*) as cnt FROM letters_of_credit`);
  if (parseInt((ex.rows[0] as { cnt: string }).cnt) >= 10) {
    console.log("    ✓ Letters of credit (already seeded)"); return;
  }

  const lcTypes = ["sight", "usance", "deferred", "revolving", "standby"] as const;
  const statuses = ["draft", "issued", "advised", "confirmed", "presented", "accepted", "paid", "expired"] as const;
  const goods = ["crude oil", "refined petroleum", "agricultural commodities", "industrial machinery", "electronics", "textiles", "pharmaceuticals"] as const;

  for (let i = 0; i < 10; i++) {
    const issuingBank = rnd(BANKS);
    const advisingBank = rnd(BANKS.filter(b => b.bic !== issuingBank.bic));
    const expiryDate = daysAgo(-rndInt(60, 365)); // future date

    await db.insert(lettersOfCredit).values({
      lcRef: `LC-${new Date().getFullYear()}-${String(i + 1).padStart(4, "0")}-${rndInt(1000,9999)}`,
      type: rnd(lcTypes),
      status: rnd(statuses),
      amount: rndFloat(100000, 10000000),
      currency: rnd(["USD", "EUR", "GBP"] as const),
      applicantName: `${rnd(["Lagos", "Nairobi", "Accra", "Johannesburg"])} ${rnd(["Import Co.", "Trading Ltd", "Commodities Corp"])}`,
      applicantBank: issuingBank.name,
      applicantCountry: rnd(COUNTRIES),
      beneficiaryName: `${rnd(["Global", "International", "Trans-Atlantic"])} ${rnd(["Exports Ltd", "Suppliers Corp", "Manufacturing SA"])}`,
      beneficiaryBank: advisingBank.name,
      beneficiaryCountry: rnd(COUNTRIES),
      issuingBank: issuingBank.name,
      advisingBank: advisingBank.name,
      goodsDescription: `${rnd(goods)} — ${rndInt(100, 10000)} MT, quality per SGS inspection certificate`,
      portOfLoading: rnd(["Lagos, Nigeria", "Mombasa, Kenya", "Durban, South Africa", "Tema, Ghana"]),
      portOfDischarge: rnd(["Rotterdam, Netherlands", "Hamburg, Germany", "Antwerp, Belgium", "Houston, USA"]),
      expiryDate,
      presentationPeriod: rnd([21, 30, 45] as const),
    });
  }
  console.log("    ✓ 10 letters of credit");
}

// ─── Seed Correspondent Banks ─────────────────────────────────────────────────
async function seedCorrespondentBanks(): Promise<void> {
  console.log("  Seeding correspondent banks (8)…");
  const bankData = [
    { bankName: "JPMorgan Chase Bank N.A.", bic: "CHASUS33", country: "US", city: "New York", riskRating: "low", services: ["USD_clearing", "wire_transfer"], currencies: ["USD"] },
    { bankName: "Deutsche Bank AG", bic: "DEUTDEDB", country: "DE", city: "Frankfurt", riskRating: "low", services: ["EUR_clearing", "trade_finance"], currencies: ["EUR", "USD"] },
    { bankName: "HSBC Bank plc", bic: "MIDLGB22", country: "GB", city: "London", riskRating: "low", services: ["GBP_clearing", "multi_currency"], currencies: ["GBP", "USD", "EUR"] },
    { bankName: "Standard Chartered Bank", bic: "SCBLSGSG", country: "SG", city: "Singapore", riskRating: "low", services: ["USD_clearing", "trade_finance"], currencies: ["USD", "SGD"] },
    { bankName: "Citibank N.A.", bic: "CITIUS33", country: "US", city: "New York", riskRating: "low", services: ["USD_clearing", "remittances"], currencies: ["USD"] },
    { bankName: "BNP Paribas SA", bic: "BNPAFRPP", country: "FR", city: "Paris", riskRating: "low", services: ["EUR_clearing", "trade_finance"], currencies: ["EUR", "USD"] },
    { bankName: "Emirates NBD", bic: "EBILAEAD", country: "AE", city: "Dubai", riskRating: "medium", services: ["USD_clearing", "AED_clearing"], currencies: ["USD", "AED"] },
    { bankName: "Bank of China", bic: "BKCHCNBJ", country: "CN", city: "Beijing", riskRating: "medium", services: ["CNY_clearing", "trade_finance"], currencies: ["CNY", "USD"] },
  ];

  for (const bank of bankData) {
    const ex = await db.execute(sql`SELECT id FROM correspondent_banks WHERE bic = ${bank.bic} LIMIT 1`);
    if ((ex.rows as unknown[]).length > 0) continue;

    const cbRes = await db.insert(correspondentBanks).values({
      bankName: bank.bankName,
      bic: bank.bic,
      country: bank.country,
      city: bank.city,
      status: "active",
      riskRating: bank.riskRating,
      relationshipSince: daysAgo(rndInt(365, 3650)),
      lastReviewDate: daysAgo(rndInt(30, 365)),
      nextReviewDate: daysAgo(-rndInt(90, 365)),
      services: JSON.stringify(bank.services),
      currencies: JSON.stringify(bank.currencies),
      nostroAccountCount: bank.currencies.length,
      annualVolume: rndFloat(10000000, 500000000),
      notes: `Correspondent banking relationship for ${bank.services.join(", ")}. CDD completed and approved.`,
    }).returning({ id: correspondentBanks.id });

    const cbId = cbRes[0].id;
    for (const currency of bank.currencies) {
      await db.insert(nostroAccounts).values({
        accountNumber: `${bank.country}${rndInt(10000000000000000, 99999999999999999)}`,
        currency,
        correspondentBankId: cbId,
        balance: rndFloat(1000000, 50000000),
        lastReconciled: daysAgo(rndInt(0, 7)),
        status: "active",
      });
    }
  }
  console.log("    ✓ 8 correspondent banks + nostro accounts");
}

// ─── Seed Evidence Items ──────────────────────────────────────────────────────
async function seedEvidenceItems(): Promise<void> {
  console.log("  Seeding evidence items (20)…");
  const ex = await db.execute(sql`SELECT COUNT(*) as cnt FROM evidence_items`);
  if (parseInt((ex.rows[0] as { cnt: string }).cnt) >= 20) {
    console.log("    ✓ Evidence items (already seeded)"); return;
  }

  const evidenceTypes = ["document", "photo", "video", "audio", "digital_artifact", "financial_record", "communication_log"] as const;
  const statuses = ["collected", "secured", "analyzed", "submitted"] as const;

  for (let i = 0; i < 20; i++) {
    const evidenceType = rnd(evidenceTypes);
    const ext = evidenceType === "photo" ? "jpg" : evidenceType === "video" ? "mp4" : evidenceType === "audio" ? "mp3" : "pdf";
    const fileName = `evidence-${i + 1}-${rnd(["bank_statement", "wire_transfer", "invoice", "passport_copy", "transaction_log"])}.${ext}`;
    const hash = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

    await db.insert(evidenceItems).values({
      evidenceRef: `EV-${new Date().getFullYear()}-${String(i + 1).padStart(4, "0")}`,
      type: evidenceType,
      status: rnd(statuses),
      title: `${rnd(["Bank Statement", "Wire Transfer Record", "Invoice", "Passport Copy", "Transaction Log", "Email Chain"])} — Case ${rndInt(1, 50)}`,
      description: `${rnd(["Bank statement showing", "Wire transfer record for", "Invoice related to", "Passport copy of"])} ${rnd(["suspicious transactions", "the subject entity", "the investigation period", "account holder"])}`,
      fileUrl: `https://storage.bis.example.com/evidence/${new Date().getFullYear()}/${fileName}`,
      fileHash: hash,
      fileSize: rndInt(50000, 10000000),
      mimeType: ext === "jpg" ? "image/jpeg" : ext === "mp4" ? "video/mp4" : ext === "mp3" ? "audio/mpeg" : "application/pdf",
      collectedAt: daysAgo(rndInt(0, 180)),
      collectionLocation: rnd(["Lagos Office", "Abuja HQ", "Nairobi Branch", "Evidence Room A", "Digital Forensics Lab"]),
      chainOfCustody: JSON.stringify([
        { action: "collected", at: daysAgo(rndInt(30, 180)).toISOString(), notes: "Initial collection" },
        { action: "transferred", at: daysAgo(rndInt(10, 29)).toISOString(), notes: "Transferred to evidence room" },
        ...(i < 10 ? [{ action: "verified", at: daysAgo(rndInt(0, 9)).toISOString(), notes: "Hash verified, integrity confirmed" }] : []),
      ]),
      integrityVerified: i < 15,
      integrityVerifiedAt: i < 15 ? daysAgo(rndInt(0, 30)) : null,
    });
  }
  console.log("    ✓ 20 evidence items");
}

// ─── Seed Regulatory Reports ──────────────────────────────────────────────────
async function seedRegulatoryReports(): Promise<void> {
  console.log("  Seeding regulatory reports (8)…");
  const ex = await db.execute(sql`SELECT COUNT(*) as cnt FROM regulatory_reports`);
  if (parseInt((ex.rows[0] as { cnt: string }).cnt) >= 8) {
    console.log("    ✓ Regulatory reports (already seeded)"); return;
  }

  const reportTypes = ["CTR", "STR", "goAML_XML", "NFIU_monthly", "CBN_quarterly", "FATF_travel_rule"] as const;
  const statuses = ["draft", "generated", "reviewed", "submitted", "acknowledged"] as const;

  for (let i = 0; i < 8; i++) {
    const reportType = rnd(reportTypes);
    const status = i < 2 ? "draft" : i < 4 ? "reviewed" : i < 6 ? "submitted" : rnd(statuses);
    const periodStart = daysAgo(rndInt(60, 365));
    const periodEnd = new Date(periodStart);
    periodEnd.setDate(periodEnd.getDate() + rndInt(30, 90));

    await db.insert(regulatoryReports).values({
      reportRef: `RPT-${reportType}-${new Date().getFullYear()}-${String(i + 1).padStart(3, "0")}`,
      type: reportType,
      status,
      title: `${reportType} Report — ${periodStart.toISOString().slice(0, 7)}`,
      periodStart,
      periodEnd,
      regulatorName: rnd(["NFIU", "CBN", "SEC", "EFCC", "FinCEN"] as const),
      submissionDeadline: daysAgo(-rndInt(0, 30)),
      submittedAt: ["submitted", "acknowledged"].includes(status) ? daysAgo(rndInt(0, 30)) : null,
      acknowledgementRef: status === "acknowledged" ? `ACK-${rndInt(100000, 999999)}` : null,
      metadata: JSON.stringify({
        transactionCount: rndInt(5, 50),
        totalAmount: rndFloat(100000, 10000000),
        currency: "USD",
        reportingEntity: "BIS Financial Intelligence Unit",
      }),
    });
  }
  console.log("    ✓ 8 regulatory reports");
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n🏦  BIS Platform — Banking Domain Seed Script\n");
  console.log(`  Database: ${DATABASE_URL.replace(/:[^@]+@/, ":***@")}\n`);
  try {
    const ruleIds = await seedAmlRules();
    const txIds = await seedTransactions();
    await seedAmlAlerts(txIds, ruleIds);
    await seedSwiftMessages();
    await seedSepaPayments();
    await seedTravelRuleRecords();
    await seedSarFilings();
    await seedLettersOfCredit();
    await seedCorrespondentBanks();
    await seedEvidenceItems();
    await seedRegulatoryReports();
    console.log("\n✅  Banking seed complete!\n");
  } catch (err) {
    console.error("\n❌  Banking seed failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}
main();
