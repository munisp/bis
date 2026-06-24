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
import slowDown from "express-slow-down";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import compression from "compression";
import { register as promRegister, collectDefaultMetrics, Counter, Histogram, Gauge } from "prom-client";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { notifyOwner } from "./notification";
import { creditTenantAccount } from "../billing";
import crypto from "crypto";
import { createOpenClawRouter } from "../openclawEndpoints";
import swaggerUi from "swagger-ui-express";
import { readFileSync } from "fs";
import { load as yamlLoad } from "js-yaml";
import { startSlaBreachScheduler } from "../slaBreachChecker";
import { startDataSourcesHealthScheduler } from "../dataSourcesHealthScheduler";
import { startKycScheduledRerunExecutor } from "../kycScheduledRerunExecutor";
import { startArchivalScheduler } from "../archivalScheduler";
import { startKycExpiryDigestScheduler } from "../kycExpiryDigest";
import { startRiskThresholdDigestScheduler } from "../riskThresholdDigest";
import { startBiometricSpoofAlertScheduler } from "../biometricSpoofAlertScheduler";
import { startBiometricSessionLogArchiver } from "../biometricSessionLogArchiver";
import { startVapidRotationReminderScheduler } from "../vapidRotationReminder";
import { startBroadcastScheduler } from "../broadcastScheduler";
import { validateEnv } from "../envValidation";
import { ENV } from "./env";

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
  // Validate environment variables before starting
  validateEnv();

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

  // ── CSP Nonce middleware ─────────────────────────────────────────────────────
  // Generate a fresh nonce for every request and store in res.locals.
  // The nonce is injected into <script> tags in the HTML template (serveStatic)
  // and referenced in the Helmet CSP scriptSrc directive.
  if (!isDev) {
    app.use((_req: Request, res: Response, next: NextFunction) => {
      const nonce = crypto.randomBytes(16).toString("base64");
      (res.locals as { nonce?: string }).nonce = nonce;
      next();
    });
  }

  app.use(
    helmet({
      contentSecurityPolicy: isDev
        ? false // Vite HMR requires inline scripts in dev
        : {
            directives: {
              defaultSrc: ["'self'"],
              // Use per-request nonce instead of 'unsafe-inline'
              scriptSrc: [
                "'self'",
                "https://maps.googleapis.com",
                // Helmet CSP directive functions receive IncomingMessage / ServerResponse
                (_req: import("http").IncomingMessage, res: import("http").ServerResponse) => {
                  const nonce = (res as import("http").ServerResponse & { locals?: { nonce?: string } }).locals?.nonce;
                  return nonce ? `'nonce-${nonce}'` : "'unsafe-inline'";
                },
              ],
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
      // Cross-origin isolation
      crossOriginOpenerPolicy: { policy: "same-origin" },
      crossOriginResourcePolicy: { policy: "same-origin" },
      // Permissions policy: disable sensitive browser APIs
      permittedCrossDomainPolicies: { permittedPolicies: "none" },
    })
  );
  // Permissions-Policy header (not yet in helmet stable)
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    next();
  });

  // ── OpenAppsec WAF header detection ────────────────────────────────────────
  // When APISIX + OpenAppsec is deployed in front of the BFF, it injects
  // X-Appsec-Mode and X-Appsec-Status headers into every request.
  // The BFF reads these headers and:
  //   1. Logs WAF enforcement decisions for audit purposes.
  //   2. Rejects requests that OpenAppsec has marked as "block" but somehow
  //      reached the BFF (defense-in-depth — should not happen in production).
  //   3. Exposes WAF status in the /api/health endpoint.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const appsecMode = req.headers["x-appsec-mode"] as string | undefined;
    const appsecStatus = req.headers["x-appsec-status"] as string | undefined;
    const appsecAttackType = req.headers["x-appsec-attack-type"] as string | undefined;
    // If OpenAppsec is active and has blocked this request, reject it here as well.
    // In normal operation APISIX would have already dropped the request; this is
    // a defense-in-depth layer in case the WAF is in detect-only mode.
    if (appsecStatus === "block") {
      log("warn", "[WAF] OpenAppsec blocked request", {
        path: req.path,
        method: req.method,
        ip: req.ip,
        appsecMode,
        appsecAttackType,
        reqId: (req as Request & { id?: string }).id,
      });
      res.status(403).json({ error: "Request blocked by WAF", code: "WAF_BLOCKED" });
      return;
    }
    // Log WAF detection events (non-blocking)
    if (appsecStatus === "detect" && appsecAttackType) {
      log("warn", "[WAF] OpenAppsec detected potential attack (detect mode)", {
        path: req.path,
        method: req.method,
        ip: req.ip,
        appsecMode,
        appsecAttackType,
        reqId: (req as Request & { id?: string }).id,
      });
    }
    next();
  });

  // ── CORS ───────────────────────────────────────────────────────────────────
  // Allow the frontend origin (same host in dev, explicit in prod).
  // Credentials (session cookies) require explicit origin — no wildcard.
  const allowedOrigins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    ...(ENV.allowedOrigins ? ENV.allowedOrigins.split(",") : []),
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
      allowedHeaders: ["Content-Type", "Authorization", "x-paystack-signature", "x-csrf-token", "x-request-id"],
      maxAge: 86400, // 24h preflight cache
    });
  app.use(corsMiddleware);

  // ── HTTP Compression ────────────────────────────────────────────────────────
  // Gzip/deflate all responses above 1KB. Reduces payload size by 60-80%.
  app.use(compression({
    level: 6,          // balanced speed vs ratio
    threshold: 1024,   // only compress responses > 1KB
    filter: (req, res) => {
      // Don't compress SSE streams
      if (req.headers['accept'] === 'text/event-stream') return false;
      return compression.filter(req, res);
    },
  }));

  // ── Prometheus Metrics ──────────────────────────────────────────────────────
  // Collect default Node.js metrics (heap, GC, event loop lag, etc.)
  collectDefaultMetrics({ prefix: 'bis_' });
  const httpRequestDuration = new Histogram({
    name: 'bis_http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  });
  const httpRequestTotal = new Counter({
    name: 'bis_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
  });
  const activeConnections = new Gauge({
    name: 'bis_active_connections',
    help: 'Number of active HTTP connections',
  });
  // Track request duration for all routes
  app.use((req: Request, res: Response, next: NextFunction) => {
    const end = httpRequestDuration.startTimer();
    activeConnections.inc();
    res.on('finish', () => {
      const route = req.route?.path ?? req.path.replace(/\/[0-9a-f-]{36}/gi, '/:id');
      end({ method: req.method, route, status_code: String(res.statusCode) });
      httpRequestTotal.inc({ method: req.method, route, status_code: String(res.statusCode) });
      activeConnections.dec();
    });
    next();
  });
  // Metrics endpoint — protected by METRICS_TOKEN bearer auth or localhost-only
  app.get('/metrics', async (req: Request, res: Response) => {
    const metricsToken = ENV.metricsToken || undefined;
    const authHeader = req.headers['authorization'];
    const clientIp = req.ip ?? '';
    const isLocalhost = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';
    if (metricsToken) {
      if (!authHeader || authHeader !== `Bearer ${metricsToken}`) {
        res.status(401).json({ error: 'Unauthorized: valid METRICS_TOKEN required' });
        return;
      }
    } else if (!isLocalhost) {
      res.status(403).json({ error: 'Forbidden: metrics only accessible from localhost or with METRICS_TOKEN' });
      return;
    }
    try {
      res.set('Content-Type', promRegister.contentType);
      res.end(await promRegister.metrics());
    } catch (err) {
      console.error('[Metrics] Error generating metrics:', err);
      res.status(500).end('Internal server error');
    }
  });

  // Express 5 does not support wildcard options — CORS preflight is handled per-route by the cors middleware above

  // ── DDoS progressive slow-down ───────────────────────────────────────────
  // After 50 requests in 1 minute, add 200ms delay per request (max 5s).
  // This degrades scraping/DDoS attacks without hard-blocking legitimate users.
  const slowDownMiddleware = slowDown({
    windowMs: 60 * 1000,       // 1 minute window
    delayAfter: 50,            // allow 50 req/min at full speed
    delayMs: (hits) => (hits - 50) * 200, // +200ms per req above threshold
    maxDelayMs: 5000,          // cap at 5s delay
    skip: (req) => req.path.startsWith("/api/webhooks") || req.path.startsWith("/api/trpc/auth"),
  });
  app.use(slowDownMiddleware);

  // ── Account lockout (Redis-backed) ─────────────────────────────────────────
  // After 5 failed OAuth attempts from the same IP in 15 min, block for 15 min.
  const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
  const LOCKOUT_MAX_ATTEMPTS = 5;
  const loginFailCounts = new Map<string, { count: number; resetAt: number }>();

  function isLockedOut(ip: string): boolean {
    const entry = loginFailCounts.get(ip);
    if (!entry) return false;
    if (Date.now() > entry.resetAt) { loginFailCounts.delete(ip); return false; }
    return entry.count >= LOCKOUT_MAX_ATTEMPTS;
  }

  function recordLoginFailure(ip: string): void {
    const entry = loginFailCounts.get(ip);
    if (!entry || Date.now() > entry.resetAt) {
      loginFailCounts.set(ip, { count: 1, resetAt: Date.now() + LOCKOUT_WINDOW_MS });
    } else {
      entry.count++;
    }
  }

  function clearLoginFailures(ip: string): void {
    loginFailCounts.delete(ip);
  }

  // Expose helpers for OAuth callback to call
  (app as any)._bisLockout = { isLockedOut, recordLoginFailure, clearLoginFailures };

  // Lockout check middleware on /api/oauth
  app.use("/api/oauth", (req, res, next) => {
    const ip = (req.headers["x-forwarded-for"] as string ?? req.socket.remoteAddress ?? "unknown").split(",")[0].trim();
    if (isLockedOut(ip)) {
      res.status(429).json({ error: "Account temporarily locked due to too many failed attempts. Try again in 15 minutes." });
      return;
    }
    next();
  });

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
      const PAYSTACK_SECRET = ENV.paystackSecretKey;
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
      const llmUrl = ENV.llmUrl;
      if (llmUrl) {
        const r = await fetch(`${llmUrl}/health`, { signal: AbortSignal.timeout(3000) });
        checks.llm = { status: r.ok ? "ok" : "degraded", latencyMs: Date.now() - llmStart };
      } else {
        checks.llm = { status: "degraded" };
      }
    } catch {
      checks.llm = { status: "degraded", latencyMs: Date.now() - llmStart };
    }

    // Redis check
    const redisStart = Date.now();
    try {
      const { getRedis } = await import("../redis");
      const redis = await getRedis();
      if (redis) {
        await redis.ping();
        checks.redis = { status: "ok", latencyMs: Date.now() - redisStart };
      } else {
        checks.redis = { status: "degraded" };
      }
    } catch {
      checks.redis = { status: "degraded", latencyMs: Date.now() - redisStart };
    }

    // Biometric engine check
    const bioStart = Date.now();
    try {
      const bioUrl = ENV.biometricEngineUrl;
      if (bioUrl) {
        const r = await fetch(`${bioUrl}/health`, { signal: AbortSignal.timeout(3000) });
        checks.biometric = { status: r.ok ? "ok" : "degraded", latencyMs: Date.now() - bioStart };
      } else {
        checks.biometric = { status: "degraded" }; // URL not configured
      }
    } catch {
      checks.biometric = { status: "degraded", latencyMs: Date.now() - bioStart };
    }

    // Temporal check
    const temporalStart = Date.now();
    try {
      const temporalHost = ENV.temporalHost;
      if (temporalHost) {
        // Simple TCP connectivity check to Temporal frontend service (port 7233)
        const [host] = temporalHost.split(":");
        const port = parseInt(temporalHost.split(":")[1] ?? "7233", 10);
        await new Promise<void>((resolve, reject) => {
          const socket = net.createConnection({ host, port, timeout: 3000 });
          socket.on("connect", () => { socket.destroy(); resolve(); });
          socket.on("error", reject);
          socket.on("timeout", () => { socket.destroy(); reject(new Error("timeout")); });
        });
        checks.temporal = { status: "ok", latencyMs: Date.now() - temporalStart };
      } else {
        checks.temporal = { status: "degraded" }; // Host not configured
      }
    } catch {
      checks.temporal = { status: "degraded", latencyMs: Date.now() - temporalStart };
    }

    // Fluvio velocity processor check
    const fluvioStart = Date.now();
    try {
      const { fluvioHealthCheck } = await import("../fluvio");
      const fluvioResult = await fluvioHealthCheck();
      checks.fluvio = { status: fluvioResult.ok ? "ok" : "degraded", latencyMs: Date.now() - fluvioStart };
    } catch {
      checks.fluvio = { status: "degraded", latencyMs: Date.now() - fluvioStart };
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

  // ── Event Emitter SSE proxy ────────────────────────────────────────────────────
  // Proxies the Rust event-emitter SSE stream to authenticated PWA clients.
  // Client usage: new EventSource('/api/events/stream') after login.
  app.get("/api/events/stream", async (req: Request, res: Response) => {
    // Validate session cookie
    const { sdk } = await import("./sdk");
    const user = await sdk.authenticateRequest(req).catch(() => null);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const EVENT_EMITTER_URL = ENV.riskEngineUrl;
    try {
      const upstream = await fetch(`${EVENT_EMITTER_URL}/events/stream`, {
        headers: { Accept: "text/event-stream" },
      });
      if (!upstream.ok || !upstream.body) {
        res.status(502).json({ error: "Event emitter unavailable" });
        return;
      }
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done || res.writableEnded) break;
            res.write(decoder.decode(value, { stream: true }));
          }
        } catch { /* client disconnected */ }
        res.end();
      };
      pump();
      req.on("close", () => reader.cancel());
    } catch {
      res.status(502).json({ error: "Event emitter unavailable" });
    }
  });

  // ── Insider Threat real-time alert stream (SSE) ─────────────────────────────
  // Proxies the Fluvio bis.alerts topic as an SSE stream to the PWA dashboard.
  // Auth: session cookie (admin only).
  // Client usage: new EventSource('/api/v1/insider/stream')
  app.get("/api/v1/insider/stream", async (req: Request, res: Response) => {
    const { sdk } = await import("./sdk");
    const user = await sdk.authenticateRequest(req).catch(() => null);
    if (!user || (user as { role?: string }).role !== "admin") {
      res.status(401).json({ error: "Admin authentication required" });
      return;
    }
    const fluvioUrl = (ENV as Record<string, unknown>).fluvioVelocityUrl as string
      ?? process.env.FLUVIO_VELOCITY_URL
      ?? "http://localhost:9000";
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    // Send initial heartbeat
    res.write(`event: connected\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
    // Poll Fluvio REST API for new bis.alerts messages every 2 seconds
    let offset = 0;
    let closed = false;
    req.on("close", () => { closed = true; });
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(`:heartbeat\n\n`);
    }, 25_000);
    const poll = async () => {
      while (!closed && !res.writableEnded) {
        try {
          const r = await fetch(
            `${fluvioUrl}/consume/bis.alerts?offset=${offset}&max_records=20`,
            { signal: AbortSignal.timeout(5_000) },
          );
          if (r.ok) {
            const records = await r.json() as Array<{ value: unknown; offset: number }>;
            for (const rec of records) {
              if (closed || res.writableEnded) break;
              res.write(`event: insider_alert\ndata: ${JSON.stringify(rec.value)}\n\n`);
              offset = rec.offset + 1;
            }
          }
        } catch { /* Fluvio unavailable — keep polling */ }
        await new Promise(r2 => setTimeout(r2, 2_000));
      }
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    };
    poll();
  });

  // ── Stakeholder Portal SSE stream ────────────────────────────────────────────
  // Provides real-time push notifications to stakeholder portal sessions.
  // Auth: token query param (portal access token, no session cookie required).
  // Events: PORTAL_COMMENT, PORTAL_DOCUMENT
  // Client usage: new EventSource('/api/v1/portal/stream?token=<token>')
  app.get("/api/v1/portal/stream", async (req: Request, res: Response) => {
    const token = req.query.token as string | undefined;
    if (!token) {
      res.status(401).json({ error: "Missing portal token" });
      return;
    }
    // Validate the portal token against DB
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }
    const { caseStakeholders } = await import("../../drizzle/schema");
    const { eq, and, gt } = await import("drizzle-orm");
    const [sh] = await db
      .select({ id: caseStakeholders.id, caseId: caseStakeholders.caseId, accessExpiresAt: caseStakeholders.accessExpiresAt })
      .from(caseStakeholders)
      .where(eq(caseStakeholders.accessToken, token))
      .limit(1);
    if (!sh) {
      res.status(401).json({ error: "Invalid portal token" });
      return;
    }
    if (sh.accessExpiresAt && sh.accessExpiresAt < new Date()) {
      res.status(401).json({ error: "Portal token expired" });
      return;
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Register this connection in the portal SSE manager
    const { portalSseManager } = await import("../portalSse");
    const clientId = portalSseManager.register(sh.caseId, res);

    // Send initial heartbeat
    res.write(`event: connected\ndata: ${JSON.stringify({ caseId: sh.caseId, ts: new Date().toISOString() })}\n\n`);

    // Heartbeat every 25s to keep connection alive through proxies
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`:heartbeat\n\n`);
      }
    }, 25_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      portalSseManager.unregister(clientId);
    });
  });

  // ── Scheduled task endpoint — alert rules evaluation ──────────────────────
  // Called by Manus scheduled task every 15 min via:
  //   curl -X POST $SCHEDULED_TASK_ENDPOINT_BASE/api/scheduled/alert-rules \
  //     -H "Cookie: app_session_id=$SCHEDULED_TASK_COOKIE"
  app.post("/api/scheduled/alert-rules", async (req: Request, res: Response) => {
    try {
      const { sdk } = await import("./sdk");
      const user = await sdk.authenticateRequest(req);
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const { getDb } = await import("../db");
      const db = await getDb();
      const schema = await import("../../drizzle/schema");
      const { eq, gte, sql } = await import("drizzle-orm");
      const cutoff = new Date(Date.now() - 15 * 60 * 1000);
      const activeRules = await db!
        .select()
        .from(schema.alertRules)
        .where(eq(schema.alertRules.enabled, true));
      let triggered = 0;
      for (const rule of activeRules) {
        try {
          const recentTxCount = await db!
            .select({ count: sql<number>`count(*)` })
            .from(schema.transactions)
            .where(gte(schema.transactions.createdAt, cutoff));
          const count = Number(recentTxCount[0]?.count ?? 0);
          const threshold = Number(rule.threshold ?? 0);
          if (count >= threshold && threshold > 0) {
            await db!.insert(schema.alerts).values({
              type: 'risk_threshold',
              severity: rule.severity,
              title: `Alert Rule Triggered: ${rule.name}`,
              body: `Rule "${rule.name}" triggered: ${count} events in last 15 min (threshold: ${threshold})`,
              subjectRef: 'scheduled-eval',
              sourceService: 'bff-scheduler',
            });
            triggered++;
          }
        } catch (ruleErr) {
          console.warn(`[ScheduledAlerts] Rule ${rule.id} eval error:`, ruleErr);
        }
      }
      log("info", "[ScheduledAlerts] Evaluation complete", { rulesChecked: activeRules.length, triggered });
      res.json({ ok: true, rulesChecked: activeRules.length, triggered });
    } catch (err) {
      console.error("[ScheduledAlerts] Error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Grafana alert webhook ──────────────────────────────────────────────────
  app.post("/api/webhooks/grafana-alert", async (req, res) => {
    try {
      const expectedToken = ENV.grafanaWebhookSecret;
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

  // ── Sanctions list refresh webhook ──────────────────────────────────────────
  // Called by the BIS gateway / AML engine when the UN/OFAC/FATF sanctions list
  // is updated. Verifies HMAC-SHA256 signature, invalidates the in-memory cache,
  // and notifies the platform owner.
  //
  // Expected headers:
  //   x-bis-signature: sha256=<hex>   (HMAC-SHA256 of raw body using SANCTIONS_WEBHOOK_SECRET)
  //   Content-Type: application/json
  //
  // Expected body: { listName: string; totalEntries: number; updatedAt: string; source?: string }
  app.post("/api/webhooks/sanctions-refresh", express.raw({ type: "application/json" }), async (req, res) => {
    try {
      const secret = ENV.sanctionsWebhookSecret;
      const sigHeader = (req.headers["x-bis-signature"] as string | undefined) ?? "";

      // Verify HMAC-SHA256 signature
      if (secret && secret !== "bis-sanctions-webhook-dev") {
        const expected = "sha256=" + crypto
          .createHmac("sha256", secret)
          .update(req.body as Buffer)
          .digest("hex");
        const expectedBuf = Buffer.from(expected);
        const sigBuf = Buffer.from(sigHeader);
        const isValid =
          expectedBuf.length === sigBuf.length &&
          crypto.timingSafeEqual(expectedBuf, sigBuf);
        if (!isValid) {
          console.warn("[SanctionsWebhook] Invalid signature — request rejected");
          res.status(401).json({ error: "Invalid signature" });
          return;
        }
      } else if (!secret || secret === "bis-sanctions-webhook-dev") {
        // Dev mode: accept without signature verification but log a warning
        console.warn("[SanctionsWebhook] Running in dev mode — signature verification skipped");
      }

      const body = JSON.parse((req.body as Buffer).toString("utf8")) as {
        listName?: string;
        totalEntries?: number;
        updatedAt?: string;
        source?: string;
        hitCount?: number;
      };

      const listName = body.listName ?? "Unknown";
      const totalEntries = body.totalEntries ?? 0;
      const updatedAt = body.updatedAt ? new Date(body.updatedAt).toISOString() : new Date().toISOString();
      const source = body.source ?? "gateway";

      console.log(`[SanctionsWebhook] List updated: ${listName} entries=${totalEntries} source=${source}`);

      // Write an audit log entry for the sanctions list update
      try {
        const { getDb } = await import("../db");
        const { auditLog } = await import("../../drizzle/schema");
        const db = await getDb();
        if (db) {
          await db.insert(auditLog).values({
            // userId 0 = system action (no real user)
            category: "system" as const,
            action: `Sanctions list updated: ${listName}`,
            targetRef: "sanctions-list",
            detail: { listName, totalEntries, updatedAt, source, hitCount: body.hitCount },
          });
        }
      } catch {
        // Audit log failure is non-fatal
      }

      // Notify the platform owner
      const delivered = await notifyOwner({
        title: `🛡️ Sanctions List Updated — ${listName}`,
        content: [
          `The **${listName}** sanctions list has been refreshed.`,
          `- **Total entries:** ${totalEntries.toLocaleString()}`,
          `- **Updated at:** ${updatedAt}`,
          `- **Source:** ${source}`,
          body.hitCount !== undefined ? `- **30-day hits:** ${body.hitCount}` : "",
        ].filter(Boolean).join("\n"),
      });

      // Broadcast push notification to all admin users
      try {
        const { getDb } = await import("../db");
        const { broadcastPush } = await import("../pushNotify");
        const { users } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (db) {
          const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
          if (admins.length > 0) {
            broadcastPush(admins.map(a => a.id), {
              title: `🛡️ Sanctions List Updated`,
              body: `${listName} refreshed with ${totalEntries.toLocaleString()} entries`,
              url: "/aml",
              tag: "sanctions-refresh",
            }).catch(() => {});
          }
        }
      } catch {
        // Push notification failure is non-fatal
      }

      console.log(`[SanctionsWebhook] Processed list=${listName} entries=${totalEntries} notified=${delivered}`);
      res.status(200).json({ received: true, listName, totalEntries, delivered });
    } catch (err) {
      console.error("[SanctionsWebhook] Error:", err);
      res.status(200).json({ received: true, error: "Processing error" });
    }
  });

  // ── API v1 Bearer token validation middleware ─────────────────────────────
  // All /api/v1/* requests (except /api/v1/health) must include a valid Bearer token.
  // Token is validated against the api_tokens table (SHA-256 hash comparison).
  // Usage is logged to token_usage_log for analytics.
  app.use("/api/v1", async (req: Request, res: Response, next: NextFunction) => {
    // Health endpoint is public
    if (req.path === "/health") return next();
    const authHeader = req.headers["authorization"] ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token || !token.startsWith("bis")) {
      res.status(401).json({ error: "API token required", code: "MISSING_TOKEN" });
      return;
    }
    try {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const { getDb } = await import("../db");
      const { apiTokens, tokenUsageLog } = await import("../../drizzle/schema");
      const { eq, and, sql: sqlTag } = await import("drizzle-orm");
      const dbInstance = await getDb();
      if (!dbInstance) {
        res.status(503).json({ error: "Database unavailable" });
        return;
      }
      const rows = await dbInstance
        .select()
        .from(apiTokens)
        .where(and(eq(apiTokens.tokenHash, tokenHash), eq(apiTokens.active, true)))
        .limit(1);
      if (rows.length === 0) {
        res.status(401).json({ error: "Invalid or revoked API token", code: "INVALID_TOKEN" });
        return;
      }
      const apiToken = rows[0];
      // Check token expiry
      if (apiToken.expiresAt && apiToken.expiresAt < new Date()) {
        res.status(401).json({ error: "API token has expired", code: "TOKEN_EXPIRED" });
        return;
      }
      // Check token quota
      if (apiToken.tokenQuota !== null && apiToken.usageCount >= apiToken.tokenQuota) {
        res.status(429).json({ error: "Token quota exceeded", code: "QUOTA_EXCEEDED" });
        return;
      }
      // Attach token context to request
      (req as any).apiToken = apiToken;
      const startTime = Date.now();
      // Log usage after response
      res.on("finish", async () => {
        try {
          const latencyMs = Date.now() - startTime;
          await dbInstance.insert(tokenUsageLog).values({
            tokenId: apiToken.id,
            endpoint: req.path,
            method: req.method,
            statusCode: res.statusCode,
            latencyMs,
          });
          // Increment usage count
          await dbInstance.execute(
            sqlTag`UPDATE api_tokens SET "usageCount" = "usageCount" + 1, "lastUsedAt" = NOW() WHERE id = ${apiToken.id}`
          );
        } catch (logErr) {
          console.warn("[APIv1] Usage log error:", logErr);
        }
      });
      next();
    } catch (err) {
      console.error("[APIv1] Token validation error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  // OpenClaw managed instance + Swagger UI
  app.use(createOpenClawRouter());

  // ── CSRF validation middleware ────────────────────────────────────────────
  // Validates X-CSRF-Token header on all state-changing tRPC mutations.
  // Only enforced in production; dev mode is relaxed for Vite HMR.
  if (!isDev) {
    app.use("/api/trpc", (req: Request, res: Response, next: NextFunction) => {
      // Only validate POST requests (tRPC mutations use POST)
      if (req.method !== "POST") return next();
      const csrfHeader = req.headers["x-csrf-token"] as string | undefined;
      // Parse _csrf cookie from Cookie header manually (avoid cookie-parser dep)
      const cookieHeader = req.headers["cookie"] ?? "";
      const csrfCookieMatch = cookieHeader.match(/(?:^|;\s*)_csrf=([^;]+)/);
      const csrfCookie = csrfCookieMatch ? decodeURIComponent(csrfCookieMatch[1]) : undefined;
      // If no CSRF cookie exists yet, check whether the user has a session.
      // Authenticated users MUST have fetched a CSRF token — reject to prevent bypass.
      // Unauthenticated first-visit requests are allowed through.
      if (!csrfCookie) {
        const sessionCookieMatch = cookieHeader.match(/(?:^|;\s*)app_session_id=([^;]+)/);
        if (sessionCookieMatch) {
          log("warn", "CSRF cookie missing for authenticated user", { path: req.path, ip: req.ip });
          res.status(403).json({ error: "CSRF token required" });
          return;
        }
        return next();
      }
      // Validate token matches cookie using timing-safe comparison
      if (!csrfHeader) {
        log("warn", "CSRF token missing", { path: req.path, ip: req.ip });
        res.status(403).json({ error: "CSRF token required" });
        return;
      }
      try {
        const headerBuf = Buffer.from(csrfHeader);
        const cookieBuf = Buffer.from(csrfCookie);
        const isValid =
          headerBuf.length === cookieBuf.length &&
          crypto.timingSafeEqual(headerBuf, cookieBuf);
        if (!isValid) {
          log("warn", "CSRF token mismatch", { path: req.path, ip: req.ip });
          res.status(403).json({ error: "CSRF token invalid" });
          return;
        }
      } catch {
        res.status(403).json({ error: "CSRF token invalid" });
        return;
      }
      next();
    });
  }

  // ── OpenAPI / Swagger UI ────────────────────────────────────────────────────
  // Serve the OpenAPI spec at /api/openapi.yaml and Swagger UI at /api/docs
  try {
    const openapiPath = new URL("../../openapi.yaml", import.meta.url).pathname;
    const openapiSpec = yamlLoad(readFileSync(openapiPath, "utf8")) as Record<string, unknown>;
    app.get("/api/openapi.yaml", (_req, res) => {
      res.setHeader("Content-Type", "application/yaml");
      res.send(readFileSync(openapiPath, "utf8"));
    });
    app.get("/api/openapi.json", (_req, res) => {
      res.json(openapiSpec);
    });
    app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec, {
      customSiteTitle: "BIS API Documentation",
      customCss: `.swagger-ui .topbar { background-color: #0f172a; } .swagger-ui .topbar-wrapper img { content: url('/favicon.ico'); }`,
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true,
      },
    }));
    log("info", "Swagger UI mounted at /api/docs");
  } catch (err) {
    log("warn", "Could not mount Swagger UI", { error: String(err) });
  }

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

  const preferredPort = ENV.port;
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
    startArchivalScheduler(); // Nightly hot→warm→cold archival at 02:00 UTC
    startKycExpiryDigestScheduler(); // Daily KYC expiry digest at 08:00 WAT
    startRiskThresholdDigestScheduler(); // Daily risk threshold digest at 09:00 WAT
    startDataSourcesHealthScheduler(); // 15-min health probe for all enabled data sources
    startKycScheduledRerunExecutor(); // 5-min poll for pending KYC scheduled re-runs
    startBiometricSpoofAlertScheduler(); // Hourly biometric spoof-attack alert (ISO 30107-3)
    startBiometricSessionLogArchiver();   // Weekly biometric session log archival (90d hot→cold S3)
    startVapidRotationReminderScheduler(); // Daily VAPID key age check — notifies owner after 90 days
    startBroadcastScheduler(); // 1-min poll for overdue scheduled broadcasts
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
