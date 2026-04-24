/**
 * useEventStream — subscribes to the BIS event-emitter SSE proxy.
 *
 * Usage:
 *   const { lastEvent, connected } = useEventStream({
 *     onEvent: (e) => console.log(e),
 *     eventTypes: ["ALERT_TRIGGERED", "KYC_COMPLETED"],
 *   });
 *
 * The hook automatically reconnects on disconnect (exponential back-off, max 30s).
 * It is a no-op when the user is not authenticated.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/_core/hooks/useAuth";

export interface BisEvent {
  type: string;
  subjectRef: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  payload: Record<string, unknown>;
  ts: string;
  source: string;
}

interface UseEventStreamOptions {
  /** Called for every incoming event. Stable reference recommended. */
  onEvent?: (event: BisEvent) => void;
  /** If provided, only events whose `type` is in this list are forwarded to `onEvent`. */
  eventTypes?: string[];
  /** Disable the stream entirely (e.g. on background tabs). Defaults to true. */
  enabled?: boolean;
}

interface UseEventStreamResult {
  lastEvent: BisEvent | null;
  connected: boolean;
  reconnectCount: number;
}

const SSE_URL = "/api/events/stream";
const MAX_BACKOFF_MS = 30_000;

export function useEventStream(
  options: UseEventStreamOptions = {}
): UseEventStreamResult {
  const { isAuthenticated } = useAuth();
  const { onEvent, eventTypes, enabled = true } = options;

  const [lastEvent, setLastEvent] = useState<BisEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectCountRef = useRef(0);

  const connect = useCallback(() => {
    if (!isAuthenticated || !enabled) return;
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = new EventSource(SSE_URL, { withCredentials: true });
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
      reconnectCountRef.current = 0;
      setReconnectCount(0);
    };

    es.onmessage = (raw) => {
      try {
        const event: BisEvent = JSON.parse(raw.data);
        if (!eventTypes || eventTypes.includes(event.type)) {
          setLastEvent(event);
          onEvent?.(event);
        }
      } catch {
        // malformed event — ignore
      }
    };

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
  }, [isAuthenticated, enabled, eventTypes, onEvent]);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [connect]);

  return { lastEvent, connected, reconnectCount };
}
