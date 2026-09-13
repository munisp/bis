import NetInfo from '@react-native-community/netinfo';
import * as Keychain from 'react-native-keychain';
import RNFS from 'react-native-fs';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'react-native-quick-crypto';
import { Buffer } from '@craftzdog/react-native-buffer';
import { evidenceApi } from '../services/api';

const KEYCHAIN_SERVICE = 'bis.field-evidence.encryption.v2';
const QUEUE_DIR = `${RNFS.DocumentDirectoryPath}/bis-field-evidence`;
const QUEUE_FILE = `${QUEUE_DIR}/queue.v1.enc`;
const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;

export type EvidenceQueueItem = {
  id: string;
  investigationId: number;
  encryptedPath: string;
  contentType: 'image/jpeg' | 'image/png' | 'application/pdf';
  sha256: string;
  contentLength: number;
  description: string;
  idempotencyKey: string;
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
};

type EncryptedValue = { nonce: string; ciphertext: string; tag: string };

function toBase64(value: Uint8Array): string { return Buffer.from(value).toString('base64'); }
function fromBase64(value: string): Buffer { return Buffer.from(value, 'base64'); }

async function ensureDirectory(): Promise<void> {
  if (!(await RNFS.exists(QUEUE_DIR))) {await RNFS.mkdir(QUEUE_DIR);}
}

async function deviceKey(): Promise<Buffer> {
  const stored = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
  if (stored) {return fromBase64(stored.password);}
  const key = randomBytes(32);
  const ok = await Keychain.setGenericPassword('bis-field-evidence', toBase64(key), {
    service: KEYCHAIN_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
  });
  if (!ok) {throw new Error('A hardware-backed evidence encryption key is required; this device cannot securely store field evidence');}
  return Buffer.from(key);
}

async function encryptBytes(plaintext: Buffer): Promise<EncryptedValue> {
  const key = await deviceKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { nonce: toBase64(nonce), ciphertext: toBase64(ciphertext), tag: toBase64(cipher.getAuthTag()) };
}

async function decryptBytes(value: EncryptedValue): Promise<Buffer> {
  const key = await deviceKey();
  const decipher = createDecipheriv('aes-256-gcm', key, fromBase64(value.nonce));
  decipher.setAuthTag(fromBase64(value.tag));
  return Buffer.concat([decipher.update(fromBase64(value.ciphertext)), decipher.final()]);
}

function eventId(): string { return randomBytes(16).toString('hex'); }
function delayMs(attempts: number): number { return Math.min(60_000, 1_000 * (2 ** Math.min(attempts, 6))); }

async function loadQueue(): Promise<EvidenceQueueItem[]> {
  if (!(await RNFS.exists(QUEUE_FILE))) {return [];}
  const raw = await RNFS.readFile(QUEUE_FILE, 'utf8');
  const encrypted = JSON.parse(raw) as EncryptedValue;
  return JSON.parse((await decryptBytes(encrypted)).toString('utf8')) as EvidenceQueueItem[];
}

async function saveQueue(items: EvidenceQueueItem[]): Promise<void> {
  await ensureDirectory();
  const encrypted = await encryptBytes(Buffer.from(JSON.stringify(items), 'utf8'));
  await RNFS.writeFile(QUEUE_FILE, JSON.stringify(encrypted), 'utf8');
}

export class SecureEvidenceQueue {
  private draining = false;

  async enqueue(input: { investigationId: number; fileUri: string; contentType: EvidenceQueueItem['contentType']; description: string }): Promise<EvidenceQueueItem> {
    const stat = await RNFS.stat(input.fileUri);
    const contentLength = Number(stat.size);
    if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_EVIDENCE_BYTES) {throw new Error('Evidence must be between 1 byte and 25 MB');}
    const original = Buffer.from(await RNFS.readFile(input.fileUri, 'base64'), 'base64');
    const sha256 = createHash('sha256').update(original).digest('hex');
    const encrypted = await encryptBytes(original);
    await ensureDirectory();
    const id = eventId();
    const encryptedPath = `${QUEUE_DIR}/${id}.bin.enc`;
    await RNFS.writeFile(encryptedPath, JSON.stringify(encrypted), 'utf8');
    const item: EvidenceQueueItem = { id, investigationId: input.investigationId, encryptedPath, contentType: input.contentType, sha256, contentLength, description: input.description, idempotencyKey: eventId(), attempts: 0, nextAttemptAt: new Date().toISOString(), createdAt: new Date().toISOString() };
    const queue = await loadQueue();
    queue.push(item);
    await saveQueue(queue);
    return item;
  }

  async sync(): Promise<{ uploaded: number; pending: number }> {
    if (this.draining) {return { uploaded: 0, pending: (await loadQueue()).length };}
    const network = await NetInfo.fetch();
    if (!network.isConnected || !network.isInternetReachable) {return { uploaded: 0, pending: (await loadQueue()).length };}
    this.draining = true;
    try {
      const queue = await loadQueue();
      const remaining: EvidenceQueueItem[] = [];
      let uploaded = 0;
      for (const item of queue) {
        if (new Date(item.nextAttemptAt) > new Date()) { remaining.push(item); continue; }
        try {
          await this.upload(item);
          await RNFS.unlink(item.encryptedPath).catch(() => undefined);
          uploaded++;
        } catch (error) {
          const attempts = item.attempts + 1;
          remaining.push({ ...item, attempts, nextAttemptAt: new Date(Date.now() + delayMs(attempts)).toISOString() });
        }
      }
      await saveQueue(remaining);
      return { uploaded, pending: remaining.length };
    } finally { this.draining = false; }
  }

  async start(): Promise<() => void> {
    await this.sync();
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable) {
        this.sync().catch(() => undefined);
      }
    });
    return unsubscribe;
  }

  async pendingCount(): Promise<number> { return (await loadQueue()).length; }

  private async upload(item: EvidenceQueueItem): Promise<void> {
    const encrypted = JSON.parse(await RNFS.readFile(item.encryptedPath, 'utf8')) as EncryptedValue;
    const plaintext = await decryptBytes(encrypted);
    const digest = createHash('sha256').update(plaintext).digest('hex');
    if (digest !== item.sha256 || plaintext.length !== item.contentLength) {throw new Error('Encrypted evidence integrity verification failed locally');}
    const session = await evidenceApi.initiate({ investigationId: item.investigationId, contentType: item.contentType, contentLength: item.contentLength, sha256: item.sha256, description: item.description, idempotencyKey: item.idempotencyKey });
    const temporaryPath = `${RNFS.CachesDirectoryPath}/bis-field-evidence-upload-${item.id}`;
    try {
      await RNFS.writeFile(temporaryPath, plaintext.toString('base64'), 'base64');
      const result = await RNFS.uploadFiles({ toUrl: session.uploadUrl, files: [{ name: 'file', filename: item.id, filepath: temporaryPath, filetype: item.contentType }], method: 'PUT', headers: session.headers, binaryStreamOnly: true }).promise;
      if (result.statusCode < 200 || result.statusCode >= 300) {throw new Error(`Evidence object upload failed with HTTP ${result.statusCode}`);}
      await evidenceApi.complete(session.uploadId);
    } finally {
      await RNFS.unlink(temporaryPath).catch(() => undefined);
    }
  }
}

export const secureEvidenceQueue = new SecureEvidenceQueue();
