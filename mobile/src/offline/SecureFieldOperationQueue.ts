import NetInfo from '@react-native-community/netinfo';
import * as Keychain from 'react-native-keychain';
import RNFS from 'react-native-fs';
import { createCipheriv, createDecipheriv, randomBytes } from 'react-native-quick-crypto';
import { Buffer } from '@craftzdog/react-native-buffer';

const KEYCHAIN_SERVICE = 'bis.field-operation.encryption.v1';
const QUEUE_DIRECTORY = `${RNFS.DocumentDirectoryPath}/bis-field-operations`;
const QUEUE_PATH = `${QUEUE_DIRECTORY}/queue.v1.enc`;

type Ciphertext = { nonce: string; ciphertext: string; tag: string };
export type FieldDispatchOperation = { idempotencyKey: string; investigationId: string; agentId: string; agentName: string; location: string; createdAt: string; attempts: number; nextAttemptAt: string };

function base64(value: Uint8Array): string { return Buffer.from(value).toString('base64'); }
function bytes(value: string): Buffer { return Buffer.from(value, 'base64'); }
function operationId(): string { return randomBytes(16).toString('hex'); }

async function key(): Promise<Buffer> {
  const stored = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
  if (stored) return bytes(stored.password);
  const material = randomBytes(32);
  const written = await Keychain.setGenericPassword('bis-field-operation', base64(material), { service: KEYCHAIN_SERVICE, accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY, securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE });
  if (!written) throw new Error('A hardware-backed field-operation encryption key is required; this device cannot securely queue dispatches');
  return Buffer.from(material);
}

async function encrypt(value: unknown): Promise<Ciphertext> {
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', await key(), nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { nonce: base64(nonce), ciphertext: base64(ciphertext), tag: base64(cipher.getAuthTag()) };
}

async function decrypt<T>(value: Ciphertext): Promise<T> {
  const decipher = createDecipheriv('aes-256-gcm', await key(), bytes(value.nonce));
  decipher.setAuthTag(bytes(value.tag));
  return JSON.parse(Buffer.concat([decipher.update(bytes(value.ciphertext)), decipher.final()]).toString('utf8')) as T;
}

async function read(): Promise<FieldDispatchOperation[]> {
  if (!(await RNFS.exists(QUEUE_PATH))) return [];
  return decrypt<FieldDispatchOperation[]>(JSON.parse(await RNFS.readFile(QUEUE_PATH, 'utf8')) as Ciphertext);
}

async function write(operations: FieldDispatchOperation[]): Promise<void> {
  if (!(await RNFS.exists(QUEUE_DIRECTORY))) await RNFS.mkdir(QUEUE_DIRECTORY);
  await RNFS.writeFile(QUEUE_PATH, JSON.stringify(await encrypt(operations)), 'utf8');
}

export class SecureFieldOperationQueue {
  private draining = false;

  async enqueue(input: Omit<FieldDispatchOperation, 'idempotencyKey' | 'createdAt' | 'attempts' | 'nextAttemptAt'>): Promise<FieldDispatchOperation> {
    const operation: FieldDispatchOperation = { ...input, idempotencyKey: operationId(), createdAt: new Date().toISOString(), attempts: 0, nextAttemptAt: new Date().toISOString() };
    const operations = await read(); operations.push(operation); await write(operations); return operation;
  }

  async drain(executor: (operation: FieldDispatchOperation) => Promise<void>): Promise<{ sent: number; pending: number }> {
    if (this.draining || !(await NetInfo.fetch()).isConnected) return { sent: 0, pending: (await read()).length };
    this.draining = true;
    try {
      let sent = 0; const remaining: FieldDispatchOperation[] = [];
      for (const operation of await read()) {
        if (new Date(operation.nextAttemptAt) > new Date()) { remaining.push(operation); continue; }
        try { await executor(operation); sent++; }
        catch { const attempts = operation.attempts + 1; remaining.push({ ...operation, attempts, nextAttemptAt: new Date(Date.now() + Math.min(60_000, 1_000 * (2 ** Math.min(attempts, 6)))).toISOString() }); }
      }
      await write(remaining); return { sent, pending: remaining.length };
    } finally { this.draining = false; }
  }

  async start(executor: (operation: FieldDispatchOperation) => Promise<void>): Promise<() => void> {
    await this.drain(executor);
    return NetInfo.addEventListener(state => { if (state.isConnected && state.isInternetReachable) void this.drain(executor); });
  }
}

export const secureFieldOperationQueue = new SecureFieldOperationQueue();
