import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import BISLayout from "@/components/BISLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, AlertTriangle,
  Shield, Activity, RefreshCw, Download, Calendar,
} from "lucide-react";

const COLORS = ["var(--risk-none)", "var(--risk-low)", "var(--risk-medium)", "var(--risk-critical)", "var(--chart-violet)", "var(--chart-cyan)"];

function formatNGN(amount: number): string {
  if (amount >= 1_000_000_000) return `₦${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `₦${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `₦${(amount / 1_000).toFixed(1)}K`;
  return `₦${amount.toLocaleString()}`;
}

function formatDate(dateStr: string, period: string): string {
  if (period === "monthly") {
    const [y, m] = dateStr.split("-");
    return new Date(Number(y), Number(m) - 1).toLocaleString("en-NG", { month: "short", year: "2-digit" });
  }
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-NG", { month: "short", day: "numeric" });
}

export default function TransferAnalyticsDashboard() {
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("daily");
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState("volume");

  const { data, isLoading, refetch } = trpc.paymentRails.getTransferAnalytics.useQuery(
    { period, days },
    { refetchInterval: 60_000 }
  );

  const chartData = useMemo(() => {
    if (!data?.series) return [];
    return data.series.map(s => ({
      ...s,
      date: formatDate(s.date, period),
      volumeM: parseFloat((s.volume / 1_000_000).toFixed(3)),
    }));
  }, [data, period]);

  const currencyData = useMemo(() => {
    if (!data?.byCurrency) return [];
    return Object.entries(data.byCurrency).map(([name, value], i) => ({
      name,
      value: Math.round(value),
      color: COLORS[i % COLORS.length],
    }));
  }, [data]);

  const summary = data?.summary;

  const handleExport = () => {
    if (!data?.series) return;
    const csv = [
      "Date,Volume (NGN),Count,Flagged,Blocked,Avg Risk Score",
      ...data.series.map(s =>
        `${s.date},${s.volume.toFixed(2)},${s.count},${s.flagged},${s.blocked},${s.avgRisk}`
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transfer-analytics-${period}-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <BISLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Transfer Analytics</h1>
            <p className="text-slate-400 text-sm mt-1">
              NGN volume, transaction trends, and risk metrics
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
              <SelectTrigger className="w-32 bg-slate-800 border-slate-700 text-white">
                <Calendar className="w-4 h-4 mr-2 text-slate-400" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="180">Last 180 days</SelectItem>
                <SelectItem value="365">Last 365 days</SelectItem>
              </SelectContent>
            </Select>
            <Select value={period} onValueChange={v => setPeriod(v as typeof period)}>
              <SelectTrigger className="w-32 bg-slate-800 border-slate-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="border-slate-600 text-slate-300">
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} className="border-slate-600 text-slate-300">
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4 text-blue-400" />
                <span className="text-slate-400 text-xs">Total Volume</span>
              </div>
              <div className="text-xl font-bold text-white">
                {isLoading ? "—" : formatNGN(summary?.totalVolume ?? 0)}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="w-4 h-4 text-green-400" />
                <span className="text-slate-400 text-xs">Total Transactions</span>
              </div>
              <div className="text-xl font-bold text-white">
                {isLoading ? "—" : (summary?.totalCount ?? 0).toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
                <span className="text-slate-400 text-xs">Flagged</span>
              </div>
              <div className="text-xl font-bold text-yellow-400">
                {isLoading ? "—" : (summary?.flaggedCount ?? 0).toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="w-4 h-4 text-red-400" />
                <span className="text-slate-400 text-xs">Blocked</span>
              </div>
              <div className="text-xl font-bold text-red-400">
                {isLoading ? "—" : (summary?.blockedCount ?? 0).toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-purple-400" />
                <span className="text-slate-400 text-xs">Avg Risk Score</span>
              </div>
              <div className="text-xl font-bold text-purple-400">
                {isLoading ? "—" : `${summary?.avgRiskScore ?? 0}/100`}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="bg-slate-800 border-slate-700">
            <TabsTrigger value="volume">Volume Trend</TabsTrigger>
            <TabsTrigger value="count">Transaction Count</TabsTrigger>
            <TabsTrigger value="risk">Risk Trend</TabsTrigger>
            <TabsTrigger value="currency">By Currency</TabsTrigger>
            <TabsTrigger value="status">Status Breakdown</TabsTrigger>
          </TabsList>

          <TabsContent value="volume">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white text-base">NGN Volume ({period})</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="h-72 flex items-center justify-center text-slate-500">Loading...</div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--risk-none)" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="var(--risk-none)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-slate-700)" />
                      <XAxis dataKey="date" stroke="var(--color-slate-400)" tick={{ fontSize: 11 }} />
                      <YAxis stroke="var(--color-slate-400)" tick={{ fontSize: 11 }} tickFormatter={v => `₦${v}M`} />
                      <Tooltip
                        contentStyle={{ background: "var(--color-slate-700)", border: "1px solid var(--color-slate-700)", borderRadius: 8 }}
                        labelStyle={{ color: "var(--color-slate-200)" }}
                        formatter={(v: number) => [`₦${v.toFixed(3)}M`, "Volume"]}
                      />
                      <Area type="monotone" dataKey="volumeM" stroke="var(--risk-none)" fill="url(#volGrad)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="count">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white text-base">Transaction Count ({period})</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="h-72 flex items-center justify-center text-slate-500">Loading...</div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-slate-700)" />
                      <XAxis dataKey="date" stroke="var(--color-slate-400)" tick={{ fontSize: 11 }} />
                      <YAxis stroke="var(--color-slate-400)" tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ background: "var(--color-slate-700)", border: "1px solid var(--color-slate-700)", borderRadius: 8 }}
                        labelStyle={{ color: "var(--color-slate-200)" }}
                      />
                      <Legend />
                      <Bar dataKey="count" name="Total" fill="var(--risk-low)" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="flagged" name="Flagged" fill="var(--risk-medium)" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="blocked" name="Blocked" fill="var(--risk-critical)" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="risk">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white text-base">Average Risk Score Trend</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="h-72 flex items-center justify-center text-slate-500">Loading...</div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-slate-700)" />
                      <XAxis dataKey="date" stroke="var(--color-slate-400)" tick={{ fontSize: 11 }} />
                      <YAxis stroke="var(--color-slate-400)" tick={{ fontSize: 11 }} domain={[0, 100]} />
                      <Tooltip
                        contentStyle={{ background: "var(--color-slate-700)", border: "1px solid var(--color-slate-700)", borderRadius: 8 }}
                        labelStyle={{ color: "var(--color-slate-200)" }}
                        formatter={(v: number) => [`${v}/100`, "Avg Risk"]}
                      />
                      <Line type="monotone" dataKey="avgRisk" stroke="var(--chart-violet)" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="currency">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white text-base">Volume by Currency</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="h-72 flex items-center justify-center text-slate-500">Loading...</div>
                ) : (
                  <div className="flex items-center gap-8">
                    <ResponsiveContainer width="50%" height={280}>
                      <PieChart>
                        <Pie
                          data={currencyData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={110}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {currencyData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ background: "var(--color-slate-700)", border: "1px solid var(--color-slate-700)", borderRadius: 8 }}
                          formatter={(v: number) => [formatNGN(v), "Volume"]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-3">
                      {currencyData.map((c, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full" style={{ background: c.color }} />
                          <span className="text-slate-300 font-medium w-12">{c.name}</span>
                          <span className="text-white font-bold">{formatNGN(c.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="status">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white text-base">Status Breakdown Over Time</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="h-72 flex items-center justify-center text-slate-500">Loading...</div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={chartData} stackOffset="expand">
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-slate-700)" />
                      <XAxis dataKey="date" stroke="var(--color-slate-400)" tick={{ fontSize: 11 }} />
                      <YAxis stroke="var(--color-slate-400)" tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ background: "var(--color-slate-700)", border: "1px solid var(--color-slate-700)", borderRadius: 8 }}
                        labelStyle={{ color: "var(--color-slate-200)" }}
                      />
                      <Legend />
                      <Bar dataKey="count" name="Total" fill="var(--risk-none)" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="flagged" name="Flagged" fill="var(--risk-medium)" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="blocked" name="Blocked" fill="var(--risk-critical)" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Data Table */}
        {!isLoading && chartData.length > 0 && (
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white text-base">Period Summary Table</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-2 px-3 text-slate-400">Period</th>
                      <th className="text-right py-2 px-3 text-slate-400">Volume (NGN)</th>
                      <th className="text-right py-2 px-3 text-slate-400">Count</th>
                      <th className="text-right py-2 px-3 text-slate-400">Flagged</th>
                      <th className="text-right py-2 px-3 text-slate-400">Blocked</th>
                      <th className="text-right py-2 px-3 text-slate-400">Avg Risk</th>
                      <th className="text-right py-2 px-3 text-slate-400">Flag Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.series.map((s, i) => (
                      <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                        <td className="py-2 px-3 text-slate-300">{formatDate(s.date, period)}</td>
                        <td className="py-2 px-3 text-right text-white font-medium">{formatNGN(s.volume)}</td>
                        <td className="py-2 px-3 text-right text-slate-300">{s.count.toLocaleString()}</td>
                        <td className="py-2 px-3 text-right">
                          <Badge variant="outline" className="text-yellow-400 border-yellow-500/30">{s.flagged}</Badge>
                        </td>
                        <td className="py-2 px-3 text-right">
                          <Badge variant="outline" className="text-red-400 border-red-500/30">{s.blocked}</Badge>
                        </td>
                        <td className="py-2 px-3 text-right">
                          <span className={s.avgRisk >= 70 ? "text-red-400" : s.avgRisk >= 40 ? "text-yellow-400" : "text-green-400"}>
                            {s.avgRisk}/100
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right text-slate-300">
                          {s.count > 0 ? `${((s.flagged / s.count) * 100).toFixed(1)}%` : "0%"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </BISLayout>
  );
}
