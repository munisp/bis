/**
 * sentry.server.config.ts — Sentry Node.js SDK initialisation.
 *
 * Must be imported FIRST in server/_core/index.ts before any other modules
 * so that Sentry can instrument the Express app and all async contexts.
 *
 * Activated only when SENTRY_DSN is set.
 */
import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "production",
    release: process.env.npm_package_version,

    // Performance monitoring — 10% of transactions in production
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

    // Capture unhandled promise rejections and uncaught exceptions
    integrations: [
      Sentry.onUnhandledRejectionIntegration({ mode: "warn" }),
      Sentry.onUncaughtExceptionIntegration({ exitEvenIfOtherHandlersAreRegistered: false }),
    ],

    // Scrub sensitive fields from request bodies
    beforeSend(event) {
      if (event.request?.data) {
        const data = event.request.data as Record<string, unknown>;
        for (const key of ["password", "pin", "token", "secret", "apiKey", "api_key"]) {
          if (key in data) data[key] = "[Filtered]";
        }
      }
      return event;
    },
  });
}

export { Sentry };
