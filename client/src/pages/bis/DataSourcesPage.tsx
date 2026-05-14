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
import {
  Database, CheckCircle2, Clock, XCircle, AlertTriangle, Globe, Shield,
  Building2, Search, RefreshCw, Loader2, Wifi, WifiOff, Activity, Plus,
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function DataSourcesPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [statusFilter, setStatusFilter] = useState('all');
  const [testing, setTesting] = useState<number | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [showRegister, setShowRegister] = useState(false);

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
            return (
              <div
                key={src.id}
                className={cn(
                  'bg-slate-900/60 border rounded-lg p-4 transition-all',
                  src.status === 'active' ? 'border-slate-700/50' : 'border-slate-700/30 opacity-75'
                )}
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
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
                  <div className="grid grid-cols-3 gap-2 mb-3">
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
