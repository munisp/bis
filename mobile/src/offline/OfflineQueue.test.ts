/**
 * BIS Mobile — Offline Queue Unit Tests
 *
 * Uses pure in-memory mocks for storage and network adapters.
 * No React Native dependencies required.
 */

import {
  OfflineQueue,
  QueuedOperation,
  StorageAdapter,
  NetworkAdapter,
  OperationExecutor,
  backoffMs,
  sortByPriority,
  uuidv4,
} from './OfflineQueue';

// ─── Mock adapters ────────────────────────────────────────────────────────────

class MemoryStorage implements StorageAdapter {
  private store: Record<string, string> = {};

  async getItem(key: string): Promise<string | null> {
    return this.store[key] ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store[key] = value;
  }

  async removeItem(key: string): Promise<void> {
    delete this.store[key];
  }
}

class MockNetwork implements NetworkAdapter {
  private connected: boolean;
  private listeners: Array<(isConnected: boolean) => void> = [];

  constructor(connected = true) {
    this.connected = connected;
  }

  async isConnected(): Promise<boolean> {
    return this.connected;
  }

  addListener(callback: (isConnected: boolean) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  setConnected(value: boolean): void {
    this.connected = value;
    this.listeners.forEach((l) => l(value));
  }
}

function makeQueue(
  executor: OperationExecutor,
  connected = true,
): { queue: OfflineQueue; storage: MemoryStorage; network: MockNetwork } {
  const storage = new MemoryStorage();
  const network = new MockNetwork(connected);
  const queue = new OfflineQueue(storage, network, executor);
  return { queue, storage, network };
}

const noop: OperationExecutor = async () => {};
const failing: OperationExecutor = async () => {
  throw new Error('network error');
};

// ─── Utility tests ────────────────────────────────────────────────────────────

describe('backoffMs', () => {
  it('returns 1000ms for attempt 1', () => {
    expect(backoffMs(1)).toBe(1000);
  });

  it('doubles for each attempt', () => {
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(3)).toBe(4000);
    expect(backoffMs(4)).toBe(8000);
  });

  it('caps at 30000ms', () => {
    expect(backoffMs(10)).toBe(30000);
    expect(backoffMs(100)).toBe(30000);
  });
});

describe('uuidv4', () => {
  it('generates a valid UUID v4 format', () => {
    const id = uuidv4();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuidv4()));
    expect(ids.size).toBe(100);
  });
});

describe('sortByPriority', () => {
  const makeOp = (priority: QueuedOperation['priority'], enqueuedAt: string): QueuedOperation => ({
    id: uuidv4(),
    type: 'kyc.submit',
    payload: {},
    priority,
    enqueuedAt,
    attempts: 0,
    maxAttempts: 5,
    tenantId: 'tenant-001',
  });

  it('sorts CRITICAL before HIGH before NORMAL before LOW', () => {
    const ops = [
      makeOp('LOW', '2026-01-01T00:00:00Z'),
      makeOp('NORMAL', '2026-01-01T00:00:01Z'),
      makeOp('CRITICAL', '2026-01-01T00:00:02Z'),
      makeOp('HIGH', '2026-01-01T00:00:03Z'),
    ];
    const sorted = sortByPriority(ops);
    expect(sorted[0].priority).toBe('CRITICAL');
    expect(sorted[1].priority).toBe('HIGH');
    expect(sorted[2].priority).toBe('NORMAL');
    expect(sorted[3].priority).toBe('LOW');
  });

  it('preserves FIFO order within same priority', () => {
    const ops = [
      makeOp('HIGH', '2026-01-01T00:00:02Z'),
      makeOp('HIGH', '2026-01-01T00:00:01Z'),
      makeOp('HIGH', '2026-01-01T00:00:03Z'),
    ];
    const sorted = sortByPriority(ops);
    expect(sorted[0].enqueuedAt).toBe('2026-01-01T00:00:01Z');
    expect(sorted[1].enqueuedAt).toBe('2026-01-01T00:00:02Z');
    expect(sorted[2].enqueuedAt).toBe('2026-01-01T00:00:03Z');
  });

  it('does not mutate the original array', () => {
    const ops = [makeOp('LOW', '2026-01-01T00:00:00Z'), makeOp('HIGH', '2026-01-01T00:00:01Z')];
    const original = [...ops];
    sortByPriority(ops);
    expect(ops[0].priority).toBe(original[0].priority);
  });
});

// ─── OfflineQueue tests ───────────────────────────────────────────────────────

