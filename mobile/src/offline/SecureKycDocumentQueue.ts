import NetInfo from '@react-native-community/netinfo';
import * as Keychain from 'react-native-keychain';
import RNFS from 'react-native-fs';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'react-native-quick-crypto';
import { Buffer } from '@craftzdog/react-native-buffer';
import { kycDocumentEvidenceApi } from '../services/api';

const KEYCHAIN_SERVICE = 'bis.kyc-document.encryption.v1';
const QUEUE_DIR = `${RNFS.DocumentDirectoryPath}/bis-kyc-documents`;
const QUEUE_FILE = `${QUEUE_DIR}/queue.v1.enc`;
const MAX_KYC_DOCUMENT_BYTES = 5 * 1024 * 1024;

export type KycDocumentType =
  | 'nin_slip'
  | 'passport'
  | 'drivers_license'
  | 'voters_card'
  | 'utility_bill'
  | 'bank_statement'
  | 'cac_certificate'
  | 'other';

export type KycDocumentQueueItem = {
  id: string;
  kycRecordId: number;
  documentType: KycDocumentType;
  encryptedPath: string;
  contentType: 'image/jpeg' | 'image/png';
  sha256: string;
  contentLength: number;
  idempotencyKey: string;
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
};

type EncryptedValue = { nonce: string; ciphertext: string; tag: string };

function toBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

function fromBase64(value: string): Buffer {
  return Buffer.from(value, 'base64');
}

function randomId(): string {
  return randomBytes(16).toString('hex');
}

function delayMs(attempts: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6));
}

async function ensureDirectory(): Promise<void> {
  if (!(await RNFS.exists(QUEUE_DIR))) {
    await RNFS.mkdir(QUEUE_DIR);
  }
}

async function cleanupStalePlaintextUploads(): Promise<void> {
  const entries = await RNFS.readDir(RNFS.CachesDirectoryPath).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.name.startsWith('bis-kyc-upload-'))
      .map((entry) => RNFS.unlink(entry.path).catch(() => undefined)),
  );
}

async function deviceKey(): Promise<Buffer> {
  const existing = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
  if (existing) {
    return fromBase64(existing.password);
  }
  const key = randomBytes(32);
  const stored = await Keychain.setGenericPassword('bis-kyc-document', toBase64(key), {
    service: KEYCHAIN_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
  });
  if (!stored) {
    throw new Error('A hardware-backed key is required before KYC documents can be captured offline');
  }
  return Buffer.from(key);
}

async function encrypt(value: Buffer): Promise<EncryptedValue> {
  const key = await deviceKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return { nonce: toBase64(nonce), ciphertext: toBase64(ciphertext), tag: toBase64(cipher.getAuthTag()) };
}

async function decrypt(value: EncryptedValue): Promise<Buffer> {
  const key = await deviceKey();
  const decipher = createDecipheriv('aes-256-gcm', key, fromBase64(value.nonce));
  decipher.setAuthTag(fromBase64(value.tag));
  return Buffer.concat([decipher.update(fromBase64(value.ciphertext)), decipher.final()]);
}

async function loadQueue(): Promise<KycDocumentQueueItem[]> {
  if (!(await RNFS.exists(QUEUE_FILE))) {
    return [];
  }
  const encrypted = JSON.parse(await RNFS.readFile(QUEUE_FILE, 'utf8')) as EncryptedValue;
  return JSON.parse((await decrypt(encrypted)).toString('utf8')) as KycDocumentQueueItem[];
}

async function saveQueue(items: KycDocumentQueueItem[]): Promise<void> {
  await ensureDirectory();
  const encrypted = await encrypt(Buffer.from(JSON.stringify(items), 'utf8'));
  await RNFS.writeFile(QUEUE_FILE, JSON.stringify(encrypted), 'utf8');
}

export class SecureKycDocumentQueue {
  private draining = false;

  async enqueue(input: {
    kycRecordId: number;
    documentType: KycDocumentType;
    fileUri: string;
    contentType: KycDocumentQueueItem['contentType'];
  }): Promise<KycDocumentQueueItem> {
    const stat = await RNFS.stat(input.fileUri);
    const contentLength = Number(stat.size);
    if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_KYC_DOCUMENT_BYTES) {
      throw new Error('KYC documents must be between 1 byte and 5 MB');
    }

