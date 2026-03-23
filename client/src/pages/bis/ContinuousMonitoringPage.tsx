import React, { useState } from "react";
import {
  RiskBadge, StatusBadge, SectionCard, EmptyState, ScoreGauge
} from "../../components/bis/shared";
import type { MonitoringEnrollment, MonitoringAlert, MonitoringType, RiskLevel } from "../../types/bis";
import BISLayout from '@/components/BISLayout';

// ─────────────────────────────────────────────────────────────────────────────
// Continuous Monitoring Dashboard
// ─────────────────────────────────────────────────────────────────────────────

const MONITOR_TYPE_CONFIG: Record<MonitoringType, {
  label: string; icon: string; description: string;
  nigeriaSource: string; globalSource: string; pricePerMonthUSD: number;
}> = {
  criminal: {
    label: "Criminal Records", icon: "⚖️",
    description: "New arrests, convictions, or charges",
    nigeriaSource: "NPF POSSAP, EFCC, ICPC alerts",
    globalSource: "Court records, PACER (US), ACRO (UK)",
    pricePerMonthUSD: 1.50,
  },
  mvr: {
    label: "Motor Vehicle Records", icon: "🚗",
    description: "New traffic violations, license changes",
    nigeriaSource: "FRSC violation alerts",
    globalSource: "State DMV (US), DVLA (UK), NTSA (KE)",
    pricePerMonthUSD: 0.75,
  },
  sanctions: {
    label: "Sanctions & Watchlists", icon: "🚨",
    description: "OFAC, UN, EU, EFCC, ICPC watchlist additions",
    nigeriaSource: "EFCC, ICPC, NFIU watchlists",
    globalSource: "OFAC, UN, EU, Interpol, World Bank debarment",
    pricePerMonthUSD: 0.25,
  },
  adverse_media: {
    label: "Adverse Media", icon: "📰",
    description: "Negative news mentions in local and global media",
    nigeriaSource: "Punch, Vanguard, Premium Times, Sahara Reporters",
    globalSource: "Reuters, BBC, AP, Google News",
    pricePerMonthUSD: 0.50,
  },
  professional_license: {
    label: "Professional License", icon: "🎓",
    description: "License suspensions, revocations, or renewals",
    nigeriaSource: "MDCN, NBA, ICAN, COREN, NIA, ICAN",
    globalSource: "State licensing boards (US), Professional bodies (UK)",
    pricePerMonthUSD: 0.50,
  },
  court_filings: {
    label: "Court Filings", icon: "🏛️",
    description: "New civil suits, bankruptcy, liens",
    nigeriaSource: "Federal High Court, State High Courts (Lagos, Abuja)",
    globalSource: "PACER (US), HMCTS (UK)",
    pricePerMonthUSD: 1.00,
  },
};

const ALERT_SEVERITY_CONFIG = {
  info:     { label: "Info",     color: "text-blue-700",   bg: "bg-blue-50",   border: "border-blue-200",   icon: "ℹ" },
  warning:  { label: "Warning",  color: "text-amber-700",  bg: "bg-amber-50",  border: "border-amber-200",  icon: "⚠" },
  critical: { label: "Critical", color: "text-red-700",    bg: "bg-red-50",    border: "border-red-200",    icon: "🚨" },
};

// Mock data
const MOCK_ENROLLMENTS: MonitoringEnrollment[] = [
  { enrollmentId: "MON-001", subjectId: "SUB-042", subjectName: "Adebayo Oluwaseun", monitorTypes: ["criminal","sanctions","adverse_media"], enrolledAt: "2024-01-15T00:00:00Z", active: true, lastScannedAt: "2024-03-22T06:00:00Z", alertCount: 2 },
  { enrollmentId: "MON-002", subjectId: "SUB-089", subjectName: "Ngozi Chidinma Okafor", monitorTypes: ["criminal","mvr","professional_license"], enrolledAt: "2024-02-01T00:00:00Z", active: true, lastScannedAt: "2024-03-22T06:00:00Z", alertCount: 0 },
  { enrollmentId: "MON-003", subjectId: "SUB-115", subjectName: "Musa Abdullahi Ibrahim", monitorTypes: ["sanctions","court_filings"], enrolledAt: "2024-02-20T00:00:00Z", active: true, lastScannedAt: "2024-03-22T06:00:00Z", alertCount: 1 },
  { enrollmentId: "MON-004", subjectId: "SUB-201", subjectName: "Emeka Chukwuemeka Ltd", monitorTypes: ["criminal","sanctions","adverse_media","court_filings"], enrolledAt: "2024-03-01T00:00:00Z", active: false, lastScannedAt: "2024-03-10T06:00:00Z", alertCount: 0 },
];

