import { trpc } from "@/lib/trpc";
import "./sentry.client.config";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { OfflineBanner } from "./components/OfflineBanner";
import { getLoginUrl } from "./const";
import { isUnauthenticatedFailure, reportClientFailure } from "./lib/safeClientLogger";
import { registerBISServiceWorker } from "./lib/serviceWorker";
import { toast } from "sonner";
import "./index.css";

const queryClient = new QueryClient();
let authenticationRedirectInFlight = false;

function redirectToLoginIfUnauthorized(error: unknown, source: "query" | "mutation") {
  const failure = reportClientFailure(error, source);
  const isUnauthenticated = isUnauthenticatedFailure(failure)
    || (error instanceof TRPCClientError && error.message === UNAUTHED_ERR_MSG);

  if (!isUnauthenticated || typeof window === "undefined" || authenticationRedirectInFlight) return false;

  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  if (!oauthPortalUrl || !appId) {
    toast.error("Your session has ended", {
      description: "Sign in again to continue.",
      duration: 5000,
    });
    return true;
  }

  authenticationRedirectInFlight = true;
  window.location.replace(getLoginUrl());
  return true;
}

queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== "updated" || event.action.type !== "error") return;
  redirectToLoginIfUnauthorized(event.query.state.error, "query");
});

queryClient.getMutationCache().subscribe((event) => {
  if (event.type !== "updated" || event.action.type !== "error") return;
  const error = event.mutation.state.error;
  if (redirectToLoginIfUnauthorized(error, "mutation")) return;

  const failure = reportClientFailure(error, "mutation");
  const description = failure.category === "offline"
    ? "Check your connection and try again."
    : "No changes were confirmed. Please try again.";
  toast.error("We could not complete that action", { description, duration: 5000 });
});

let csrfToken: string | null = null;

async function fetchCsrfToken(): Promise<string | null> {
  try {
    const response = await fetch("/api/csrf-token", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) {
      reportClientFailure(null, "transport");
      return null;
    }
    const data = await response.json();
    csrfToken = typeof data?.csrfToken === "string" ? data.csrfToken : null;
    return csrfToken;
  } catch {
    reportClientFailure(null, "transport");
    return null;
  }
}

void fetchCsrfToken();
registerBISServiceWorker();

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      async headers() {
        if (!csrfToken) await fetchCsrfToken();
        return csrfToken ? { "X-CSRF-Token": csrfToken } : {};
      },
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
      <OfflineBanner />
    </QueryClientProvider>
  </trpc.Provider>
);
