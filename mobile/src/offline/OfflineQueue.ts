/**
 * BIS Mobile — Offline Queue
 *
 * Provides a durable, priority-ordered queue of pending API operations that
 * accumulates while the device is offline and drains automatically when
 * connectivity is restored.
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────────────────────────────────────────────┐
 * │  OfflineQueue (singleton)                               │
 * │                                                         │
 * │  enqueue(op)  ──►  AsyncStorage (persisted)             │
 * │                         │                               │
 * │  NetInfo event ──►  drain()  ──►  execute ops in order  │
 * │                         │                               │
 * │                    retry with exponential backoff        │
 * └─────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * import { offlineQueue } from './OfflineQueue';
 *
 * // Enqueue a KYC submission for later sync
 * await offlineQueue.enqueue({
 *   type: 'kyc.submit',
 *   payload: { customerId: '123', bvn: '12345678901' },
 *   priority: 'HIGH',
 * });
 *
 * // The queue drains automatically when online.
 * // You can also trigger manually:
 * await offlineQueue.drain();
 * ```
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type OperationType =
  | 'kyc.submit'
  | 'kyc.rerun'
  | 'investigation.create'
  | 'investigation.update'
  | 'aml.alert.acknowledge'
  | 'sar.submit'
  | 'payment.initiate'
  | 'biometric.submit'
  | 'field_agent.sync';

export type Priority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

/** A single queued operation. */
export interface QueuedOperation {
  /** Unique identifier (UUID v4). */
  id: string;
  /** Operation type — maps to a tRPC procedure on the BIS backend. */
  type: OperationType;
  /** Arbitrary payload to be forwarded to the tRPC procedure. */
  payload: Record<string, unknown>;
  /** Priority determines drain order (CRITICAL first). */
  priority: Priority;
  /** ISO-8601 timestamp when the operation was enqueued. */
  enqueuedAt: string;
  /** Number of times the operation has been attempted. */
  attempts: number;
  /** ISO-8601 timestamp of the last attempt (undefined if never attempted). */
  lastAttemptAt?: string;
  /** Last error message (undefined if never attempted or last attempt succeeded). */
  lastError?: string;
  /** Maximum number of retry attempts before the operation is dead-lettered. */
  maxAttempts: number;
  /** Tenant ID for multi-tenant isolation. */
  tenantId: string;
}

/** Outcome of a drain attempt. */
export interface DrainResult {
  succeeded: number;
  failed: number;
  skipped: number;
  deadLettered: number;
}

/** Executor function — performs the actual API call for a queued operation. */
export type OperationExecutor = (op: QueuedOperation) => Promise<void>;

/** Storage adapter interface — allows injecting AsyncStorage or a mock. */
export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Network status adapter — allows injecting NetInfo or a mock. */
export interface NetworkAdapter {
  isConnected(): Promise<boolean>;
  addListener(callback: (isConnected: boolean) => void): () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = '@bis:offline_queue';
const DEAD_LETTER_KEY = '@bis:offline_dead_letter';

const PRIORITY_ORDER: Record<Priority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

const DEFAULT_MAX_ATTEMPTS = 5;

/** Base delay for exponential backoff in milliseconds. */
const BACKOFF_BASE_MS = 1_000;

/** Maximum backoff delay in milliseconds (30 seconds). */
const BACKOFF_MAX_MS = 30_000;

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Compute exponential backoff delay for a given attempt number. */
export function backoffMs(attempt: number): number {
  const delay = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
  return Math.min(delay, BACKOFF_MAX_MS);
}

/** Generate a UUID v4 (RFC 4122). */
export function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Sort operations by priority then by enqueuedAt (FIFO within same priority). */
export function sortByPriority(ops: QueuedOperation[]): QueuedOperation[] {
  return [...ops].sort((a, b) => {
    const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (pDiff !== 0) return pDiff;
    return a.enqueuedAt.localeCompare(b.enqueuedAt);
  });
}

// ─── OfflineQueue class ───────────────────────────────────────────────────────

export class OfflineQueue {
  private storage: StorageAdapter;
  private network: NetworkAdapter;
  private executor: OperationExecutor;
  private draining = false;
  private unsubscribeNetwork?: () => void;

  constructor(
    storage: StorageAdapter,
    network: NetworkAdapter,
    executor: OperationExecutor,
  ) {
    this.storage = storage;
    this.network = network;
    this.executor = executor;
  }

  /**
   * Start the queue — subscribe to network events and drain immediately if online.
   */
  async start(): Promise<void> {
    this.unsubscribeNetwork = this.network.addListener(async (isConnected) => {
      if (isConnected) {
        await this.drain();
      }
    });

    const isConnected = await this.network.isConnected();
    if (isConnected) {
      await this.drain();
    }
  }

  /**
   * Stop the queue — unsubscribe from network events.
   */
  stop(): void {
    this.unsubscribeNetwork?.();
    this.unsubscribeNetwork = undefined;
  }

