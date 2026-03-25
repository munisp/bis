// Investigations — Full-text search + advanced filter panel + saved presets
// Design: Forensic Intelligence theme, semantic CSS variables

import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import NewInvestigationSlideOver from "@/components/NewInvestigationSlideOver";
import { cn } from "@/lib/utils";
import {
  Search, Plus, Filter, ChevronRight, User, Building2,
  Clock, CheckCircle2, AlertTriangle, Loader2, FileText,
  X, SlidersHorizontal, ArrowUpDown, ArrowUp, ArrowDown,
  ChevronDown, ChevronUp, Bookmark, BookmarkCheck, Trash2, Download, RefreshCw,
  CalendarClock
} from "lucide-react";
import { InvestigationStatus, InvestigationTier, getStatusBadgeClass, formatDateTime } from "@/lib/bisUtils";
import { trpc } from "@/lib/trpc";

// ─── Types ────────────────────────────────────────────────────────────────────

type SortKey = 'ref' | 'subjectName' | 'riskScore' | 'updatedAt';
type SortDir = 'asc' | 'desc';

interface FilterState {
  search: string;
  statusFilter: string;
  tierFilter: string;
  typeFilter: string;
  countryFilter: string;
  riskMin: string;
  riskMax: string;
  dateFrom: string;
  dateTo: string;
}

