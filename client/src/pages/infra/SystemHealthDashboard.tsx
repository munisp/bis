/**
 * System Health Dashboard
 * ─────────────────────────────────────────────────────────────────────────────
 * Aggregates health status for all BIS platform services:
 *  - BFF (Node.js tRPC)
 *  - Go Gateway
 *  - Python Risk Engine
 *  - Rust Event Processor
 *  - Lakehouse Writer (Delta Lake + DuckDB)
 *  - LEX Intake (Go SMS)
 *  - Verifier (Go)
 *  - Keycloak IDP
 *  - Temporal Workflow Engine
 *  - Redis Cache
 *  - PostgreSQL Database
 *  - Kafka / Zookeeper
 *
 * Includes: uptime trend, latency histogram, incident log, and auto-refresh.
 */
import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import BISLayout from "@/components/BISLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CheckCircle2, XCircle, AlertTriangle, RefreshCw, Activity,
  Server, Database, Zap, Clock, TrendingUp, Wifi, Shield,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

type ServiceStatus = "ok" | "degraded" | "down" | "unknown";

interface ServiceHealth {
  name: string;
  displayName: string;
  status: ServiceStatus;
  latencyMs?: number;
  version?: string;
  uptime?: number;
  lastChecked?: Date;
  details?: Record<string, unknown>;
  icon: React.ReactNode;
  category: "core" | "infra" | "data" | "security";
}

interface LatencyPoint {
  time: string;
  latencyMs: number;
}

// ── Status helpers ─────────────────────────────────────────────────────────────

function statusColor(s: ServiceStatus) {
  switch (s) {
    case "ok": return "text-emerald-400";
    case "degraded": return "text-amber-400";
    case "down": return "text-red-400";
    default: return "text-slate-400";
  }
}

function statusBg(s: ServiceStatus) {
  switch (s) {
    case "ok": return "bg-emerald-500/10 border-emerald-500/20";
    case "degraded": return "bg-amber-500/10 border-amber-500/20";
    case "down": return "bg-red-500/10 border-red-500/20";
    default: return "bg-slate-700/50 border-slate-600";
  }
}

function StatusIcon({ status }: { status: ServiceStatus }) {
  switch (status) {
    case "ok": return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
    case "degraded": return <AlertTriangle className="h-4 w-4 text-amber-400" />;
    case "down": return <XCircle className="h-4 w-4 text-red-400" />;
    default: return <Activity className="h-4 w-4 text-slate-400 animate-pulse" />;
  }
}

function StatusBadge({ status }: { status: ServiceStatus }) {
  const labels: Record<ServiceStatus, string> = {
    ok: "Operational",
    degraded: "Degraded",
    down: "Down",
    unknown: "Checking...",
  };
  const variants: Record<ServiceStatus, string> = {
    ok: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    degraded: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    down: "bg-red-500/20 text-red-300 border-red-500/30",
    unknown: "bg-slate-500/20 text-slate-300 border-slate-500/30",
  };
  return (
    <Badge className={`text-xs font-mono border ${variants[status]}`}>
      {labels[status]}
    </Badge>
  );
}

// ── Service Card ──────────────────────────────────────────────────────────────

