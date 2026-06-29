import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Landmark, Plus, Search, AlertTriangle, CheckCircle, Clock, HelpCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const OUTCOME_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  clear:      { label: 'Valid',       color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', icon: <CheckCircle size={12} /> },
  adverse:    { label: 'Expired',     color: 'text-red-400 bg-red-500/10 border-red-500/30',            icon: <AlertTriangle size={12} /> },
  unverified: { label: 'Unverified',  color: 'text-amber-400 bg-amber-500/10 border-amber-500/30',      icon: <Clock size={12} /> },
  pending:    { label: 'Pending',     color: 'text-blue-400 bg-blue-500/10 border-blue-500/30',         icon: <HelpCircle size={12} /> },
};

const PERMIT_TYPES = [
  { value: 'expatriate_quota',                   label: 'Expatriate Quota' },
  { value: 'combined_expatriate_residence_permit',label: 'CERPAC (Combined Expatriate)' },
  { value: 'temporary_work_permit',              label: 'Temporary Work Permit' },
  { value: 'subject_to_regularisation',          label: 'Subject to Regularisation' },
  { value: 'business_visa',                      label: 'Business Visa' },
];

interface VerifyFormData {
  orderRef: string;
  permitNumber: string;
  permitType: string;
  candidateName: string;
}

const DEFAULT_FORM: VerifyFormData = {
  orderRef: '', permitNumber: '', permitType: '', candidateName: '',
};

export default function NgWorkPermitsPage() {
  const [search, setSearch] = useState('');
  const [showVerify, setShowVerify] = useState(false);
  const [form, setForm] = useState<VerifyFormData>(DEFAULT_FORM);
  const [results, setResults] = useState<any[]>([]);

  // Work permits are stored as screening results with type nis_work_permit
  // We query all orders and display them alongside session results
  const { data: ordersData, isLoading } = trpc.ngScreening.orders.list.useQuery({
    limit: 50,
    offset: 0,
  });

  const verifyMut = trpc.ngScreening.execute.workPermitCheck.useMutation({
    onSuccess: (result) => {
      toast.success(result.isValid ? 'Work permit is valid' : result.isExpired ? 'Work permit has expired' : 'Work permit could not be verified');
      setResults(prev => [{ ...form, ...result, id: Date.now() }, ...prev]);
      setShowVerify(false);
      setForm(DEFAULT_FORM);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const orders = (ordersData?.items ?? []).filter((o: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (o.order?.orderRef ?? '').toLowerCase().includes(s)
      || (o.candidateFirstName ?? '').toLowerCase().includes(s)
      || (o.candidateLastName ?? '').toLowerCase().includes(s);
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-mono font-bold text-foreground">Work Permits & NIS Verification</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Verify CERPAC, expatriate quota, and work authorisation for expatriate employees via NIS
          </p>
        </div>
        <Button size="sm" onClick={() => { setForm(DEFAULT_FORM); setShowVerify(true); }}>
          <Plus size={14} className="mr-2" /> Verify Permit
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by order ref or candidate name..."
          className="pl-9 font-mono text-sm"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* In-session verification results */}
      {results.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Recent Verifications (this session)</p>
          {results.map((r) => {
            const outcome = r.isExpired ? 'adverse' : r.isValid ? 'clear' : 'unverified';
            const cfg = OUTCOME_CONFIG[outcome];
            return (
              <Card key={r.id} className="bg-card/60 border-border/50">
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${cfg.color}`}>
                          {cfg.icon} {cfg.label}
                        </span>
                        <span className="text-xs font-mono text-muted-foreground">{r.permitNumber}</span>
                      </div>
                      <p className="text-xs font-mono text-muted-foreground">
                        {PERMIT_TYPES.find(p => p.value === r.permitType)?.label ?? r.permitType} · Order: {r.orderRef}
                      </p>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">{r.candidateName}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Orders with work permit checks */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      ) : orders.length === 0 && results.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <Landmark size={40} className="mb-4 opacity-30" />
          <p className="text-sm font-mono">No work permit checks yet</p>
          <p className="text-xs mt-1">Use "Verify Permit" to run an NIS work permit verification against an existing order</p>
        </div>
      ) : orders.length > 0 ? (
        <div className="space-y-3">
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Orders with NIS Work Permit Checks</p>
          {orders.map((row: any) => {
            const order = row.order ?? row;
            const statusCfg = OUTCOME_CONFIG[order.status ?? 'pending'] ?? OUTCOME_CONFIG.pending;
            return (
              <Card key={order.orderRef} className="bg-card/60 border-border/50">
                <CardContent className="pt-4 pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${statusCfg.color}`}>
                          {statusCfg.icon} {statusCfg.label}
                        </span>
                        <span className="text-xs font-mono text-muted-foreground">{order.orderRef}</span>
                      </div>
                      {(row.candidateFirstName || row.candidateLastName) && (
                        <p className="font-mono text-sm text-foreground">
                          {row.candidateFirstName} {row.candidateLastName}
                          {row.candidateEmail && <span className="text-muted-foreground text-xs ml-2">{row.candidateEmail}</span>}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                      {order.createdAt && <span>{formatDistanceToNow(new Date(order.createdAt), { addSuffix: true })}</span>}
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => { setForm(f => ({ ...f, orderRef: order.orderRef })); setShowVerify(true); }}>
                        Re-verify
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      {/* Verify dialog */}
      <Dialog open={showVerify} onOpenChange={open => { if (!open) { setShowVerify(false); setForm(DEFAULT_FORM); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono">Verify NIS Work Permit</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs font-mono">Order Reference *</Label>
              <Input placeholder="ORD-XXXXXX" value={form.orderRef}
                onChange={e => setForm(f => ({ ...f, orderRef: e.target.value }))} className="font-mono text-sm" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs font-mono">Permit Type *</Label>
              <Select value={form.permitType} onValueChange={v => setForm(f => ({ ...f, permitType: v }))}>
                <SelectTrigger className="font-mono text-sm"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {PERMIT_TYPES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-mono">Permit Number *</Label>
              <Input value={form.permitNumber}
                onChange={e => setForm(f => ({ ...f, permitNumber: e.target.value }))} className="font-mono text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-mono">Candidate Full Name *</Label>
              <Input value={form.candidateName}
                onChange={e => setForm(f => ({ ...f, candidateName: e.target.value }))} className="font-mono text-sm" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground font-mono">
            This will call the NIS API to verify the permit and store the result against the order.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowVerify(false); setForm(DEFAULT_FORM); }}>Cancel</Button>
            <Button
              onClick={() => {
                if (!form.orderRef || !form.permitType || !form.permitNumber || !form.candidateName) {
                  toast.error('All fields are required');
                  return;
                }
                verifyMut.mutate({
                  orderRef: form.orderRef,
                  permitNumber: form.permitNumber,
                  permitType: form.permitType as any,
                  candidateName: form.candidateName,
                });
              }}
              disabled={verifyMut.isPending}
            >
              {verifyMut.isPending && <Loader2 size={14} className="mr-2 animate-spin" />}
              Verify via NIS
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
