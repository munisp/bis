export type FieldDispatchInput = {
  agentId: string;
  agentName: string;
  taskType: 'address_verification' | 'biometric_capture' | 'document_collection' | 'surveillance' | 'interview';
  priority: 'low' | 'medium' | 'high' | 'critical';
  subjectName?: string;
  address?: string;
  state?: string;
  lga?: string;
  gpsLat?: number;
  gpsLng?: number;
  deadline?: string;
  instructions?: string;
  idempotencyKey: string;
};

type StoredOperation = { id: string; nonce: ArrayBuffer; ciphertext: ArrayBuffer; attempts: number; nextAttemptAt: number; createdAt: number };
const DB_NAME = 'bis-field-offline-v1';
const STORE_NAME = 'operations';
const KEY_NAME = 'aes-gcm';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Cannot open encrypted field queue'));
  });
}

async function keyFor(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
    const request = db.transaction('keys', 'readonly').objectStore('keys').get(KEY_NAME);
    request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
    request.onerror = () => reject(request.error);
  });
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction('keys', 'readwrite').objectStore('keys').put(key, KEY_NAME);
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
  return key;
}

async function all(db: IDBDatabase): Promise<StoredOperation[]> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as StoredOperation[]); request.onerror = () => reject(request.error);
  });
}

function retryAt(attempts: number): number { return Date.now() + Math.min(60_000, 1_000 * 2 ** Math.min(6, attempts)); }

export class EncryptedFieldOfflineQueue {
  async enqueue(payload: Omit<FieldDispatchInput, 'idempotencyKey'>): Promise<string> {
    if (!globalThis.crypto?.subtle || !globalThis.crypto.randomUUID) throw new Error('This browser cannot securely store offline field operations');
    const db = await openDb();
    const id = crypto.randomUUID();
    const operation: FieldDispatchInput = { ...payload, idempotencyKey: id };
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFor(db);
    const encoded = new TextEncoder().encode(JSON.stringify(operation));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(`bis-field-op|${id}`) }, key, encoded);
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put({ id, nonce: nonce.buffer, ciphertext, attempts: 0, nextAttemptAt: Date.now(), createdAt: Date.now() } satisfies StoredOperation);
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
    });
    db.close();
    return id;
  }

  async drain(executor: (operation: FieldDispatchInput) => Promise<void>): Promise<{ delivered: number; pending: number }> {
    if (!navigator.onLine) return { delivered: 0, pending: (await this.pendingCount()) };
    const db = await openDb();
    const key = await keyFor(db);
    let delivered = 0;
    for (const stored of (await all(db)).sort((a, b) => a.createdAt - b.createdAt)) {
      if (stored.nextAttemptAt > Date.now()) continue;
      try {
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(stored.nonce), additionalData: new TextEncoder().encode(`bis-field-op|${stored.id}`) }, key, stored.ciphertext);
        await executor(JSON.parse(new TextDecoder().decode(plaintext)) as FieldDispatchInput);
        await new Promise<void>((resolve, reject) => { const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(stored.id); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
        delivered++;
      } catch {
        const next = { ...stored, attempts: stored.attempts + 1, nextAttemptAt: retryAt(stored.attempts + 1) };
        await new Promise<void>((resolve, reject) => { const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(next); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
      }
    }
    db.close();
    return { delivered, pending: await this.pendingCount() };
  }

  async pendingCount(): Promise<number> { const db = await openDb(); const count = (await all(db)).length; db.close(); return count; }
}

export const encryptedFieldOfflineQueue = new EncryptedFieldOfflineQueue();
