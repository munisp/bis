/**
 * BIS Social Monitoring Dashboard
 * =================================
 * Real-time social media monitoring for BIS subjects.
 * Design: Dark forensic intelligence theme, JetBrains Mono typography
 * Live feed: new mentions injected every 8 seconds via setInterval
 */

import { useState, useEffect, useRef } from 'react';
import BISLayout from '@/components/BISLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Globe, Twitter, Facebook, Linkedin, AlertTriangle, TrendingUp,
  TrendingDown, Minus, Radio, Bell, Filter, RefreshCw, ExternalLink,
  MessageSquare, Newspaper, Eye, ChevronDown, Zap, Activity
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type Platform = 'twitter' | 'facebook' | 'instagram' | 'tiktok' | 'linkedin' | 'news' | 'whatsapp_group';
type Sentiment = 'positive' | 'neutral' | 'negative' | 'critical';

interface SocialMention {
  id: string;
  platform: Platform;
  content: string;
  author: string;
  authorHandle: string;
  publishedAt: string;
  sentiment: Sentiment;
  riskScore: number;
  keywords: string[];
  engagementCount: number;
  isVerified: boolean;
  language: string;
  isNew?: boolean;
}

// ─── Platform Config ──────────────────────────────────────────────────────────

const PLATFORM_CONFIG: Record<Platform, { icon: string; label: string; color: string; textColor: string }> = {
  twitter:        { icon: '𝕏', label: 'X (Twitter)',      color: 'bg-sky-500/15 border-sky-500/30',    textColor: 'text-sky-400' },
  facebook:       { icon: 'f', label: 'Facebook',          color: 'bg-blue-500/15 border-blue-500/30',  textColor: 'text-blue-400' },
  instagram:      { icon: '◎', label: 'Instagram',         color: 'bg-pink-500/15 border-pink-500/30',  textColor: 'text-pink-400' },
  tiktok:         { icon: '♪', label: 'TikTok',            color: 'bg-slate-500/15 border-slate-500/30',textColor: 'text-slate-400' },
  linkedin:       { icon: 'in', label: 'LinkedIn',         color: 'bg-blue-600/15 border-blue-600/30',  textColor: 'text-blue-300' },
  news:           { icon: '⊞', label: 'News',              color: 'bg-amber-500/15 border-amber-500/30',textColor: 'text-amber-400' },
  whatsapp_group: { icon: '◈', label: 'WhatsApp Groups',   color: 'bg-emerald-500/15 border-emerald-500/30', textColor: 'text-emerald-400' },
};

const SENTIMENT_CONFIG: Record<Sentiment, { label: string; color: string; icon: React.ReactNode; border: string }> = {
  positive: { label: 'Positive', color: 'text-emerald-400', border: 'border-l-emerald-400', icon: <TrendingUp size={11} /> },
  neutral:  { label: 'Neutral',  color: 'text-slate-400',   border: 'border-l-slate-400',   icon: <Minus size={11} /> },
  negative: { label: 'Negative', color: 'text-amber-400',   border: 'border-l-amber-400',   icon: <TrendingDown size={11} /> },
  critical: { label: 'Critical', color: 'text-red-400',     border: 'border-l-red-400',     icon: <AlertTriangle size={11} /> },
};

// ─── Mock Seed Data ───────────────────────────────────────────────────────────