const MOCK_ALERTS: MonitoringAlert[] = [
  { alertId: "ALT-001", enrollmentId: "MON-001", subjectId: "SUB-042", subjectName: "Adebayo Oluwaseun", monitorType: "adverse_media", severity: "warning", title: "Adverse media mention detected", description: "Subject mentioned in Premium Times article regarding a business dispute. Not a criminal matter.", eventDate: "2024-03-20", source: "Premium Times Nigeria", detectedAt: "2024-03-21T08:30:00Z" },
  { alertId: "ALT-002", enrollmentId: "MON-001", subjectId: "SUB-042", subjectName: "Adebayo Oluwaseun", monitorType: "criminal", severity: "critical", title: "EFCC watchlist addition", description: "Subject's name appears on EFCC published watchlist for advance fee fraud investigation.", eventDate: "2024-03-18", source: "EFCC Watchlist", detectedAt: "2024-03-19T06:00:00Z" },
  { alertId: "ALT-003", enrollmentId: "MON-003", subjectId: "SUB-115", subjectName: "Musa Abdullahi Ibrahim", monitorType: "court_filings", severity: "info", title: "New civil suit filed", description: "A civil debt recovery suit has been filed against the subject at Lagos State High Court.", eventDate: "2024-03-15", source: "Lagos State High Court", detectedAt: "2024-03-16T10:00:00Z" },
];

// ─────────────────────────────────────────────────────────────────────────────

interface EnrollFormData {
  subjectId: string;
  subjectName: string;
  country: string;
  monitorTypes: MonitoringType[];
  expiresInMonths: number;
}

