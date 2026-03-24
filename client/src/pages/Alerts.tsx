// BIS Alerts & AutoFlag History Page
// Design: Forensic Intelligence — dark/light semantic CSS variables
import { useState } from "react";
import { Link } from "wouter";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Search, Filter, AlertTriangle, CheckCircle2,
  Bell, BellOff, ChevronDown, ChevronUp,
  ExternalLink, Download, RefreshCw
} from "lucide-react";
import { mockAlerts, getStatusBadgeClass, formatDateTime } from "@/lib/mockData";
import { cn } from "@/lib/utils";

const alertTypeColor: Record<string, string> = {
  sanctions_hit:      "border-red-500/20",
  adverse_media:      "border-amber-500/20",
  criminal_record:    "border-orange-500/20",
  pep_match:          "border-purple-500/20",
  high_risk_score:    "border-red-500/20",
  duplicate_identity: "border-blue-500/20",
};

const alertTypeBg: Record<string, string> = {
  sanctions_hit:      "bg-red-500/5",
  adverse_media:      "bg-amber-500/5",
  criminal_record:    "bg-orange-500/5",
  pep_match:          "bg-purple-500/5",
  high_risk_score:    "bg-red-500/5",
  duplicate_identity: "bg-blue-500/5",
};

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

// Map subject refs to investigation IDs for deep-link
const REF_TO_INV: Record<string, string> = {
  "BIS-2026-0004": "4",
  "BIS-2026-0007": "7",
  "BIS-2026-0001": "1",
  "BIS-2026-0002": "2",
  "BIS-2026-0003": "3",
};

export default function Alerts() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [alerts, setAlerts] = useState(mockAlerts);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filtered = alerts
    .filter(a => {
      const matchSearch =
        a.subjectName.toLowerCase().includes(search.toLowerCase()) ||
        a.subjectRef.toLowerCase().includes(search.toLowerCase()) ||
        a.summary.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === "all" || a.status === statusFilter;
      const matchSeverity = severityFilter === "all" || a.severity === severityFilter;
      return matchSearch && matchStatus && matchSeverity;
    })
    .sort((a, b) =>
      (severityOrder[a.severity as keyof typeof severityOrder] ?? 99) -
      (severityOrder[b.severity as keyof typeof severityOrder] ?? 99)
    );

  const handleAcknowledge = (id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: "reviewed" } : a));
    toast.success("Alert acknowledged");
  };

  const handleDismiss = (id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: "dismissed" } : a));
    toast.info("Alert dismissed");
  };

  const handleExportCSV = () => {
    const header = "ID,Type,Severity,Status,Subject,Ref,Source,Detected\n";
    const rows = filtered.map(a =>
      `${a.id},${a.alertType},${a.severity},${a.status},"${a.subjectName}",${a.subjectRef},${a.source},${a.detectedAt}`
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

  const unread = alerts.filter(a => a.status === "new").length;
  const critical = alerts.filter(a => a.severity === "critical").length;

  return (
    <BISLayout
      title="Alerts"
      subtitle={`${unread} active · ${critical} critical`}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleExportCSV}>
            <Download size={11} /> Export CSV
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => toast.success("Alert rules refreshed")}>
            <RefreshCw size={11} /> Refresh
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => toast.info("Notification settings updated")}>
            <Bell size={11} /> Configure
          </Button>
        </div>
      }
    >
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: "New", value: alerts.filter(a => a.status === "new").length, color: "text-red-400" },
          { label: "Critical", value: alerts.filter(a => a.severity === "critical").length, color: "text-red-500" },
          { label: "Reviewed", value: alerts.filter(a => a.status === "reviewed").length, color: "text-amber-400" },
          { label: "Dismissed", value: alerts.filter(a => a.status === "dismissed").length, color: "text-muted-foreground" },
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

      {/* Alert list */}
      <div className="space-y-2">
        {filtered.map(alert => {
          const isExpanded = expanded.has(alert.id);
          const invId = REF_TO_INV[alert.subjectRef];
          return (
            <div
              key={alert.id}
              className={cn(
                "bis-card border transition-all",
                alertTypeColor[alert.alertType] ?? "border-border",
                alertTypeBg[alert.alertType] ?? "",
                alert.status !== "new" ? "opacity-60" : ""
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
                        {alert.alertType.replace(/_/g, " ")}
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
                      <span className={`bis-badge ${getStatusBadgeClass(alert.status)}`}>{alert.status}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{alert.summary}</p>
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground flex-wrap">
                      <span className="font-mono font-semibold text-foreground/70">{alert.subjectRef}</span>
                      <span>·</span>
                      <span>{alert.subjectName}</span>
                      <span>·</span>
                      <span>{alert.source}</span>
                      <span>·</span>
                      <span>{formatDateTime(alert.detectedAt)}</span>
                    </div>
                  </div>
                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                    {invId && (
                      <Link href={`/investigations/${invId}`}>
                        <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1 text-primary border-primary/30 hover:bg-primary/10">
                          <ExternalLink size={9} /> View Investigation
                        </Button>
                      </Link>
                    )}
                    {alert.status === "new" && (
                      <>
                        <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => handleAcknowledge(alert.id)}>
                          <CheckCircle2 size={10} className="mr-1" />Ack
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => handleDismiss(alert.id)}>
                          <BellOff size={10} className="mr-1" />Dismiss
                        </Button>
                      </>
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
                      <div className="capitalize text-foreground">{alert.alertType.replace(/_/g, " ")}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Detected</div>
                      <div className="font-mono text-foreground">{formatDateTime(alert.detectedAt)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Source</div>
                      <div className="text-foreground">{alert.source}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Full Summary</div>
                    <p className="text-foreground/80 leading-relaxed">{alert.summary}</p>
                  </div>
                  {invId && (
                    <div className="pt-1">
                      <Link href={`/investigations/${invId}`}>
                        <Button size="sm" className="h-7 text-xs gap-1.5">
                          <ExternalLink size={11} /> Open Investigation {alert.subjectRef}
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
    </BISLayout>
  );
}