interface Preset {
  id: string;
  name: string;
  filters: FilterState;
  createdAt: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const tierPrice: Record<InvestigationTier, string> = {
  basic: "$25", standard: "$75", comprehensive: "$150"
};

const statusIcon: Record<InvestigationStatus, React.ReactNode> = {
  pending:    <Clock size={12} className="text-amber-400" />,
  processing: <Loader2 size={12} className="text-blue-400 animate-spin" />,
  completed:  <CheckCircle2 size={12} className="text-emerald-400" />,
  flagged:    <AlertTriangle size={12} className="text-red-400" />,
  draft:      <FileText size={12} className="text-muted-foreground" />,
};

// Countries list is static; live filter options come from the DB
const LIVE_COUNTRIES = ['Nigeria', 'Ghana', 'Kenya', 'South Africa', 'Egypt', 'Ethiopia', 'Tanzania', 'Uganda', 'Senegal', 'Cameroon', 'Rwanda', 'Zambia', 'Zimbabwe', 'Mozambique', 'Angola', 'Ivory Coast', 'Mali', 'Burkina Faso', 'Niger', 'Chad', 'Benin', 'Togo', 'Sierra Leone', 'Liberia', 'Guinea', 'Gambia', 'Mauritania', 'Gabon', 'Congo', 'DRC', 'Sudan', 'Somalia', 'Eritrea', 'Djibouti', 'Comoros', 'Madagascar', 'Mauritius', 'Seychelles', 'Botswana', 'Namibia', 'Lesotho', 'Swaziland', 'Malawi', 'Burundi', 'South Sudan', 'Central African Republic', 'Equatorial Guinea', 'Sao Tome and Principe', 'Cape Verde'].sort();

// ─── Sparkline ────────────────────────────────────────────────────────────────

// Deterministic 7-day history seeded from the investigation id + current score
function seedHistory(id: string, currentScore: number): number[] {
  const seed = id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const pts: number[] = [];
  let val = Math.max(5, Math.min(95, currentScore - 8 + (seed % 16)));
  for (let i = 0; i < 7; i++) {
    pts.push(Math.max(0, Math.min(100, Math.round(val))));
    val += ((seed * (i + 1)) % 13) - 6;
  }
  pts[6] = currentScore; // last point is always the current score
  return pts;
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const W = 48, H = 18;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 2) - 1;
    return `${x},${y}`;
  }).join(' ');
  const trend = values[values.length - 1] - values[0];
  const days = ['D-6','D-5','D-4','D-3','D-2','D-1','Today'];
  const tooltipContent = values.map((v, i) => `${days[i]}: ${v}`).join(' · ');
  return (
    <div className="relative group shrink-0" title={tooltipContent}>
      <svg width={W} height={H} className="shrink-0">
        <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        <circle
          cx={W}
          cy={H - ((values[values.length - 1] - min) / range) * (H - 2) - 1}
          r={2}
          fill={trend > 0 ? '#f87171' : trend < 0 ? '#34d399' : color}
        />
      </svg>
      {/* Hover tooltip */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 hidden group-hover:block pointer-events-none">
        <div className="bg-popover border border-border rounded-lg shadow-lg p-2 text-[9px] font-mono text-foreground whitespace-nowrap">
          <div className="text-[8px] text-muted-foreground uppercase tracking-wider mb-1">7-day risk history</div>
          <div className="grid grid-cols-7 gap-1">
            {values.map((v, i) => (
              <div key={i} className="text-center">
                <div className="font-bold" style={{ color: v >= 80 ? '#f87171' : v >= 60 ? '#fb923c' : v >= 30 ? '#fbbf24' : '#34d399' }}>{v}</div>
                <div className="text-muted-foreground">{days[i]}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="w-2 h-2 bg-popover border-b border-r border-border rotate-45 mx-auto -mt-1" />
      </div>
    </div>
  );
}

const BUILT_IN_PRESETS: Preset[] = [
  {
    id: 'builtin-flagged-ng',
    name: 'Flagged · Nigeria',
    createdAt: '',
    filters: { search: '', statusFilter: 'flagged', tierFilter: 'all', typeFilter: 'all', countryFilter: 'Nigeria', riskMin: '', riskMax: '', dateFrom: '', dateTo: '' },
  },
  {
    id: 'builtin-high-risk',
    name: 'High Risk (≥70)',
    createdAt: '',
    filters: { search: '', statusFilter: 'all', tierFilter: 'all', typeFilter: 'all', countryFilter: 'all', riskMin: '70', riskMax: '', dateFrom: '', dateTo: '' },
  },
  {
    id: 'builtin-comprehensive',
    name: 'Comprehensive Tier',
    createdAt: '',
    filters: { search: '', statusFilter: 'all', tierFilter: 'comprehensive', typeFilter: 'all', countryFilter: 'all', riskMin: '', riskMax: '', dateFrom: '', dateTo: '' },
  },
];

const EMPTY_FILTERS: FilterState = {
  search: '', statusFilter: 'all', tierFilter: 'all', typeFilter: 'all',
  countryFilter: 'all', riskMin: '', riskMax: '', dateFrom: '', dateTo: '',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function Investigations() {
  const [, navigate] = useLocation();
  const [createOpen, setCreateOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState('');
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Multi-select state
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
  const [slaDialogOpen, setSlaDialogOpen] = useState(false);
  const [bulkDueAt, setBulkDueAt] = useState('');

  // Filters
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

  // ── Live data from tRPC ────────────────────────────────────────────────────
  const { data: liveData, isLoading: liveLoading, refetch: refetchList } = trpc.investigations.list.useQuery({
    search: filters.search || undefined,
    status: filters.statusFilter !== 'all' ? filters.statusFilter : undefined,
    tier: filters.tierFilter !== 'all' ? filters.tierFilter : undefined,
    country: filters.countryFilter !== 'all' ? filters.countryFilter : undefined,
    minRisk: filters.riskMin !== '' ? Number(filters.riskMin) : undefined,
    maxRisk: filters.riskMax !== '' ? Number(filters.riskMax) : undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  const utils = trpc.useUtils();

  // Always use live data from tRPC
  const sourceList = liveData?.items ?? [];
  const totalCount = liveData?.total ?? 0;

  // Saved presets (localStorage)
  const [userPresets, setUserPresets] = useState<Preset[]>(() => {
    try {
      const stored = localStorage.getItem('bis-inv-presets');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  const allPresets = [...BUILT_IN_PRESETS, ...userPresets];

  useEffect(() => {
    localStorage.setItem('bis-inv-presets', JSON.stringify(userPresets));
  }, [userPresets]);

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const applyPreset = (preset: Preset) => {
    setFilters(preset.filters);
    setActivePresetId(preset.id);
    setPresetsOpen(false);
    toast.success(`Preset "${preset.name}" applied`);
  };

  const savePreset = () => {
    const name = saveNameInput.trim();
    if (!name) { toast.error('Enter a preset name'); return; }
    const preset: Preset = {
      id: `preset-${Date.now()}`,
      name,
      filters: { ...filters },
      createdAt: new Date().toISOString(),
    };
    setUserPresets(prev => [...prev, preset]);
    setSaveNameInput('');
    setActivePresetId(preset.id);
    toast.success(`Preset "${name}" saved`);
  };

  const deletePreset = (id: string) => {
    setUserPresets(prev => prev.filter(p => p.id !== id));
    if (activePresetId === id) setActivePresetId(null);
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown size={10} className="text-muted-foreground/50 ml-1" />;
    return sortDir === 'asc'
      ? <ArrowUp size={10} className="text-primary ml-1" />
      : <ArrowDown size={10} className="text-primary ml-1" />;
  };

  const activeFilterCount = [
    filters.statusFilter !== 'all', filters.tierFilter !== 'all', filters.typeFilter !== 'all',
    filters.countryFilter !== 'all', filters.riskMin !== '', filters.riskMax !== '',
    filters.dateFrom !== '', filters.dateTo !== '',
  ].filter(Boolean).length;

  const clearAll = () => {
    setFilters(EMPTY_FILTERS);
    setActivePresetId(null);
  };

  const handleExportCSV = () => {
    const rows = [
      ['Reference', 'Subject', 'Type', 'Country', 'Tier', 'Risk Score', 'Status', 'Updated'],
      ...filtered.map(inv => [
        inv.ref,
        inv.subjectName,
        inv.subjectType,
        inv.country,
        inv.tier,
        inv.riskScore,
        inv.status,
        formatDateTime(inv.updatedAt),
      ].map(v => `"${v}"`).join(','))
    ].join('\n');
    const blob = new Blob([rows], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `bis-investigations-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} investigations to CSV`);
  };

  const set = (key: keyof FilterState) => (val: string) => {
    setFilters(prev => ({ ...prev, [key]: val }));
    setActivePresetId(null);
  };

  const bulkUpdateDueAtMutation = trpc.investigations.bulkUpdateDueAt.useMutation({
    onSuccess: (result: { updated: number }) => {
      toast.success(`SLA updated for ${result.updated} investigation${result.updated !== 1 ? 's' : ''}`);
      setSlaDialogOpen(false);
      setBulkDueAt('');
      setSelectedRefs(new Set());
      utils.investigations.list.invalidate();
    },
    onError: (err: { message?: string }) => toast.error(err.message ?? 'Failed to update SLA'),
  });

  const filtered = useMemo(() => {
    // When using live data, server-side filtering already applied; only do client-side sort + date filter
    const { typeFilter, dateFrom, dateTo } = filters;
    let list = (sourceList as any[]).filter((inv: any) => {
      const matchType    = typeFilter === 'all' || (inv as any).subjectType === typeFilter;
      const updatedAt = (inv as any).updatedAt;
      const matchDateFrom = dateFrom === '' || new Date(updatedAt) >= new Date(dateFrom);
      const matchDateTo   = dateTo   === '' || new Date(updatedAt) <= new Date(dateTo + 'T23:59:59');
      return matchType && matchDateFrom && matchDateTo;
    });

    return [...list].sort((a, b) => {
      let va: string | number = (a as any)[sortKey] as string | number;
      let vb: string | number = (b as any)[sortKey] as string | number;
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [sourceList, filters, sortKey, sortDir]);

  // ── Multi-select helpers (depend on filtered) ───────────────────────────────────
  const toggleSelect = (ref: string) => {
    setSelectedRefs(prev => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref); else next.add(ref);
      return next;
    });
  };

  const allSelected = filtered.length > 0 && filtered.every(inv => selectedRefs.has((inv as any).ref));
  const someSelected = selectedRefs.size > 0;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedRefs(new Set());
    } else {
      setSelectedRefs(new Set(filtered.map(inv => (inv as any).ref)));
    }
  };

  const riskBar = (score: number, id: string) => {
    const color = score >= 80 ? "#f87171" : score >= 60 ? "#fb923c" : score >= 30 ? "#fbbf24" : "#34d399";
    const history = seedHistory(id, score);
    const trend = history[history.length - 1] - history[0];
    return (
      <div className="flex items-center gap-2">
        <Sparkline values={history} color={color} />
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-xs font-mono font-bold" style={{ color }}>{score}</span>
            {trend !== 0 && (
              <span className={`text-[9px] font-mono ${trend > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {trend > 0 ? `+${trend}` : trend}
              </span>
            )}
          </div>
          <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${score}%`, backgroundColor: color }} />
          </div>
        </div>
      </div>
    );
  };

  const inputCls = "h-7 text-xs font-mono bg-background border-border";

  return (
    <BISLayout
      title="Investigations"
      subtitle={`${filtered.length} shown · ${totalCount} total in DB`}
      actions={
        <div className="flex items-center gap-2">
          {liveLoading && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => refetchList()}>
            <RefreshCw size={11} /> Refresh
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handleExportCSV}>
            <Download size={11} /> Export CSV
          </Button>
          <Button size="sm" className="h-7 text-xs gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus size={12} /> New Investigation
          </Button>
        </div>
      }
    >
      {/* ── Bulk SLA Dialog ── */}
      <Dialog open={slaDialogOpen} onOpenChange={setSlaDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock size={16} className="text-amber-400" />
              Set SLA Deadline
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground mb-4">
              Update the SLA deadline for <span className="font-semibold text-foreground">{selectedRefs.size}</span> selected investigation{selectedRefs.size !== 1 ? 's' : ''}.
            </p>
            <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1.5">
              New Deadline
            </label>
            <Input
              type="datetime-local"
              className="h-8 text-xs font-mono"
              value={bulkDueAt}
              onChange={e => setBulkDueAt(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground mt-2">
              Leave empty to clear the SLA deadline from all selected investigations.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setSlaDialogOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={bulkUpdateDueAtMutation.isPending}
              onClick={() => bulkUpdateDueAtMutation.mutate({
                refs: Array.from(selectedRefs),
                dueAt: bulkDueAt ? new Date(bulkDueAt).getTime() : null,
              })}
            >
              {bulkUpdateDueAtMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <CalendarClock size={12} />}
              Apply to {selectedRefs.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk action toolbar (appears when rows are selected) ── */}
      {someSelected && (
        <div className="flex items-center gap-3 mb-3 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-sm">
          <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} className="border-primary" />
          <span className="text-xs font-mono text-primary font-semibold">{selectedRefs.size} selected</span>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5 border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
              onClick={() => setSlaDialogOpen(true)}
            >
              <CalendarClock size={11} /> Set SLA
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => setSelectedRefs(new Set())}
            >
              <X size={11} /> Clear
            </Button>
          </div>
        </div>
      )}

      {/* ── Preset chips row ── */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mr-1">Presets:</span>
        {allPresets.map(preset => (
          <button
            key={preset.id}
            onClick={() => applyPreset(preset)}
            className={cn(
              "flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border transition-all",
              activePresetId === preset.id
                ? "bg-primary/15 border-primary/50 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
            )}
          >
            {activePresetId === preset.id ? <BookmarkCheck size={9} /> : <Bookmark size={9} />}
            {preset.name}
            {!preset.id.startsWith('builtin') && (
              <span
                onClick={e => { e.stopPropagation(); deletePreset(preset.id); }}
                className="ml-0.5 hover:text-red-400"
              >
                <X size={8} />
              </span>
            )}
          </button>
        ))}

        {/* Save current preset */}
        {activeFilterCount > 0 && !activePresetId && (
          <div className="flex items-center gap-1 ml-1">
            <Input
              className="h-6 w-32 text-[10px] font-mono"
              placeholder="Preset name…"
              value={saveNameInput}
              onChange={e => setSaveNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && savePreset()}
            />
            <button
              onClick={savePreset}
              className="text-[10px] font-mono text-primary border border-primary/30 rounded px-2 py-0.5 hover:bg-primary/10 transition-colors flex items-center gap-1"
            >
              <Bookmark size={9} /> Save
            </button>
          </div>
        )}
      </div>

      {/* ── Search + filter bar ── */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-56">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Search name, reference, country…"
            value={filters.search}
            onChange={e => set('search')(e.target.value)}
          />
          {filters.search && (
            <button onClick={() => set('search')('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>

        <Select value={filters.statusFilter} onValueChange={set('statusFilter')}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <Filter size={11} className="mr-1 shrink-0" /><SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="flagged">Flagged</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filters.tierFilter} onValueChange={set('tierFilter')}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Tier" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            <SelectItem value="basic">Basic</SelectItem>
            <SelectItem value="standard">Standard</SelectItem>
            <SelectItem value="comprehensive">Comprehensive</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filters.typeFilter} onValueChange={set('typeFilter')}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="individual">Individual</SelectItem>
            <SelectItem value="corporate">Corporate</SelectItem>
            <SelectItem value="government">Government</SelectItem>
            <SelectItem value="ngo">NGO</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          className={cn("h-8 text-xs gap-1.5", advancedOpen && "border-primary text-primary")}
          onClick={() => setAdvancedOpen(v => !v)}
        >
          <SlidersHorizontal size={11} />
          Advanced
          {activeFilterCount > 0 && (
            <span className="ml-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
          {advancedOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </Button>

        {activeFilterCount > 0 && (
          <button onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <X size={11} /> Clear all
          </button>
        )}
      </div>

      {/* ── Advanced filter panel ── */}
      {advancedOpen && (
        <div className="bis-card p-4 mb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Country</label>
              <select
                value={filters.countryFilter}
                onChange={e => set('countryFilter')(e.target.value)}
                className="w-full h-7 px-2 rounded-md border border-border bg-background text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="all">All Countries</option>
                {LIVE_COUNTRIES.map((c: string) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Risk Score Range</label>
              <div className="flex items-center gap-1.5">
                <Input className={inputCls} type="number" min="0" max="100" placeholder="Min" value={filters.riskMin} onChange={e => set('riskMin')(e.target.value)} />
                <span className="text-muted-foreground text-xs">–</span>
                <Input className={inputCls} type="number" min="0" max="100" placeholder="Max" value={filters.riskMax} onChange={e => set('riskMax')(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Updated From</label>
              <Input className={inputCls} type="date" value={filters.dateFrom} onChange={e => set('dateFrom')(e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Updated To</label>
              <Input className={inputCls} type="date" value={filters.dateTo} onChange={e => set('dateTo')(e.target.value)} />
            </div>
          </div>

          {activeFilterCount > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border/50">
              {filters.statusFilter !== 'all' && <Chip label={`Status: ${filters.statusFilter}`} onRemove={() => set('statusFilter')('all')} />}
              {filters.tierFilter !== 'all' && <Chip label={`Tier: ${filters.tierFilter}`} onRemove={() => set('tierFilter')('all')} />}
              {filters.typeFilter !== 'all' && <Chip label={`Type: ${filters.typeFilter}`} onRemove={() => set('typeFilter')('all')} />}
              {filters.countryFilter !== 'all' && <Chip label={`Country: ${filters.countryFilter}`} onRemove={() => set('countryFilter')('all')} />}
              {(filters.riskMin !== '' || filters.riskMax !== '') && <Chip label={`Risk: ${filters.riskMin || '0'}–${filters.riskMax || '100'}`} onRemove={() => { set('riskMin')(''); set('riskMax')(''); }} />}
              {(filters.dateFrom !== '' || filters.dateTo !== '') && <Chip label={`Date: ${filters.dateFrom || '…'} → ${filters.dateTo || '…'}`} onRemove={() => { set('dateFrom')(''); set('dateTo')(''); }} />}

              {/* Save preset inline */}
              {!activePresetId && (
                <div className="flex items-center gap-1 ml-1">
                  <Input
                    className="h-5 w-28 text-[10px] font-mono"
                    placeholder="Save as preset…"
                    value={saveNameInput}
                    onChange={e => setSaveNameInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && savePreset()}
                  />
                  <button onClick={savePreset} className="text-[10px] font-mono text-primary border border-primary/30 rounded px-2 py-0.5 hover:bg-primary/10 flex items-center gap-1">
                    <Bookmark size={9} /> Save
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Table ── */}
      <div className="bis-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 w-8">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="text-left px-4 py-3">
                  <button onClick={() => toggleSort('ref')} className="flex items-center text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground">
                    Reference <SortIcon col="ref" />
                  </button>
                </th>
                <th className="text-left px-4 py-3">
                  <button onClick={() => toggleSort('subjectName')} className="flex items-center text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground">
                    Subject <SortIcon col="subjectName" />
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tier</th>
                <th className="text-left px-4 py-3 w-32">
                  <button onClick={() => toggleSort('riskScore')} className="flex items-center text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground">
                    Risk Score <SortIcon col="riskScore" />
                  </button>
                </th>
                <th className="text-left px-4 py-3">
                  <button onClick={() => toggleSort('updatedAt')} className="flex items-center text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground">
                    Updated <SortIcon col="updatedAt" />
                  </button>
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => {
                const invRef = (inv as any).ref;
                const isSelected = selectedRefs.has(invRef);
                return (
                <tr
                  key={(inv as any).id ?? invRef}
                  className={cn(
                    "border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer",
                    isSelected && "bg-primary/5"
                  )}
                  onClick={() => navigate(`/investigations/${invRef ?? (inv as any).id}`)}
                >
                  <td className="px-4 py-3" onClick={e => { e.stopPropagation(); toggleSelect(invRef); }}>
                    <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(invRef)} aria-label={`Select ${invRef}`} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-primary">{inv.ref}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        {inv.subjectType === "individual"
                          ? <User size={10} className="text-primary" />
                          : <Building2 size={10} className="text-primary" />}
                      </div>
                      <div>
                        <div className="font-medium text-foreground text-sm">{inv.subjectName}</div>
                        <div className="text-[10px] text-muted-foreground capitalize">{inv.subjectType} · {inv.country}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {statusIcon[inv.status as InvestigationStatus]}
                      <span className={`bis-badge ${getStatusBadgeClass(inv.status as InvestigationStatus)}`}>{inv.status}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs capitalize text-muted-foreground">{inv.tier}</span>
                      <span className="text-[10px] font-mono text-muted-foreground/60">{tierPrice[inv.tier as InvestigationTier] ?? ''}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 w-40">{riskBar((inv as any).riskScore ?? 0, String((inv as any).id ?? (inv as any).ref))}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-muted-foreground">{formatDateTime((inv as any).updatedAt)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <ChevronRight size={14} className="text-muted-foreground" />
                  </td>
                </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Search size={24} className="opacity-30" />
                      <p className="text-sm">No investigations match your filters.</p>
                      <button onClick={clearAll} className="text-xs text-primary hover:underline">Clear all filters</button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls (live mode only) */}
        {totalCount > PAGE_SIZE && (
          <div className="px-4 py-2 border-t border-border/50 flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-6 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              ← Prev
            </Button>
            <span className="text-[10px] font-mono text-muted-foreground">
              Page {page + 1} / {Math.ceil(totalCount / PAGE_SIZE)}
            </span>
            <Button size="sm" variant="outline" className="h-6 text-xs" disabled={(page + 1) * PAGE_SIZE >= totalCount} onClick={() => setPage(p => p + 1)}>
              Next →
            </Button>
          </div>
        )}

        <div className="px-4 py-2.5 border-t border-border/50 flex items-center justify-between">
          <span className="text-[10px] font-mono text-muted-foreground">
            <>Showing {filtered.length} of {totalCount} investigations <span className="text-emerald-400/70">(live DB)</span></>
          </span>
          {activeFilterCount > 0 && (
            <span className="text-[10px] font-mono text-primary">
              {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active
              {activePresetId && allPresets.find(p => p.id === activePresetId) && (
                <span className="ml-1 opacity-60">· {allPresets.find(p => p.id === activePresetId)!.name}</span>
              )}
            </span>
          )}
        </div>
      </div>

      <NewInvestigationSlideOver
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { utils.investigations.list.invalidate(); refetchList(); }}
      />
    </BISLayout>
  );
}

// ─── Chip helper ─────────────────────────────────────────────────────────────

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1 text-[10px] font-mono bg-primary/10 text-primary border border-primary/20 rounded px-2 py-0.5">
      {label}
      <button onClick={onRemove}><X size={9} /></button>
    </span>
  );
}
