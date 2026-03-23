// Investigations — Full-text search + advanced filter panel
// Design: Forensic Intelligence theme, semantic CSS variables

import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import NewInvestigationSlideOver from "@/components/NewInvestigationSlideOver";
import { cn } from "@/lib/utils";
import {
  Search, Plus, Filter, ChevronRight, User, Building2,
  Clock, CheckCircle2, AlertTriangle, Loader2, FileText,
  X, SlidersHorizontal, ArrowUpDown, ArrowUp, ArrowDown,
  ChevronDown, ChevronUp
} from "lucide-react";
import {
  mockInvestigations, Investigation, InvestigationStatus,
  InvestigationTier, getStatusBadgeClass, formatDateTime
} from "@/lib/mockData";

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

type SortKey = 'ref' | 'subjectName' | 'riskScore' | 'updatedAt';
type SortDir = 'asc' | 'desc';

const COUNTRIES = Array.from(new Set(mockInvestigations.map(i => i.country))).sort();

// ─── Component ────────────────────────────────────────────────────────────────

export default function Investigations() {
  const [, navigate] = useLocation();
  const [createOpen, setCreateOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Basic filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // Advanced filters
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [riskMin, setRiskMin] = useState<string>("");
  const [riskMax, setRiskMax] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown size={10} className="text-muted-foreground/50 ml-1" />;
    return sortDir === 'asc'
      ? <ArrowUp size={10} className="text-primary ml-1" />
      : <ArrowDown size={10} className="text-primary ml-1" />;
  };

  const activeFilterCount = [
    statusFilter !== 'all', tierFilter !== 'all', typeFilter !== 'all',
    countryFilter !== 'all', riskMin !== '', riskMax !== '',
    dateFrom !== '', dateTo !== '',
  ].filter(Boolean).length;

  const clearAll = () => {
    setSearch('');
    setStatusFilter('all');
    setTierFilter('all');
    setTypeFilter('all');
    setCountryFilter('all');
    setRiskMin('');
    setRiskMax('');
    setDateFrom('');
    setDateTo('');
  };

  const filtered = useMemo(() => {
    let list = mockInvestigations.filter(inv => {
      const q = search.toLowerCase();
      const matchSearch = !q ||
        inv.subjectName.toLowerCase().includes(q) ||
        inv.ref.toLowerCase().includes(q) ||
        inv.country.toLowerCase().includes(q) ||
        (inv.subjectType && inv.subjectType.toLowerCase().includes(q));
      const matchStatus  = statusFilter  === 'all' || inv.status      === statusFilter;
      const matchTier    = tierFilter    === 'all' || inv.tier        === tierFilter;
      const matchType    = typeFilter    === 'all' || inv.subjectType  === typeFilter;
      const matchCountry = countryFilter === 'all' || inv.country     === countryFilter;
      const matchRiskMin = riskMin === '' || inv.riskScore >= Number(riskMin);
      const matchRiskMax = riskMax === '' || inv.riskScore <= Number(riskMax);
      const matchDateFrom = dateFrom === '' || new Date(inv.updatedAt) >= new Date(dateFrom);
      const matchDateTo   = dateTo   === '' || new Date(inv.updatedAt) <= new Date(dateTo + 'T23:59:59');
      return matchSearch && matchStatus && matchTier && matchType &&
             matchCountry && matchRiskMin && matchRiskMax && matchDateFrom && matchDateTo;
    });

    list = [...list].sort((a, b) => {
      let va: string | number = a[sortKey] as string | number;
      let vb: string | number = b[sortKey] as string | number;
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [search, statusFilter, tierFilter, typeFilter, countryFilter, riskMin, riskMax, dateFrom, dateTo, sortKey, sortDir]);

  const riskBar = (score: number) => {
    const color = score >= 80 ? "#f87171" : score >= 60 ? "#fb923c" : score >= 30 ? "#fbbf24" : "#34d399";
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
        </div>
        <span className="text-xs font-mono w-6 text-right" style={{ color }}>{score}</span>
      </div>
    );
  };

  const inputCls = "h-7 text-xs font-mono bg-background border-border";

  return (
    <BISLayout
      title="Investigations"
      subtitle={`${filtered.length} of ${mockInvestigations.length} records`}
      actions={
        <Button size="sm" className="h-7 text-xs gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus size={12} /> New Investigation
        </Button>
      }
    >
      {/* ── Search + filter bar ── */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {/* Full-text search */}
        <div className="relative flex-1 min-w-56">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Search name, reference, country…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>

        {/* Quick filters */}
        <Select value={statusFilter} onValueChange={setStatusFilter}>
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

        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Tier" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            <SelectItem value="basic">Basic</SelectItem>
            <SelectItem value="standard">Standard</SelectItem>
            <SelectItem value="comprehensive">Comprehensive</SelectItem>
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="individual">Individual</SelectItem>
            <SelectItem value="corporate">Corporate</SelectItem>
            <SelectItem value="government">Government</SelectItem>
            <SelectItem value="ngo">NGO</SelectItem>
          </SelectContent>
        </Select>

        {/* Advanced toggle */}
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
        <div className="bis-card p-4 mb-4 animate-fade-up">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Country */}
            <div>
              <label className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Country</label>
              <select
                value={countryFilter}
                onChange={e => setCountryFilter(e.target.value)}
                className="w-full h-7 px-2 rounded-md border border-border bg-background text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="all">All Countries</option>
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Risk score range */}
            <div>
              <label className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Risk Score Range</label>
              <div className="flex items-center gap-1.5">
                <Input
                  className={inputCls}
                  type="number" min="0" max="100" placeholder="Min"
                  value={riskMin} onChange={e => setRiskMin(e.target.value)}
                />
                <span className="text-muted-foreground text-xs">–</span>
                <Input
                  className={inputCls}
                  type="number" min="0" max="100" placeholder="Max"
                  value={riskMax} onChange={e => setRiskMax(e.target.value)}
                />
              </div>
            </div>

            {/* Date from */}
            <div>
              <label className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Updated From</label>
              <Input
                className={inputCls}
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
              />
            </div>

            {/* Date to */}
            <div>
              <label className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Updated To</label>
              <Input
                className={inputCls}
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
              />
            </div>
          </div>

          {/* Active filter chips */}
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border/50">
              {statusFilter !== 'all' && (
                <span className="flex items-center gap-1 text-[10px] font-mono bg-primary/10 text-primary border border-primary/20 rounded px-2 py-0.5">
                  Status: {statusFilter} <button onClick={() => setStatusFilter('all')}><X size={9} /></button>
                </span>
              )}
              {tierFilter !== 'all' && (
                <span className="flex items-center gap-1 text-[10px] font-mono bg-primary/10 text-primary border border-primary/20 rounded px-2 py-0.5">
                  Tier: {tierFilter} <button onClick={() => setTierFilter('all')}><X size={9} /></button>
                </span>
              )}
              {typeFilter !== 'all' && (
                <span className="flex items-center gap-1 text-[10px] font-mono bg-primary/10 text-primary border border-primary/20 rounded px-2 py-0.5">
                  Type: {typeFilter} <button onClick={() => setTypeFilter('all')}><X size={9} /></button>
                </span>
              )}
              {countryFilter !== 'all' && (
                <span className="flex items-center gap-1 text-[10px] font-mono bg-primary/10 text-primary border border-primary/20 rounded px-2 py-0.5">
                  Country: {countryFilter} <button onClick={() => setCountryFilter('all')}><X size={9} /></button>
                </span>
              )}
              {(riskMin !== '' || riskMax !== '') && (
                <span className="flex items-center gap-1 text-[10px] font-mono bg-primary/10 text-primary border border-primary/20 rounded px-2 py-0.5">
                  Risk: {riskMin || '0'}–{riskMax || '100'} <button onClick={() => { setRiskMin(''); setRiskMax(''); }}><X size={9} /></button>
                </span>
              )}
              {(dateFrom !== '' || dateTo !== '') && (
                <span className="flex items-center gap-1 text-[10px] font-mono bg-primary/10 text-primary border border-primary/20 rounded px-2 py-0.5">
                  Date: {dateFrom || '…'} → {dateTo || '…'} <button onClick={() => { setDateFrom(''); setDateTo(''); }}><X size={9} /></button>
                </span>
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
              {filtered.map(inv => (
                <tr
                  key={inv.id}
                  className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => navigate(`/investigations/${inv.id}`)}
                >
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
                      {statusIcon[inv.status]}
                      <span className={`bis-badge ${getStatusBadgeClass(inv.status)}`}>{inv.status}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs capitalize text-muted-foreground">{inv.tier}</span>
                      <span className="text-[10px] font-mono text-muted-foreground/60">{tierPrice[inv.tier]}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 w-32">{riskBar(inv.riskScore)}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-muted-foreground">{formatDateTime(inv.updatedAt)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <ChevronRight size={14} className="text-muted-foreground" />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
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

        {/* Footer count */}
        <div className="px-4 py-2.5 border-t border-border/50 flex items-center justify-between">
          <span className="text-[10px] font-mono text-muted-foreground">
            Showing {filtered.length} of {mockInvestigations.length} investigations
          </span>
          {activeFilterCount > 0 && (
            <span className="text-[10px] font-mono text-primary">
              {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active
            </span>
          )}
        </div>
      </div>

      <NewInvestigationSlideOver
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </BISLayout>
  );
}
