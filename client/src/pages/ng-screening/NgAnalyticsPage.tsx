import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, ShieldCheck, Clock, TrendingUp, TrendingDown, Users, Activity } from 'lucide-react';
import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts';

const OUTCOME_COLORS: Record<string, string> = {
  Clear:    '#10b981',
  Consider: '#f59e0b',
  Adverse:  '#ef4444',
  Pending:  '#3b82f6',
};

export default function NgAnalyticsPage() {
  const { data: stats, isLoading } = trpc.ngScreening.analytics.summary.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const total = stats?.totalOrders ?? 0;
  const clearRate  = total > 0 ? ((stats?.clearCount   ?? 0) / total * 100).toFixed(1) : '—';
  const adverseRate = total > 0 ? ((stats?.adverseCount ?? 0) / total * 100).toFixed(1) : '—';

  const kpis = [
    {
      label: 'Total Orders',
      value: total,
      icon: <ShieldCheck size={16} className="text-primary" />,
    },
    {
      label: 'Pending',
      value: stats?.pendingOrders ?? 0,
      icon: <Clock size={16} className="text-amber-400" />,
    },
    {
      label: 'Clear Rate',
      value: `${clearRate}%`,
      icon: <TrendingUp size={16} className="text-emerald-400" />,
    },
    {
      label: 'Adverse Rate',
      value: `${adverseRate}%`,
      icon: <TrendingDown size={16} className="text-red-400" />,
    },
    {
      label: 'Total Candidates',
      value: stats?.totalCandidates ?? 0,
      icon: <Users size={16} className="text-blue-400" />,
    },
    {
      label: 'Active Monitors',
      value: stats?.activeContinuousMonitors ?? 0,
      icon: <Activity size={16} className="text-purple-400" />,
    },
  ];

  const outcomeData = [
    { name: 'Clear',    value: stats?.clearCount    ?? 0 },
    { name: 'Consider', value: stats?.considerCount ?? 0 },
    { name: 'Adverse',  value: stats?.adverseCount  ?? 0 },
    { name: 'Pending',  value: stats?.pendingOrders ?? 0 },
  ].filter(d => d.value > 0);

  const completionData = [
    { name: 'Completed', value: stats?.completedOrders ?? 0 },
    { name: 'Pending',   value: stats?.pendingOrders   ?? 0 },
  ].filter(d => d.value > 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-mono font-bold text-foreground">Screening Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Overview of Nigerian background screening activity and outcomes
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpis.map(kpi => (
          <Card key={kpi.label} className="bg-card/60 border-border/50">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-mono text-muted-foreground">{kpi.label}</p>
                {kpi.icon}
              </div>
              <p className="text-2xl font-mono font-bold text-foreground">{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Outcome distribution pie */}
        <Card className="bg-card/60 border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono text-muted-foreground">Outcome Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {outcomeData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground">
                <p className="text-xs font-mono">No completed orders yet</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={outcomeData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {outcomeData.map((entry, i) => (
                      <Cell key={i} fill={OUTCOME_COLORS[entry.name] ?? '#6b7280'} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12, fontFamily: 'monospace' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, fontFamily: 'monospace' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Completion status pie */}
        <Card className="bg-card/60 border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono text-muted-foreground">Order Completion Status</CardTitle>
          </CardHeader>
          <CardContent>
            {completionData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground">
                <p className="text-xs font-mono">No orders yet</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={completionData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    <Cell fill="#10b981" />
                    <Cell fill="#3b82f6" />
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12, fontFamily: 'monospace' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, fontFamily: 'monospace' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Summary table */}
      <Card className="bg-card/60 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono text-muted-foreground">Summary Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-mono">
              <thead>
                <tr className="border-b border-border/50 text-xs text-muted-foreground">
                  <th className="text-left py-2 px-3">Metric</th>
                  <th className="text-right py-2 px-3">Count</th>
                  <th className="text-right py-2 px-3">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Total Orders',        value: stats?.totalOrders    ?? 0, pct: null },
                  { label: 'Completed',            value: stats?.completedOrders ?? 0, pct: total },
                  { label: 'Pending',              value: stats?.pendingOrders  ?? 0, pct: total },
                  { label: 'Clear Outcome',        value: stats?.clearCount     ?? 0, pct: total },
                  { label: 'Consider Outcome',     value: stats?.considerCount  ?? 0, pct: total },
                  { label: 'Adverse Outcome',      value: stats?.adverseCount   ?? 0, pct: total },
                  { label: 'Total Candidates',     value: stats?.totalCandidates ?? 0, pct: null },
                  { label: 'Active Monitors',      value: stats?.activeContinuousMonitors ?? 0, pct: null },
                ].map(row => (
                  <tr key={row.label} className="border-b border-border/30 hover:bg-muted/10">
                    <td className="py-2 px-3 text-foreground">{row.label}</td>
                    <td className="py-2 px-3 text-right text-foreground font-semibold">{row.value.toLocaleString()}</td>
                    <td className="py-2 px-3 text-right text-muted-foreground">
                      {row.pct != null && row.pct > 0
                        ? `${(row.value / row.pct * 100).toFixed(1)}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
