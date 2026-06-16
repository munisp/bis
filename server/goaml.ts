/**
 * goAML STR Wizard Router
 * Handles Suspicious Transaction Report (STR) filing workflow
 * following NFIU goAML XML schema v4.0 requirements.
 */

import { z } from "zod";
import { router, protectedProcedure, writeProcedure, adminProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { goamlFilings } from "../drizzle/schema";
import { eq, desc, and, like, lt } from "drizzle-orm";
import { ENV } from "./_core/env";

/**
 * Submit an XML filing to the NFIU goAML production API.
 * Falls back to a simulated reference number if GOAML_API_KEY is not configured.
 *
 * goAML API docs: https://goaml.nfiu.gov.ng/api/docs
 * Endpoint: POST /api/report
 * Auth: Bearer token (GOAML_API_KEY)
 * Content-Type: application/xml
 * Response: { referenceNumber: string, status: "accepted" | "rejected", errors?: string[] }
 */
async function submitToNfiu(xmlPayload: string): Promise<{ referenceNumber: string; accepted: boolean; errors: string[] }> {
  // If API key not configured, use simulated reference (dev/staging mode)
  if (!ENV.goamlApiKey || !ENV.goamlInstitutionCode) {
    const simulatedRef = `NFIU-${Date.now().toString(36).toUpperCase()}`;
    console.warn(`[goAML] GOAML_API_KEY not set — using simulated reference: ${simulatedRef}`);
    return { referenceNumber: simulatedRef, accepted: true, errors: [] };
  }

  const url = `${ENV.goamlApiUrl}/report`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml",
        "Authorization": `Bearer ${ENV.goamlApiKey}`,
        "X-Institution-Code": ENV.goamlInstitutionCode,
        "X-BIS-Client": "bis-platform/1.0",
      },
      body: xmlPayload,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { referenceNumber: "", accepted: false, errors: [`NFIU API ${res.status}: ${text.slice(0, 200)}`] };
    }

    const json = await res.json() as { referenceNumber?: string; status?: string; errors?: string[] };
    return {
      referenceNumber: json.referenceNumber ?? `NFIU-${Date.now().toString(36).toUpperCase()}`,
      accepted: json.status === "accepted",
      errors: json.errors ?? [],
    };
  } catch (err: any) {
    return { referenceNumber: "", accepted: false, errors: [`Network error: ${err.message}`] };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateFilingRef(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `STR-${ts}-${rand}`;
}

/**
 * Generate a goAML-compatible XML payload following NFIU schema v4.0
 * In production this would be submitted to https://goaml.nfiu.gov.ng/api/report
 */
function generateGoamlXml(filing: {
  filingRef: string;
  reportType: string;
  subjectName: string;
  subjectBvn?: string | null;
  subjectNin?: string | null;
  subjectAccountNumber?: string | null;
  subjectBank?: string | null;
  transactionDate?: Date | null;
  transactionAmount?: number | null;
  transactionCurrency?: string | null;
  suspiciousActivity: string;
  narrativeDetails?: string | null;
}): string {
  const now = new Date().toISOString();
  const txDate = filing.transactionDate
    ? new Date(filing.transactionDate).toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0];

  return `<?xml version="1.0" encoding="UTF-8"?>
<goAML xmlns="http://www.goaml.org/schema/v4.0"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xsi:schemaLocation="http://www.goaml.org/schema/v4.0 goAML.xsd">
  <report>
    <rentity_id>BIS-PLATFORM-001</rentity_id>
    <rentity_branch>MAIN</rentity_branch>
    <submission_code>E</submission_code>
    <report_code>${filing.reportType}</report_code>
    <entity_reference>${filing.filingRef}</entity_reference>
    <fiu_ref_number></fiu_ref_number>
    <submission_date>${now}</submission_date>
    <currency_code_local>${filing.transactionCurrency ?? "NGN"}</currency_code_local>
    <reporting_person>
      <gender>U</gender>
      <first_name>BIS</first_name>
      <last_name>Platform</last_name>
      <occupation>Compliance Officer</occupation>
    </reporting_person>
    <location>
      <address_type>B</address_type>
      <country>NG</country>
    </location>
    <reason>${filing.suspiciousActivity}</reason>
    <action>Reported via BIS Platform automated STR wizard</action>
    <transaction>
      <transactionnumber>${filing.filingRef}-TXN</transactionnumber>
      <transaction_location>NG</transaction_location>
      <date_transaction>${txDate}</date_transaction>
      <teller>0</teller>
      <late_deposit>false</late_deposit>
      <amount_local>${filing.transactionAmount ?? 0}</amount_local>
      <involved_party>
        <party>
          <funds_code>W</funds_code>
          <first_name>${filing.subjectName.split(" ")[0] ?? filing.subjectName}</first_name>
          <last_name>${filing.subjectName.split(" ").slice(1).join(" ") || "N/A"}</last_name>
          <is_primary>true</is_primary>
          <role>S</role>
          <account>
            <institution_name>${filing.subjectBank ?? "Unknown"}</institution_name>
            <account_number>${filing.subjectAccountNumber ?? "N/A"}</account_number>
            <currency_code>NGN</currency_code>
            <account_name>${filing.subjectName}</account_name>
          </account>
          <identification>
            ${filing.subjectBvn ? `<id_number type="BVN">${filing.subjectBvn}</id_number>` : ""}
            ${filing.subjectNin ? `<id_number type="NIN">${filing.subjectNin}</id_number>` : ""}
          </identification>
        </party>
      </involved_party>
    </transaction>
    <narrative>${filing.narrativeDetails ?? filing.suspiciousActivity}</narrative>
  </report>
</goAML>`;
}

