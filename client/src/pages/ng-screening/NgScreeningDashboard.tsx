import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ShieldCheck, Clock, AlertTriangle, CheckCircle, XCircle, Search, Plus, RefreshCw, TrendingUp, Users, Eye } from 'lucide-react';
import { useLocation } from 'wouter';
import { formatDistanceToNow } from 'date-fns';

const OUTCOME_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  clear:    { label: 'Clear',    color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', icon: <CheckCircle size={12} /> },
  consider: { label: 'Consider', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30',     icon: <AlertTriangle size={12} /> },
  adverse:  { label: 'Adverse',  color: 'text-red-400 bg-red-500/10 border-red-500/30',           icon: <XCircle size={12} /> },
  pending:  { label: 'Pending',  color: 'text-blue-400 bg-blue-500/10 border-blue-500/30',        icon: <Clock size={12} /> },
};

const STATUS_COLOR: Record<string, string> = {
  pending:    'text-blue-400',
  processing: 'text-amber-400',
  completed:  'text-emerald-400',
  failed:     'text-red-400',
  review:     'text-purple-400',
};

export default function NgScreeningDashboard() {
  const [, navigate] = useLocation();
  const [search, setSearch]   = useState('');
  const [status, setStatus]   = useState<string>('all');
  const [outcome, setOutcome] = useState<string>('all');
  const [offset, setOffset]   = useState(0);
  const LIMIT = 25;

  const { data: summary, isLoading: summaryLoading } = trpc.ngScreening.analytics.summary.useQuery();

  const { data: ordersData, isLoading: ordersLoading, refetch } = trpc.ngScreening.orders.list.useQuery({
    search:  search  || undefined,
    status:  status  !== 'all' ? status  : undefined,
    outcome: outcome !== 'all' ? outcome : undefined,
    limit:   LIMIT,
    offset,
  });

  const items = ordersData?.items ?? [];
  const total = ordersData?.total ?? 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-mono font-bold text-foreground">Nigerian Background Screening</h1>
          <p className="text-sm text-muted-foreground mt-1">
            NDPR-compliant checks — criminal, education, employment, professional licences
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw size={14} className="mr-2" /> Refresh
          </Button>
          <Button size="sm" onClick={() => navigate('/ng-screening/candidates')}>
            <Plus size={14} className="mr-2" /> New Screening
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      {summaryLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading summary…</div>
      ) : summary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-card/60 border-border/50">
            <CardHeader className="pb-2"><CardTitle className="text-xs font-mono text-muted-foreground flex items-center gap-1"><TrendingUp size={12} /> Total Orders</CardTitle></CardHeader>
            <CardContent><div className="text-3xl font-mono font-bold">{summary.totalOrders}</div><div className="text-xs text-muted-foreground mt-1">{summary.pendingOrders} pending</div></CardContent>
          </Card>
          <Card className="bg-card/60 border-border/50">
            <CardHeader className="pb-2"><CardTitle className="text-xs font-mono text-muted-foreground flex items-center gap-1"><Users size={12} /> Candidates</CardTitle></CardHeader>
            <CardContent><div className="text-3xl font-mono font-bold">{summary.totalCandidates}</div><div className="text-xs text-muted-foreground mt-1">{summary.activeContinuousMonitors} monitored</div></CardContent>
          </Card>
          <Card className="bg-card/60 border-border/50">
            <CardHeader className="pb-2"><CardTitle className="text-xs font-mono text-muted-foreground flex items-center gap-1"><CheckCircle size={12} /> Clear</CardTitle></CardHeader>
            <CardContent><div className="text-3xl font-mono font-bold text-emerald-400">{summary.clearCount}</div><div className="text-xs text-muted-foreground mt-1">of {summary.completedOrders} completed</div></CardContent>
          </Card>
          <Card className="bg-card/60 border-border/50">
            <CardHeader className="pb-2"><CardTitle className="text-xs font-mono text-muted-foreground flex items-center gap-1"><AlertTriangle size={12} /> Consider / Adverse</CardTitle></CardHeader>
            <CardContent><div className="text-3xl font-mono font-bold text-amber-400">{summary.considerCount + summary.adverseCount}</div><div className="text-xs text-muted-foreground mt-1">{summary.adverseCount} adverse</div></CardContent>
          </Card>
        </div>
      ) : null}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search orders…" className="pl-9 font-mono text-sm" value={search}
            onChange={e => { setSearch(e.target.value); setOffset(0); }} />
        </div>
        <Select value={status} onValueChange={v => { setStatus(v); setOffset(0); }}>
          <SelectTrigger className="w-36 font-mono text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="review">Review</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={outcome} onValueChange={v => { setOutcome(v); setOffset(0); }}>
          <SelectTrigger className="w-36 font-mono text-sm"><SelectValue placeholder="Outcome" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Outcomes</SelectItem>
            <SelectItem value="clear">Clear</SelectItem>
            <SelectItem value="consider">Consider</SelectItem>
            <SelectItem value="adverse">Adverse</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Orders table */}
      <Card className="bg-card/60 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono text-muted-foreground">{total} screening order{total !== 1 ? 's' : ''}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {ordersLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <ShieldCheck size={32} className="mb-3 opacity-30" />
              <p className="text-sm font-mono">No screening orders found</p>
              <p className="text-xs mt-1">Invite a candidate to start a background check</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm font-mono">
                <thead>
                  <tr className="border-b border-border/50 text-xs text-muted-foreground">
                    <th className="text-left px-4 py-3">Order Ref</th>
                    <th className="text-left px-4 py-3">Candidate</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">Outcome</th>
                    <th className="text-left px-4 py-3">ETA</th>
                    <th className="text-left px-4 py-3">Ordered</th>
                    <th className="text-left px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(({ order, candidateFirstName, candidateLastName, candidateEmail }) => {
                    const oc = OUTCOME_CONFIG[order.overallOutcome ?? 'pending'] ?? OUTCOME_CONFIG.pending;
                    return (
                      <tr key={order.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors cursor-pointer"
                        onClick={() => navigate(`/ng-screening/orders/${order.orderRef}`)}>
                        <td className="px-4 py-3 text-primary">{order.orderRef}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{candidateFirstName} {candidateLastName}</div>
                          <div className="text-xs text-muted-foreground">{candidateEmail}</div>
                        </td>
                        <td className="px-4 py-3"><span className={`capitalize ${STATUS_COLOR[order.status] ?? 'text-muted-foreground'}`}>{order.status}</span></td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${oc.color}`}>
                            {oc.icon}{oc.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{order.etaAt ? new Date(order.etaAt).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{formatDistanceToNow(new Date(order.createdAt), { addSuffix: true })}</td>
                        <td className="px-4 py-3">
                          <Button size="sm" variant="ghost" className="h-7 text-xs"
                            onClick={e => { e.stopPropagation(); navigate(`/ng-screening/orders/${order.orderRef}`); }}>
                            <Eye size={12} className="mr-1" /> View
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-between text-sm font-mono text-muted-foreground">
          <span>Showing {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
