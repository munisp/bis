import express from "express";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBreakGlassAuditHandler } from "./breakGlassAuditRoute";

const execFileAsync = promisify(execFile);
const enabled = process.env.BIS_CROSS_COMPONENT_TEST === "1";
const itWhenEnabled = enabled ? it : it.skip;

describe("gateway to BFF break-glass audit integration", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => { await close?.(); close = undefined; });

  itWhenEnabled("persists authorization, queue, and completion evidence from the real Go middleware through the signed BFF audit sink", async () => {
    const gatewayKey = "cross-component-audit-key";
    const events: string[] = [];
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const app = express();
    app.post("/v1/data/bis/authz", express.json(), (_req, res) => res.json({ result: { allow: true } }));
    const auditHandler = createBreakGlassAuditHandler({
      gatewayKey,
      getDb: async () => ({ execute } as any),
      logError: (message) => { throw new Error(message); },
    });
    app.post("/api/internal/break-glass-audit", express.raw({ type: "application/json" }), async (req, res) => {
      events.push(JSON.parse((req.body as Buffer).toString("utf8")).eventType);
      await auditHandler(req, res);
    });
    const server = createServer(app);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    close = async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); };

    try {
      await execFileAsync("go", ["test", "./insider", "-run", "^TestPrivilegedAccess_CrossComponentAuditSink$"], {
        cwd: new URL("../services/gateway", import.meta.url).pathname,
        env: {
          ...process.env,
          BIS_CROSS_COMPONENT_TEST: "1",
        BIS_CROSS_OPA_URL: `http://127.0.0.1:${port}`,
          BIS_CROSS_AUDIT_URL: `http://127.0.0.1:${port}/api/internal/break-glass-audit`,
          BIS_CROSS_AUDIT_KEY: gatewayKey,
        },
      });
    } catch (error: any) {
      const diagnostics = [error.stderr, error.stdout, error.message].filter(Boolean).join("\n");
      throw new Error(`gateway subprocess failed: ${diagnostics}`);
    }
    expect(events).toEqual(["break_glass_authorized", "break_glass_execution_queued", "break_glass_executed"]);
    expect(execute).toHaveBeenCalledTimes(6);
  }, 30_000);
});
