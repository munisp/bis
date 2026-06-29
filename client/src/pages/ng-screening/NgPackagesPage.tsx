import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Plus, Package, Edit, CheckSquare, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ALL_SCREENING_TYPES = [
  { value: 'nin_trace',           label: 'NIN Trace & Address History' },
  { value: 'bvn_verification',    label: 'BVN Verification' },
  { value: 'criminal_efcc',       label: 'EFCC Criminal Check' },
  { value: 'criminal_icpc',       label: 'ICPC Criminal Check' },
  { value: 'court_records',       label: 'Court Records Search' },
  { value: 'cac_directorship',    label: 'CAC Directorship Check' },
  { value: 'education_waec',      label: 'WAEC/NECO Certificate Verification' },
  { value: 'education_degree',    label: 'University Degree Verification' },
  { value: 'employment_history',  label: 'Employment History Verification' },
  { value: 'nysc_discharge',      label: 'NYSC Discharge Certificate' },
  { value: 'professional_licence',label: 'Professional Licence (COREN/NBA/MDCN/ICAN)' },
  { value: 'adverse_media',       label: 'Adverse Media Screening' },
  { value: 'pep_sanctions',       label: 'PEP & Sanctions Watchlist' },
  { value: 'work_permit',         label: 'Work Permit / NIS Verification' },
  { value: 'credit_check',        label: 'Credit Bureau Check (CRC/FirstCentral)' },
  { value: 'social_media',        label: 'Social Media Intelligence' },
];

type Tier = 'basic' | 'standard' | 'executive' | 'transport' | 'healthcare' | 'financial' | 'custom';

const TIER_COLORS: Record<string, string> = {
  basic:      'bg-gray-100 text-gray-700',
  standard:   'bg-blue-100 text-blue-700',
  executive:  'bg-purple-100 text-purple-700',
  transport:  'bg-orange-100 text-orange-700',
  healthcare: 'bg-green-100 text-green-700',
  financial:  'bg-yellow-100 text-yellow-700',
  custom:     'bg-pink-100 text-pink-700',
};

interface PackageFormData {
  name: string;
  description: string;
  tier: Tier;
  screeningTypes: string[];
  priceNgn: number;
  etaHours: number;
  isPublic: boolean;
  isActive: boolean;
}

const DEFAULT_FORM: PackageFormData = {
  name: '', description: '', tier: 'standard',
  screeningTypes: [], priceNgn: 0, etaHours: 48,
  isPublic: false, isActive: true,
};