describe('OfflineQueue.enqueue', () => {
  it('enqueues an operation and assigns an id', async () => {
    const { queue } = makeQueue(noop);
    const op = await queue.enqueue({
      type: 'kyc.submit',
      payload: { bvn: '12345678901' },
      tenantId: 'tenant-001',
    });
    expect(op.id).toBeTruthy();
    expect(op.type).toBe('kyc.submit');
    expect(op.attempts).toBe(0);
    expect(op.priority).toBe('NORMAL');
  });

  it('persists the operation across queue instances', async () => {
    const storage = new MemoryStorage();
    const network = new MockNetwork(false);
    const q1 = new OfflineQueue(storage, network, noop);
    await q1.enqueue({ type: 'kyc.submit', payload: {}, tenantId: 'tenant-001' });

    const q2 = new OfflineQueue(storage, network, noop);
    expect(await q2.size()).toBe(1);
  });

  it('respects custom priority', async () => {
    const { queue } = makeQueue(noop);
    const op = await queue.enqueue({
      type: 'payment.initiate',
      payload: {},
      priority: 'CRITICAL',
      tenantId: 'tenant-001',
    });
    expect(op.priority).toBe('CRITICAL');
  });

  it('respects custom maxAttempts', async () => {
    const { queue } = makeQueue(noop);
    const op = await queue.enqueue({
      type: 'kyc.submit',
      payload: {},
      maxAttempts: 3,
      tenantId: 'tenant-001',
    });
    expect(op.maxAttempts).toBe(3);
  });
});

