/**
 * UEBAProfilePage — User and Entity Behaviour Analytics profile browser.
 *
 * Lists all UEBA profiles with anomaly scores, risk levels, and behaviour
 * histograms. Allows refreshing a profile by calling the Python ML engine.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Eye, RefreshCw, Search, User, Activity, Clock,
  TrendingUp, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/40",
  high:     "bg-orange-500/20 text-orange-400 border-orange-500/40",
  medium:   "bg-amber-500/20 text-amber-400 border-amber-500/40",
  low:      "bg-blue-500/20 text-blue-400 border-blue-500/40",
  info:     "bg-slate-500/20 text-slate-400 border-slate-500/40",
};

const RISK_BAR_COLORS: Record<string, string> = {
  critical: "bg-red-500",
  high:     "bg-orange-500",
  medium:   "bg-amber-500",
  low:      "bg-blue-500",
  info:     "bg-slate-500",
};

function RiskBadge({ level }: { level: string }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold border", RISK_COLORS[level] ?? RISK_COLORS.info)}>
      {level.toUpperCase()}
    </span>
  );
}

function ScoreBar({ value, color }: { value: number; color: string }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

export default function UEBAProfilePage() {
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const { data, isLoading, refetch } = trpc.insiderThreat.listUebaProfiles.useQuery({
    riskLevel: riskFilter !== "all" ? (riskFilter as any) : undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }, { refetchInterval: 60_000 });

  const refreshProfile = trpc.insiderThreat.refreshUebaProfile.useMutation({
    onSuccess: () => {
      toast.success("UEBA profile refreshed");
      refetch();
      setRefreshingId(null);
    },
    onError: (err) => {
      toast.error(err.message);
      setRefreshingId(null);
    },
  });

  const handleRefresh = (subjectId: string, tenantId?: string | null) => {
    setRefreshingId(subjectId);
    refreshProfile.mutate({ subjectId, tenantId: tenantId ?? undefined });
  };

  const filteredRows = (data?.rows ?? []).filter(p =>
    !search || p.subjectId.toLowerCase().includes(search.toLowerCase())
  );
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <Eye size={20} className="text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold font-mono text-foreground">UEBA Profiles</h1>
            <p className="text-xs text-muted-foreground font-mono">User &amp; Entity Behaviour Analytics — ML anomaly scores</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 text-xs">
          <RefreshCw size={12} /> Refresh All
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search subject ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs font-mono"
          />
        </div>
        <Select value={riskFilter} onValueChange={v => { setRiskFilter(v); setPage(0); }}>
          <SelectTrigger className="h-8 w-36 text-xs font-mono">
            <SelectValue placeholder="Risk level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All risk levels</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs font-mono text-muted-foreground">{total} profiles</span>
      </div>

      {/* Profile list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : filteredRows.length === 0 ? (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="flex flex-col items-center py-16 text-muted-foreground">
            <Eye size={32} className="mb-3 opacity-30" />
            <p className="text-sm font-mono">No UEBA profiles found</p>
            <p className="text-xs font-mono mt-1">Profiles are created when events are ingested for a subject</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredRows.map(profile => (
            <Card key={profile.id} className="bg-card/50 border-border/50 hover:border-border transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {/* Subject info */}
                  <div className="flex-shrink-0 p-2 rounded-lg bg-muted/20">
                    <User size={18} className="text-muted-foreground" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-mono font-semibold text-foreground truncate">{profile.subjectId}</span>
                      <RiskBadge level={profile.riskLevel} />
                      {!profile.baselineReady && (
                        <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">
                          BASELINE BUILDING
                        </span>
                      )}
                    </div>

                    {/* Score bars */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                            <AlertTriangle size={9} /> Anomaly Score
                          </span>
                        </div>
                        <ScoreBar value={profile.anomalyScore} color={RISK_BAR_COLORS[profile.riskLevel] ?? "bg-slate-500"} />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                            <TrendingUp size={9} /> Drift Score
                          </span>
                        </div>
                        <ScoreBar value={profile.driftScore} color="bg-purple-500" />
                      </div>
                    </div>

                    {/* Stats row */}
                    <div className="flex flex-wrap gap-4 text-[10px] font-mono text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Activity size={9} /> {profile.eventCount} events
                      </span>
                      <span className="flex items-center gap-1">
                        <Eye size={9} /> {profile.uniqueIpCount} IPs
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={9} /> {Math.round(profile.offHoursRatio * 100)}% off-hours
                      </span>
                      {profile.failedAuthCount > 0 && (
                        <span className="flex items-center gap-1 text-red-400">
                          <AlertTriangle size={9} /> {profile.failedAuthCount} failed auths
                        </span>
                      )}
                      {profile.privChangeCount > 0 && (
                        <span className="flex items-center gap-1 text-orange-400">
                          <TrendingUp size={9} /> {profile.privChangeCount} priv changes
                        </span>
                      )}
                      {profile.lastScoredAt && (
                        <span className="flex items-center gap-1 ml-auto">
                          Last scored: {new Date(profile.lastScoredAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex-shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs"
                      disabled={refreshingId === profile.subjectId}
                      onClick={() => handleRefresh(profile.subjectId, profile.tenantId)}
                    >
                      <RefreshCw size={11} className={refreshingId === profile.subjectId ? "animate-spin" : ""} />
                      Refresh
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft size={14} />
          </Button>
          <span className="text-xs font-mono text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
            <ChevronRight size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}
