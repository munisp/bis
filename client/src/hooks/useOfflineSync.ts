import { useState, useEffect, useCallback } from "react";

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
    if (!navigator.serviceWorker?.controller) return 0;
    return new Promise<number>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => resolve(e.data.count ?? 0);
      navigator.serviceWorker.controller?.postMessage(
        { type: "GET_QUEUE_COUNT" },
        [channel.port2]
      );
      setTimeout(() => resolve(0), 1000);
    });
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
