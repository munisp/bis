import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, Gavel, AlertTriangle, CheckCircle, Clock, XCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pre_adverse_sent:  { label: 'Pre-Adverse Sent',  color: 'text-amber-400 bg-amber-500/10 border-amber-500/30',   icon: <AlertTriangle size={12} /> },
  dispute_received:  { label: 'Dispute Received',  color: 'text-blue-400 bg-blue-500/10 border-blue-500/30',     icon: <Clock size={12} /> },
  final_adverse_sent:{ label: 'Final Adverse Sent',color: 'text-red-400 bg-red-500/10 border-red-500/30',        icon: <XCircle size={12} /> },
  withdrawn:         { label: 'Withdrawn',          color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', icon: <CheckCircle size={12} /> },
  cleared:           { label: 'Cleared',            color: 'text-green-400 bg-green-500/10 border-green-500/30',  icon: <CheckCircle size={12} /> },
};

type ResolveOutcome = 'final_adverse_sent' | 'withdrawn' | 'cleared';

export default function NgAdverseActionsPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<any | null>(null);
  const [resolveOutcome, setResolveOutcome] = useState<ResolveOutcome>('cleared');
  const [resolveNote, setResolveNote] = useState('');
  const [disputeRef, setDisputeRef] = useState<string | null>(null);
  const [disputeNote, setDisputeNote] = useState('');
  const LIMIT = 25;

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.ngScreening.adverseAction.list.useQuery({
    status: statusFilter !== 'all' ? statusFilter : undefined,
    limit: LIMIT,
    offset,
  });
  const actions = data?.items ?? [];
  const total = data?.total ?? 0;

  const resolveMut = trpc.ngScreening.adverseAction.resolve.useMutation({
    onSuccess: () => {
      toast.success('Adverse action resolved');
      utils.ngScreening.adverseAction.list.invalidate();
      setSelected(null);
      setResolveNote('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const disputeMut = trpc.ngScreening.adverseAction.dispute.useMutation({
    onSuccess: () => {
      toast.success('Dispute recorded');
      utils.ngScreening.adverseAction.list.invalidate();
      setDisputeRef(null);
      setDisputeNote('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-mono font-bold text-foreground">Adverse Actions</h1>
          <p className="text-sm text-muted-foreground mt-1">
            NDPR-compliant pre-adverse notice, dispute period, and final adverse action workflow
          </p>
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setOffset(0); }}>
          <SelectTrigger className="w-52 font-mono text-sm">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pre_adverse_sent">Pre-Adverse Sent</SelectItem>
            <SelectItem value="dispute_received">Dispute Received</SelectItem>
            <SelectItem value="final_adverse_sent">Final Adverse Sent</SelectItem>
            <SelectItem value="withdrawn">Withdrawn</SelectItem>
            <SelectItem value="cleared">Cleared</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      ) : actions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <Gavel size={40} className="mb-4 opacity-30" />
          <p className="text-sm font-mono">No adverse actions found</p>
          <p className="text-xs mt-1">Adverse actions are initiated when a screening result requires follow-up</p>
        </div>
      ) : (
        <div className="space-y-3">
          {actions.map((row: any) => {
            const action = row.adverse ?? row;
            const statusKey = action.status ?? 'pre_adverse_sent';
            const cfg = STATUS_CONFIG[statusKey] ?? STATUS_CONFIG.pre_adverse_sent;
            const canResolve = !['final_adverse_sent','withdrawn','cleared'].includes(statusKey);
            return (
              <Card key={action.adverseRef ?? action.id} className="bg-card/60 border-border/50">
                <CardContent className="pt-4 pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${cfg.color}`}>
                          {cfg.icon}
                          {cfg.label}
                        </span>
                        <span className="text-xs font-mono text-muted-foreground">
                          {action.adverseRef ?? `#${action.id}`}
                        </span>
                      </div>
                      <p className="font-mono text-sm text-foreground">
                        Order: <span className="text-primary">{row.orderRef ?? action.orderId}</span>
                      </p>
                      {(row.candidateFirstName || row.candidateLastName) && (
                        <p className="text-xs text-muted-foreground">
                          {row.candidateFirstName} {row.candidateLastName}
                          {row.candidateEmail && ` · ${row.candidateEmail}`}
                        </p>
                      )}
                      {action.reason && (
                        <p className="text-xs text-muted-foreground max-w-lg">{action.reason}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                      {action.preAdverseDeadline && (
                        <span className="text-amber-400">
                          Deadline: {new Date(action.preAdverseDeadline).toLocaleDateString('en-NG')}
                        </span>
                      )}
                      <span>{action.createdAt ? formatDistanceToNow(new Date(action.createdAt), { addSuffix: true }) : ''}</span>
                    </div>
                  </div>
                  {canResolve && (
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => setSelected(action)}>
                        Resolve
                      </Button>
                      {statusKey === 'pre_adverse_sent' && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-blue-400"
                          onClick={() => { setDisputeRef(action.adverseRef); setDisputeNote(''); }}>
                          Record Dispute
                        </Button>
                      )}
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

      {/* Resolve dialog */}
      <Dialog open={!!selected} onOpenChange={open => { if (!open) { setSelected(null); setResolveNote(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono">Resolve Adverse Action</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground font-mono">
              Under NDPR, the candidate has the right to dispute findings before a final adverse decision is issued.
            </p>
            <div className="space-y-1">
              <Label className="text-xs font-mono">Outcome</Label>
              <Select value={resolveOutcome} onValueChange={v => setResolveOutcome(v as ResolveOutcome)}>
                <SelectTrigger className="font-mono text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cleared">Cleared — no adverse action</SelectItem>
                  <SelectItem value="final_adverse_sent">Final Adverse Sent</SelectItem>
                  <SelectItem value="withdrawn">Withdrawn</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-mono">Review Note (optional)</Label>
              <Textarea
                placeholder="Add a note about this resolution..."
                value={resolveNote}
                onChange={e => setResolveNote(e.target.value)}
                className="font-mono text-sm resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSelected(null); setResolveNote(''); }}>Cancel</Button>
            <Button
              onClick={() => {
                if (!selected?.adverseRef) return;
                resolveMut.mutate({ adverseRef: selected.adverseRef, outcome: resolveOutcome, reviewNote: resolveNote || undefined });
              }}
              disabled={resolveMut.isPending}
            >
              {resolveMut.isPending && <Loader2 size={14} className="mr-2 animate-spin" />}
              Confirm Resolution
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dispute dialog */}
      <Dialog open={!!disputeRef} onOpenChange={open => { if (!open) { setDisputeRef(null); setDisputeNote(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono">Record Candidate Dispute</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs font-mono">Dispute Note *</Label>
              <Textarea
                placeholder="Summarise the candidate's dispute..."
                value={disputeNote}
                onChange={e => setDisputeNote(e.target.value)}
                className="font-mono text-sm resize-none"
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDisputeRef(null); setDisputeNote(''); }}>Cancel</Button>
            <Button
              disabled={disputeMut.isPending || disputeNote.length < 10}
              onClick={() => {
                if (!disputeRef) return;
                disputeMut.mutate({ adverseRef: disputeRef, disputeNote });
              }}
            >
              {disputeMut.isPending && <Loader2 size={14} className="mr-2 animate-spin" />}
              Record Dispute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
