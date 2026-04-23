import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import BISLayout from "@/components/BISLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, LineChart, Line, Legend, Cell,
} from "recharts";
import {
  AlertTriangle, TrendingUp, Users, Globe, RefreshCw, Shield,
  Activity, ChevronRight,
} from "lucide-react";
import { Link } from "wouter";

const RISK_COLORS: Record<string, string> = {
  "Critical (80-100)": "#ef4444",
  "High (60-79)": "#f97316",
  "Medium (40-59)": "#eab308",
  "Low (0-39)": "#22c55e",
};

function getRiskColor(score: number): string {
  if (score >= 80) return "#ef4444";
  if (score >= 60) return "#f97316";
  if (score >= 40) return "#eab308";
  return "#22c55e";
}

function getRiskBadge(score: number) {
  if (score >= 80) return <Badge className="bg-red-500/20 text-red-300 border-red-500/30">Critical</Badge>;
  if (score >= 60) return <Badge className="bg-orange-500/20 text-orange-300 border-orange-500/30">High</Badge>;
  if (score >= 40) return <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-500/30">Medium</Badge>;
  return <Badge className="bg-green-500/20 text-green-300 border-green-500/30">Low</Badge>;
}

const SECTOR_X: Record<string, number> = {
  "Corporate": 1,
  "High-Value Individual": 2,
  "Standard Individual": 3,
  "Basic Individual": 4,
  "KYC Subject": 5,
};

const BUCKET_Y: Record<string, number> = {
  "Critical (80-100)": 90,
  "High (60-79)": 70,
  "Medium (40-59)": 50,
  "Low (0-39)": 20,
};

