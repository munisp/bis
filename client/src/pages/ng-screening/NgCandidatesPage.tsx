import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2, UserSearch, Plus, Search, Eye, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useLocation } from 'wouter';
import { formatDistanceToNow } from 'date-fns';

const NG_STATES = [
  'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno',
  'Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT','Gombe','Imo',
  'Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa',
  'Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba',
  'Yobe','Zamfara',
];

interface CandidateFormData {
  firstName: string;
  lastName: string;
  middleName: string;
  nin: string;
  bvn: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  stateOfOrigin: string;
  stateOfResidence: string;
  address: string;
  packageId: string;
}

const DEFAULT_FORM: CandidateFormData = {
  firstName: '', lastName: '', middleName: '', nin: '', bvn: '',
  email: '', phone: '', dateOfBirth: '', gender: '', stateOfOrigin: '',
  stateOfResidence: '', address: '', packageId: '',
};

export default function NgCandidatesPage() {
  const [, navigate] = useLocation();
  const [search, setSearch]   = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [offset, setOffset]   = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [showOrder, setShowOrder]   = useState(false);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [form, setForm] = useState<CandidateFormData>(DEFAULT_FORM);
  const [step, setStep] = useState<1 | 2>(1);
  const [orderPackageId, setOrderPackageId] = useState<string>('');
  const LIMIT = 25;

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.ngScreening.candidates.list.useQuery({
    search: search || undefined,
    status: statusFilter !== 'all' ? statusFilter : undefined,
    limit: LIMIT,
    offset,
  });
  const candidates = data?.items ?? [];
  const total = data?.total ?? 0;

  const { data: packagesData } = trpc.ngScreening.packages.list.useQuery({ includePublic: true });
  const packages = (packagesData ?? []).filter((p: any) => p.isActive);

  const inviteMut = trpc.ngScreening.candidates.invite.useMutation({
    onSuccess: () => {
      toast.success('Candidate invited — they will receive an email to provide NDPR consent');
      utils.ngScreening.candidates.list.invalidate();
      setShowCreate(false);
      setForm(DEFAULT_FORM);
      setStep(1);
    },
    onError: (e) => toast.error(e.message),
  });

  const orderMut = trpc.ngScreening.orders.create.useMutation({
    onSuccess: (result) => {
      toast.success(`Screening order created: ${result.orderRef}`);
      utils.ngScreening.orders.list.invalidate();
      setShowOrder(false);
      setSelectedRef(null);
      setOrderPackageId('');
      navigate('/ng-screening');
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!form.firstName || !form.lastName || !form.email) {
      toast.error('First name, last name, and email are required');
      return;
    }
    inviteMut.mutate({
      firstName: form.firstName,
      middleName: form.middleName || undefined,
      lastName: form.lastName,
      email: form.email,
      phone: form.phone || undefined,
      nationality: 'Nigerian',
    });
  };

  const handleOrder = () => {
    if (!selectedRef) return;
    orderMut.mutate({
      candidateRef: selectedRef,
      packageId: orderPackageId ? Number(orderPackageId) : undefined,
      screeningTypes: ['nin_trace'],
    });
  };

  const isPending = inviteMut.isPending || orderMut.isPending;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-mono font-bold text-foreground">Candidate Portal</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Register candidates and initiate Nigerian background screening orders
          </p>
        </div>
        <Button size="sm" onClick={() => { setStep(1); setForm(DEFAULT_FORM); setShowCreate(true); }}>
          <Plus size={14} className="mr-2" />
          New Candidate
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name, NIN, BVN, email..."
          className="pl-9 font-mono text-sm"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Candidates list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      ) : candidates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <UserSearch size={40} className="mb-4 opacity-30" />
          <p className="text-sm font-mono">No candidates found</p>
          <p className="text-xs mt-1">Register a candidate to start a background check</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {candidates.map((c: any) => (
            <Card key={c.id} className="bg-card/60 border-border/50 hover:border-border transition-colors cursor-pointer"
              onClick={() => navigate(`/ng-screening/candidates/${c.id}`)}>
              <CardContent className="pt-4 pb-3 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-mono font-semibold text-foreground">
                      {c.firstName} {c.middleName ? `${c.middleName} ` : ''}{c.lastName}
                    </p>
                    {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
                  </div>
                  <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                    {c.stateOfOrigin ?? 'NG'}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono text-muted-foreground">
                  {c.nin && <div><span className="text-foreground/60">NIN:</span> {c.nin.slice(0, 4)}****</div>}
                  {c.bvn && <div><span className="text-foreground/60">BVN:</span> {c.bvn.slice(0, 4)}****</div>}
                  {c.phone && <div><span className="text-foreground/60">Tel:</span> {c.phone}</div>}
                  {c.dateOfBirth && <div><span className="text-foreground/60">DOB:</span> {c.dateOfBirth}</div>}
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" className="flex-1 h-7 text-xs"
                    onClick={e => { e.stopPropagation(); navigate(`/ng-screening/candidates/${c.id}`); }}>
                    <Eye size={12} className="mr-1" /> View
                  </Button>
                  <Button size="sm" className="flex-1 h-7 text-xs"
                    onClick={e => {
                      e.stopPropagation();
                      setForm({ ...DEFAULT_FORM, packageId: '' });
                      // Pre-fill with existing candidate — just navigate to order creation
                      navigate(`/ng-screening/candidates/${c.id}`);
                    }}>
                    <ShieldCheck size={12} className="mr-1" /> Screen
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create candidate dialog */}
      <Dialog open={showCreate} onOpenChange={open => { if (!open) { setShowCreate(false); setStep(1); setForm(DEFAULT_FORM); } }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono">
              {step === 1 ? 'Register Candidate' : 'Select Screening Package'}
            </DialogTitle>
          </DialogHeader>

          {step === 1 && (
            <div className="grid grid-cols-2 gap-4 py-2">
              {[
                { key: 'firstName', label: 'First Name *', col: 1 },
                { key: 'lastName',  label: 'Last Name *',  col: 1 },
                { key: 'middleName',label: 'Middle Name',  col: 1 },
                { key: 'email',     label: 'Email',        col: 1 },
                { key: 'phone',     label: 'Phone',        col: 1 },
                { key: 'nin',       label: 'NIN (11 digits)', col: 1 },
                { key: 'bvn',       label: 'BVN (11 digits)', col: 1 },
                { key: 'dateOfBirth', label: 'Date of Birth', col: 1 },
                { key: 'address',   label: 'Residential Address', col: 2 },
              ].map(f => (
                <div key={f.key} className={`space-y-1 ${f.col === 2 ? 'col-span-2' : ''}`}>
                  <Label className="text-xs font-mono">{f.label}</Label>
                  <Input
                    type={f.key === 'dateOfBirth' ? 'date' : 'text'}
                    value={(form as any)[f.key]}
                    onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="font-mono text-sm"
                  />
                </div>
              ))}
              <div className="space-y-1">
                <Label className="text-xs font-mono">Gender</Label>
                <Select value={form.gender} onValueChange={v => setForm(f => ({ ...f, gender: v }))}>
                  <SelectTrigger className="font-mono text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-mono">State of Origin</Label>
                <Select value={form.stateOfOrigin} onValueChange={v => setForm(f => ({ ...f, stateOfOrigin: v }))}>
                  <SelectTrigger className="font-mono text-sm"><SelectValue placeholder="Select state" /></SelectTrigger>
                  <SelectContent className="max-h-48">
                    {NG_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-mono">State of Residence</Label>
                <Select value={form.stateOfResidence} onValueChange={v => setForm(f => ({ ...f, stateOfResidence: v }))}>
                  <SelectTrigger className="font-mono text-sm"><SelectValue placeholder="Select state" /></SelectTrigger>
                  <SelectContent className="max-h-48">
                    {NG_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground font-mono">
                Optionally select a screening package to immediately order a background check.
                You can also skip this and order later from the candidate profile.
              </p>
              <div className="grid gap-3">
                {packages.map((pkg: any) => (
                  <label
                    key={pkg.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                      ${form.packageId === pkg.id.toString()
                        ? 'border-primary bg-primary/5'
                        : 'border-border/50 hover:border-border'}`}
                  >
                    <input
                      type="radio"
                      className="mt-0.5"
                      checked={form.packageId === pkg.id.toString()}
                      onChange={() => setForm(f => ({ ...f, packageId: pkg.id.toString() }))}
                    />
                    <div>
                      <p className="font-mono text-sm font-semibold text-foreground">{pkg.name}</p>
                      {pkg.description && <p className="text-xs text-muted-foreground">{pkg.description}</p>}
                      <p className="text-xs text-muted-foreground mt-1">
                        {pkg.screeningTypes?.length ?? 0} checks · {pkg.turnaroundDays ?? 5} day TAT
                        {pkg.price ? ` · ₦${pkg.price.toLocaleString()}` : ''}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            {step === 2 && (
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
            )}
            <Button variant="outline" onClick={() => { setShowCreate(false); setStep(1); setForm(DEFAULT_FORM); }}>
              Cancel
            </Button>
            {step === 1 ? (
              <Button
                onClick={() => setStep(2)}
                disabled={!form.firstName || !form.lastName}
              >
                Next: Select Package
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={isPending}>
                {isPending && <Loader2 size={14} className="mr-2 animate-spin" />}
                {form.packageId ? 'Create & Order Screening' : 'Create Candidate'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
