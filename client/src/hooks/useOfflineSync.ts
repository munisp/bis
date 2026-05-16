import { useState, useEffect, useCallback } from "react";
import { pendingCount as idbPendingCount } from "@/lib/lexOfflineQueue";

interface OfflineSyncState {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  lastSynced: Date | null;
}

export function useOfflineSync() {
  const [state, setState] = useState<OfflineSyncState>({
    isOnline: navigator.onLine,
    pendingCount: 0,
    isSyncing: false,
    lastSynced: null,
  });

  const getQueueCount = useCallback(async () => {
    // Try service worker first; fall back to IndexedDB so pending items are never hidden
    if (navigator.serviceWorker?.controller) {
      const swCount = await new Promise<number | null>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (e) => resolve(e.data.count ?? 0);
        navigator.serviceWorker.controller?.postMessage(
          { type: "GET_QUEUE_COUNT" },
          [channel.port2]
        );
        // If SW doesn't respond in 1s, resolve null so we fall back to IDB
        setTimeout(() => resolve(null), 1000);
      });
      if (swCount !== null) return swCount;
    }
    // Fallback: read directly from IndexedDB to avoid hiding unsynced work
    try {
      return await idbPendingCount();
    } catch {
      return 0;
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setState((s) => ({ ...s, isOnline: true }));
      // Trigger background sync
      if ("serviceWorker" in navigator && "SyncManager" in window) {
        navigator.serviceWorker.ready.then((reg) => {
          (reg as any).sync?.register("bis-offline-sync").catch(() => {});
        });
      }
    };

    const handleOffline = () => {
      setState((s) => ({ ...s, isOnline: false }));
    };

    const handleSyncComplete = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setState((s) => ({
        ...s,
        isSyncing: false,
        pendingCount: 0,
        lastSynced: new Date(),
      }));
    };

    const handleSWMessage = (e: MessageEvent) => {
      if (e.data?.type === "SYNC_COMPLETE") {
        setState((s) => ({
          ...s,
          isSyncing: false,
          pendingCount: 0,
          lastSynced: new Date(),
        }));
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("sync-complete", handleSyncComplete);
    navigator.serviceWorker?.addEventListener("message", handleSWMessage);

    // Poll queue count every 10s
    const interval = setInterval(async () => {
      const count = await getQueueCount();
      setState((s) => ({ ...s, pendingCount: count }));
    }, 10000);

    // Initial count
    getQueueCount().then((count) => {
      setState((s) => ({ ...s, pendingCount: count }));
    });

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("sync-complete", handleSyncComplete);
      navigator.serviceWorker?.removeEventListener("message", handleSWMessage);
      clearInterval(interval);
    };
  }, [getQueueCount]);

  const forcSync = useCallback(async () => {
    setState((s) => ({ ...s, isSyncing: true }));
    if ("serviceWorker" in navigator && "SyncManager" in window) {
      const reg = await navigator.serviceWorker.ready;
      await (reg as any).sync?.register("bis-offline-sync").catch(() => {});
    }
  }, []);

  return { ...state, forcSync };
}
