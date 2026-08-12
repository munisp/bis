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
 * Identity verification: calls Youverify API (BVN via NIBSS, NIN via NIMC).
 * The router never substitutes heuristic or fabricated screening results.
 */

import { z } from "zod";
import { router, writeProcedure, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { screeningRequests } from "../drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { ENV } from "./_core/env";

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

// ─── Real identity lookup via Youverify (BVN/NIN) ────────────────────────────

async function lookupIdentity(
  bvn?: string,
  nin?: string,
  fullName?: string
): Promise<{ confirmed: boolean; detail: string }> {
  const { youverifyApiKey, youverifyBaseUrl } = ENV;

  if (!youverifyApiKey || youverifyApiKey.startsWith("bis-")) {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Identity verification is not configured; no QuickCheck result was generated." });
  }

  try {
    const endpoint = bvn
      ? `${youverifyBaseUrl}/identity/bvn`
      : nin
        ? `${youverifyBaseUrl}/identity/nin`
        : null;

    if (!endpoint) {
      return { confirmed: false, detail: "No BVN/NIN provided — identity unverified" };
    }

    const payload = bvn ? { id: bvn, isSubjectConsent: true } : { id: nin, isSubjectConsent: true };

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: youverifyApiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.warn("[QuickCheck] Youverify identity lookup failed:", resp.status, errText);
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: `Identity verification provider returned ${resp.status}; no QuickCheck result was generated.` });
    }

    const data = (await resp.json()) as {
      data?: { firstName?: string; lastName?: string; fullName?: string };
    };
    const apiName =
      [data.data?.firstName, data.data?.lastName].filter(Boolean).join(" ").trim() ||
      data.data?.fullName ||
      "";

    const nameMatch =
      apiName.length > 0 && fullName
        ? fullName
            .toLowerCase()
            .split(" ")
            .some((w) => apiName.toLowerCase().includes(w))
        : true;

    return {
      confirmed: nameMatch,
      detail: nameMatch
        ? `Name confirmed via ${bvn ? "BVN (NIBSS)" : "NIN (NIMC)"} — record matches`
        : `Name mismatch: submitted "${fullName}" vs record "${apiName}"`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[QuickCheck] Youverify lookup error:", msg);
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: `Identity verification service unavailable: ${msg.slice(0, 80)}` });
  }
}

// ─── Core check runner ────────────────────────────────────────────────────────

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
  if (checks.some((check) => check !== "identity")) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "QuickCheck sanctions, adverse-media, criminal-record, and composite-risk checks require live providers that are not configured in this route. No result was generated.",
    });
  }
  const factors: Array<{ check: string; result: "pass" | "flag" | "fail"; detail: string }> = [];

  // Identity check — requires a real Youverify response.
  const identity = await lookupIdentity(input.bvn, input.nin, input.fullName);
  const identityConfirmed = identity.confirmed;
  factors.push({
    check: "Identity Verification",
    result: identityConfirmed ? "pass" : "flag",
    detail: identity.detail,
  });

  // Unsupported premium checks never reach this point: they fail closed above.
  const sanctionsHit = false;
  const adverseMediaHit = false;
  const criminalRecordHit = false;
  const riskScore = identityConfirmed ? 0 : 100;
  const summary = identityConfirmed
    ? "Identity was confirmed by the configured provider. No other screening category was run."
    : "Identity was not confirmed by the configured provider. No other screening category was run.";

  const hasFlag = factors.some((f) => f.result === "flag");
  const hasFail = factors.some((f) => f.result === "fail");
  const verdict: "clear" | "flagged" | "fail" = hasFail ? "fail" : hasFlag ? "flagged" : "clear";

  const recommendation =
    verdict === "clear"
      ? "Identity confirmation alone is not a hiring recommendation. Run separately configured sanctions, criminal-record, and reference checks before making a decision."
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

// ─── Router ───────────────────────────────────────────────────────────────────

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

      // Generate a unique reference (crypto-based, no Math.random)
      const randomPart = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
      const ref = `QC-${Date.now().toString(36).toUpperCase()}-${randomPart}`;

      // Run the checks (calls real Youverify gateway when API key configured)
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
        type: "zero_footprint", // closest existing type
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

      // Filter to only QuickCheck records
      const quickCheckRows = rows.filter(
        (r) => (r.requestData as any)?.source === "quickcheck"
      );

      return { items: quickCheckRows };
    }),
});
