/**
 * tRPC client for BIS Mobile
 * ──────────────────────────
 * Connects to the BIS BFF (Node.js tRPC server) over HTTP.
 * The BFF_URL can be overridden via environment variable for different environments.
 *
 * Usage:
 *   import { trpc, TRPCProvider } from "@/lib/trpc";
 *   const { data } = trpc.dashboard.summary.useQuery();
 */

import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Import the AppRouter type from the BFF for end-to-end type safety.
// In a monorepo this would be a direct import; here we use a type-only import.
// The actual type is defined in ../../server/routers.ts
import type { AppRouter } from "../../server/routers";

export const trpc = createTRPCReact<AppRouter>();

// ── Config ────────────────────────────────────────────────────────────────────
// Default: local dev BFF. Override with BIS_BFF_URL env var for staging/prod.
const BFF_URL = process.env.BIS_BFF_URL ?? "http://localhost:3001";

// ── Query client ──────────────────────────────────────────────────────────────
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
    },
  },
});

// ── tRPC client ───────────────────────────────────────────────────────────────
export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: `${BFF_URL}/api/trpc`,
      transformer: superjson,
      async headers() {
        // Attach session token from secure storage on every request
        try {
          const token = await AsyncStorage.getItem("bis_session_token");
          if (token) return { Authorization: `Bearer ${token}` };
        } catch {
          // Ignore storage errors
        }
        return {};
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

// ── Provider component ────────────────────────────────────────────────────────
export function TRPCProvider({ children }: { children: React.ReactNode }) {
  return React.createElement(
    trpc.Provider,
    { client: trpcClient, queryClient },
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  );
}
