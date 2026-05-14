/**
 * BIS Messaging Channels Management Page
 * ========================================
 * Configure and manage WhatsApp, Telegram, USSD, and SMS channels.
 * Design: Dark forensic intelligence theme, JetBrains Mono typography
 * Live feed: new incoming reports injected every 12 seconds via setInterval
 */

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { toast } from 'sonner';
import BISLayout from '@/components/BISLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  MessageSquare, Radio, Bell, CheckCircle2, Clock, AlertTriangle,
  XCircle, Loader2, Phone, Hash, Wifi, WifiOff, Users, FileText,
  ChevronDown, ChevronRight, X, Paperclip, Globe
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type Channel = 'whatsapp' | 'telegram' | 'ussd' | 'sms';
type ReportStatus = 'new' | 'processing' | 'verified' | 'dismissed';

interface IncomingReport {
  id: string;
  channel: Channel;
  sender: string;
  content: string;
  receivedAt: string;
  status: ReportStatus;
  riskScore: number;
  language: string;
  attachments: number;
  linkedSubject?: string;
  isNew?: boolean;
}

interface ChannelStats {
  channel: Channel;
  totalReports: number;
  todayReports: number;
  verifiedReports: number;
  activeUsers: number;
  isOnline: boolean;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const CHANNEL_CONFIG: Record<Channel, {
  label: string; shortCode: string; color: string; textColor: string;
  border: string; icon: React.ReactNode; description: string;
}> = {
  whatsapp: {
    label: 'WhatsApp Business', shortCode: 'WA',
    color: 'bg-emerald-500/15', textColor: 'text-emerald-400', border: 'border-emerald-500/30',
    icon: <MessageSquare size={14} />,
    description: 'Receive reports via WhatsApp. Supports text, images, voice notes, and documents.',
  },
  telegram: {
    label: 'Telegram Bot', shortCode: 'TG',
    color: 'bg-sky-500/15', textColor: 'text-sky-400', border: 'border-sky-500/30',
    icon: <Globe size={14} />,
    description: 'Anonymous reporting via Telegram bot. Supports media and document uploads.',
  },
  ussd: {
    label: 'USSD Gateway', shortCode: 'US',
    color: 'bg-violet-500/15', textColor: 'text-violet-400', border: 'border-violet-500/30',
    icon: <Hash size={14} />,
    description: 'Works on any phone without internet. Dial *347*BIS# to report.',
  },
  sms: {
    label: 'SMS Gateway', shortCode: 'SM',
    color: 'bg-amber-500/15', textColor: 'text-amber-400', border: 'border-amber-500/30',
    icon: <Phone size={14} />,
    description: 'Send reports via SMS to short code 34729. Works on MTN, Airtel, Glo.',
  },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  new:        { label: 'New',        color: 'text-blue-400',    icon: <Bell size={10} /> },
  processing: { label: 'Processing', color: 'text-amber-400',   icon: <Loader2 size={10} className="animate-spin" /> },
  verified:   { label: 'Verified',   color: 'text-emerald-400', icon: <CheckCircle2 size={10} /> },
  dismissed:  { label: 'Dismissed',  color: 'text-muted-foreground', icon: <XCircle size={10} /> },
  escalated:  { label: 'Escalated',  color: 'text-red-400',     icon: <AlertTriangle size={10} /> },
};

// ─── tRPC-backed implementation ──────────────────────────────────────────────

// ─── Main Component ───────────────────────────────────────────────────────────

function MessagingChannelsPageInner() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const utils = trpc.useUtils();

  const [activeTab, setActiveTab] = useState<'overview' | 'reports' | 'config' | 'ussd_flow'>('overview');
  const [selectedReport, setSelectedReport] = useState<any | null>(null);
  const [filterChannel, setFilterChannel] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [editingChannel, setEditingChannel] = useState<any | null>(null);
  const [newChannel, setNewChannel] = useState({ channelType: 'whatsapp' as const, name: '', identifier: '', webhookUrl: '', apiKey: '' });

  // ── Queries ──
  const { data: channelsData, isLoading: channelsLoading } = trpc.messaging.listChannels.useQuery();
  const channels = channelsData ?? [];

