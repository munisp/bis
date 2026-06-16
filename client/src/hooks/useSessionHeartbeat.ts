/**
 * useSessionHeartbeat.ts
 *
 * Pings the server's `sessions.touch` mutation every HEARTBEAT_MS milliseconds
 * while the browser tab is visible and the user is authenticated.
 *
 * This keeps `userSessions.lastActiveAt` fresh so the 8-hour inactivity
 * enforcement in sdk.ts does not prematurely expire sessions for users who
 * are actively working in the app.
 */

import { useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc';

const HEARTBEAT_MS = 5 * 60 * 1000; // 5 minutes

export function useSessionHeartbeat(isAuthenticated: boolean) {
  const touch = trpc.sessions.touch.useMutation();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    const ping = () => {
      // Only ping when the tab is visible to avoid unnecessary requests
      if (document.visibilityState === 'visible') {
        touch.mutate();
      }
    };

    // Immediate ping on mount
    ping();

    timerRef.current = setInterval(ping, HEARTBEAT_MS);

    // Also ping when the tab becomes visible after being hidden
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        ping();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);
}
