import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Activity, Bell, BellOff, RefreshCw, PauseCircle, XCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const FREQ_LABEL: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
};

const CHECK_TYPE_LABEL: Record<string, string> = {
  criminal_efcc:       'EFCC Criminal',
  criminal_icpc:       'ICPC Criminal',
  court_records:       'Court Records',
  pep_sanctions:       'PEP & Sanctions',
  adverse_media:       'Adverse Media',
  cac_directorship:    'CAC Directorship',
  professional_licence:'Professional Licence',
  nin_trace:           'NIN Trace',
  bvn_verification:    'BVN Verification',
};

const STATUS_COLOR: Record<string, string> = {
  active:  'text-emerald-400',
  paused:  'text-amber-400',
  expired: 'text-muted-foreground',
};

export default function NgContinuousPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [offset, setOffset] = useState(0);
  const LIMIT = 25;

  const utils = trpc.useUtils();

  const { data, isLoading, refetch } = trpc.ngScreening.continuous.list.useQuery({
    status: statusFilter !== 'all' ? statusFilter : undefined,
    limit: LIMIT,
    offset,
  });
  const checks = data?.items ?? [];
  const total = data?.total ?? 0;

  const pauseMut = trpc.ngScreening.continuous.pause.useMutation({
    onSuccess: () => { toast.success('Monitoring paused'); utils.ngScreening.continuous.list.invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });

  const cancelMut = trpc.ngScreening.continuous.cancel.useMutation({
    onSuccess: () => { toast.success('Monitoring cancelled'); utils.ngScreening.continuous.list.invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });

  const activeCount = checks.filter((c: any) => (c.check ?? c).status === 'active').length;
  const pausedCount = checks.filter((c: any) => (c.check ?? c).status === 'paused').length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-mono font-bold text-foreground">Continuous Monitoring</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ongoing background check subscriptions — get alerted when a candidate's status changes
          </p>
        </div>
        <div className="flex gap-2">
          {(['all','active','paused','expired'] as const).map(s => (
            <Button key={s} size="sm" variant={statusFilter === s ? 'default' : 'outline'}
              className="capitalize text-xs h-7" onClick={() => { setStatusFilter(s); setOffset(0); }}>{s}</Button>
          ))}
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw size={14} className="mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Active Monitors', value: activeCount, color: 'text-emerald-400' },
          { label: 'Paused',          value: pausedCount, color: 'text-amber-400' },
          { label: 'Total',           value: total,       color: 'text-foreground' },
        ].map(s => (
          <Card key={s.label} className="bg-card/60 border-border/50">
            <CardContent className="pt-4 pb-3">
              <p className="text-xs font-mono text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-mono font-bold mt-1 ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      ) : checks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <Activity size={40} className="mb-4 opacity-30" />
          <p className="text-sm font-mono">No continuous monitoring subscriptions</p>
          <p className="text-xs mt-1">Continuous checks are created when subscribing a candidate to ongoing monitoring</p>
        </div>
      ) : (
        <div className="space-y-3">
          {checks.map((row: any) => {
            const check = row.check ?? row;
            const status = check.status ?? 'active';
            const statusColor = STATUS_COLOR[status] ?? 'text-muted-foreground';
            const candidateName = row.candidateFirstName
              ? `${row.candidateFirstName} ${row.candidateLastName ?? ''}`.trim()
              : null;
            return (
              <Card key={check.checkRef ?? check.id} className="bg-card/60 border-border/50">
                <CardContent className="pt-4 pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 text-xs font-mono ${statusColor}`}>
                          {status === 'active' ? <Bell size={12} /> : <BellOff size={12} />}
                          <span className="capitalize">{status}</span>
                        </span>
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {FREQ_LABEL[check.frequency] ?? check.frequency}
                        </Badge>
                        <span className="text-xs font-mono text-muted-foreground">{check.checkRef}</span>
                      </div>
                      {candidateName && (
                        <p className="font-mono text-sm text-foreground">
                          {candidateName}
                          {row.candidateEmail && <span className="text-muted-foreground text-xs ml-2">{row.candidateEmail}</span>}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1 mt-1">
                        {((check.screeningTypes ?? []) as string[]).map((t: string) => (
                          <span key={t} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                            {CHECK_TYPE_LABEL[t] ?? t}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground">
                      {check.nextCheckAt && (
                        <span>Next: {new Date(check.nextCheckAt).toLocaleDateString('en-NG')}</span>
                      )}
                      {check.expiresAt && (
                        <span>Expires: {new Date(check.expiresAt).toLocaleDateString('en-NG')}</span>
                      )}
                      <span>{check.createdAt ? formatDistanceToNow(new Date(check.createdAt), { addSuffix: true }) : ''}</span>
                    </div>
                  </div>
                  {status === 'active' && (
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => pauseMut.mutate({ checkRef: check.checkRef })}
                        disabled={pauseMut.isPending}>
                        <PauseCircle size={12} className="mr-1" /> Pause
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-red-400 hover:text-red-300"
                        onClick={() => cancelMut.mutate({ checkRef: check.checkRef })}
                        disabled={cancelMut.isPending}>
                        <XCircle size={12} className="mr-1" /> Cancel
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

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