function ContinuousMonitoringPageInner() {
  const [view, setView] = useState<"dashboard" | "enroll" | "alerts">("dashboard");
  const [enrollments] = useState<MonitoringEnrollment[]>(MOCK_ENROLLMENTS);
  const [alerts] = useState<MonitoringAlert[]>(MOCK_ALERTS);
  const [selectedEnrollment, setSelectedEnrollment] = useState<MonitoringEnrollment | null>(null);
  const [form, setForm] = useState<EnrollFormData>({
    subjectId: "", subjectName: "", country: "NG",
    monitorTypes: ["criminal", "sanctions"],
    expiresInMonths: 12,
  });
  const [loading, setLoading] = useState(false);
  const [enrolled, setEnrolled] = useState(false);

  const activeCount = enrollments.filter(e => e.active).length;
  const criticalAlerts = alerts.filter(a => a.severity === "critical" && !a.acknowledgedAt).length;
  const unacknowledgedAlerts = alerts.filter(a => !a.acknowledgedAt).length;

  const toggleMonitorType = (type: MonitoringType) => {
    setForm(f => ({
      ...f,
      monitorTypes: f.monitorTypes.includes(type)
        ? f.monitorTypes.filter(t => t !== type)
        : [...f.monitorTypes, type],
    }));
  };

  const monthlyTotal = form.monitorTypes.reduce((sum, t) => sum + MONITOR_TYPE_CONFIG[t].pricePerMonthUSD, 0);

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await new Promise(r => setTimeout(r, 1500));
    setLoading(false);
    setEnrolled(true);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white text-xl">👁</div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Continuous Monitoring</h1>
              <p className="text-sm text-slate-500">Real-time alerts on criminal, sanctions, media, and license changes</p>
            </div>
          </div>
          <div className="flex gap-2">
            {["dashboard", "enroll", "alerts"].map(v => (
              <button key={v} onClick={() => setView(v as any)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${view === v ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {v === "alerts" && unacknowledgedAlerts > 0 ? (
                  <span className="flex items-center gap-1.5">
                    Alerts
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${criticalAlerts > 0 ? "bg-red-500 text-white" : "bg-amber-400 text-white"}`}>
                      {unacknowledgedAlerts}
                    </span>
                  </span>
                ) : v}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">

        {/* Dashboard View */}
        {view === "dashboard" && (
          <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Active Enrollments", value: activeCount, icon: "👥", color: "text-indigo-600" },
                { label: "Unread Alerts", value: unacknowledgedAlerts, icon: "🔔", color: unacknowledgedAlerts > 0 ? "text-amber-600" : "text-slate-600" },
                { label: "Critical Alerts", value: criticalAlerts, icon: "🚨", color: criticalAlerts > 0 ? "text-red-600" : "text-slate-600" },
                { label: "Last Scan", value: "6h ago", icon: "⟳", color: "text-emerald-600" },
              ].map(stat => (
                <div key={stat.label} className="bg-white rounded-2xl border border-slate-200 p-4 text-center">
                  <div className="text-2xl mb-1">{stat.icon}</div>
                  <div className={`text-3xl font-bold ${stat.color}`}>{stat.value}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Enrollments List */}
            <SectionCard title="Active Enrollments" icon="👥">
              <div className="space-y-3">
                {enrollments.map(enr => (
                  <div key={enr.enrollmentId}
                    className="flex items-center justify-between p-4 bg-slate-50 rounded-xl hover:bg-slate-100 cursor-pointer transition-all"
                    onClick={() => { setSelectedEnrollment(enr); setView("alerts"); }}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full ${enr.active ? "bg-emerald-500" : "bg-slate-300"}`} />
                      <div>
                        <div className="font-semibold text-sm text-slate-800">{enr.subjectName}</div>
                        <div className="text-xs text-slate-500">{enr.subjectId} · Enrolled {new Date(enr.enrolledAt).toLocaleDateString()}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex gap-1">
                        {enr.monitorTypes.map(t => (
                          <span key={t} title={MONITOR_TYPE_CONFIG[t].label} className="text-sm">{MONITOR_TYPE_CONFIG[t].icon}</span>
                        ))}
                      </div>
                      {enr.alertCount > 0 && (
                        <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
                          {enr.alertCount} alert{enr.alertCount > 1 ? "s" : ""}
                        </span>
                      )}
                      <StatusBadge status={enr.active ? "completed" : "cancelled"} size="sm" />
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setView("enroll")}
                className="mt-4 w-full border-2 border-dashed border-indigo-300 text-indigo-600 hover:bg-indigo-50 font-medium py-3 rounded-xl text-sm transition-all"
              >
                + Enroll New Subject
              </button>
            </SectionCard>

            {/* Recent Alerts Preview */}
            {alerts.length > 0 && (
              <SectionCard title="Recent Alerts" icon="🔔">
                <div className="space-y-3">
                  {alerts.slice(0, 3).map(alert => {
                    const sev = ALERT_SEVERITY_CONFIG[alert.severity];
                    return (
                      <div key={alert.alertId} className={`flex items-start gap-3 p-3 rounded-xl border ${sev.bg} ${sev.border}`}>
                        <span className="text-lg">{sev.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className={`font-semibold text-sm ${sev.color}`}>{alert.title}</div>
                          <div className="text-xs text-slate-600 mt-0.5">{alert.subjectName} · {alert.source}</div>
                          <div className="text-xs text-slate-500 mt-0.5">{alert.description.slice(0, 80)}...</div>
                        </div>
                        <div className="text-xs text-slate-400 shrink-0">{new Date(alert.detectedAt).toLocaleDateString()}</div>
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => setView("alerts")} className="mt-3 text-sm text-indigo-600 hover:underline">
                  View all {alerts.length} alerts →
                </button>
              </SectionCard>
            )}
          </div>
        )}

        {/* Enroll View */}
        {view === "enroll" && (
          <div className="space-y-6">
            {enrolled ? (
              <div className="bg-emerald-50 border-2 border-emerald-400 rounded-2xl p-8 text-center">
                <div className="text-4xl mb-3">✅</div>
                <h2 className="text-xl font-bold text-emerald-800">Enrollment Successful</h2>
                <p className="text-emerald-700 text-sm mt-1">
                  {form.subjectName} is now enrolled in continuous monitoring.
                  Alerts will be delivered in real-time.
                </p>
                <div className="flex gap-3 mt-6 justify-center">
                  <button onClick={() => { setEnrolled(false); setView("dashboard"); }} className="bg-emerald-600 text-white font-medium px-6 py-2.5 rounded-xl text-sm">
                    Back to Dashboard
                  </button>
                  <button onClick={() => { setEnrolled(false); setForm(f => ({ ...f, subjectId: "", subjectName: "" })); }} className="bg-white border border-slate-300 text-slate-700 font-medium px-6 py-2.5 rounded-xl text-sm">
                    Enroll Another
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleEnroll} className="space-y-6">
                <SectionCard title="Subject to Monitor" icon="👤">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1">
                      <label className="text-sm font-medium text-slate-700">Subject ID <span className="text-red-500">*</span></label>
                      <input type="text" required value={form.subjectId}
                        onChange={e => setForm(f => ({ ...f, subjectId: e.target.value }))}
                        placeholder="e.g. INV-2024-0042"
                        className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-sm font-medium text-slate-700">Subject Name <span className="text-red-500">*</span></label>
                      <input type="text" required value={form.subjectName}
                        onChange={e => setForm(f => ({ ...f, subjectName: e.target.value }))}
                        placeholder="Full legal name"
                        className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-sm font-medium text-slate-700">Monitoring Duration</label>
                      <select value={form.expiresInMonths}
                        onChange={e => setForm(f => ({ ...f, expiresInMonths: Number(e.target.value) }))}
                        className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                      >
                        <option value={3}>3 months</option>
                        <option value={6}>6 months</option>
                        <option value={12}>12 months (recommended)</option>
                        <option value={24}>24 months</option>
                        <option value={0}>Indefinite</option>
                      </select>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="Select Monitoring Types" icon="🔍">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {(Object.entries(MONITOR_TYPE_CONFIG) as [MonitoringType, typeof MONITOR_TYPE_CONFIG[MonitoringType]][]).map(([type, cfg]) => (
                      <button
                        key={type} type="button"
                        onClick={() => toggleMonitorType(type)}
                        className={`text-left p-4 rounded-xl border-2 transition-all ${
                          form.monitorTypes.includes(type) ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white hover:border-slate-300"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{cfg.icon}</span>
                            <div>
                              <div className="font-semibold text-sm text-slate-800">{cfg.label}</div>
                              <div className="text-xs text-slate-500">{cfg.description}</div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold text-indigo-700">${cfg.pricePerMonthUSD}/mo</div>
                            {form.monitorTypes.includes(type) && <span className="text-indigo-600 font-bold">✓</span>}
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          🇳🇬 {cfg.nigeriaSource}
                        </div>
                      </button>
                    ))}
                  </div>

                  {form.monitorTypes.length > 0 && (
                    <div className="mt-4 bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-indigo-800 text-sm">
                          {form.monitorTypes.length} monitoring type{form.monitorTypes.length > 1 ? "s" : ""} selected
                        </div>
                        <div className="text-indigo-600 text-xs mt-0.5">
                          {form.expiresInMonths > 0 ? `Total: $${(monthlyTotal * form.expiresInMonths).toFixed(2)} for ${form.expiresInMonths} months` : "Indefinite monitoring"}
                        </div>
                      </div>
                      <div className="text-2xl font-bold text-indigo-700">${monthlyTotal.toFixed(2)}/mo</div>
                    </div>
                  )}
                </SectionCard>

                <div className="flex gap-3">
                  <button type="button" onClick={() => setView("dashboard")} className="flex-1 bg-white border border-slate-300 text-slate-700 font-medium py-3 rounded-xl text-sm">
                    Cancel
                  </button>
                  <button type="submit" disabled={loading || form.monitorTypes.length === 0}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                    {loading ? <><span className="animate-spin">⟳</span> Enrolling...</> : "Enroll in Monitoring ✓"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Alerts View */}
        {view === "alerts" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">
                {selectedEnrollment ? `Alerts — ${selectedEnrollment.subjectName}` : "All Alerts"}
              </h2>
              {selectedEnrollment && (
                <button onClick={() => setSelectedEnrollment(null)} className="text-sm text-indigo-600 hover:underline">
                  ← All subjects
                </button>
              )}
            </div>

            {alerts.length === 0 ? (
              <EmptyState icon="✅" title="No alerts" description="No monitoring alerts have been triggered. All subjects are clear." />
            ) : (
              <div className="space-y-4">
                {alerts
                  .filter(a => !selectedEnrollment || a.enrollmentId === selectedEnrollment.enrollmentId)
                  .sort((a, b) => {
                    const sev = { critical: 3, warning: 2, info: 1 };
                    return sev[b.severity] - sev[a.severity];
                  })
                  .map(alert => {
                    const sev = ALERT_SEVERITY_CONFIG[alert.severity];
                    const monCfg = MONITOR_TYPE_CONFIG[alert.monitorType];
                    return (
                      <div key={alert.alertId} className={`bg-white rounded-2xl border-2 ${sev.border} shadow-sm overflow-hidden`}>
                        <div className={`px-5 py-3 flex items-center justify-between ${sev.bg}`}>
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{sev.icon}</span>
                            <span className={`font-bold text-sm ${sev.color}`}>{sev.label} Alert</span>
                            <span className="text-slate-500 text-xs">·</span>
                            <span className="text-xs text-slate-600">{monCfg.icon} {monCfg.label}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {!alert.acknowledgedAt && (
                              <span className="text-xs bg-white/60 text-slate-600 px-2 py-0.5 rounded-full font-medium">Unread</span>
                            )}
                            <span className="text-xs text-slate-400">{new Date(alert.detectedAt).toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="p-5">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <h3 className="font-bold text-slate-900">{alert.title}</h3>
                              <p className="text-sm text-slate-600 mt-1">{alert.description}</p>
                              <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                                <span>👤 {alert.subjectName}</span>
                                <span>📅 Event: {alert.eventDate}</span>
                                <span>🔍 Source: {alert.source}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2 mt-4">
                            <button className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-all">
                              ✓ Acknowledge
                            </button>
                            <button className="bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-all">
                              📋 Add Note
                            </button>
                            {alert.severity === "critical" && (
                              <button className="bg-red-50 hover:bg-red-100 text-red-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-all">
                                🚨 Escalate
                              </button>
                            )}
                            <button className="bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-all">
                              🔒 Activate Kill Switch
                            </button>
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
