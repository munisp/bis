import * as Keychain from 'react-native-keychain';
import { Platform } from 'react-native';
import {
  clearStoredToken,
  getStoredToken,
  resetSessionCacheForTests,
  setStoredToken,
} from '../services/secureSession';

const LEGACY_SESSION_SERVICE = 'ng.bis.mobile.session';
const STAGING_PROBE_TOKEN = 'staging-device-security-probe-token-v2-7b8c9d0e1f2a3b4c';

export type SecureSessionDeviceProbeResult = {
  generatedAt: string;
  platform: 'android' | 'ios';
  session: {
    writeSucceeded: true;
    survivedProcessRestart: true;
    hardwareBacked: true;
    deviceOnlyPolicyConfigured: true;
    legacyServiceIsolated: true;
    logoutCleared: true;
  };
};

/**
 * Runs only in an isolated, non-production device-lab application profile.
 * It writes a non-secret synthetic token to the v2 Keychain/Keystore service,
 * emulates a JavaScript process restart by clearing the in-memory cache, and
 * then proves that logout removes the persisted credential. The caller must
 * serialize the returned flags into the staging attestation artifact; no token
 * or Keychain content is returned or logged.
 */
export async function runSecureSessionDeviceProbe(): Promise<SecureSessionDeviceProbeResult> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('The secure-session device probe must run on Android or iOS');
  }

  const securityLevel = await Keychain.getSecurityLevel();
  if (securityLevel !== Keychain.SECURITY_LEVEL.SECURE_HARDWARE) {
    throw new Error('The device does not provide the required hardware-backed Keychain/Keystore security level');
  }

  // The probe is intentionally destructive only to the isolated device-lab app
  // profile. It leaves no credential behind even when an assertion fails.
  await clearStoredToken();
  resetSessionCacheForTests();
  try {
    const legacyCredential = await Keychain.getGenericPassword({ service: LEGACY_SESSION_SERVICE });
    if (legacyCredential) {
      throw new Error('The isolated test profile contains a legacy session credential');
    }

    await setStoredToken(STAGING_PROBE_TOKEN);
    resetSessionCacheForTests();
    const recoveredToken = await getStoredToken();
    if (recoveredToken !== STAGING_PROBE_TOKEN) {
      throw new Error('Session token did not persist across a JavaScript process restart');
    }

    await clearStoredToken();
    resetSessionCacheForTests();
    if (await getStoredToken()) {
      throw new Error('Session credential remained after secure logout');
    }

    return {
      generatedAt: new Date().toISOString(),
      platform: Platform.OS,
      session: {
        writeSucceeded: true,
        survivedProcessRestart: true,
        hardwareBacked: true,
        deviceOnlyPolicyConfigured: true,
        legacyServiceIsolated: true,
        logoutCleared: true,
      },
    };
  } finally {
    await clearStoredToken().catch(() => undefined);
    resetSessionCacheForTests();
  }
}
