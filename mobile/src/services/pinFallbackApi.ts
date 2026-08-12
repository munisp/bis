/**
 * pinFallbackApi.ts — Client for the Biometric Engine PIN fallback endpoints.
 *
 * Used by AccessReviewScreen (and other screens that require a biometric gate)
 * when the device has no biometric sensor or the sensor is temporarily
 * unavailable.  The PIN is never stored on the device — it is sent over HTTPS
 * to the biometric-engine service which handles Argon2id hashing, rate-limiting
 * (5 attempts / 15 min), and lock-out.
 *
 * Endpoints (biometric-engine/pin_fallback.py):
 *   POST  /pin/enrol        — enrol a new PIN for a subject
 *   POST  /pin/verify       — verify a PIN (rate-limited)
 *   DELETE /pin/{ref}       — revoke PIN
 *   GET   /pin/{ref}/status — check enrolment + lock status
 */

import { BIS_API_URL, getStoredToken } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PinEnrolRequest {
  /** Stable subject identifier (e.g. user UUID or employee ID) */
  subject_ref: string;
  /** 6-digit PIN as a string — never stored, hashed server-side with Argon2id */
  pin: string;
  /**
   * JWT from a recent successful biometric verification.
   * The biometric-engine requires this gate before allowing PIN enrolment
   * to prevent PIN-only bypass of the biometric requirement.
   */
  biometric_token: string;
}

export interface PinEnrolResponse {
  ok: boolean;
  message: string;
  enrolled_at: string; // ISO-8601 UTC
}

export interface PinVerifyRequest {
  subject_ref: string;
  pin: string;
}

export interface PinVerifyResponse {
  ok: boolean;
  /** Present when ok=false and the account is now locked */
  locked_until?: string; // ISO-8601 UTC
  /** Remaining attempts before lock-out */
  attempts_remaining?: number;
  message: string;
}

export interface PinStatusResponse {
  enrolled: boolean;
  locked: boolean;
  locked_until?: string; // ISO-8601 UTC
  attempts_used: number;
  max_attempts: number;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the base URL for the biometric-engine service.
 * In development this is proxied via the BFF; in production it is the
 * internal service URL injected via BIOMETRIC_ENGINE_URL env var.
 */
function getBiometricEngineBase(): string {
  // The BFF proxies /api/biometric/* to the biometric-engine service.
  return `${BIS_API_URL}/biometric`;
}

async function pinRequest<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getStoredToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${getBiometricEngineBase()}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      detail = json.detail ?? json.message ?? detail;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(`PIN API error: ${detail}`);
  }

  return res.json() as Promise<T>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Enrol a 6-digit PIN for a subject.
 * Requires a valid biometric_token from a recent successful biometric check
 * to prevent PIN-only bypass of the biometric gate.
 */
export async function enrollPin(req: PinEnrolRequest): Promise<PinEnrolResponse> {
  return pinRequest<PinEnrolResponse>('POST', '/pin/enrol', req);
}

/**
 * Verify a PIN for a subject.
 * Returns ok=true on success.  On failure, returns remaining attempts and
 * locked_until if the account has been locked.
 * Rate-limited to 5 attempts per 15 minutes server-side.
 */
export async function verifyPin(req: PinVerifyRequest): Promise<PinVerifyResponse> {
  return pinRequest<PinVerifyResponse>('POST', '/pin/verify', req);
}

/**
 * Revoke (delete) a PIN for a subject.
 * Requires admin or the subject themselves (enforced server-side via JWT).
 */
export async function revokePin(subjectRef: string): Promise<{ ok: boolean; message: string }> {
  return pinRequest<{ ok: boolean; message: string }>('DELETE', `/pin/${encodeURIComponent(subjectRef)}`);
}

/**
 * Check whether a PIN is enrolled and whether the account is currently locked.
 */
export async function getPinStatus(subjectRef: string): Promise<PinStatusResponse> {
  return pinRequest<PinStatusResponse>('GET', `/pin/${encodeURIComponent(subjectRef)}/status`);
}