export default function NgPackagesPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [form, setForm] = useState<PackageFormData>(DEFAULT_FORM);

  const utils = trpc.useUtils();

  const { data: packages, isLoading } = trpc.ngScreening.packages.list.useQuery({
    includePublic: true,
    tier: tierFilter !== 'all' ? tierFilter : undefined,
  });

  const createMut = trpc.ngScreening.packages.create.useMutation({
    onSuccess: () => { toast.success('Package created'); utils.ngScreening.packages.list.invalidate(); setShowCreate(false); setForm(DEFAULT_FORM); },
    onError: (e) => toast.error(e.message),
  });

  const updateMut = trpc.ngScreening.packages.update.useMutation({
    onSuccess: () => { toast.success('Package updated'); utils.ngScreening.packages.list.invalidate(); setEditingId(null); setForm(DEFAULT_FORM); setShowCreate(false); },
    onError: (e) => toast.error(e.message),
  });

  const toggleType = (type: string) => {
    setForm(f => ({
      ...f,
      screeningTypes: f.screeningTypes.includes(type)
        ? f.screeningTypes.filter(t => t !== type)
        : [...f.screeningTypes, type],
    }));
  };

  const openEdit = (pkg: any) => {
    setEditingId(pkg.id);
    setForm({
      name: pkg.name,
      description: pkg.description ?? '',
      tier: pkg.tier ?? 'standard',
      screeningTypes: (pkg.screeningTypes as string[]) ?? [],
      priceNgn: pkg.priceNgn ?? 0,
      etaHours: pkg.etaHours ?? 48,
      isPublic: pkg.isPublic ?? false,
      isActive: pkg.isActive ?? true,
    });
    setShowCreate(true);
  };

  const handleSubmit = () => {
    if (!form.name) { toast.error('Package name is required'); return; }
    if (form.screeningTypes.length === 0) { toast.error('Select at least one screening type'); return; }
    if (editingId) {
      updateMut.mutate({ id: editingId, name: form.name, description: form.description || undefined, screeningTypes: form.screeningTypes, priceNgn: form.priceNgn, etaHours: form.etaHours, isActive: form.isActive });
    } else {
      createMut.mutate({ name: form.name, description: form.description || undefined, tier: form.tier, screeningTypes: form.screeningTypes, priceNgn: form.priceNgn, etaHours: form.etaHours, isPublic: form.isPublic });
    }
  };

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-mono font-bold text-foreground">Screening Packages</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Define reusable bundles of Nigerian background screening checks
          </p>
        </div>
        <Button size="sm" onClick={() => { setEditingId(null); setForm(DEFAULT_FORM); setShowCreate(true); }}>
          <Plus size={14} className="mr-2" /> New Package
        </Button>
      </div>

      {/* Tier filter */}
      <div className="flex gap-2 flex-wrap">
        {(['all','basic','standard','executive','transport','healthcare','financial','custom'] as const).map(t => (
          <Button key={t} size="sm" variant={tierFilter === t ? 'default' : 'outline'}
            className="capitalize text-xs h-7" onClick={() => setTierFilter(t)}>{t}</Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      ) : !packages || packages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <Package size={40} className="mb-4 opacity-30" />
          <p className="text-sm font-mono">No packages yet</p>
          <p className="text-xs mt-1">Create your first screening package to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {packages.map((pkg) => (
            <Card key={pkg.id} className="bg-card/60 border-border/50 hover:border-border transition-colors">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base font-mono text-foreground">{pkg.name}</CardTitle>
                    {pkg.description && <p className="text-xs text-muted-foreground mt-1">{pkg.description}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge className={`text-xs capitalize ${TIER_COLORS[pkg.tier] ?? ''}`}>{pkg.tier}</Badge>
                    <Badge variant={pkg.isActive ? 'default' : 'secondary'} className="text-xs">{pkg.isActive ? 'Active' : 'Inactive'}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1">
                  {(pkg.screeningTypes as string[]).slice(0, 5).map((t: string) => (
                    <span key={t} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                      {ALL_SCREENING_TYPES.find(s => s.value === t)?.label ?? t}
                    </span>
                  ))}
                  {(pkg.screeningTypes as string[]).length > 5 && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      +{(pkg.screeningTypes as string[]).length - 5} more
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
                  <span>{(pkg.screeningTypes as string[]).length} checks</span>
                  <span className="flex items-center gap-1"><Clock size={10} /> {pkg.etaHours}h ETA</span>
                  <span>₦{(pkg.priceNgn ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => openEdit(pkg)}>
                    <Edit size={12} className="mr-1" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
                    onClick={() => updateMut.mutate({ id: pkg.id, isActive: !pkg.isActive })}
                    disabled={updateMut.isPending}>
                    {pkg.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={showCreate} onOpenChange={open => { if (!open) { setShowCreate(false); setEditingId(null); setForm(DEFAULT_FORM); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono">{editingId ? 'Edit Package' : 'Create Screening Package'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs font-mono">Package Name *</Label>
                <Input
                  placeholder="e.g. Standard Employment Check"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="font-mono text-sm"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs font-mono">Description</Label>
                <Textarea
                  placeholder="Brief description of this package..."
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="font-mono text-sm resize-none"
                  rows={2}
                />
              </div>
              {!editingId && (
                <div className="space-y-1">
                  <Label className="text-xs font-mono">Tier</Label>
                  <Select value={form.tier} onValueChange={(v: Tier) => setForm(f => ({ ...f, tier: v }))}>
                    <SelectTrigger className="font-mono text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(['basic','standard','executive','transport','healthcare','financial','custom'] as Tier[]).map(t => (
                        <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs font-mono">Price (₦)</Label>
                <Input type="number" min={0} value={form.priceNgn}
                  onChange={e => setForm(f => ({ ...f, priceNgn: Number(e.target.value) }))} className="font-mono text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-mono">ETA (hours)</Label>
                <Input type="number" min={1} max={720} value={form.etaHours}
                  onChange={e => setForm(f => ({ ...f, etaHours: Number(e.target.value) }))} className="font-mono text-sm" />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-mono">Screening Checks *</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto border border-border/50 rounded-lg p-3">
                {ALL_SCREENING_TYPES.map(type => (
                  <label
                    key={type.value}
                    className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors text-xs font-mono
                      ${form.screeningTypes.includes(type.value)
                        ? 'bg-primary/10 text-primary border border-primary/20'
                        : 'hover:bg-muted/30 text-muted-foreground border border-transparent'}`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={form.screeningTypes.includes(type.value)}
                      onChange={() => toggleType(type.value)}
                    />
                    <CheckSquare size={12} className={form.screeningTypes.includes(type.value) ? 'text-primary' : 'opacity-30'} />
                    {type.label}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{form.screeningTypes.length} checks selected</p>
            </div>

            {!editingId && (
              <div className="flex items-center gap-3">
                <Switch checked={form.isPublic} onCheckedChange={v => setForm(f => ({ ...f, isPublic: v }))} />
                <Label className="text-xs font-mono">Make available to all tenants</Label>
              </div>
            )}
            {editingId && (
              <div className="flex items-center gap-3">
                <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
                <Label className="text-xs font-mono">Active (available for ordering)</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); setEditingId(null); setForm(DEFAULT_FORM); }}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isPending || !form.name || form.screeningTypes.length === 0}>
              {isPending && <Loader2 size={14} className="mr-2 animate-spin" />}
              {editingId ? 'Save Changes' : 'Create Package'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
