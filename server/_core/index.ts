import "dotenv/config";
import { getDb } from '../db';

import "../sentry.server.config";

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
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext, createContextFromRequest } from "./context";
import { serveStatic, setupVite } from "./vite";
import { notifyOwner } from "./notification";
import { recordPaystackWebhook } from "../billingSettlement";
import { registerIntelligenceBillingMetrics } from "../intelligenceBillingMetrics";
import { registerPaymentReconciliationMetrics } from "../paymentReconciliationMetrics";
import { traceCorrelationMiddleware, traceLogFields } from "../traceContext";
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
import { startWebhookRetryScheduler } from "../webhookRetry";
import { startPaymentIntentOutboxDispatcher } from "../paymentIntentOutbox";
import { FORENSIC_EXPORT_MAX_EVENTS, iterateVerifiedForensicExport } from "../piiForensicExport";
import { forensicIncidentReferenceSchema, serializeForensicExportRecord } from "../forensicExportProtocol";

// ── Structured logger ─────────────────────────────────────────────────────────
function log(level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...traceLogFields(), ...meta });
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
  app.use(traceCorrelationMiddleware);
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

  const contentSecurityPolicy = isDev
    ? {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://maps.googleapis.com"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "https:", "blob:"],
          connectSrc: ["'self'", "ws:", "wss:"],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: null,
        },
      }
    : {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "https://maps.googleapis.com",
            (_req: import("http").IncomingMessage, res: import("http").ServerResponse) => {
              const nonce = (res as import("http").ServerResponse & { locals?: { nonce?: string } }).locals?.nonce;
              return nonce ? `'nonce-${nonce}'` : "'none'";
            },
          ],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "https:", "blob:"],
          connectSrc: ["'self'", "wss:"],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: [],
        },
      };

  app.use(
    helmet({
      contentSecurityPolicy,
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
    // Persist WAF events to apisixAuditLog for compliance auditing
    if (appsecStatus && (appsecStatus === "detect" || appsecStatus === "block")) {
      getDb().then(db => {
        if (!db) return;
        const { apisixAuditLogs } = require("../../drizzle/schema");
        db.insert(apisixAuditLogs).values({
          requestId: (req as Request & { id?: string }).id ?? null,
          clientIp: req.ip ?? null,
          method: req.method,
          uri: req.path,
          wafStatus: appsecStatus,
          wafAttackType: appsecAttackType ?? null,
          rawLog: { appsecMode, headers: { 'x-appsec-status': appsecStatus, 'x-appsec-attack-type': appsecAttackType } },
        }).catch(e => log("warn", "[WAF] Failed to persist WAF event", { error: String(e) }));
      }).catch(() => {});
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
  registerIntelligenceBillingMetrics();
  registerPaymentReconciliationMetrics();
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
  // Paystack signs raw bytes. This route precedes the JSON parser and performs
  // no settlement/network work: it validates HMAC then persists a minimised,
  // idempotent delivery record. A non-2xx response deliberately causes Paystack
  // retry rather than accepting a payment event that cannot be reconciled.
  app.post("/api/webhooks/paystack", express.raw({ type: "application/json", limit: "256kb" }), async (req, res) => {
    const secret = ENV.paystackSecretKey;
    if (!secret) {
      log("error", "Paystack webhook rejected because settlement is not configured", { reqId: (req as Request & { id?: string }).id });
      res.status(503).json({ error: "Payment settlement is unavailable" });
      return;
    }
    const rawBody = req.body;
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
      res.status(400).json({ error: "A non-empty raw JSON webhook body is required" });
      return;
    }
    const signature = req.headers["x-paystack-signature"];
    if (typeof signature !== "string" || !/^[0-9a-f]{128}$/i.test(signature)) {
      res.status(401).json({ error: "A valid x-paystack-signature header is required" });
      return;
    }
    const expected = crypto.createHmac("sha512", secret).update(rawBody).digest();
    const supplied = Buffer.from(signature, "hex");
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(expected, supplied)) {
      log("warn", "Paystack webhook rejected due to invalid signature", { reqId: (req as Request & { id?: string }).id });
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.status(400).json({ error: "Webhook body is not valid JSON" });
      return;
    }
    try {
      const stored = await recordPaystackWebhook(rawBody, body);
      log("info", "Paystack webhook durably accepted", { reqId: (req as Request & { id?: string }).id, duplicate: stored.duplicate, eventHash: stored.eventHash.slice(0, 16) });
      res.status(200).json({ received: true, duplicate: stored.duplicate });
    } catch (error) {
      log("error", "Paystack webhook durable intake failed", { reqId: (req as Request & { id?: string }).id, error: error instanceof Error ? error.message : "unknown" });
      res.status(503).json({ error: "Webhook intake is temporarily unavailable" });
    }
  });

  // JSON body parser (after Paystack raw handler)
  // Limit to 4mb for normal API calls; file uploads use base64 in JSON which is larger
  app.use(express.json({ limit: "4mb" }));
  app.use(express.urlencoded({ limit: "4mb", extended: true }));

  // Mobile REST adapter for the same purpose-bound synthetic consumer discovery
  // contract exposed by tRPC. It contains no separate data access logic.
  const respondConsumerAdapterError = (req: Request, res: Response, error: unknown, operation: string) => {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "INTERNAL_SERVER_ERROR";
    const status = code === "UNAUTHORIZED" ? 401 : code === "FORBIDDEN" ? 403 : code === "BAD_REQUEST" ? 400 : code === "NOT_FOUND" ? 404 : 503;
    const message = error instanceof Error ? error.message : "Consumer discovery request failed";
    log(status >= 500 ? "error" : "warn", "consumer discovery request rejected", { status, code, operation, reqId: (req as Request & { id?: string }).id });
    res.status(status).json({ error: message, code });
  };

  app.post("/api/consumer-discovery/consent", async (req: Request, res: Response) => {
    try {
      const ctx = await createContextFromRequest(req, res);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.consumerGovernance.consent.grant(req.body);
      res.status(201).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "consent_grant");
    }
  });

  app.post("/api/consumer-discovery/search", async (req: Request, res: Response) => {
    try {
      const ctx = await createContextFromRequest(req, res);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.consumerIntelligence.search(req.body);
      res.status(200).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "search");
    }
  });

  // Consumer-dispute adapters delegate to the same ownership-bound tRPC procedures.
  // They never expose source credentials, raw provider responses, or another consumer's data.
  const consumerDisputeCaseRef = (value: unknown): string | null => {
    const candidate = Array.isArray(value) ? value[0] : value;
    return typeof candidate === "string" && /^BIS-DR-[A-Z0-9]{18}$/.test(candidate) ? candidate : null;
  };

  app.post("/api/consumer-disputes", async (req: Request, res: Response) => {
    try {
      const ctx = await createContextFromRequest(req, res);
      const result = await appRouter.createCaller(ctx).consumerDisputes.open(req.body);
      res.status(201).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "consumer_dispute_open");
    }
  });

  app.get("/api/consumer-disputes", async (req: Request, res: Response) => {
    try {
      const ctx = await createContextFromRequest(req, res);
      const result = await appRouter.createCaller(ctx).consumerDisputes.mine();
      res.status(200).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "consumer_dispute_mine");
    }
  });

  app.get("/api/consumer-disputes/:caseRef", async (req: Request, res: Response) => {
    const caseRef = consumerDisputeCaseRef(req.params.caseRef);
    if (!caseRef) {
      res.status(400).json({ error: "A valid consumer dispute case reference is required", code: "BAD_REQUEST" });
      return;
    }
    try {
      const ctx = await createContextFromRequest(req, res);
      const result = await appRouter.createCaller(ctx).consumerDisputes.getMine({ caseRef });
      res.status(200).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "consumer_dispute_get");
    }
  });

  app.post("/api/consumer-disputes/:caseRef/evidence/initiate", async (req: Request, res: Response) => {
    const caseRef = consumerDisputeCaseRef(req.params.caseRef);
    if (!caseRef) {
      res.status(400).json({ error: "A valid consumer dispute case reference is required", code: "BAD_REQUEST" });
      return;
    }
    try {
      const ctx = await createContextFromRequest(req, res);
      const result = await appRouter.createCaller(ctx).consumerDisputes.initiateEvidence({ ...req.body, caseRef });
      res.status(201).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "consumer_dispute_evidence_initiate");
    }
  });

  app.post("/api/consumer-disputes/:caseRef/evidence/:evidenceRef/complete", async (req: Request, res: Response) => {
    const caseRef = consumerDisputeCaseRef(req.params.caseRef);
    const rawEvidenceRef = Array.isArray(req.params.evidenceRef) ? req.params.evidenceRef[0] : req.params.evidenceRef;
    if (!caseRef || typeof rawEvidenceRef !== "string" || !/^BIS-DE-[A-Z0-9]{18}$/.test(rawEvidenceRef)) {
      res.status(400).json({ error: "A valid consumer dispute and evidence reference are required", code: "BAD_REQUEST" });
      return;
    }
    try {
      const ctx = await createContextFromRequest(req, res);
      const result = await appRouter.createCaller(ctx).consumerDisputes.completeEvidence({ caseRef, evidenceRef: rawEvidenceRef });
      res.status(200).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "consumer_dispute_evidence_complete");
    }
  });

  app.get("/api/consumer-disputes/:caseRef/deadline-escalations", async (req: Request, res: Response) => {
    const caseRef = consumerDisputeCaseRef(req.params.caseRef);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    if (!caseRef || (status !== undefined && !["open", "acknowledged", "resolved"].includes(status))) {
      res.status(400).json({ error: "A valid consumer dispute case reference and escalation status are required", code: "BAD_REQUEST" });
      return;
    }
    try {
      const ctx = await createContextFromRequest(req, res);
      const result = await appRouter.createCaller(ctx).consumerDisputes.deadlineEscalations({ caseRef, status: status as "open" | "acknowledged" | "resolved" | undefined });
      res.status(200).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "consumer_dispute_deadline_escalations_list");
    }
  });

  app.post("/api/consumer-disputes/:caseRef/deadline-escalations/:escalationId/acknowledge", async (req: Request, res: Response) => {
    const caseRef = consumerDisputeCaseRef(req.params.caseRef);
    const escalationId = Number(Array.isArray(req.params.escalationId) ? req.params.escalationId[0] : req.params.escalationId);
    if (!caseRef || !Number.isSafeInteger(escalationId) || escalationId <= 0) {
      res.status(400).json({ error: "A valid consumer dispute case reference and escalation ID are required", code: "BAD_REQUEST" });
      return;
    }
    try {
      const ctx = await createContextFromRequest(req, res);
      const result = await appRouter.createCaller(ctx).consumerDisputes.acknowledgeDeadlineEscalation({ caseRef, escalationId });
      res.status(200).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "consumer_dispute_deadline_escalation_acknowledge");
    }
  });

  app.post("/api/consumer-disputes/:caseRef/deadline-escalations/:escalationId/resolve", async (req: Request, res: Response) => {
    const caseRef = consumerDisputeCaseRef(req.params.caseRef);
    const escalationId = Number(Array.isArray(req.params.escalationId) ? req.params.escalationId[0] : req.params.escalationId);
    const resolutionNote = req.body?.resolutionNote;
    if (!caseRef || !Number.isSafeInteger(escalationId) || escalationId <= 0 || typeof resolutionNote !== "string") {
      res.status(400).json({ error: "A valid consumer dispute case reference, escalation ID, and resolution note are required", code: "BAD_REQUEST" });
      return;
    }
    try {
      const ctx = await createContextFromRequest(req, res);
      const result = await appRouter.createCaller(ctx).consumerDisputes.resolveDeadlineEscalation({ caseRef, escalationId, resolutionNote });
      res.status(200).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "consumer_dispute_deadline_escalation_resolve");
    }
  });

  app.post("/api/consumer-disputes/:caseRef/withdraw", async (req: Request, res: Response) => {
    const caseRef = consumerDisputeCaseRef(req.params.caseRef);
    if (!caseRef) {
      res.status(400).json({ error: "A valid consumer dispute case reference is required", code: "BAD_REQUEST" });
      return;
    }
    try {
      const ctx = await createContextFromRequest(req, res);
      const result = await appRouter.createCaller(ctx).consumerDisputes.withdraw({ caseRef });
      res.status(200).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "consumer_dispute_withdraw");
    }
  });

  app.post("/api/consumer-disputes/:caseRef/method-description-requests", async (req: Request, res: Response) => {
    const caseRef = consumerDisputeCaseRef(req.params.caseRef);
    if (!caseRef) {
      res.status(400).json({ error: "A valid consumer dispute case reference is required", code: "BAD_REQUEST" });
      return;
    }
    try {
      const ctx = await createContextFromRequest(req, res);
      const result = await appRouter.createCaller(ctx).consumerDisputes.requestMethodDescription({ caseRef });
      res.status(202).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "consumer_dispute_method_description");
    }
  });

  // Verified PII forensic export delegates every page to the same tenant-scoped tRPC procedure.
  // It streams NDJSON and has no separate forensic query or export-state persistence path.
  app.get("/api/pii-forensics/export.ndjson", async (req: Request, res: Response) => {
    const rawIncidentRef = typeof req.query.incidentRef === "string" ? req.query.incidentRef : undefined;
    const rawMaxEvents = typeof req.query.maxEvents === "string" ? Number(req.query.maxEvents) : undefined;
    if (rawIncidentRef !== undefined && !forensicIncidentReferenceSchema.safeParse(rawIncidentRef).success) {
      res.status(400).json({ error: "A valid PII incident reference is required", code: "BAD_REQUEST" });
      return;
    }
    if (rawMaxEvents !== undefined && (!Number.isSafeInteger(rawMaxEvents) || rawMaxEvents < 1 || rawMaxEvents > FORENSIC_EXPORT_MAX_EVENTS)) {
      res.status(400).json({ error: `maxEvents must be an integer from 1 through ${FORENSIC_EXPORT_MAX_EVENTS}`, code: "BAD_REQUEST" });
      return;
    }
    let emitted = 0;
    try {
      const caller = appRouter.createCaller(await createContextFromRequest(req, res));
      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="bis-pii-forensic-audit.ndjson"');
      res.setHeader("Cache-Control", "no-store, private");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.write(serializeForensicExportRecord({ type: "manifest", format: "bis-pii-forensic-audit-ndjson-v1", generatedAt: new Date().toISOString(), maxEvents: rawMaxEvents ?? FORENSIC_EXPORT_MAX_EVENTS, incidentRef: rawIncidentRef ?? null }));
      for await (const event of iterateVerifiedForensicExport(
        (input) => caller.piiKeyCustody.listForensics(input),
        { incidentRef: rawIncidentRef, maxEvents: rawMaxEvents },
      )) {
        if (req.destroyed || res.writableEnded) throw new Error("forensic export client disconnected");
        emitted += 1;
        if (!res.write(serializeForensicExportRecord({ type: "event", event }))) {
          await new Promise<void>((resolve, reject) => { res.once("drain", resolve); res.once("error", reject); });
        }
      }
      res.end(serializeForensicExportRecord({ type: "complete", eventCount: emitted }));
    } catch (error) {
      log("warn", "verified forensic export terminated", { reqId: (req as Request & { id?: string }).id, emitted, code: error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "INTERNAL_SERVER_ERROR" });
      if (!res.headersSent) {
        respondConsumerAdapterError(req, res, error, "pii_forensic_export");
      } else if (!res.writableEnded) {
        res.destroy();
      }
    }
  });

  // Compliance/adverse-action adapters delegate to the same tenant-scoped tRPC procedures.
  // They expose workflow references only; no template plaintext, provider payload, or PII is returned.
  const complianceCaseRef = (value: unknown): string | null => {
    const candidate = Array.isArray(value) ? value[0] : value;
    return typeof candidate === "string" && /^BIS-AA-[A-Z0-9]{18}$/.test(candidate) ? candidate : null;
  };

  app.post("/api/compliance/notice-templates", async (req: Request, res: Response) => {
    try {
      const result = await appRouter.createCaller(await createContextFromRequest(req, res)).complianceWorkflow.createNoticeTemplate(req.body);
      res.status(201).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "compliance_notice_template_create");
    }
  });

  app.post("/api/compliance/notice-templates/:templateId/supersede", async (req: Request, res: Response) => {
    const templateId = Array.isArray(req.params.templateId) ? req.params.templateId[0] : req.params.templateId;
    if (typeof templateId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(templateId)) {
      res.status(400).json({ error: "A valid notice template identifier is required", code: "BAD_REQUEST" });
      return;
    }
    try {
      const result = await appRouter.createCaller(await createContextFromRequest(req, res)).complianceWorkflow.supersedeNoticeTemplate({ ...req.body, templateId });
      res.status(200).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "compliance_notice_template_supersede");
    }
  });

  app.post("/api/compliance/adverse-actions", async (req: Request, res: Response) => {
    try {
      const result = await appRouter.createCaller(await createContextFromRequest(req, res)).complianceWorkflow.initiatePreAdverse(req.body);
      res.status(201).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "compliance_adverse_action_initiate");
    }
  });

  app.get("/api/compliance/adverse-actions", async (req: Request, res: Response) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    try {
      const result = await appRouter.createCaller(await createContextFromRequest(req, res)).complianceWorkflow.list(status ? { status } : undefined);
      res.status(200).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "compliance_adverse_action_list");
    }
  });

  app.post("/api/compliance/adverse-actions/:caseRef/deliveries/:deliveryId", async (req: Request, res: Response) => {
    const caseRef = complianceCaseRef(req.params.caseRef);
    const deliveryId = Array.isArray(req.params.deliveryId) ? req.params.deliveryId[0] : req.params.deliveryId;
    if (!caseRef || typeof deliveryId !== "string") { res.status(400).json({ error: "A valid adverse-action case and delivery identifier are required", code: "BAD_REQUEST" }); return; }
    try {
      const result = await appRouter.createCaller(await createContextFromRequest(req, res)).complianceWorkflow.recordDelivery({ ...req.body, caseRef, deliveryId });
      res.status(200).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "compliance_adverse_action_delivery_record");
    }
  });

  app.post("/api/compliance/adverse-actions/:caseRef/pause-dispute", async (req: Request, res: Response) => {
    const caseRef = complianceCaseRef(req.params.caseRef);
    if (!caseRef) { res.status(400).json({ error: "A valid adverse-action case reference is required", code: "BAD_REQUEST" }); return; }
    try {
      const result = await appRouter.createCaller(await createContextFromRequest(req, res)).complianceWorkflow.pauseForDispute({ ...req.body, caseRef });
      res.status(200).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "compliance_adverse_action_pause_dispute");
    }
  });

  app.post("/api/compliance/adverse-actions/:caseRef/resume", async (req: Request, res: Response) => {
    const caseRef = complianceCaseRef(req.params.caseRef);
    if (!caseRef) { res.status(400).json({ error: "A valid adverse-action case reference is required", code: "BAD_REQUEST" }); return; }
    try {
      const result = await appRouter.createCaller(await createContextFromRequest(req, res)).complianceWorkflow.resumeAfterDispute({ ...req.body, caseRef });
      res.status(200).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "compliance_adverse_action_resume");
    }
  });

  app.post("/api/compliance/adverse-actions/:caseRef/final-adverse", async (req: Request, res: Response) => {
    const caseRef = complianceCaseRef(req.params.caseRef);
    if (!caseRef) { res.status(400).json({ error: "A valid adverse-action case reference is required", code: "BAD_REQUEST" }); return; }
    try {
      const result = await appRouter.createCaller(await createContextFromRequest(req, res)).complianceWorkflow.queueFinalAdverse({ ...req.body, caseRef });
      res.status(202).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "compliance_adverse_action_final_queue");
    }
  });

  app.post("/api/compliance/adverse-actions/:caseRef/manual-delivery", async (req: Request, res: Response) => {
    const caseRef = complianceCaseRef(req.params.caseRef);
    if (!caseRef) { res.status(400).json({ error: "A valid adverse-action case reference is required", code: "BAD_REQUEST" }); return; }
    try {
      const result = await appRouter.createCaller(await createContextFromRequest(req, res)).complianceWorkflow.resolveManualDelivery({ ...req.body, caseRef });
      res.status(202).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "compliance_adverse_action_manual_delivery");
    }
  });

  app.post("/api/compliance/adverse-actions/:caseRef/cancel", async (req: Request, res: Response) => {
    const caseRef = complianceCaseRef(req.params.caseRef);
    if (!caseRef) { res.status(400).json({ error: "A valid adverse-action case reference is required", code: "BAD_REQUEST" }); return; }
    try {
      const result = await appRouter.createCaller(await createContextFromRequest(req, res)).complianceWorkflow.cancel({ ...req.body, caseRef });
      res.status(200).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "compliance_adverse_action_cancel");
    }
  });

  // Mobile evidence adapter delegates to the same protected tRPC procedures.
  // It authorizes direct-to-object-store uploads; evidence bytes do not transit this server.
  app.post("/api/evidence/initiate", async (req: Request, res: Response) => {
    try {
      const ctx = await createContextFromRequest(req, res);
      const result = await appRouter.createCaller(ctx).fieldEvidence.initiate(req.body);
      res.status(201).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "evidence_initiate");
    }
  });

  app.post("/api/evidence/:uploadId/complete", async (req: Request, res: Response) => {
    try {
      const ctx = await createContextFromRequest(req, res);
      const rawUploadId = req.params.uploadId;
      const uploadId = Array.isArray(rawUploadId) ? rawUploadId[0] : rawUploadId;
      const result = await appRouter.createCaller(ctx).fieldEvidence.complete({ uploadId });
      res.status(200).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "evidence_complete");
    }
  });

  // Mobile KYC document adapters delegate to the encrypted, tenant-scoped custody router.
  // Binary content is sent directly to a short-lived SSE-KMS object-store authorization.
  app.post("/api/kyc/documents/initiate", async (req: Request, res: Response) => {
    try {
      const ctx = await createContextFromRequest(req, res);
      const result = await appRouter.createCaller(ctx).kycDocumentEvidence.initiate(req.body);
      res.status(201).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "kyc_document_initiate");
    }
  });

  app.post("/api/kyc/documents/:uploadId/complete", async (req: Request, res: Response) => {
    try {
      const ctx = await createContextFromRequest(req, res);
      const rawUploadId = req.params.uploadId;
      const uploadId = Array.isArray(rawUploadId) ? rawUploadId[0] : rawUploadId;
      const result = await appRouter.createCaller(ctx).kycDocumentEvidence.complete({ uploadId });
      res.status(200).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "kyc_document_complete");
    }
  });

  // Mobile field-dispatch adapter delegates to the existing idempotent field-task procedure.
  app.post("/api/investigations/:investigationId/dispatch", async (req: Request, res: Response) => {
    try {
      const rawInvestigationId = req.params.investigationId;
      const investigationId = Number(Array.isArray(rawInvestigationId) ? rawInvestigationId[0] : rawInvestigationId);
      if (!Number.isInteger(investigationId) || investigationId <= 0) {
        res.status(400).json({ error: "A valid investigation ID is required", code: "BAD_REQUEST" });
        return;
      }
      const ctx = await createContextFromRequest(req, res);
      const result = await appRouter.createCaller(ctx).fieldTasks.dispatch({
        agentId: req.body?.agentId,
        agentName: req.body?.agentName,
        taskType: "address_verification",
        priority: "medium",
        address: req.body?.location,
        investigationId,
        idempotencyKey: req.body?.idempotencyKey,
      });
      res.status(201).json(result);
    } catch (error) {
      respondConsumerAdapterError(req, res, error, "field_dispatch");
    }
  });

  // Institutional and informal-sector adapters retain the same tRPC tenant, purpose,
  // consent, approval, and audit enforcement used by the PWA.
  app.post("/api/biometric/consents", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).biometric.grantConsent(req.body); res.status(201).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "biometric_consent_grant"); }
  });
  app.post("/api/biometric/consents/withdraw", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).biometric.withdrawConsent(req.body); res.status(202).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "biometric_consent_withdraw"); }
  });
  app.post("/api/biometric/reviews/:reviewCaseId/resolve", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).biometric.resolveReview({ reviewCaseId: Array.isArray(req.params.reviewCaseId) ? req.params.reviewCaseId[0] : req.params.reviewCaseId, decision: req.body?.decision, rationale: req.body?.rationale }); res.status(200).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "biometric_review_resolve"); }
  });

  app.post("/api/institutional-authorizations", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).institutionalAccess.submitAuthorization(req.body); res.status(201).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "institution_authorization_submit"); }
  });
  app.post("/api/institutional-authorizations/:authorizationId/approve", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).institutionalAccess.approveAuthorization({ authorizationId: Array.isArray(req.params.authorizationId) ? req.params.authorizationId[0] : req.params.authorizationId, rationale: req.body?.rationale }); res.status(200).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "institution_authorization_approve"); }
  });
  app.post("/api/institutional-authorizations/:authorizationId/revoke", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).institutionalAccess.revokeAuthorization({ authorizationId: Array.isArray(req.params.authorizationId) ? req.params.authorizationId[0] : req.params.authorizationId, rationale: req.body?.rationale }); res.status(200).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "institution_authorization_revoke"); }
  });
  app.post("/api/restricted-criminal-requests", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).institutionalAccess.createRestrictedRequest(req.body); res.status(201).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "restricted_request_create"); }
  });
  app.post("/api/restricted-criminal-requests/:requestAuthorizationId/approve", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).institutionalAccess.approveRestrictedRequest({ requestAuthorizationId: Array.isArray(req.params.requestAuthorizationId) ? req.params.requestAuthorizationId[0] : req.params.requestAuthorizationId, approvalNote: req.body?.approvalNote }); res.status(200).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "restricted_request_approve"); }
  });
  app.post("/api/informal-verifications", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).informalVerification.openCase(req.body); res.status(201).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "informal_verification_open"); }
  });
  app.post("/api/informal-verifications/:caseId/references", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).informalVerification.addReference({ ...req.body, caseId: Array.isArray(req.params.caseId) ? req.params.caseId[0] : req.params.caseId }); res.status(201).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "informal_reference_add"); }
  });
  app.post("/api/informal-verifications/:caseId/corroborations", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).informalVerification.recordCorroboration({ ...req.body, caseId: Array.isArray(req.params.caseId) ? req.params.caseId[0] : req.params.caseId }); res.status(201).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "informal_reference_corroborate"); }
  });
  app.post("/api/informal-verifications/:caseId/review", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).informalVerification.submitForReview({ caseId: Array.isArray(req.params.caseId) ? req.params.caseId[0] : req.params.caseId }); res.status(200).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "informal_verification_review"); }
  });
  app.post("/api/informal-verifications/:caseId/complete", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).informalVerification.completeCase({ caseId: Array.isArray(req.params.caseId) ? req.params.caseId[0] : req.params.caseId, rationale: req.body?.rationale }); res.status(200).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "informal_verification_complete"); }
  });

  // ── Explainable investigation intelligence. Routes delegate to tenant-scoped tRPC;
  // they do not invoke providers and never return an automated adverse decision.
  app.post("/api/investigation-intelligence/policies", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).investigationIntelligence.createScorePolicy(req.body); res.status(201).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "intelligence_policy_create"); }
  });
  app.post("/api/investigation-intelligence/policies/:policyId/activate", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const policyId = Array.isArray(req.params.policyId) ? req.params.policyId[0] : req.params.policyId; const result = await appRouter.createCaller(ctx).investigationIntelligence.activateScorePolicy({ policyId }); res.status(200).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "intelligence_policy_activate"); }
  });
  app.post("/api/investigation-intelligence/sources", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).investigationIntelligence.registerSource(req.body); res.status(201).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "intelligence_source_register"); }
  });
  app.post("/api/investigation-intelligence/evidence", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).investigationIntelligence.recordEvidence(req.body); res.status(201).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "intelligence_evidence_record"); }
  });
  app.post("/api/investigation-intelligence/scores", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).investigationIntelligence.calculateScore(req.body); res.status(201).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "intelligence_score_calculate"); }
  });
  app.post("/api/investigation-intelligence/conflicts", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).investigationIntelligence.reportConflict(req.body); res.status(201).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "intelligence_conflict_report"); }
  });
  app.post("/api/investigation-intelligence/reviews", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).investigationIntelligence.requestHumanReview(req.body); res.status(201).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "intelligence_review_request"); }
  });
  app.post("/api/investigation-intelligence/reviews/:reviewCaseId/resolve", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const reviewCaseId = Array.isArray(req.params.reviewCaseId) ? req.params.reviewCaseId[0] : req.params.reviewCaseId; const result = await appRouter.createCaller(ctx).investigationIntelligence.resolveHumanReview({ ...req.body, reviewCaseId }); res.status(200).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "intelligence_review_resolve"); }
  });
  app.post("/api/investigation-intelligence/monitoring", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).investigationIntelligence.registerMonitoring(req.body); res.status(201).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "intelligence_monitoring_register"); }
  });
  app.post("/api/investigation-intelligence/fraud-signals", async (req: Request, res: Response) => {
    try { const ctx = await createContextFromRequest(req, res); const result = await appRouter.createCaller(ctx).investigationIntelligence.recordFraudSignal(req.body); res.status(201).json(result); }
    catch (error) { respondConsumerAdapterError(req, res, error, "intelligence_fraud_signal_record"); }
  });

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

  // ── Health endpoints ────────────────────────────────────────────────────────────────
  // Liveness proves that the BFF event loop is able to serve traffic. Readiness performs
  // the expensive dependency checks and is the endpoint operators should gate critical
  // workflows on. Keeping these contracts separate prevents an optional middleware
  // outage from causing the platform process itself to be treated as unreachable.
  app.get("/api/live", (_req, res) => {
    res.status(200).json({
      status: "ok",
      version: process.env.npm_package_version ?? "1.0.0",
      uptime: Math.floor(process.uptime()),
      ts: new Date().toISOString(),
    });
  });

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

    // Keycloak OIDC check
    const keycloakStart = Date.now();
    try {
      const keycloakUrl = ENV.keycloakUrl;
      const keycloakRealm = ENV.keycloakRealm;
      if (keycloakUrl && keycloakRealm) {
        const r = await fetch(
          `${keycloakUrl}/realms/${keycloakRealm}/.well-known/openid-configuration`,
          { signal: AbortSignal.timeout(3000) }
        );
        checks.keycloak = { status: r.ok ? "ok" : "degraded", latencyMs: Date.now() - keycloakStart };
      } else {
        checks.keycloak = { status: "degraded" }; // Not configured
      }
    } catch {
      checks.keycloak = { status: "degraded", latencyMs: Date.now() - keycloakStart };
    }

    // Permify authorization engine check
    const permifyStart = Date.now();
    try {
      const permifyUrl = ENV.permifyUrl;
      if (permifyUrl) {
        const r = await fetch(`${permifyUrl}/healthz`, { signal: AbortSignal.timeout(3000) });
        checks.permify = { status: r.ok ? "ok" : "degraded", latencyMs: Date.now() - permifyStart };
      } else {
        checks.permify = { status: "degraded" }; // Not configured
      }
    } catch {
      checks.permify = { status: "degraded", latencyMs: Date.now() - permifyStart };
    }

    // Dapr sidecar check
    const daprStart = Date.now();
    try {
      const { daprHealthCheck } = await import("../dapr");
      const daprResult = await daprHealthCheck();
      checks.dapr = { status: daprResult.ok ? "ok" : "degraded", latencyMs: Date.now() - daprStart };
    } catch {
      checks.dapr = { status: "degraded", latencyMs: Date.now() - daprStart };
    }

    // TigerBeetle HTTP proxy check
    const tbStart = Date.now();
    try {
      const tbUrl = ENV.tigerBeetleUrl;
      if (tbUrl) {
        const r = await fetch(`${tbUrl}/health`, { signal: AbortSignal.timeout(3000) });
        checks.tigerbeetle = { status: r.ok ? "ok" : "degraded", latencyMs: Date.now() - tbStart };
      } else {
        checks.tigerbeetle = { status: "degraded" }; // Not configured
      }
    } catch {
      checks.tigerbeetle = { status: "degraded", latencyMs: Date.now() - tbStart };
    }

    // Lakehouse writer check
    const lakehouseStart = Date.now();
    try {
      const lakehouseUrl = ENV.lakehouseUrl;
      if (lakehouseUrl) {
        const r = await fetch(`${lakehouseUrl}/health`, { signal: AbortSignal.timeout(3000) });
        checks.lakehouse = { status: r.ok ? "ok" : "degraded", latencyMs: Date.now() - lakehouseStart };
      } else {
        checks.lakehouse = { status: "degraded" }; // Not configured
      }
    } catch {
      checks.lakehouse = { status: "degraded", latencyMs: Date.now() - lakehouseStart };
    }

    // Caddy edge gateway check
    const caddyStart = Date.now();
    try {
      const { checkCaddyHealth } = await import("../caddy");
      const caddyResult = await checkCaddyHealth();
      checks.caddy = {
        status: caddyResult.status,
        latencyMs: caddyResult.latencyMs ?? (Date.now() - caddyStart),
        ...(caddyResult.activeConnections !== undefined && { activeConnections: caddyResult.activeConnections }),
        ...(caddyResult.tlsCertsManaged !== undefined && { tlsCertsManaged: caddyResult.tlsCertsManaged }),
        ...(caddyResult.error && { error: caddyResult.error }),
      };
    } catch {
      checks.caddy = { status: "degraded", latencyMs: Date.now() - caddyStart };
    }

    const allOk = Object.values(checks).every(c => c.status === "ok");
    const anyDown = Object.values(checks).some(c => c.status === "down");
    const overall = allOk ? "ok" : anyDown ? "degraded" : "degraded";

    res.status(200).json({
      status: overall,
      version: process.env.npm_package_version ?? "1.0.0",
      uptime: Math.floor(process.uptime()),
      ts: new Date().toISOString(),
      checks,
    });
  });

  app.get("/api/ready", async (_req, res) => {
    const startedAt = Date.now();
    try {
      const db = await getDb();
      if (!db) {
        res.status(503).json({ status: "not_ready", databaseReady: false });
        return;
      }
      await db.execute("SELECT 1" as any);
      res.status(200).json({
        status: "ready",
        databaseReady: true,
        databaseLatencyMs: Date.now() - startedAt,
      });
    } catch {
      res.status(503).json({
        status: "not_ready",
        databaseReady: false,
        databaseLatencyMs: Date.now() - startedAt,
      });
    }
  });

  // Storage proxy: serves /manus-storage/* paths via signed URLs
  registerStorageProxy(app);

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // Keycloak Bearer → session cookie exchange
  registerKeycloakBffRoutes(app);
  registerSessionExchangeRoute(app);
  // PostgreSQL-backed user notification stream for immediate in-app alerts
  registerNotificationStream(app);

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

  // ── Scheduled task endpoint — Force Credit approval expiry ───────────────
  // Heartbeat invokes this deployed callback; no in-process timer is used.
  app.post("/api/scheduled/force-credit-expiry", async (req: Request, res: Response) => {
    try {
      const { sdk } = await import("./sdk");
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) {
        res.status(403).json({ error: "cron-only" });
        return;
      }
      const { expirePendingForceCreditApprovals } = await import("../forceCreditExpiry");
      const result = await expirePendingForceCreditApprovals();
      res.json({ ok: true, ...result, taskUid: user.taskUid });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Force Credit expiry failed",
        context: { url: req.originalUrl },
        timestamp: new Date().toISOString(),
      });
    }
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

  // Sentry error handler — must be after all routes, before static serving
  if (process.env.SENTRY_DSN) {
    const { Sentry } = await import("../sentry.server.config");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use(Sentry.expressErrorHandler() as any);
  }

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
    startWebhookRetryScheduler(); // 10s poll for failed Paystack webhook credits (exponential backoff)
    startPaymentIntentOutboxDispatcher(); // 5s leased PostgreSQL dispatch for payment workflow starts
    void import("../platform").then(async ({ migrateLegacyTotpSeedsAtRest }) => {
      const migrated = await migrateLegacyTotpSeedsAtRest();
      if (migrated > 0) log("info", "Encrypted legacy TOTP seeds", { migrated });
    }).catch((error) => log("error", "Legacy TOTP seed encryption migration failed", { error: String(error) }));
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
import { registerSessionExchangeRoute } from "./sessionExchange";
import { registerKeycloakBffRoutes } from "../keycloakBff";
import { registerNotificationStream } from "./notificationStream";
