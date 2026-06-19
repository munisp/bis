/**
 * BIS Data Sources Registry
 * ==========================
 * Live registry of all Nigerian government and international data source integrations.
 * Data is seeded from the canonical list on first load and persisted in PostgreSQL.
 * Supports registering custom data sources via the "Register Data Source" dialog.
 */

import { useState, useEffect } from 'react';
import BISLayout from '@/components/BISLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Database, CheckCircle2, Clock, XCircle, AlertTriangle, Globe, Shield,
  Building2, Search, RefreshCw, Loader2, Wifi, WifiOff, Activity, Plus, Pencil,
  ToggleLeft, ToggleRight, X as XIcon,
} from 'lucide-react';

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  active:      { label: 'LIVE',      color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', icon: <CheckCircle2 size={10} /> },
  maintenance: { label: 'SANDBOX',   color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/30',    icon: <Clock size={10} /> },
  offline:     { label: 'OFFLINE',   color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/30',        icon: <XCircle size={10} /> },
  degraded:    { label: 'DEGRADED',  color: 'text-orange-400',  bg: 'bg-orange-500/10 border-orange-500/30',  icon: <AlertTriangle size={10} /> },
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  identity:   <Shield size={12} />,
  financial:  <Database size={12} />,
  legal:      <AlertTriangle size={12} />,
  commercial: <Building2 size={12} />,
  government: <Globe size={12} />,
  social:     <Globe size={12} />,
  biometric:  <Activity size={12} />,
};

const CATEGORY_LABELS: Record<string, string> = {
  identity:   'Government ID',
  financial:  'Financial',
  legal:      'Law Enforcement',
  commercial: 'Corporate',
  government: 'Government',
  social:     'Social',
  biometric:  'Biometric',
};

const CATEGORIES = ['All', 'identity', 'financial', 'legal', 'commercial', 'government', 'social', 'biometric'];

// ─── Edit Dialog ─────────────────────────────────────────────────────────────

interface DataSourceRow {
  id: number;
  name: string;
  description?: string | null;
  status: string;
  enabled: boolean;
  provider?: string | null;
  baseUrl?: string | null;
}

interface EditDialogProps {
  source: DataSourceRow | null;
  onClose: () => void;
  onUpdated: () => void;
}

function EditDataSourceDialog({ source, onClose, onUpdated }: EditDialogProps) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    status: 'active' as 'active' | 'degraded' | 'offline' | 'maintenance',
    enabled: true,
  });

  // Pre-fill form whenever a new source is opened
  useEffect(() => {
    if (source) {
      setForm({
        name: source.name,
        description: source.description ?? '',
        status: (source.status as typeof form.status) ?? 'active',
        enabled: source.enabled,
      });
    }
  }, [source]);

  const utils = trpc.useUtils();

  const updateMutation = trpc.dataSources.update.useMutation({
    onSuccess: () => {
      toast.success(`Data source "${form.name}" updated`);
      utils.dataSources.list.invalidate();
      onUpdated();
      onClose();
    },
    onError: (e) => toast.error(`Update failed: ${e.message}`),
  });

  const handleSave = () => {
    if (!source) return;
    if (!form.name.trim() || form.name.trim().length < 2) {
      toast.error('Name must be at least 2 characters');
      return;
    }
    updateMutation.mutate({
      id: source.id,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      status: form.status,
      enabled: form.enabled,
    });
  };

  return (
    <Dialog open={!!source} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-sm">
            <Pencil size={14} className="text-blue-400" />
            EDIT DATA SOURCE
          </DialogTitle>
          <DialogDescription className="text-xs font-mono text-slate-500">
            {source?.name} · ID {source?.id}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label className="text-xs font-mono text-slate-400">DISPLAY NAME *</Label>
            <Input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="font-mono text-xs bg-slate-900/60 border-slate-700 text-slate-200"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label className="text-xs font-mono text-slate-400">DESCRIPTION</Label>
            <Textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="font-mono text-xs bg-slate-900/60 border-slate-700 text-slate-200 resize-none"
              rows={2}
            />
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <Label className="text-xs font-mono text-slate-400">STATUS</Label>
            <Select
              value={form.status}
              onValueChange={v => setForm(f => ({ ...f, status: v as typeof form.status }))}
            >
              <SelectTrigger className="font-mono text-xs bg-slate-900/60 border-slate-700 text-slate-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['active', 'maintenance', 'degraded', 'offline'] as const).map(s => (
                  <SelectItem key={s} value={s} className="font-mono text-xs">
                    {STATUS_CONFIG[s]?.label ?? s.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between bg-slate-900/40 rounded-lg px-3 py-2.5 border border-slate-700/50">
            <div>
              <div className="text-xs font-mono text-slate-300">ENABLED</div>
              <div className="text-[10px] font-mono text-slate-600">Active in the registry</div>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={v => setForm(f => ({ ...f, enabled: v }))}
            />
          </div>
        </div>

        <DialogFooter className="mt-4 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="font-mono text-xs border-slate-700 text-slate-400 hover:bg-slate-800"
          >
            CANCEL
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="font-mono text-xs bg-blue-600 hover:bg-blue-700 text-white"
          >
            {updateMutation.isPending ? (
              <><Loader2 size={12} className="animate-spin mr-1.5" />SAVING...</>
            ) : (
              <><Pencil size={12} className="mr-1.5" />SAVE CHANGES</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Register Dialog ──────────────────────────────────────────────────────────

interface RegisterDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function RegisterDataSourceDialog({ open, onClose, onCreated }: RegisterDialogProps) {
  const [form, setForm] = useState({
    code: '',
    name: '',
    category: 'government' as 'identity' | 'financial' | 'legal' | 'social' | 'biometric' | 'government' | 'commercial',
    provider: '',
    baseUrl: '',
    description: '',
    enabled: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const utils = trpc.useUtils();

  const createMutation = trpc.dataSources.create.useMutation({
    onSuccess: () => {
      toast.success(`Data source "${form.name}" registered successfully`);
      utils.dataSources.list.invalidate();
      onCreated();
      onClose();
      setForm({ code: '', name: '', category: 'government', provider: '', baseUrl: '', description: '', enabled: true });
      setErrors({});
    },
    onError: (e) => {
      toast.error(`Failed to register data source: ${e.message}`);
    },
  });

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.code.trim() || form.code.trim().length < 2) errs.code = 'Code must be at least 2 characters';
    if (!form.name.trim() || form.name.trim().length < 2) errs.name = 'Name must be at least 2 characters';
    if (!form.category) errs.category = 'Category is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    createMutation.mutate({
      code: form.code.trim().toLowerCase().replace(/\s+/g, '_'),
      name: form.name.trim(),
      category: form.category,
      provider: form.provider.trim() || undefined,
      baseUrl: form.baseUrl.trim() || undefined,
      description: form.description.trim() || undefined,
      enabled: form.enabled,
    });
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-sm">
            <Plus size={16} className="text-blue-400" />
            REGISTER DATA SOURCE
          </DialogTitle>
          <DialogDescription className="text-xs font-mono text-slate-500">
            Add a custom data source to the BIS integration registry.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Code */}
          <div className="space-y-1.5">
            <Label className="text-xs font-mono text-slate-400">SOURCE CODE *</Label>
            <Input
              value={form.code}
              onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
              placeholder="e.g. custom_nimc_v2"
              className="font-mono text-xs bg-slate-900/60 border-slate-700 text-slate-200"
            />
            {errors.code && <p className="text-xs text-red-400 font-mono">{errors.code}</p>}
            <p className="text-[10px] text-slate-600 font-mono">Unique identifier — will be lowercased and snake_cased</p>
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <Label className="text-xs font-mono text-slate-400">DISPLAY NAME *</Label>
            <Input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. NIMC Identity Verification v2"
              className="font-mono text-xs bg-slate-900/60 border-slate-700 text-slate-200"
            />
            {errors.name && <p className="text-xs text-red-400 font-mono">{errors.name}</p>}
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <Label className="text-xs font-mono text-slate-400">CATEGORY *</Label>
            <Select
              value={form.category}
              onValueChange={v => setForm(f => ({ ...f, category: v as typeof form.category }))}
            >
              <SelectTrigger className="font-mono text-xs bg-slate-900/60 border-slate-700 text-slate-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['identity', 'financial', 'legal', 'commercial', 'government', 'social', 'biometric'] as const).map(cat => (
                  <SelectItem key={cat} value={cat} className="font-mono text-xs">
                    {CATEGORY_LABELS[cat]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.category && <p className="text-xs text-red-400 font-mono">{errors.category}</p>}
          </div>

          {/* Provider */}
          <div className="space-y-1.5">
            <Label className="text-xs font-mono text-slate-400">PROVIDER / VENDOR</Label>
            <Input
              value={form.provider}
              onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}
              placeholder="e.g. NIMC, CBN, Custom"
              className="font-mono text-xs bg-slate-900/60 border-slate-700 text-slate-200"
            />
          </div>

          {/* Base URL */}
          <div className="space-y-1.5">
            <Label className="text-xs font-mono text-slate-400">BASE URL</Label>
            <Input
              value={form.baseUrl}
              onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
              placeholder="https://api.example.gov.ng/v1"
              className="font-mono text-xs bg-slate-900/60 border-slate-700 text-slate-200"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label className="text-xs font-mono text-slate-400">DESCRIPTION</Label>
            <Textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Brief description of what this data source provides..."
              className="font-mono text-xs bg-slate-900/60 border-slate-700 text-slate-200 resize-none"
              rows={2}
            />
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between bg-slate-900/40 rounded-lg px-3 py-2.5 border border-slate-700/50">
            <div>
              <div className="text-xs font-mono text-slate-300">ENABLE IMMEDIATELY</div>
              <div className="text-[10px] font-mono text-slate-600">Make this source active in the registry</div>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={v => setForm(f => ({ ...f, enabled: v }))}
            />
          </div>
        </div>

        <DialogFooter className="mt-4 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="font-mono text-xs border-slate-700 text-slate-400 hover:bg-slate-800"
          >
            CANCEL
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="font-mono text-xs bg-blue-600 hover:bg-blue-700 text-white"
          >
            {createMutation.isPending ? (
              <><Loader2 size={12} className="animate-spin mr-1.5" />REGISTERING...</>
            ) : (
              <><Plus size={12} className="mr-1.5" />REGISTER</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Health Sparkline ─────────────────────────────────────────────────────────────────

function HealthSparkline({ dataSourceId }: { dataSourceId: number }) {
  const { data: logs, isLoading } = trpc.dataSources.healthHistory.useQuery(
    { dataSourceId, hours: 24 },
    { refetchInterval: 5 * 60 * 1000 },
  );

  if (isLoading) {
    return (
      <div className="h-12 flex items-center justify-center text-[10px] text-slate-600 font-mono mb-2">
        <Loader2 size={10} className="animate-spin mr-1" /> LOADING...
      </div>
    );
  }

  if (!logs || logs.length === 0) {
    return (
      <div className="h-12 flex items-center justify-center text-[10px] text-slate-600 font-mono mb-2">
        NO HISTORY YET
      </div>
    );
  }

  // Build SVG sparkline from responseMs values
  const values = logs.map(l => l.responseMs);
  const maxVal = Math.max(...values, 1);
  const W = 200;
  const H = 32;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * W;
    const y = H - (v / maxVal) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const statusColors: Record<string, string> = {
    active: 'var(--risk-low)',
    degraded: 'var(--risk-medium)',
    offline: 'var(--risk-critical)',
  };
  const lastStatus = logs[logs.length - 1]?.status ?? 'active';
  const lineColor = statusColors[lastStatus] ?? 'var(--risk-low)';

  return (
    <div className="mb-2">
      <div className="text-[10px] text-slate-600 font-mono mb-1">24H RESPONSE TIME</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 32 }}>
        <polyline
          points={pts}
          fill="none"
          stroke={lineColor}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="flex justify-between text-[9px] text-slate-600 font-mono mt-0.5">
        <span>{new Date(logs[0].checkedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
        <span>{maxVal}ms peak</span>
        <span>{new Date(logs[logs.length - 1].checkedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  );
}

// ─── Health History Dialog ──────────────────────────────────────────────────

function HealthHistoryDialog({ dataSourceId, dataSourceName, open, onClose }: {
  dataSourceId: number;
  dataSourceName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data: logs, isLoading } = trpc.dataSources.healthHistory.useQuery(
    { dataSourceId, hours: 24 },
    { enabled: open }
  );

  const statusColors: Record<string, string> = {
    active: 'var(--risk-low)',
    degraded: 'var(--risk-medium)',
    offline: 'var(--risk-critical)',
  };

  const values = logs?.map(l => l.responseMs) ?? [];
  const maxVal = Math.max(...values, 1);
  const W = 600;
  const H = 80;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * W;
    const y = H - (v / maxVal) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const lastStatus = logs?.[logs.length - 1]?.status ?? 'active';
  const lineColor = statusColors[lastStatus] ?? 'var(--risk-low)';
  const avgMs = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
  const p95 = values.length ? values.slice().sort((a, b) => a - b)[Math.floor(values.length * 0.95)] ?? 0 : 0;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">24H HEALTH HISTORY — {dataSourceName}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin text-muted-foreground" size={24} />
          </div>
        ) : !logs?.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <p className="text-sm">No health data recorded yet.</p>
            <p className="text-xs opacity-60">The scheduler probes every 15 minutes.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border p-3 text-center">
                <div className="text-xs text-muted-foreground font-mono mb-1">AVG RESPONSE</div>
                <div className="text-xl font-bold font-mono">{avgMs}ms</div>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <div className="text-xs text-muted-foreground font-mono mb-1">P95 RESPONSE</div>
                <div className="text-xl font-bold font-mono">{p95}ms</div>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <div className="text-xs text-muted-foreground font-mono mb-1">DATA POINTS</div>
                <div className="text-xl font-bold font-mono">{logs.length}</div>
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground font-mono mb-2">RESPONSE TIME (ms)</div>
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 80 }}>
                {/* Grid lines */}
                {[0.25, 0.5, 0.75].map(f => (
                  <line key={f} x1="0" y1={H * f} x2={W} y2={H * f}
                    stroke="currentColor" strokeOpacity="0.1" strokeWidth="1" />
                ))}
                <polyline points={pts} fill="none" stroke={lineColor}
                  strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
              <div className="flex justify-between text-[9px] text-muted-foreground font-mono mt-1">
                <span>{new Date(logs[0].checkedAt).toLocaleString()}</span>
                <span>{new Date(logs[logs.length - 1].checkedAt).toLocaleString()}</span>
              </div>
            </div>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Time</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Response (ms)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {logs.slice(-20).reverse().map((l, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      <td className="px-3 py-1.5 font-mono text-muted-foreground">
                        {new Date(l.checkedAt).toLocaleTimeString()}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={`inline-block w-2 h-2 rounded-full mr-1.5`}
                          style={{ backgroundColor: statusColors[l.status] ?? 'var(--risk-low)' }} />
                        {l.status}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">{l.responseMs}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────────────────────

export default function DataSourcesPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [statusFilter, setStatusFilter] = useState('all');
  const [testing, setTesting] = useState<number | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [editSource, setEditSource] = useState<DataSourceRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [expandedCardId, setExpandedCardId] = useState<number | null>(null);
  const [healthHistorySource, setHealthHistorySource] = useState<{ id: number; name: string } | null>(null);

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(s => s.id)));
    }
  };

  const handleBulkToggle = async (enable: boolean) => {
    setBulkLoading(true);
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(ids.map(id => updateMutation.mutateAsync({ id, enabled: enable })));
      toast.success(`${ids.length} source${ids.length > 1 ? 's' : ''} ${enable ? 'enabled' : 'disabled'}`);
      setSelectedIds(new Set());
      utils.dataSources.list.invalidate();
    } catch (e: any) {
      toast.error(`Bulk action failed: ${e.message}`);
    } finally {
      setBulkLoading(false);
    }
  };

  const utils = trpc.useUtils();

  // Seed the data sources on first load
  const seedMutation = trpc.dataSources.seed.useMutation({
    onSuccess: (data) => {
      if (data.seeded > 0) {
        toast.success(`Seeded ${data.seeded} data sources`);
        utils.dataSources.list.invalidate();
      }
      setSeeded(true);
    },
    onError: () => setSeeded(true), // already seeded or error — proceed
  });

  useEffect(() => {
    if (!seeded) seedMutation.mutate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch data sources
  const { data: sources = [], isLoading, refetch } = trpc.dataSources.list.useQuery(
    category !== 'All' ? { category } : undefined,
    { enabled: seeded }
  );

  const updateMutation = trpc.dataSources.update.useMutation({
    onSuccess: () => utils.dataSources.list.invalidate(),
  });

  // Client-side filter for search and status
  const filtered = sources.filter(src => {
    const matchSearch = !search || src.name.toLowerCase().includes(search.toLowerCase()) || src.code.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || src.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const liveCount = sources.filter(s => s.status === 'active').length;
  const totalRequests = sources.reduce((sum, s) => sum + (s.requestsTotal ?? 0), 0);
  const avgUptime = sources.length > 0
    ? (sources.filter(s => s.status === 'active').reduce((sum, s) => sum + (s.uptimePct ?? 0), 0) / Math.max(liveCount, 1)).toFixed(1)
    : '0.0';

  const testConnectionMutation = trpc.dataSources.testConnection.useMutation({
    onSuccess: (data) => {
      if (data.ok) {
        toast.success(`Connection test passed — ${data.latencyMs}ms`);
      } else {
        toast.warning(`Data source degraded — responded in ${data.latencyMs}ms`);
      }
      utils.dataSources.list.invalidate();
      setTesting(null);
    },
    onError: (e) => {
      toast.error(`Connection test failed: ${e.message}`);
      setTesting(null);
    },
  });

  const handleTest = (id: number) => {
    setTesting(id);
    testConnectionMutation.mutate({ id });
  };

  const handleToggle = (id: number, enabled: boolean) => {
    updateMutation.mutate({ id, enabled: !enabled });
    toast.success(enabled ? 'Data source disabled' : 'Data source enabled');
  };

  return (
    <BISLayout
      title="Data Sources"
      subtitle="Registry of all integrated government and international data sources"
      actions={
        <div className="flex gap-2">
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs"
            onClick={() => setShowRegister(true)}
          >
            <Plus size={12} className="mr-1.5" />
            REGISTER SOURCE
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-slate-700 text-slate-300 hover:bg-slate-800 font-mono text-xs"
            onClick={() => refetch()}
          >
            <RefreshCw size={12} className="mr-1.5" />
            REFRESH
          </Button>
        </div>
      }
    >
      {/* Register Dialog */}
      <RegisterDataSourceDialog
        open={showRegister}
        onClose={() => setShowRegister(false)}
        onCreated={() => refetch()}
      />

      {/* Edit Dialog */}
      <EditDataSourceDialog
        source={editSource}
        onClose={() => setEditSource(null)}
        onUpdated={() => refetch()}
      />

      {/* Health History Dialog */}
      {healthHistorySource && (
        <HealthHistoryDialog
          dataSourceId={healthHistorySource.id}
          dataSourceName={healthHistorySource.name}
          open={!!healthHistorySource}
          onClose={() => setHealthHistorySource(null)}
        />
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Sources',    value: sources.length,    icon: <Database size={14} />,     color: 'text-blue-400' },
          { label: 'Live',             value: liveCount,          icon: <Wifi size={14} />,         color: 'text-emerald-400' },
          { label: 'Offline/Sandbox',  value: sources.length - liveCount, icon: <WifiOff size={14} />, color: 'text-amber-400' },
          { label: 'Total Queries',    value: totalRequests.toLocaleString(), icon: <Activity size={14} />, color: 'text-violet-400' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-slate-900/60 border border-slate-700/50 rounded-lg p-3">
            <div className={cn('flex items-center gap-1.5 text-xs font-mono mb-1', kpi.color)}>
              {kpi.icon}
              <span>{kpi.label.toUpperCase()}</span>
            </div>
            <div className="text-xl font-bold text-white font-mono">{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search data sources..."
            className="pl-7 h-8 bg-slate-900/60 border-slate-700 text-slate-200 text-xs font-mono"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {['all', 'active', 'maintenance', 'offline', 'degraded'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'px-2.5 py-1 rounded text-xs font-mono border transition-colors',
                statusFilter === s
                  ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                  : 'bg-slate-900/60 border-slate-700 text-slate-400 hover:border-slate-500'
              )}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={cn(
                'px-2.5 py-1 rounded text-xs font-mono border transition-colors',
                category === cat
                  ? 'bg-violet-500/20 border-violet-500/50 text-violet-300'
                  : 'bg-slate-900/60 border-slate-700 text-slate-400 hover:border-slate-500'
              )}
            >
              {cat === 'All' ? 'ALL' : (CATEGORY_LABELS[cat] ?? cat).toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk Action Toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-4 px-3 py-2 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <span className="text-xs font-mono text-blue-300">{selectedIds.size} selected</span>
          <div className="flex gap-2 ml-auto">
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] font-mono border-emerald-600/50 text-emerald-400 hover:bg-emerald-500/10"
              onClick={() => handleBulkToggle(true)}
              disabled={bulkLoading}
            >
              {bulkLoading ? <Loader2 size={10} className="animate-spin mr-1" /> : <ToggleRight size={10} className="mr-1" />}
              ENABLE ALL
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] font-mono border-amber-600/50 text-amber-400 hover:bg-amber-500/10"
              onClick={() => handleBulkToggle(false)}
              disabled={bulkLoading}
            >
              {bulkLoading ? <Loader2 size={10} className="animate-spin mr-1" /> : <ToggleLeft size={10} className="mr-1" />}
              DISABLE ALL
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[10px] font-mono text-slate-400"
              onClick={() => setSelectedIds(new Set())}
            >
              <XIcon size={10} className="mr-1" /> CLEAR
            </Button>
          </div>
        </div>
      )}

      {/* Data Sources Grid */}
      {isLoading || !seeded ? (
        <div className="flex items-center justify-center h-48 text-slate-500 font-mono text-sm">
          <Loader2 size={16} className="animate-spin mr-2" />
          Loading data sources...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-slate-500 font-mono text-sm gap-3">
          <Database size={32} className="opacity-30" />
          <p>No data sources match the current filters.</p>
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs"
            onClick={() => setShowRegister(true)}
          >
            <Plus size={12} className="mr-1.5" />
            REGISTER FIRST SOURCE
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(src => {
            const statusCfg = STATUS_CONFIG[src.status] ?? STATUS_CONFIG.offline;
            const isTesting = testing === src.id;
            const isSelected = selectedIds.has(src.id);
            return (
              <div
                key={src.id}
                className={cn(
                  'bg-slate-900/60 border rounded-lg p-4 transition-all',
                  isSelected ? 'border-blue-500/50 ring-1 ring-blue-500/30' :
                  src.status === 'active' ? 'border-slate-700/50' : 'border-slate-700/30 opacity-75'
                )}
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleSelect(src.id)}
                      className="shrink-0 border-slate-600 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
                    />
                    <div className="text-slate-500">{CATEGORY_ICONS[src.category] ?? <Globe size={12} />}</div>
                    <div className="min-w-0">
                      <div className="text-xs font-mono font-bold text-slate-200 truncate">{src.name}</div>
                      <div className="text-[10px] font-mono text-slate-500">{src.provider ?? src.code.toUpperCase()}</div>
                    </div>
                  </div>
                  <div className={cn('flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono shrink-0', statusCfg.bg, statusCfg.color)}>
                    {statusCfg.icon}
                    <span>{statusCfg.label}</span>
                  </div>
                </div>

                {/* Description */}
                <p className="text-[11px] text-slate-500 font-mono mb-3 line-clamp-2">{src.description}</p>

                {/* Metrics */}
                {src.status === 'active' && (
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <div className="text-center">
                      <div className="text-[10px] text-slate-600 font-mono">LATENCY</div>
                      <div className="text-xs font-mono text-emerald-400">{src.avgResponseMs}ms</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-slate-600 font-mono">UPTIME</div>
                      <div className="text-xs font-mono text-emerald-400">{src.uptimePct?.toFixed(1)}%</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-slate-600 font-mono">QUERIES</div>
                      <div className="text-xs font-mono text-blue-400">{(src.requestsTotal ?? 0).toLocaleString()}</div>
                    </div>
                  </div>
                )}
                {/* Last checked timestamp + sparkline toggle */}
                <div className="flex items-center justify-between mb-2">
                  {(src as any).lastCheckedAt && (
                    <div className="text-[10px] text-slate-600 font-mono">
                      CHECKED {new Date((src as any).lastCheckedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                  <div className="flex gap-2 ml-auto">
                    <button
                      className="text-[10px] font-mono text-slate-500 hover:text-blue-400"
                      onClick={() => setExpandedCardId(expandedCardId === src.id ? null : src.id)}
                    >
                      {expandedCardId === src.id ? '▲ HIDE' : '▼ HISTORY'}
                    </button>
                    <button
                      className="text-[10px] font-mono text-slate-500 hover:text-emerald-400"
                      aria-label="Open full 24h health chart"
                      onClick={() => setHealthHistorySource({ id: src.id, name: src.name })}
                    >
                      ⤢ CHART
                    </button>
                  </div>
                </div>
                {/* Inline health sparkline */}
                {expandedCardId === src.id && (
                  <HealthSparkline dataSourceId={src.id} />
                )}

                {/* Actions */}
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 h-6 text-[10px] font-mono border-slate-700 text-slate-400 hover:bg-slate-800"
                    onClick={() => handleTest(src.id)}
                    disabled={isTesting || src.status !== 'active'}
                  >
                    {isTesting ? <Loader2 size={10} className="animate-spin mr-1" /> : <Wifi size={10} className="mr-1" />}
                    {isTesting ? 'TESTING...' : 'TEST'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] font-mono border-slate-700 text-blue-400 hover:bg-blue-500/10 px-2"
                    onClick={() => setEditSource(src)}
                    title="Edit data source"
                    aria-label={`Edit ${src.name}`}
                  >
                    <Pencil size={10} />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className={cn(
                      'flex-1 h-6 text-[10px] font-mono border-slate-700',
                      src.enabled ? 'text-amber-400 hover:bg-amber-500/10' : 'text-emerald-400 hover:bg-emerald-500/10'
                    )}
                    onClick={() => handleToggle(src.id, src.enabled)}
                  >
                    {src.enabled ? 'DISABLE' : 'ENABLE'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer stats */}
      {!isLoading && filtered.length > 0 && (
        <div className="mt-4 text-[10px] font-mono text-slate-600 text-right">
          Showing {filtered.length} of {sources.length} sources · Avg uptime: {avgUptime}%
        </div>
      )}
    </BISLayout>
  );
}
