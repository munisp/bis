// FieldAgentsPage — Field agent management and incentive ledger
// Design: Dark forensic intelligence theme, JetBrains Mono typography

import { useState } from 'react';
import BISLayout from '@/components/BISLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Users, MapPin, Star, Shield, CheckCircle2, Clock, AlertTriangle,
  Search, Plus, TrendingUp, Award, Fingerprint, Smartphone
} from 'lucide-react';

interface FieldAgent {
  id: string;
  name: string;
  agentId: string;
  state: string;
  lga: string;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  completedTasks: number;
  pendingTasks: number;
  trustScore: number;
  totalEarnings: number;
  lastActive: string;
  status: 'active' | 'inactive' | 'suspended';
  verificationLevel: number;
}

const MOCK_AGENTS: FieldAgent[] = [
  { id: 'a1', name: 'Adebayo Ogundimu', agentId: 'FA-NG-0142', state: 'Lagos', lga: 'Ikeja', tier: 'gold', completedTasks: 234, pendingTasks: 3, trustScore: 94, totalEarnings: 487500, lastActive: '2026-03-23T10:30:00Z', status: 'active', verificationLevel: 5 },
  { id: 'a2', name: 'Ngozi Okafor', agentId: 'FA-NG-0089', state: 'Anambra', lga: 'Onitsha', tier: 'silver', completedTasks: 112, pendingTasks: 1, trustScore: 87, totalEarnings: 224000, lastActive: '2026-03-23T08:15:00Z', status: 'active', verificationLevel: 4 },
  { id: 'a3', name: 'Musa Aliyu', agentId: 'FA-NG-0203', state: 'Kano', lga: 'Kano Municipal', tier: 'platinum', completedTasks: 389, pendingTasks: 5, trustScore: 98, totalEarnings: 892000, lastActive: '2026-03-23T11:00:00Z', status: 'active', verificationLevel: 5 },
  { id: 'a4', name: 'Chidinma Eze', agentId: 'FA-NG-0067', state: 'Enugu', lga: 'Enugu North', tier: 'bronze', completedTasks: 45, pendingTasks: 0, trustScore: 72, totalEarnings: 67500, lastActive: '2026-03-22T14:00:00Z', status: 'active', verificationLevel: 3 },
  { id: 'a5', name: 'Emeka Nwosu', agentId: 'FA-NG-0178', state: 'Rivers', lga: 'Port Harcourt', tier: 'silver', completedTasks: 98, pendingTasks: 2, trustScore: 81, totalEarnings: 196000, lastActive: '2026-03-21T09:00:00Z', status: 'inactive', verificationLevel: 4 },
  { id: 'a6', name: 'Fatima Bello', agentId: 'FA-NG-0312', state: 'Abuja', lga: 'Garki', tier: 'gold', completedTasks: 187, pendingTasks: 4, trustScore: 91, totalEarnings: 374000, lastActive: '2026-03-23T09:45:00Z', status: 'active', verificationLevel: 5 },
];

