// ContinuousMonitoringPage — live tRPC-backed monitoring dashboard
import { useState, useMemo } from 'react';
import {
  RiskBadge, StatusBadge, SectionCard, EmptyState
} from "../../components/bis/shared";
import BISLayout from '@/components/BISLayout';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ─── Config ───────────────────────────────────────────────────────────────────

const MONITOR_TYPE_CONFIG: Record<string, {
  label: string; icon: string; description: string;
  nigeriaSource: string; pricePerMonthUSD: number;
}> = {
  sanctions: {
    label: "Sanctions & Watchlists", icon: "🚨",
    description: "OFAC, UN, EU, EFCC, ICPC watchlist additions",
    nigeriaSource: "EFCC, ICPC, NFIU watchlists",
    pricePerMonthUSD: 0.25,
  },
  pep: {
    label: "PEP Screening", icon: "🏛️",
    description: "Politically exposed person status changes",
    nigeriaSource: "INEC, EFCC, ICPC databases",
    pricePerMonthUSD: 0.50,
  },
  adverse_media: {
    label: "Adverse Media", icon: "📰",
    description: "Negative news mentions in local and global media",
    nigeriaSource: "Punch, Vanguard, Premium Times, Sahara Reporters",
    pricePerMonthUSD: 0.50,
  },
  social: {
    label: "Social Media", icon: "📱",
    description: "Social media activity and sentiment monitoring",
    nigeriaSource: "Twitter, Facebook, LinkedIn, Instagram",
    pricePerMonthUSD: 0.75,
  },
  transaction: {
    label: "Transaction Monitoring", icon: "💳",
    description: "Unusual financial transaction patterns",
    nigeriaSource: "NFIU, CBN transaction reports",
    pricePerMonthUSD: 1.00,
  },
  biometric: {
    label: "Biometric Verification", icon: "🔍",
    description: "Biometric identity verification checks",
    nigeriaSource: "NIN/NIMC, BVN databases",
    pricePerMonthUSD: 1.50,
  },
};

const SEVERITY_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
  info:     { label: "Info",     color: "text-blue-700",   bg: "bg-blue-50",   border: "border-blue-200",   icon: "ℹ" },
  warning:  { label: "Warning",  color: "text-amber-700",  bg: "bg-amber-50",  border: "border-amber-200",  icon: "⚠" },
  critical: { label: "Critical", color: "text-red-700",    bg: "bg-red-50",    border: "border-red-200",    icon: "🚨" },
  high:     { label: "High",     color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-200", icon: "🔴" },
  low:      { label: "Low",      color: "text-emerald-700",bg: "bg-emerald-50",border: "border-emerald-200",icon: "✅" },
};

// ─── Main Page ────────────────────────────────────────────────────────────────