export default function RiskDashboardPage() {
  const [days, setDays] = useState(90);
  const [minScore, setMinScore] = useState(0);
  const [trendDays, setTrendDays] = useState(30);

  const { data: heatmap, isLoading, refetch } = trpc.riskDashboard.getHeatmapData.useQuery({ days, minScore });
  const { data: trend } = trpc.riskDashboard.getRiskTrend.useQuery({ days: trendDays });
  const { data: countryRisk } = trpc.riskDashboard.getCountryRisk.useQuery();

  // Transform bubbles into scatter chart data
  const scatterData = useMemo(() => {
    if (!heatmap?.bubbles) return [];
    return heatmap.bubbles.map(b => ({
      x: SECTOR_X[b.sector] ?? 3,
      y: BUCKET_Y[b.riskBucket] ?? 50,
      z: Math.max(20, b.count * 8), // bubble size
      count: b.count,
      avgScore: b.avgScore,
      sector: b.sector,
      riskBucket: b.riskBucket,
      entities: b.entities,
      fill: RISK_COLORS[b.riskBucket] ?? "#64748b",
    }));
  }, [heatmap]);

  const CustomBubbleTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-sm shadow-xl">
        <div className="font-semibold text-white mb-1">{d.sector}</div>
        <div className="text-slate-300">{d.riskBucket}</div>
        <div className="text-slate-400 mt-1">Entities: <span className="text-white">{d.count}</span></div>
        <div className="text-slate-400">Avg Score: <span style={{ color: d.fill }}>{d.avgScore}</span></div>
        {d.entities.length > 0 && (
          <div className="mt-2 border-t border-slate-700 pt-2">
            <div className="text-slate-400 text-xs mb-1">Top entities:</div>
            {d.entities.map((e: string, i: number) => (
              <div key={i} className="text-slate-300 text-xs truncate max-w-48">• {e}</div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const xTickFormatter = (v: number) => {
    const labels: Record<number, string> = {
      1: "Corporate",
      2: "HV Individual",
      3: "Standard Ind.",
      4: "Basic Ind.",
      5: "KYC Subject",
    };
    return labels[v] ?? "";
  };

  return (
    <BISLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Risk Scoring Dashboard</h1>
            <p className="text-slate-400 text-sm mt-1">
              Entity risk heatmap, trend analysis, and country exposure
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="border-slate-600 text-slate-300">
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Summary Stats */}
        {heatmap && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="w-4 h-4 text-blue-400" />
                  <span className="text-slate-400 text-xs">Total Entities</span>
                </div>
                <div className="text-2xl font-bold text-white">{heatmap.summary.totalEntities}</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <Activity className="w-4 h-4 text-yellow-400" />
                  <span className="text-slate-400 text-xs">Avg Risk Score</span>
                </div>
                <div className="text-2xl font-bold" style={{ color: getRiskColor(heatmap.summary.avgScore) }}>
                  {heatmap.summary.avgScore}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span className="text-slate-400 text-xs">Critical (&ge;80)</span>
                </div>
                <div className="text-2xl font-bold text-red-400">{heatmap.summary.criticalCount}</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="w-4 h-4 text-orange-400" />
                  <span className="text-slate-400 text-xs">High (60-79)</span>
                </div>
                <div className="text-2xl font-bold text-orange-400">{heatmap.summary.highCount}</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-purple-400" />
                  <span className="text-slate-400 text-xs">Investigations</span>
                </div>
                <div className="text-2xl font-bold text-purple-400">{heatmap.summary.investigationCount}</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="w-4 h-4 text-cyan-400" />
                  <span className="text-slate-400 text-xs">KYC Records</span>
                </div>
                <div className="text-2xl font-bold text-cyan-400">{heatmap.summary.kycCount}</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters */}
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-6 items-center">
              <div className="flex items-center gap-3">
                <Label className="text-slate-300 text-sm whitespace-nowrap">Time window:</Label>
                <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
                  <SelectTrigger className="w-36 bg-slate-700 border-slate-600 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="90">Last 90 days</SelectItem>
                    <SelectItem value="180">Last 180 days</SelectItem>
                    <SelectItem value="365">Last 365 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3 flex-1 min-w-48">
                <Label className="text-slate-300 text-sm whitespace-nowrap">Min score: {minScore}</Label>
                <Slider
                  value={[minScore]}
                  onValueChange={([v]) => setMinScore(v)}
                  min={0}
                  max={70}
                  step={5}
                  className="flex-1"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Bubble Heatmap */}
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-base">
              Entity Risk Heatmap — Sector × Risk Level
            </CardTitle>
            <p className="text-slate-400 text-xs mt-1">
              Bubble size = number of entities. X-axis = entity sector. Y-axis = risk score level.
            </p>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-12 text-slate-500">Loading heatmap data...</div>
            ) : scatterData.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                No entities found for the selected filters
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={380}>
                <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    domain={[0.5, 5.5]}
                    ticks={[1, 2, 3, 4, 5]}
                    tickFormatter={xTickFormatter}
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                    label={{ value: "Entity Sector", position: "insideBottom", offset: -5, fill: "#64748b", fontSize: 12 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    domain={[0, 100]}
                    ticks={[20, 50, 70, 90]}
                    tickFormatter={v => v >= 80 ? "Critical" : v >= 60 ? "High" : v >= 40 ? "Medium" : "Low"}
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                    label={{ value: "Risk Level", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 12 }}
                  />
                  <Tooltip content={<CustomBubbleTooltip />} />
                  <Scatter data={scatterData} shape="circle">
                    {scatterData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} fillOpacity={0.7} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            )}

            {/* Legend */}
            <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-slate-700">
              {Object.entries(RISK_COLORS).map(([label, color]) => (
                <div key={label} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-slate-400 text-xs">{label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Risk Score Distribution */}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white text-base">Risk Score Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {heatmap?.histogram && (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={heatmap.histogram} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="bucket" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #475569", borderRadius: "8px" }}
                      labelStyle={{ color: "#f1f5f9" }}
                      itemStyle={{ color: "#94a3b8" }}
                    />
                    <Bar dataKey="count" name="Entities" radius={[4, 4, 0, 0]}>
                      {heatmap.histogram.map((entry, index) => {
                        const midScore = index * 10 + 5;
                        return <Cell key={index} fill={getRiskColor(midScore)} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Risk Trend */}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white text-base">Risk Score Trend</CardTitle>
                <Select value={String(trendDays)} onValueChange={v => setTrendDays(Number(v))}>
                  <SelectTrigger className="w-32 h-7 bg-slate-700 border-slate-600 text-white text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="14">14 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="60">60 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {trend && trend.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={trend} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                    <YAxis domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #475569", borderRadius: "8px" }}
                      labelStyle={{ color: "#f1f5f9" }}
                      itemStyle={{ color: "#94a3b8" }}
                    />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: "12px" }} />
                    <Line type="monotone" dataKey="avgScore" stroke="#f97316" strokeWidth={2} dot={false} name="Avg Risk Score" />
                    <Line type="monotone" dataKey="criticalCount" stroke="#ef4444" strokeWidth={1.5} dot={false} name="Critical Count" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center py-12 text-slate-500">No trend data available</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Top High-Risk Entities */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white text-base">Top High-Risk Entities</CardTitle>
            </CardHeader>
            <CardContent>
              {heatmap?.topRisk.length === 0 ? (
                <div className="text-center py-8 text-slate-500">No high-risk entities found</div>
              ) : (
                <div className="space-y-2">
                  {heatmap?.topRisk.map((entity, i) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-colors">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                          style={{ backgroundColor: `${getRiskColor(entity.score)}20`, color: getRiskColor(entity.score) }}
                        >
                          {entity.score}
                        </div>
                        <div>
                          <div className="text-white text-sm font-medium">{entity.name}</div>
                          <div className="text-slate-400 text-xs">
                            {entity.type === "investigation" ? "Investigation" : "KYC"}
                            {entity.country && ` · ${entity.country}`}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {getRiskBadge(entity.score)}
                        {entity.type === "investigation" && entity.ref && (
                          <Link href={`/investigations/${entity.ref}`}>
                            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white h-6 w-6 p-0">
                              <ChevronRight className="w-4 h-4" />
                            </Button>
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Country Risk */}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white text-base flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-400" />
                Country Risk Exposure
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!countryRisk || countryRisk.length === 0 ? (
                <div className="text-center py-8 text-slate-500">No country data available</div>
              ) : (
                <div className="space-y-2">
                  {countryRisk.slice(0, 10).map((c, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="text-slate-400 text-xs w-4">{i + 1}</div>
                      <div className="text-white text-sm font-medium w-12">{c.country}</div>
                      <div className="flex-1 bg-slate-700 rounded-full h-2">
                        <div
                          className="h-2 rounded-full transition-all"
                          style={{
                            width: `${c.avgScore}%`,
                            backgroundColor: getRiskColor(c.avgScore),
                          }}
                        />
                      </div>
                      <div className="text-slate-300 text-xs w-8 text-right">{c.avgScore}</div>
                      <div className="text-slate-400 text-xs w-16 text-right">{c.count} entities</div>
                      {c.criticalCount > 0 && (
                        <Badge className="bg-red-500/20 text-red-300 border-red-500/30 text-xs">
                          {c.criticalCount} critical
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </BISLayout>
  );
}