// ─── Suspicious activity categories (NFIU-aligned) ───────────────────────────

export const SUSPICIOUS_CATEGORIES = [
  "Structuring / Smurfing",
  "Unusual cash transactions",
  "Transactions inconsistent with customer profile",
  "Politically Exposed Person (PEP) activity",
  "Sanctions list match",
  "Terrorist financing indicators",
  "Proliferation financing",
  "Real estate money laundering",
  "Trade-based money laundering",
  "Cyber-enabled fraud",
  "Ponzi / investment fraud",
  "Human trafficking proceeds",
  "Drug trafficking proceeds",
  "Bribery and corruption",
  "Tax evasion indicators",
  "Other suspicious activity",
] as const;

// ─── Router ───────────────────────────────────────────────────────────────────

export const goamlRouter = router({
  /** List all STR filings with optional status filter */
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(["draft", "submitted", "accepted", "rejected", "pending_review"]).optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const conditions = [];
      if (input.status) conditions.push(eq(goamlFilings.status, input.status));
      if (input.search) conditions.push(like(goamlFilings.subjectName, `%${input.search}%`));

      const rows = await db
        .select()
        .from(goamlFilings)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(goamlFilings.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return rows;
    }),

  /** Get a single STR filing by ID */
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [filing] = await db
        .select()
        .from(goamlFilings)
        .where(eq(goamlFilings.id, input.id))
        .limit(1);
      if (!filing) throw new Error("Filing not found");
      return filing;
    }),

  /** Create a new STR filing (draft) */
  create: writeProcedure
    .input(
      z.object({
        reportType: z.enum(["STR", "CTR", "SAR"]).default("STR"),
        investigationRef: z.string().optional(),
        subjectName: z.string().min(2).max(255),
        subjectBvn: z.string().max(20).optional(),
        subjectNin: z.string().max(20).optional(),
        subjectAccountNumber: z.string().max(30).optional(),
        subjectBank: z.string().max(100).optional(),
        transactionDate: z.date().optional(),
        transactionAmount: z.number().positive().optional(),
        transactionCurrency: z.string().length(3).default("NGN"),
        suspiciousActivity: z.string().min(10),
        narrativeDetails: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const filingRef = generateFilingRef();
      const xml = generateGoamlXml({ filingRef, ...input });

      const [filing] = await db
        .insert(goamlFilings)
        .values({
          filingRef,
          reportType: input.reportType,
          investigationRef: input.investigationRef,
          subjectName: input.subjectName,
          subjectBvn: input.subjectBvn,
          subjectNin: input.subjectNin,
          subjectAccountNumber: input.subjectAccountNumber,
          subjectBank: input.subjectBank,
          transactionDate: input.transactionDate,
          transactionAmount: input.transactionAmount,
          transactionCurrency: input.transactionCurrency,
          suspiciousActivity: input.suspiciousActivity,
          narrativeDetails: input.narrativeDetails,
          goamlXml: xml,
          status: "draft",
          createdBy: ctx.user.id,
        })
        .returning();

      return { filingRef: filing.filingRef, id: filing.id };
    }),

  /** Update an existing draft filing */
  update: writeProcedure
    .input(
      z.object({
        id: z.number(),
        subjectName: z.string().min(2).max(255).optional(),
        subjectBvn: z.string().max(20).optional(),
        subjectNin: z.string().max(20).optional(),
        subjectAccountNumber: z.string().max(30).optional(),
        subjectBank: z.string().max(100).optional(),
        transactionDate: z.date().optional(),
        transactionAmount: z.number().positive().optional(),
        suspiciousActivity: z.string().min(10).optional(),
        narrativeDetails: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const { id, ...updates } = input;
      const [existing] = await db
        .select()
        .from(goamlFilings)
        .where(eq(goamlFilings.id, id))
        .limit(1);
      if (!existing) throw new Error("Filing not found");
      if (existing.status !== "draft") throw new Error("Only draft filings can be edited");

      const merged = { ...existing, ...updates };
      const { filingRef, ...mergedWithoutRef } = merged;
      const xml = generateGoamlXml({ filingRef, ...mergedWithoutRef });

      await db
        .update(goamlFilings)
        .set({ ...updates, goamlXml: xml, updatedAt: new Date() })
        .where(eq(goamlFilings.id, id));

      return { success: true };
    }),

  /** Submit a draft filing to NFIU (simulated — in production calls goAML API) */
  submit: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [filing] = await db
        .select()
        .from(goamlFilings)
        .where(eq(goamlFilings.id, input.id))
        .limit(1);
      if (!filing) throw new Error("Filing not found");
      if (filing.status !== "draft") throw new Error("Only draft filings can be submitted");

      // Submit to NFIU goAML production API (falls back to simulated ref if GOAML_API_KEY not set)
      const nfiuResult = await submitToNfiu(filing.goamlXml ?? "");

      if (!nfiuResult.accepted && nfiuResult.errors.length > 0) {
        throw new Error(`NFIU rejected filing: ${nfiuResult.errors.join("; ")}`);
      }

      await db
        .update(goamlFilings)
        .set({
          status: "submitted",
          goamlReferenceNumber: nfiuResult.referenceNumber,
          submittedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(goamlFilings.id, input.id));

      return { success: true, goamlReferenceNumber: nfiuResult.referenceNumber };
    }),

  /** Delete a draft filing */
  delete: writeProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [filing] = await db
        .select()
        .from(goamlFilings)
        .where(eq(goamlFilings.id, input.id))
        .limit(1);
      if (!filing) throw new Error("Filing not found");
      if (filing.status === "submitted" || filing.status === "accepted") {
        throw new Error("Submitted filings cannot be deleted");
      }
      await db.delete(goamlFilings).where(eq(goamlFilings.id, input.id));
      return { success: true };
    }),

  /** Download the XML payload for a filing */
  getXml: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [filing] = await db
        .select({ goamlXml: goamlFilings.goamlXml, filingRef: goamlFilings.filingRef })
        .from(goamlFilings)
        .where(eq(goamlFilings.id, input.id))
        .limit(1);
      if (!filing) throw new Error("Filing not found");
      return { xml: filing.goamlXml, filingRef: filing.filingRef };
    }),

  /** Get draft filings breaching the 72-hour NFIU filing deadline */
  getOverdue: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { count: 0, overdue: [] };
      const cutoff = new Date(Date.now() - 72 * 3_600_000);
      const rows = await db
        .select()
        .from(goamlFilings)
        .where(and(eq(goamlFilings.status, 'draft'), lt(goamlFilings.createdAt, cutoff)))
        .orderBy(goamlFilings.createdAt)
        .limit(input.limit);
      const now = Date.now();
      return {
        count: rows.length,
        overdue: rows.map(r => ({
          id: r.id,
          filingRef: r.filingRef,
          subjectName: r.subjectName,
          reportType: r.reportType,
          createdAt: r.createdAt,
          hoursOverdue: Math.round((now - new Date(r.createdAt).getTime()) / 3_600_000) - 72,
        })),
      };
    }),

  /**
   * Bulk-submit multiple draft STR filings in a single call.
   * Returns per-filing results so the caller can surface partial failures.
   * Only draft filings are eligible; already-submitted ones are skipped.
   */
  bulkSubmit: writeProcedure
    .input(
      z.object({
        ids: z.array(z.number()).min(1).max(50),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const results: Array<{
        id: number;
        filingRef: string;
        status: "submitted" | "skipped" | "error";
        goamlReferenceNumber?: string;
        reason?: string;
      }> = [];

      for (const id of input.ids) {
        try {
          const [filing] = await db
            .select()
            .from(goamlFilings)
            .where(eq(goamlFilings.id, id))
            .limit(1);

          if (!filing) {
            results.push({ id, filingRef: "", status: "error", reason: "Filing not found" });
            continue;
          }
          if (filing.status !== "draft") {
            results.push({ id, filingRef: filing.filingRef, status: "skipped", reason: `Already ${filing.status}` });
            continue;
          }

          // Submit to NFIU goAML production API
          const nfiuResult = await submitToNfiu(filing.goamlXml ?? "");

          if (!nfiuResult.accepted && nfiuResult.errors.length > 0) {
            results.push({ id, filingRef: filing.filingRef, status: "error", reason: nfiuResult.errors.join("; ") });
            continue;
          }

          await db
            .update(goamlFilings)
            .set({
              status: "submitted",
              goamlReferenceNumber: nfiuResult.referenceNumber,
              submittedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(goamlFilings.id, id));

          results.push({ id, filingRef: filing.filingRef, status: "submitted", goamlReferenceNumber: nfiuResult.referenceNumber });
        } catch (err) {
          results.push({ id, filingRef: "", status: "error", reason: String(err) });
        }
      }

      const submittedCount = results.filter(r => r.status === "submitted").length;
      const skippedCount = results.filter(r => r.status === "skipped").length;
      const errorCount = results.filter(r => r.status === "error").length;

      return { results, submittedCount, skippedCount, errorCount };
    }),

  /** Summary stats for the dashboard widget */
  stats: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
    const rows = await db.select().from(goamlFilings);
    const total = rows.length;
    const drafts = rows.filter((r: typeof rows[0]) => r.status === "draft").length;
    const submitted = rows.filter((r: typeof rows[0]) => r.status === "submitted").length;
    const accepted = rows.filter((r: typeof rows[0]) => r.status === "accepted").length;
    const rejected = rows.filter((r: typeof rows[0]) => r.status === "rejected").length;
    return { total, drafts, submitted, accepted, rejected };
  }),
});
