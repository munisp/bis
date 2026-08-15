import type { Express, Request, Response } from "express";
import type { PoolClient } from "pg";
import { getPgPool } from "../db";
import { sdk } from "./sdk";

const NOTIFICATION_CHANNEL = "bis_in_app_notifications";
const subscribers = new Map<number, Set<Response>>();
let listener: PoolClient | null = null;
let listenerReady = false;

async function ensureNotificationListener(): Promise<boolean> {
  if (listenerReady && listener) return true;
  const pool = await getPgPool();
  if (!pool) return false;
  try {
    listener = await pool.connect();
    await listener.query(`LISTEN ${NOTIFICATION_CHANNEL}`);
    listener.on("notification", (message) => {
      if (message.channel !== NOTIFICATION_CHANNEL) return;
      const userId = Number(message.payload);
      if (!Number.isInteger(userId)) return;
      const targets = subscribers.get(userId);
      if (!targets) return;
      targets.forEach((response) => {
        if (!response.writableEnded) response.write(`event: notification\ndata: {"userId":${userId}}\n\n`);
      });
    });
    listener.on("error", () => {
      listenerReady = false;
      listener?.release();
      listener = null;
    });
    listenerReady = true;
    return true;
  } catch {
    listener?.release();
    listener = null;
    listenerReady = false;
    return false;
  }
}

/**
 * Streams persisted notification insertions to the authenticated user. PostgreSQL
 * remains the source of truth; the SSE event only tells the client to refetch.
 */
export function registerNotificationStream(app: Express): void {
  app.get("/api/notifications/stream", async (req: Request, res: Response) => {
    const user = await sdk.authenticateRequest(req).catch(() => null);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!(await ensureNotificationListener())) {
      res.status(503).json({ error: "Notification stream unavailable" });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.write("event: connected\ndata: {}\n\n");

    const userSubscribers = subscribers.get(user.id) ?? new Set<Response>();
    userSubscribers.add(res);
    subscribers.set(user.id, userSubscribers);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": heartbeat\n\n");
    }, 25_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      const active = subscribers.get(user.id);
      active?.delete(res);
      if (active?.size === 0) subscribers.delete(user.id);
    });
  });
}
