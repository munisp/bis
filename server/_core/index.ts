import "dotenv/config";

// BIS platform requires PostgreSQL. Override the platform-injected MySQL/TiDB URL
// with the local PostgreSQL instance.
const _dbUrl = process.env.DATABASE_URL ?? "";
if (!_dbUrl.startsWith("postgresql") && !_dbUrl.startsWith("postgres")) {
  process.env.DATABASE_URL = "postgresql://bis_user:bis_secure_2026@localhost:5432/bis_db";
  console.log("[BIS] Overriding DATABASE_URL → local PostgreSQL (bis_db)");
}

import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { notifyOwner } from "./notification";
import { creditTenantAccount } from "../billing";
import crypto from "crypto";
import { createOpenClawRouter } from "../openclawEndpoints";
import cron from "node-cron";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // ── Grafana alert webhook ──────────────────────────────────────────────────
  // Receives Unified Alerting POST payloads from Grafana and forwards them to
  // the platform owner via notifyOwner(). Protected by a bearer token.
  app.post("/api/webhooks/grafana-alert", async (req, res) => {
    try {
      const expectedToken = process.env.GRAFANA_WEBHOOK_SECRET ?? "bis-grafana-webhook-dev";
      const authHeader = req.headers["authorization"] ?? "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (token !== expectedToken) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      // Grafana Unified Alerting payload shape
      const body = req.body as {
        title?: string;
        message?: string;
        state?: string;
        alerts?: Array<{
          status?: string;
          labels?: Record<string, string>;
          annotations?: Record<string, string>;
          startsAt?: string;
          endsAt?: string;
          generatorURL?: string;
        }>;
      };

      const state = body.state ?? (body.alerts?.[0]?.status ?? "unknown");
      const title = body.title ?? `BIS Alert — ${state.toUpperCase()}`;

      // Build a human-readable content block
      const lines: string[] = [];
      if (body.message) lines.push(body.message);
      if (body.alerts && body.alerts.length > 0) {
        body.alerts.forEach((a, i) => {
          const name = a.labels?.alertname ?? `Alert ${i + 1}`;
          const summary = a.annotations?.summary ?? a.annotations?.description ?? "";
          const runbook = a.annotations?.runbook_url ?? "";
          lines.push(`\n**${name}** (${a.status ?? state})`);
          if (summary) lines.push(summary);
          if (runbook) lines.push(`Runbook: ${runbook}`);
          if (a.startsAt) lines.push(`Started: ${new Date(a.startsAt).toISOString()}`);
        });
      }
      const content = lines.join("\n") || `Alert state: ${state}`;

      const delivered = await notifyOwner({ title, content });
      console.log(`[GrafanaWebhook] Notification delivered=${delivered} title="${title}"`);
      res.json({ ok: true, delivered });
    } catch (err) {
      console.error("[GrafanaWebhook] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Paystack charge webhook ───────────────────────────────────────────────
  // Receives charge.success events from Paystack and auto-credits the tenant's
  // TigerBeetle account. Validates x-paystack-signature (HMAC-SHA512).
  // Must be registered BEFORE the json body-parser so we can read the raw body.
  app.post("/api/webhooks/paystack", express.raw({ type: "application/json" }), async (req, res) => {
    try {
      const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY ?? "";
      const signature = req.headers["x-paystack-signature"] as string | undefined;

      // Validate HMAC-SHA512 signature when secret is configured
      if (PAYSTACK_SECRET && signature) {
        const expected = crypto
          .createHmac("sha512", PAYSTACK_SECRET)
          .update(req.body as Buffer)
          .digest("hex");
        if (expected !== signature) {
          console.warn("[PaystackWebhook] Invalid signature — request rejected");
          res.status(401).json({ error: "Invalid signature" });
          return;
        }
      } else if (PAYSTACK_SECRET && !signature) {
        // Secret configured but no signature header — reject
        res.status(401).json({ error: "Missing x-paystack-signature header" });
        return;
      }
      // If PAYSTACK_SECRET is not set, allow through (dev/test mode)

      const body = JSON.parse((req.body as Buffer).toString("utf8")) as {
        event?: string;
        data?: {
          reference?: string;
          amount?: number; // kobo
          status?: string;
          metadata?: { tenant_id?: string; [key: string]: unknown };
          customer?: { email?: string };
        };
      };

      console.log(`[PaystackWebhook] event=${body.event} ref=${body.data?.reference}`);

      if (body.event === "charge.success" && body.data?.status === "success") {
        const reference = body.data.reference ?? "";
        const amountKobo = body.data.amount ?? 0;
        // tenant_id is passed in Paystack metadata during initiation
        const tenantId = String(body.data.metadata?.tenant_id ?? body.data.customer?.email ?? "unknown");

        if (amountKobo > 0 && tenantId !== "unknown") {
          const result = await creditTenantAccount({ tenantId, amountKobo, reference });
          console.log(`[PaystackWebhook] Credited tenant=${tenantId} amount=${amountKobo} kobo recorded=${result.recorded} transferId=${result.transferId}`);

          // Notify platform owner
          await notifyOwner({
            title: `Payment Received — ₦${(amountKobo / 100).toLocaleString()}`,
            content: `Tenant **${tenantId}** topped up ₦${(amountKobo / 100).toLocaleString()} via Paystack.\nReference: \`${reference}\`\nTigerBeetle transfer: \`${result.transferId}\` (recorded=${result.recorded})`,
          });
        }
      }

      // Always return 200 to acknowledge receipt
      res.status(200).json({ received: true });
    } catch (err) {
      console.error("[PaystackWebhook] Error:", err);
      // Still return 200 to prevent Paystack from retrying on server errors
      res.status(200).json({ received: true, error: "Processing error" });
    }
  });

  // ── Lakehouse cron sync ─────────────────────────────────────────────────────
  // POST /api/cron/lakehouse-sync — ingests latest investigations/alerts/kyc rows
  // into the Delta Lake lakehouse-writer service. Protected by CRON_SECRET.
  app.post("/api/cron/lakehouse-sync", async (req, res) => {
    try {
      const expectedSecret = process.env.CRON_SECRET ?? "bis-cron-dev-secret";
      const authHeader = req.headers["authorization"] ?? "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (token !== expectedSecret) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const LAKEHOUSE_URL = process.env.BIS_LAKEHOUSE_URL ?? "http://localhost:8087";

      // Fetch recent rows from DB and push to lakehouse
      const { getDb } = await import("../db");
      const { investigations, alerts, kycRecords } = await import("../../drizzle/schema");
      const { desc } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Database unavailable" });
        return;
      }

      const [recentInvestigations, recentAlerts, recentKyc] = await Promise.all([
        db.select().from(investigations).orderBy(desc(investigations.updatedAt)).limit(100),
        db.select().from(alerts).orderBy(desc(alerts.createdAt)).limit(100),
        db.select().from(kycRecords).orderBy(desc(kycRecords.createdAt)).limit(100),
      ]);

      let ingested = 0;
      let errors = 0;

      // Ingest investigations
      for (const inv of recentInvestigations) {
        try {
          await fetch(`${LAKEHOUSE_URL}/ingest/investigation`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: String(inv.id),
              ref: inv.ref,
              subject_name: inv.subjectName,
              subject_type: inv.subjectType,
              status: inv.status,
              risk_score: inv.riskScore ?? 0,
              country: inv.country ?? "NG",
              tier: inv.tier ?? "standard",
              created_at: inv.createdAt instanceof Date ? inv.createdAt.toISOString() : String(inv.createdAt),
            }),
          });
          ingested++;
        } catch { errors++; }
      }

      // Ingest alerts
      for (const alert of recentAlerts) {
        try {
          await fetch(`${LAKEHOUSE_URL}/ingest/alert`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: String(alert.id),
              title: alert.title,
              severity: alert.severity,
              status: alert.resolved ? "resolved" : alert.acknowledged ? "acknowledged" : "open",
              subject_ref: alert.subjectRef ?? "",
              created_at: alert.createdAt instanceof Date ? alert.createdAt.toISOString() : String(alert.createdAt),
            }),
          });
          ingested++;
        } catch { errors++; }
      }

      // Ingest KYC records
      for (const kyc of recentKyc) {
        try {
          await fetch(`${LAKEHOUSE_URL}/ingest/kyc`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: String(kyc.id),
              subject_name: kyc.subjectName,
              subject_ref: kyc.subjectRef ?? "",
              status: kyc.status,
              risk_score: kyc.riskScore ?? 0,
              created_at: kyc.createdAt instanceof Date ? kyc.createdAt.toISOString() : String(kyc.createdAt),
            }),
          });
          ingested++;
        } catch { errors++; }
      }

      // Persist last sync timestamp in platform_settings
      const { platformSettings } = await import("../../drizzle/schema");
      await db.insert(platformSettings)
        .values({ key: "lakehouse.lastSyncedAt", value: new Date().toISOString(), namespace: "lakehouse" })
        .onConflictDoUpdate({ target: platformSettings.key, set: { value: new Date().toISOString(), updatedAt: new Date() } });

      const summary = { ingested, errors, rows: recentInvestigations.length + recentAlerts.length + recentKyc.length, syncedAt: new Date().toISOString() };
      console.log(`[LakehouseSync] ${JSON.stringify(summary)}`);
      res.json({ ok: true, ...summary });
    } catch (err) {
      console.error("[LakehouseSync] Error:", err);
      res.status(500).json({ error: "Sync failed" });
    }
  });

  // ── SLA breach check cron route ─────────────────────────────────────────
  app.post("/api/cron/sla-check", async (req, res) => {
    try {
      const CRON_SECRET = process.env.CRON_SECRET ?? "bis-cron-dev-secret";
      const authHeader = req.headers["authorization"] ?? "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (token !== CRON_SECRET) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) { res.status(503).json({ error: "DB unavailable" }); return; }
      const { investigations, pushDeviceTokens } = await import("../../drizzle/schema");
      const { and, isNotNull, lte, gt, eq } = await import("drizzle-orm");

      // Find investigations with dueAt within the next 24 hours that are still open
      const now = new Date();
      const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const approaching = await db
        .select()
        .from(investigations)
        .where(
          and(
            isNotNull(investigations.dueAt),
            lte(investigations.dueAt, in24h),
            gt(investigations.dueAt, now),
            eq(investigations.status, "pending")
          )
        );

      let notified = 0;
      const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

      for (const inv of approaching) {
        if (!inv.assignedTo) continue;
        // Get push tokens for the assigned analyst
        const tokens = await db
          .select()
          .from(pushDeviceTokens)
          .where(eq(pushDeviceTokens.userId, inv.assignedTo));

        if (tokens.length === 0) continue;

        const hoursLeft = Math.round((inv.dueAt!.getTime() - now.getTime()) / 3600000);
        const messages = tokens.map((t: { token: string }) => ({
          to: t.token,
          title: `⏰ SLA Alert: ${inv.ref}`,
          body: `Investigation ${inv.subjectName} is due in ${hoursLeft}h`,
          data: { investigationId: inv.id, ref: inv.ref },
          priority: "high",
        }));

        try {
          await fetch(EXPO_PUSH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(messages),
          });
          notified++;
        } catch (pushErr) {
          console.error(`[SLACron] Push failed for inv ${inv.ref}:`, pushErr);
        }
      }

      res.json({ ok: true, checked: approaching.length, notified });
    } catch (err) {
      console.error("[SLACron] Error:", err);
      res.status(500).json({ error: "SLA check failed" });
    }
  });

  // OpenClaw managed instance + Swagger UI
  app.use(createOpenClawRouter());

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);

    // ── Lakehouse scheduled sync (every 15 minutes) ───────────────────────────
    const CRON_SECRET = process.env.CRON_SECRET ?? "bis-cron-dev-secret";
    cron.schedule("*/15 * * * *", async () => {
      try {
        const res = await fetch(`http://localhost:${port}/api/cron/lakehouse-sync`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
        });
        const data = await res.json() as { ok: boolean; ingested: number; errors: number; syncedAt: string };
        console.log(`[LakehouseCron] Scheduled sync complete — ingested: ${data.ingested}, errors: ${data.errors}`);
      } catch (err) {
        console.error("[LakehouseCron] Scheduled sync failed:", err);
      }
    });
    console.log("[LakehouseCron] Scheduled lakehouse sync every 15 minutes");

    // ── SLA breach check (every hour) ────────────────────────────────────────
    cron.schedule("0 * * * *", async () => {
      try {
        const res = await fetch(`http://localhost:${port}/api/cron/sla-check`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
        });
        const data = await res.json() as { ok: boolean; notified: number };
        if (data.notified > 0) {
          console.log(`[SLACron] Notified ${data.notified} investigations approaching SLA deadline`);
        }
      } catch (err) {
        console.error("[SLACron] SLA check failed:", err);
      }
    });
    console.log("[SLACron] Scheduled SLA breach check every hour");
  });
}

startServer().catch(console.error);
