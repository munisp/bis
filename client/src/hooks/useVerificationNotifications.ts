/**
 * useVerificationNotifications — real-time toast alerts for NIN/BVN verification status changes.
 *
 * Subscribes to the BIS SSE event stream and shows a toast notification
 * whenever a KYC_COMPLETED or VERIFICATION_STATUS_CHANGED event is received.
 * Also invalidates the quickcheck.history query so the UI updates immediately.
 */
import { useCallback } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useEventStream, BisEvent } from "./useEventStream";

interface UseVerificationNotificationsOptions {
  /** Whether to enable the listener. Defaults to true. */
  enabled?: boolean;
}

export function useVerificationNotifications(options: UseVerificationNotificationsOptions = {}) {
  const { enabled = true } = options;
  const utils = trpc.useUtils();

  const handleEvent = useCallback((event: BisEvent) => {
    const { type, payload, severity } = event;

    if (type === "KYC_COMPLETED" || type === "VERIFICATION_STATUS_CHANGED") {
      const subjectName = (payload.subjectName as string) || "Identity";
      const result = (payload.result as string) || (payload.verdict as string) || "completed";
      const isSuccess = result === "clear" || result === "verified" || result === "passed";

      if (isSuccess) {
        toast.success(`${subjectName} — verification confirmed`, {
          description: "NIN/BVN identity has been verified against the national database.",
          duration: 8000,
        });
      } else if (result === "failed" || result === "flagged") {
        toast.error(`${subjectName} — verification flagged`, {
          description: "The identity check returned a non-clear result. Review recommended.",
          duration: 10000,
        });
      } else {
        toast.info(`${subjectName} — verification ${result}`, {
          description: "A verification status update was received.",
          duration: 6000,
        });
      }

      // Immediately refresh verification history so the UI reflects the change
      utils.quickcheck.history.invalidate();
    }

    if (type === "IDENTITY_PROVIDER_RESTORED") {
      toast.info("Identity verification service restored", {
        description: "The NIN/BVN provider is back online. You can retry any pending verifications.",
        duration: 8000,
      });
    }
  }, [utils]);

  const { connected, lastEvent, reconnectCount } = useEventStream({
    eventTypes: ["KYC_COMPLETED", "VERIFICATION_STATUS_CHANGED", "IDENTITY_PROVIDER_RESTORED"],
    onEvent: handleEvent,
    enabled,
  });

  return { connected, lastEvent, reconnectCount };
}
