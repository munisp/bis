import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  // Demo mode: server always returns a demo user, so UNAUTHORIZED should not
  // occur. Log it but do NOT redirect to Manus OAuth to keep the demo open.
  console.warn("[BIS Demo] Unauthorized API call — skipping OAuth redirect");
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

// ── CSRF Token ────────────────────────────────────────────────────────────────
// Fetch a CSRF token from the server on app load and inject it into all
// state-changing tRPC requests via the X-CSRF-Token header.
// The server validates this header on POST/PUT/PATCH/DELETE requests.
let _csrfToken: string | null = null;

async function fetchCsrfToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/csrf-token", {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    _csrfToken = data?.csrfToken ?? null;
    return _csrfToken;
  } catch {
    // Non-fatal — CSRF validation is defence-in-depth; app still works
    console.warn("[BIS] Failed to fetch CSRF token");
    return null;
  }
}

// Pre-fetch CSRF token before first mutation (non-blocking)
fetchCsrfToken();

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      async headers() {
        // Ensure we have a token before any request (lazy fetch if needed)
        if (!_csrfToken) {
          await fetchCsrfToken();
        }
        return _csrfToken ? { "X-CSRF-Token": _csrfToken } : {};
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
    </QueryClientProvider>
  </trpc.Provider>
);
