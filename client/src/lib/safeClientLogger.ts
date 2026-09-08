import * as Sentry from "@sentry/react";
import { TRPCClientError } from "@trpc/client";

type ErrorSource = "query" | "mutation" | "transport" | "ui";
type ErrorCategory = "unauthenticated" | "forbidden" | "offline" | "rate_limited" | "timeout" | "server" | "unknown";

export type SafeClientFailure = Readonly<{
  source: ErrorSource;
  category: ErrorCategory;
  trpcCode?: string;
  httpStatus?: number;
}>;

function classifyTrpcCode(code: string | undefined): ErrorCategory {
  switch (code) {
    case "UNAUTHORIZED":
      return "unauthenticated";
    case "FORBIDDEN":
      return "forbidden";
    case "TOO_MANY_REQUESTS":
      return "rate_limited";
    case "TIMEOUT":
      return "timeout";
    case "INTERNAL_SERVER_ERROR":
    case "SERVICE_UNAVAILABLE":
      return "server";
    default:
      return "unknown";
  }
}

export function toSafeClientFailure(error: unknown, source: ErrorSource): SafeClientFailure {
  if (error instanceof TRPCClientError) {
    const trpcCode = error.data?.code;
    return {
      source,
      category: classifyTrpcCode(trpcCode),
      ...(trpcCode ? { trpcCode } : {}),
      ...(typeof error.data?.httpStatus === "number" ? { httpStatus: error.data.httpStatus } : {}),
    };
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { source, category: "offline" };
  }

  return { source, category: "unknown" };
}

/**
 * Reports operation metadata only. Raw error messages, request payloads, URLs,
 * stack traces, identifiers, and server responses are deliberately excluded.
 */
export function reportClientFailure(error: unknown, source: ErrorSource): SafeClientFailure {
  const failure = toSafeClientFailure(error, source);

  Sentry.withScope((scope) => {
    scope.setLevel(failure.category === "server" ? "error" : "warning");
    scope.setTag("client.source", failure.source);
    scope.setTag("client.category", failure.category);
    if (failure.trpcCode) scope.setTag("trpc.code", failure.trpcCode);
    if (failure.httpStatus) scope.setTag("http.status", String(failure.httpStatus));
    scope.setExtra("operation", "redacted");
    Sentry.captureMessage("BIS client operation failed");
  });

  return failure;
}

export function isUnauthenticatedFailure(failure: SafeClientFailure): boolean {
  return failure.category === "unauthenticated";
}
