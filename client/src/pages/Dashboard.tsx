// BIS Dashboard — merges TourismPay BISDashboard + standalone BIS analytics
// Design: Forensic Intelligence Dark — command center overview

import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Shield, Search, CheckCircle, AlertTriangle, TrendingUp, RefreshCw,
  FileDown, Eye, Clock, Flag, Activity, Fingerprint, Users, Database,
  Zap, BarChart3, ArrowUpRight, ArrowDownRight, ChevronRight, Radio, MessageSquare
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, AreaChart, Area, Legend
} from "recharts";
import BISLayout from "@/components/BISLayout";
import {
  mockInvestigations, mockAlerts, mockAgents, mockDataSources,
  dashboardStats, getRiskColor, getStatusBadgeClass, formatDateTime,
  type RiskLevel
} from "@/lib/mockData";

// ─── Mini stat card ────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, icon, trend, color = "blue"
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ReactNode; trend?: number; color?: "blue" | "green" | "red" | "amber";
}) {
  const colors = {
    blue:  "text-blue-400 bg-blue-500/10 border-blue-500/20",
    green: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    red:   "text-red-400 bg-red-500/10 border-red-500/20",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  };
  return (
    <div className="stat-card hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between">
        <div className={`p-2 rounded-md border ${colors[color]}`}>{icon}</div>
        {trend !== undefined && (
          <span className={`flex items-center gap-0.5 text-xs font-mono ${trend >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {trend >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div className="mt-3">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

// ─── Risk score ring ───────────────────────────────────────────────────────
function RiskRing({ score, size = 56 }: { score: number; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 80 ? "#f87171" : score >= 60 ? "#fb923c" : score >= 30 ? "#fbbf24" : "#34d399";
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border)" strokeWidth={4} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={4}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`} />
      <text x={size/2} y={size/2 + 4} textAnchor="middle" fontSize={11} fontFamily="JetBrains Mono, monospace" fontWeight={600} fill={color}>
        {score}
      </text>
    </svg>
  );
}

// ─── Trend data ────────────────────────────────────────────────────────────
const riskTrend = [
  { week: "W1", avg: 38, flagged: 2 }, { week: "W2", avg: 42, flagged: 3 },
  { week: "W3", avg: 35, flagged: 1 }, { week: "W4", avg: 51, flagged: 5 },
  { week: "W5", avg: 44, flagged: 3 }, { week: "W6", avg: 39, flagged: 2 },
  { week: "W7", avg: 47, flagged: 4 }, { week: "W8", avg: 34, flagged: 1 },
  { week: "W9", avg: 52, flagged: 6 }, { week: "W10", avg: 41, flagged: 3 },
  { week: "W11", avg: 36, flagged: 2 }, { week: "W12", avg: 34, flagged: 2 },
];

const tierBreakdown = [
  { tier: "Basic", count: 1203, color: "#60a5fa" },
  { tier: "Standard", count: 987, color: "#a78bfa" },
  { tier: "Comprehensive", count: 657, color: "#34d399" },
];

const sourceActivity = [
  { name: "NIMC", checks: 1247 }, { name: "BVN", checks: 892 },
  { name: "INEC", checks: 678 }, { name: "OFAC", checks: 1891 },
  { name: "EFCC", checks: 456 }, { name: "CAC", checks: 334 },
  { name: "FRSC", checks: 289 }, { name: "MTN", checks: 567 },
];

// ─── Ticker seed data ─────────────────────────────────────────────────────
const TICKER_SEED = [
  { id: 't1', type: 'alert' as const, text: 'CRITICAL: Emeka Nwosu appears on OFAC SDN list — BIS-2026-0004', time: '11:02' },
  { id: 't2', type: 'mention' as const, text: 'NEW MENTION: @lagosinsider tweets about Adebayo Okafor court appearance', time: '10:58' },
  { id: 't3', type: 'report' as const, text: 'INCOMING REPORT via WhatsApp: Land fraud suspect in Ikeja, Lagos', time: '10:55' },
  { id: 't4', type: 'alert' as const, text: 'HIGH: Fatima Al-Hassan classified as PEP — ward-level political official', time: '10:51' },
  { id: 't5', type: 'mention' as const, text: 'NEW MENTION: Zenith Logistics Ltd mentioned in Punch investigative report', time: '10:47' },
  { id: 't6', type: 'report' as const, text: 'INCOMING REPORT via USSD: Fraud suspect in Kano Municipal — N5M collected', time: '10:43' },
  { id: 't7', type: 'alert' as const, text: 'MEDIUM: Zenith Logistics Ltd director has 2019 fraud charge on record', time: '10:39' },
  { id: 't8', type: 'mention' as const, text: 'NEW MENTION: TikTok video circulating about Ponzi scheme operator in Abuja', time: '10:35' },
];

const TICKER_LIVE_POOL = [
  { type: 'alert' as const, text: 'NEW FLAG: Ibrahim Musa — document tampering score 78.4% on passport scan' },
  { type: 'mention' as const, text: 'NEW MENTION: Facebook post alleges fraud by Chidinma Eze in Enugu' },
  { type: 'report' as const, text: 'INCOMING REPORT via Telegram: Cryptocurrency scam — 500+ victims, ₦200M' },
  { type: 'alert' as const, text: 'CRITICAL: New INTERPOL Red Notice match for subject in BIS-2026-0011' },
  { type: 'mention' as const, text: 'NEW MENTION: LinkedIn post exposes fake recruitment agency in Surulere' },
  { type: 'report' as const, text: 'INCOMING REPORT via SMS: School fees fraud — 30 families affected in Enugu' },
];

let tickerLiveIdx = 0;

// Read a CSS variable from :root at runtime so charts adapt to theme
function useCSSVar(name: string, fallback: string): string {
  const { theme } = useTheme();
  return useMemo(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
}

export default function Dashboard() {
  const [, navigate] = useLocation();
  const [refreshing, setRefreshing] = useState(false);

  // Theme-aware chart colours — re-computed whenever theme changes
  const chartGrid    = useCSSVar('--border',            'oklch(0.22 0.01 264)');
  const chartTick    = useCSSVar('--muted-foreground',  'oklch(0.55 0.01 264)');
  const chartBg      = useCSSVar('--card',              'oklch(0.13 0.01 264)');
  const chartBorder  = useCSSVar('--border',            'oklch(0.22 0.01 264)');
  const chartPrimary = useCSSVar('--chart-1',           'oklch(0.65 0.20 220)');
  const chartDanger  = useCSSVar('--chart-4',           'oklch(0.60 0.22 25)');
  const [tickerItems, setTickerItems] = useState(TICKER_SEED);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    tickerRef.current = setInterval(() => {
      const template = TICKER_LIVE_POOL[tickerLiveIdx % TICKER_LIVE_POOL.length];
      tickerLiveIdx++;
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
      setTickerItems(prev => [
        { id: `live_${Date.now()}`, ...template, time: timeStr },
        ...prev.slice(0, 19),
      ]);
    }, 7000);
    return () => { if (tickerRef.current) clearInterval(tickerRef.current); };
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1200);
  };

  const recentInvestigations = mockInvestigations.slice(0, 6);
  const criticalAlerts = mockAlerts.filter(a => a.severity === "critical" || a.severity === "high").slice(0, 4);

  return (
    <BISLayout
      title="Intelligence Dashboard"
      subtitle="Real-time overview of all BIS operations"
      actions={
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleRefresh}>
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </Button>
      }
    >
      {/* ── Live Ticker Strip ── */}
      <div className="mb-4 rounded-lg border border-border bg-card overflow-hidden">
        <div className="flex items-center">
          {/* Label */}
          <div className="flex items-center gap-2 px-3 py-2 border-r border-border bg-muted/30 flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            <span className="text-[9px] font-mono font-bold text-muted-foreground uppercase tracking-widest">LIVE FEED</span>
          </div>
          {/* Scrolling ticker */}
          <div className="flex-1 overflow-hidden relative">
            <div
              className="flex gap-6 px-4 py-2 overflow-x-auto scrollbar-none"
              style={{ scrollbarWidth: 'none' }}
            >
              {tickerItems.map(item => (
                <div key={item.id} className="flex items-center gap-2 flex-shrink-0">
                  <span className={cn(
                    "text-[9px] font-mono font-bold rounded px-1.5 py-0.5 flex-shrink-0",
                    item.type === 'alert' ? 'bg-red-500/20 text-red-400' :
                    item.type === 'mention' ? 'bg-blue-500/20 text-blue-400' :
                    'bg-emerald-500/20 text-emerald-400'
                  )}>
                    {item.type === 'alert' ? 'ALERT' : item.type === 'mention' ? 'SOCIAL' : 'REPORT'}
                  </span>
                  <span className="text-[10px] font-mono text-foreground/80 whitespace-nowrap">{item.text}</span>
                  <span className="text-[9px] font-mono text-muted-foreground/50 flex-shrink-0">{item.time}</span>
                  <span className="text-muted-foreground/20 flex-shrink-0">·</span>
                </div>
              ))}
            </div>
          </div>
          {/* Count */}
          <div className="px-3 py-2 border-l border-border flex-shrink-0">
            <span className="text-[9px] font-mono text-muted-foreground">{tickerItems.length} events</span>
          </div>
        </div>
      </div>

      {/* ── Top Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-6">
        <StatCard label="Total Investigations" value={dashboardStats.totalInvestigations.toLocaleString()} icon={<Search size={14} />} trend={12} color="blue" />
        <StatCard label="Active Now" value={dashboardStats.activeInvestigations} sub="in progress" icon={<Activity size={14} />} color="amber" />
        <StatCard label="Completed Today" value={dashboardStats.completedToday} icon={<CheckCircle size={14} />} trend={8} color="green" />
        <StatCard label="Critical Flags" value={dashboardStats.flaggedCritical} sub="need review" icon={<Flag size={14} />} color="red" />
        <StatCard label="Biometric IDs" value={dashboardStats.biometricEnrollments.toLocaleString()} icon={<Fingerprint size={14} />} trend={5} color="blue" />
        <StatCard label="Duplicates Caught" value={dashboardStats.duplicatesDetected} icon={<Shield size={14} />} color="amber" />
        <StatCard label="KYC Today" value={dashboardStats.kycVerificationsToday} sub={`${dashboardStats.kycPassRate}% pass`} icon={<CheckCircle size={14} />} color="green" />
        <StatCard label="Active Monitors" value={dashboardStats.activeMonitors.toLocaleString()} sub={`${dashboardStats.alertsToday} alerts`} icon={<Eye size={14} />} color="blue" />
      </div>

      {/* ── Main Grid ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        {/* Risk trend chart */}
        <div className="xl:col-span-2 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Risk Score Trend</h3>
              <p className="text-xs text-muted-foreground">12-week rolling average</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />Avg Score</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />Flagged</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={riskTrend}>
              <defs>
                <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartPrimary} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={chartPrimary} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: chartTick }} />
              <YAxis tick={{ fontSize: 10, fill: chartTick }} />
              <Tooltip contentStyle={{ background: chartBg, border: `1px solid ${chartBorder}`, borderRadius: 6, fontSize: 11 }} />
              <Area type="monotone" dataKey="avg" stroke={chartPrimary} strokeWidth={2} fill="url(#riskGrad)" />
              <Line type="monotone" dataKey="flagged" stroke={chartDanger} strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Tier breakdown */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-1">Investigation Tiers</h3>
          <p className="text-xs text-muted-foreground mb-4">Distribution by package</p>
          <div className="space-y-3">
            {tierBreakdown.map(t => (
              <div key={t.tier}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-foreground/80">{t.tier}</span>
                  <span className="font-mono text-foreground">{t.count.toLocaleString()}</span>
                </div>
                <Progress value={(t.count / 2847) * 100} className="h-1.5" style={{ "--progress-color": t.color } as any} />
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-border">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Avg Processing Time</span>
              <span className="font-mono text-foreground">{dashboardStats.avgProcessingTimeMin} min</span>
            </div>
            <div className="flex justify-between text-xs mt-1">
              <span className="text-muted-foreground">Avg Risk Score</span>
              <span className="font-mono text-amber-400">{dashboardStats.avgRiskScore}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Grid ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Recent investigations */}
        <div className="xl:col-span-2 rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Recent Investigations</h3>
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => navigate("/investigations")}>
              View all <ChevronRight size={11} />
            </Button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Subject</th>
                <th>Tier</th>
                <th>Risk</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {recentInvestigations.map(inv => (
                <tr key={inv.id} className="cursor-pointer" onClick={() => navigate(`/investigations/${inv.id}`)}>
                  <td className="font-mono text-xs text-primary">{inv.ref}</td>
                  <td>
                    <div className="text-sm font-medium">{inv.subjectName}</div>
                    <div className="text-xs text-muted-foreground capitalize">{inv.subjectType}</div>
                  </td>
                  <td className="capitalize text-xs">{inv.tier}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <RiskRing score={inv.riskScore} size={36} />
                    </div>
                  </td>
                  <td><span className={`status-${inv.status}`}>{inv.status}</span></td>
                  <td className="text-xs text-muted-foreground font-mono">{formatDateTime(inv.updatedAt).split(",")[0]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Alerts + Data sources */}
        <div className="space-y-4">
          {/* Critical alerts */}
          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <AlertTriangle size={13} className="text-red-400" />
                Active Alerts
              </h3>
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => navigate("/monitoring")}>
                View all <ChevronRight size={11} />
              </Button>
            </div>
            <div className="divide-y divide-border">
              {criticalAlerts.map(alert => (
                <div key={alert.id} className="px-4 py-2.5 hover:bg-accent/30 transition-colors cursor-pointer">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-foreground truncate">{alert.subjectName}</div>
                      <div className="text-xs text-muted-foreground truncate">{alert.summary.substring(0, 60)}…</div>
                    </div>
                    <span className={`risk-${alert.severity} shrink-0`}>{alert.severity}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Data source health */}
          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Database size={13} className="text-blue-400" />
                Data Sources
              </h3>
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => navigate("/data-sources")}>
                View all <ChevronRight size={11} />
              </Button>
            </div>
            <div className="px-4 py-3 space-y-2">
              {mockDataSources.slice(0, 5).map(ds => (
                <div key={ds.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${ds.status === "connected" ? "bg-emerald-400" : ds.status === "degraded" ? "bg-amber-400" : "bg-red-400"}`} />
                    <span className="text-foreground/80 truncate max-w-[120px]">{ds.name}</span>
                  </div>
                  <span className="font-mono text-muted-foreground">{ds.avgResponseMs > 0 ? `${ds.avgResponseMs}ms` : "—"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Data Source Activity Bar Chart ── */}
      <div className="mt-4 rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-1">Data Source Activity Today</h3>
        <p className="text-xs text-muted-foreground mb-4">API calls by source</p>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={sourceActivity} barSize={24}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: chartTick }} />
            <YAxis tick={{ fontSize: 10, fill: chartTick }} />
            <Tooltip contentStyle={{ background: chartBg, border: `1px solid ${chartBorder}`, borderRadius: 6, fontSize: 11 }} />
            <Bar dataKey="checks" fill={chartPrimary} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </BISLayout>
  );
}
