/**
 * entitySearch.ts — Unified one-box entity search + related-persons graph (WP1).
 *
 * Closes the Intelius-parity gap: a single query box that auto-detects whether the
 * operator typed a NIN/BVN (11 digits), a CAC RC number, a phone number, or a name,
 * then fans out across every relevant tenant-scoped source in parallel with
 * per-source failure isolation (one failing source never sinks the rest).
 *
 * Also assembles a related-persons graph (beneficial owners, informal-sector
 * references, shared phone/address) with provenance-labelled confidence:
 *   direct_documented (beneficial owner, signed guarantor) → high
 *   declared (self-nominated referee / other reference)     → medium
 *   shared_attribute (same phone/address)                   → low
 *
 * SECURITY: every row is tenant-scoped from ctx.tenantId (never client-supplied),
 * every search and graph view is written to the HMAC-integrity audit log, and the
 * gateway call fails closed when the gateway URL is not configured.
 */
import { createHmac } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { getPgPool } from "./db";
import { ENV } from "./_core/env";

// ─── Query-type detection (pure, unit-tested) ────────────────────────────────

export type QueryType = "nin_bvn" | "cac" | "phone" | "name";

/**
 * Classify a one-box query string.
 *  - 11 digits not starting with 0 → dual NIN + BVN lookup
 *  - 11 digits starting with 0 (Nigerian local mobile) → phone
 *  - RC prefix followed by digits → CAC corporate lookup
 *  - any other dialable digit pattern (optionally + international) → phone
 *  - otherwise → fuzzy name search
 */
export function detectQueryType(raw: string): QueryType {
  const q = raw.trim();
  if (/^\d{11}$/.test(q)) return q.startsWith("0") ? "phone" : "nin_bvn";
  if (/^RC[\s-]?\d{3,}$/i.test(q)) return "cac";
  const dialable = q.replace(/[\s\-()]/g, "");
  if (/^\+?\d{7,15}$/.test(dialable)) return "phone";
  return "name";
}

/** Normalize an RC query (e.g. "rc 123456" / "RC-123456") to "RC123456". */
export function normalizeRcNumber(raw: string): string {
  const compact = raw.trim().toUpperCase().replace(/[\s-]+/g, "");
  return compact.startsWith("RC") ? compact : `RC${compact.replace(/^RC/, "")}`;
}

/** Equivalent Nigerian phone variants so "0803…", "234803…" and "+234803…" all match. */
export function phoneVariants(raw: string): string[] {
  const q = raw.trim().replace(/[\s\-()]/g, "");
  const variants = new Set<string>([q]);
  if (q.startsWith("+234")) {
    variants.add(`0${q.slice(4)}`);
    variants.add(q.slice(1));
  } else if (q.startsWith("234")) {
    variants.add(`0${q.slice(3)}`);
    variants.add(`+${q}`);
  } else if (q.startsWith("0")) {
    variants.add(`+234${q.slice(1)}`);
    variants.add(`234${q.slice(1)}`);
  }
  return Array.from(variants);
}

// ─── Confidence classification (pure, unit-tested) ───────────────────────────

export type EvidenceKind = "direct_documented" | "declared" | "shared_attribute";
export type Confidence = "high" | "medium" | "low";

export function confidenceForEvidenceKind(kind: EvidenceKind): Confidence {
  switch (kind) {
    case "direct_documented": return "high";
    case "declared": return "medium";
    case "shared_attribute": return "low";
  }
}

/**
 * Map an informal_references.source_type to an evidence kind.
 * A guarantor signs a legally-binding guarantee → direct_documented.
 * Every other reference (self-nominated referee, landlord, association, …) is a
 * declared relationship until independently corroborated.
 */
export function evidenceKindForReferenceType(sourceType: string): EvidenceKind {
  return sourceType === "guarantor" ? "direct_documented" : "declared";
}

export interface BeneficialOwner {
  name: string;
  role: "beneficial_owner" | "director" | "shareholder";
  shareholding?: string;
}

