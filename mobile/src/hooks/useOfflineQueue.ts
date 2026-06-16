/**
 * useOfflineQueue — React hook that exposes the OfflineQueue singleton
 * to React Native components.
 *
 * Usage:
 *   const { enqueue, pending, drain, remove } = useOfflineQueue();
 *
 * The hook polls queue size every 2 seconds so components stay in sync
 * with the underlying async storage-backed queue.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  OfflineQueue,
  OperationType,
  Priority,
  QueuedOperation,
  StorageAdapter,
  NetworkAdapter,
  OperationExecutor,
} from '../offline/OfflineQueue';

// ─── In-memory storage adapter (for dev/test; swap for AsyncStorage in prod) ──

class InMemoryStorage implements StorageAdapter {
  private store: Map<string, string> = new Map();
  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// ─── No-op network adapter (auto-drain disabled; banner handles reconnect) ────

class NoOpNetworkAdapter implements NetworkAdapter {
  async isConnected(): Promise<boolean> {
    return true;
  }
  addListener(_cb: (isConnected: boolean) => void): () => void {
    return () => {};
  }
}

// ─── Default executor — logs and resolves (real executor injected per-app) ────

const defaultExecutor: OperationExecutor = async (op: QueuedOperation) => {
  console.warn('[OfflineQueue] No executor configured for operation:', op.type);
};

// ─── Singleton queue instance ─────────────────────────────────────────────────

let _queue: OfflineQueue | null = null;
let _storage: InMemoryStorage | null = null;
let _network: NoOpNetworkAdapter | null = null;

function getQueue(): OfflineQueue {
  if (!_queue) {
    _storage = new InMemoryStorage();
    _network = new NoOpNetworkAdapter();
    _queue = new OfflineQueue(_storage, _network, defaultExecutor);
  }
  return _queue;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseOfflineQueueResult {
  /** Add an operation to the queue. Returns the enqueued operation. */
  enqueue: (params: {
    type: OperationType;
    payload: Record<string, unknown>;
    priority?: Priority;
    maxAttempts?: number;
    tenantId: string;
  }) => Promise<QueuedOperation>;
  /** Manually trigger a drain attempt (e.g. after network reconnect). */
  drain: () => Promise<void>;
  /** Number of pending operations in the queue. */
  pending: number;
  /** Whether the queue is currently draining. */
  isDraining: boolean;
  /** Remove a specific operation by id. */
  remove: (id: string) => Promise<boolean>;
  /** Clear all pending operations (does not clear dead-letter). */
  clear: () => Promise<void>;
  /** Refresh the pending count manually. */
  refresh: () => void;
}

export function useOfflineQueue(): UseOfflineQueueResult {
  const queue = getQueue();
  const [pending, setPending] = useState(0);
  const [isDraining, setIsDraining] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    queue.size().then(n => setPending(n));
  }, [queue]);

  // Poll queue size every 2 seconds
  useEffect(() => {
    refresh();
    intervalRef.current = setInterval(refresh, 2_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refresh]);

  const enqueue = useCallback(
    async (params: {
      type: OperationType;
      payload: Record<string, unknown>;
      priority?: Priority;
      maxAttempts?: number;
      tenantId: string;
    }): Promise<QueuedOperation> => {
      const op = await queue.enqueue(params);
      refresh();
      return op;
    },
    [queue, refresh]
  );

  const drain = useCallback(async (): Promise<void> => {
    if (isDraining) return;
    setIsDraining(true);
    try {
      await queue.drain();
    } finally {
      setIsDraining(false);
      refresh();
    }
  }, [queue, isDraining, refresh]);

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const result = await queue.remove(id);
      refresh();
      return result;
    },
    [queue, refresh]
  );

  const clear = useCallback(async (): Promise<void> => {
    await queue.clear();
    refresh();
  }, [queue, refresh]);

  return {
    enqueue,
    drain,
    pending,
    isDraining,
    remove,
    clear,
    refresh,
  };
}

/**
 * Reset the singleton queue (useful in tests).
 * @internal
 */
export function _resetQueueSingleton(): void {
  _queue = null;
  _storage = null;
  _network = null;
}
