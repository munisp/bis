import "dotenv/config";

// BIS platform requires PostgreSQL. Override the platform-injected MySQL/TiDB URL
// with the local PostgreSQL instance.
const _dbUrl = process.env.DATABASE_URL ?? "";
if (!_dbUrl.startsWith("postgresql") && !_dbUrl.startsWith("postgres")) {
  process.env.DATABASE_URL = "postgresql://bis_user:bis_secure_2026@localhost:5432/bis_db";
  console.log("[BIS] Overriding DATABASE_URL → local PostgreSQL (bis_db)");
}

import express, { type Request, type Response, type NextFunction } from "express";
import { createServer } from "http";
import net from "net";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { notifyOwner } from "./notification";
import { creditTenantAccount } from "../billing";
import crypto from "crypto";
import { createOpenClawRouter } from "../openclawEndpoints";
import { startSlaBreachScheduler } from "../slaBreachChecker";

// ── Structured logger ─────────────────────────────────────────────────────────
function log(level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta });
  if (level === "error") process.stderr.write(entry + "\n");
  else process.stdout.write(entry + "\n");
}

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
  // Trust the first proxy hop (Manus reverse proxy) for correct IP detection
  app.set("trust proxy", 1);

  // ── Request ID middleware ─────────────────────────────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    const reqId = (req.headers["x-request-id"] as string) || crypto.randomUUID();
    (req as Request & { id: string }).id = reqId;
    res.setHeader("x-request-id", reqId);
    next();
  });

  // ── Structured access log ────────────────────────────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      const reqId = (req as Request & { id?: string }).id;
      if (!req.path.startsWith("/api/trpc") || res.statusCode >= 400) {
        log(res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
          `${req.method} ${req.path}`,
          { status: res.statusCode, duration, reqId, ip: req.ip }
        );
      }
    });
    next();
  });

  // ── Security headers (helmet) ──────────────────────────────────────────────
  // In dev we relax CSP so Vite HMR works; in production enforce strict policy.
  const isDev = process.env.NODE_ENV === "development";
  app.use(
    helmet({
      contentSecurityPolicy: isDev
        ? false // Vite HMR requires inline scripts in dev
        : {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'", "https://maps.googleapis.com"],
              styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
              fontSrc: ["'self'", "https://fonts.gstatic.com"],
              imgSrc: ["'self'", "data:", "https:", "blob:"],
              connectSrc: ["'self'", "https://api.manus.im", "wss:"],
              frameSrc: ["'none'"],
              objectSrc: ["'none'"],
              upgradeInsecureRequests: [],
            },
          },
      // HSTS: 1 year, include subdomains
      strictTransportSecurity: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      // Prevent clickjacking
      frameguard: { action: "deny" },
      // Prevent MIME sniffing
      noSniff: true,
      // Disable X-Powered-By
      hidePoweredBy: true,
      // XSS protection (legacy browsers)
      xssFilter: true,
      // Referrer policy
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    })
  );

  // ── CORS ───────────────────────────────────────────────────────────────────
  // Allow the frontend origin (same host in dev, explicit in prod).
  // Credentials (session cookies) require explicit origin — no wildcard.
  const allowedOrigins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : []),
  ];
  // Ensure cors middleware is applied correctly
  const corsMiddleware = cors({
      origin: (origin, callback) => {
        // Allow same-origin requests (no origin header)
        if (!origin) { callback(null, true); return; }
        // Allow Manus preview/deployment domains
        if (origin.includes(".manus.computer") || origin.includes(".manus.space")) {
          callback(null, true); return;
        }
        // Allow explicitly listed origins
        if (allowedOrigins.some(o => origin.startsWith(o))) {
          callback(null, true); return;
        }
        callback(new Error(`CORS: origin ${origin} not allowed`));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-paystack-signature"],
      maxAge: 86400, // 24h preflight cache
    });
  app.use(corsMiddleware);
  // Express 5 does not support wildcard options — CORS preflight is handled per-route by the cors middleware above

  // ── Rate limiting ──────────────────────────────────────────────────────────
  // Global limiter: 300 req/15min per IP (generous for authenticated users)
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
    skip: req => req.path.startsWith("/api/webhooks"), // webhooks have their own auth
  });
  app.use(globalLimiter);

  // Strict limiter for public LEX submission endpoint (unauthenticated)
  const lexSubmitLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20, // 20 submissions per IP per hour
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Submission rate limit exceeded. Please try again later." },
  });
  app.use("/api/trpc/lex.submitIncident", lexSubmitLimiter);

  // Auth endpoint limiter (prevent brute-force)
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many authentication attempts." },
  });
  app.use("/api/oauth", authLimiter);

  // ── Body parsers ───────────────────────────────────────────────────────────
  // Note: Paystack webhook needs raw body — registered BEFORE json parser below
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
        // Use timingSafeEqual to prevent timing attacks
        const expectedBuf = Buffer.from(expected, "hex");
        const signatureBuf = Buffer.from(signature, "hex");
        const isValid =
          expectedBuf.length === signatureBuf.length &&
          crypto.timingSafeEqual(expectedBuf, signatureBuf);
        if (!isValid) {
          console.warn("[PaystackWebhook] Invalid signature — request rejected");
          res.status(401).json({ error: "Invalid signature" });
          return;
        }
      } else if (PAYSTACK_SECRET && !signature) {
        res.status(401).json({ error: "Missing x-paystack-signature header" });
        return;
      }

      const body = JSON.parse((req.body as Buffer).toString("utf8")) as {
        event?: string;
        data?: {
          reference?: string;
          amount?: number;
          status?: string;
          metadata?: { tenant_id?: string; [key: string]: unknown };
          customer?: { email?: string };
        };
      };

      console.log(`[PaystackWebhook] event=${body.event} ref=${body.data?.reference}`);

      if (body.event === "charge.success" && body.data?.status === "success") {
        const reference = body.data.reference ?? "";
        const amountKobo = body.data.amount ?? 0;
        const tenantId = String(body.data.metadata?.tenant_id ?? body.data.customer?.email ?? "unknown");

        if (amountKobo > 0 && tenantId !== "unknown") {
          const result = await creditTenantAccount({ tenantId, amountKobo, reference });
          console.log(`[PaystackWebhook] Credited tenant=${tenantId} amount=${amountKobo} kobo recorded=${result.recorded} transferId=${result.transferId}`);
          await notifyOwner({
            title: `Payment Received — ₦${(amountKobo / 100).toLocaleString()}`,
            content: `Tenant **${tenantId}** topped up ₦${(amountKobo / 100).toLocaleString()} via Paystack.\nReference: \`${reference}\`\nTigerBeetle transfer: \`${result.transferId}\` (recorded=${result.recorded})`,
          });
        }
      }

      res.status(200).json({ received: true });
    } catch (err) {
      console.error("[PaystackWebhook] Error:", err);
      res.status(200).json({ received: true, error: "Processing error" });
    }
  });

  // JSON body parser (after Paystack raw handler)
  // Limit to 4mb for normal API calls; file uploads use base64 in JSON which is larger
  app.use(express.json({ limit: "4mb" }));
  app.use(express.urlencoded({ limit: "4mb", extended: true }));

  // ── CSRF token endpoint ────────────────────────────────────────────────────
  // Provides a per-session CSRF token for state-changing requests from the frontend.
  // tRPC mutations should include X-CSRF-Token header; validated in context.ts.
  app.get("/api/csrf-token", (req, res) => {
    const token = crypto.randomBytes(32).toString("hex");
    // Store in a short-lived signed cookie
    res.cookie("_csrf", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: !isDev,
      maxAge: 3600_000, // 1 hour
    });
    res.json({ csrfToken: token });
  });

  // ── Health endpoint ────────────────────────────────────────────────────────────────
  // Returns JSON with DB, S3, and LLM checks for load balancer / monitoring.
  app.get("/api/health", async (_req, res) => {
    const checks: Record<string, { status: "ok" | "degraded" | "down"; latencyMs?: number }> = {};

    // DB check
    const dbStart = Date.now();
    try {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (db) {
        await db.execute("SELECT 1" as any);
        checks.db = { status: "ok", latencyMs: Date.now() - dbStart };
      } else {
        checks.db = { status: "down" };
      }
    } catch {
      checks.db = { status: "down", latencyMs: Date.now() - dbStart };
    }

    // LLM check (built-in Forge API)
    const llmStart = Date.now();
    try {
      const llmUrl = process.env.BUILT_IN_FORGE_API_URL;
      if (llmUrl) {
        const r = await fetch(`${llmUrl}/health`, { signal: AbortSignal.timeout(3000) });
        checks.llm = { status: r.ok ? "ok" : "degraded", latencyMs: Date.now() - llmStart };
      } else {
        checks.llm = { status: "degraded" };
      }
    } catch {
      checks.llm = { status: "degraded", latencyMs: Date.now() - llmStart };
    }

    const allOk = Object.values(checks).every(c => c.status === "ok");
    const anyDown = Object.values(checks).some(c => c.status === "down");
    const overall = allOk ? "ok" : anyDown ? "degraded" : "degraded";

    res.status(anyDown ? 503 : 200).json({
      status: overall,
      version: process.env.npm_package_version ?? "1.0.0",
      uptime: Math.floor(process.uptime()),
      ts: new Date().toISOString(),
      checks,
    });
  });

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // ── Grafana alert webhook ──────────────────────────────────────────────────
  app.post("/api/webhooks/grafana-alert", async (req, res) => {
    try {
      const expectedToken = process.env.GRAFANA_WEBHOOK_SECRET ?? "bis-grafana-webhook-dev";
      const authHeader = req.headers["authorization"] ?? "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      // Timing-safe comparison
      const expectedBuf = Buffer.from(expectedToken);
      const tokenBuf = Buffer.from(token);
      const isValid =
        expectedBuf.length === tokenBuf.length &&
        crypto.timingSafeEqual(expectedBuf, tokenBuf);
      if (!isValid) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

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

  _httpServer = server;
  server.listen(port, () => {
    log("info", `BIS server running`, { port, env: process.env.NODE_ENV ?? "production" });
  });
  return server;
}

startServer()
  .then((srv) => {
    startSlaBreachScheduler();
    return srv;
  })
  .catch((err) => {
    log("error", "Server startup failed", { error: String(err) });
    process.exit(1);
  });

// ── Graceful shutdown ────────────────────────────────────────────────────────────────
let _httpServer: ReturnType<typeof createServer> | null = null;

function gracefulShutdown(signal: string) {
  log("info", `Received ${signal} — starting graceful shutdown`);
  if (_httpServer) {
    _httpServer.close(() => {
      log("info", "HTTP server closed");
      process.exit(0);
    });
    // Force exit after 10s if connections don't drain
    setTimeout(() => {
      log("warn", "Forced shutdown after 10s timeout");
      process.exit(1);
    }, 10_000).unref();
  } else {
    process.exit(0);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
