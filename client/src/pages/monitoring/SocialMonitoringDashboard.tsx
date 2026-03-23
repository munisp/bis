/**
 * BIS Social Monitoring Dashboard
 * =================================
 * Real-time social media monitoring for BIS subjects.
 *
 * Features:
 * - Live feed of social media mentions across platforms
 * - Sentiment analysis with risk scoring
 * - Keyword alert management
 * - Network graph of connected entities
 * - Export to investigation report
 * - WhatsApp/Telegram/SMS alert configuration
 */

import React, { useState, useEffect } from 'react';
import BISLayout from '@/components/BISLayout';

// ─── Types ───────────────────────────────────────────────────────────────────

type Platform = 'twitter' | 'facebook' | 'instagram' | 'tiktok' | 'linkedin' | 'news' | 'whatsapp_group';
type Sentiment = 'positive' | 'neutral' | 'negative' | 'critical';
type AlertChannel = 'whatsapp' | 'telegram' | 'sms' | 'email';

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
  url: string;
  engagementCount: number;
  isVerified: boolean;
  language: string;
}

interface MonitoredSubject {
  id: string;
  name: string;
  bisRef: string;
  keywords: string[];
  platforms: Platform[];
  alertThreshold: number;
  alertChannels: AlertChannel[];
  totalMentions: number;
  criticalAlerts: number;
  lastActivity: string;
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
}

interface AlertConfig {
  channel: AlertChannel;
  destination: string;
  minRiskScore: number;
  enabled: boolean;
}

// ─── Platform Icons & Colors ──────────────────────────────────────────────────

const PLATFORM_CONFIG: Record<Platform, { icon: string; color: string; label: string }> = {
  twitter: { icon: '🐦', color: 'bg-sky-100 text-sky-700', label: 'X (Twitter)' },
  facebook: { icon: '📘', color: 'bg-blue-100 text-blue-700', label: 'Facebook' },
  instagram: { icon: '📸', color: 'bg-pink-100 text-pink-700', label: 'Instagram' },
  tiktok: { icon: '🎵', color: 'bg-gray-900 text-white', label: 'TikTok' },
  linkedin: { icon: '💼', color: 'bg-blue-100 text-blue-800', label: 'LinkedIn' },
  news: { icon: '📰', color: 'bg-orange-100 text-orange-700', label: 'News' },
  whatsapp_group: { icon: '💬', color: 'bg-green-100 text-green-700', label: 'WhatsApp Groups' },
};

const SENTIMENT_CONFIG: Record<Sentiment, { icon: string; color: string; label: string }> = {
  positive: { icon: '😊', color: 'bg-green-100 text-green-700', label: 'Positive' },
  neutral: { icon: '😐', color: 'bg-gray-100 text-gray-700', label: 'Neutral' },
  negative: { icon: '😠', color: 'bg-orange-100 text-orange-700', label: 'Negative' },
  critical: { icon: '🚨', color: 'bg-red-100 text-red-700', label: 'Critical' },
};

// ─── Mock Data (replace with tRPC in production) ──────────────────────────────

const MOCK_MENTIONS: SocialMention[] = [
  {
    id: '1',
    platform: 'twitter',
    content: 'Just saw @AdekunleAdeyemi at the CBN fraud conference. Interesting presence given the ongoing investigation.',
    author: 'Chukwudi Okonkwo',
    authorHandle: '@chukwudi_ok',
    publishedAt: '2026-03-23T10:30:00Z',
    sentiment: 'negative',
    riskScore: 72,
    keywords: ['fraud', 'investigation', 'CBN'],
    url: '#',
    engagementCount: 234,
    isVerified: false,
    language: 'en',
  },
  {
    id: '2',
    platform: 'news',
    content: 'EFCC lists 15 new names in Lagos real estate fraud probe. Sources indicate Adeyemi Holdings among companies under scrutiny.',
    author: 'Punch Nigeria',
    authorHandle: 'punchng.com',
    publishedAt: '2026-03-23T08:15:00Z',
    sentiment: 'critical',
    riskScore: 91,
    keywords: ['EFCC', 'fraud', 'real estate', 'probe'],
    url: '#',
    engagementCount: 1847,
    isVerified: true,
    language: 'en',
  },
  {
    id: '3',
    platform: 'facebook',
    content: 'Our company just completed a major partnership with Adeyemi Holdings. Excited for the future!',
    author: 'TechLagos Community',
    authorHandle: 'TechLagos',
    publishedAt: '2026-03-22T16:45:00Z',
    sentiment: 'positive',
    riskScore: 15,
    keywords: ['partnership', 'Adeyemi Holdings'],
    url: '#',
    engagementCount: 89,
    isVerified: false,
    language: 'en',
  },
  {
    id: '4',
    platform: 'whatsapp_group',
    content: '[Intercepted from public group "Lagos Business Network"] Oga Adeyemi don run from the country o. E don collect money from 20 people.',
    author: 'Anonymous',
    authorHandle: 'Lagos Business Network',
    publishedAt: '2026-03-23T07:00:00Z',
    sentiment: 'critical',
    riskScore: 85,
    keywords: ['run', 'collect money', 'fraud'],
    url: '#',
    engagementCount: 0,
    isVerified: false,
    language: 'pidgin',
  },
];

