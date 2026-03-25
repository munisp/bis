// Alerts — live tRPC-backed alert management
// Design: Forensic Intelligence — dark/light semantic CSS variables
import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Search, Filter, AlertTriangle, CheckCircle2,
  Bell, BellOff, ChevronDown, ChevronUp,
  ExternalLink, Download, RefreshCw, Loader2
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Zap } from "lucide-react";

const alertTypeColor: Record<string, string> = {
  sanctions_hit:      "border-red-500/20",
  adverse_media:      "border-amber-500/20",
  criminal_record:    "border-orange-500/20",
  pep_match:          "border-purple-500/20",
  pep_detected:       "border-purple-500/20",
  high_risk_score:    "border-red-500/20",
  risk_threshold:     "border-red-500/20",
  duplicate_identity: "border-blue-500/20",
  velocity:           "border-amber-500/20",
  field_report:       "border-emerald-500/20",
  system:             "border-border",
};

const alertTypeBg: Record<string, string> = {
  sanctions_hit:      "bg-red-500/5",
  adverse_media:      "bg-amber-500/5",
  criminal_record:    "bg-orange-500/5",
  pep_match:          "bg-purple-500/5",
  pep_detected:       "bg-purple-500/5",
  high_risk_score:    "bg-red-500/5",
  risk_threshold:     "bg-red-500/5",
  duplicate_identity: "bg-blue-500/5",
  velocity:           "bg-amber-500/5",
  field_report:       "bg-emerald-500/5",
};

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case "new":       return "bg-red-500/10 text-red-400 border-red-500/20";
    case "reviewed":  return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    case "dismissed": return "bg-muted/30 text-muted-foreground border-border";
    case "resolved":  return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    default:          return "bg-muted/30 text-muted-foreground border-border";
  }
}