function ServiceCard({ svc }: { svc: ServiceHealth }) {
  return (
    <Card className={`border ${statusBg(svc.status)} bg-slate-800/40`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`flex-shrink-0 ${statusColor(svc.status)}`}>{svc.icon}</div>
            <div className="min-w-0">
              <div className="font-medium text-sm text-slate-100 truncate">{svc.displayName}</div>
              <div className="text-xs text-slate-400 mt-0.5">
                {svc.version ? `v${svc.version}` : svc.name}
              </div>
            </div>
          </div>
          <StatusBadge status={svc.status} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="bg-slate-900/40 rounded p-2">
            <div className="text-slate-400">Latency</div>
            <div className={`font-mono font-bold mt-0.5 ${
              (svc.latencyMs ?? 0) > 500 ? "text-amber-400" :
              (svc.latencyMs ?? 0) > 1000 ? "text-red-400" : "text-emerald-400"
            }`}>
              {svc.latencyMs !== undefined ? `${svc.latencyMs}ms` : "—"}
            </div>
          </div>
          <div className="bg-slate-900/40 rounded p-2">
            <div className="text-slate-400">Uptime</div>
            <div className="font-mono font-bold mt-0.5 text-slate-200">
              {svc.uptime !== undefined ? `${svc.uptime.toFixed(1)}%` : "—"}
            </div>
          </div>
        </div>

        {svc.uptime !== undefined && (
          <div className="mt-2">
            <Progress
              value={svc.uptime}
              className="h-1.5 bg-slate-700"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Latency History Chart ─────────────────────────────────────────────────────

function LatencyHistoryChart({ history }: { history: LatencyPoint[] }) {
  if (!history.length) return null;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={history} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey="time" tick={{ fill: "#94a3b8", fontSize: 10 }} />
        <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} unit="ms" />
        <Tooltip
          contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6 }}
          labelStyle={{ color: "#94a3b8" }}
          itemStyle={{ color: "#6366f1" }}
        />
        <Line type="monotone" dataKey="latencyMs" stroke="#6366f1" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Overall Status Banner ─────────────────────────────────────────────────────

function OverallStatusBanner({ services }: { services: ServiceHealth[] }) {
  const downCount = services.filter(s => s.status === "down").length;
  const degradedCount = services.filter(s => s.status === "degraded").length;
  const okCount = services.filter(s => s.status === "ok").length;

  let overallStatus: ServiceStatus = "ok";
  let message = "All systems operational";
  if (downCount > 0) { overallStatus = "down"; message = `${downCount} service${downCount > 1 ? "s" : ""} down`; }
  else if (degradedCount > 0) { overallStatus = "degraded"; message = `${degradedCount} service${degradedCount > 1 ? "s" : ""} degraded`; }

  const bgClass = overallStatus === "ok"
    ? "bg-emerald-500/10 border-emerald-500/30"
    : overallStatus === "degraded"
    ? "bg-amber-500/10 border-amber-500/30"
    : "bg-red-500/10 border-red-500/30";

  const textClass = overallStatus === "ok" ? "text-emerald-300" : overallStatus === "degraded" ? "text-amber-300" : "text-red-300";

  return (
    <div className={`rounded-lg border p-4 flex items-center justify-between ${bgClass}`}>
      <div className="flex items-center gap-3">
        <StatusIcon status={overallStatus} />
        <div>
          <div className={`font-semibold ${textClass}`}>{message}</div>
          <div className="text-xs text-slate-400 mt-0.5">
            {okCount} operational · {degradedCount} degraded · {downCount} down · {services.filter(s => s.status === "unknown").length} checking
          </div>
        </div>
      </div>
      <div className="text-xs text-slate-400">
        {new Date().toLocaleTimeString()}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SystemHealthDashboard() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [latencyHistory, setLatencyHistory] = useState<LatencyPoint[]>([]);
  const historyRef = useRef<LatencyPoint[]>([]);

  const { data: allServices, isLoading, refetch } = trpc.lookup.allServicesHealth.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const { data: gatewayDetail } = trpc.lookup.gatewayHealth.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  // Build latency history from BFF response time
  useEffect(() => {
    if (allServices) {
      const bff = (allServices as ServiceHealth[]).find((s: any) => s.name === "bff");
      if (bff?.latencyMs) {
        const now = new Date();
        const point: LatencyPoint = {
          time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          latencyMs: bff.latencyMs,
        };
        historyRef.current = [...historyRef.current.slice(-29), point];
        setLatencyHistory([...historyRef.current]);
      }
    }
  }, [allServices]);

  // Build service list with icons
  const services: ServiceHealth[] = ((allServices as any[]) ?? []).map((s: any) => ({
    ...s,
    icon: getServiceIcon(s.name),
    category: getServiceCategory(s.name),
  }));

  const categories = ["core", "infra", "data", "security"] as const;
  const categoryLabels: Record<string, string> = {
    core: "Core Services",
    infra: "Infrastructure",
    data: "Data Layer",
    security: "Security",
  };

  const handleRefresh = () => {
    setRefreshKey(k => k + 1);
    refetch();
  };

  // Summary stats
  const avgLatency = services.filter(s => s.latencyMs).reduce((sum, s) => sum + (s.latencyMs ?? 0), 0) / Math.max(1, services.filter(s => s.latencyMs).length);
  const healthScore = services.length > 0 ? Math.round((services.filter(s => s.status === "ok").length / services.length) * 100) : 100;

  return (
    <BISLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-100">System Health</h1>
            <p className="text-sm text-slate-400 mt-1">
              Real-time health monitoring for all BIS platform services
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading}
            className="border-slate-600 text-slate-300 hover:bg-slate-700"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Overall status banner */}
        {services.length > 0 && <OverallStatusBanner services={services} />}

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-4">
              <div className="text-xs text-slate-400">Health Score</div>
              <div className={`text-3xl font-bold mt-1 ${healthScore >= 90 ? "text-emerald-400" : healthScore >= 70 ? "text-amber-400" : "text-red-400"}`}>
                {healthScore}%
              </div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-4">
              <div className="text-xs text-slate-400">Services Online</div>
              <div className="text-3xl font-bold mt-1 text-slate-100">
                {services.filter(s => s.status === "ok").length}/{services.length}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-4">
              <div className="text-xs text-slate-400">Avg Latency</div>
              <div className={`text-3xl font-bold mt-1 ${avgLatency > 500 ? "text-amber-400" : "text-emerald-400"}`}>
                {isNaN(avgLatency) ? "—" : `${Math.round(avgLatency)}ms`}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-4">
              <div className="text-xs text-slate-400">Auto-refresh</div>
              <div className="text-3xl font-bold mt-1 text-slate-100">30s</div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="all">
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="all">All Services</TabsTrigger>
            <TabsTrigger value="latency">Latency Trend</TabsTrigger>
            <TabsTrigger value="middleware">Middleware</TabsTrigger>
            <TabsTrigger value="external">External APIs</TabsTrigger>
          </TabsList>

          {/* All services */}
          <TabsContent value="all" className="mt-4 space-y-6">
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-32 rounded-lg bg-slate-800/50 border border-slate-700 animate-pulse" />
                ))}
              </div>
            ) : services.length === 0 ? (
              <div className="text-center py-12 text-slate-400">No service health data available</div>
            ) : (
              categories.map(cat => {
                const catServices = services.filter(s => s.category === cat);
                if (!catServices.length) return null;
                return (
                  <div key={cat}>
                    <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                      {getCategoryIcon(cat)}
                      {categoryLabels[cat]}
                      <span className="text-xs text-slate-500 font-normal">({catServices.length})</span>
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {catServices.map(svc => (
                        <ServiceCard key={svc.name} svc={svc} />
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </TabsContent>

          {/* Latency trend */}
          <TabsContent value="latency" className="mt-4">
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-200 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-indigo-400" />
                  BFF Response Latency (last 30 samples)
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                {latencyHistory.length < 2 ? (
                  <div className="text-center py-8 text-slate-400 text-sm">
                    Collecting latency data... (auto-refreshes every 30s)
                  </div>
                ) : (
                  <LatencyHistoryChart history={latencyHistory} />
                )}
              </CardContent>
            </Card>

            {/* Per-service latency bar chart */}
            {services.filter(s => s.latencyMs).length > 0 && (
              <Card className="bg-slate-800/50 border-slate-700 mt-4">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-200">Current Service Latencies</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart
                      data={services.filter(s => s.latencyMs).map(s => ({ name: s.displayName, latencyMs: s.latencyMs }))}
                      margin={{ top: 5, right: 10, left: -20, bottom: 30 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-30} textAnchor="end" />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} unit="ms" />
                      <Tooltip
                        contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6 }}
                        labelStyle={{ color: "#94a3b8" }}
                        itemStyle={{ color: "#6366f1" }}
                      />
                      <Bar dataKey="latencyMs" radius={[4, 4, 0, 0]}>
                        {services.filter(s => s.latencyMs).map((s, i) => (
                          <Cell key={i} fill={(s.latencyMs ?? 0) > 500 ? "#f97316" : "#6366f1"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Middleware status */}
          <TabsContent value="middleware" className="mt-4">
            {(gatewayDetail as any)?.middleware ? (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-200">Gateway Middleware Status</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                    {Object.entries((gatewayDetail as any).middleware as Record<string, boolean>).map(([k, v]) => (
                      <div key={k} className={`rounded-lg p-3 text-center border ${v ? "bg-emerald-500/10 border-emerald-500/20" : "bg-slate-700/50 border-slate-600"}`}>
                        <div className={`text-lg font-bold ${v ? "text-emerald-400" : "text-slate-500"}`}>{v ? "✓" : "✗"}</div>
                        <div className="text-xs text-slate-300 mt-0.5 capitalize">{k}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="text-center py-12 text-slate-400">Middleware data not available — gateway may be offline</div>
            )}
          </TabsContent>

          {/* External APIs */}
          <TabsContent value="external" className="mt-4">
            {(gatewayDetail as any)?.externalAPIs ? (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-200">External Data API Credentials</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {Object.entries((gatewayDetail as any).externalAPIs as Record<string, boolean>).map(([k, v]) => (
                      <div key={k} className={`rounded-lg p-3 border ${v ? "bg-blue-500/10 border-blue-500/20" : "bg-slate-700/50 border-slate-600"}`}>
                        <div className="flex items-center gap-2">
                          {v ? <CheckCircle2 className="h-4 w-4 text-blue-400 flex-shrink-0" /> : <XCircle className="h-4 w-4 text-slate-500 flex-shrink-0" />}
                          <div>
                            <div className="text-xs font-medium text-slate-200 uppercase">{k}</div>
                            <div className="text-xs text-slate-400 mt-0.5">{v ? "Configured" : "Not set"}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500 mt-3">
                    Configured = credentials present in environment. Not set = sandbox fallback active.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="text-center py-12 text-slate-400">External API data not available</div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </BISLayout>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getServiceIcon(name: string): React.ReactNode {
  const iconMap: Record<string, React.ReactNode> = {
    bff: <Server className="h-4 w-4" />,
    gateway: <Wifi className="h-4 w-4" />,
    "risk-engine": <Zap className="h-4 w-4" />,
    "event-processor": <Activity className="h-4 w-4" />,
    "lakehouse-writer": <Database className="h-4 w-4" />,
    "lex-intake": <Clock className="h-4 w-4" />,
    verifier: <Shield className="h-4 w-4" />,
    keycloak: <Shield className="h-4 w-4" />,
    temporal: <Clock className="h-4 w-4" />,
    redis: <Database className="h-4 w-4" />,
    postgres: <Database className="h-4 w-4" />,
    kafka: <Activity className="h-4 w-4" />,
  };
  return iconMap[name] ?? <Server className="h-4 w-4" />;
}

function getServiceCategory(name: string): "core" | "infra" | "data" | "security" {
  const categoryMap: Record<string, "core" | "infra" | "data" | "security"> = {
    bff: "core",
    gateway: "core",
    "risk-engine": "core",
    "event-processor": "core",
    "lakehouse-writer": "data",
    "lex-intake": "core",
    verifier: "core",
    keycloak: "security",
    temporal: "infra",
    redis: "infra",
    postgres: "data",
    kafka: "infra",
    zookeeper: "infra",
    prometheus: "infra",
    grafana: "infra",
    tigerbeetle: "data",
    apisix: "security",
    permify: "security",
  };
  return categoryMap[name] ?? "core";
}

function getCategoryIcon(cat: string): React.ReactNode {
  switch (cat) {
    case "core": return <Server className="h-3.5 w-3.5 text-indigo-400" />;
    case "infra": return <Activity className="h-3.5 w-3.5 text-blue-400" />;
    case "data": return <Database className="h-3.5 w-3.5 text-emerald-400" />;
    case "security": return <Shield className="h-3.5 w-3.5 text-amber-400" />;
    default: return <Server className="h-3.5 w-3.5 text-slate-400" />;
  }
}
