// AlertRulesPage.tsx — Alert rule configuration + trigger history
// Design: Forensic Intelligence — dark/light semantic CSS variables

import { useState } from "react";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  Plus, Trash2, Pencil, Zap, Shield, RefreshCw, Loader2,
  AlertTriangle, CheckCircle2, Info, TrendingUp, History,
  CheckCheck, XCircle, ChevronLeft, ChevronRight, Download,
  FlaskConical
} from "lucide-react";

// ─── Config ───────────────────────────────────────────────────────────────────

const METRICS = [
  { value: "risk_score",                label: "Risk Score",                unit: "%" },
  { value: "sanctions_confidence",      label: "Sanctions Confidence",      unit: "%" },
  { value: "pep_confidence",            label: "PEP Confidence",            unit: "%" },
  { value: "adverse_media_count",       label: "Adverse Media Count",       unit: "hits" },
  { value: "duplicate_identity_score",  label: "Duplicate Identity Score",  unit: "%" },
  { value: "velocity_hourly",           label: "Velocity (Hourly)",         unit: "req/h" },
  { value: "velocity_daily",            label: "Velocity (Daily)",          unit: "req/d" },
  { value: "credit_score",              label: "Credit Score",              unit: "pts" },
];

const OPERATORS = [
  { value: "gte", label: ">= (greater than or equal)" },
  { value: "gt",  label: "> (greater than)" },
  { value: "lte", label: "<= (less than or equal)" },
  { value: "lt",  label: "< (less than)" },
  { value: "eq",  label: "= (equal to)" },
  { value: "neq", label: "!= (not equal to)" },
];

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  info:     { color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/30",       icon: <Info size={12} /> },
  low:      { color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30", icon: <CheckCircle2 size={12} /> },
  medium:   { color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/30",     icon: <AlertTriangle size={12} /> },
  high:     { color: "text-orange-400",  bg: "bg-orange-500/10 border-orange-500/30",   icon: <AlertTriangle size={12} /> },
  critical: { color: "text-red-400",     bg: "bg-red-500/10 border-red-500/30",         icon: <Zap size={12} /> },
};

const OPERATOR_SYMBOL: Record<string, string> = {
  gte: ">=", gt: ">", lte: "<=", lt: "<", eq: "=", neq: "!=",
};

function formatMetric(value: string) {
  return METRICS.find(m => m.value === value)?.label ?? value;
}

function formatUnit(metric: string) {
  return METRICS.find(m => m.value === metric)?.unit ?? "";
}

// ─── Default form ─────────────────────────────────────────────────────────────

const DEFAULT_FORM = {
  name: "",
  description: "",
  metric: "risk_score" as string,
  operator: "gte" as string,
  threshold: 70,
  severity: "high" as string,
  enabled: true,
  autoEscalate: false,
  notifyOwner: true,
};

const PAGE_SIZE = 20;

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AlertRulesPage() {
  const [tab, setTab] = useState<"rules" | "history">("rules");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...DEFAULT_FORM });
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // History filters
  const [historyRuleId, setHistoryRuleId] = useState<number | undefined>(undefined);
  const [historyTriggered, setHistoryTriggered] = useState<boolean | undefined>(undefined);
  const [historyPage, setHistoryPage] = useState(0);

  const utils = trpc.useUtils();
  const { data: rules = [], isLoading, refetch } = trpc.alertRules.list.useQuery();

  const { data: historyData, isLoading: historyLoading } = trpc.alertRules.evaluationHistory.useQuery(
    { ruleId: historyRuleId, triggered: historyTriggered, limit: PAGE_SIZE, offset: historyPage * PAGE_SIZE },
    { enabled: tab === "history" }
  );

  const historyRows = historyData?.rows ?? [];
  const historyTotal = historyData?.total ?? 0;
  const totalPages = Math.ceil(historyTotal / PAGE_SIZE);

  const createMutation = trpc.alertRules.create.useMutation({
    onSuccess: () => {
      toast.success("Rule created", { description: `"${form.name}" is now active.` });
      setDialogOpen(false);
      setForm({ ...DEFAULT_FORM });
      utils.alertRules.list.invalidate();
    },
    onError: (e: any) => toast.error("Failed to create rule", { description: e.message }),
  });

  const updateMutation = trpc.alertRules.update.useMutation({
    onSuccess: () => {
      toast.success("Rule updated");
      setDialogOpen(false);
      setEditingId(null);
      setForm({ ...DEFAULT_FORM });
      utils.alertRules.list.invalidate();
    },
    onError: (e: any) => toast.error("Failed to update rule", { description: e.message }),
  });

  const deleteMutation = trpc.alertRules.delete.useMutation({
    onSuccess: () => {
      toast.info("Rule deleted");
      setDeleteId(null);
      utils.alertRules.list.invalidate();
    },
    onError: (e: any) => toast.error("Failed to delete rule", { description: e.message }),
  });

  const toggleMutation = trpc.alertRules.update.useMutation({
    onSuccess: () => utils.alertRules.list.invalidate(),
    onError: (e: any) => toast.error("Toggle failed", { description: e.message }),
  });

  // ── Run Scheduled ──
  const runScheduledMutation = trpc.alertRules.runScheduled.useMutation({
    onSuccess: (res) => {
      toast.success("Scheduled evaluation complete", {
        description: `${res.rulesEvaluated} rules evaluated · ${res.rulesTriggered} triggered · ${res.alertsCreated} alerts created`,
      });
      utils.alertRules.evaluationHistory.invalidate();
    },
    onError: (e: any) => toast.error("Scheduled run failed", { description: e.message }),
  });

  // ── Test Fire ──
  const [testFireRuleId, setTestFireRuleId] = useState<number | null>(null);
  const [testSampleValue, setTestSampleValue] = useState<string>("");
  const [testResult, setTestResult] = useState<{ triggered: boolean; message: string; expression: string } | null>(null);
  const testFireMutation = trpc.alertRules.testFire.useMutation({
    onSuccess: (r) => setTestResult({ triggered: r.triggered, message: r.message, expression: r.expression }),
    onError: (e: any) => toast.error("Test failed", { description: e.message }),
  });

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...DEFAULT_FORM });
    setDialogOpen(true);
  };

  const openEdit = (rule: any) => {
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      description: rule.description ?? "",
      metric: rule.metric,
      operator: rule.operator,
      threshold: rule.threshold,
      severity: rule.severity,
      enabled: rule.enabled,
      autoEscalate: rule.autoEscalate,
      notifyOwner: rule.notifyOwner,
    });
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, ...form, severity: form.severity as any });
    } else {
      createMutation.mutate(form as any);
    }
  };

  const set = (k: string, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  const isPending = createMutation.isPending || updateMutation.isPending;

  const enabledCount = (rules as any[]).filter((r: any) => r.enabled).length;
  const criticalCount = (rules as any[]).filter((r: any) => r.severity === "critical" || r.severity === "high").length;

  return (
    <BISLayout
      title="Alert Rules"
      subtitle="Configure threshold-based triggers and review evaluation history"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => refetch()}>
            <RefreshCw size={11} className={isLoading ? "animate-spin" : ""} /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
            onClick={() => runScheduledMutation.mutate()}
            disabled={runScheduledMutation.isPending}
          >
            {runScheduledMutation.isPending
              ? <Loader2 size={11} className="animate-spin" />
              : <Zap size={11} />}
            Run Now
          </Button>
          {tab === "rules" && (
            <Button size="sm" className="h-7 text-xs gap-1.5" onClick={openCreate}>
              <Plus size={12} /> New Rule
            </Button>
          )}
        </div>
      }
    >
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: "Total Rules",   value: (rules as any[]).length, icon: <Shield size={14} />,       color: "text-blue-400" },
          { label: "Active Rules",  value: enabledCount,            icon: <CheckCircle2 size={14} />, color: "text-emerald-400" },
          { label: "High/Critical", value: criticalCount,           icon: <Zap size={14} />,          color: "text-red-400" },
        ].map(s => (
          <div key={s.label} className="bis-card p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</span>
              <span className={s.color}>{s.icon}</span>
            </div>
            <div className="text-2xl font-mono font-bold text-foreground">{s.value}</div>
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as any)}>
        <TabsList className="mb-4 h-8">
          <TabsTrigger value="rules" className="text-xs gap-1.5 h-6">
            <Shield size={11} /> Rules
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs gap-1.5 h-6">
            <History size={11} /> Trigger History
            {historyTotal > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[9px]">{historyTotal}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Rules Tab ── */}
        <TabsContent value="rules">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 size={20} className="animate-spin mr-2" /> Loading rules...
            </div>
          ) : (rules as any[]).length === 0 ? (
            <div className="bis-card p-12 text-center text-muted-foreground">
              <TrendingUp size={28} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm font-semibold mb-1">No alert rules configured</p>
              <p className="text-xs mb-4">Create your first rule to automate intelligence alerting based on risk thresholds.</p>
              <Button size="sm" className="gap-1.5" onClick={openCreate}><Plus size={12} /> New Rule</Button>
            </div>
          ) : (
            <div className="space-y-2">
              {(rules as any[]).map((rule: any) => {
                const sev = SEVERITY_CONFIG[rule.severity] ?? SEVERITY_CONFIG.medium;
                return (
                  <div key={rule.id} className={cn("bis-card border transition-all", rule.enabled ? "" : "opacity-50")}>
                    <div className="p-4">
                      <div className="flex items-start gap-3">
                        <div className={cn("w-8 h-8 rounded-md border flex items-center justify-center shrink-0 mt-0.5", sev.bg, sev.color)}>
                          {sev.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-foreground">{rule.name}</span>
                            <Badge variant="outline" className={cn("text-[10px] h-4 px-1.5 capitalize", sev.bg, sev.color)}>
                              {rule.severity}
                            </Badge>
                            {rule.autoEscalate && (
                              <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-red-400 border-red-500/30 bg-red-500/5">
                                <Zap size={8} className="mr-0.5" /> Auto-Escalate
                              </Badge>
                            )}
                            {!rule.enabled && (
                              <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-muted-foreground">Disabled</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            <span className="font-mono text-foreground/70">{formatMetric(rule.metric)}</span>
                            {" "}<span className="font-mono text-primary font-semibold">{OPERATOR_SYMBOL[rule.operator] ?? rule.operator}</span>{" "}
                            <span className="font-mono font-bold text-foreground">{rule.threshold}</span>
                            {" "}<span className="text-muted-foreground">{formatUnit(rule.metric)}</span>
                            {" -> "}<span className="capitalize">{rule.severity} alert</span>
                          </p>
                          {rule.description && (
                            <p className="text-[10px] text-muted-foreground mt-1">{rule.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Switch
                            checked={rule.enabled}
                            onCheckedChange={v => toggleMutation.mutate({ id: rule.id, enabled: v })}
                            className="scale-75"
                          />
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => openEdit(rule)}>
                            <Pencil size={11} />
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            className="h-6 w-6 p-0 text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
                            title="Test Rule (dry-run)"
                            onClick={() => {
                              setTestFireRuleId(rule.id);
                              setTestSampleValue("");
                              setTestResult(null);
                            }}
                          >
                            <FlaskConical size={11} />
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            className="h-6 w-6 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            onClick={() => setDeleteId(rule.id)}
                          >
                            <Trash2 size={11} />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Trigger History Tab ── */}
        <TabsContent value="history">
          {/* Filters */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Select
              value={historyRuleId !== undefined ? String(historyRuleId) : "all"}
              onValueChange={v => { setHistoryRuleId(v === "all" ? undefined : Number(v)); setHistoryPage(0); }}
            >
              <SelectTrigger className="h-7 text-xs w-44">
                <SelectValue placeholder="All rules" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All rules</SelectItem>
                {(rules as any[]).map((r: any) => (
                  <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={historyTriggered !== undefined ? String(historyTriggered) : "all"}
              onValueChange={v => { setHistoryTriggered(v === "all" ? undefined : v === "true"); setHistoryPage(0); }}
            >
              <SelectTrigger className="h-7 text-xs w-36">
                <SelectValue placeholder="All outcomes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All outcomes</SelectItem>
                <SelectItem value="true">Triggered</SelectItem>
                <SelectItem value="false">Not triggered</SelectItem>
              </SelectContent>
            </Select>

            <span className="text-[10px] text-muted-foreground">
              {historyTotal} evaluation{historyTotal !== 1 ? "s" : ""}
            </span>
            <Button
              variant="outline" size="sm"
              className="h-7 text-xs gap-1.5 ml-auto"
              disabled={historyRows.length === 0}
              onClick={() => {
                const headers = ['Outcome','Subject Ref','Metric','Value','Threshold','Source','Alert Created','Timestamp'];
                const csvRows = historyRows.map((r: any) => [
                  r.triggered ? 'Triggered' : 'Passed',
                  r.subjectRef ?? '',
                  formatMetric(r.metric),
                  r.value,
                  r.threshold,
                  r.context ?? '',
                  r.alertCreated ? 'Yes' : 'No',
                  new Date(r.createdAt).toISOString(),
                ]);
                const csv = [headers, ...csvRows].map(row => row.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `rule-evaluations-${Date.now()}.csv`;
                a.click(); URL.revokeObjectURL(url);
                toast.success('CSV downloaded');
              }}
            >
              <Download size={11} /> Export CSV
            </Button>
          </div>

          {historyLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 size={20} className="animate-spin mr-2" /> Loading history...
            </div>
          ) : historyRows.length === 0 ? (
            <div className="bis-card p-12 text-center text-muted-foreground">
              <History size={28} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm font-semibold mb-1">No evaluations recorded yet</p>
              <p className="text-xs">Evaluations are logged automatically when investigations, KYC checks, or screenings are processed.</p>
            </div>
          ) : (
            <>
              <div className="bis-card overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/30">
                      <th className="text-left px-3 py-2 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Outcome</th>
                      <th className="text-left px-3 py-2 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Subject</th>
                      <th className="text-left px-3 py-2 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Metric</th>
                      <th className="text-right px-3 py-2 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Value</th>
                      <th className="text-right px-3 py-2 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Threshold</th>
                      <th className="text-left px-3 py-2 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Source</th>
                      <th className="text-left px-3 py-2 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Alert</th>
                      <th className="text-left px-3 py-2 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.map((row: any) => (
                      <tr key={row.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2">
                          {row.triggered ? (
                            <span className="flex items-center gap-1 text-red-400 font-medium">
                              <Zap size={10} /> Triggered
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <XCircle size={10} /> Passed
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-foreground/80 max-w-[120px] truncate">{row.subjectRef}</td>
                        <td className="px-3 py-2 text-foreground/70">{formatMetric(row.metric)}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-foreground">{row.value}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">{row.threshold}</td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[100px] truncate">{row.context ?? "—"}</td>
                        <td className="px-3 py-2">
                          {row.alertCreated ? (
                            <span className="flex items-center gap-1 text-amber-400">
                              <CheckCheck size={10} /> Created
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                          {new Date(row.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-3">
                  <span className="text-[10px] text-muted-foreground">
                    Page {historyPage + 1} of {totalPages}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="outline" size="sm" className="h-6 w-6 p-0"
                      disabled={historyPage === 0}
                      onClick={() => setHistoryPage(p => p - 1)}
                    >
                      <ChevronLeft size={12} />
                    </Button>
                    <Button
                      variant="outline" size="sm" className="h-6 w-6 p-0"
                      disabled={historyPage >= totalPages - 1}
                      onClick={() => setHistoryPage(p => p + 1)}
                    >
                      <ChevronRight size={12} />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={open => { if (!open) { setDialogOpen(false); setEditingId(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield size={15} className="text-primary" />
              {editingId !== null ? "Edit Alert Rule" : "New Alert Rule"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Rule Name <span className="text-red-400">*</span></Label>
              <Input
                className="h-8 text-xs"
                placeholder="e.g. High Risk Score Trigger"
                required
                value={form.name}
                onChange={e => set("name", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                className="text-xs h-16 resize-none"
                placeholder="Optional description of when this rule fires..."
                value={form.description}
                onChange={e => set("description", e.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">Metric <span className="text-red-400">*</span></Label>
                <Select value={form.metric} onValueChange={v => set("metric", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {METRICS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Operator</Label>
                <Select value={form.operator} onValueChange={v => set("operator", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OPERATORS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Threshold ({formatUnit(form.metric)}) <span className="text-red-400">*</span>
                </Label>
                <Input
                  type="number"
                  className="h-8 text-xs font-mono"
                  min={0}
                  max={10000}
                  step={0.1}
                  required
                  value={form.threshold}
                  onChange={e => set("threshold", parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Alert Severity</Label>
                <Select value={form.severity} onValueChange={v => set("severity", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["info","low","medium","high","critical"].map(s => (
                      <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="border-t border-border/40 pt-3 space-y-3">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Behaviour</p>
              {[
                { k: "enabled",      label: "Rule Enabled",          desc: "Evaluate this rule on every risk assessment" },
                { k: "autoEscalate", label: "Auto-Escalate",         desc: "Automatically dispatch a critical field task when triggered" },
                { k: "notifyOwner",  label: "Notify Platform Owner", desc: "Send a push notification to the owner on trigger" },
              ].map(opt => (
                <div key={opt.k} className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-foreground">{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground">{opt.desc}</p>
                  </div>
                  <Switch
                    checked={(form as any)[opt.k]}
                    onCheckedChange={v => set(opt.k, v)}
                  />
                </div>
              ))}
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={isPending} className="gap-1.5">
                {isPending ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />}
                {editingId !== null ? "Save Changes" : "Create Rule"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteId !== null} onOpenChange={open => { if (!open) setDeleteId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <Trash2 size={15} /> Delete Alert Rule
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            This rule will be permanently deleted and will no longer trigger alerts. This action cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              size="sm"
              className="bg-red-500 hover:bg-red-600 text-white gap-1.5"
              disabled={deleteMutation.isPending}
              onClick={() => deleteId !== null && deleteMutation.mutate({ id: deleteId })}
            >
              {deleteMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Test Fire Dialog ── */}
      <Dialog open={testFireRuleId !== null} onOpenChange={open => { if (!open) { setTestFireRuleId(null); setTestResult(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-violet-400">
              <FlaskConical size={15} /> Test Rule (Dry Run)
            </DialogTitle>
          </DialogHeader>
          {testFireRuleId !== null && (() => {
            const rule = (rules as any[]).find((r: any) => r.id === testFireRuleId);
            if (!rule) return null;
            const metricLabel = METRICS.find(m => m.value === rule.metric)?.label ?? rule.metric;
            const unit = METRICS.find(m => m.value === rule.metric)?.unit ?? '';
            return (
              <div className="space-y-4 py-2">
                <div className="p-3 rounded-lg bg-muted/30 border border-border/50 text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Rule:</span>
                    <span className="font-semibold text-foreground">{rule.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Condition:</span>
                    <code className="font-mono text-primary">{metricLabel} {OPERATOR_SYMBOL[rule.operator]} {rule.threshold} {unit}</code>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Severity:</span>
                    <span className={cn("capitalize font-medium", SEVERITY_CONFIG[rule.severity]?.color)}>{rule.severity}</span>
                    {rule.autoEscalate && <span className="text-[9px] bg-red-500/10 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded">Auto-escalate</span>}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Sample {metricLabel} value ({unit})</Label>
                  <Input
                    type="number"
                    placeholder={`e.g. ${rule.threshold}`}
                    value={testSampleValue}
                    onChange={e => { setTestSampleValue(e.target.value); setTestResult(null); }}
                    className="h-8 text-sm"
                  />
                </div>

                {testResult && (
                  <div className={cn(
                    "p-3 rounded-lg border text-xs",
                    testResult.triggered
                      ? "bg-red-500/10 border-red-500/30 text-red-300"
                      : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  )}>
                    <div className="flex items-center gap-2 font-semibold mb-1">
                      {testResult.triggered ? <Zap size={12} /> : <CheckCircle2 size={12} />}
                      {testResult.triggered ? 'WOULD TRIGGER' : 'Would NOT trigger'}
                    </div>
                    <p className="text-[11px] leading-relaxed opacity-90">{testResult.message}</p>
                    <code className="text-[10px] font-mono mt-1 block opacity-70">{testResult.expression}</code>
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setTestFireRuleId(null); setTestResult(null); }}>Close</Button>
            <Button
              size="sm"
              className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5"
              disabled={!testSampleValue.trim() || testFireMutation.isPending}
              onClick={() => {
                if (testFireRuleId !== null && testSampleValue.trim()) {
                  testFireMutation.mutate({ ruleId: testFireRuleId, sampleValue: Number(testSampleValue) });
                }
              }}
            >
              {testFireMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />}
              Run Test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BISLayout>
  );
}