export default function Alerts() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [subjectRefFilter, setSubjectRefFilter] = useState<string | undefined>(undefined);

  // Pre-filter by ?subjectRef=X when navigated from Continuous Monitoring drill-down
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sr = params.get("subjectRef");
    if (sr) setSubjectRefFilter(sr);
  }, []);

  const utils = trpc.useUtils();
  const { data: rawAlerts = [], isLoading, refetch } = trpc.alerts.list.useQuery({
    unreadOnly: statusFilter === "new" ? true : false,
    limit: 200,
    subjectRef: subjectRefFilter,
  });

  const acknowledgeMutation = trpc.alerts.acknowledge.useMutation({
    onSuccess: () => { toast.success("Alert acknowledged"); utils.alerts.list.invalidate(); },
    onError: (e) => toast.error("Failed to acknowledge", { description: e.message }),
  });

  // dismiss = acknowledge with a note (no separate dismiss procedure — use acknowledge)
  const resolveMutation = trpc.alerts.resolve.useMutation({
    onSuccess: () => { toast.success("Alert resolved"); utils.alerts.list.invalidate(); },
    onError: (e: any) => toast.error("Failed to resolve", { description: e.message }),
  });

  const dismissMutation = trpc.alerts.dismiss.useMutation({
    onSuccess: () => { toast.info("Alert dismissed"); utils.alerts.list.invalidate(); },
    onError: (e: any) => toast.error("Failed to dismiss", { description: e.message }),
  });

  // Escalation state
  const [escalateAlert, setEscalateAlert] = useState<any | null>(null);
  const [escalateAgentId, setEscalateAgentId] = useState("");
  const [escalateInstructions, setEscalateInstructions] = useState("");

  const { data: fieldAgents = [] } = trpc.fieldAgents.list.useQuery({ status: "active", limit: 100 });

  const escalateMutation = trpc.alerts.escalate.useMutation({
    onSuccess: () => {
      toast.success("Alert escalated", { description: "Critical field task dispatched and owner notified." });
      setEscalateAlert(null);
      setEscalateAgentId("");
      setEscalateInstructions("");
      utils.alerts.list.invalidate();
    },
    onError: (e: any) => toast.error("Escalation failed", { description: e.message }),
  });

  const handleEscalate = () => {
    if (!escalateAlert || !escalateAgentId) return;
    const agent = (fieldAgents as any[]).find((a: any) => a.agentId === escalateAgentId);
    escalateMutation.mutate({
      id: escalateAlert.id,
      agentId: escalateAgentId,
      agentName: agent?.name ?? escalateAgentId,
      instructions: escalateInstructions || undefined,
    });
  };

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const getAlertStatus = (a: any) => {
    if (a.resolved) return "resolved";
    if (a.dismissed) return "dismissed";
    if (a.acknowledged) return "reviewed";
    return "new";
  };

  const filtered = rawAlerts
    .filter((a: any) => {
      const text = `${a.title ?? ""} ${a.body ?? ""} ${a.investigationId ?? ""}`.toLowerCase();
      const matchSearch = !search || text.includes(search.toLowerCase());
      const status = getAlertStatus(a);
      const matchStatus = statusFilter === "all" || status === statusFilter;
      const matchSeverity = severityFilter === "all" || a.severity === severityFilter;
      return matchSearch && matchStatus && matchSeverity;
    })
    .sort((a: any, b: any) =>
      (severityOrder[a.severity as keyof typeof severityOrder] ?? 99) -
      (severityOrder[b.severity as keyof typeof severityOrder] ?? 99)
    );

  const handleExportCSV = () => {
    const header = "ID,Type,Severity,Status,Title,InvestigationId,Detected\n";
    const rows = filtered.map((a: any) =>
      `${a.id},${a.type},${a.severity},${a.status},"${a.title ?? ""}",${a.investigationId ?? ""},${a.createdAt}`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bis-alerts-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} alerts`);
  };

  const unread = rawAlerts.filter((a: any) => !a.acknowledged && !a.read).length;
  const critical = rawAlerts.filter((a: any) => a.severity === "critical").length;

  return (
    <BISLayout
      title="Alerts"
      subtitle={`${unread} active · ${critical} critical`}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleExportCSV}>
            <Download size={11} /> Export CSV
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => refetch()}>
            <RefreshCw size={11} className={isLoading ? "animate-spin" : ""} /> Refresh
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => navigate("/alert-rules")}>
            <Bell size={11} /> Configure Rules
          </Button>
        </div>
      }
    >
      {/* SubjectRef drill-down banner */}
      {subjectRefFilter && (
        <div className="flex items-center justify-between bg-indigo-500/10 border border-indigo-500/30 rounded-lg px-4 py-2.5 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-indigo-400 font-mono text-xs">🔍 Filtered by subject:</span>
            <span className="font-mono text-indigo-300 font-semibold">{subjectRefFilter}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs text-indigo-400 hover:text-indigo-300"
            onClick={() => { setSubjectRefFilter(undefined); window.history.replaceState({}, '', '/alerts'); }}
          >
            ✕ Clear filter
          </Button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: "New", value: rawAlerts.filter((a: any) => getAlertStatus(a) === "new").length, color: "text-red-400" },
          { label: "Critical", value: rawAlerts.filter((a: any) => a.severity === "critical").length, color: "text-red-500" },
          { label: "Reviewed", value: rawAlerts.filter((a: any) => getAlertStatus(a) === "reviewed").length, color: "text-amber-400" },
          { label: "Resolved", value: rawAlerts.filter((a: any) => getAlertStatus(a) === "resolved").length, color: "text-emerald-400" },
        ].map(stat => (
          <div key={stat.label} className="bis-card p-3">
            <div className={`text-2xl font-bold font-mono ${stat.color}`}>{stat.value}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8 h-8 text-sm" placeholder="Search alerts..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-32 text-xs"><Filter size={11} className="mr-1" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="reviewed">Reviewed</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severity</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 size={20} className="animate-spin mr-2" /> Loading alerts…
        </div>
      )}

      {/* Alert list */}
      {!isLoading && (
        <div className="space-y-2">
          {filtered.map((alert: any) => {
            const isExpanded = expanded.has(alert.id);
            return (
              <div
                key={alert.id}
                className={cn(
                  "bis-card border transition-all",
                  alertTypeColor[alert.type] ?? "border-border",
                  alertTypeBg[alert.type] ?? "",
                  (alert.acknowledged || alert.read) ? "opacity-60" : ""
                )}
              >
                {/* Main row */}
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle
                      size={15}
                      className={
                        alert.severity === "critical" ? "text-red-400 mt-0.5 shrink-0" :
                        alert.severity === "high" ? "text-amber-400 mt-0.5 shrink-0" :
                        "text-muted-foreground mt-0.5 shrink-0"
                      }
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground capitalize">
                          {(alert.type ?? "").replace(/_/g, " ")}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] h-4 px-1.5 capitalize",
                            alert.severity === "critical" ? "border-red-500/40 text-red-400" :
                            alert.severity === "high" ? "border-amber-500/40 text-amber-400" :
                            "border-border"
                          )}
                        >
                          {alert.severity}
                        </Badge>
                        <span className={`bis-badge ${getStatusBadgeClass(getAlertStatus(alert))}`}>{getAlertStatus(alert)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{alert.title ?? "—"}</p>
                      <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground flex-wrap">
                        {alert.investigationId && (
                          <>
                            <span className="font-mono font-semibold text-foreground/70">INV-{alert.investigationId}</span>
                            <span>·</span>
                          </>
                        )}
                        <span>{formatDateTime(alert.createdAt)}</span>
                      </div>
                    </div>
                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                      {alert.investigationId && (
                        <Link href={`/investigations/${alert.investigationId}`}>
                          <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1 text-primary border-primary/30 hover:bg-primary/10">
                            <ExternalLink size={9} /> View Investigation
                          </Button>
                        </Link>
                      )}
                      {getAlertStatus(alert) === "new" && (
                        <>
                          {(alert.severity === "critical" || alert.severity === "high") && (
                            <Button
                              variant="outline" size="sm"
                              className="h-6 text-[10px] px-2 text-red-400 border-red-500/30 hover:bg-red-500/10"
                              onClick={() => { setEscalateAlert(alert); setEscalateAgentId(""); setEscalateInstructions(""); }}
                            >
                              <Zap size={10} className="mr-1" />Escalate
                            </Button>
                          )}
                          <Button
                            variant="outline" size="sm" className="h-6 text-[10px] px-2"
                            disabled={acknowledgeMutation.isPending}
                            onClick={() => acknowledgeMutation.mutate({ id: alert.id })}
                          >
                            <CheckCircle2 size={10} className="mr-1" />Ack
                          </Button>
                          <Button
                            variant="ghost" size="sm" className="h-6 text-[10px] px-2"
                            disabled={dismissMutation.isPending}
                            onClick={() => dismissMutation.mutate({ id: alert.id })}
                          >
                            <BellOff size={10} className="mr-1" />Dismiss
                          </Button>
                        </>
                      )}
                      {getAlertStatus(alert) === "reviewed" && (
                        <Button
                          variant="outline" size="sm" className="h-6 text-[10px] px-2 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                          disabled={resolveMutation.isPending}
                          onClick={() => resolveMutation.mutate({ id: alert.id })}
                        >
                          <CheckCircle2 size={10} className="mr-1" />Resolve
                        </Button>
                      )}
                      <Button
                        variant="ghost" size="sm" className="h-6 text-[10px] px-1.5"
                        onClick={() => toggleExpand(alert.id)}
                      >
                        {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-border/30 px-4 py-3 space-y-2 text-xs">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Alert ID</div>
                        <div className="font-mono text-foreground">{alert.id}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Alert Type</div>
                        <div className="capitalize text-foreground">{(alert.type ?? "").replace(/_/g, " ")}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Detected</div>
                        <div className="font-mono text-foreground">{formatDateTime(alert.createdAt)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Status</div>
                        <div className="text-foreground capitalize">{alert.acknowledged ? "reviewed" : alert.read ? "read" : "new"}</div>
                      </div>
                    </div>
                    {alert.body && (
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Full Message</div>
                        <p className="text-foreground/80 leading-relaxed">{alert.body}</p>
                      </div>
                    )}
                    {alert.investigationId && (
                      <div className="pt-1">
                        <Link href={`/investigations/${alert.investigationId}`}>
                          <Button size="sm" className="h-7 text-xs gap-1.5">
                            <ExternalLink size={11} /> Open Investigation
                          </Button>
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="bis-card p-12 text-center text-muted-foreground text-sm">
              <Bell size={24} className="mx-auto mb-3 opacity-30" />
              No alerts match your filters.
            </div>
          )}
        </div>
      )}
      {/* Escalation Dialog */}
      <Dialog open={!!escalateAlert} onOpenChange={open => { if (!open) setEscalateAlert(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <Zap size={16} /> Escalate Alert
            </DialogTitle>
          </DialogHeader>
          {escalateAlert && (
            <div className="space-y-4 py-2">
              <div className="bis-card p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                <p className="text-xs font-semibold text-foreground capitalize">{(escalateAlert.type ?? "").replace(/_/g, " ")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{escalateAlert.title}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Assign to Field Agent <span className="text-red-400">*</span></Label>
                <Select value={escalateAgentId} onValueChange={setEscalateAgentId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select active agent…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(fieldAgents as any[]).map((a: any) => (
                      <SelectItem key={a.agentId} value={a.agentId}>
                        {a.name} — {a.state ?? "N/A"} ({a.tier})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Additional Instructions</Label>
                <Textarea
                  className="text-xs h-20 resize-none"
                  placeholder="Optional: specific instructions for the agent…"
                  value={escalateInstructions}
                  onChange={e => setEscalateInstructions(e.target.value)}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                This will dispatch a <strong>critical</strong> surveillance task, acknowledge the alert, and notify the platform owner.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEscalateAlert(null)}>Cancel</Button>
            <Button
              size="sm"
              className="bg-red-500 hover:bg-red-600 text-white"
              disabled={!escalateAgentId || escalateMutation.isPending}
              onClick={handleEscalate}
            >
              {escalateMutation.isPending ? <Loader2 size={12} className="animate-spin mr-1" /> : <Zap size={12} className="mr-1" />}
              Escalate Now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BISLayout>
  );
}
