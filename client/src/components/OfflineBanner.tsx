import { useOfflineSync } from "@/hooks/useOfflineSync";
import { WifiOff, Wifi, RefreshCw, CloudUpload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function OfflineBanner() {
  const { isOnline, pendingCount, isSyncing, lastSynced, forcSync } = useOfflineSync();

  if (isOnline && pendingCount === 0) return null;

  return (
    <div
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-full shadow-lg border text-sm font-medium transition-all ${
        isOnline
          ? "bg-amber-950/90 border-amber-700 text-amber-200"
          : "bg-red-950/90 border-red-700 text-red-200"
      }`}
    >
      {isOnline ? (
        <Wifi className="h-4 w-4 text-amber-400" />
      ) : (
        <WifiOff className="h-4 w-4 text-red-400" />
      )}

      {!isOnline && <span>You are offline — submissions will be queued</span>}

      {isOnline && pendingCount > 0 && (
        <span>
          {pendingCount} submission{pendingCount !== 1 ? "s" : ""} pending sync
        </span>
      )}

      {pendingCount > 0 && (
        <Badge variant="outline" className="border-current text-current text-xs">
          {pendingCount}
        </Badge>
      )}

      {isOnline && pendingCount > 0 && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs text-current hover:bg-white/10"
          onClick={forcSync}
          disabled={isSyncing}
        >
          {isSyncing ? (
            <RefreshCw className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <CloudUpload className="h-3 w-3 mr-1" />
          )}
          Sync now
        </Button>
      )}

      {lastSynced && isOnline && pendingCount === 0 && (
        <span className="text-xs opacity-70">
          Last synced {lastSynced.toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}
