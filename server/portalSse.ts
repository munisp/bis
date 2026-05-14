/**
 * Portal SSE Manager
 *
 * Manages Server-Sent Event connections for the stakeholder portal.
 * Each connection is keyed by caseId so that when a new comment or document
 * is created for a case, all connected portal sessions for that case receive
 * a push notification immediately — no polling required.
 *
 * Usage (server-side — from tRPC procedures):
 *   import { portalSseManager } from "./portalSse";
 *   portalSseManager.push(caseId, { type: "PORTAL_COMMENT", payload: comment });
 *
 * Usage (Express route — in server/_core/index.ts):
 *   const clientId = portalSseManager.register(caseId, res);
 *   req.on("close", () => portalSseManager.unregister(clientId));
 */

import type { Response } from "express";
import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PortalSseEvent {
  type: "PORTAL_COMMENT" | "PORTAL_DOCUMENT" | "PORTAL_STATUS_CHANGE";
  payload: Record<string, unknown>;
  ts: string;
}

interface PortalClient {
  id: string;
  caseId: number;
  res: Response;
  connectedAt: Date;
}

// ─── Manager ──────────────────────────────────────────────────────────────────

class PortalSseManager {
  private clients: Map<string, PortalClient> = new Map();

  /**
   * Register a new SSE client for a given caseId.
   * Returns a unique clientId that must be passed to `unregister` on disconnect.
   */
  register(caseId: number, res: Response): string {
    const clientId = crypto.randomUUID();
    this.clients.set(clientId, { id: clientId, caseId, res, connectedAt: new Date() });
    return clientId;
  }

  /**
   * Remove a client when its connection closes.
   */
  unregister(clientId: string): void {
    this.clients.delete(clientId);
  }

  /**
   * Push an event to all connected clients watching a given caseId.
   * Silently skips clients whose response stream has already ended.
   */
  push(caseId: number, event: PortalSseEvent): void {
    const data = JSON.stringify(event);
    for (const client of Array.from(this.clients.values())) {
      if (client.caseId !== caseId) continue;
      if (client.res.writableEnded) {
        this.clients.delete(client.id);
        continue;
      }
      try {
        client.res.write(`event: ${event.type}\ndata: ${data}\n\n`);
      } catch {
        // Client disconnected mid-write — clean up
        this.clients.delete(client.id);
      }
    }
  }

  /**
   * Returns the number of active connections for a given caseId.
   * Useful for logging and metrics.
   */
  connectionCount(caseId: number): number {
    let count = 0;
    for (const client of Array.from(this.clients.values())) {
      if (client.caseId === caseId && !client.res.writableEnded) count++;
    }
    return count;
  }

  /**
   * Returns total active connections across all cases.
   */
  totalConnections(): number {
    return this.clients.size;
  }
}

// Singleton — shared across the entire server process
export const portalSseManager = new PortalSseManager();