const TIER_CONFIG = {
  bronze:   { color: 'text-amber-700', bg: 'bg-amber-700/10 border-amber-700/30', icon: '⬡' },
  silver:   { color: 'text-slate-400', bg: 'bg-slate-400/10 border-slate-400/30', icon: '⬡' },
  gold:     { color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/30', icon: '⬡' },
  platinum: { color: 'text-cyan-400',  bg: 'bg-cyan-400/10 border-cyan-400/30',   icon: '⬡' },
};

export default function FieldAgentsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const filtered = MOCK_AGENTS.filter(a => {
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.agentId.toLowerCase().includes(search.toLowerCase()) ||
      a.state.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || a.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalEarnings = MOCK_AGENTS.reduce((s, a) => s + a.totalEarnings, 0);
  const totalTasks = MOCK_AGENTS.reduce((s, a) => s + a.completedTasks, 0);
  const avgTrust = Math.round(MOCK_AGENTS.reduce((s, a) => s + a.trustScore, 0) / MOCK_AGENTS.length);

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  return (
    <BISLayout
      title="Field Agents"
      subtitle={`${MOCK_AGENTS.filter(a => a.status === 'active').length} active agents across Nigeria`}
      actions={
        <Button size="sm" className="h-7 text-xs gap-1.5 font-mono">
          <Plus size={12} /> Recruit Agent
        </Button>
      }
    >
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total Agents', value: MOCK_AGENTS.length, icon: <Users size={14} />, color: 'text-blue-400' },
          { label: 'Tasks Completed', value: totalTasks.toLocaleString(), icon: <CheckCircle2 size={14} />, color: 'text-emerald-400' },
          { label: 'Avg Trust Score', value: `${avgTrust}%`, icon: <Shield size={14} />, color: 'text-amber-400' },
          { label: 'Total Paid Out', value: `₦${(totalEarnings / 1000000).toFixed(1)}M`, icon: <Award size={14} />, color: 'text-violet-400' },
        ].map(stat => (
          <div key={stat.label} className="bis-card p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{stat.label}</span>
              <span className={cn("opacity-60", stat.color)}>{stat.icon}</span>
            </div>
            <p className={cn("text-2xl font-mono font-bold", stat.color)}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1 max-w-64">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8 h-8 text-sm font-mono" placeholder="Search agents..." value={search}
            onChange={e => setSearch(e.target.value)} />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="h-8 px-3 rounded-md border border-border bg-background text-xs font-mono text-foreground"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>

      {/* Agent table */}
      <div className="bis-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {['Agent', 'Location', 'Tier', 'Tasks', 'Trust Score', 'Earnings', 'Last Active', 'Status'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(agent => {
              const tier = TIER_CONFIG[agent.tier];
              return (
                <tr key={agent.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-mono text-xs font-semibold text-foreground">{agent.name}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">{agent.agentId}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
                      <MapPin size={10} />
                      {agent.lga}, {agent.state}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("text-xs font-mono font-semibold px-2 py-0.5 rounded border capitalize", tier.bg, tier.color)}>
                      {tier.icon} {agent.tier}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs font-mono">
                      <span className="text-emerald-400 font-semibold">{agent.completedTasks}</span>
                      {agent.pendingTasks > 0 && <span className="text-muted-foreground ml-1">+{agent.pendingTasks} pending</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-400" style={{ width: `${agent.trustScore}%` }} />
                      </div>
                      <span className="text-xs font-mono text-emerald-400 font-bold">{agent.trustScore}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-foreground">₦{agent.totalEarnings.toLocaleString()}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-mono text-muted-foreground">{timeAgo(agent.lastActive)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("text-[10px] font-mono rounded px-1.5 py-0.5", {
                      'bg-emerald-500/20 text-emerald-400': agent.status === 'active',
                      'bg-muted text-muted-foreground': agent.status === 'inactive',
                      'bg-red-500/20 text-red-400': agent.status === 'suspended',
                    })}>
                      {agent.status.toUpperCase()}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Anti-fraud info */}
      <div className="bis-card p-4 mt-4 border border-amber-500/20 bg-amber-500/5">
        <p className="text-xs font-mono text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-2">
          <Shield size={12} /> 5-Layer Anti-Fraud Protection
        </p>
        <div className="grid grid-cols-5 gap-3 text-[10px] font-mono text-muted-foreground">
          {[
            { layer: '1', label: 'Cryptographic GPS', desc: 'Signed location proofs' },
            { layer: '2', label: 'Consensus Voting', desc: 'Multi-agent agreement' },
            { layer: '3', label: 'Ray ML Anomaly', desc: 'Pattern detection' },
            { layer: '4', label: 'Photo Metadata', desc: 'EXIF verification' },
            { layer: '5', label: 'Biometric Bind', desc: 'Agent fingerprint' },
          ].map(l => (
            <div key={l.layer} className="text-center">
              <div className="w-8 h-8 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 flex items-center justify-center text-xs font-bold mx-auto mb-1">{l.layer}</div>
              <p className="text-amber-400/80 font-semibold">{l.label}</p>
              <p className="text-muted-foreground/60">{l.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </BISLayout>
  );
}
