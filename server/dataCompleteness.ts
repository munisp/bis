/**
 * server/dataCompleteness.ts
 *
 * Thin-file / data-completeness scoring, extracted from server/routers.ts
 * (getDataCompleteness) so both the operator-facing procedure and the
 * subject-facing portal (server/subjectPortal.ts) compute the SAME score.
 * Do not fork this logic — extend it here.
 */
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import {
  fieldVisitReports,
  investigations,
  kycRecords,
  screeningOrders,
  screeningResults,
} from "../drizzle/schema";

// Minimal structural type for the Drizzle handle so this module does not
// depend on server/db.ts (keeps unit-test mocking trivial).
export type DbHandle = {
  select: (...args: any[]) => any;
};

export function getFallbackSuggestion(source: string): string {
  const map: Record<string, string> = {
    nin_trace:           'Request NIN slip or NIMC self-service printout from subject',
    bvn_fraud_check:     'Request recent bank statement (last 3 months) as alternative',
    npf_criminal:        'Request sworn affidavit of good character from magistrate court',
    efcc_watchlist:      'Cross-check against INTERPOL Red Notice list manually',
    pep_check:           'Search public records: INEC portal, FIRS TCC, NASS website',
    adverse_media_ng:    'Run manual Google News search with subject name + "fraud" / "court"',
    cac_full_profile:    'Request certified true copy of Certificate of Incorporation',
    firs_tax_clearance:  'Request TCC (Tax Clearance Certificate) from entity directly',
    beneficial_owner:    'Request CAC Form CO2 (Return of Allotment) from entity directly',
    corporate_sanctions: 'Cross-check OFAC SDN list and UN consolidated sanctions list',
  };
  return map[source] ?? 'Request supporting documentation from subject directly';
}

export type DataCompletenessReport = {
  score: number;
  sourcesChecked: number;
  sourcesTotal: number;
  thinFile: boolean;
  coverage: { source: string; label: string; hasData: boolean; fallback: string }[];
  missingCritical: string[];
};

export async function computeDataCompleteness(db: DbHandle, investigationRef: string): Promise<DataCompletenessReport> {
  const [inv] = await db.select().from(investigations).where(eq(investigations.ref, investigationRef)).limit(1);
  if (!inv) throw new TRPCError({ code: 'NOT_FOUND' });
  const isCorperate = inv.subjectType === 'corporate';
  const expectedSources = isCorperate
    ? ['cac_full_profile', 'firs_tax_clearance', 'beneficial_owner', 'corporate_sanctions']
    : ['nin_trace', 'bvn_fraud_check', 'npf_criminal', 'efcc_watchlist', 'pep_check', 'adverse_media_ng'];
  // screeningResults links via screeningOrders.investigationRef
  const orderRows = await db.select({ id: screeningOrders.id, types: screeningOrders.screeningTypes })
    .from(screeningOrders).where(eq(screeningOrders.investigationRef, investigationRef));
  const orderIds = orderRows.map((o: any) => o.id);
  const screeningRows = orderIds.length > 0
    ? await db.select().from(screeningResults).where(and(inArray(screeningResults.orderId, orderIds), eq(screeningResults.status, 'completed')))
    : [];
  const completedTypes = new Set(screeningRows.map((r: any) => r.screeningType));
  const kycRows = await db.select().from(kycRecords).where(eq(kycRecords.investigationId, inv.id)).limit(1);
  const hasKyc = kycRows.length > 0 && kycRows[0].status !== 'pending';
  const visitRows = await db.select().from(fieldVisitReports).where(eq(fieldVisitReports.investigationId, inv.id)).limit(1);
  const hasFieldVisit = visitRows.length > 0 && visitRows[0].submittedAt != null;
  const coverage = expectedSources.map(src => ({
    source: src,
    label: src.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
    hasData: completedTypes.has(src),
    fallback: getFallbackSuggestion(src),
  }));
  const bonusSources = [
    { source: 'kyc_identity', label: 'KYC Identity Verification', hasData: hasKyc, fallback: 'Request government-issued ID document upload' },
    { source: 'field_visit', label: 'Field Visit / Physical Verification', hasData: hasFieldVisit, fallback: 'Dispatch field agent for address verification' },
  ];
  const allCoverage = [...coverage, ...bonusSources];
  const sourcesWithData = allCoverage.filter(c => c.hasData).length;
  const score = Math.round((sourcesWithData / allCoverage.length) * 100);
  const thinFile = score < 40;
  return { score, sourcesChecked: sourcesWithData, sourcesTotal: allCoverage.length, thinFile, coverage: allCoverage, missingCritical: coverage.filter(c => !c.hasData).map(c => c.source) };
}
