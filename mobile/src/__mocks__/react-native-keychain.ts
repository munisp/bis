type StoredCredential = { username: string; password: string };

const credentials = new Map<string, StoredCredential>();

export const ACCESSIBLE = {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
};

export const SECURITY_LEVEL = {
  SECURE_HARDWARE: 'SECURE_HARDWARE',
};

export async function getGenericPassword(options?: { service?: string }): Promise<StoredCredential | false> {
  return credentials.get(options?.service ?? 'default') ?? false;
}

export async function setGenericPassword(
  username: string,
  password: string,
  options?: { service?: string },
): Promise<boolean> {
  credentials.set(options?.service ?? 'default', { username, password });
  return true;
}

export async function resetGenericPassword(options?: { service?: string }): Promise<boolean> {
  credentials.delete(options?.service ?? 'default');
  return true;
}

export function __resetKeychainMock(): void {
  credentials.clear();
}
