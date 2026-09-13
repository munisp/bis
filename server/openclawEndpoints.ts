/**
 * server/openclawEndpoints.ts
 * OpenClaw managed instance endpoint + Swagger UI for the BIS API.
 * Mounted into the Express app in server/_core/index.ts.
 */
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import swaggerUi from "swagger-ui-express";
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { apiTokens, investigations, kycRecords, sarFilings, alerts, auditLog } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { ENV } from "./_core/env";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load OpenAPI spec ────────────────────────────────────────────────────────
let openApiSpec: Record<string, unknown> = {};
try {
  // Try multiple candidate paths to handle tsx (dev) and esbuild (prod) contexts
  // In tsx dev mode, import.meta.url resolves to the project root, not server/
  const candidates = [
    path.join(__dirname, "openapi.yaml"),
    path.join(__dirname, "server", "openapi.yaml"),
    path.join(process.cwd(), "server", "openapi.yaml"),
    path.join(process.cwd(), "openapi.yaml"),
  ];
  let loaded = false;
  for (const specPath of candidates) {
    if (fs.existsSync(specPath)) {
      const raw = fs.readFileSync(specPath, "utf8");
      openApiSpec = yaml.load(raw) as Record<string, unknown>;
      console.info(`[OpenClaw] Loaded openapi.yaml from ${specPath}`);
      loaded = true;
      break;
    }
  }
  if (!loaded) {
    console.warn("[OpenClaw] Could not load openapi.yaml — Swagger UI will be empty");
  }
} catch {
  console.warn("[OpenClaw] Could not load openapi.yaml — Swagger UI will be empty");
}

// ── Token validation helpers ─────────────────────────────────────────────────
// Tokens are issued by server/apiTokens.ts and stored as SHA-256 hex hashes in
// apiTokens.tokenHash — never as plaintext. Validation must reuse that exact
// hashing scheme.

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

type BearerAuthResult =
  | { ok: true; token: string; record: typeof apiTokens.$inferSelect }
  | { ok: false; status: number; code: string; message: string };

function bearerAuthFailure(status: number, code: string, message: string): BearerAuthResult {
  return { ok: false, status, code, message };
}

/**
 * Validate the `Authorization: Bearer <token>` header against the apiTokens
 * table: hash the presented token with SHA-256 (hex) and look up
 * apiTokens.tokenHash, then enforce `active` and `expiresAt`.
 *
 * Fails CLOSED: when the database is unavailable the request is rejected with
 * 503 rather than being allowed through.
 */
async function authenticateBearerToken(
  req: { headers: Record<string, string | string[] | undefined> },
): Promise<BearerAuthResult> {
  const auth = req.headers["authorization"] as string | undefined;
  if (!auth?.startsWith("Bearer ")) {
    return bearerAuthFailure(401, "UNAUTHORIZED", "Invalid or missing Bearer token");
  }
  const token = auth.slice(7);
  // Fast reject before hitting the DB — issued BIS API tokens carry a bis_/bisk_ prefix
  if (!token.startsWith("bis_") && !token.startsWith("bisk_")) {
    return bearerAuthFailure(401, "UNAUTHORIZED", "Invalid or missing Bearer token");
  }
  const db = await getDb();
  if (!db) {
    return bearerAuthFailure(503, "DB_UNAVAILABLE", "Authentication service unavailable");
  }
  let record: typeof apiTokens.$inferSelect | undefined;
  try {
    const [row] = await db.select().from(apiTokens)
      .where(eq(apiTokens.tokenHash, hashToken(token)))
      .limit(1);
    record = row;
  } catch (err) {
    console.error("[OpenClaw] Token lookup failed (failing closed):", err);
    return bearerAuthFailure(503, "DB_UNAVAILABLE", "Authentication service unavailable");
  }
  if (!record) {
    return bearerAuthFailure(401, "UNAUTHORIZED", "Token not found");
  }
  if (!record.active) {
    return bearerAuthFailure(401, "TOKEN_REVOKED", "Token has been revoked or deactivated");
  }
  if (record.expiresAt && record.expiresAt < new Date()) {
    return bearerAuthFailure(401, "TOKEN_EXPIRED", "Token has expired");
  }
  return { ok: true, token, record };
}

