import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";
import { Database, BarChart2, AlertTriangle, FileSearch, Globe, Terminal, RefreshCw, Clock } from "lucide-react";
import { toast } from "sonner";

// ── Colour palette ─────────────────────────────────────────────────────────────
const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
};
const PIE_COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe"];
const LINE_COLOR = "#6366f1";

// ── Table stats card ──────────────────────────────────────────────────────────
function TableStatsCard() {
  const { data, isLoading } = trpc.lakehouse.listTables.useQuery();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="w-4 h-4 text-indigo-400" />
          Delta Lake Tables
        </CardTitle>
        <CardDescription>Live table versions and row counts</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {(data ?? []).map((t: any) => (
              <div key={t.table} className="flex items-center justify-between py-2.5">
                <div>
                  <span className="font-mono text-sm font-medium">{t.table}</span>
                  <span className="ml-2 text-xs text-muted-foreground">v{t.version}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{t.row_count.toLocaleString()} rows</Badge>
                  <span className="text-xs text-muted-foreground">
                    {t.last_commit_ms ? new Date(t.last_commit_ms).toLocaleTimeString() : "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Investigations by month chart ─────────────────────────────────────────────
function InvestigationsByMonthChart() {
  const { data, isLoading } = trpc.lakehouse.analytics.useQuery({ metric: "investigations_by_month" });

  const rows = (data?.rows ?? []) as { month: string; count: number; avg_risk_score: number }[];
  const reversed = [...rows].reverse();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart2 className="w-4 h-4 text-indigo-400" />
          Investigations by Month
        </CardTitle>
        <CardDescription>Count and average risk score per month</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-48 w-full" /> : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={reversed} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6 }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
              />
              <Bar dataKey="count" fill="#6366f1" radius={[3, 3, 0, 0]} name="Investigations" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ── Alerts by severity chart ──────────────────────────────────────────────────
function AlertsBySeverityChart() {
  const { data, isLoading } = trpc.lakehouse.analytics.useQuery({ metric: "alerts_by_severity" });

  const rows = (data?.rows ?? []) as { severity: string; count: number }[];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          Alerts by Severity
        </CardTitle>
        <CardDescription>Distribution of alert severity levels</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-48 w-full" /> : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 8, left: 40, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis dataKey="severity" type="category" tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6 }}
              />
              <Bar dataKey="count" radius={[0, 3, 3, 0]} name="Alerts">
                {rows.map((r, i) => (
                  <Cell key={i} fill={SEVERITY_COLORS[r.severity] ?? "#6366f1"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ── KYC status pie chart ──────────────────────────────────────────────────────
function KycStatusChart() {
  const { data, isLoading } = trpc.lakehouse.analytics.useQuery({ metric: "kyc_status_distribution" });
  const rows = (data?.rows ?? []) as { status: string; count: number }[];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSearch className="w-4 h-4 text-violet-400" />
          KYC Status Distribution
        </CardTitle>
        <CardDescription>Breakdown of KYC record statuses</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-48 w-full" /> : (
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={rows}
                dataKey="count"
                nameKey="status"
                cx="50%"
                cy="50%"
                outerRadius={70}
                label={({ status, percent }) => `${status} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {rows.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6 }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ── Top countries chart ───────────────────────────────────────────────────────
function TopCountriesChart() {
  const { data, isLoading } = trpc.lakehouse.analytics.useQuery({ metric: "top_countries" });
  const rows = (data?.rows ?? []) as { country: string; count: number }[];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="w-4 h-4 text-emerald-400" />
          Top Countries
        </CardTitle>
        <CardDescription>Investigations by country of origin</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-48 w-full" /> : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={rows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="country" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6 }}
              />
              <Bar dataKey="count" fill="#10b981" radius={[3, 3, 0, 0]} name="Investigations" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ── DuckDB Query Console ──────────────────────────────────────────────────────
function DuckDBConsole() {
  const [sql, setSql] = useState(
    "SELECT status, COUNT(*) AS count, ROUND(AVG(risk_score), 1) AS avg_risk\nFROM investigations\nGROUP BY status\nORDER BY count DESC"
  );
  const [result, setResult] = useState<{ rows: unknown[]; row_count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queryMutation = trpc.lakehouse.query.useMutation({
    onSuccess: (data) => {
      setResult(data as { rows: unknown[]; row_count: number });
      setError(null);
    },
    onError: (err) => {
      setError(err.message);
      setResult(null);
    },
  });

  const handleRun = () => {
    setError(null);
    queryMutation.mutate({ sql, limit: 500 });
  };

  const columns = result?.rows?.length ? Object.keys(result.rows[0] as object) : [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Terminal className="w-4 h-4 text-cyan-400" />
          DuckDB Query Console
        </CardTitle>
        <CardDescription>Run read-only SQL queries over the Delta Lake parquet files</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={sql}
          onChange={e => setSql(e.target.value)}
          className="font-mono text-sm min-h-[100px] bg-muted/40"
          placeholder="SELECT * FROM investigations LIMIT 10"
        />
        <div className="flex items-center gap-2">
          <Button onClick={handleRun} disabled={queryMutation.isPending} size="sm">
            {queryMutation.isPending ? "Running…" : "Run Query"}
          </Button>
          {result && (
            <span className="text-xs text-muted-foreground">{result.row_count} row{result.row_count !== 1 ? "s" : ""} returned</span>
          )}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription className="font-mono text-xs">{error}</AlertDescription>
          </Alert>
        )}

        {result && result.rows.length > 0 && (
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/60">
                <tr>
                  {columns.map(col => (
                    <th key={col} className="px-3 py-2 text-left font-medium text-muted-foreground">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(result.rows as Record<string, unknown>[]).map((row, i) => (
                  <tr key={i} className="hover:bg-muted/20">
                    {columns.map(col => (
                      <td key={col} className="px-3 py-1.5 font-mono">
                        {String(row[col] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LakehouseAnalyticsPage() {
  const { data: syncData, refetch: refetchSyncTime } = trpc.lakehouse.getLastSyncedAt.useQuery(
    undefined,
    { refetchInterval: 60_000 }
  );
  const triggerSync = trpc.lakehouse.triggerSync.useMutation({
    onSuccess: (data) => {
      toast.success(`Sync complete — ${data.ingested} rows ingested`);
      refetchSyncTime();
    },
    onError: (err) => toast.error(`Sync failed: ${err.message}`),
  });

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lakehouse Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Delta Lake + DuckDB — immutable event store with ad-hoc SQL analytics
          </p>
        </div>
        <div className="flex items-center gap-3">
          {syncData?.lastSyncedAt && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock size={11} />
              Last synced: {new Date(syncData.lastSyncedAt as string).toLocaleString()}
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => triggerSync.mutate()}
            disabled={triggerSync.isPending}
            className="text-xs h-8"
          >
            <RefreshCw size={12} className={`mr-1.5 ${triggerSync.isPending ? 'animate-spin' : ''}`} />
            {triggerSync.isPending ? 'Syncing…' : 'Sync Now'}
          </Button>
          <Badge variant="outline" className="text-xs font-mono">
            Delta Lake v3 · DuckDB v1.1
          </Badge>
        </div>
      </div>

      {/* Table stats */}
      <TableStatsCard />

      {/* Charts */}
      <Tabs defaultValue="charts">
        <TabsList>
          <TabsTrigger value="charts">Charts</TabsTrigger>
          <TabsTrigger value="console">SQL Console</TabsTrigger>
        </TabsList>

        <TabsContent value="charts" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InvestigationsByMonthChart />
            <AlertsBySeverityChart />
            <KycStatusChart />
            <TopCountriesChart />
          </div>
        </TabsContent>

        <TabsContent value="console" className="mt-4">
          <DuckDBConsole />
        </TabsContent>
      </Tabs>
    </div>
  );
}
