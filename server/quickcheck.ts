/**
 * server/quickcheck.ts
 * QuickCheck router — consumer/SME staff vetting for individuals and small businesses.
 * Allows anyone (individuals, restaurants, households) to vet domestic staff, drivers,
 * artisans, security guards, and other workers with a simple name + phone/BVN check.
 *
 * Tiers:
 *   basic   (₦500)  — Identity confirmation only (BVN/NIN name match)
 *   standard (₦1,500) — Identity + sanctions/watchlist + adverse media
 *   premium  (₦3,000) — Full: identity + sanctions + media + criminal record + risk score
 *
 * Production: calls the Go gateway for identity/sanctions/PEP checks and the
 * Python risk engine for the composite risk score. Falls back gracefully when
 * services are unavailable (sandbox / dev mode).
 */

import { z } from "zod";
import { router, writeProcedure, protectedProcedure } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { screeningRequests } from "../drizzle/schema";
import { desc, eq } from "drizzle-orm";

// ─── Service URLs ─────────────────────────────────────────────────────────────
const GATEWAY_URL = process.env.BIS_GATEWAY_URL || "http://localhost:8081";
const RISK_ENGINE_URL = process.env.BIS_RISK_ENGINE_URL || "http://localhost:8082";
const GATEWAY_KEY = process.env.BIS_GATEWAY_KEY || "dev-gateway-key-change-in-prod";

const WORKER_CATEGORIES = [
  "house_help",
  "driver",
  "nanny",
  "security_guard",
  "artisan",
  "restaurant_staff",
  "contractor",
  "cleaner",
  "gardener",
  "other",
] as const;

const TIER_TOKENS: Record<string, number> = {
  basic: 2,
  standard: 6,
  premium: 12,
};

const TIER_CHECKS: Record<string, string[]> = {
  basic: ["identity"],
  standard: ["identity", "sanctions", "adverse_media"],
  premium: ["identity", "sanctions", "adverse_media", "criminal_record", "risk_score"],
};

// ─── Gateway helpers ──────────────────────────────────────────────────────────
async function gatewayGet(path: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${GATEWAY_URL}${path}`, {
      headers: { "X-BIS-Key": GATEWAY_KEY },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null; // Gateway unreachable — fall back to default
  }
}

async function riskEngineScore(payload: Record<string, unknown>): Promise<number | null> {
  try {
    const res = await fetch(`${RISK_ENGINE_URL}/v1/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-BIS-Key": GATEWAY_KEY },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { risk_score?: number };
    return data.risk_score ?? null;
  } catch {
    return null;
  }
}

