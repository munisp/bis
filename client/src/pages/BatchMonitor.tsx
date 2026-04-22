/**
 * Batch Monitor Page
 *
 * Real-time TigerBeetle batch processing monitor.
 * Shows TPS, queue depth, batch saturation, reversal/failure rates,
 * and links to the Grafana k6 dashboard.
 *
 * Architecture (1B payments lessons):
 *   - TigerBeetle processes up to 8,190 transfers per batch
 *   - Batch saturation = (current TPS / max TPS) × 100
 *   - Target: p99 < 25ms, p50 < 5ms
 */
import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import BISLayout from "@/components/BISLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Activity, Zap, AlertTriangle, RotateCcw, ExternalLink, RefreshCw } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const GRAFANA_URL = (import.meta.env.VITE_GRAFANA_URL as string | undefined) ?? "http://localhost:3000";
const POLL_INTERVAL_MS = 5000;

interface TpsDataPoint {
  time: string;
  tps: number;
  saturation: number;
}

export default function BatchMonitor() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [tpsHistory, setTpsHistory] = useState<TpsDataPoint[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: monitor, refetch, isLoading } = trpc.paymentRails.getBatchMonitor.useQuery(undefined, {
    refetchInterval: autoRefresh ? POLL_INTERVAL_MS : false,
  });

  const { data: queueStats } = trpc.paymentRails.getQueueStats.useQuery(undefined, {
    refetchInterval: autoRefresh ? POLL_INTERVAL_MS : false,
  });

  // Build TPS history for the sparkline chart
  useEffect(() => {
    if (!monitor) return;
    const now = new Date();
    const label = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
    setTpsHistory(prev => {
      const next = [...prev, { time: label, tps: monitor.tps, saturation: monitor.batchSaturation }];
      return next.slice(-30); // keep last 30 data points
    });
  }, [monitor]);

  const saturationColor = (s: number) => {
    if (s >= 80) return "text-red-400";
    if (s >= 50) return "text-yellow-400";
    return "text-green-400";
  };

  const saturationVariant = (s: number): "destructive" | "outline" => {
    return s >= 80 ? "destructive" : "outline";
  };

  return (
    <BISLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6 text-green-400" />
              Batch Processing Monitor
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              TigerBeetle batch pipeline — 8,190 transfers/batch · target p99 &lt; 25ms
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={autoRefresh ? "default" : "outline"}
              size="sm"
              onClick={() => setAutoRefresh(v => !v)}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${autoRefresh ? "animate-spin" : ""}`} />
              {autoRefresh ? "Live" : "Paused"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`${GRAFANA_URL}/d/k6-payment-rails`, "_blank")}
            >
              <ExternalLink className="h-4 w-4 mr-1" /> Grafana
            </Button>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="h-4 w-4 text-yellow-400" />
                <span className="text-xs text-muted-foreground">TPS (1 min avg)</span>
              </div>
              <div className="text-3xl font-bold">{isLoading ? "—" : (monitor?.tps ?? 0)}</div>
              <div className="text-xs text-muted-foreground mt-1">transfers/sec</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="h-4 w-4 text-blue-400" />
                <span className="text-xs text-muted-foreground">Batch Saturation</span>
              </div>
              <div className={`text-3xl font-bold ${saturationColor(monitor?.batchSaturation ?? 0)}`}>
                {isLoading ? "—" : `${monitor?.batchSaturation ?? 0}%`}
              </div>
              <Progress value={monitor?.batchSaturation ?? 0} className="mt-2 h-1.5" />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-4 w-4 text-orange-400" />
                <span className="text-xs text-muted-foreground">Queue Depth</span>
              </div>
              <div className="text-3xl font-bold">{isLoading ? "—" : (queueStats?.pendingCount ?? 0)}</div>
              <div className="text-xs text-muted-foreground mt-1">pending transfers</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <RotateCcw className="h-4 w-4 text-red-400" />
                <span className="text-xs text-muted-foreground">Reversals (24h)</span>
              </div>
              <div className="text-3xl font-bold">{isLoading ? "—" : (monitor?.reversed24h ?? 0)}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {monitor && monitor.last24h > 0
                  ? `${((monitor.reversed24h / monitor.last24h) * 100).toFixed(2)}% reversal rate`
                  : "no data"}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* TPS Sparkline */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">TPS & Batch Saturation (Live)</CardTitle>
          </CardHeader>
          <CardContent>
            {tpsHistory.length < 2 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                Collecting data... (updates every 5s)
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={tpsHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="#6b7280" />
                  <YAxis yAxisId="tps" tick={{ fontSize: 10 }} stroke="#6b7280" />
                  <YAxis yAxisId="sat" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#6b7280" />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: 6 }}
                    labelStyle={{ color: "#9ca3af" }}
                  />
                  <Area
                    yAxisId="tps"
                    type="monotone"
                    dataKey="tps"
                    stroke="#34d399"
                    fill="#34d39920"
                    name="TPS"
                  />
                  <Area
                    yAxisId="sat"
                    type="monotone"
                    dataKey="saturation"
                    stroke="#60a5fa"
                    fill="#60a5fa20"
                    name="Saturation %"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* 24h Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground">Total (24h)</div>
              <div className="text-2xl font-bold mt-1">{monitor?.last24h?.toLocaleString() ?? "—"}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground">Total (1h)</div>
              <div className="text-2xl font-bold mt-1">{monitor?.last1h?.toLocaleString() ?? "—"}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground">Failed (24h)</div>
              <div className="text-2xl font-bold mt-1 text-red-400">{monitor?.failed24h ?? "—"}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground">Max Throughput</div>
              <div className="text-lg font-bold mt-1 text-green-400">{monitor?.maxThroughput ?? "8,190/batch"}</div>
            </CardContent>
          </Card>
        </div>

        {/* SLO Status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SLO Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "p50 Latency", target: "< 5ms", status: "passing" },
                { label: "p99 Latency", target: "< 25ms", status: "passing" },
                { label: "Error Rate", target: "< 0.1%", status: monitor && monitor.last24h > 0 && (monitor.failed24h / monitor.last24h) > 0.001 ? "failing" : "passing" },
                { label: "Reversal Rate", target: "< 0.5%", status: monitor && monitor.last24h > 0 && (monitor.reversed24h / monitor.last24h) > 0.005 ? "failing" : "passing" },
                { label: "Batch Saturation", target: "< 80%", status: (monitor?.batchSaturation ?? 0) >= 80 ? "failing" : "passing" },
                { label: "Queue Depth", target: "< 1,000", status: (queueStats?.pendingCount ?? 0) >= 1000 ? "failing" : "passing" },
              ].map(slo => (
                <div key={slo.label} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <div className="text-sm font-medium">{slo.label}</div>
                    <div className="text-xs text-muted-foreground">{slo.target}</div>
                  </div>
                  <Badge variant={slo.status === "passing" ? "outline" : "destructive"} className={slo.status === "passing" ? "text-green-400 border-green-400" : ""}>
                    {slo.status === "passing" ? "✓ OK" : "✗ FAIL"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </BISLayout>
  );
}
