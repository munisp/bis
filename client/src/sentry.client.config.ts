/**
 * sentry.client.config.ts — Sentry browser SDK initialisation.
 *
 * Activated only when VITE_SENTRY_DSN is set.  No DSN = no-op, so the
 * development environment stays noise-free.
 */
import * as Sentry from "@sentry/react";

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE ?? "production",
    release: import.meta.env.VITE_APP_VERSION as string | undefined,
    tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.1,
    replaysSessionSampleRate: 0.01,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    allowUrls: [window.location.origin],
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      "Non-Error promise rejection captured",
      /^Network Error$/,
      /^Request aborted$/,
    ],
  });
}

export { Sentry };