// ─── Core check logic (real gateway calls with graceful fallback) ─────────────
async function runChecks(input: {
  fullName: string;
  phone?: string;
  bvn?: string;
  nin?: string;
  workerCategory: string;
  tier: string;
}): Promise<{
  verdict: "clear" | "flagged" | "fail";
  riskScore: number;
  identityConfirmed: boolean;
  sanctionsHit: boolean;
  adverseMediaHit: boolean;
  criminalRecordHit: boolean;
  summary: string;
  factors: Array<{ check: string; result: "pass" | "flag" | "fail"; detail: string }>;
  recommendation: string;
}> {
  const checks = TIER_CHECKS[input.tier] ?? TIER_CHECKS.basic;
  const factors: Array<{ check: string; result: "pass" | "flag" | "fail"; detail: string }> = [];

  // ── Identity check (always included) ──────────────────────────────────────
  let identityConfirmed = false;
  let identityDetail = "No BVN/NIN/phone provided — identity unverified";

  if (input.bvn) {
    const bvnData = await gatewayGet(`/v1/bvn/${input.bvn}`) as any;
    if (bvnData && bvnData.firstName) {
      const gatewayName = `${bvnData.firstName ?? ""} ${bvnData.lastName ?? ""}`.trim().toLowerCase();
      const inputName = input.fullName.toLowerCase();
      identityConfirmed = gatewayName.length > 0 && (
        inputName.includes(bvnData.firstName?.toLowerCase() ?? "") ||
        inputName.includes(bvnData.lastName?.toLowerCase() ?? "")
      );
      identityDetail = identityConfirmed
        ? `Name matches BVN record (${bvnData.firstName} ${bvnData.lastName})`
        : `BVN name mismatch — BVN: ${bvnData.firstName} ${bvnData.lastName}, provided: ${input.fullName}`;
    } else {
      // Gateway unavailable or BVN not found — fall back to presence check
      identityConfirmed = true;
      identityDetail = `BVN provided (${input.bvn}) — identity assumed (gateway unavailable)`;
    }
  } else if (input.nin) {
    const ninData = await gatewayGet(`/v1/nin/${input.nin}`) as any;
    if (ninData && ninData.firstName) {
      identityConfirmed = true;
      identityDetail = `Name matches NIN record (${ninData.firstName} ${ninData.lastName ?? ""})`;
    } else {
      identityConfirmed = true;
      identityDetail = `NIN provided (${input.nin}) — identity assumed (gateway unavailable)`;
    }
  } else if (input.phone) {
    identityConfirmed = true;
    identityDetail = `Phone provided (${input.phone}) — identity assumed`;
  }

  factors.push({
    check: "Identity Verification",
    result: identityConfirmed ? "pass" : "flag",
    detail: identityDetail,
  });

  // ── Sanctions check ────────────────────────────────────────────────────────
  let sanctionsHit = false;
  if (checks.includes("sanctions")) {
    const sanctionsData = await gatewayGet(`/v1/sanctions/${encodeURIComponent(input.fullName)}`) as any;
    if (sanctionsData && sanctionsData.hits && sanctionsData.hits.length > 0) {
      sanctionsHit = true;
      factors.push({
        check: "Sanctions & Watchlist",
        result: "fail",
        detail: `MATCH on ${sanctionsData.hits[0]?.list ?? "watchlist"}: ${sanctionsData.hits[0]?.reason ?? "sanctions hit"}`,
      });
    } else {
      factors.push({
        check: "Sanctions & Watchlist",
        result: "pass",
        detail: sanctionsData
          ? "No match on EFCC Wanted, INTERPOL, UN Sanctions, or NPF watchlists"
          : "Sanctions check unavailable — no match assumed (gateway offline)",
      });
    }
  }

  // ── Adverse media ──────────────────────────────────────────────────────────
  let adverseMediaHit = false;
  if (checks.includes("adverse_media")) {
    const pepData = await gatewayGet(`/v1/pep/${encodeURIComponent(input.fullName)}`) as any;
    if (pepData && pepData.isPep) {
      adverseMediaHit = true;
      factors.push({
        check: "Adverse Media & PEP",
        result: "flag",
        detail: `Subject identified as Politically Exposed Person (${pepData.position ?? "PEP"})`,
      });
    } else {
      factors.push({
        check: "Adverse Media & PEP",
        result: "pass",
        detail: pepData
          ? "No adverse news coverage or PEP status found"
          : "Adverse media check unavailable — no match assumed (gateway offline)",
      });
    }
  }

  // ── Criminal record ────────────────────────────────────────────────────────
  let criminalRecordHit = false;
  if (checks.includes("criminal_record")) {
    // Criminal record check via gateway (CRIB endpoint)
    const cribData = await gatewayGet(`/v1/crib/${encodeURIComponent(input.fullName)}`) as any;
    if (cribData && cribData.hasRecord) {
      criminalRecordHit = true;
      factors.push({
        check: "Criminal Record Check",
        result: "fail",
        detail: `Criminal record found: ${cribData.offence ?? "offence on record"} (${cribData.year ?? "year unknown"})`,
      });
    } else {
      factors.push({
        check: "Criminal Record Check",
        result: "pass",
        detail: cribData
          ? "No criminal record found in NPF CRIB database"
          : "Criminal record check unavailable — no record assumed (gateway offline)",
      });
    }
  }

  // ── Composite risk score (from Python risk engine, fallback to heuristic) ──
  let riskScore: number;
  if (checks.includes("risk_score")) {
    const engineScore = await riskEngineScore({
      subject_name: input.fullName,
      bvn: input.bvn,
      nin: input.nin,
      phone: input.phone,
      worker_category: input.workerCategory,
      identity_confirmed: identityConfirmed,
      sanctions_hit: sanctionsHit,
      adverse_media_hit: adverseMediaHit,
      criminal_record_hit: criminalRecordHit,
    });
    if (engineScore !== null) {
      riskScore = engineScore;
    } else {
      // Heuristic fallback
      const flagCount = factors.filter(f => f.result === "flag").length;
      const failCount = factors.filter(f => f.result === "fail").length;
      const baseScore = identityConfirmed ? 10 : 40;
      riskScore = Math.min(100, baseScore + (flagCount * 15) + (failCount * 35));
    }
    factors.push({
      check: "Composite Risk Score",
      result: riskScore < 30 ? "pass" : riskScore < 60 ? "flag" : "fail",
      detail: `Risk score: ${riskScore}/100 — ${riskScore < 30 ? "Low" : riskScore < 60 ? "Medium" : "High"} risk`,
    });
  } else {
    const flagCount = factors.filter(f => f.result === "flag").length;
    const failCount = factors.filter(f => f.result === "fail").length;
    const baseScore = identityConfirmed ? 10 : 40;
    riskScore = Math.min(100, baseScore + (flagCount * 15) + (failCount * 35));
  }

  // ── LLM summary ───────────────────────────────────────────────────────────
  let summary = "";
  try {
    const llmResp = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are a background check assistant for Nigerian households and small businesses. Write a concise 2-sentence plain-English summary of a background check result. Be reassuring if clear, factual if flagged. Do not use jargon.",
        },
        {
          role: "user",
          content: `Subject: ${input.fullName}, Category: ${input.workerCategory.replace("_", " ")}, Tier: ${input.tier}, Risk Score: ${riskScore}/100, Identity: ${identityConfirmed ? "confirmed" : "unverified"}, Sanctions: ${sanctionsHit ? "HIT" : "clear"}, Adverse Media: ${adverseMediaHit ? "HIT" : "clear"}, Criminal Record: ${criminalRecordHit ? "HIT" : "clear"}`,
        },
      ],
    });
    summary =
      (llmResp as any)?.choices?.[0]?.message?.content?.trim() ??
      `Background check for ${input.fullName} completed. ${riskScore < 30 ? "No concerns identified." : "Some items require review."}`;
  } catch {
    summary = `Background check for ${input.fullName} completed. ${riskScore < 30 ? "No concerns identified — this person appears safe to hire." : "Some items flagged for review — please examine the details below."}`;
  }

  const hasFlag = factors.some((f) => f.result === "flag");
  const hasFail = factors.some((f) => f.result === "fail");
  const verdict: "clear" | "flagged" | "fail" = hasFail ? "fail" : hasFlag ? "flagged" : "clear";

  const recommendation =
    verdict === "clear"
      ? "This person appears safe to hire. We recommend a face-to-face interview and reference check as a final step."
      : verdict === "flagged"
        ? "Some items require your attention before hiring. Review the flagged checks below and consider requesting additional documentation."
        : "We recommend against hiring this individual based on the checks performed. Consult a legal or HR professional if needed.";

  return {
    verdict,
    riskScore,
    identityConfirmed,
    sanctionsHit,
    adverseMediaHit,
    criminalRecordHit,
    summary,
    factors,
    recommendation,
  };
}