  const { data: reportsData, isLoading: reportsLoading } = trpc.messaging.listReports.useQuery({
    channelId: filterChannel !== 'all' ? Number(filterChannel) : undefined,
    status: filterStatus !== 'all' ? (filterStatus as any) : undefined,
    limit: 100,
  });
  const reports = reportsData?.reports ?? [];

  const { data: statsData } = trpc.messaging.stats.useQuery();

  // ── Mutations ──
  const updateStatus = trpc.messaging.updateReportStatus.useMutation({
    onSuccess: () => { utils.messaging.listReports.invalidate(); utils.messaging.stats.invalidate(); setSelectedReport(null); },
    onError: (e) => toast.error(e.message),
  });

  const createChannelMutation = trpc.messaging.createChannel.useMutation({
    onSuccess: () => { utils.messaging.listChannels.invalidate(); setShowCreateChannel(false); setNewChannel({ channelType: 'whatsapp', name: '', identifier: '', webhookUrl: '', apiKey: '' }); toast.success('Channel created'); },
    onError: (e) => toast.error(e.message),
  });

  const updateChannelMutation = trpc.messaging.updateChannel.useMutation({
    onSuccess: () => { utils.messaging.listChannels.invalidate(); setEditingChannel(null); toast.success('Channel updated'); },
    onError: (e) => toast.error(e.message),
  });

  const deleteChannelMutation = trpc.messaging.deleteChannel.useMutation({
    onSuccess: () => { utils.messaging.listChannels.invalidate(); toast.success('Channel deleted'); },
    onError: (e) => toast.error(e.message),
  });

