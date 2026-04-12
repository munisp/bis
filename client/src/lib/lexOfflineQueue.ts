/**
 * lexOfflineQueue — IndexedDB-backed offline submission queue for LEX Submit.
 *
 * When the device has no connectivity (or the BIS server is unreachable),
 * submissions are stored locally in IndexedDB. A background sync loop
 * retries every 30 seconds when the device comes back online.
 *
 * Schema:
 *   DB: lex-offline-queue  v1
 *   Store: submissions
 *     id         (auto-increment key)
 *     localRef   (string, unique index)
 *     payload    (object)
 *     status     "queued" | "syncing" | "synced" | "failed"
 *     attempts   (number)
 *     lastError  (string | null)
 *     createdAt  (number — Unix ms)
 *     syncedAt   (number | null)
 */

export interface QueuedLexSubmission {
  id?: number;
  localRef: string;
  payload: Record<string, unknown>;
  status: "queued" | "syncing" | "synced" | "failed";
  attempts: number;
  lastError: string | null;
  createdAt: number;
  syncedAt: number | null;
}

const DB_NAME = "lex-offline-queue";
const DB_VERSION = 1;
const STORE = "submissions";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("localRef", "localRef", { unique: true });
        store.createIndex("status", "status", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Enqueue a submission for offline storage. Returns the localRef. */
export async function enqueue(payload: Record<string, unknown>): Promise<string> {
  const localRef = `LEX-OFFLINE-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const entry: QueuedLexSubmission = {
    localRef,
    payload,
    status: "queued",
    attempts: 0,
    lastError: null,
    createdAt: Date.now(),
    syncedAt: null,
  };
  const db = await openDB();
  await tx(db, "readwrite", (store) => store.add(entry));
  db.close();
  return localRef;
}

/** Get all queued (not yet synced) submissions. */
export async function getPending(): Promise<QueuedLexSubmission[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readonly");
    const store = t.objectStore(STORE);
    const idx = store.index("status");
    const results: QueuedLexSubmission[] = [];
    const req = idx.openCursor(IDBKeyRange.only("queued"));
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        db.close();
        resolve(results);
      }
    };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/** Get all submissions (for the status UI). */
export async function getAll(): Promise<QueuedLexSubmission[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readonly");
    const store = t.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/** Mark a submission as synced. */
export async function markSynced(id: number): Promise<void> {
  const db = await openDB();
  const entry = await new Promise<QueuedLexSubmission>((resolve, reject) => {
    const t = db.transaction(STORE, "readonly");
    const req = t.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  entry.status = "synced";
  entry.syncedAt = Date.now();
  await tx(db, "readwrite", (store) => store.put(entry));
  db.close();
}

/** Mark a submission as failed (increments attempts). */
export async function markFailed(id: number, error: string): Promise<void> {
  const db = await openDB();
  const entry = await new Promise<QueuedLexSubmission>((resolve, reject) => {
    const t = db.transaction(STORE, "readonly");
    const req = t.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  entry.attempts += 1;
  entry.lastError = error;
  // After 5 failed attempts, mark as permanently failed
  entry.status = entry.attempts >= 5 ? "failed" : "queued";
  await tx(db, "readwrite", (store) => store.put(entry));
  db.close();
}

/** Count of pending submissions (for badge display). */
export async function pendingCount(): Promise<number> {
  const pending = await getPending();
  return pending.length;
}
