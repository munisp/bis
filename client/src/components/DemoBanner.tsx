import { trpc } from "@/lib/trpc";
import { AlertTriangle, LogIn, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { getLoginUrl } from "@/const";

export function DemoBanner() {
  const { data: me } = trpc.auth.me.useQuery();
  const [dismissed, setDismissed] = useState(false);

  // Only show for demo users
  if (!me || !(me as any).isDemo || dismissed) return null;

  return (
    <div className="sticky top-0 z-50 flex items-center gap-3 bg-amber-950/95 border-b border-amber-700/60 px-4 py-2.5 text-sm backdrop-blur-sm">
      <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-amber-200 font-medium">Demo Mode — </span>
        <span className="text-amber-300/80">
          You are exploring BIS as a read-only demo user. All data is synthetic. Write actions are disabled.
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-3 text-xs border-amber-600 text-amber-200 hover:bg-amber-900/50 shrink-0"
        onClick={() => { window.location.href = getLoginUrl(); }}
      >
        <LogIn className="h-3 w-3 mr-1.5" />
        Sign in
      </Button>
      <button
        onClick={() => setDismissed(true)}
        className="text-amber-400 hover:text-amber-200 transition-colors shrink-0"
        aria-label="Dismiss demo banner"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
