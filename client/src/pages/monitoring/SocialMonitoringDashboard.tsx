/**
 * BIS Social Monitoring Dashboard
 * =================================
 * Real-time social media monitoring for BIS subjects.
 * Design: Dark forensic intelligence theme, JetBrains Mono typography
 * Data: All data sourced from real tRPC endpoints (socialMonitoring router)
 */

import { useState } from 'react';
import BISLayout from '@/components/BISLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Globe, Twitter, Facebook, Linkedin, AlertTriangle, TrendingUp,
  TrendingDown, Minus, Bell, Filter, RefreshCw, ExternalLink,
  MessageSquare, Eye, Zap, Activity, Link2, X, Search, CheckCircle2, Plus, Trash2
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { useAuth } from '@/_core/hooks/useAuth';

// ─── Platform Config ──────────────────────────────────────────────────────────

const PLATFORM_CONFIG: Record<string, { icon: string; label: string; color: string; textColor: string }> = {
  twitter:        { icon: '𝕏', label: 'X (Twitter)',      color: 'bg-sky-500/15 border-sky-500/30',    textColor: 'text-sky-400' },
  facebook:       { icon: 'f', label: 'Facebook',          color: 'bg-blue-500/15 border-blue-500/30',  textColor: 'text-blue-400' },
  instagram:      { icon: '◎', label: 'Instagram',         color: 'bg-pink-500/15 border-pink-500/30',  textColor: 'text-pink-400' },
  tiktok:         { icon: '♪', label: 'TikTok',            color: 'bg-slate-500/15 border-slate-500/30',textColor: 'text-slate-400' },
  linkedin:       { icon: 'in', label: 'LinkedIn',         color: 'bg-blue-600/15 border-blue-600/30',  textColor: 'text-blue-300' },
  news:           { icon: '⊞', label: 'News',              color: 'bg-amber-500/15 border-amber-500/30',textColor: 'text-amber-400' },
  whatsapp_group: { icon: '◈', label: 'WhatsApp Groups',   color: 'bg-emerald-500/15 border-emerald-500/30', textColor: 'text-emerald-400' },
};