const SEED_MENTIONS: SocialMention[] = [
  {
    id: 'm1', platform: 'twitter', author: 'Chukwudi Okonkwo', authorHandle: '@chukwudi_ok',
    content: 'Just saw @AdekunleAdeyemi at the CBN fraud conference. Interesting presence given the ongoing investigation.',
    publishedAt: new Date(Date.now() - 8 * 60000).toISOString(),
    sentiment: 'negative', riskScore: 72, keywords: ['fraud', 'investigation', 'CBN'],
    engagementCount: 234, isVerified: false, language: 'en',
  },
  {
    id: 'm2', platform: 'news', author: 'Punch Nigeria', authorHandle: 'punchng.com',
    content: 'EFCC arraigns Lagos businessman Adekunle Adeyemi over alleged N450m fraud involving real estate syndicate.',
    publishedAt: new Date(Date.now() - 25 * 60000).toISOString(),
    sentiment: 'critical', riskScore: 91, keywords: ['EFCC', 'fraud', 'arraign', 'N450m'],
    engagementCount: 1842, isVerified: true, language: 'en',
  },
  {
    id: 'm3', platform: 'facebook', author: 'Lagos Business Watch', authorHandle: 'LBW',
    content: 'Community members in Lekki Phase 1 are warning others about a real estate developer who has collected deposits but not delivered properties.',
    publishedAt: new Date(Date.now() - 45 * 60000).toISOString(),
    sentiment: 'negative', riskScore: 68, keywords: ['real estate', 'deposit', 'Lekki'],
    engagementCount: 567, isVerified: false, language: 'en',
  },
  {
    id: 'm4', platform: 'linkedin', author: 'Adaeze Nwosu', authorHandle: 'adaeze-nwosu',
    content: 'Proud to announce that Adeyemi Holdings has been cleared of all allegations. The company remains committed to delivering value.',
    publishedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
    sentiment: 'positive', riskScore: 22, keywords: ['cleared', 'allegations'],
    engagementCount: 89, isVerified: true, language: 'en',
  },
  {
    id: 'm5', platform: 'whatsapp_group', author: 'Alaba Traders Forum', authorHandle: 'WhatsApp Group',
    content: 'Una don hear say Adekunle don run? E collect money from 15 people for that Ikoyi property. Abeg warn your people.',
    publishedAt: new Date(Date.now() - 3 * 3600000).toISOString(),
    sentiment: 'critical', riskScore: 85, keywords: ['run', 'collect money', 'Ikoyi'],
    engagementCount: 312, isVerified: false, language: 'pidgin',
  },
  {
    id: 'm6', platform: 'twitter', author: 'Femi Adeyinka', authorHandle: '@fadeyinka',
    content: 'The court hearing for the Adeyemi case has been adjourned to April 15. Justice delayed as usual.',
    publishedAt: new Date(Date.now() - 5 * 3600000).toISOString(),
    sentiment: 'neutral', riskScore: 45, keywords: ['court', 'adjourned', 'justice'],
    engagementCount: 156, isVerified: false, language: 'en',
  },
];

// ─── Live mention generator ───────────────────────────────────────────────────

const LIVE_POOL: Omit<SocialMention, 'id' | 'publishedAt' | 'isNew'>[] = [
  {
    platform: 'twitter', author: 'NaijaCrimeWatch', authorHandle: '@naijacrime',
    content: 'BREAKING: Sources confirm EFCC has frozen 3 bank accounts linked to subject. Total: ₦1.2bn.',
    sentiment: 'critical', riskScore: 94, keywords: ['EFCC', 'frozen', 'bank accounts'],
    engagementCount: 0, isVerified: false, language: 'en',
  },
  {
    platform: 'news', author: 'Vanguard Nigeria', authorHandle: 'vanguardngr.com',
    content: 'Court grants bail to Lagos property developer amid fraud allegations — conditions include surrender of international passport.',
    sentiment: 'negative', riskScore: 78, keywords: ['bail', 'fraud', 'passport'],
    engagementCount: 0, isVerified: true, language: 'en',
  },
  {
    platform: 'facebook', author: 'Ikoyi Residents Assoc.', authorHandle: 'IRA-Lagos',
    content: 'We have compiled a list of affected buyers. If you paid deposit to Adeyemi Holdings, please DM us.',
    sentiment: 'negative', riskScore: 66, keywords: ['affected buyers', 'deposit', 'Adeyemi Holdings'],
    engagementCount: 0, isVerified: false, language: 'en',
  },
  {
    platform: 'whatsapp_group', author: 'Lekki Investors Network', authorHandle: 'WhatsApp Group',
    content: 'Oga I just hear say the man don travel to Dubai. Somebody should alert EFCC before e escape.',
    sentiment: 'critical', riskScore: 89, keywords: ['Dubai', 'escape', 'EFCC'],
    engagementCount: 0, isVerified: false, language: 'pidgin',
  },
  {
    platform: 'twitter', author: 'BusinessDayNG', authorHandle: '@BusinessDayNg',
    content: 'Analysis: The Adeyemi Holdings case exposes systemic gaps in Nigeria\'s real estate regulatory framework.',
    sentiment: 'neutral', riskScore: 38, keywords: ['regulatory', 'real estate', 'Nigeria'],
    engagementCount: 0, isVerified: true, language: 'en',
  },
  {
    platform: 'instagram', author: 'LagosInsider', authorHandle: '@lagosinsider',
    content: 'Photos from the court appearance today. Subject appeared calm and well-dressed. Supporters outside courthouse.',
    sentiment: 'neutral', riskScore: 42, keywords: ['court', 'appearance'],
    engagementCount: 0, isVerified: false, language: 'en',
  },
];

