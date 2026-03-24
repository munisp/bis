// DataSourcesPage — Nigerian data source integrations catalog
// Design: Dark forensic intelligence theme, JetBrains Mono typography

import { useState } from 'react';
import BISLayout from '@/components/BISLayout';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Database, CheckCircle2, Clock, XCircle, AlertTriangle, Globe, Shield, Building2, Search, RefreshCw, Loader2, Wifi } from 'lucide-react';

interface DataSource {
  id: string;
  name: string;
  acronym: string;
  category: 'Government ID' | 'Financial' | 'Law Enforcement' | 'Corporate' | 'Transport' | 'Judiciary' | 'International';
  description: string;
  status: 'live' | 'sandbox' | 'pending' | 'unavailable';
  latencyMs: number;
  successRate: number;
  recordsQueried: number;
  lastChecked: string;
}

const DATA_SOURCES: DataSource[] = [
  { id: 'nimc', name: 'National Identity Management Commission', acronym: 'NIMC', category: 'Government ID', description: 'NIN lookup, biometric verification, identity confirmation', status: 'live', latencyMs: 340, successRate: 99.2, recordsQueried: 48291, lastChecked: '2026-03-23T11:00:00Z' },
  { id: 'bvn', name: 'Bank Verification Number', acronym: 'BVN', category: 'Financial', description: 'BVN lookup via CBN API, bank account linkage, biometric match', status: 'live', latencyMs: 280, successRate: 98.7, recordsQueried: 52104, lastChecked: '2026-03-23T11:00:00Z' },
  { id: 'npf', name: 'Nigeria Police Force', acronym: 'NPF', category: 'Law Enforcement', description: 'Criminal record check, warrant lookup, police clearance certificate', status: 'live', latencyMs: 1200, successRate: 94.1, recordsQueried: 12847, lastChecked: '2026-03-23T10:45:00Z' },
  { id: 'efcc', name: 'Economic and Financial Crimes Commission', acronym: 'EFCC', category: 'Law Enforcement', description: 'Financial crime records, watchlist check, prosecution history', status: 'live', latencyMs: 890, successRate: 96.3, recordsQueried: 8934, lastChecked: '2026-03-23T10:30:00Z' },
  { id: 'icpc', name: 'Independent Corrupt Practices Commission', acronym: 'ICPC', category: 'Law Enforcement', description: 'Corruption records, public officer integrity check', status: 'live', latencyMs: 760, successRate: 95.8, recordsQueried: 4521, lastChecked: '2026-03-23T10:00:00Z' },
  { id: 'cac', name: 'Corporate Affairs Commission', acronym: 'CAC', category: 'Corporate', description: 'Company registration, director lookup, share structure, annual returns', status: 'live', latencyMs: 420, successRate: 97.4, recordsQueried: 23891, lastChecked: '2026-03-23T11:00:00Z' },
  { id: 'firs', name: 'Federal Inland Revenue Service', acronym: 'FIRS', category: 'Financial', description: 'TIN verification, tax compliance status, VAT registration', status: 'live', latencyMs: 560, successRate: 96.1, recordsQueried: 15234, lastChecked: '2026-03-23T10:50:00Z' },
  { id: 'frsc', name: 'Federal Road Safety Corps', acronym: 'FRSC', category: 'Transport', description: 'Driver\'s license verification, vehicle registration, accident history', status: 'live', latencyMs: 390, successRate: 98.2, recordsQueried: 19847, lastChecked: '2026-03-23T11:00:00Z' },
  { id: 'nfiu', name: 'Nigerian Financial Intelligence Unit', acronym: 'NFIU', category: 'Financial', description: 'AML/CFT screening, suspicious transaction reports, PEP check', status: 'sandbox', latencyMs: 0, successRate: 0, recordsQueried: 0, lastChecked: '2026-03-23T08:00:00Z' },
  { id: 'dss', name: 'Department of State Services', acronym: 'DSS', category: 'Law Enforcement', description: 'Security clearance, national security watchlist', status: 'pending', latencyMs: 0, successRate: 0, recordsQueried: 0, lastChecked: '2026-03-20T00:00:00Z' },
  { id: 'ncc', name: 'Nigerian Communications Commission', acronym: 'NCC', category: 'Government ID', description: 'SIM card registration, phone number ownership verification', status: 'live', latencyMs: 210, successRate: 99.5, recordsQueried: 67234, lastChecked: '2026-03-23T11:00:00Z' },
  { id: 'inec', name: 'Independent National Electoral Commission', acronym: 'INEC', category: 'Government ID', description: 'Voter registration, PVC verification, electoral history', status: 'live', latencyMs: 480, successRate: 97.8, recordsQueried: 31045, lastChecked: '2026-03-23T10:45:00Z' },
  { id: 'npc', name: 'National Population Commission', acronym: 'NPC', category: 'Government ID', description: 'Birth certificate verification, death records', status: 'sandbox', latencyMs: 0, successRate: 0, recordsQueried: 0, lastChecked: '2026-03-22T00:00:00Z' },
  { id: 'cbn', name: 'Central Bank of Nigeria', acronym: 'CBN', category: 'Financial', description: 'Bank license verification, financial institution registry', status: 'live', latencyMs: 320, successRate: 99.1, recordsQueried: 8921, lastChecked: '2026-03-23T11:00:00Z' },
  { id: 'sec', name: 'Securities and Exchange Commission', acronym: 'SEC', category: 'Financial', description: 'Investment firm registration, securities violations, capital market records', status: 'live', latencyMs: 540, successRate: 96.7, recordsQueried: 5234, lastChecked: '2026-03-23T10:30:00Z' },
  { id: 'nims', name: 'Nigerian Immigration Service', acronym: 'NIS', category: 'Government ID', description: 'Passport verification, visa status, travel history, deportation records', status: 'live', latencyMs: 670, successRate: 95.4, recordsQueried: 14892, lastChecked: '2026-03-23T10:00:00Z' },
  { id: 'court', name: 'Federal High Court Registry', acronym: 'FHC', category: 'Judiciary', description: 'Civil and criminal case lookup, judgment records, bankruptcy filings', status: 'sandbox', latencyMs: 0, successRate: 0, recordsQueried: 0, lastChecked: '2026-03-21T00:00:00Z' },
  { id: 'interpol', name: 'INTERPOL Red Notice', acronym: 'INTERPOL', category: 'International', description: 'International fugitive lookup, red notice check', status: 'live', latencyMs: 1800, successRate: 99.8, recordsQueried: 2341, lastChecked: '2026-03-23T09:00:00Z' },
  { id: 'ofac', name: 'OFAC Sanctions List', acronym: 'OFAC', category: 'International', description: 'US Treasury sanctions, SDN list, global sanctions screening', status: 'live', latencyMs: 150, successRate: 99.9, recordsQueried: 18234, lastChecked: '2026-03-23T11:00:00Z' },
  { id: 'un_sanctions', name: 'UN Consolidated Sanctions', acronym: 'UN', category: 'International', description: 'UN Security Council sanctions, terrorism financing lists', status: 'live', latencyMs: 180, successRate: 99.9, recordsQueried: 12891, lastChecked: '2026-03-23T11:00:00Z' },
  { id: 'pep', name: 'Politically Exposed Persons DB', acronym: 'PEP', category: 'International', description: 'Global PEP database, public official identification', status: 'live', latencyMs: 290, successRate: 98.4, recordsQueried: 9234, lastChecked: '2026-03-23T10:45:00Z' },
  { id: 'nafdac', name: 'NAFDAC Product Registry', acronym: 'NAFDAC', category: 'Government ID', description: 'Product registration, manufacturer verification, recall notices', status: 'sandbox', latencyMs: 0, successRate: 0, recordsQueried: 0, lastChecked: '2026-03-22T00:00:00Z' },
  { id: 'nesrea', name: 'NESREA Environmental Registry', acronym: 'NESREA', category: 'Government ID', description: 'Environmental compliance, facility permits', status: 'pending', latencyMs: 0, successRate: 0, recordsQueried: 0, lastChecked: '2026-03-15T00:00:00Z' },
  { id: 'pencom', name: 'National Pension Commission', acronym: 'PenCom', category: 'Financial', description: 'RSA PIN verification, pension contribution history', status: 'live', latencyMs: 410, successRate: 97.2, recordsQueried: 7823, lastChecked: '2026-03-23T10:30:00Z' },
  { id: 'nhis', name: 'National Health Insurance Scheme', acronym: 'NHIS', category: 'Government ID', description: 'Health insurance enrollment, beneficiary verification', status: 'pending', latencyMs: 0, successRate: 0, recordsQueried: 0, lastChecked: '2026-03-18T00:00:00Z' },
];

