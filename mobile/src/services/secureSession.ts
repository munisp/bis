import * as Keychain from 'react-native-keychain';

const SESSION_SERVICE = 'ng.bis.mobile.session.v2';
const SESSION_ACCOUNT = 'access-token';

const keychainOptions = {
  service: SESSION_SERVICE,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
};

let cachedToken: string | null | undefined;

function validateToken(token: string): string {
  const normalized = token.trim();
  if (normalized.length < 16 || normalized.length > 16_384) {
    throw new Error('Refusing an invalid mobile session token');
  }
  return normalized;
}

/**
 * Reads a session token only from the device-protected Keychain/Keystore.
 * A process-local cache avoids repeated secure-storage prompts without persisting
 * sensitive material outside the operating-system credential store.
 */
export async function getStoredToken(): Promise<string | undefined> {
  if (cachedToken !== undefined) {
    return cachedToken ?? undefined;
  }

  const credential = await Keychain.getGenericPassword(keychainOptions);
  if (!credential || credential.username !== SESSION_ACCOUNT) {
    cachedToken = null;
    return undefined;
  }

  cachedToken = validateToken(credential.password);
  return cachedToken;
}

/** Stores a session under a hardware-backed, device-only credential policy. */
export async function setStoredToken(token: string): Promise<void> {
  const validated = validateToken(token);
  const stored = await Keychain.setGenericPassword(SESSION_ACCOUNT, validated, keychainOptions);
  if (!stored) {
    throw new Error('The device could not store the session token securely');
  }
  cachedToken = validated;
}

/** Removes both the persisted credential and the process-local token cache. */
export async function clearStoredToken(): Promise<void> {
  await Keychain.resetGenericPassword(keychainOptions);
  cachedToken = null;
}

/** Test-only hook: never use this in production application code. */
export function resetSessionCacheForTests(): void {
  cachedToken = undefined;
}
