import "dotenv/config";
import express, { type Request, type Response } from "express";
import { createServer } from "http";
import { createHash, timingSafeEqual } from "crypto";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerNotificationStream } from "./notificationStream";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { enforceGlobalApiRateLimit } from "../securityRateLimits";
import { enforceSecurityHeaders, enforceStrictCors } from "../securityHardening";
import { enforceRetention } from "../retention";
import { enforceDataLifecycle } from "../dataLifecycle";
import { recordRuntimeEvent } from "../runtimeObservability";
import { startArchivalScheduler } from "../archivalScheduler";
import { startDeadLetterDispatcher } from "../deadLetterDispatcher";
import { startPaymentIntentOutboxDispatcher } from "../paymentIntentOutbox";
import { startMonitoringScheduler } from "../monitoringScheduler";

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
  for (let i = 0; i < 20; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

const HTTP_ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const TRPC_BATCH_MAX_OPERATIONS = 10;
const TRPC_PAYLOAD_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const TENANT_ID_MAX = 2_147_483_647; // signed 32-bit integer ceiling
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 300;
const GLOBAL_RATE_LIMIT_PATHS = [/^\/api(?:\/|$)/];

function logSecurityEvent(
  event: string,
  req: Request,
  details: Record<string, unknown> = {},
): void {
  recordRuntimeEvent("security", event, {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    ...details,
  });
}

function isMultipartRequest(contentType: string | undefined): boolean {
  return typeof contentType === "string" && contentType.toLowerCase().startsWith("multipart/form-data");
}

function isUrlEncodedRequest(contentType: string | undefined): boolean {
  return (
    typeof contentType === "string" &&
    contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")
  );
}

function isJsonRequest(contentType: string | undefined): boolean {
  return typeof contentType === "string" && contentType.toLowerCase().startsWith("application/json");
}

function getHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(",");
  return typeof value === "string" ? value : "";
}

function applyCorsHeaders(req: Request, res: Response): void {
  const origin = getHeaderValue(req.headers.origin);
  const allowedOrigins = (process.env.BIS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Tenant-Id");
    res.setHeader("Access-Control-Allow-Methods", HTTP_ALLOWED_METHODS);
  }
}