const MOCK_SUBJECT: MonitoredSubject = {
  id: 'sub_001',
  name: 'Adeyemi Holdings Ltd',
  bisRef: 'BIS-2026-0042',
  keywords: ['Adeyemi', 'Adeyemi Holdings', 'AH Ltd', 'Kunle Adeyemi'],
  platforms: ['twitter', 'facebook', 'news', 'whatsapp_group'],
  alertThreshold: 70,
  alertChannels: ['whatsapp', 'sms'],
  totalMentions: 47,
  criticalAlerts: 3,
  lastActivity: '2026-03-23T10:30:00Z',
  overallRisk: 'high',
};

// ─── Components ───────────────────────────────────────────────────────────────

function RiskBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-red-100 text-red-700' :
                score >= 60 ? 'bg-orange-100 text-orange-700' :
                score >= 40 ? 'bg-yellow-100 text-yellow-700' :
                'bg-green-100 text-green-700';
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${color}`}>
      {score}
    </span>
  );
}

function MentionCard({ mention }: { mention: SocialMention }) {
  const platform = PLATFORM_CONFIG[mention.platform];
  const sentiment = SENTIMENT_CONFIG[mention.sentiment];

  return (
    <div className={`border rounded-xl p-4 ${mention.sentiment === 'critical' ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${platform.color}`}>
            {platform.icon} {platform.label}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-xs ${sentiment.color}`}>
            {sentiment.icon} {sentiment.label}
          </span>
        </div>
        <RiskBadge score={mention.riskScore} />
      </div>

      <p className="text-sm text-gray-700 mb-2 line-clamp-3">{mention.content}</p>

      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>
          {mention.isVerified && '✓ '}{mention.author}
          {mention.authorHandle !== mention.author && ` · ${mention.authorHandle}`}
        </span>
        <div className="flex items-center gap-3">
          {mention.engagementCount > 0 && (
            <span>👁 {mention.engagementCount.toLocaleString()}</span>
          )}
          <span>{new Date(mention.publishedAt).toLocaleDateString()}</span>
        </div>
      </div>

      {mention.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {mention.keywords.map(kw => (
            <span key={kw} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
              #{kw}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

function SocialMonitoringDashboardInner() {
  const [activeTab, setActiveTab] = useState<'feed' | 'alerts' | 'channels' | 'keywords'>('feed');
  const [mentions, setMentions] = useState<SocialMention[]>(MOCK_MENTIONS);
  const [subject] = useState<MonitoredSubject>(MOCK_SUBJECT);
  const [filterPlatform, setFilterPlatform] = useState<Platform | 'all'>('all');
  const [filterSentiment, setFilterSentiment] = useState<Sentiment | 'all'>('all');
  const [newKeyword, setNewKeyword] = useState('');
  const [alertConfigs, setAlertConfigs] = useState<AlertConfig[]>([
    { channel: 'whatsapp', destination: '+2348012345678', minRiskScore: 70, enabled: true },
    { channel: 'sms', destination: '+2348012345678', minRiskScore: 80, enabled: true },
    { channel: 'telegram', destination: '@bis_alerts', minRiskScore: 60, enabled: false },
    { channel: 'email', destination: 'investigator@bis.ng', minRiskScore: 50, enabled: false },
  ]);

  const filteredMentions = mentions.filter(m => {
    if (filterPlatform !== 'all' && m.platform !== filterPlatform) return false;
    if (filterSentiment !== 'all' && m.sentiment !== filterSentiment) return false;
    return true;
  });

  const criticalCount = mentions.filter(m => m.sentiment === 'critical').length;
  const avgRisk = mentions.reduce((s, m) => s + m.riskScore, 0) / mentions.length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Social Monitoring</h1>
            <p className="text-sm text-gray-500">{subject.name} · {subject.bisRef}</p>
          </div>
          <div className={`px-3 py-1 rounded-full text-sm font-bold ${
            subject.overallRisk === 'critical' ? 'bg-red-100 text-red-700' :
            subject.overallRisk === 'high' ? 'bg-orange-100 text-orange-700' :
            subject.overallRisk === 'medium' ? 'bg-yellow-100 text-yellow-700' :
            'bg-green-100 text-green-700'
          }`}>
            {subject.overallRisk.toUpperCase()} RISK
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 p-6">
        {[
          { label: 'Total Mentions', value: subject.totalMentions, color: 'text-blue-600' },
          { label: 'Critical Alerts', value: criticalCount, color: 'text-red-600' },
          { label: 'Avg Risk Score', value: Math.round(avgRisk), color: 'text-orange-600' },
          { label: 'Platforms', value: subject.platforms.length, color: 'text-purple-600' },
        ].map(stat => (
          <div key={stat.label} className="bg-white rounded-xl p-4 shadow-sm border">
            <p className="text-xs text-gray-500 mb-1">{stat.label}</p>
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="px-6">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {(['feed', 'alerts', 'channels', 'keywords'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition ${
                activeTab === tab ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
              {tab === 'alerts' && criticalCount > 0 && (
                <span className="ml-1 bg-red-500 text-white text-xs rounded-full px-1.5">{criticalCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 space-y-4">

        {/* ── Feed Tab ── */}
        {activeTab === 'feed' && (
          <>
            {/* Filters */}
            <div className="flex gap-3 flex-wrap">
              <select
                value={filterPlatform}
                onChange={e => setFilterPlatform(e.target.value as any)}
                className="border rounded-lg px-3 py-1.5 text-sm bg-white"
              >
                <option value="all">All Platforms</option>
                {Object.entries(PLATFORM_CONFIG).map(([key, val]) => (
                  <option key={key} value={key}>{val.icon} {val.label}</option>
                ))}
              </select>
              <select
                value={filterSentiment}
                onChange={e => setFilterSentiment(e.target.value as any)}
                className="border rounded-lg px-3 py-1.5 text-sm bg-white"
              >
                <option value="all">All Sentiments</option>
                {Object.entries(SENTIMENT_CONFIG).map(([key, val]) => (
                  <option key={key} value={key}>{val.icon} {val.label}</option>
                ))}
              </select>
            </div>

            {/* Mentions */}
            <div className="space-y-3">
              {filteredMentions.map(mention => (
                <MentionCard key={mention.id} mention={mention} />
              ))}
              {filteredMentions.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  <p className="text-4xl mb-2">🔍</p>
                  <p>No mentions match the current filters</p>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Alerts Tab ── */}
        {activeTab === 'alerts' && (
          <div className="space-y-3">
            {mentions.filter(m => m.riskScore >= subject.alertThreshold).map(mention => (
              <div key={mention.id} className="bg-white border border-red-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-red-700">🚨 High Risk Alert</span>
                  <RiskBadge score={mention.riskScore} />
                </div>
                <p className="text-sm text-gray-700 line-clamp-2">{mention.content}</p>
                <div className="flex gap-2 mt-3">
                  <button className="text-xs bg-red-600 text-white px-3 py-1 rounded-lg">
                    Escalate to EFCC
                  </button>
                  <button className="text-xs border border-gray-300 text-gray-600 px-3 py-1 rounded-lg">
                    Add to Report
                  </button>
                  <button className="text-xs border border-gray-300 text-gray-600 px-3 py-1 rounded-lg">
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Channels Tab ── */}
        {activeTab === 'channels' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">Configure where alerts are sent when risk threshold is exceeded.</p>
            {alertConfigs.map((config, idx) => (
              <div key={config.channel} className="bg-white border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">
                      {config.channel === 'whatsapp' ? '💬' :
                       config.channel === 'telegram' ? '✈️' :
                       config.channel === 'sms' ? '📱' : '📧'}
                    </span>
                    <span className="font-medium capitalize">{config.channel}</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.enabled}
                      onChange={e => {
                        const updated = [...alertConfigs];
                        updated[idx] = { ...config, enabled: e.target.checked };
                        setAlertConfigs(updated);
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600" />
                  </label>
                </div>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-gray-500">Destination</label>
                    <input
                      type="text"
                      value={config.destination}
                      onChange={e => {
                        const updated = [...alertConfigs];
                        updated[idx] = { ...config, destination: e.target.value };
                        setAlertConfigs(updated);
                      }}
                      className="w-full border rounded-lg px-3 py-1.5 text-sm mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Min Risk Score: {config.minRiskScore}</label>
                    <input
                      type="range"
                      min={0} max={100}
                      value={config.minRiskScore}
                      onChange={e => {
                        const updated = [...alertConfigs];
                        updated[idx] = { ...config, minRiskScore: parseInt(e.target.value) };
                        setAlertConfigs(updated);
                      }}
                      className="w-full mt-1"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Keywords Tab ── */}
        {activeTab === 'keywords' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={newKeyword}
                onChange={e => setNewKeyword(e.target.value)}
                placeholder="Add keyword to monitor..."
                className="flex-1 border rounded-xl px-4 py-2 text-sm"
                onKeyDown={e => e.key === 'Enter' && newKeyword && setNewKeyword('')}
              />
              <button className="bg-green-600 text-white px-4 py-2 rounded-xl text-sm font-medium">
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {subject.keywords.map(kw => (
                <div key={kw} className="flex items-center gap-1 bg-gray-100 rounded-full px-3 py-1">
                  <span className="text-sm text-gray-700">{kw}</span>
                  <button className="text-gray-400 hover:text-red-500 text-xs">✕</button>
                </div>
              ))}
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
              <p className="font-medium mb-1">💡 Monitoring Tips</p>
              <ul className="space-y-1 text-xs">
                <li>• Include name variations (e.g., "Adeyemi", "A. Holdings", "AH Ltd")</li>
                <li>• Add Pidgin English variants for Nigerian social media</li>
                <li>• Include phone numbers and email addresses if known</li>
                <li>• Monitor associated individuals (directors, partners)</li>
              </ul>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}


export default function SocialMonitoringDashboard() {
  return (
    <BISLayout>
      <SocialMonitoringDashboardInner />
    </BISLayout>
  );
}
