/**
 * usePortalEventStream — subscribes to the BIS stakeholder portal SSE stream.
 *
 * Unlike the main useEventStream hook (which requires authentication), this hook
 * authenticates via a portal access token passed as a query parameter.
 *
 * Usage:
 *   const { connected, lastEvent } = usePortalEventStream({
 *     token: "abc123",
 *     onComment: (comment) => setComments(prev => [...prev, comment]),
 *     onDocument: (doc) => setDocuments(prev => [...prev, doc]),
 *   });
 *
 * The hook automatically reconnects on disconnect (exponential back-off, max 30s).
 * Falls back gracefully when SSE is unavailable (e.g., in environments that block
 * long-lived connections) — the caller should retain polling as a fallback.
 */
import { useEffect, useRef, useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PortalComment {
  id: number;
  content: string;
  authorName: string | null;
  authorRole: string | null;
  createdAt: string;
}

export interface PortalDocument {
  id: number;
  filename: string;
  mimeType: string;
  url: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
}

interface UsePortalEventStreamOptions {
  /** Portal access token (from URL ?token= param). Required to authenticate the SSE connection. */
  token: string | null;
  /** Called when a new comment is pushed from the server. */
  onComment?: (comment: PortalComment) => void;
  /** Called when a new document is pushed from the server. */
  onDocument?: (doc: PortalDocument) => void;
  /** Disable the stream entirely. Defaults to true (enabled). */
  enabled?: boolean;
}

interface UsePortalEventStreamResult {
  /** Whether the SSE connection is currently open. */
  connected: boolean;
  /** Number of reconnection attempts since last successful connection. */
  reconnectCount: number;
  /** Whether SSE is supported and the connection has been attempted. */
  sseSupported: boolean;
}

const MAX_BACKOFF_MS = 30_000;
const PORTAL_SSE_URL = "/api/v1/portal/stream";

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePortalEventStream(
  options: UsePortalEventStreamOptions
): UsePortalEventStreamResult {
  const { token, onComment, onDocument, enabled = true } = options;

  const [connected, setConnected] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);
  const [sseSupported] = useState(() => typeof EventSource !== "undefined");

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectCountRef = useRef(0);

  // Stable callbacks via refs to avoid triggering reconnects on every render
  const onCommentRef = useRef(onComment);
  const onDocumentRef = useRef(onDocument);
  useEffect(() => { onCommentRef.current = onComment; }, [onComment]);
  useEffect(() => { onDocumentRef.current = onDocument; }, [onDocument]);

  const connect = useCallback(() => {
    if (!token || !enabled || !sseSupported) return;

    // Close any existing connection
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const url = `${PORTAL_SSE_URL}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("connected", () => {
      setConnected(true);
      reconnectCountRef.current = 0;
      setReconnectCount(0);
    });

    es.addEventListener("PORTAL_COMMENT", (raw: MessageEvent) => {
      try {
        const event = JSON.parse(raw.data);
        const comment = event.payload as PortalComment;
        onCommentRef.current?.(comment);
      } catch {
        // malformed event — ignore
      }
    });

    es.addEventListener("PORTAL_DOCUMENT", (raw: MessageEvent) => {
      try {
        const event = JSON.parse(raw.data);
        const doc = event.payload as PortalDocument;
        onDocumentRef.current?.(doc);
      } catch {
        // malformed event — ignore
      }
    });

    es.onerror = () => {
      setConnected(false);
      es.close();
      esRef.current = null;

      // Exponential back-off: 1s, 2s, 4s, 8s … capped at 30s
      const delay = Math.min(
        1_000 * Math.pow(2, reconnectCountRef.current),
        MAX_BACKOFF_MS
      );
      reconnectCountRef.current += 1;
      setReconnectCount(reconnectCountRef.current);
      reconnectTimerRef.current = setTimeout(connect, delay);
    };
  }, [token, enabled, sseSupported]);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [connect]);

  return { connected, reconnectCount, sseSupported };
}