    const original = Buffer.from(await RNFS.readFile(input.fileUri, 'base64'), 'base64');
    const sha256 = createHash('sha256').update(original).digest('hex');
    const encrypted = await encrypt(original);
    await ensureDirectory();
    const id = randomId();
    const encryptedPath = `${QUEUE_DIR}/${id}.bin.enc`;
    await RNFS.writeFile(encryptedPath, JSON.stringify(encrypted), 'utf8');
    // The screen imports a private document-directory copy before enqueueing. Delete
    // that plaintext copy only after the encrypted ciphertext is durable.
    await RNFS.unlink(input.fileUri).catch(() => undefined);

    const item: KycDocumentQueueItem = {
      id,
      kycRecordId: input.kycRecordId,
      documentType: input.documentType,
      encryptedPath,
      contentType: input.contentType,
      sha256,
      contentLength,
      idempotencyKey: randomId(),
      attempts: 0,
      nextAttemptAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    const queue = await loadQueue();
    queue.push(item);
    await saveQueue(queue);
    return item;
  }

  async pendingCount(): Promise<number> {
    return (await loadQueue()).length;
  }

  async sync(): Promise<{ uploaded: number; pending: number }> {
    if (this.draining) {
      return { uploaded: 0, pending: (await loadQueue()).length };
    }
    const network = await NetInfo.fetch();
    if (!network.isConnected || !network.isInternetReachable) {
      return { uploaded: 0, pending: (await loadQueue()).length };
    }

    this.draining = true;
    try {
      const queue = await loadQueue();
      const remaining: KycDocumentQueueItem[] = [];
      let uploaded = 0;
      for (const item of queue) {
        if (new Date(item.nextAttemptAt) > new Date()) {
          remaining.push(item);
          continue;
        }
        try {
          await this.upload(item);
          await RNFS.unlink(item.encryptedPath).catch(() => undefined);
          uploaded += 1;
        } catch {
          const attempts = item.attempts + 1;
          remaining.push({
            ...item,
            attempts,
            nextAttemptAt: new Date(Date.now() + delayMs(attempts)).toISOString(),
          });
        }
      }
      await saveQueue(remaining);
      return { uploaded, pending: remaining.length };
    } finally {
      this.draining = false;
    }
  }

  async start(): Promise<() => void> {
    await cleanupStalePlaintextUploads();
    await this.sync();
    return NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable) {
        this.sync().catch(() => undefined);
      }
    });
  }

  private async upload(item: KycDocumentQueueItem): Promise<void> {
    const encrypted = JSON.parse(await RNFS.readFile(item.encryptedPath, 'utf8')) as EncryptedValue;
    const plaintext = await decrypt(encrypted);
    const digest = createHash('sha256').update(plaintext).digest('hex');
    if (digest !== item.sha256 || plaintext.length !== item.contentLength) {
      throw new Error('KYC document integrity verification failed locally');
    }

    const session = await kycDocumentEvidenceApi.initiate({
      kycRecordId: item.kycRecordId,
      documentType: item.documentType,
      contentType: item.contentType,
      contentLength: item.contentLength,
      sha256: item.sha256,
      description: `${item.documentType} KYC document`,
      idempotencyKey: item.idempotencyKey,
    });
    const temporaryPath = `${RNFS.CachesDirectoryPath}/bis-kyc-upload-${item.id}`;
    try {
      await RNFS.writeFile(temporaryPath, plaintext.toString('base64'), 'base64');
      const result = await RNFS.uploadFiles({
        toUrl: session.uploadUrl,
        files: [{ name: 'file', filename: item.id, filepath: temporaryPath, filetype: item.contentType }],
        method: 'PUT',
        headers: session.headers,
        binaryStreamOnly: true,
      }).promise;
      if (result.statusCode < 200 || result.statusCode >= 300) {
        throw new Error(`KYC document upload failed with HTTP ${result.statusCode}`);
      }
      await kycDocumentEvidenceApi.complete(session.uploadId);
    } finally {
      await RNFS.unlink(temporaryPath).catch(() => undefined);
    }
  }
}

export const secureKycDocumentQueue = new SecureKycDocumentQueue();
