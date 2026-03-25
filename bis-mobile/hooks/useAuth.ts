/**
 * useAuth — Authentication hook for BIS Mobile
 * ─────────────────────────────────────────────
 * Reads the current user from the tRPC auth.me query.
 * Provides login URL generation and logout mutation.
 */

import { trpc } from "@/lib/trpc";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback } from "react";

export function useAuth() {
  const { data: user, isLoading, error, refetch } = trpc.auth.me.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await AsyncStorage.removeItem("bis_session_token");
      await refetch();
    },
  });

  const logout = useCallback(() => {
    logoutMutation.mutate();
  }, [logoutMutation]);

  return {
    user: user ?? null,
    isLoading,
    isAuthenticated: !!user,
    error,
    logout,
    isLoggingOut: logoutMutation.isPending,
  };
}