  /**
   * Enqueue a new operation.
   *
   * @returns The enqueued operation (with generated id and metadata).
   */
  async enqueue(params: {
    type: OperationType;
    payload: Record<string, unknown>;
    priority?: Priority;
    maxAttempts?: number;
    tenantId: string;
  }): Promise<QueuedOperation> {
    const op: QueuedOperation = {
      id: uuidv4(),
      type: params.type,
      payload: params.payload,
      priority: params.priority ?? 'NORMAL',
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
      maxAttempts: params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      tenantId: params.tenantId,
    };

    const queue = await this.loadQueue();
    queue.push(op);
    await this.saveQueue(queue);
    return op;
  }

  /**
   * Drain the queue — attempt to execute all pending operations in priority order.
   *
   * Skips operations that are within their backoff window.
   * Dead-letters operations that have exceeded maxAttempts.
   */
  async drain(): Promise<DrainResult> {
    if (this.draining) {
      return { succeeded: 0, failed: 0, skipped: 0, deadLettered: 0 };
    }

    this.draining = true;
    const result: DrainResult = { succeeded: 0, failed: 0, skipped: 0, deadLettered: 0 };

    try {
      const queue = sortByPriority(await this.loadQueue());
      const remaining: QueuedOperation[] = [];

      for (const op of queue) {
        // Check if we should skip due to backoff
        if (op.lastAttemptAt && op.attempts > 0) {
          const lastAttempt = new Date(op.lastAttemptAt).getTime();
          const waitMs = backoffMs(op.attempts);
          if (Date.now() - lastAttempt < waitMs) {
            remaining.push(op);
            result.skipped++;
            continue;
          }
        }

        // Dead-letter if exceeded max attempts
        if (op.attempts >= op.maxAttempts) {
          await this.deadLetter(op);
          result.deadLettered++;
          continue;
        }

        // Attempt execution
        const updatedOp: QueuedOperation = {
          ...op,
          attempts: op.attempts + 1,
          lastAttemptAt: new Date().toISOString(),
        };

        try {
          await this.executor(updatedOp);
          result.succeeded++;
          // Do NOT push back to remaining — operation is complete
        } catch (err) {
          updatedOp.lastError = err instanceof Error ? err.message : String(err);
          remaining.push(updatedOp);
          result.failed++;
        }
      }

      await this.saveQueue(remaining);
    } finally {
      this.draining = false;
    }

    return result;
  }

  /**
   * Get all pending operations (sorted by priority).
   */
  async getPending(): Promise<QueuedOperation[]> {
    return sortByPriority(await this.loadQueue());
  }

  /**
   * Get the number of pending operations.
   */
  async size(): Promise<number> {
    const queue = await this.loadQueue();
    return queue.length;
  }

  /**
   * Remove a specific operation by ID.
   */
  async remove(id: string): Promise<boolean> {
    const queue = await this.loadQueue();
    const before = queue.length;
    const filtered = queue.filter((op) => op.id !== id);
    if (filtered.length === before) return false;
    await this.saveQueue(filtered);
    return true;
  }

  /**
   * Clear all pending operations (does NOT clear dead-letter queue).
   */
  async clear(): Promise<void> {
    await this.saveQueue([]);
  }

  /**
   * Get all dead-lettered operations.
   */
  async getDeadLettered(): Promise<QueuedOperation[]> {
    const raw = await this.storage.getItem(DEAD_LETTER_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as QueuedOperation[];
    } catch {
      return [];
    }
  }

  /**
   * Clear the dead-letter queue.
   */
  async clearDeadLetter(): Promise<void> {
    await this.storage.removeItem(DEAD_LETTER_KEY);
  }

  /**
   * Retry a dead-lettered operation by moving it back to the main queue.
   */
  async retryDeadLettered(id: string): Promise<boolean> {
    const deadLettered = await this.getDeadLettered();
    const op = deadLettered.find((o) => o.id === id);
    if (!op) return false;

    // Reset attempt count and re-enqueue
    const retried: QueuedOperation = {
      ...op,
      attempts: 0,
      lastAttemptAt: undefined,
      lastError: undefined,
      maxAttempts: op.maxAttempts + DEFAULT_MAX_ATTEMPTS,
    };

    const queue = await this.loadQueue();
    queue.push(retried);
    await this.saveQueue(queue);

    // Remove from dead-letter
    const remaining = deadLettered.filter((o) => o.id !== id);
    await this.storage.setItem(DEAD_LETTER_KEY, JSON.stringify(remaining));

    return true;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async loadQueue(): Promise<QueuedOperation[]> {
    const raw = await this.storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as QueuedOperation[];
    } catch {
      return [];
    }
  }

  private async saveQueue(queue: QueuedOperation[]): Promise<void> {
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(queue));
  }

  private async deadLetter(op: QueuedOperation): Promise<void> {
    const existing = await this.getDeadLettered();
    existing.push(op);
    await this.storage.setItem(DEAD_LETTER_KEY, JSON.stringify(existing));
  }
}