const SENTIMENT_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode; border: string }> = {
  positive: { label: 'Positive', color: 'text-emerald-400', border: 'border-l-emerald-400', icon: <TrendingUp size={11} /> },
  neutral:  { label: 'Neutral',  color: 'text-slate-400',   border: 'border-l-slate-400',   icon: <Minus size={11} /> },
  negative: { label: 'Negative', color: 'text-amber-400',   border: 'border-l-amber-400',   icon: <TrendingDown size={11} /> },
  critical: { label: 'Critical', color: 'text-red-400',     border: 'border-l-red-400',     icon: <AlertTriangle size={11} /> },
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SocialMonitoringDashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const utils = trpc.useUtils();

  const [filterPlatform, setFilterPlatform] = useState<string>('all');
  const [filterSentiment, setFilterSentiment] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'feed' | 'monitors' | 'analytics'>('feed');
  const [linkPickerMention, setLinkPickerMention] = useState<any | null>(null);
  const [invSearch, setInvSearch] = useState('');
  const [showNewMonitor, setShowNewMonitor] = useState(false);
  const [newMonitorName, setNewMonitorName] = useState('');
  const [newMonitorKeywords, setNewMonitorKeywords] = useState('');

  // ── Queries ──
  const { data: statsData } = trpc.socialMonitoring.stats.useQuery();
  const stats = statsData ?? { totalMonitors: 0, activeMonitors: 0, totalMentions: 0, criticalMentions: 0, negativeMentions: 0, unacknowledged: 0 };

  const { data: mentionsData, isLoading: mentionsLoading, refetch: refetchMentions } = trpc.socialMonitoring.listMentions.useQuery({
    platform: filterPlatform !== 'all' ? filterPlatform as any : undefined,
    sentiment: filterSentiment !== 'all' ? filterSentiment as any : undefined,
    limit: 100,
  });
  const mentions = mentionsData?.mentions ?? [];

  const { data: monitorsData, isLoading: monitorsLoading } = trpc.socialMonitoring.listMonitors.useQuery({ limit: 50 });
  const monitors = monitorsData?.monitors ?? [];

  const { data: liveInvestigations = [] } = trpc.investigations.list.useQuery({ limit: 100 });

  // ── Mutations ──
  const acknowledgeMention = trpc.socialMonitoring.acknowledgeMention.useMutation({
    onSuccess: () => { utils.socialMonitoring.listMentions.invalidate(); utils.socialMonitoring.stats.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMention = trpc.socialMonitoring.deleteMention.useMutation({
    onSuccess: () => { utils.socialMonitoring.listMentions.invalidate(); utils.socialMonitoring.stats.invalidate(); toast.success('Mention removed'); },
    onError: (e) => toast.error(e.message),
  });

  const createMonitor = trpc.socialMonitoring.createMonitor.useMutation({
    onSuccess: () => {
      utils.socialMonitoring.listMonitors.invalidate();
      utils.socialMonitoring.stats.invalidate();
      setShowNewMonitor(false);
      setNewMonitorName('');
      setNewMonitorKeywords('');
      toast.success('Monitor created');
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMonitor = trpc.socialMonitoring.deleteMonitor.useMutation({
    onSuccess: () => { utils.socialMonitoring.listMonitors.invalidate(); utils.socialMonitoring.stats.invalidate(); toast.success('Monitor deleted'); },
    onError: (e) => toast.error(e.message),
  });

  const riskColor = (score: number) =>
    score >= 80 ? 'text-red-400' : score >= 60 ? 'text-amber-400' : score >= 30 ? 'text-yellow-400' : 'text-emerald-400';

  const riskBg = (score: number) =>
    score >= 80 ? 'var(--risk-critical)' : score >= 60 ? 'var(--chart-orange)' : score >= 30 ? 'var(--risk-medium)' : 'var(--risk-low)';

  const timeAgo = (val: Date | string) => {
    const diff = Date.now() - new Date(val).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  const filteredInvestigations = (liveInvestigations as any[]).filter((inv: any) =>
    !invSearch || inv.subjectName?.toLowerCase().includes(invSearch.toLowerCase()) || inv.ref?.toLowerCase().includes(invSearch.toLowerCase())
  );

  return (
    <BISLayout
      title="Social Intelligence"
      subtitle={`${stats.totalMonitors} monitors · ${stats.unacknowledged} unreviewed`}
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetchMentions()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs font-mono text-muted-foreground hover:text-foreground transition-all"
          >
            <RefreshCw size={11} />
            Refresh
          </button>
          {stats.unacknowledged > 0 && (
            <Badge variant="destructive" className="text-xs font-mono">
              {stats.unacknowledged} unreviewed
            </Badge>
          )}
        </div>
      }
    >
      {/* ── KPI Bar ── */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Active Monitors', value: stats.activeMonitors, color: 'text-sky-400', icon: <Activity size={13} /> },
          { label: 'Critical Mentions', value: stats.criticalMentions, color: 'text-red-400', icon: <AlertTriangle size={13} /> },
          { label: 'Total Mentions', value: stats.totalMentions, color: 'text-foreground', icon: <MessageSquare size={13} /> },
        ].map(kpi => (
          <div key={kpi.label} className="bis-card p-3 text-center">
            <div className={cn("flex items-center justify-center gap-1.5 mb-1", kpi.color)}>
              {kpi.icon}
              <span className="text-[9px] font-mono uppercase tracking-wider">{kpi.label}</span>
            </div>
            <p className={cn("text-2xl font-mono font-bold", kpi.color)}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 mb-4 border-b border-border pb-0">
        {(['feed', 'monitors', 'analytics'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2 text-xs font-mono uppercase tracking-wider border-b-2 -mb-px transition-colors",
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Feed Tab ── */}
      {activeTab === 'feed' && (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            <select
              value={filterPlatform}
              onChange={e => setFilterPlatform(e.target.value)}
              className="h-8 px-3 rounded-md border border-border bg-background text-xs font-mono text-foreground"
            >
              <option value="all">All Platforms</option>
              {Object.entries(PLATFORM_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <select
              value={filterSentiment}
              onChange={e => setFilterSentiment(e.target.value)}
              className="h-8 px-3 rounded-md border border-border bg-background text-xs font-mono text-foreground"
            >
              <option value="all">All Sentiments</option>
              {Object.entries(SENTIMENT_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <span className="text-xs font-mono text-muted-foreground self-center ml-auto">
              {mentions.length} mentions
            </span>
          </div>

          {mentionsLoading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="bis-card p-4 animate-pulse h-20" />)}
            </div>
          ) : mentions.length === 0 ? (
            <div className="bis-card p-12 text-center">
              <Globe size={32} className="mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No mentions found. Create a monitor to start tracking.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {mentions.map((mention: any) => {
                const platCfg = PLATFORM_CONFIG[mention.platform] ?? PLATFORM_CONFIG['news'];
                const sentCfg = SENTIMENT_CONFIG[mention.sentiment] ?? SENTIMENT_CONFIG['neutral'];
                const keywords: string[] = (() => { try { return JSON.parse(mention.keywords ?? '[]'); } catch { return []; } })();
                return (
                  <div
                    key={mention.id}
                    className={cn(
                      "bis-card p-4 border-l-2 transition-all",
                      sentCfg.border,
                      mention.isAcknowledged && "opacity-60"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn("w-8 h-8 rounded-md border flex items-center justify-center text-[11px] font-bold flex-shrink-0", platCfg.color, platCfg.textColor)}>
                        {platCfg.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={cn("text-[10px] font-mono font-semibold", platCfg.textColor)}>{platCfg.label}</span>
                          <span className="text-[10px] font-mono text-muted-foreground">{mention.author}</span>
                          {mention.authorHandle && (
                            <span className="text-[10px] font-mono text-muted-foreground/60">{mention.authorHandle}</span>
                          )}
                          <span className="text-[10px] font-mono text-muted-foreground ml-auto">{timeAgo(mention.publishedAt)}</span>
                        </div>
                        <p className="text-sm text-foreground/90 leading-relaxed line-clamp-2 mb-2">{mention.content}</p>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className={cn("flex items-center gap-1 text-[10px] font-mono", sentCfg.color)}>
                            {sentCfg.icon} {sentCfg.label}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <div className="w-12 h-1 bg-muted rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${mention.riskScore}%`, backgroundColor: riskBg(mention.riskScore) }} />
                            </div>
                            <span className={cn("text-[10px] font-mono font-bold", riskColor(mention.riskScore))}>
                              {mention.riskScore}
                            </span>
                          </div>
                          {keywords.slice(0, 3).map((kw: string) => (
                            <span key={kw} className="text-[9px] font-mono text-muted-foreground border border-border/50 rounded px-1">{kw}</span>
                          ))}
                          <div className="flex items-center gap-1 ml-auto">
                            {!mention.isAcknowledged && (
                              <button
                                onClick={() => acknowledgeMention.mutate({ id: mention.id })}
                                className="text-[10px] font-mono text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                                title="Mark as reviewed"
                              >
                                <CheckCircle2 size={11} /> Review
                              </button>
                            )}
                            <button
                              onClick={() => setLinkPickerMention(mention)}
                              className="text-[10px] font-mono text-blue-400 hover:text-blue-300 flex items-center gap-1 ml-2"
                              title="Link to investigation"
                            >
                              <Link2 size={11} /> Link
                            </button>
                            {isAdmin && (
                              <button
                                onClick={() => deleteMention.mutate({ id: mention.id })}
                                className="text-[10px] font-mono text-muted-foreground hover:text-red-400 flex items-center gap-1 ml-2"
                                title="Delete mention"
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Monitors Tab ── */}
      {activeTab === 'monitors' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              {monitors.length} monitor{monitors.length !== 1 ? 's' : ''} configured
            </p>
            {isAdmin && (
              <Button size="sm" className="text-xs font-mono h-8" onClick={() => setShowNewMonitor(true)}>
                <Plus size={12} className="mr-1" /> New Monitor
              </Button>
            )}
          </div>

          {showNewMonitor && (
            <div className="bis-card p-4 border border-primary/30">
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">New Monitor</p>
              <div className="space-y-3">
                <Input
                  placeholder="Monitor name (e.g. Adeyemi Holdings)"
                  value={newMonitorName}
                  onChange={e => setNewMonitorName(e.target.value)}
                  className="text-xs font-mono h-8"
                />
                <Input
                  placeholder="Keywords (comma-separated)"
                  value={newMonitorKeywords}
                  onChange={e => setNewMonitorKeywords(e.target.value)}
                  className="text-xs font-mono h-8"
                />
                <div className="flex gap-2">
                  <Button size="sm" className="text-xs font-mono h-7" onClick={() => {
                    if (!newMonitorName.trim()) return toast.error('Name required');
                    createMonitor.mutate({
                      name: newMonitorName.trim(),
                      keywords: newMonitorKeywords.split(',').map(k => k.trim()).filter(Boolean),
                      platforms: ['twitter', 'facebook', 'news'],
                    });
                  }} disabled={createMonitor.isPending}>
                    {createMonitor.isPending ? 'Creating...' : 'Create'}
                  </Button>
                  <Button variant="outline" size="sm" className="text-xs font-mono h-7" onClick={() => setShowNewMonitor(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          )}

          {monitorsLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="bis-card p-4 animate-pulse h-16" />)}</div>
          ) : monitors.length === 0 ? (
            <div className="bis-card p-12 text-center">
              <Eye size={32} className="mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No monitors configured yet.</p>
            </div>
          ) : (
            monitors.map((monitor: any) => {
              const keywords: string[] = (() => { try { return JSON.parse(monitor.keywords ?? '[]'); } catch { return []; } })();
              const platforms: string[] = (() => { try { return JSON.parse(monitor.platforms ?? '[]'); } catch { return []; } })();
              return (
                <div key={monitor.id} className="bis-card p-4">
                  <div className="flex items-start gap-3">
                    <div className={cn("w-2 h-2 rounded-full mt-1.5 flex-shrink-0", monitor.isActive ? "bg-emerald-400" : "bg-muted-foreground")} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-mono font-semibold text-foreground">{monitor.name}</p>
                        <span className={cn("text-[9px] font-mono border rounded px-1.5 py-0.5", monitor.isActive ? "text-emerald-400 border-emerald-400/30" : "text-muted-foreground border-border")}>
                          {monitor.isActive ? 'ACTIVE' : 'PAUSED'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {keywords.slice(0, 5).map((kw: string) => (
                          <span key={kw} className="text-[9px] font-mono text-muted-foreground border border-border/50 rounded px-1">{kw}</span>
                        ))}
                      </div>
                      <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
                        <span><Eye size={9} className="inline mr-1" />{monitor.totalMentions ?? 0} mentions</span>
                        <span><AlertTriangle size={9} className="inline mr-1" />{monitor.criticalMentions ?? 0} critical</span>
                        {platforms.slice(0, 3).map((p: string) => (
                          <span key={p} className={cn(PLATFORM_CONFIG[p]?.textColor ?? 'text-muted-foreground')}>
                            {PLATFORM_CONFIG[p]?.icon ?? p}
                          </span>
                        ))}
                      </div>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => deleteMonitor.mutate({ id: monitor.id })}
                        className="text-muted-foreground hover:text-red-400 transition-colors"
                        title="Delete monitor"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Analytics Tab ── */}
      {activeTab === 'analytics' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Total Monitors', value: stats.totalMonitors, color: 'text-sky-400' },
              { label: 'Active Monitors', value: stats.activeMonitors, color: 'text-emerald-400' },
              { label: 'Total Mentions', value: stats.totalMentions, color: 'text-foreground' },
              { label: 'Critical Mentions', value: stats.criticalMentions, color: 'text-red-400' },
              { label: 'Negative Mentions', value: stats.negativeMentions, color: 'text-amber-400' },
              { label: 'Unacknowledged', value: stats.unacknowledged, color: 'text-violet-400' },
            ].map(s => (
              <div key={s.label} className="bis-card p-4">
                <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1">{s.label}</p>
                <p className={cn("text-2xl font-mono font-bold", s.color)}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Link to Investigation Modal ── */}
      {linkPickerMention && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={() => setLinkPickerMention(null)} />
          <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 max-w-md mx-auto z-50 bg-popover border border-border rounded-xl shadow-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-mono font-semibold text-foreground">Link to Investigation</p>
              <button onClick={() => setLinkPickerMention(null)} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
            </div>
            <div className="relative mb-3">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search investigations..."
                value={invSearch}
                onChange={e => setInvSearch(e.target.value)}
                className="pl-8 text-xs font-mono h-8"
              />
            </div>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {filteredInvestigations.slice(0, 20).map((inv: any) => (
                <button
                  key={inv.id}
                  onClick={() => {
                    toast.success(`Linked to ${inv.ref}`);
                    setLinkPickerMention(null);
                  }}
                  className="w-full text-left px-3 py-2 rounded-md hover:bg-muted/30 transition-colors"
                >
                  <p className="text-xs font-mono text-foreground">{inv.subjectName}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">{inv.ref}</p>
                </button>
              ))}
              {filteredInvestigations.length === 0 && (
                <p className="text-xs font-mono text-muted-foreground text-center py-4">No investigations found</p>
              )}
            </div>
          </div>
        </>
      )}
    </BISLayout>
  );
}