/** Extract beneficial owners / directors from a CAC gateway JSON payload of unknown-but-known shapes. */
export function extractBeneficialOwners(payload: unknown): BeneficialOwner[] {
  if (!payload || typeof payload !== "object") return [];
  const out: BeneficialOwner[] = [];
  const seen = new Set<string>();
  const push = (entry: unknown, role: BeneficialOwner["role"]) => {
    if (typeof entry === "string") {
      const name = entry.trim();
      if (name.length >= 2 && !seen.has(`${role}:${name.toLowerCase()}`)) {
        seen.add(`${role}:${name.toLowerCase()}`);
        out.push({ name, role });
      }
      return;
    }
    if (!entry || typeof entry !== "object") return;
    const rec = entry as Record<string, unknown>;
    const name = String(rec.name ?? rec.fullName ?? rec.full_name ?? rec.director ?? "").trim();
    if (name.length < 2) return;
    const key = `${role}:${name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const shareholding = rec.shareholding ?? rec.shares ?? rec.percentage;
    out.push({ name, role, ...(shareholding != null ? { shareholding: String(shareholding) } : {}) });
  };
  const container = payload as Record<string, unknown>;
  const data = (container.data && typeof container.data === "object" ? container.data : {}) as Record<string, unknown>;
  for (const source of [container, data]) {
    for (const entry of asArray(source.beneficial_owners) ?? asArray(source.beneficialOwners) ?? []) push(entry, "beneficial_owner");
    for (const entry of asArray(source.directors) ?? []) push(entry, "director");
    for (const entry of asArray(source.shareholders) ?? []) push(entry, "shareholder");
  }
  if (Array.isArray(payload)) for (const entry of payload) push(entry, "director");
  return out;
}
function asArray(v: unknown): unknown[] | null { return Array.isArray(v) ? v : null; }

// ─── Shared helpers ───────────────────────────────────────────────────────────

interface Actor { tenantId: number; userId: number; userEmail?: string }

function requireTenant(ctx: { tenantId: number | null; user: { id: number; email?: string | null } | null }): Actor {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "An authenticated operator is required" });
  if (!ctx.tenantId || ctx.tenantId <= 0) throw new TRPCError({ code: "FORBIDDEN", message: "An explicit tenant context is required" });
  return { tenantId: ctx.tenantId, userId: ctx.user.id, userEmail: ctx.user.email ?? undefined };
}

async function poolOrFail() {
  const pool = await getPgPool();
  if (!pool) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Entity search storage is unavailable" });
  return pool;
}

/** Gateway identity lookup — fails closed when the gateway is not configured. */
async function gatewayGet(path: string): Promise<unknown> {
  if (!ENV.bisGatewayUrl) throw new Error("BIS_GATEWAY_URL is not configured");
  const res = await fetch(`${ENV.bisGatewayUrl}${path}`, { headers: { "X-BIS-Key": ENV.bisGatewayKey } });
  if (!res.ok) throw new Error(`Gateway error ${res.status}: ${await res.text()}`);
  return res.json();
}

export interface SourceStatus {
  source: string;
  status: "ok" | "error";
  latencyMs: number;
  error?: string;
}

interface SourcedResult<T> { source: string; data: T }

async function timed<T>(source: string, run: () => Promise<T>): Promise<SourcedResult<T>> {
  const data = await run();
  return { source, data };
}

/**
 * Fan out across sources with Promise.allSettled semantics: each source records
 * its own status + latency, and a rejected source is captured as
 * { status: "error" } instead of sinking the whole search.
 */
async function runSources<T>(tasks: Array<{ source: string; run: () => Promise<T> }>): Promise<{ results: Map<string, T>; sources: SourceStatus[] }> {
  const started = tasks.map(() => Date.now());
  const settled = await Promise.allSettled(tasks.map((t) => timed(t.source, t.run)));
  const results = new Map<string, T>();
  const sources: SourceStatus[] = [];
  settled.forEach((outcome, i) => {
    const latencyMs = Date.now() - started[i];
    if (outcome.status === "fulfilled") {
      results.set(outcome.value.source, outcome.value.data);
      sources.push({ source: outcome.value.source, status: "ok", latencyMs });
    } else {
      sources.push({
        source: tasks[i].source,
        status: "error",
        latencyMs,
        error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      });
    }
  });
  return { results, sources };
}

type Pool = NonNullable<Awaited<ReturnType<typeof getPgPool>>>;

/**
 * HMAC-integrity audit write, mirroring writeAuditLog in routers.ts
 * (category "api"). Attempted on every search/graph view; a write failure is
 * logged but does not block the operator, consistent with existing behavior.
 */
async function writeSearchAudit(pool: Pool, actor: Actor, entry: {
  action: string;
  targetRef?: string;
  result?: "success" | "warning" | "failure";
  detail?: unknown;
}) {
  try {
    const result = entry.result ?? "success";
    const createdAt = new Date();
    const payload = [String(actor.userId), "api", entry.action, entry.targetRef ?? "", result, createdAt.toISOString()].join("|");
    const integrityHash = createHmac("sha256", ENV.auditHmacSecret).update(payload).digest("hex").slice(0, 64);
    await pool.query(
      `INSERT INTO audit_log ("tenantId", "userId", "userEmail", category, action, "targetRef", result, detail, "integrityHash", "createdAt")
       VALUES ($1, $2, $3, 'api', $4, $5, $6, $7::jsonb, $8, $9)`,
      [actor.tenantId, actor.userId, actor.userEmail ?? null, entry.action, entry.targetRef ?? null, result,
       entry.detail != null ? JSON.stringify(entry.detail) : null, integrityHash, createdAt],
    );
  } catch (e) {
    console.warn("[EntitySearch] Failed to write audit log:", e);
  }
}

// ─── Row shapes ───────────────────────────────────────────────────────────────

const INVESTIGATION_COLS = `id, ref, "subjectName", "subjectType", status, "riskScore", "riskTier", nin, bvn, phone, email, "createdAt"`;
const KYC_COLS = `id, "subjectName", "subjectRef", status, "riskScore", nin, bvn, phone, "createdAt"`;
const CANDIDATE_COLS = `id, "candidateRef", "firstName", "lastName", email, phone, nin, bvn, "consentStatus"`;

// ─── Router ───────────────────────────────────────────────────────────────────

export const entitySearchRouter = router({
  /**
   * Unified one-box search. Detects the query type, fans out across the gateway
   * (NIN/BVN/CAC) and tenant-scoped internal tables in parallel, records per-source
   * status + latency, and audit-logs who searched what.
   */
  search: protectedProcedure
    .input(z.object({ query: z.string().min(2).max(256) }))
    .query(async ({ input, ctx }) => {
      const actor = requireTenant(ctx);
      const pool = await poolOrFail();
      const queryType = detectQueryType(input.query);
      const q = input.query.trim();

      const tasks: Array<{ source: string; run: () => Promise<unknown> }> = [];

      if (queryType === "nin_bvn") {
        tasks.push(
          { source: "gateway_nin", run: () => gatewayGet(`/v1/nin/${q}`) },
          { source: "gateway_bvn", run: () => gatewayGet(`/v1/bvn/${q}`) },
          { source: "investigations", run: async () => (await pool.query(
              `SELECT ${INVESTIGATION_COLS} FROM investigations
               WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND (nin = $2 OR bvn = $2)
               ORDER BY "createdAt" DESC LIMIT 25`, [actor.tenantId, q])).rows },
          { source: "kyc_records", run: async () => (await pool.query(
              `SELECT ${KYC_COLS} FROM kyc_records
               WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND (nin = $2 OR bvn = $2)
               ORDER BY "createdAt" DESC LIMIT 25`, [actor.tenantId, q])).rows },
          { source: "candidate_profiles", run: async () => (await pool.query(
              `SELECT ${CANDIDATE_COLS} FROM candidate_profiles
               WHERE "tenantId" = $1 AND (nin = $2 OR bvn = $2)
               ORDER BY "createdAt" DESC LIMIT 25`, [actor.tenantId, q])).rows },
        );
      } else if (queryType === "cac") {
        const rc = normalizeRcNumber(q);
        tasks.push(
          { source: "gateway_cac", run: () => gatewayGet(`/v1/cac/${encodeURIComponent(rc)}`) },
          { source: "corporate_screening_profiles", run: async () => (await pool.query(
              `SELECT id, "profileRef", "companyName", "rcNumber", status, "overallOutcome", "riskScore", "investigationRef"
               FROM corporate_screening_profiles
               WHERE "tenantId" = $1 AND "rcNumber" = $2
               ORDER BY "createdAt" DESC LIMIT 10`, [actor.tenantId, rc])).rows },
        );
      } else if (queryType === "phone") {
        const variants = phoneVariants(q);
        tasks.push(
          { source: "investigations", run: async () => (await pool.query(
              `SELECT ${INVESTIGATION_COLS} FROM investigations
               WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND phone = ANY($2::text[])
               ORDER BY "createdAt" DESC LIMIT 25`, [actor.tenantId, variants])).rows },
          { source: "kyc_records", run: async () => (await pool.query(
              `SELECT ${KYC_COLS} FROM kyc_records
               WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND phone = ANY($2::text[])
               ORDER BY "createdAt" DESC LIMIT 25`, [actor.tenantId, variants])).rows },
          { source: "candidate_profiles", run: async () => (await pool.query(
              `SELECT ${CANDIDATE_COLS} FROM candidate_profiles
               WHERE "tenantId" = $1 AND phone = ANY($2::text[])
               ORDER BY "createdAt" DESC LIMIT 25`, [actor.tenantId, variants])).rows },
        );
      } else {
        const pattern = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
        tasks.push(
          { source: "investigations", run: async () => (await pool.query(
              `SELECT ${INVESTIGATION_COLS} FROM investigations
               WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND "subjectName" ILIKE $2
               ORDER BY "createdAt" DESC LIMIT 25`, [actor.tenantId, pattern])).rows },
          { source: "kyc_records", run: async () => (await pool.query(
              `SELECT ${KYC_COLS} FROM kyc_records
               WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND "subjectName" ILIKE $2
               ORDER BY "createdAt" DESC LIMIT 25`, [actor.tenantId, pattern])).rows },
          { source: "candidate_profiles", run: async () => (await pool.query(
              `SELECT ${CANDIDATE_COLS} FROM candidate_profiles
               WHERE "tenantId" = $1 AND ("firstName" || ' ' || "lastName") ILIKE $2
               ORDER BY "createdAt" DESC LIMIT 25`, [actor.tenantId, pattern])).rows },
        );
      }

      const { results, sources } = await runSources(tasks);

      const identities: Array<Record<string, unknown>> = [];
      const ninIdentity = results.get("gateway_nin");
      if (ninIdentity != null) identities.push({ type: "nin", reference: q, data: ninIdentity });
      const bvnIdentity = results.get("gateway_bvn");
      if (bvnIdentity != null) identities.push({ type: "bvn", reference: q, data: bvnIdentity });
      const cacIdentity = results.get("gateway_cac");
      if (cacIdentity != null) identities.push({ type: "cac", reference: normalizeRcNumber(q), data: cacIdentity });
      for (const row of (results.get("candidate_profiles") as Array<Record<string, unknown>> | undefined) ?? []) {
        identities.push({ type: "candidate", reference: row.candidateRef, data: row });
      }
      for (const row of (results.get("corporate_screening_profiles") as Array<Record<string, unknown>> | undefined) ?? []) {
        identities.push({ type: "corporate_profile", reference: row.profileRef, data: row });
      }

      const investigations = (results.get("investigations") as unknown[] | undefined) ?? [];
      const kyc = (results.get("kyc_records") as unknown[] | undefined) ?? [];

      // Every search is sensitive: record who searched what, and how each source fared.
      await writeSearchAudit(pool, actor, {
        action: "Entity search performed",
        targetRef: queryType === "name" ? q.slice(0, 64) : undefined,
        result: sources.some((s) => s.status === "error") ? "warning" : "success",
        detail: {
          query: q,
          queryType,
          resultCounts: { identities: identities.length, investigations: investigations.length, kyc: kyc.length },
          sources: sources.map(({ source, status, latencyMs }) => ({ source, status, latencyMs })),
        },
      });

      return { queryType, identities, investigations, kyc, sources };
    }),

  /**
   * Related-persons graph for a subject (by investigationRef and/or candidateId).
   * Assembles beneficial owners (documented), informal-sector references
   * (guarantor = documented, other refs = declared) and shared phone/address
   * matches (shared_attribute) — all provenance-labelled and tenant-scoped.
   */
  getAssociates: protectedProcedure
    .input(z.object({
      investigationRef: z.string().min(4).max(32).optional(),
      candidateId: z.number().int().positive().optional(),
    }).refine((v) => v.investigationRef != null || v.candidateId != null, {
      message: "An investigationRef or candidateId is required",
    }))
    .query(async ({ input, ctx }) => {
      const actor = requireTenant(ctx);
      const pool = await poolOrFail();

      // ── Resolve the subject (tenant-scoped) ──────────────────────────────
      let investigation: Record<string, unknown> | null = null;
      if (input.investigationRef) {
        const res = await pool.query(
          `SELECT id, ref, "subjectName", phone, address, nin, bvn, "candidateProfileId"
           FROM investigations WHERE ref = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
          [input.investigationRef, actor.tenantId],
        );
        investigation = res.rows[0] ?? null;
        if (!investigation && input.candidateId == null) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Investigation not found in this tenant" });
        }
      }
      const candidateId = input.candidateId ?? (investigation?.candidateProfileId as number | null) ?? null;
      let candidate: Record<string, unknown> | null = null;
      if (candidateId != null) {
        const res = await pool.query(
          `SELECT id, "candidateRef", "firstName", "lastName", phone, "currentAddress", nin, bvn
           FROM candidate_profiles WHERE id = $1 AND "tenantId" = $2 LIMIT 1`,
          [candidateId, actor.tenantId],
        );
        candidate = res.rows[0] ?? null;
      }
      if (!investigation && !candidate) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Subject not found in this tenant" });
      }

      const subjectName = candidate
        ? `${candidate.firstName} ${candidate.lastName}`
        : String(investigation!.subjectName);
      const subjectId = investigation ? `inv:${investigation.ref}` : `candidate:${candidate!.id}`;
      const subjectPhones = [investigation?.phone, candidate?.phone].filter((p): p is string => typeof p === "string" && p.length > 0);
      const subjectPhoneVariants = Array.from(new Set(subjectPhones.flatMap(phoneVariants)));
      const subjectAddresses = [investigation?.address, candidate?.currentAddress]
        .filter((a): a is string => typeof a === "string" && a.trim().length >= 8)
        .map((a) => a.trim());

      // ── Fan out across association sources (failure-isolated) ────────────
      const tasks: Array<{ source: string; run: () => Promise<unknown> }> = [];
      if (input.investigationRef) {
        tasks.push({ source: "corporate_screening_profiles", run: async () => (await pool.query(
          `SELECT "profileRef", "companyName", "directorsResult", "cacResult"
           FROM corporate_screening_profiles WHERE "investigationRef" = $1 AND "tenantId" = $2`,
          [input.investigationRef, actor.tenantId])).rows });
      }
      tasks.push({ source: "informal_references", run: async () => (await pool.query(
        `SELECT r.id, r.source_type, r.source_display_name, r.relationship_to_subject, r.provenance_status
         FROM informal_references r
         JOIN informal_verification_cases c ON c.id = r.case_id
         WHERE r.tenant_id = $1 AND r.withdrawn_at IS NULL
           AND (($2::int IS NOT NULL AND c.candidate_id = $2) OR ($3::int IS NOT NULL AND c.investigation_id = $3))`,
        [actor.tenantId, candidateId, investigation?.id ?? null])).rows });
      if (subjectPhoneVariants.length > 0) {
        tasks.push({ source: "shared_phone_kyc", run: async () => (await pool.query(
          `SELECT id, "subjectName", "subjectRef", phone FROM kyc_records
           WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND phone = ANY($2::text[]) LIMIT 25`,
          [actor.tenantId, subjectPhoneVariants])).rows });
      }
      if (subjectAddresses.length > 0 || subjectPhoneVariants.length > 0) {
        tasks.push({ source: "shared_attribute_investigations", run: async () => {
          const clauses: string[] = [];
          const params: unknown[] = [actor.tenantId];
          if (subjectPhoneVariants.length > 0) { params.push(subjectPhoneVariants); clauses.push(`phone = ANY($${params.length}::text[])`); }
          for (const addr of subjectAddresses.slice(0, 3)) { params.push(`%${addr.replace(/[%_]/g, (m) => `\\${m}`)}%`); clauses.push(`address ILIKE $${params.length}`); }
          const excludeRef = investigation?.ref ?? "";
          params.push(excludeRef);
          return (await pool.query(
            `SELECT id, ref, "subjectName", phone, address FROM investigations
             WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND ref <> $${params.length} AND (${clauses.join(" OR ")}) LIMIT 25`,
            params,
          )).rows;
        } });
      }
      const { results, sources } = await runSources(tasks);

      // ── Assemble the provenance-labelled graph ───────────────────────────
      interface GraphNode { id: string; name: string; type: string; sources: string[] }
      interface GraphEdge { from: string; to: string; relationship: string; confidence: Confidence; evidenceRef: string }
      const nodes = new Map<string, GraphNode>();
      const edges: GraphEdge[] = [];
      const edgeKeys = new Set<string>();
      const addNode = (node: GraphNode) => {
        const existing = nodes.get(node.id);
        if (existing) { for (const s of node.sources) if (!existing.sources.includes(s)) existing.sources.push(s); }
        else nodes.set(node.id, node);
      };
      const addEdge = (edge: GraphEdge) => {
        const key = `${edge.from}|${edge.to}|${edge.relationship}`;
        if (edgeKeys.has(key)) return;
        edgeKeys.add(key);
        edges.push(edge);
      };
      addNode({ id: subjectId, name: subjectName, type: "subject", sources: ["subject"] });

      // Beneficial owners / directors — direct_documented → high
      for (const profile of (results.get("corporate_screening_profiles") as Array<Record<string, unknown>> | undefined) ?? []) {
        const owners = [...extractBeneficialOwners(profile.directorsResult), ...extractBeneficialOwners(profile.cacResult)];
        for (const owner of owners) {
          const nodeId = `bo:${profile.profileRef}:${owner.name.toLowerCase().replace(/\s+/g, "_")}`;
          addNode({ id: nodeId, name: owner.name, type: "beneficial_owner", sources: ["corporate_screening_profiles"] });
          addEdge({
            from: nodeId, to: subjectId,
            relationship: owner.role === "director" ? "director_of_subject_entity" : "beneficial_owner_of_subject_entity",
            confidence: confidenceForEvidenceKind("direct_documented"),
            evidenceRef: String(profile.profileRef),
          });
        }
      }

      // Informal references — guarantor = direct_documented (high), others declared (medium)
      for (const ref of (results.get("informal_references") as Array<Record<string, unknown>> | undefined) ?? []) {
        const nodeId = `ref:${ref.id}`;
        const kind = evidenceKindForReferenceType(String(ref.source_type));
        addNode({ id: nodeId, name: String(ref.source_display_name), type: String(ref.source_type), sources: ["informal_references"] });
        addEdge({
          from: nodeId, to: subjectId,
          relationship: String(ref.relationship_to_subject),
          confidence: confidenceForEvidenceKind(kind),
          evidenceRef: String(ref.id),
        });
      }

      // Shared phone in KYC — shared_attribute → low
      for (const row of (results.get("shared_phone_kyc") as Array<Record<string, unknown>> | undefined) ?? []) {
        const nodeId = `kyc:${row.id}`;
        addNode({ id: nodeId, name: String(row.subjectName), type: "shared_contact", sources: ["kyc_records"] });
        addEdge({
          from: nodeId, to: subjectId, relationship: "shared_phone",
          confidence: confidenceForEvidenceKind("shared_attribute"),
          evidenceRef: String(row.subjectRef ?? `kyc:${row.id}`),
        });
      }

      // Shared phone/address across investigations — shared_attribute → low
      for (const row of (results.get("shared_attribute_investigations") as Array<Record<string, unknown>> | undefined) ?? []) {
        const nodeId = `inv:${row.ref}`;
        const sharedPhone = typeof row.phone === "string" && subjectPhoneVariants.includes(row.phone);
        addNode({ id: nodeId, name: String(row.subjectName), type: "shared_contact", sources: ["investigations"] });
        addEdge({
          from: nodeId, to: subjectId,
          relationship: sharedPhone ? "shared_phone" : "shared_address",
          confidence: confidenceForEvidenceKind("shared_attribute"),
          evidenceRef: String(row.ref),
        });
      }

      await writeSearchAudit(pool, actor, {
        action: "Related-persons graph viewed",
        targetRef: input.investigationRef ?? (candidate ? String(candidate.candidateRef) : undefined),
        detail: { investigationRef: input.investigationRef ?? null, candidateId, nodeCount: nodes.size, edgeCount: edges.length },
      });

      return { nodes: Array.from(nodes.values()), edges, sources };
    }),

  /**
   * Current tenant's audit-logged entity searches, keyset-paginated by audit id.
   */
  searchHistory: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(20),
      cursor: z.number().int().positive().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const actor = requireTenant(ctx);
      const pool = await poolOrFail();
      const res = await pool.query(
        `SELECT id, "userId", "userEmail", action, "targetRef", result, detail, "createdAt"
         FROM audit_log
         WHERE "tenantId" = $1 AND category = 'api'
           AND (action LIKE 'Entity search%' OR action LIKE 'Related-persons%')
           AND ($2::int IS NULL OR id < $2)
         ORDER BY id DESC LIMIT $3`,
        [actor.tenantId, input.cursor ?? null, input.limit],
      );
      const items = res.rows as Array<{ id: number }>;
      return {
        items,
        nextCursor: items.length === input.limit ? items[items.length - 1].id : null,
      };
    }),
});
