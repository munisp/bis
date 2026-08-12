/**
 * offlineQueue.ts — Offline action queue for BIS mobile app
 *
 * Uses react-native-mmkv for synchronous, persistent storage.
 * Queued actions are replayed automatically when network connectivity is restored.
 *
 * Supported action types:
 *   - access_review_decision  (approve / revoke)
 *   - insider_event_ack       (acknowledge an insider threat event)
 *   - ueba_profile_refresh    (trigger UEBA score refresh)
 */

import { MMKV } from 'react-native-mmkv';

const storage = new MMKV({ id: 'bis-offline-queue' });
const QUEUE_KEY = 'offline_actions';

export type OfflineActionType =
  | 'access_review_decision'
  | 'insider_event_ack'
  | 'ueba_profile_refresh';

export interface OfflineAction {
  id: string;
  type: OfflineActionType;
  payload: Record<string, unknown>;
  createdAt: number; // Unix ms
  retries: number;
}

// ─── Queue Management ─────────────────────────────────────────────────────────

function readQueue(): OfflineAction[] {
  try {
    const raw = storage.getString(QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as OfflineAction[];
  } catch {
    return [];
  }
}

function writeQueue(actions: OfflineAction[]): void {
  storage.set(QUEUE_KEY, JSON.stringify(actions));
}

/** Enqueue an action for later replay. Returns the action id. */
export function enqueueOfflineAction(
  type: OfflineActionType,
  payload: Record<string, unknown>,
): string {
  const id = `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const action: OfflineAction = { id, type, payload, createdAt: Date.now(), retries: 0 };
  const queue = readQueue();
  queue.push(action);
  writeQueue(queue);
  return id;
}

/** Remove a successfully replayed action from the queue. */
export function dequeueOfflineAction(id: string): void {
  const queue = readQueue().filter(a => a.id !== id);
  writeQueue(queue);
}

/** Increment retry count for a failed action. Removes it after 5 retries. */
export function markRetry(id: string): void {
  const queue = readQueue();
  const idx = queue.findIndex(a => a.id === id);
  if (idx === -1) return;
  queue[idx].retries += 1;
  if (queue[idx].retries >= 5) {
    queue.splice(idx, 1); // dead-letter after 5 retries
  }
  writeQueue(queue);
}

/** Return all pending offline actions. */
export function getPendingActions(): OfflineAction[] {
  return readQueue();
}

/** Return the number of pending offline actions. */
export function getPendingCount(): number {
  return readQueue().length;
}

/** Clear all pending offline actions (use only after successful full sync). */
export function clearQueue(): void {
  storage.delete(QUEUE_KEY);
}

// ─── Replay Engine ────────────────────────────────────────────────────────────

type ReplayHandler = (action: OfflineAction) => Promise<void>;

const handlers: Partial<Record<OfflineActionType, ReplayHandler>> = {};

/** Register a handler for a specific action type. */
export function registerReplayHandler(type: OfflineActionType, handler: ReplayHandler): void {
  handlers[type] = handler;
}

/**
 * Replay all pending offline actions.
 * Call this when the app regains network connectivity.
 * Returns { replayed, failed } counts.
 */
export async function replayOfflineQueue(): Promise<{ replayed: number; failed: number }> {
  const queue = readQueue();
  if (queue.length === 0) return { replayed: 0, failed: 0 };

  let replayed = 0;
  let failed = 0;

  for (const action of queue) {
    const handler = handlers[action.type];
    if (!handler) {
      console.warn(`[OfflineQueue] No handler registered for action type: ${action.type}`);
      markRetry(action.id);
      failed++;
      continue;
    }

    try {
      await handler(action);
      dequeueOfflineAction(action.id);
      replayed++;
    } catch (err) {
      console.warn(`[OfflineQueue] Replay failed for ${action.id} (retry ${action.retries + 1}/5):`, err);
      markRetry(action.id);
      failed++;
    }
  }

  return { replayed, failed };
}