describe('OfflineQueue.drain', () => {
  it('executes all operations and empties the queue on success', async () => {
    const executed: string[] = [];
    const executor: OperationExecutor = async (op) => {
      executed.push(op.type);
    };
    const { queue } = makeQueue(executor);
    await queue.enqueue({ type: 'kyc.submit', payload: {}, tenantId: 'tenant-001' });
    await queue.enqueue({ type: 'aml.alert.acknowledge', payload: {}, tenantId: 'tenant-001' });

    const result = await queue.drain();
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(await queue.size()).toBe(0);
    expect(executed).toContain('kyc.submit');
    expect(executed).toContain('aml.alert.acknowledge');
  });

  it('keeps failed operations in the queue', async () => {
    const { queue } = makeQueue(failing);
    await queue.enqueue({ type: 'kyc.submit', payload: {}, tenantId: 'tenant-001' });

    const result = await queue.drain();
    expect(result.failed).toBe(1);
    expect(await queue.size()).toBe(1);
  });

  it('increments attempt count on failure', async () => {
    const { queue } = makeQueue(failing);
    await queue.enqueue({ type: 'kyc.submit', payload: {}, tenantId: 'tenant-001' });

    await queue.drain();
    const pending = await queue.getPending();
    expect(pending[0].attempts).toBe(1);
    expect(pending[0].lastError).toBe('network error');
  });

  it('dead-letters operations that exceed maxAttempts', async () => {
    const { queue } = makeQueue(failing);
    await queue.enqueue({ type: 'kyc.submit', payload: {}, maxAttempts: 2, tenantId: 'tenant-001' });

    // First drain: attempt 1
    await queue.drain();
    // Manually reset lastAttemptAt to bypass backoff
    const storage = (queue as any).storage as MemoryStorage;
    const raw = await storage.getItem('@bis:offline_queue');
    const ops = JSON.parse(raw!) as QueuedOperation[];
    ops[0].lastAttemptAt = new Date(Date.now() - 60_000).toISOString();
    await storage.setItem('@bis:offline_queue', JSON.stringify(ops));

    // Second drain: attempt 2 (reaches maxAttempts)
    await queue.drain();
    // Manually reset again
    const raw2 = await storage.getItem('@bis:offline_queue');
    if (raw2) {
      const ops2 = JSON.parse(raw2) as QueuedOperation[];
      if (ops2.length > 0) {
        ops2[0].lastAttemptAt = new Date(Date.now() - 60_000).toISOString();
        await storage.setItem('@bis:offline_queue', JSON.stringify(ops2));
      }
    }

    // Third drain: should dead-letter
    const result = await queue.drain();
    expect(result.deadLettered).toBe(1);
    expect(await queue.size()).toBe(0);

    const deadLettered = await queue.getDeadLettered();
    expect(deadLettered.length).toBe(1);
    expect(deadLettered[0].type).toBe('kyc.submit');
  });

  it('drains in priority order', async () => {
    const order: string[] = [];
    const executor: OperationExecutor = async (op) => {
      order.push(op.priority);
    };
    const { queue } = makeQueue(executor);

    await queue.enqueue({ type: 'kyc.submit', payload: {}, priority: 'LOW', tenantId: 'tenant-001' });
    await queue.enqueue({ type: 'kyc.submit', payload: {}, priority: 'CRITICAL', tenantId: 'tenant-001' });
    await queue.enqueue({ type: 'kyc.submit', payload: {}, priority: 'NORMAL', tenantId: 'tenant-001' });
    await queue.enqueue({ type: 'kyc.submit', payload: {}, priority: 'HIGH', tenantId: 'tenant-001' });

    await queue.drain();
    expect(order).toEqual(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']);
  });

  it('returns immediately if already draining', async () => {
    let drainCount = 0;
    const slowExecutor: OperationExecutor = async () => {
      drainCount++;
      await new Promise((r) => setTimeout(r, 50));
    };
    const { queue } = makeQueue(slowExecutor);
    await queue.enqueue({ type: 'kyc.submit', payload: {}, tenantId: 'tenant-001' });

    // Start two drains concurrently
    const [r1, r2] = await Promise.all([queue.drain(), queue.drain()]);
    // One should have done work, the other should have returned immediately
    expect(r1.succeeded + r2.succeeded).toBe(1);
  });
});

describe('OfflineQueue.remove', () => {
  it('removes an operation by id', async () => {
    const { queue } = makeQueue(noop);
    const op = await queue.enqueue({ type: 'kyc.submit', payload: {}, tenantId: 'tenant-001' });
    expect(await queue.size()).toBe(1);

    const removed = await queue.remove(op.id);
    expect(removed).toBe(true);
    expect(await queue.size()).toBe(0);
  });

  it('returns false for non-existent id', async () => {
    const { queue } = makeQueue(noop);
    const removed = await queue.remove('non-existent-id');
    expect(removed).toBe(false);
  });
});

describe('OfflineQueue.clear', () => {
  it('clears all pending operations', async () => {
    const { queue } = makeQueue(noop);
    await queue.enqueue({ type: 'kyc.submit', payload: {}, tenantId: 'tenant-001' });
    await queue.enqueue({ type: 'payment.initiate', payload: {}, tenantId: 'tenant-001' });
    await queue.clear();
    expect(await queue.size()).toBe(0);
  });
});

describe('OfflineQueue.retryDeadLettered', () => {
  it('moves a dead-lettered operation back to the main queue', async () => {
    const { queue } = makeQueue(failing);
    await queue.enqueue({ type: 'kyc.submit', payload: {}, maxAttempts: 1, tenantId: 'tenant-001' });

    // Drain to dead-letter it (attempt 1 fails, maxAttempts=1 so dead-letter on next drain)
    await queue.drain();
    // Reset backoff
    const storage = (queue as any).storage as MemoryStorage;
    const raw = await storage.getItem('@bis:offline_queue');
    if (raw) {
      const ops = JSON.parse(raw) as QueuedOperation[];
      if (ops.length > 0) {
        ops[0].lastAttemptAt = new Date(Date.now() - 60_000).toISOString();
        await storage.setItem('@bis:offline_queue', JSON.stringify(ops));
      }
    }
    await queue.drain(); // Dead-letters it

    const deadLettered = await queue.getDeadLettered();
    expect(deadLettered.length).toBe(1);

    const retried = await queue.retryDeadLettered(deadLettered[0].id);
    expect(retried).toBe(true);
    expect(await queue.size()).toBe(1);
    expect((await queue.getDeadLettered()).length).toBe(0);
  });

  it('returns false for non-existent dead-letter id', async () => {
    const { queue } = makeQueue(noop);
    const result = await queue.retryDeadLettered('non-existent');
    expect(result).toBe(false);
  });
});

describe('OfflineQueue network integration', () => {
  it('drains automatically when network comes online', async () => {
    const executed: string[] = [];
    const executor: OperationExecutor = async (op) => {
      executed.push(op.id);
    };
    const { queue, network } = makeQueue(executor, false);
    await queue.start();

    await queue.enqueue({ type: 'kyc.submit', payload: {}, tenantId: 'tenant-001' });
    expect(executed.length).toBe(0); // Still offline

    network.setConnected(true);
    // Give async drain a tick to complete
    await new Promise((r) => setTimeout(r, 10));
    expect(executed.length).toBe(1);

    queue.stop();
  });
});