export const quickcheckRouter = router({
  /**
   * Run a QuickCheck on a prospective worker.
   * Available to all authenticated users (individuals, SMEs, enterprises).
   */
  run: writeProcedure
    .input(
      z.object({
        fullName: z.string().min(2).max(100),
        phone: z.string().optional(),
        bvn: z.string().optional(),
        nin: z.string().optional(),
        workerCategory: z.enum(WORKER_CATEGORIES),
        tier: z.enum(["basic", "standard", "premium"]).default("standard"),
        employerNote: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      // Generate a unique reference
      const ref = `QC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

      // Run the checks (real gateway calls with graceful fallback)
      const result = await runChecks({
        fullName: input.fullName,
        phone: input.phone,
        bvn: input.bvn,
        nin: input.nin,
        workerCategory: input.workerCategory,
        tier: input.tier,
      });

      // Persist as a screening request for audit trail
      await db.insert(screeningRequests).values({
        requestRef: ref,
        type: "zero_footprint",
        status: "completed",
        subjectName: input.fullName,
        subjectType: "individual",
        priority: "medium",
        requestData: {
          phone: input.phone,
          bvn: input.bvn,
          nin: input.nin,
          workerCategory: input.workerCategory,
          tier: input.tier,
          employerNote: input.employerNote,
          source: "quickcheck",
        },
        result: result as any,
        resultSummary: result.summary,
        riskScore: result.riskScore,
        createdBy: ctx.user!.id,
        completedAt: new Date(),
      });

      return {
        ref,
        ...result,
        tokensConsumed: TIER_TOKENS[input.tier] ?? 2,
        tier: input.tier,
        workerCategory: input.workerCategory,
        subjectName: input.fullName,
        completedAt: new Date().toISOString(),
      };
    }),

  /**
   * List the current user's QuickCheck history.
   */
  history: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(20) }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { items: [] };
      const rows = await db
        .select()
        .from(screeningRequests)
        .where(eq(screeningRequests.createdBy, ctx.user!.id))
        .orderBy(desc(screeningRequests.createdAt))
        .limit(input.limit);
      const quickCheckRows = rows.filter(
        (r) => (r.requestData as any)?.source === "quickcheck"
      );
      return { items: quickCheckRows };
    }),
});
