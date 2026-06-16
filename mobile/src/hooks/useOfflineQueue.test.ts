/**
 * Tests for the useOfflineQueue hook and the underlying OfflineQueue class.
 *
 * We test the queue logic directly since the hook is a thin wrapper.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  OfflineQueue,
  StorageAdapter,
  NetworkAdapter,
  OperationExecutor,
  QueuedOperation,
  backoffMs,
  uuidv4,
  sortByPriority,
} from '../offline/OfflineQueue';
import { _resetQueueSingleton } from './useOfflineQueue';

// ─── In-memory storage adapter for tests ─────────────────────────────────────

class MemStorage implements StorageAdapter {
  private store: Map<string, string> = new Map();
  async getItem(key: string) { return this.store.get(key) ?? null; }
  async setItem(key: string, value: string) { this.store.set(key, value); }
  async removeItem(key: string) { this.store.delete(key); }
}

// ─── No-op network adapter ────────────────────────────────────────────────────

class AlwaysOnlineNetwork implements NetworkAdapter {
  async isConnected() { return true; }
  addListener(_cb: (c: boolean) => void) { return () => {}; }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

function makeQueue(executor: OperationExecutor = async () => {}) {
  return new OfflineQueue(new MemStorage(), new AlwaysOnlineNetwork(), executor);
}

function makeOp(overrides: Partial<Parameters<OfflineQueue['enqueue']>[0]> = {}) {
  return {
    type: 'investigation.create' as const,
    payload: { subject: 'Test' },
    tenantId: 'tenant-1',
    ...overrides,
  };
}

// ─── Reset singleton before each test ────────────────────────────────────────

beforeEach(() => {
  _resetQueueSingleton();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OfflineQueue.enqueue', () => {
  it('returns an operation with a generated id', async () => {
    const q = makeQueue();
    const op = await q.enqueue(makeOp());
    expect(typeof op.id).toBe('string');
    expect(op.id.length).toBeGreaterThan(0);
    expect(op.type).toBe('investigation.create');
    expect(op.attempts).toBe(0);
  });

  it('increments size after each enqueue', async () => {
    const q = makeQueue();
    expect(await q.size()).toBe(0);
    await q.enqueue(makeOp());
    expect(await q.size()).toBe(1);
    await q.enqueue(makeOp());
    expect(await q.size()).toBe(2);
  });

  it('uses NORMAL priority by default', async () => {
    const q = makeQueue();
    const op = await q.enqueue(makeOp());
    expect(op.priority).toBe('NORMAL');
  });

  it('stores the provided tenantId', async () => {
    const q = makeQueue();
    const op = await q.enqueue(makeOp({ tenantId: 'tenant-xyz' }));
    expect(op.tenantId).toBe('tenant-xyz');
  });
});

describe('OfflineQueue.remove', () => {
  it('removes an operation by id and returns true', async () => {
    const q = makeQueue();
    const op = await q.enqueue(makeOp());
    expect(await q.size()).toBe(1);
    const removed = await q.remove(op.id);
    expect(removed).toBe(true);
    expect(await q.size()).toBe(0);
  });

  it('returns false for a non-existent id', async () => {
    const q = makeQueue();
    const removed = await q.remove('does-not-exist');
    expect(removed).toBe(false);
  });
});

describe('OfflineQueue.clear', () => {
  it('removes all pending operations', async () => {
    const q = makeQueue();
    for (let i = 0; i < 5; i++) await q.enqueue(makeOp());
    expect(await q.size()).toBe(5);
    await q.clear();
    expect(await q.size()).toBe(0);
  });
});

describe('OfflineQueue.drain', () => {
  it('executes all pending operations and clears the queue', async () => {
    const executor = vi.fn().mockResolvedValue(undefined);
    const q = makeQueue(executor);
    await q.enqueue(makeOp());
    await q.enqueue(makeOp());
    const result = await q.drain();
    expect(executor).toHaveBeenCalledTimes(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(await q.size()).toBe(0);
  });

  it('retains failed operations in the queue', async () => {
    const executor = vi.fn().mockRejectedValue(new Error('network error'));
    const q = makeQueue(executor);
    await q.enqueue(makeOp({ maxAttempts: 3 }));
    const result = await q.drain();
    expect(result.failed).toBe(1);
    expect(await q.size()).toBe(1);
  });

  it('dead-letters operations that exceed maxAttempts', async () => {
    vi.useFakeTimers();
    const executor = vi.fn().mockRejectedValue(new Error('permanent failure'));
    const q = makeQueue(executor);
    await q.enqueue(makeOp({ maxAttempts: 1 }));
    // First drain: attempt 1 fails → attempts becomes 1 = maxAttempts
    await q.drain();
    // Advance time past backoff window (backoffMs(1) = 1000ms)
    vi.advanceTimersByTime(2_000);
    // Second drain: attempts >= maxAttempts → dead-letter
    const result = await q.drain();
    expect(result.deadLettered).toBe(1);
    expect(await q.size()).toBe(0);
    const dl = await q.getDeadLettered();
    expect(dl.length).toBe(1);
    vi.useRealTimers();
  });

  it('does not run concurrently when drain is already in progress', async () => {
    let resolveFirst!: () => void;
    const firstDone = new Promise<void>(res => { resolveFirst = res; });
    const executor = vi.fn().mockImplementation(async () => { await firstDone; });
    const q = makeQueue(executor);
    await q.enqueue(makeOp());

    // Start first drain (will block on executor)
    const drain1 = q.drain();
    // Start second drain immediately (should be skipped)
    const result2 = await q.drain();
    expect(result2.succeeded).toBe(0);
    expect(result2.failed).toBe(0);

    resolveFirst();
    await drain1;
    expect(executor).toHaveBeenCalledTimes(1);
  });
});

describe('sortByPriority', () => {
  it('orders CRITICAL before HIGH before NORMAL before LOW', () => {
    const ops = [
      { priority: 'LOW', enqueuedAt: '2024-01-01T00:00:00Z' },
      { priority: 'CRITICAL', enqueuedAt: '2024-01-01T00:00:01Z' },
      { priority: 'NORMAL', enqueuedAt: '2024-01-01T00:00:02Z' },
      { priority: 'HIGH', enqueuedAt: '2024-01-01T00:00:03Z' },
    ] as QueuedOperation[];
    const sorted = sortByPriority(ops);
    expect(sorted.map(o => o.priority)).toEqual(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']);
  });

  it('uses FIFO within the same priority', () => {
    const ops = [
      { priority: 'HIGH', enqueuedAt: '2024-01-01T00:00:02Z' },
      { priority: 'HIGH', enqueuedAt: '2024-01-01T00:00:01Z' },
    ] as QueuedOperation[];
    const sorted = sortByPriority(ops);
    expect(sorted[0].enqueuedAt).toBe('2024-01-01T00:00:01Z');
    expect(sorted[1].enqueuedAt).toBe('2024-01-01T00:00:02Z');
  });
});

describe('backoffMs', () => {
  it('returns 1000ms for attempt 1', () => {
    expect(backoffMs(1)).toBe(1_000);
  });
  it('doubles for each attempt', () => {
    expect(backoffMs(2)).toBe(2_000);
    expect(backoffMs(3)).toBe(4_000);
    expect(backoffMs(4)).toBe(8_000);
  });
  it('caps at 30 seconds', () => {
    expect(backoffMs(10)).toBe(30_000);
    expect(backoffMs(20)).toBe(30_000);
  });
});

describe('uuidv4', () => {
  it('generates a valid UUID v4 format', () => {
    const id = uuidv4();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuidv4()));
    expect(ids.size).toBe(100);
  });
});

describe('OfflineQueue.retryDeadLettered', () => {
  it('moves a dead-lettered operation back to the queue', async () => {
    vi.useFakeTimers();
    const executor = vi.fn().mockRejectedValue(new Error('fail'));
    const q = makeQueue(executor);
    await q.enqueue(makeOp({ maxAttempts: 1 }));
    await q.drain(); // attempt 1 fails
    vi.advanceTimersByTime(2_000); // advance past backoff
    await q.drain(); // dead-lettered
    const dl = await q.getDeadLettered();
    expect(dl.length).toBe(1);

    const retried = await q.retryDeadLettered(dl[0].id);
    expect(retried).toBe(true);
    expect(await q.size()).toBe(1);
    expect((await q.getDeadLettered()).length).toBe(0);
    vi.useRealTimers();
  });
});