/**
 * In production the API docs expose the full attack surface, so they require
 * the same bearer-token validation as the OpenClaw endpoints. In development
 * the docs remain open for local convenience.
 */
async function requireDocsAuth(req: Request, res: Response, next: NextFunction) {
  if (!ENV.isProduction) return next();
  const auth = await authenticateBearerToken(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ code: auth.code, message: auth.message });
  }
  next();
}

// ── OpenClaw action executor (LLM-powered, no Math.random) ──────────────────
async function executeOpenClawAction(action: string, prompt: string): Promise<{ result: string; tokens_consumed: number }> {
  const tokenCosts: Record<string, number> = {
    kyc_verify: 6,
    sanctions_screen: 4,
    adverse_media: 5,
    risk_score: 8,
    create_investigation: 3,
    dispatch_field_agent: 160,
    get_investigation: 1,
    list_alerts: 1,
    full_due_diligence: 30,
  };

  // Generate a deterministic ref from the prompt content (no Math.random)
  const refSeed = Buffer.from(prompt + action).toString('base64').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 5);
  const ref = `BIS-${new Date().getFullYear()}-${refSeed.padEnd(5, '0')}`;

  // Use LLM to generate a realistic, contextual response for the action
  const systemPrompt = `You are the BIS (Background Intelligence System) AI engine for Nigeria. 
You perform compliance, KYC, KYB, sanctions screening, adverse media, and risk scoring for Nigerian individuals and businesses.
Respond ONLY with a well-formatted Markdown report. Be specific, professional, and realistic.
Use Nigerian context (EFCC, NDIC, CBN, NPF, FIRS, CAC, NIN, BVN, ₦ currency).
Do NOT make up criminal records or sanctions hits unless the prompt explicitly asks for a flagged scenario.
Always include a reference number like ${ref} and today's date ${new Date().toISOString().split('T')[0]}.
For risk scores, use a deterministic score based on the subject name and checks performed — do not use random numbers.`;

  const actionDescriptions: Record<string, string> = {
    kyc_verify: 'Perform a KYC (Know Your Customer) verification check. Include identity verification, sanctions screening, PEP check, and adverse media summary.',
    sanctions_screen: 'Screen the subject against all major sanctions lists: OFAC, UN, EU, UK HMT, EFCC Wanted, INTERPOL, and Nigerian watchlists.',
    adverse_media: 'Search for adverse media coverage across Nigerian and international news sources. Categorise by: fraud, corruption, money laundering, terrorism, regulatory violations.',
    risk_score: 'Calculate a composite risk score (0-100) with contributing factors: identity, sanctions, adverse media, PEP status, network analysis, and regulatory history.',
    create_investigation: 'Open a new BIS investigation. Include subject details, priority assessment, assigned analyst, and next steps.',
    dispatch_field_agent: 'Dispatch a BIS field agent for physical verification. Include task type, estimated completion time, and agent assignment.',
    get_investigation: 'Retrieve investigation status and summary. Include current status, risk score, key findings, and pending actions.',
    list_alerts: 'List the most recent BIS compliance alerts. Include severity, description, affected subject, and recommended action.',
    full_due_diligence: 'Perform a comprehensive due diligence report including: identity, sanctions, adverse media, PEP, corporate structure, financial risk, and overall recommendation.',
  };

  const userMessage = `Action: ${action}\nDescription: ${actionDescriptions[action] ?? action}\nUser prompt: ${prompt}\nReference: ${ref}`;

  let result: string;
  // 1. Try cloud LLM (Manus built-in)
  try {
    const llmResp = await invokeLLM({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    });
    result = (llmResp as any)?.choices?.[0]?.message?.content?.trim() ?? '';
    if (result) return { result, tokens_consumed: tokenCosts[action] ?? 1 };
  } catch (err) {
    console.warn('[OpenClaw] Cloud LLM failed, trying Ollama fallback:', (err as Error).message);
  }
  // 2. Ollama local fallback
  const OLLAMA_ADAPTER = ENV.ollamaAdapterUrl;
  const GATEWAY_KEY = ENV.bisGatewayKey;
  try {
    const ollamaResp = await fetch(`${OLLAMA_ADAPTER}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-BIS-Key': GATEWAY_KEY },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        system: systemPrompt,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (ollamaResp.ok) {
      const ollamaData = await ollamaResp.json() as any;
      const ollamaText = ollamaData?.message?.content?.trim() ?? '';
      if (ollamaText) {
        result = ollamaText;
        return { result, tokens_consumed: tokenCosts[action] ?? 1 };
      }
    }
  } catch (ollamaErr) {
    console.warn('[OpenClaw] Ollama fallback failed:', (ollamaErr as Error).message);
  }
  // 3. Deterministic structured fallback
  result = `## ${action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}\n\n**Reference:** ${ref}\n**Date:** ${new Date().toISOString().split('T')[0]}\n\nAction processed. Please review the BIS platform for full results.`;

  return { result, tokens_consumed: tokenCosts[action] ?? 1 };
}

// ── Router ───────────────────────────────────────────────────────────────────
export function createOpenClawRouter(): Router {
  const router = Router();

  // Swagger UI at /api/docs (auth-required in production)
  router.use(
    "/api/docs",
    requireDocsAuth,
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec, {
      customSiteTitle: "BIS Platform API",
      customCss: `
        .swagger-ui .topbar { background: #0f172a; }
        .swagger-ui .topbar .download-url-wrapper { display: none; }
        .swagger-ui .info .title { color: #0ea5e9; }
      `,
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true,
      },
    })
  );

  // OpenAPI spec as JSON at /api/docs.json (auth-required in production)
  router.get("/api/docs.json", requireDocsAuth, (_req, res) => {
    res.json(openApiSpec);
  });

  // OpenAPI spec as YAML at /api/docs.yaml (auth-required in production)
  router.get("/api/docs.yaml", requireDocsAuth, (_req, res) => {
    res.setHeader("Content-Type", "text/yaml");
    res.send(yaml.dump(openApiSpec));
  });

  // OpenClaw execute endpoint
  router.post("/api/v1/openclaw/execute", async (req, res) => {
    const auth = await authenticateBearerToken(req as Parameters<typeof authenticateBearerToken>[0]);
    if (!auth.ok) {
      return res.status(auth.status).json({ code: auth.code, message: auth.message });
    }
    const tokenRecord = auth.record;

    const { action, prompt, context: _ctx } = req.body as { action: string; prompt: string; context?: unknown };

    const validActions = [
      "kyc_verify", "sanctions_screen", "adverse_media", "risk_score",
      "create_investigation", "dispatch_field_agent", "get_investigation",
      "list_alerts", "full_due_diligence",
    ];

    if (!action || !validActions.includes(action)) {
      return res.status(400).json({ code: "INVALID_ACTION", message: `Unknown action. Valid actions: ${validActions.join(", ")}` });
    }
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ code: "MISSING_PROMPT", message: "prompt is required" });
    }

    try {
      // ── Quota enforcement: check before executing ─────────────────────────────
      const tokenCostPrecheck: Record<string, number> = {
        kyc_verify: 6, sanctions_screen: 4, adverse_media: 5, risk_score: 8,
        create_investigation: 3, dispatch_field_agent: 160, get_investigation: 1,
        list_alerts: 1, full_due_diligence: 30, social_monitor: 8, channel_monitor: 10,
      };
      const estimatedCost = tokenCostPrecheck[action] ?? 1;
      // Quota enforcement uses the authenticated token record loaded during
      // bearer validation — no secondary prefix-based lookup.
      const quota = tokenRecord.tokenQuota as number | null;
      const consumed = tokenRecord.tokensConsumed ?? 0;
      if (quota !== null && quota !== undefined && consumed + estimatedCost > quota) {
        return res.status(429).json({
          code: "QUOTA_EXCEEDED",
          message: `Token quota exceeded. Consumed: ${consumed}, Quota: ${quota}, Required: ${estimatedCost}. Please top up your token balance.`,
          tokens_consumed: consumed,
          token_quota: quota,
        });
      }

      const { result, tokens_consumed } = await executeOpenClawAction(action, prompt);

      // ── Token billing: debit tokens_consumed from the calling tenant's balance ──
      try {
        const db = await getDb();
        if (db) {
          await db
            .update(apiTokens)
            .set({ tokensConsumed: consumed + tokens_consumed })
            .where(eq(apiTokens.id, tokenRecord.id));
          console.log(`[OpenClaw] Billed ${tokens_consumed} tokens to tenant=${tokenRecord.tenantId} action=${action}`);
        }
      } catch (billingErr) {
        console.warn("[OpenClaw] Token billing failed (non-fatal):", billingErr);
      }

      return res.json({ result, tokens_consumed, action });
    } catch (err) {
      console.error("[OpenClaw] Action error:", err);
      return res.status(500).json({ code: "INTERNAL_ERROR", message: "Action execution failed" });
    }
  });

  // OpenClaw webhook receiver — requires Bearer token authentication
  router.post("/api/v1/openclaw/webhook", async (req, res) => {
    const auth = await authenticateBearerToken(req as Parameters<typeof authenticateBearerToken>[0]);
    if (!auth.ok) {
      return res.status(auth.status).json({ code: auth.code, message: auth.message });
    }
    const body = req.body as Record<string, unknown>;
    const event = typeof body.event === "string" ? body.event : null;
    const timestamp = typeof body.timestamp === "string" ? body.timestamp : new Date().toISOString();
    const data = body.data ?? null;
    if (!event) {
      return res.status(400).json({ code: "MISSING_EVENT", message: "event field is required" });
    }
    const validEvents = [
      "investigation.created", "investigation.updated", "investigation.closed",
      "alert.triggered", "alert.resolved", "sar.filed", "sar.acknowledged",
      "kyc.completed", "kyc.failed", "sanctions.hit", "sanctions.cleared",
    ];
    if (!validEvents.includes(event)) {
      return res.status(400).json({ code: "INVALID_EVENT", message: `Unknown event. Valid events: ${validEvents.join(", ")}` });
    }
    console.log(`[OpenClaw Webhook] event=${event} timestamp=${timestamp}`, data);
    // Persist the webhook event and route to downstream DB updates
    (async () => {
      try {
        const db = await getDb();
        if (!db) return;
        const d = data as Record<string, unknown> | null;
        const ref = typeof d?.ref === "string" ? d.ref
          : typeof d?.subject_ref === "string" ? d.subject_ref : null;
        // 1. Persist to audit log for traceability
        await db.insert(auditLog).values({
          category: "api",
          action: `openclaw.webhook.${event}`,
          targetRef: ref ?? undefined,
          result: "success",
          detail: { event, timestamp, data, source: "openclaw" },
        });
        // 2. Route event to downstream DB state changes
        if (event === "investigation.closed" && ref) {
          await db.update(investigations)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(investigations.ref, ref));
        } else if (event === "investigation.updated" && ref && typeof d?.status === "string") {
          const statusMap: Record<string, string> = {
            open: "pending", in_progress: "processing", closed: "completed",
            flagged: "flagged", archived: "archived",
          };
          const newStatus = statusMap[d.status as string] ?? null;
          if (newStatus) {
            await db.update(investigations)
              .set({ status: newStatus as any, updatedAt: new Date() })
              .where(eq(investigations.ref, ref));
          }
        } else if ((event === "kyc.completed" || event === "kyc.failed") && ref) {
          const kycStatus = event === "kyc.completed" ? "passed" : "failed";
          await db.update(kycRecords)
            .set({ status: kycStatus as any, updatedAt: new Date() })
            .where(eq(kycRecords.subjectRef, ref));
        } else if (event === "sar.acknowledged" && ref) {
          await db.update(sarFilings)
            .set({ status: "acknowledged", acknowledgedAt: new Date(), updatedAt: new Date() })
            .where(eq(sarFilings.sarRef, ref));
        } else if (event === "sar.filed" && ref) {
          await db.update(sarFilings)
            .set({ status: "filed", filedAt: new Date(), updatedAt: new Date() })
            .where(eq(sarFilings.sarRef, ref));
        } else if (event === "alert.triggered") {
          const severity = typeof d?.severity === "string" ? d.severity : "medium";
          const title = typeof d?.title === "string" ? d.title : `External alert: ${event}`;
          const body = typeof d?.body === "string" ? d.body : `OpenClaw webhook: ${event} at ${timestamp}`;
          const validSeverities = ["critical", "high", "medium", "low", "info"];
          await db.insert(alerts).values({
            type: "sanctions" as any,
            severity: (validSeverities.includes(severity) ? severity : "medium") as any,
            title,
            body,
            subjectRef: ref ?? undefined,
            sourceService: "openclaw",
          });
        } else if (event === "alert.resolved" && ref) {
          await db.update(alerts)
            .set({ resolved: true, resolvedAt: new Date() })
            .where(and(eq(alerts.subjectRef, ref), eq(alerts.resolved, false)));
        } else if (event === "sanctions.hit" && ref) {
          await db.insert(alerts).values({
            type: "sanctions" as any,
            severity: "high" as any,
            title: `Sanctions hit: ${ref}`,
            body: `OpenClaw detected a sanctions match for subject ${ref} at ${timestamp}.`,
            subjectRef: ref,
            sourceService: "openclaw",
          });
        }
      } catch (webhookErr) {
        console.error("[OpenClaw Webhook] DB update failed:", webhookErr);
      }
    })();
    return res.json({ received: true, event });
  });

  // Minimal v1 REST pass-through endpoints (token-gated, returns DB data via tRPC context)
  router.get("/api/v1/health", (_req, res) => {
    res.json({ status: "ok", version: "1.0.0", timestamp: new Date().toISOString() });
  });

  /**
   * POST /api/v1/openclaw/replay/:auditLogId
   *
   * Admin endpoint that re-processes a stored auditLog event by ID.
   * Useful for recovering from downstream failures (e.g., Kafka down during
   * initial delivery, DB write that partially failed).
   *
   * Requires a valid Bearer token (same as webhook).
   * Returns { replayed: true, event, targetRef, actions } on success.
   */
  router.post("/api/v1/openclaw/replay/:auditLogId", async (req, res) => {
    const auth = await authenticateBearerToken(req as Parameters<typeof authenticateBearerToken>[0]);
    if (!auth.ok) {
      return res.status(auth.status).json({ code: auth.code, message: auth.message });
    }
    const auditLogId = parseInt(req.params.auditLogId, 10);
    if (!Number.isFinite(auditLogId) || auditLogId <= 0) {
      return res.status(400).json({ code: "INVALID_ID", message: "auditLogId must be a positive integer" });
    }
    try {
      const db = await getDb();
      if (!db) return res.status(503).json({ code: "DB_UNAVAILABLE", message: "Database unavailable" });
      // Fetch the stored audit log entry
      const [entry] = await db.select().from(auditLog)
        .where(eq(auditLog.id, auditLogId)).limit(1);
      if (!entry) {
        return res.status(404).json({ code: "NOT_FOUND", message: `Audit log entry ${auditLogId} not found` });
      }
      // Only replay openclaw webhook events
      if (!entry.action?.startsWith("openclaw.webhook.")) {
        return res.status(400).json({
          code: "NOT_REPLAYABLE",
          message: `Entry ${auditLogId} is not an openclaw webhook event (action: ${entry.action})`
        });
      }
      const detail = entry.detail as Record<string, unknown> | null;
      const event = typeof detail?.event === "string" ? detail.event : null;
      const data = detail?.data as Record<string, unknown> | null;
      const timestamp = typeof detail?.timestamp === "string" ? detail.timestamp : new Date().toISOString();
      if (!event) {
        return res.status(400).json({ code: "MISSING_EVENT", message: "Stored entry has no event field" });
      }
      const ref = entry.targetRef ?? null;
      const actionsPerformed: string[] = [];
      // Re-run the same downstream routing logic as the webhook handler
      if (event === "investigation.closed" && ref) {
        await db.update(investigations)
          .set({ status: "completed", updatedAt: new Date() })
          .where(eq(investigations.ref, ref));
        actionsPerformed.push(`investigation.status → completed (ref=${ref})`);
      } else if (event === "investigation.updated" && ref && typeof data?.status === "string") {
        const statusMap: Record<string, string> = {
          open: "pending", in_progress: "processing", closed: "completed",
          flagged: "flagged", archived: "archived",
        };
        const newStatus = statusMap[data.status as string] ?? null;
        if (newStatus) {
          await db.update(investigations)
            .set({ status: newStatus as any, updatedAt: new Date() })
            .where(eq(investigations.ref, ref));
          actionsPerformed.push(`investigation.status → ${newStatus} (ref=${ref})`);
        }
      } else if ((event === "kyc.completed" || event === "kyc.failed") && ref) {
        const kycStatus = event === "kyc.completed" ? "passed" : "failed";
        await db.update(kycRecords)
          .set({ status: kycStatus as any, updatedAt: new Date() })
          .where(eq(kycRecords.subjectRef, ref));
        actionsPerformed.push(`kycRecord.status → ${kycStatus} (subjectRef=${ref})`);
      } else if (event === "sar.acknowledged" && ref) {
        await db.update(sarFilings)
          .set({ status: "acknowledged", acknowledgedAt: new Date(), updatedAt: new Date() })
          .where(eq(sarFilings.sarRef, ref));
        actionsPerformed.push(`sarFiling.status → acknowledged (sarRef=${ref})`);
      } else if (event === "sar.filed" && ref) {
        await db.update(sarFilings)
          .set({ status: "filed", filedAt: new Date(), updatedAt: new Date() })
          .where(eq(sarFilings.sarRef, ref));
        actionsPerformed.push(`sarFiling.status → filed (sarRef=${ref})`);
      } else if (event === "alert.triggered") {
        const severity = typeof data?.severity === "string" ? data.severity : "medium";
        const title = typeof data?.title === "string" ? data.title : `Replayed alert: ${event}`;
        const body = typeof data?.body === "string" ? data.body : `OpenClaw replay: ${event} at ${timestamp}`;
        const validSeverities = ["critical", "high", "medium", "low", "info"];
        await db.insert(alerts).values({
          type: "sanctions" as any,
          severity: (validSeverities.includes(severity) ? severity : "medium") as any,
          title: `[REPLAY] ${title}`,
          body,
          subjectRef: ref ?? undefined,
          sourceService: "openclaw-replay",
        });
        actionsPerformed.push(`alert.created (severity=${severity})`);
      } else if (event === "alert.resolved" && ref) {
        await db.update(alerts)
          .set({ resolved: true, resolvedAt: new Date() })
          .where(and(eq(alerts.subjectRef, ref), eq(alerts.resolved, false)));
        actionsPerformed.push(`alerts.resolved (subjectRef=${ref})`);
      } else if (event === "sanctions.hit" && ref) {
        await db.insert(alerts).values({
          type: "sanctions" as any,
          severity: "high" as any,
          title: `[REPLAY] Sanctions hit: ${ref}`,
          body: `OpenClaw replay: sanctions match for subject ${ref} at ${timestamp}.`,
          subjectRef: ref,
          sourceService: "openclaw-replay",
        });
        actionsPerformed.push(`sanctions.alert.created (ref=${ref})`);
      } else {
        actionsPerformed.push(`no downstream action for event=${event}`);
      }
      // Write a replay audit log entry
      await db.insert(auditLog).values({
        category: "api",
        action: `openclaw.replay.${event}`,
        targetRef: ref ?? undefined,
        result: "success",
        detail: { originalAuditLogId: auditLogId, event, timestamp, actionsPerformed, source: "openclaw-replay" },
      });
      return res.json({
        replayed: true,
        auditLogId,
        event,
        targetRef: ref,
        actionsPerformed,
        replayedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[OpenClaw Replay] Error:", err);
      return res.status(500).json({ code: "INTERNAL_ERROR", message: "Replay failed" });
    }
  });

  return router;
}