function ContinuousMonitoringPageInner() {
  const [view, setView] = useState<"dashboard" | "enroll" | "alerts">("dashboard");
  const [selectedMonitorId, setSelectedMonitorId] = useState<number | null>(null);
  const [form, setForm] = useState({
    subjectName: '',
    subjectRef: '',
    type: 'sanctions' as string,
    frequency: 'daily',
    expiresInMonths: 12,
  });
  const [enrolled, setEnrolled] = useState(false);

  const utils = trpc.useUtils();

  const { data: monitors = [], isLoading: monitorsLoading, refetch: refetchMonitors } = trpc.monitors.list.useQuery({
    limit: 100,
  });

  const { data: alertList = [], isLoading: alertsLoading, refetch: refetchAlerts } = trpc.alerts.list.useQuery({
    limit: 100,
  });

  const createMonitorMutation = trpc.monitors.create.useMutation({
    onSuccess: () => {
      setEnrolled(true);
      utils.monitors.list.invalidate();
    },
    onError: (e) => toast.error('Enrollment failed', { description: e.message }),
  });

  const acknowledgeMutation = trpc.alerts.acknowledge.useMutation({
    onSuccess: () => utils.alerts.list.invalidate(),
    onError: (e) => toast.error('Failed to acknowledge', { description: e.message }),
  });

  const activeMonitors = (monitors as any[]).filter((m: any) => m.status === 'active');
  const unacknowledgedAlerts = (alertList as any[]).filter((a: any) => !a.acknowledged);
  const criticalAlerts = unacknowledgedAlerts.filter((a: any) => a.severity === 'critical');

  const monthlyTotal = MONITOR_TYPE_CONFIG[form.type]?.pricePerMonthUSD ?? 0;

  const handleEnroll = (e: React.FormEvent) => {
    e.preventDefault();
    const expiresAt = form.expiresInMonths > 0
      ? new Date(Date.now() + form.expiresInMonths * 30 * 24 * 60 * 60 * 1000)
      : undefined;
    createMonitorMutation.mutate({
      subjectName: form.subjectName,
      subjectRef: form.subjectRef || undefined,
      type: form.type as any,
      frequency: form.frequency,
      expiresAt,
    });
  };

  const selectedMonitor = selectedMonitorId
    ? (monitors as any[]).find((m: any) => m.id === selectedMonitorId)
    : null;

  const filteredAlerts = selectedMonitor
    ? (alertList as any[]).filter((a: any) => a.investigationId === selectedMonitor.investigationId)
    : alertList as any[];

  const isLoading = monitorsLoading || alertsLoading;

  return (
    <div className="min-h-screen bg-muted">
      {/* Header */}
      <div className="bg-card border-b border-border px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white text-xl">👁</div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Continuous Monitoring</h1>
              <p className="text-sm text-muted-foreground">Real-time alerts on sanctions, PEP, media, and transaction changes</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => { refetchMonitors(); refetchAlerts(); }}>
              <RefreshCw size={11} className={isLoading ? 'animate-spin' : ''} /> Refresh
            </Button>
            {["dashboard", "enroll", "alerts"].map(v => (
              <button key={v} onClick={() => setView(v as any)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${view === v ? "bg-indigo-600 text-white" : "text-muted-foreground hover:bg-muted"}`}
              >
                {v === "alerts" && unacknowledgedAlerts.length > 0 ? (
                  <span className="flex items-center gap-1.5">
                    Alerts
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${criticalAlerts.length > 0 ? "bg-red-500 text-white" : "bg-amber-400 text-white"}`}>
                      {unacknowledgedAlerts.length}
                    </span>
                  </span>
                ) : v}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">

        {isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 size={24} className="animate-spin mr-2" /> Loading monitoring data…
          </div>
        )}

        {/* Dashboard View */}
        {!isLoading && view === "dashboard" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Active Monitors", value: activeMonitors.length, icon: "👥", color: "text-indigo-600" },
                { label: "Unread Alerts", value: unacknowledgedAlerts.length, icon: "🔔", color: unacknowledgedAlerts.length > 0 ? "text-amber-600" : "text-muted-foreground" },
                { label: "Critical Alerts", value: criticalAlerts.length, icon: "🚨", color: criticalAlerts.length > 0 ? "text-red-600" : "text-muted-foreground" },
                { label: "Total Monitors", value: (monitors as any[]).length, icon: "📊", color: "text-emerald-600" },
              ].map(stat => (
                <div key={stat.label} className="bg-card rounded-2xl border border-border p-4 text-center">
                  <div className="text-2xl mb-1">{stat.icon}</div>
                  <div className={`text-3xl font-bold ${stat.color}`}>{stat.value}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{stat.label}</div>
                </div>
              ))}
            </div>

            <SectionCard title="Active Monitors" icon="👥">
              <div className="space-y-3">
                {(monitors as any[]).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No monitors enrolled yet.</p>
                ) : (monitors as any[]).map((m: any) => (
                  <div key={m.id}
                    className="flex items-center justify-between p-4 bg-muted rounded-xl hover:bg-muted/80 cursor-pointer transition-all"
                    onClick={() => { setSelectedMonitorId(m.id); setView("alerts"); }}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full ${m.status === 'active' ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                      <div>
                        <div className="font-semibold text-sm text-foreground">{m.subjectName}</div>
                        <div className="text-xs text-muted-foreground">
                          {m.monitorRef} · {MONITOR_TYPE_CONFIG[m.type]?.label ?? m.type} · {m.frequency}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{MONITOR_TYPE_CONFIG[m.type]?.icon ?? '🔍'}</span>
                      {(m.alertCount ?? 0) > 0 && (
                        <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
                          {m.alertCount} alert{m.alertCount > 1 ? "s" : ""}
                        </span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        m.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                        m.status === 'paused' ? 'bg-amber-100 text-amber-700' :
                        m.status === 'triggered' ? 'bg-red-100 text-red-700' :
                        'bg-muted text-muted-foreground'
                      }`}>{m.status}</span>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => setView("enroll")}
                className="mt-4 w-full border-2 border-dashed border-indigo-300 text-indigo-600 hover:bg-indigo-50 font-medium py-3 rounded-xl text-sm transition-all flex items-center justify-center gap-2">
                <Plus size={14} /> Enroll New Subject
              </button>
            </SectionCard>

            {(alertList as any[]).length > 0 && (
              <SectionCard title="Recent Alerts" icon="🔔">
                <div className="space-y-3">
                  {(alertList as any[]).slice(0, 3).map((alert: any) => {
                    const sev = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.info;
                    return (
                      <div key={alert.id} className={`flex items-start gap-3 p-3 rounded-xl border ${sev.bg} ${sev.border}`}>
                        <span className="text-lg">{sev.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className={`font-semibold text-sm ${sev.color}`}>{alert.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{alert.sourceService ?? '—'}</div>
                          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{alert.body}</div>
                        </div>
                        <div className="text-xs text-muted-foreground shrink-0">{new Date(alert.createdAt).toLocaleDateString()}</div>
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => setView("alerts")} className="mt-3 text-sm text-indigo-600 hover:underline">
                  View all {(alertList as any[]).length} alerts →
                </button>
              </SectionCard>
            )}
          </div>
        )}

        {/* Enroll View */}
        {!isLoading && view === "enroll" && (
          <div className="space-y-6">
            {enrolled ? (
              <div className="bg-emerald-50 border-2 border-emerald-400 rounded-2xl p-8 text-center">
                <div className="text-4xl mb-3">✅</div>
                <h2 className="text-xl font-bold text-emerald-800">Enrollment Successful</h2>
                <p className="text-emerald-700 text-sm mt-1">
                  {form.subjectName} is now enrolled in continuous monitoring. Alerts will be delivered in real-time.
                </p>
                <div className="flex gap-3 mt-6 justify-center">
                  <button onClick={() => { setEnrolled(false); setView("dashboard"); }} className="bg-emerald-600 text-white font-medium px-6 py-2.5 rounded-xl text-sm">
                    Back to Dashboard
                  </button>
                  <button onClick={() => { setEnrolled(false); setForm(f => ({ ...f, subjectName: '', subjectRef: '' })); }} className="bg-card border border-border text-foreground font-medium px-6 py-2.5 rounded-xl text-sm">
                    Enroll Another
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleEnroll} className="space-y-6">
                <SectionCard title="Subject to Monitor" icon="👤">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1">
                      <label className="text-sm font-medium text-foreground">Subject Name <span className="text-red-500">*</span></label>
                      <input type="text" required value={form.subjectName}
                        onChange={e => setForm(f => ({ ...f, subjectName: e.target.value }))}
                        placeholder="Full legal name"
                        className="border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-sm font-medium text-foreground">Subject Reference (optional)</label>
                      <input type="text" value={form.subjectRef}
                        onChange={e => setForm(f => ({ ...f, subjectRef: e.target.value }))}
                        placeholder="e.g. INV-2026-0042 or NIN"
                        className="border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-sm font-medium text-foreground">Check Frequency</label>
                      <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}
                        className="border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <option value="hourly">Hourly</option>
                        <option value="daily">Daily (recommended)</option>
                        <option value="weekly">Weekly</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-sm font-medium text-foreground">Monitoring Duration</label>
                      <select value={form.expiresInMonths} onChange={e => setForm(f => ({ ...f, expiresInMonths: Number(e.target.value) }))}
                        className="border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <option value={3}>3 months</option>
                        <option value={6}>6 months</option>
                        <option value={12}>12 months (recommended)</option>
                        <option value={24}>24 months</option>
                        <option value={0}>Indefinite</option>
                      </select>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="Select Monitoring Type" icon="🔍">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {Object.entries(MONITOR_TYPE_CONFIG).map(([type, cfg]) => (
                      <button key={type} type="button" onClick={() => setForm(f => ({ ...f, type }))}
                        className={`text-left p-4 rounded-xl border-2 transition-all ${
                          form.type === type ? "border-indigo-500 bg-indigo-50" : "border-border bg-card hover:border-primary/40"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{cfg.icon}</span>
                            <div>
                              <div className="font-semibold text-sm text-foreground">{cfg.label}</div>
                              <div className="text-xs text-muted-foreground">{cfg.description}</div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold text-indigo-700">${cfg.pricePerMonthUSD}/mo</div>
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">🇳🇬 {cfg.nigeriaSource}</div>
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-indigo-800 text-sm">
                        {MONITOR_TYPE_CONFIG[form.type]?.label} selected
                      </div>
                      <div className="text-indigo-600 text-xs mt-0.5">
                        {form.expiresInMonths > 0 ? `Total: $${(monthlyTotal * form.expiresInMonths).toFixed(2)} for ${form.expiresInMonths} months` : "Indefinite monitoring"}
                      </div>
                    </div>
                    <div className="text-2xl font-bold text-indigo-700">${monthlyTotal.toFixed(2)}/mo</div>
                  </div>
                </SectionCard>

                <div className="flex gap-3">
                  <button type="button" onClick={() => setView("dashboard")} className="flex-1 bg-card border border-border text-foreground font-medium py-3 rounded-xl text-sm">
                    Cancel
                  </button>
                  <button type="submit" disabled={createMonitorMutation.isPending || !form.subjectName}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-muted text-white font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2">
                    {createMonitorMutation.isPending ? <><Loader2 size={14} className="animate-spin" /> Enrolling…</> : "Enroll in Monitoring ✓"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Alerts View */}
        {!isLoading && view === "alerts" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground">
                {selectedMonitor ? `Alerts — ${selectedMonitor.subjectName}` : "All Alerts"}
              </h2>
              {selectedMonitor && (
                <button onClick={() => setSelectedMonitorId(null)} className="text-sm text-indigo-600 hover:underline">
                  ← All subjects
                </button>
              )}
            </div>

            {filteredAlerts.length === 0 ? (
              <EmptyState icon="✅" title="No alerts" description="No monitoring alerts have been triggered. All subjects are clear." />
            ) : (
              <div className="space-y-4">
                {[...filteredAlerts]
                  .sort((a: any, b: any) => {
                    const sev: Record<string, number> = { critical: 4, high: 3, warning: 2, info: 1, low: 0 };
                    return (sev[b.severity] ?? 0) - (sev[a.severity] ?? 0);
                  })
                  .map((alert: any) => {
                    const sev = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.info;
                    return (
                      <div key={alert.id} className={`bg-card rounded-2xl border-2 ${sev.border} shadow-sm overflow-hidden`}>
                        <div className={`px-5 py-3 flex items-center justify-between ${sev.bg}`}>
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{sev.icon}</span>
                            <span className={`font-bold text-sm ${sev.color}`}>{sev.label} Alert</span>
                            {alert.type && <><span className="text-muted-foreground text-xs">·</span><span className="text-xs text-muted-foreground">{alert.type}</span></>}
                          </div>
                          <div className="flex items-center gap-2">
                            {!alert.acknowledged && (
                              <span className="text-xs bg-card/60 text-muted-foreground px-2 py-0.5 rounded-full font-medium">Unread</span>
                            )}
                            <span className="text-xs text-muted-foreground">{new Date(alert.createdAt).toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="p-5">
                          <h3 className="font-bold text-foreground">{alert.title}</h3>
                          <p className="text-sm text-muted-foreground mt-1">{alert.body}</p>
                          {alert.sourceService && (
                            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                              <span>🔍 Source: {alert.sourceService}</span>
                            </div>
                          )}
                          <div className="flex gap-2 mt-4">
                            {!alert.acknowledged && (
                              <button
                                onClick={() => acknowledgeMutation.mutate({ id: alert.id })}
                                disabled={acknowledgeMutation.isPending}
                                className="bg-muted hover:bg-muted/80 text-foreground text-xs font-medium px-3 py-1.5 rounded-lg transition-all">
                                ✓ Acknowledge
                              </button>
                            )}
                            {alert.severity === "critical" && (
                              <button onClick={() => toast.info('Escalation workflow coming soon')}
                                className="bg-red-50 hover:bg-red-100 text-red-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-all">
                                🚨 Escalate
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ContinuousMonitoringPage() {
  return (
    <BISLayout>
      <ContinuousMonitoringPageInner />
    </BISLayout>
  );
}
