// BIS Alerts & AutoFlag History Page
import { useState } from "react";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Search, Filter, AlertTriangle, CheckCircle2, Clock,
  Bell, BellOff, Eye, ChevronRight, Zap
} from "lucide-react";
import { mockAlerts, getStatusBadgeClass, formatDateTime } from "@/lib/mockData";

const alertTypeColor: Record<string, string> = {
  sanctions_hit: "text-red-400 bg-red-500/10 border-red-500/20",
  adverse_media: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  criminal_record: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  pep_match: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  high_risk_score: "text-red-400 bg-red-500/10 border-red-500/20",
  duplicate_identity: "text-blue-400 bg-blue-500/10 border-blue-500/20",
};

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

export default function Alerts() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [alerts, setAlerts] = useState(mockAlerts);

  const filtered = alerts
    .filter(a => {
      const matchSearch = a.subjectName.toLowerCase().includes(search.toLowerCase()) ||
        a.subjectRef.toLowerCase().includes(search.toLowerCase()) ||
        a.summary.toLowerCase().includes(search.toLowerCase());
        const matchStatus = statusFilter === "all" || a.status === (statusFilter === "active" ? "new" : statusFilter === "acknowledged" ? "reviewed" : statusFilter);
      const matchSeverity = severityFilter === "all" || a.severity === severityFilter;
      return matchSearch && matchStatus && matchSeverity;
    })
    .sort((a, b) => (severityOrder[a.severity as keyof typeof severityOrder] ?? 99) - (severityOrder[b.severity as keyof typeof severityOrder] ?? 99));

  const handleAcknowledge = (id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: "reviewed" } : a));
    toast.success("Alert acknowledged");
  };

  const handleDismiss = (id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: "dismissed" } : a));
    toast.info("Alert dismissed");
  };

  const unread = alerts.filter(a => a.status === "new").length;
  const critical = alerts.filter(a => a.severity === "critical").length;

  return (
    <BISLayout
      title="Alerts"
      subtitle={`${unread} active · ${critical} critical`}
      actions={
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => toast.info("Notification settings updated")}>
          <Bell size={11} /> Configure Alerts
        </Button>
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
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
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
      </div>

      {/* Alert list */}
      <div className="space-y-2">
        {filtered.map(alert => (
          <div key={alert.id}
            className={`bis-card p-4 border ${alertTypeColor[alert.alertType] ?? "border-border"} ${alert.status !== "new" ? "opacity-60" : ""}`}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle size={15} className={alert.severity === "critical" ? "text-red-400" : alert.severity === "high" ? "text-amber-400" : "text-muted-foreground"} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground capitalize">{alert.alertType.replace(/_/g, " ")}</span>
                  <Badge variant="outline" className={`text-[10px] h-4 px-1.5 capitalize ${alert.severity === "critical" ? "border-red-500/40 text-red-400" : alert.severity === "high" ? "border-amber-500/40 text-amber-400" : "border-border"}`}>
                    {alert.severity}
                  </Badge>
                  <span className={`bis-badge ${getStatusBadgeClass(alert.status)}`}>{alert.status}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{alert.summary}</p>
                <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                  <span className="font-mono">{alert.subjectRef}</span>
                  <span>·</span>
                  <span>{alert.subjectName}</span>
                  <span>·</span>
                  <span>{alert.source}</span>
                  <span>·</span>
                  <span>{formatDateTime(alert.detectedAt)}</span>
                </div>
              </div>
              {alert.status === "new" && (
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => handleAcknowledge(alert.id)}>
                    <CheckCircle2 size={10} className="mr-1" />Ack
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => handleDismiss(alert.id)}>
                    <BellOff size={10} className="mr-1" />Dismiss
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
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