  const toggleChannelMutation = trpc.messaging.toggleChannel.useMutation({
    onSuccess: () => utils.messaging.listChannels.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const filteredReports = reports;
  const newReports = reports.filter((r: any) => r.status === 'new').length;

  // Build stats array from channels for the overview tab
  const stats: ChannelStats[] = channels.map((ch: any) => ({
    channel: ch.channelType as Channel,
    totalReports: ch.totalReports ?? 0,
    todayReports: ch.todayReports ?? 0,
    verifiedReports: 0,
    activeUsers: ch.activeUsers ?? 0,
    isOnline: ch.status === 'active',
  }));

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  const riskColor = (score: number) =>
    score >= 80 ? 'text-red-400' : score >= 60 ? 'text-amber-400' : score >= 30 ? 'text-yellow-400' : 'text-emerald-400';

  const riskBg = (score: number) =>
    score >= 80 ? '#f87171' : score >= 60 ? '#fb923c' : score >= 30 ? '#fbbf24' : '#34d399';

  return (
    <>
      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {stats.map(stat => {
          const cfg = CHANNEL_CONFIG[stat.channel];
          return (
            <div key={stat.channel} className={cn("bis-card p-4 border", cfg.border)}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={cn("text-xs font-mono font-semibold", cfg.textColor)}>{cfg.label}</span>
                </div>
                <div className="flex items-center gap-1">
                  {stat.isOnline
                    ? <Wifi size={11} className="text-emerald-400" />
                    : <WifiOff size={11} className="text-red-400" />}
                  <span className={cn("text-[9px] font-mono", stat.isOnline ? "text-emerald-400" : "text-red-400")}>
                    {stat.isOnline ? 'ONLINE' : 'OFFLINE'}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
                <div>
                  <p className="text-muted-foreground">Total</p>
                  <p className={cn("font-bold text-sm", cfg.textColor)}>{stat.totalReports.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Today</p>
                  <p className="font-bold text-sm text-foreground">+{stat.todayReports}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {(['overview', 'reports', 'config', 'ussd_flow'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2 text-xs font-mono capitalize transition-all border-b-2 -mb-px",
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.replace('_', ' ')}
            {tab === 'reports' && newReports > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-[9px] rounded-full px-1.5 py-0.5">{newReports}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {stats.map(stat => {
              const cfg = CHANNEL_CONFIG[stat.channel];
              return (
                <div key={stat.channel} className="bis-card p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={cn("w-10 h-10 rounded-lg border flex items-center justify-center", cfg.color, cfg.border, cfg.textColor)}>
                      {cfg.icon}
                    </div>
                    <div>
                      <p className="text-sm font-mono font-semibold text-foreground">{cfg.label}</p>
                      <p className="text-[10px] text-muted-foreground">{cfg.description}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className={cn("text-lg font-mono font-bold", cfg.textColor)}>{stat.totalReports.toLocaleString()}</p>
                      <p className="text-[9px] font-mono text-muted-foreground uppercase">Total</p>
                    </div>
                    <div>
                      <p className="text-lg font-mono font-bold text-foreground">{stat.verifiedReports.toLocaleString()}</p>
                      <p className="text-[9px] font-mono text-muted-foreground uppercase">Verified</p>
                    </div>
                    <div>
                      <p className="text-lg font-mono font-bold text-foreground">+{stat.todayReports}</p>
                      <p className="text-[9px] font-mono text-muted-foreground uppercase">Today</p>
                    </div>
                  </div>
                  {stat.activeUsers > 0 && (
                    <div className="mt-3 flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
                      <Users size={10} />
                      {stat.activeUsers} active users
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* How to report */}
          <div className="bis-card p-4">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">How to Submit Reports</p>
            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
              <div className="space-y-1">
                <p className="text-emerald-400 font-semibold">WhatsApp</p>
                <p className="text-muted-foreground">Message: +234 700 BIS REPORT</p>
                <p className="text-muted-foreground">Include: name, location, crime type</p>
              </div>
              <div className="space-y-1">
                <p className="text-sky-400 font-semibold">Telegram</p>
                <p className="text-muted-foreground">Bot: @BISReportBot</p>
                <p className="text-muted-foreground">Anonymous reporting supported</p>
              </div>
              <div className="space-y-1">
                <p className="text-violet-400 font-semibold">USSD</p>
                <p className="text-muted-foreground">Dial: *347*BIS# (no internet needed)</p>
                <p className="text-muted-foreground">Works on all Nigerian networks</p>
              </div>
              <div className="space-y-1">
                <p className="text-amber-400 font-semibold">SMS</p>
                <p className="text-muted-foreground">Short code: 34729</p>
                <p className="text-muted-foreground">Format: REPORT [name] [location] [crime]</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Reports Tab ── */}
      {activeTab === 'reports' && (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            <select
              value={filterChannel}
              onChange={e => setFilterChannel(e.target.value as any)}
              className="h-8 px-3 rounded-md border border-border bg-background text-xs font-mono text-foreground"
            >
              <option value="all">All Channels</option>
              {Object.entries(CHANNEL_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as any)}
              className="h-8 px-3 rounded-md border border-border bg-background text-xs font-mono text-foreground"
            >
              <option value="all">All Status</option>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <span className="text-xs font-mono text-muted-foreground self-center ml-auto">
              {filteredReports.length} reports
            </span>
          </div>

          <div className="space-y-2">
            {filteredReports.map(report => {
              const cfg = (CHANNEL_CONFIG as any)[(report as any).channelType] ?? CHANNEL_CONFIG['sms'];
              const statusCfg = STATUS_CONFIG[report.status] ?? STATUS_CONFIG['new'];
              return (
                <div
                  key={report.id}
                  onClick={() => setSelectedReport(report)}
                  className={cn(
                    "bis-card p-4 cursor-pointer hover:bg-muted/20 transition-all",
                    (report as any).isNew && "ring-1 ring-primary/30 bg-primary/5"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn("w-8 h-8 rounded-md border flex items-center justify-center text-[10px] font-mono font-bold flex-shrink-0", cfg.color, cfg.border, cfg.textColor)}>
                      {cfg.shortCode}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={cn("text-[10px] font-mono font-semibold", cfg.textColor)}>{cfg.label}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">{report.sender}</span>
                        {(report as any).isNew && (
                          <span className="text-[9px] font-mono text-primary border border-primary/30 rounded px-1 animate-pulse">NEW</span>
                        )}
                        {(report as any).linkedSubjectRef && (
                          <span className="text-[9px] font-mono text-blue-400 border border-blue-400/30 rounded px-1">
                            {(report as any).linkedSubjectRef}
                          </span>
                        )}
                        <span className="text-[10px] font-mono text-muted-foreground ml-auto">{timeAgo(report.receivedAt instanceof Date ? report.receivedAt.toISOString() : String(report.receivedAt))}</span>
                      </div>
                      <p className="text-sm text-foreground/90 leading-relaxed line-clamp-2 mb-2">{report.content}</p>
                      <div className="flex items-center gap-3">
                        <span className={cn("flex items-center gap-1 text-[10px] font-mono", statusCfg.color)}>
                          {statusCfg.icon} {statusCfg.label}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <div className="w-12 h-1 bg-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${report.riskScore}%`, backgroundColor: riskBg(report.riskScore) }} />
                          </div>
                          <span className={cn("text-[10px] font-mono font-bold", riskColor(report.riskScore))}>
                            {report.riskScore}
                          </span>
                        </div>
                        {(report as any).attachmentCount > 0 && (
                          <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                            <Paperclip size={9} /> {(report as any).attachmentCount}
                          </span>
                        )}
                        {report.language !== 'en' && (
                          <span className="text-[9px] font-mono text-amber-400 border border-amber-400/30 rounded px-1">
                            {report.language.toUpperCase()}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight size={14} className="text-muted-foreground flex-shrink-0 mt-1" />
                  </div>
                </div>
              );
            })}
            {filteredReports.length === 0 && (
              <div className="bis-card p-12 text-center">
                <MessageSquare size={32} className="mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">No reports match your filters.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Config Tab ── */}
      {activeTab === 'config' && (
        <div className="space-y-4">
          {/* Add Channel button (admin only) */}
          {user?.role === 'admin' && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setShowCreateChannel(true)} className="gap-1 text-xs">
                + Add Channel
              </Button>
            </div>
          )}

          {/* Create channel form */}
          {showCreateChannel && (
            <div className="bis-card p-4 border border-primary/30 space-y-3">
              <p className="text-xs font-mono font-semibold text-primary uppercase tracking-wider">New Channel</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase">Type</label>
                  <select value={newChannel.channelType} onChange={e => setNewChannel(p => ({ ...p, channelType: e.target.value as any }))} className="w-full mt-1 bg-background border border-border rounded px-2 py-1 text-xs text-foreground">
                    {['whatsapp','telegram','ussd','sms','email'].map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase">Name</label>
                  <input value={newChannel.name} onChange={e => setNewChannel(p => ({ ...p, name: e.target.value }))} placeholder="e.g. WhatsApp Business" className="w-full mt-1 bg-background border border-border rounded px-2 py-1 text-xs text-foreground" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase">Identifier (number/handle)</label>
                  <input value={newChannel.identifier} onChange={e => setNewChannel(p => ({ ...p, identifier: e.target.value }))} placeholder="e.g. +2348012345678" className="w-full mt-1 bg-background border border-border rounded px-2 py-1 text-xs text-foreground" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase">Webhook URL (optional)</label>
                  <input value={newChannel.webhookUrl} onChange={e => setNewChannel(p => ({ ...p, webhookUrl: e.target.value }))} placeholder="https://..." className="w-full mt-1 bg-background border border-border rounded px-2 py-1 text-xs text-foreground" />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="outline" onClick={() => setShowCreateChannel(false)}>Cancel</Button>
                <Button size="sm" disabled={createChannelMutation.isPending || !newChannel.name || !newChannel.identifier} onClick={() => createChannelMutation.mutate({ ...newChannel, webhookUrl: newChannel.webhookUrl || undefined, apiKey: newChannel.apiKey || undefined })}>
                  {createChannelMutation.isPending ? 'Creating…' : 'Create'}
                </Button>
              </div>
            </div>
          )}

          {/* Live channel list */}
          {channelsLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-xs"><Loader2 size={12} className="animate-spin" /> Loading channels…</div>
          ) : channels.length === 0 ? (
            <p className="text-xs text-muted-foreground">No channels configured. Add one above.</p>
          ) : (
            channels.map((ch: any) => {
              const cfg = CHANNEL_CONFIG[ch.channelType as Channel] ?? { label: ch.channelType, shortCode: ch.channelType.slice(0,2).toUpperCase(), color: 'bg-muted', textColor: 'text-muted-foreground', border: 'border-border', icon: null, description: '' };
              const isEditing = editingChannel?.id === ch.id;
              return (
                <div key={ch.id} className={cn('bis-card p-5 border', cfg.border)}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className={cn('w-9 h-9 rounded-lg border flex items-center justify-center', cfg.color, cfg.border, cfg.textColor)}>
                      {cfg.icon}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-mono font-semibold text-foreground">{ch.name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{ch.identifier}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleChannelMutation.mutate({ id: ch.id, active: ch.status !== 'active' })}
                        disabled={toggleChannelMutation.isPending}
                        className={cn('text-[9px] font-mono px-2 py-0.5 rounded border transition-colors', ch.status === 'active' ? 'text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10' : 'text-red-400 border-red-400/30 hover:bg-red-400/10')}
                      >
                        {ch.status === 'active' ? 'ACTIVE' : ch.status?.toUpperCase() ?? 'INACTIVE'}
                      </button>
                      {user?.role === 'admin' && (
                        <>
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => setEditingChannel(isEditing ? null : ch)}>
                            {isEditing ? 'Cancel' : 'Edit'}
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 text-red-400 border-red-400/30" onClick={() => { if (confirm('Delete this channel?')) deleteChannelMutation.mutate({ id: ch.id }); }}>
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {isEditing && (
                    <div className="space-y-2 border-t border-border pt-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-muted-foreground uppercase">Name</label>
                          <input defaultValue={ch.name} id={`edit-name-${ch.id}`} className="w-full mt-1 bg-background border border-border rounded px-2 py-1 text-xs text-foreground" />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground uppercase">Identifier</label>
                          <input defaultValue={ch.identifier} id={`edit-ident-${ch.id}`} className="w-full mt-1 bg-background border border-border rounded px-2 py-1 text-xs text-foreground" />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground uppercase">Webhook URL</label>
                          <input defaultValue={ch.webhookUrl ?? ''} id={`edit-webhook-${ch.id}`} className="w-full mt-1 bg-background border border-border rounded px-2 py-1 text-xs text-foreground" />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" disabled={updateChannelMutation.isPending} onClick={() => {
                          const name = (document.getElementById(`edit-name-${ch.id}`) as HTMLInputElement)?.value;
                          const identifier = (document.getElementById(`edit-ident-${ch.id}`) as HTMLInputElement)?.value;
                          const webhookUrl = (document.getElementById(`edit-webhook-${ch.id}`) as HTMLInputElement)?.value;
                          updateChannelMutation.mutate({ id: ch.id, name: name || undefined, identifier: identifier || undefined, webhookUrl: webhookUrl || undefined });
                        }}>
                          {updateChannelMutation.isPending ? 'Saving…' : 'Save'}
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3 text-xs font-mono mt-2">
                    <div className="space-y-1">
                      <p className="text-muted-foreground uppercase tracking-wider text-[9px]">Endpoint</p>
                      <p className="text-foreground/80">api.bis.ng/webhooks/{ch.channelType}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-muted-foreground uppercase tracking-wider text-[9px]">Webhook</p>
                      <p className="text-foreground/80 font-mono truncate">{ch.webhookUrl ?? '—'}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── USSD Flow Tab ── */}
      {activeTab === 'ussd_flow' && (
        <div className="space-y-4">
          <div className="bis-card p-5">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-4">USSD Menu Flow — *347*BIS#</p>
            <div className="space-y-2 font-mono text-sm">
              {[
                { level: 0, text: 'Welcome to BIS Report Line\n1. Report a person\n2. Report a company\n3. Check report status\n4. Exit', color: 'text-foreground' },
                { level: 1, text: '1. Report a person →\nEnter full name of suspect:', color: 'text-blue-400' },
                { level: 2, text: 'Enter location (LGA/State):', color: 'text-blue-400' },
                { level: 3, text: 'Select crime type:\n1. Fraud / 419\n2. Land scam\n3. Employment scam\n4. Other', color: 'text-blue-400' },
                { level: 4, text: 'Report received. Reference: BIS-USSD-XXXX\nThank you for helping keep Nigeria safe.', color: 'text-emerald-400' },
              ].map((step, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={cn("w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-bold flex-shrink-0", step.color, "border-current")}>
                      {i + 1}
                    </div>
                    {i < 4 && <div className="w-px flex-1 bg-border my-1" />}
                  </div>
                  <div className="bis-card p-3 flex-1 mb-2">
                    <pre className={cn("text-xs whitespace-pre-wrap", step.color)}>{step.text}</pre>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bis-card p-4">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">USSD Statistics</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-xl font-mono font-bold text-violet-400">2,891</p>
                <p className="text-[9px] font-mono text-muted-foreground uppercase">Total Sessions</p>
              </div>
              <div>
                <p className="text-xl font-mono font-bold text-foreground">67</p>
                <p className="text-[9px] font-mono text-muted-foreground uppercase">Today</p>
              </div>
              <div>
                <p className="text-xl font-mono font-bold text-emerald-400">94%</p>
                <p className="text-[9px] font-mono text-muted-foreground uppercase">Completion Rate</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Report Detail Modal ── */}
      {selectedReport && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={() => setSelectedReport(null)} />
          <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 max-w-lg mx-auto z-50 bg-popover border border-border rounded-xl shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-mono font-semibold text-foreground">Incoming Report</p>
                <p className="text-[10px] font-mono text-muted-foreground">{selectedReport.id}</p>
              </div>
              <button onClick={() => setSelectedReport(null)} className="text-muted-foreground hover:text-foreground">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 mb-4">
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div>
                  <p className="text-muted-foreground uppercase text-[9px] tracking-wider">Channel</p>
                  <p className={cn("font-semibold", (CHANNEL_CONFIG as any)[selectedReport.channel]?.textColor ?? 'text-foreground')}>
                    {(CHANNEL_CONFIG as any)[selectedReport.channel]?.label ?? selectedReport.channel}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase text-[9px] tracking-wider">Sender</p>
                  <p className="text-foreground">{selectedReport.sender}</p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase text-[9px] tracking-wider">Risk Score</p>
                  <p className={cn("font-bold", riskColor(selectedReport.riskScore))}>{selectedReport.riskScore}</p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase text-[9px] tracking-wider">Language</p>
                  <p className="text-foreground uppercase">{selectedReport.language}</p>
                </div>
              </div>

              <div>
                <p className="text-muted-foreground uppercase text-[9px] font-mono tracking-wider mb-1">Content</p>
                <div className="bis-card p-3">
                  <p className="text-sm text-foreground/90 leading-relaxed">{selectedReport.content}</p>
                </div>
              </div>

              {(selectedReport as any).attachmentCount > 0 && (
                <p className="text-xs font-mono text-muted-foreground flex items-center gap-1.5">
                  <Paperclip size={11} /> {(selectedReport as any).attachmentCount} attachment{(selectedReport as any).attachmentCount > 1 ? 's' : ''}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1 text-xs font-mono"
                onClick={() => updateStatus.mutate({ id: selectedReport.id, status: 'dismissed' })}>
                Dismiss
              </Button>
              <Button variant="outline" size="sm" className="flex-1 text-xs font-mono text-amber-400 border-amber-400/30"
                onClick={() => updateStatus.mutate({ id: selectedReport.id, status: 'processing' })}>
                Start Processing
              </Button>
              <Button size="sm" className="flex-1 text-xs font-mono"
                onClick={() => updateStatus.mutate({ id: selectedReport.id, status: 'verified' })}>
                Verify & Link
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default function MessagingChannelsPage() {
  const newReportsCount = 2; // shown in layout subtitle
  return (
    <BISLayout
      title="Messaging Channels"
      subtitle="WhatsApp · Telegram · USSD · SMS"
      actions={
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-xs font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </span>
        </div>
      }
    >
      <MessagingChannelsPageInner />
    </BISLayout>
  );
}
