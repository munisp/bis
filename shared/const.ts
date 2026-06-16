export const COOKIE_NAME = "app_session_id";

/**
 * Session expiry constants — compliance-grade values for a financial platform.
 *
 * PRODUCTION POLICY:
 *   - Hard session lifetime: 24 hours (absolute maximum, regardless of activity)
 *   - Inactivity timeout: 8 hours (session invalidated after 8h of no requests)
 *
 * The old ONE_YEAR_MS is kept for backward-compatibility reference only.
 * All new code should use SESSION_MAX_AGE_MS.
 */
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365; // kept for reference only
export const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24;       // 24 hours hard limit
export const SESSION_INACTIVITY_MS = 1000 * 60 * 60 * 8;     // 8 hours inactivity

export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';