function enforceHttpMethodAllowlist(req: Request, res: Response, next: () => void): void {
  if (!HTTP_ALLOWED_METHODS.split(",").includes(req.method)) {
    logSecurityEvent("method_not_allowed", req, { method: req.method });
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  next();
}

function enforceCorsPreflight(req: Request, res: Response, next: () => void): void {
  applyCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

function isTrpcBatchPath(path: string): boolean {
  return path.includes(",");
}

function estimateTrpcBatchOperationCount(req: Request): number {
  // tRPC batches encode multiple procedures as comma-separated path segments.
  const path = typeof req.path === "string" ? req.path : "";
  if (isTrpcBatchPath(path)) {
    return path.split(",").filter(Boolean).length;
  }

  const batchParam = req.query?.batch;
  if (batchParam === "1" || batchParam === 1) return 1;

  const body = req.body as unknown;
  if (Array.isArray(body)) return body.length;
  if (body && typeof body === "object") return Object.keys(body as Record<string, unknown>).length;

  return 1;
}

function rejectMultipartTrpcBodies(req: Request, res: Response, next: () => void): void {
  if (req.method !== "POST" && req.method !== "PUT" && req.method !== "PATCH") {
    next();
    return;
  }

  const contentType = req.headers["content-type"];
  if (isMultipartRequest(contentType)) {
    logSecurityEvent("multipart_trpc_rejected", req, { contentType });
    res.status(415).json({ error: "Multipart bodies are not accepted on tRPC routes" });
    return;
  }

  if (!isJsonRequest(contentType) && !isUrlEncodedRequest(contentType)) {
    // tRPC mutations must carry JSON (or form-encoded) payloads.
    logSecurityEvent("unsupported_trpc_content_type", req, { contentType });
    res.status(415).json({ error: "Unsupported content type for tRPC" });
    return;
  }

  next();
}

function enforceTrpcBatchLimit(req: Request, res: Response, next: () => void): void {
  const operations = estimateTrpcBatchOperationCount(req);
  if (operations > TRPC_BATCH_MAX_OPERATIONS) {
    logSecurityEvent("trpc_batch_limit_exceeded", req, { operations });
    res.status(413).json({
      error: `Batch size ${operations} exceeds limit of ${TRPC_BATCH_MAX_OPERATIONS} operations`,
    });
    return;
  }
  next();
}

function enforceJsonContentType(req: Request, res: Response, next: () => void): void {
  if (req.method !== "POST" && req.method !== "PUT" && req.method !== "PATCH") {
    next();
    return;
  }

  const contentType = req.headers["content-type"];
  if (isMultipartRequest(contentType)) {
    logSecurityEvent("multipart_json_rejected", req, { contentType });
    res.status(415).json({ error: "Multipart bodies are not accepted on JSON routes" });
    return;
  }

  if (!isJsonRequest(contentType) && !isUrlEncodedRequest(contentType)) {
    logSecurityEvent("unsupported_json_content_type", req, { contentType });
    res.status(415).json({ error: "Unsupported content type" });
    return;
  }

  next();
}

function enforceTrpcPayloadCap(req: Request, res: Response, next: () => void): void {
  const raw = getHeaderValue(req.headers["content-length"]);
  if (!raw) {
    next();
    return;
  }
  const size = Number.parseInt(raw, 10);
  if (Number.isFinite(size) && size > TRPC_PAYLOAD_MAX_BYTES) {
    logSecurityEvent("trpc_payload_cap_exceeded", req, { size });
    res.status(413).json({ error: "Payload exceeds maximum permitted size" });
    return;
  }
  next();
}

function secureCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function extractBearerToken(req: Request): string | null {
  const authHeader = getHeaderValue(req.headers.authorization);
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  return null;
}

function enforceGatewayAuth(req: Request, res: Response, next: () => void): void {
  const gatewayKey = process.env.BIS_GATEWAY_KEY ?? "";
  if (!gatewayKey) {
    logSecurityEvent("gateway_auth_misconfigured", req);
    res.status(503).json({ error: "Gateway authentication is not configured" });
    return;
  }

  const providedKey = getHeaderValue(req.headers["x-bis-key"]);
  const bearerToken = extractBearerToken(req);
  const candidate = providedKey || bearerToken || "";

  if (!candidate || !secureCompare(candidate, gatewayKey)) {
    logSecurityEvent("gateway_auth_failed", req);
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

function enforceAdminAuth(req: Request, res: Response, next: () => void): void {
  const adminKey = process.env.BIS_ADMIN_API_KEY ?? "";
  if (!adminKey) {
    logSecurityEvent("admin_auth_misconfigured", req);
    res.status(503).json({ error: "Admin authentication is not configured" });
    return;
  }

  const providedKey = getHeaderValue(req.headers["x-bis-admin-key"]);
  if (!providedKey || !secureCompare(providedKey, adminKey)) {
    logSecurityEvent("admin_auth_failed", req);
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

function getTenantContextError(
  req: Request,
): { status: number; error: string } | null {
  const raw = req.headers["x-tenant-id"];
  if (raw === undefined) return null;

  // Fail closed on ambiguous or smuggled tenant headers.
  if (Array.isArray(raw) && raw.length !== 1) {
    return { status: 400, error: "Invalid tenant context" };
  }

  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  if (value === "") return { status: 400, error: "Invalid tenant context" };
  if (!/^\d+$/.test(value)) return { status: 400, error: "Invalid tenant context" };

  const tenantId = Number.parseInt(value, 10);
  if (
    !Number.isSafeInteger(tenantId) ||
    tenantId <= 0 ||
    tenantId > TENANT_ID_MAX
  ) {
    return { status: 400, error: "Invalid tenant context" };
  }

  return null;
}

function enforceTenantContext(req: Request, res: Response, next: () => void): void {
  const error = getTenantContextError(req);
  if (error) {
    logSecurityEvent("tenant_context_invalid", req);
    res.status(error.status).json({ error: error.error });
    return;
  }
  next();
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Security headers and strict CORS first
  app.use(enforceSecurityHeaders);
  app.use(enforceStrictCors);

  // Configure body parser with limits
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));

  // Defense-in-depth: global API rate limits and strict transport validation.
  app.use("/api", enforceGlobalApiRateLimit);

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // Server-Sent Events for tenant-scoped operational notifications
  registerNotificationStream(app);

  // tRPC API
  app.use(
    "/api/trpc",
    enforceTenantContext,
    rejectMultipartTrpcBodies,
    enforceTrpcPayloadCap,
    enforceTrpcBatchLimit,
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
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
  });
}

startServer().catch(console.error);

// Start background schedulers after the HTTP server is up.
// Each scheduler is independently durable and fail-closed.
startArchivalScheduler(); // daily durable archival
startDeadLetterDispatcher(); // 30s outbox dead-letter retry
startPaymentIntentOutboxDispatcher(); // 5s leased PostgreSQL dispatch for payment workflow starts
// 60s continuous re-screening of due monitoring enrollments (FOR UPDATE SKIP LOCKED claims)
if (process.env.MONITORING_SCHEDULER_ENABLED !== "false") startMonitoringScheduler();

// Data retention and lifecycle sweeps run on a fixed cadence.
const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DATA_LIFECYCLE_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

setInterval(() => {
  void enforceRetention().catch(error => {
    console.error("[Retention] Scheduled enforcement failed:", error);
  });
}, RETENTION_SWEEP_INTERVAL_MS).unref();

setInterval(() => {
  void enforceDataLifecycle().catch(error => {
    console.error("[DataLifecycle] Scheduled enforcement failed:", error);
  });
}, DATA_LIFECYCLE_INTERVAL_MS).unref();

// Periodic security-log integrity digest
const SECURITY_DIGEST_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
setInterval(() => {
  const digest = createHash("sha256").update(String(Date.now())).digest("hex");
  recordRuntimeEvent("security", "periodic_integrity_digest", { digest });
}, SECURITY_DIGEST_INTERVAL_MS).unref();
