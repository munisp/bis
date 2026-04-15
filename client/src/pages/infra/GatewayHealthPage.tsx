import { trpc } from "@/lib/trpc";
import BISLayout from "@/components/BISLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, CheckCircle2, XCircle, AlertTriangle, Activity, Server, Wifi } from "lucide-react";
import { useState } from "react";

type ServiceHealth = {
  name: string;
  status: string;
  latencyMs?: number;
  version?: string;
  middleware?: Record<string, boolean>;
  externalAPIs?: Record<string, boolean>;
  [key: string]: unknown;
};

function StatusBadge({ status }: { status: string }) {
  if (status === "ok") return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">● Online</Badge>;
  if (status === "down") return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">● Down</Badge>;
  return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">● Unreachable</Badge>;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "ok") return <CheckCircle2 className="h-5 w-5 text-emerald-400" />;
  if (status === "down") return <XCircle className="h-5 w-5 text-red-400" />;
  return <AlertTriangle className="h-5 w-5 text-amber-400" />;
}

function MiddlewareDot({ active, label }: { active: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className={`h-2 w-2 rounded-full ${active ? "bg-emerald-400" : "bg-slate-600"}`} />
      <span className={active ? "text-slate-200" : "text-slate-500"}>{label}</span>
    </div>
  );
}

export default function GatewayHealthPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: services, isLoading, refetch } = trpc.lookup.allServicesHealth.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const { data: gatewayDetail } = trpc.lookup.gatewayHealth.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const handleRefresh = () => {
    setRefreshKey(k => k + 1);
    refetch();
  };

  const onlineCount = services?.filter(s => s.status === "ok").length ?? 0;
  const totalCount = services?.length ?? 0;

  return (
    <BISLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-100 flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-400" />
              Gateway Health Dashboard
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Live status of all BIS microservices and middleware
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-2">
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Summary bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-slate-100">{onlineCount}/{totalCount}</div>
              <div className="text-xs text-slate-400 mt-0.5">Services Online</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-emerald-400">
                {services ? Math.round(services.filter(s => s.status === "ok").reduce((sum, s) => sum + (s.latencyMs ?? 0), 0) / Math.max(onlineCount, 1)) : "—"}
                <span className="text-sm font-normal text-slate-400 ml-1">ms</span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">Avg Latency</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-blue-400">
                {(gatewayDetail as any)?.version ?? "—"}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">Gateway Version</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-4">
              <div className={`text-2xl font-bold ${onlineCount === totalCount ? "text-emerald-400" : "text-amber-400"}`}>
                {onlineCount === totalCount ? "All Systems Go" : "Degraded"}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">Overall Status</div>
            </CardContent>
          </Card>
        </div>

        {/* Services grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="bg-slate-800/50 border-slate-700 animate-pulse">
                <CardContent className="p-5 h-24" />
              </Card>
            ))
          ) : (
            services?.map((svc: ServiceHealth) => (
              <Card key={svc.name} className="bg-slate-800/50 border-slate-700">
                <CardHeader className="pb-2 pt-4 px-5">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium text-slate-200 flex items-center gap-2">
                      <Server className="h-4 w-4 text-slate-400" />
                      {svc.name}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <StatusIcon status={svc.status} />
                      <StatusBadge status={svc.status} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-4 space-y-3">
                  <div className="flex items-center gap-4 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <Wifi className="h-3 w-3" />
                      {svc.latencyMs != null ? `${svc.latencyMs}ms` : "—"}
                    </span>
                    {svc.version && <span>v{svc.version}</span>}
                  </div>
                  {svc.middleware && (
                    <div>
                      <div className="text-xs text-slate-500 mb-1.5 font-medium uppercase tracking-wider">Middleware</div>
                      <div className="grid grid-cols-3 gap-1">
                        {Object.entries(svc.middleware).map(([k, v]) => (
                          <MiddlewareDot key={k} label={k} active={v as boolean} />
                        ))}
                      </div>
                    </div>
                  )}
                  {svc.externalAPIs && (
                    <div>
                      <div className="text-xs text-slate-500 mb-1.5 font-medium uppercase tracking-wider">External APIs</div>
                      <div className="grid grid-cols-3 gap-1">
                        {Object.entries(svc.externalAPIs).map(([k, v]) => (
                          <MiddlewareDot key={k} label={k} active={v as boolean} />
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Gateway detail — middleware breakdown */}
        {(gatewayDetail as any)?.middleware && (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-200">Gateway Middleware Status</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {Object.entries((gatewayDetail as any).middleware as Record<string, boolean>).map(([k, v]) => (
                  <div key={k} className={`rounded-lg p-3 text-center ${v ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-slate-700/50 border border-slate-600"}`}>
                    <div className={`text-lg font-bold ${v ? "text-emerald-400" : "text-slate-500"}`}>
                      {v ? "✓" : "✗"}
                    </div>
                    <div className="text-xs text-slate-300 mt-0.5 capitalize">{k}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* External API status */}
        {(gatewayDetail as any)?.externalAPIs && (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-200">External Data API Credentials</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {Object.entries((gatewayDetail as any).externalAPIs as Record<string, boolean>).map(([k, v]) => (
                  <div key={k} className={`rounded-lg p-3 text-center ${v ? "bg-blue-500/10 border border-blue-500/20" : "bg-slate-700/50 border border-slate-600"}`}>
                    <div className={`text-lg font-bold ${v ? "text-blue-400" : "text-slate-500"}`}>
                      {v ? "✓" : "✗"}
                    </div>
                    <div className="text-xs text-slate-300 mt-0.5 uppercase">{k}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-3">
                ✓ = credentials configured in environment. ✗ = not set (sandbox mode active for that source).
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </BISLayout>
  );
}