let liveIdx = 0;

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SocialMonitoringDashboard() {
  const [mentions, setMentions] = useState<SocialMention[]>(SEED_MENTIONS);
  const [filterPlatform, setFilterPlatform] = useState<Platform | 'all'>('all');
  const [filterSentiment, setFilterSentiment] = useState<Sentiment | 'all'>('all');
  const [isLive, setIsLive] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const [activeTab, setActiveTab] = useState<'feed' | 'analytics' | 'alerts'>('feed');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live feed injection
  useEffect(() => {
    if (!isLive) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      const template = LIVE_POOL[liveIdx % LIVE_POOL.length];
      liveIdx++;
      const newMention: SocialMention = {
        ...template,
        id: `live_${Date.now()}`,
        publishedAt: new Date().toISOString(),
        engagementCount: Math.floor(Math.random() * 500),
        isNew: true,
      };
      setMentions(prev => [newMention, ...prev.slice(0, 49)]);
      setNewCount(c => c + 1);
      // Clear "new" flag after 4 seconds
      setTimeout(() => {
        setMentions(prev => prev.map(m => m.id === newMention.id ? { ...m, isNew: false } : m));
      }, 4000);
    }, 8000);

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isLive]);

  const filtered = mentions.filter(m => {
    if (filterPlatform !== 'all' && m.platform !== filterPlatform) return false;
    if (filterSentiment !== 'all' && m.sentiment !== filterSentiment) return false;
    return true;
  });

  const criticalCount = mentions.filter(m => m.sentiment === 'critical').length;
  const avgRisk = Math.round(mentions.reduce((s, m) => s + m.riskScore, 0) / mentions.length);
  const platforms = Array.from(new Set(mentions.map(m => m.platform)));

  const riskColor = (score: number) =>
    score >= 80 ? 'text-red-400' : score >= 60 ? 'text-amber-400' : score >= 30 ? 'text-yellow-400' : 'text-emerald-400';

  const riskBg = (score: number) =>
    score >= 80 ? '#f87171' : score >= 60 ? '#fb923c' : score >= 30 ? '#fbbf24' : '#34d399';

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  return (
    <BISLayout
      title="Social Intelligence"
      subtitle="Adekunle Adeyemi · BIS-2026-0142"
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setIsLive(l => !l); setNewCount(0); }}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-mono transition-all",
              isLive
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                : "border-border text-muted-foreground hover:border-border/80"
            )}
          >
            <span className={cn("w-1.5 h-1.5 rounded-full", isLive ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground")} />
            {isLive ? "LIVE" : "PAUSED"}
          </button>
          {newCount > 0 && (
            <Badge variant="destructive" className="text-xs font-mono">
              +{newCount} new
            </Badge>
          )}
        </div>
      }
    >
      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total Mentions', value: mentions.length, sub: `${platforms.length} platforms`, icon: <Globe size={14} />, color: 'text-blue-400' },
          { label: 'Critical Alerts', value: criticalCount, sub: 'require action', icon: <AlertTriangle size={14} />, color: 'text-red-400' },
          { label: 'Avg Risk Score', value: avgRisk, sub: 'across all mentions', icon: <Activity size={14} />, color: riskColor(avgRisk) },
          { label: 'Live Feed', value: isLive ? 'ON' : 'OFF', sub: 'updates every 8s', icon: <Radio size={14} />, color: isLive ? 'text-emerald-400' : 'text-muted-foreground' },
        ].map(stat => (
          <div key={stat.label} className="bis-card p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{stat.label}</span>
              <span className={cn("opacity-60", stat.color)}>{stat.icon}</span>
            </div>
            <p className={cn("text-2xl font-mono font-bold", stat.color)}>{stat.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {(['feed', 'analytics', 'alerts'] as const).map(tab => (
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
            {tab}
            {tab === 'alerts' && criticalCount > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-[9px] rounded-full px-1.5 py-0.5">{criticalCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Feed Tab ── */}
      {activeTab === 'feed' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-2 mb-4">
            <select
              value={filterPlatform}
              onChange={e => setFilterPlatform(e.target.value as any)}
              className="h-8 px-3 rounded-md border border-border bg-background text-xs font-mono text-foreground"
            >
              <option value="all">All Platforms</option>
              {Object.entries(PLATFORM_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.icon} {v.label}</option>
              ))}
            </select>
            <select
              value={filterSentiment}
              onChange={e => setFilterSentiment(e.target.value as any)}
              className="h-8 px-3 rounded-md border border-border bg-background text-xs font-mono text-foreground"
            >
              <option value="all">All Sentiment</option>
              {Object.entries(SENTIMENT_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <span className="text-xs font-mono text-muted-foreground self-center ml-auto">
              {filtered.length} mentions
            </span>
          </div>

          {/* Feed list */}
          <div className="space-y-2">
            {filtered.map(mention => {
              const plat = PLATFORM_CONFIG[mention.platform];
              const sent = SENTIMENT_CONFIG[mention.sentiment];
              return (
                <div
                  key={mention.id}
                  className={cn(
                    "bis-card p-4 border-l-2 transition-all duration-500",
                    sent.border,
                    mention.isNew && "ring-1 ring-primary/30 bg-primary/5"
                  )}
                >
                  <div className="flex items-start gap-3">
                    {/* Platform badge */}
                    <div className={cn("w-8 h-8 rounded-md border flex items-center justify-center text-xs font-bold flex-shrink-0", plat.color, plat.textColor)}>
                      {plat.icon}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-mono font-semibold text-foreground">{mention.author}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">{mention.authorHandle}</span>
                        {mention.isVerified && (
                          <span className="text-[9px] font-mono text-blue-400 border border-blue-400/30 rounded px-1">VERIFIED</span>
                        )}
                        {mention.isNew && (
                          <span className="text-[9px] font-mono text-primary border border-primary/30 rounded px-1 animate-pulse">NEW</span>
                        )}
                        <span className="text-[10px] font-mono text-muted-foreground ml-auto">{timeAgo(mention.publishedAt)}</span>
                      </div>

                      <p className="text-sm text-foreground/90 leading-relaxed mb-2">{mention.content}</p>

                      <div className="flex items-center gap-3 flex-wrap">
                        {/* Sentiment */}
                        <span className={cn("flex items-center gap-1 text-[10px] font-mono", sent.color)}>
                          {sent.icon} {sent.label}
                        </span>

                        {/* Risk score */}
                        <div className="flex items-center gap-1.5">
                          <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${mention.riskScore}%`, backgroundColor: riskBg(mention.riskScore) }} />
                          </div>
                          <span className={cn("text-[10px] font-mono font-bold", riskColor(mention.riskScore))}>
                            {mention.riskScore}
                          </span>
                        </div>

                        {/* Engagement */}
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {mention.engagementCount.toLocaleString()} engagements
                        </span>

                        {/* Language */}
                        {mention.language !== 'en' && (
                          <span className="text-[9px] font-mono text-amber-400 border border-amber-400/30 rounded px-1">
                            {mention.language.toUpperCase()}
                          </span>
                        )}

                        {/* Keywords */}
                        <div className="flex gap-1 flex-wrap">
                          {mention.keywords.slice(0, 3).map(kw => (
                            <span key={kw} className="text-[9px] font-mono text-muted-foreground/60 border border-border/40 rounded px-1">
                              #{kw}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {filtered.length === 0 && (
              <div className="bis-card p-12 text-center">
                <Globe size={32} className="mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">No mentions match your filters.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Analytics Tab ── */}
      {activeTab === 'analytics' && (
        <div className="grid grid-cols-2 gap-4">
          {/* Sentiment breakdown */}
          <div className="bis-card p-4">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">Sentiment Breakdown</p>
            {(['critical', 'negative', 'neutral', 'positive'] as Sentiment[]).map(s => {
              const count = mentions.filter(m => m.sentiment === s).length;
              const pct = Math.round((count / mentions.length) * 100);
              const cfg = SENTIMENT_CONFIG[s];
              return (
                <div key={s} className="flex items-center gap-3 mb-2">
                  <span className={cn("text-xs font-mono w-16", cfg.color)}>{cfg.label}</span>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", {
                      'bg-red-400': s === 'critical',
                      'bg-amber-400': s === 'negative',
                      'bg-slate-400': s === 'neutral',
                      'bg-emerald-400': s === 'positive',
                    })} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-mono text-muted-foreground w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>

          {/* Platform breakdown */}
          <div className="bis-card p-4">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">Platform Activity</p>
            {Object.entries(PLATFORM_CONFIG).map(([key, cfg]) => {
              const count = mentions.filter(m => m.platform === key).length;
              if (count === 0) return null;
              const pct = Math.round((count / mentions.length) * 100);
              return (
                <div key={key} className="flex items-center gap-3 mb-2">
                  <span className={cn("text-xs font-mono w-24 truncate", cfg.textColor)}>{cfg.label}</span>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-primary/60 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-mono text-muted-foreground w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>

          {/* Risk distribution */}
          <div className="bis-card p-4 col-span-2">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">Risk Score Distribution</p>
            <div className="flex gap-1 items-end h-20">
              {Array.from({ length: 10 }, (_, i) => {
                const min = i * 10, max = min + 10;
                const count = mentions.filter(m => m.riskScore >= min && m.riskScore < max).length;
                const maxCount = Math.max(...Array.from({ length: 10 }, (_, j) =>
                  mentions.filter(m => m.riskScore >= j * 10 && m.riskScore < j * 10 + 10).length
                ));
                const height = maxCount > 0 ? (count / maxCount) * 100 : 0;
                const color = max <= 30 ? '#34d399' : max <= 60 ? '#fbbf24' : max <= 80 ? '#fb923c' : '#f87171';
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full rounded-sm transition-all" style={{ height: `${height}%`, backgroundColor: color, minHeight: count > 0 ? 4 : 0 }} />
                    <span className="text-[8px] font-mono text-muted-foreground">{min}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Alerts Tab ── */}
      {activeTab === 'alerts' && (
        <div className="space-y-3">
          <div className="bis-card p-4 border border-amber-500/20 bg-amber-500/5">
            <p className="text-xs font-mono text-amber-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Bell size={12} /> Alert Configuration
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { channel: 'WhatsApp', dest: '+234 801 234 5678', threshold: 70, active: true },
                { channel: 'SMS', dest: '+234 801 234 5678', threshold: 80, active: true },
                { channel: 'Telegram', dest: '@bis_alerts', threshold: 60, active: false },
                { channel: 'Email', dest: 'investigator@bis.ng', threshold: 50, active: false },
              ].map(cfg => (
                <div key={cfg.channel} className={cn("bis-card p-3", !cfg.active && "opacity-50")}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono font-semibold text-foreground">{cfg.channel}</span>
                    <span className={cn("text-[9px] font-mono rounded px-1.5 py-0.5", cfg.active ? "bg-emerald-500/20 text-emerald-400" : "bg-muted text-muted-foreground")}>
                      {cfg.active ? 'ACTIVE' : 'OFF'}
                    </span>
                  </div>
                  <p className="text-[10px] font-mono text-muted-foreground">{cfg.dest}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">Threshold: risk ≥ {cfg.threshold}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Critical mentions */}
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Critical Mentions Requiring Action</p>
          {mentions.filter(m => m.sentiment === 'critical').map(mention => {
            const sent = SENTIMENT_CONFIG[mention.sentiment];
            const plat = PLATFORM_CONFIG[mention.platform];
            return (
              <div key={mention.id} className="bis-card p-4 border-l-2 border-l-red-400">
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn("text-[10px] font-mono font-bold", plat.textColor)}>{plat.label}</span>
                  <span className="text-xs font-mono text-foreground font-semibold">{mention.author}</span>
                  <span className="text-[10px] font-mono text-muted-foreground ml-auto">{timeAgo(mention.publishedAt)}</span>
                </div>
                <p className="text-sm text-foreground/90 mb-2">{mention.content}</p>
                <div className="flex items-center gap-2">
                  <span className={cn("text-xs font-mono font-bold", riskColor(mention.riskScore))}>
                    Risk: {mention.riskScore}
                  </span>
                  <Button size="sm" variant="outline" className="h-6 text-[10px] font-mono ml-auto">
                    Link to Investigation
                  </Button>
                  <Button size="sm" variant="destructive" className="h-6 text-[10px] font-mono">
                    Flag & Alert
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </BISLayout>
  );
}