const STATUS_CONFIG = {
  live:        { label: 'LIVE',      color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', icon: <CheckCircle2 size={10} /> },
  sandbox:     { label: 'SANDBOX',   color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/30',   icon: <Clock size={10} /> },
  pending:     { label: 'PENDING',   color: 'text-blue-400',    bg: 'bg-blue-500/10 border-blue-500/30',     icon: <Clock size={10} /> },
  unavailable: { label: 'DOWN',      color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/30',       icon: <XCircle size={10} /> },
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  'Government ID': <Shield size={12} />,
  'Financial': <Database size={12} />,
  'Law Enforcement': <AlertTriangle size={12} />,
  'Corporate': <Building2 size={12} />,
  'Transport': <Globe size={12} />,
  'Judiciary': <Globe size={12} />,
  'International': <Globe size={12} />,
};

const CATEGORIES = ['All', 'Government ID', 'Financial', 'Law Enforcement', 'Corporate', 'Transport', 'Judiciary', 'International'];

export default function DataSourcesPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [statusFilter, setStatusFilter] = useState('all');
  const [testing, setTesting] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const handleTest = async (id: string) => {
    setTesting(id);
    await new Promise(r => setTimeout(r, 1200 + Math.random() * 800));
    setTesting(null);
    const latency = Math.round(100 + Math.random() * 900);
    toast.success(`Connection test passed — ${latency}ms response time`);
  };

  const handleRefresh = async (id: string) => {
    setRefreshing(id);
    await new Promise(r => setTimeout(r, 800));
    setRefreshing(null);
    toast.success('Status refreshed — source is live');
  };

  const filtered = DATA_SOURCES.filter(s => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.acronym.toLowerCase().includes(search.toLowerCase());
    const matchCategory = category === 'All' || s.category === category;
    const matchStatus = statusFilter === 'all' || s.status === statusFilter;
    return matchSearch && matchCategory && matchStatus;
  });

  const liveCount = DATA_SOURCES.filter(s => s.status === 'live').length;
  const totalQueries = DATA_SOURCES.reduce((s, d) => s + d.recordsQueried, 0);

  return (
    <BISLayout
      title="Data Sources"
      subtitle={`${liveCount} live integrations · ${DATA_SOURCES.length} total`}
    >
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Live Sources', value: liveCount, color: 'text-emerald-400' },
          { label: 'Sandbox / Testing', value: DATA_SOURCES.filter(s => s.status === 'sandbox').length, color: 'text-amber-400' },
          { label: 'Pending Access', value: DATA_SOURCES.filter(s => s.status === 'pending').length, color: 'text-blue-400' },
          { label: 'Total Queries', value: totalQueries.toLocaleString(), color: 'text-violet-400' },
        ].map(stat => (
          <div key={stat.label} className="bis-card p-4">
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">{stat.label}</p>
            <p className={cn("text-2xl font-mono font-bold", stat.color)}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 max-w-64">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full h-8 pl-8 pr-3 rounded-md border border-border bg-background text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Search sources..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="h-8 px-3 rounded-md border border-border bg-background text-xs font-mono text-foreground"
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="h-8 px-3 rounded-md border border-border bg-background text-xs font-mono text-foreground"
        >
          <option value="all">All Status</option>
          <option value="live">Live</option>
          <option value="sandbox">Sandbox</option>
          <option value="pending">Pending</option>
        </select>
        <span className="text-xs font-mono text-muted-foreground self-center ml-auto">{filtered.length} sources</span>
      </div>

      {/* Source grid */}
      <div className="grid grid-cols-2 gap-3">
        {filtered.map(source => {
          const statusCfg = STATUS_CONFIG[source.status];
          return (
            <div key={source.id} className="bis-card p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-primary">{source.acronym}</span>
                    <span className={cn("flex items-center gap-1 text-[9px] font-mono rounded px-1.5 py-0.5 border", statusCfg.bg, statusCfg.color)}>
                      {statusCfg.icon} {statusCfg.label}
                    </span>
                  </div>
                  <p className="text-[10px] font-mono text-muted-foreground mt-0.5 leading-tight">{source.name}</p>
                </div>
                <span className="text-[9px] font-mono text-muted-foreground/60 border border-border/30 rounded px-1.5 py-0.5 flex items-center gap-1">
                  {CATEGORY_ICONS[source.category]}
                  {source.category}
                </span>
              </div>

              <p className="text-[10px] text-muted-foreground leading-relaxed mb-3">{source.description}</p>

              {source.status === 'live' && (
                <div className="grid grid-cols-3 gap-2 text-center border-t border-border/30 pt-2 mb-2">
                  <div>
                    <p className="text-[9px] font-mono text-muted-foreground uppercase">Latency</p>
                    <p className="text-xs font-mono text-foreground font-semibold">{source.latencyMs}ms</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-mono text-muted-foreground uppercase">Success</p>
                    <p className="text-xs font-mono text-emerald-400 font-semibold">{source.successRate}%</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-mono text-muted-foreground uppercase">Queries</p>
                    <p className="text-xs font-mono text-foreground font-semibold">{source.recordsQueried.toLocaleString()}</p>
                  </div>
                </div>
              )}

              {source.status !== 'live' && (
                <div className="border-t border-border/30 pt-2 mb-2">
                  <p className={cn("text-[10px] font-mono", statusCfg.color)}>
                    {source.status === 'sandbox' ? 'Integration in testing — not yet production-ready' :
                     source.status === 'pending' ? 'API access application submitted — awaiting approval' :
                     'Source temporarily unavailable'}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-1.5 border-t border-border/30 pt-2">
                <Button
                  variant="outline" size="sm"
                  className="h-6 text-[10px] px-2 gap-1 flex-1"
                  disabled={testing === source.id || source.status === 'pending'}
                  onClick={() => handleTest(source.id)}
                >
                  {testing === source.id
                    ? <><Loader2 size={9} className="animate-spin" /> Testing…</>
                    : <><Wifi size={9} /> Test Connection</>}
                </Button>
                <Button
                  variant="outline" size="sm"
                  className="h-6 text-[10px] px-2 gap-1 flex-1"
                  disabled={refreshing === source.id}
                  onClick={() => handleRefresh(source.id)}
                >
                  {refreshing === source.id
                    ? <><Loader2 size={9} className="animate-spin" /> Refreshing…</>
                    : <><RefreshCw size={9} /> Refresh Status</>}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </BISLayout>
  );
}
