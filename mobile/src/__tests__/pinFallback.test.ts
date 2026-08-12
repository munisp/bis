/**
 * pinFallback.test.ts — Unit tests for PIN fallback API client and hook logic.
 *
 * These tests run in a Node/jsdom environment (no native modules required).
 * They mock the fetch API and verify the pinFallbackApi functions behave
 * correctly for success, failure, rate-limit, and lock-out scenarios.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock react-native-mmkv (used by api.ts) ─────────────────────────────────
vi.mock('react-native-mmkv', () => {
  class MMKV {
    getString() { return 'mock-jwt-token'; }
    set() {}
    delete() {}
  }
  return { MMKV };
});

// ─── Mock global fetch ────────────────────────────────────────────────────────
const mockFetch = vi.fn();
global.fetch = mockFetch;

// ─── Import under test ────────────────────────────────────────────────────────
import {
  enrollPin,
  verifyPin,
  revokePin,
  getPinStatus,
} from '../services/pinFallbackApi';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('pinFallbackApi', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── enrollPin ──────────────────────────────────────────────────────────────

  describe('enrollPin', () => {
    it('sends POST /pin/enrol with correct body and returns ok=true on success', async () => {
      const responseBody = {
        ok: true,
        message: 'PIN enrolled successfully',
        enrolled_at: '2026-06-29T04:00:00.000Z',
      };
      mockFetch.mockReturnValueOnce(mockResponse(200, responseBody));

      const result = await enrollPin({
        subject_ref: 'user-abc-123',
        pin: '123456',
        biometric_token: 'bio-jwt-xyz',
      });

      expect(result.ok).toBe(true);
      expect(result.enrolled_at).toBe('2026-06-29T04:00:00.000Z');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/pin/enrol');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body.subject_ref).toBe('user-abc-123');
      expect(body.pin).toBe('123456');
      expect(body.biometric_token).toBe('bio-jwt-xyz');
    });

    it('throws on HTTP 400 error', async () => {
      mockFetch.mockReturnValueOnce(
        mockResponse(400, { detail: 'PIN must be 6 digits' }),
      );
      await expect(
        enrollPin({ subject_ref: 'u1', pin: '12', biometric_token: 'tok' }),
      ).rejects.toThrow('PIN must be 6 digits');
    });

    it('throws on HTTP 401 (invalid biometric token)', async () => {
      mockFetch.mockReturnValueOnce(
        mockResponse(401, { detail: 'Invalid biometric token' }),
      );
      await expect(
        enrollPin({ subject_ref: 'u1', pin: '123456', biometric_token: 'bad' }),
      ).rejects.toThrow('Invalid biometric token');
    });
  });

  // ── verifyPin ──────────────────────────────────────────────────────────────

  describe('verifyPin', () => {
    it('returns ok=true on correct PIN', async () => {
      mockFetch.mockReturnValueOnce(
        mockResponse(200, { ok: true, message: 'PIN verified' }),
      );
      const result = await verifyPin({ subject_ref: 'u1', pin: '654321' });
      expect(result.ok).toBe(true);
    });

    it('returns ok=false with attempts_remaining on wrong PIN', async () => {
      mockFetch.mockReturnValueOnce(
        mockResponse(200, {
          ok: false,
          message: 'Incorrect PIN',
          attempts_remaining: 3,
        }),
      );
      const result = await verifyPin({ subject_ref: 'u1', pin: '000000' });
      expect(result.ok).toBe(false);
      expect(result.attempts_remaining).toBe(3);
    });

    it('returns ok=false with locked_until when account is locked', async () => {
      const lockedUntil = '2026-06-29T04:15:00.000Z';
      mockFetch.mockReturnValueOnce(
        mockResponse(200, {
          ok: false,
          message: 'Account locked',
          locked_until: lockedUntil,
          attempts_remaining: 0,
        }),
      );
      const result = await verifyPin({ subject_ref: 'u1', pin: '111111' });
      expect(result.ok).toBe(false);
      expect(result.locked_until).toBe(lockedUntil);
    });

    it('throws on HTTP 429 rate-limit', async () => {
      mockFetch.mockReturnValueOnce(
        mockResponse(429, { detail: 'Too many requests' }),
      );
      await expect(
        verifyPin({ subject_ref: 'u1', pin: '123456' }),
      ).rejects.toThrow('Too many requests');
    });

    it('throws on HTTP 404 (subject not enrolled)', async () => {
      mockFetch.mockReturnValueOnce(
        mockResponse(404, { detail: 'Subject not enrolled' }),
      );
      await expect(
        verifyPin({ subject_ref: 'unknown', pin: '123456' }),
      ).rejects.toThrow('Subject not enrolled');
    });
  });

  // ── revokePin ──────────────────────────────────────────────────────────────

  describe('revokePin', () => {
    it('sends DELETE /pin/{ref} and returns ok=true', async () => {
      mockFetch.mockReturnValueOnce(
        mockResponse(200, { ok: true, message: 'PIN revoked' }),
      );
      const result = await revokePin('user-abc-123');
      expect(result.ok).toBe(true);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/pin/user-abc-123');
      expect(init.method).toBe('DELETE');
    });

    it('URL-encodes special characters in subject_ref', async () => {
      mockFetch.mockReturnValueOnce(
        mockResponse(200, { ok: true, message: 'PIN revoked' }),
      );
      await revokePin('user@example.com');
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('user%40example.com');
    });
  });

  // ── getPinStatus ───────────────────────────────────────────────────────────

  describe('getPinStatus', () => {
    it('returns enrolled=true, locked=false for a healthy enrolled subject', async () => {
      mockFetch.mockReturnValueOnce(
        mockResponse(200, {
          enrolled: true,
          locked: false,
          attempts_used: 0,
          max_attempts: 5,
        }),
      );
      const status = await getPinStatus('user-abc-123');
      expect(status.enrolled).toBe(true);
      expect(status.locked).toBe(false);
      expect(status.attempts_used).toBe(0);
    });

    it('returns enrolled=false for a subject that has not enrolled', async () => {
      mockFetch.mockReturnValueOnce(
        mockResponse(200, {
          enrolled: false,
          locked: false,
          attempts_used: 0,
          max_attempts: 5,
        }),
      );
      const status = await getPinStatus('new-user');
      expect(status.enrolled).toBe(false);
    });

    it('returns locked=true with locked_until for a locked subject', async () => {
      const lockedUntil = '2026-06-29T04:20:00.000Z';
      mockFetch.mockReturnValueOnce(
        mockResponse(200, {
          enrolled: true,
          locked: true,
          locked_until: lockedUntil,
          attempts_used: 5,
          max_attempts: 5,
        }),
      );
      const status = await getPinStatus('locked-user');
      expect(status.locked).toBe(true);
      expect(status.locked_until).toBe(lockedUntil);
      expect(status.attempts_used).toBe(5);
    });

    it('sends GET request with Authorization header', async () => {
      mockFetch.mockReturnValueOnce(
        mockResponse(200, { enrolled: true, locked: false, attempts_used: 0, max_attempts: 5 }),
      );
      await getPinStatus('user-abc-123');
      const [, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe('GET');
      expect(init.headers['Authorization']).toBe('Bearer mock-jwt-token');
    });
  });
});
