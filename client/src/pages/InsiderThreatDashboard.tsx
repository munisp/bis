/**
 * InsiderThreatDashboard — Real-time insider threat monitoring dashboard.
 *
 * Displays:
 *   • Summary counts by severity and category (bar charts)
 *   • Recent high/critical events feed
 *   • Status breakdown
 *   • Quick-triage actions (assign, update status)
 */

import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ShieldAlert, AlertTriangle, Activity, Eye, RefreshCw,
  Clock, User, ChevronRight, TrendingUp, CheckCircle2, XCircle
} from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/40",
  high:     "bg-orange-500/20 text-orange-400 border-orange-500/40",
  medium:   "bg-amber-500/20 text-amber-400 border-amber-500/40",
  low:      "bg-blue-500/20 text-blue-400 border-blue-500/40",
  info:     "bg-slate-500/20 text-slate-400 border-slate-500/40",
};

const STATUS_COLORS: Record<string, string> = {
  open:         "bg-red-500/20 text-red-400",
  under_review: "bg-amber-500/20 text-amber-400",
  escalated:    "bg-orange-500/20 text-orange-400",
  dismissed:    "bg-slate-500/20 text-slate-400",
  resolved:     "bg-emerald-500/20 text-emerald-400",
};

const CATEGORY_LABELS: Record<string, string> = {
  data_exfiltration:     "Data Exfiltration",
  privilege_abuse:       "Privilege Abuse",
  off_hours_access:      "Off-Hours Access",
  peer_anomaly:          "Peer Anomaly",
  dead_man_switch:       "Dead-Man Switch",
  failed_auth_spike:     "Auth Spike",
  unusual_ip:            "Unusual IP",
  bulk_download:         "Bulk Download",
  policy_violation:      "Policy Violation",
  access_review_overdue: "Review Overdue",
};

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold border", SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.info)}>
      {severity.toUpperCase()}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono", STATUS_COLORS[status] ?? "bg-muted text-muted-foreground")}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-36 truncate text-muted-foreground text-xs font-mono">{label}</span>
      <div className="flex-1 h-2 bg-muted/30 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-xs font-mono text-foreground">{value}</span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InsiderThreatDashboard() {
  const [, navigate] = useLocation();
  const [tenantId, setTenantId] = useState<string | undefined>(undefined);

  // ── Real-time SSE alert feed ──────────────────────────────────────────────
  const [liveAlerts, setLiveAlerts] = useState<Array<{ alertId: string; subjectId: string; severity: string; category: string; detail: string; triggeredAt: string }>>([]);
  const [sseConnected, setSseConnected] = useState(false);
  const [sessionAnomalyWarning, setSessionAnomalyWarning] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/v1/insider/stream");
    esRef.current = es;
    es.addEventListener("connected", () => setSseConnected(true));
    es.addEventListener("insider_alert", (e: MessageEvent) => {
      try {
        const alert = JSON.parse(e.data);
        setLiveAlerts(prev => [alert, ...prev].slice(0, 50));
        // Detect session anomaly category
        if (alert.category === "session_anomaly" || alert.category === "unusual_ip") {
          setSessionAnomalyWarning(true);
        }
        // Trigger refetch on new critical/high alerts
        if (alert.severity === "critical" || alert.severity === "high") {
          refetchSummary();
          refetchEvents();
        }
      } catch { /* ignore malformed */ }
    });
    es.onerror = () => setSseConnected(false);
    return () => { es.close(); setSseConnected(false); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = trpc.insiderThreat.dashboardSummary.useQuery(
    { tenantId },
    { refetchInterval: 30_000 }
  );

  const { data: recentEvents, isLoading: eventsLoading, refetch: refetchEvents } = trpc.insiderThreat.listEvents.useQuery(
    { severity: undefined, status: "open", limit: 20, offset: 0 },
    { refetchInterval: 15_000 }
  );

  const updateStatus = trpc.insiderThreat.updateEventStatus.useMutation({
    onSuccess: () => {
      toast.success("Event status updated");
      refetchSummary();
      refetchEvents();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleRefresh = () => {
    refetchSummary();
    refetchEvents();
  };

  // Compute max for bar charts
  const maxSeverity = Math.max(...(summary?.bySeverity.map(r => r.total) ?? [1]), 1);
  const maxCategory = Math.max(...(summary?.byCategory.map(r => r.total) ?? [1]), 1);

  const totalOpen = summary?.byStatus.find(s => s.status === "open")?.total ?? 0;
  const totalCritical = summary?.bySeverity.find(s => s.severity === "critical")?.total ?? 0;
  const totalHigh = summary?.bySeverity.find(s => s.severity === "high")?.total ?? 0;
  const totalResolved = summary?.byStatus.find(s => s.status === "resolved")?.total ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Session Anomaly Banner */}
      {sessionAnomalyWarning && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-orange-500/10 border border-orange-500/30 text-orange-300 text-sm font-mono">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="shrink-0" />
            <span><strong>Session Anomaly Detected</strong> — concurrent sessions from different IPs observed for one or more users.</span>
          </div>
          <Button variant="ghost" size="sm" className="text-orange-300 hover:text-orange-100 text-xs h-7" onClick={() => setSessionAnomalyWarning(false)}>Dismiss</Button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <ShieldAlert size={20} className="text-red-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold font-mono text-foreground">Insider Threat Dashboard</h1>
            <p className="text-xs text-muted-foreground font-mono">Real-time UEBA monitoring &amp; threat triage</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-1.5 text-xs">
            <RefreshCw size={12} /> Refresh
          </Button>
          <Button size="sm" onClick={() => navigate("/insider-threat/access-reviews")} className="gap-1.5 text-xs">
            <Eye size={12} /> Access Reviews
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Open Events", value: totalOpen, icon: <AlertTriangle size={16} />, color: "text-red-400", bg: "bg-red-500/10" },
          { label: "Critical", value: totalCritical, icon: <ShieldAlert size={16} />, color: "text-red-500", bg: "bg-red-500/15" },
          { label: "High Severity", value: totalHigh, icon: <TrendingUp size={16} />, color: "text-orange-400", bg: "bg-orange-500/10" },
          { label: "Resolved", value: totalResolved, icon: <CheckCircle2 size={16} />, color: "text-emerald-400", bg: "bg-emerald-500/10" },
        ].map(kpi => (
          <Card key={kpi.label} className="bg-card/50 border-border/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-muted-foreground">{kpi.label}</span>
                <div className={cn("p-1.5 rounded", kpi.bg)}>
                  <span className={kpi.color}>{kpi.icon}</span>
                </div>
              </div>
              {summaryLoading ? (
                <Skeleton className="h-7 w-12" />
              ) : (
                <p className={cn("text-2xl font-bold font-mono", kpi.color)}>{kpi.value}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* By Severity */}
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <Activity size={14} className="text-primary" /> Events by Severity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {summaryLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)
            ) : (
              (summary?.bySeverity ?? []).sort((a, b) => {
                const order = ["critical", "high", "medium", "low", "info"];
                return order.indexOf(a.severity) - order.indexOf(b.severity);
              }).map(row => (
                <SummaryBar
                  key={row.severity}
                  label={row.severity.toUpperCase()}
                  value={row.total}
                  max={maxSeverity}
                  color={
                    row.severity === "critical" ? "bg-red-500" :
                    row.severity === "high" ? "bg-orange-500" :
                    row.severity === "medium" ? "bg-amber-500" :
                    row.severity === "low" ? "bg-blue-500" : "bg-slate-500"
                  }
                />
              ))
            )}
          </CardContent>
        </Card>

        {/* By Category */}
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <ShieldAlert size={14} className="text-primary" /> Events by Category
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {summaryLoading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)
            ) : (
              (summary?.byCategory ?? []).sort((a, b) => b.total - a.total).slice(0, 8).map(row => (
                <SummaryBar
                  key={row.category}
                  label={CATEGORY_LABELS[row.category] ?? row.category}
                  value={row.total}
                  max={maxCategory}
                  color="bg-primary"
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent high/critical events feed */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <AlertTriangle size={14} className="text-red-400" /> Open High/Critical Events
            </CardTitle>
            <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => navigate("/insider-threat/events")}>
              View all <ChevronRight size={12} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {eventsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : (recentEvents?.rows.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center py-10 text-muted-foreground">
              <CheckCircle2 size={28} className="mb-2 text-emerald-500/40" />
              <p className="text-sm font-mono">No open events — system clear</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(recentEvents?.rows ?? []).filter(e => e.severity === "high" || e.severity === "critical").slice(0, 10).map(event => (
                <div
                  key={event.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-muted/10 hover:bg-muted/20 transition-colors"
                >
                  <div className="flex-shrink-0">
                    <SeverityBadge severity={event.severity} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono font-semibold text-foreground truncate">
                        {CATEGORY_LABELS[event.category] ?? event.category}
                      </span>
                      <StatusBadge status={event.status} />
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground font-mono">
                      <span className="flex items-center gap-1"><User size={9} /> {event.subjectId}</span>
                      {event.sourceIp && <span className="flex items-center gap-1"><Activity size={9} /> {event.sourceIp}</span>}
                      <span className="flex items-center gap-1"><Clock size={9} /> {new Date(event.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Select
                      value={event.status}
                      onValueChange={(val) => updateStatus.mutate({ id: event.id, status: val as any })}
                    >
                      <SelectTrigger className="h-7 text-[10px] w-32 font-mono">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="under_review">Under Review</SelectItem>
                        <SelectItem value="escalated">Escalated</SelectItem>
                        <SelectItem value="dismissed">Dismissed</SelectItem>
                        <SelectItem value="resolved">Resolved</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => navigate(`/insider-threat/events/${event.id}`)}
                    >
                      <ChevronRight size={12} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Live Alert Feed (SSE) */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Activity size={14} className={sseConnected ? "text-emerald-400" : "text-muted-foreground"} />
            Live Alert Feed
            <span className={cn("ml-auto text-[10px] px-2 py-0.5 rounded-full font-mono border",
              sseConnected ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-muted/30 text-muted-foreground border-border/30"
            )}>
              {sseConnected ? "● LIVE" : "○ CONNECTING"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {liveAlerts.length === 0 ? (
            <p className="text-xs text-muted-foreground font-mono py-4 text-center">No live alerts yet — stream active</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {liveAlerts.map((a, i) => (
                <div key={`${a.alertId}-${i}`} className="flex items-start gap-2 p-2 rounded bg-muted/10 border border-border/30 text-xs font-mono">
                  <SeverityBadge severity={a.severity} />
                  <div className="flex-1 min-w-0">
                    <span className="text-foreground font-semibold">{CATEGORY_LABELS[a.category] ?? a.category}</span>
                    <span className="text-muted-foreground ml-2">{a.subjectId}</span>
                    {a.detail && <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{a.detail}</p>}
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">{new Date(a.triggeredAt).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status breakdown */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <XCircle size={14} className="text-primary" /> Event Status Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {summaryLoading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-28" />)
            ) : (
              (summary?.byStatus ?? []).map(row => (
                <div key={row.status} className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-mono", STATUS_COLORS[row.status] ?? "bg-muted text-muted-foreground border-border/40")}>
                  <span className="font-semibold">{row.status.replace(/_/g, " ")}</span>
                  <span className="font-bold">{row.total}</span>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
