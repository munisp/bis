/**
 * BIS Messaging Channels Management Page
 * ========================================
 * Configure and manage WhatsApp, Telegram, USSD, and SMS channels
 * for reporting and monitoring in developing countries.
 *
 * Features:
 * - WhatsApp Business API configuration
 * - Telegram bot management
 * - USSD session monitoring (Africa's Talking)
 * - SMS gateway configuration
 * - Incoming report queue from all channels
 * - Channel analytics
 */

import React, { useState } from 'react';
import BISLayout from '@/components/BISLayout';

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
}

interface ChannelStats {
  channel: Channel;
  totalReports: number;
  todayReports: number;
  verifiedReports: number;
  activeUsers: number;
  isOnline: boolean;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const CHANNEL_STATS: ChannelStats[] = [
  { channel: 'whatsapp', totalReports: 1247, todayReports: 23, verifiedReports: 891, activeUsers: 342, isOnline: true },
  { channel: 'telegram', totalReports: 543, todayReports: 11, verifiedReports: 412, activeUsers: 156, isOnline: true },
  { channel: 'ussd', totalReports: 2891, todayReports: 67, verifiedReports: 1943, activeUsers: 0, isOnline: true },
  { channel: 'sms', totalReports: 4102, todayReports: 89, verifiedReports: 2876, activeUsers: 0, isOnline: true },
];

const INCOMING_REPORTS: IncomingReport[] = [
  {
    id: 'rpt_001',
    channel: 'whatsapp',
    sender: '+2348012345678',
    content: 'I want to report a man called Emeka Okafor in Alaba International Market. He has been collecting money from traders promising to help them get NAFDAC registration but disappearing after collecting. He has collected from at least 10 people.',
    receivedAt: '2026-03-23T11:30:00Z',
    status: 'new',
    riskScore: 78,
    language: 'en',
    attachments: 2,
    linkedSubject: undefined,
  },
  {
    id: 'rpt_002',
    channel: 'ussd',
    sender: '+2347098765432',
    content: 'USSD Report: Suspect=Bola Tinubu-Adeola, Location=Ikeja Lagos, Crime=Land fraud, Amount=2500000 NGN',
    receivedAt: '2026-03-23T10:15:00Z',
    status: 'processing',
    riskScore: 65,
    language: 'en',
    attachments: 0,
    linkedSubject: 'BIS-2026-0039',
  },
  {
    id: 'rpt_003',
    channel: 'sms',
    sender: '+2348055443322',
    content: 'Oga dis person wey I dey report na Fatima Abubakar for Kano. She dey use fake BVN to open account collect loan run away. Her phone number na 08033221144',
    receivedAt: '2026-03-23T09:45:00Z',
    status: 'verified',
    riskScore: 82,
    language: 'pidgin',
    attachments: 0,
    linkedSubject: undefined,
  },
  {
    id: 'rpt_004',
    channel: 'telegram',
    sender: '@anonymous_reporter_ng',
    content: 'Sharing evidence of a Ponzi scheme operating through a WhatsApp group called "Guaranteed Returns NG". Admin is known as "Alhaji Profits". Screenshots attached.',
    receivedAt: '2026-03-23T08:00:00Z',
    status: 'new',
    riskScore: 91,
    language: 'en',
    attachments: 5,
    linkedSubject: undefined,
  },
];

// ─── Channel Config ───────────────────────────────────────────────────────────

const CHANNEL_CONFIG: Record<Channel, { icon: string; color: string; label: string; description: string }> = {
  whatsapp: {
    icon: '💬',
    color: 'bg-green-500',
    label: 'WhatsApp Business',
    description: 'Receive reports via WhatsApp. Supports text, images, voice notes, and documents.',
  },
  telegram: {
    icon: '✈️',
    color: 'bg-blue-500',
    label: 'Telegram Bot',
    description: 'Anonymous reporting via Telegram bot. Supports media and document uploads.',
  },
  ussd: {
    icon: '📟',
    color: 'bg-purple-500',
    label: 'USSD Gateway',
    description: 'Works on any phone without internet. Dial *347*BIS# to report. Powered by Africa\'s Talking.',
  },
  sms: {
    icon: '📱',
    color: 'bg-orange-500',
    label: 'SMS Gateway',
    description: 'Send reports via SMS to short code 34729. Works on all networks including MTN, Airtel, Glo.',
  },
};

const STATUS_CONFIG: Record<ReportStatus, { color: string; label: string }> = {
  new: { color: 'bg-blue-100 text-blue-700', label: 'New' },
  processing: { color: 'bg-yellow-100 text-yellow-700', label: 'Processing' },
  verified: { color: 'bg-green-100 text-green-700', label: 'Verified' },
  dismissed: { color: 'bg-gray-100 text-gray-500', label: 'Dismissed' },
};

// ─── Main Component ───────────────────────────────────────────────────────────

function MessagingChannelsPageInner() {
  const [activeTab, setActiveTab] = useState<'overview' | 'reports' | 'config' | 'ussd_flow'>('overview');
  const [reports, setReports] = useState<IncomingReport[]>(INCOMING_REPORTS);
  const [selectedReport, setSelectedReport] = useState<IncomingReport | null>(null);
  const [filterChannel, setFilterChannel] = useState<Channel | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<ReportStatus | 'all'>('all');

  const filteredReports = reports.filter(r => {
    if (filterChannel !== 'all' && r.channel !== filterChannel) return false;
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    return true;
  });

  const updateReportStatus = (id: string, status: ReportStatus) => {
    setReports(prev => prev.map(r => r.id === id ? { ...r, status } : r));
    setSelectedReport(null);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900">Reporting Channels</h1>
        <p className="text-sm text-gray-500">WhatsApp · Telegram · USSD · SMS</p>
      </div>

      {/* Tabs */}
      <div className="px-6 pt-4">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {(['overview', 'reports', 'config', 'ussd_flow'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition ${
                activeTab === tab ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.replace('_', ' ')}
              {tab === 'reports' && reports.filter(r => r.status === 'new').length > 0 && (
                <span className="ml-1 bg-red-500 text-white text-xs rounded-full px-1.5">
                  {reports.filter(r => r.status === 'new').length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 space-y-4">

        {/* ── Overview Tab ── */}
        {activeTab === 'overview' && (
          <>
            <div className="grid grid-cols-2 gap-4">
              {CHANNEL_STATS.map(stat => {
                const config = CHANNEL_CONFIG[stat.channel];
                return (
                  <div key={stat.channel} className="bg-white rounded-xl border p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 ${config.color} rounded-lg flex items-center justify-center text-white text-sm`}>
                          {config.icon}
                        </div>
                        <span className="font-medium text-sm text-gray-800">{config.label}</span>
                      </div>
                      <span className={`w-2 h-2 rounded-full ${stat.isOnline ? 'bg-green-500' : 'bg-red-500'}`} />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-gray-400">Total Reports</p>
                        <p className="font-bold text-gray-800">{stat.totalReports.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-gray-400">Today</p>
                        <p className="font-bold text-green-600">+{stat.todayReports}</p>
                      </div>
                      <div>
                        <p className="text-gray-400">Verified</p>
                        <p className="font-bold text-blue-600">{stat.verifiedReports.toLocaleString()}</p>
                      </div>
                      {stat.activeUsers > 0 && (
                        <div>
                          <p className="text-gray-400">Active Users</p>
                          <p className="font-bold text-purple-600">{stat.activeUsers}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* How to Report Instructions */}
            <div className="bg-white rounded-xl border p-4">
              <h3 className="font-semibold text-gray-800 mb-3">How to Report</h3>
              <div className="space-y-3">
                <div className="flex gap-3">
                  <span className="text-xl">💬</span>
                  <div>
                    <p className="text-sm font-medium">WhatsApp</p>
                    <p className="text-xs text-gray-500">Send a message to <strong>+234 800 BIS REPORT</strong> or scan the QR code</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="text-xl">✈️</span>
                  <div>
                    <p className="text-sm font-medium">Telegram</p>
                    <p className="text-xs text-gray-500">Message <strong>@BISReportBot</strong> — anonymous reporting supported</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="text-xl">📟</span>
                  <div>
                    <p className="text-sm font-medium">USSD (No Internet Required)</p>
                    <p className="text-xs text-gray-500">Dial <strong>*347*247#</strong> on any phone — works on MTN, Airtel, Glo, 9mobile</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="text-xl">📱</span>
                  <div>
                    <p className="text-sm font-medium">SMS</p>
                    <p className="text-xs text-gray-500">Send to short code <strong>34729</strong> — format: REPORT [Name] [Location] [Description]</p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Reports Tab ── */}
        {activeTab === 'reports' && (
          <>
            {/* Filters */}
            <div className="flex gap-3">
              <select
                value={filterChannel}
                onChange={e => setFilterChannel(e.target.value as any)}
                className="border rounded-lg px-3 py-1.5 text-sm bg-white"
              >
                <option value="all">All Channels</option>
                {Object.entries(CHANNEL_CONFIG).map(([key, val]) => (
                  <option key={key} value={key}>{val.icon} {val.label}</option>
                ))}
              </select>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value as any)}
                className="border rounded-lg px-3 py-1.5 text-sm bg-white"
              >
                <option value="all">All Statuses</option>
                {Object.entries(STATUS_CONFIG).map(([key, val]) => (
                  <option key={key} value={key}>{val.label}</option>
                ))}
              </select>
            </div>

            {/* Report List */}
            <div className="space-y-3">
              {filteredReports.map(report => {
                const channel = CHANNEL_CONFIG[report.channel];
                const status = STATUS_CONFIG[report.status];
                return (
                  <div
                    key={report.id}
                    className="bg-white border rounded-xl p-4 cursor-pointer hover:border-green-300 transition"
                    onClick={() => setSelectedReport(report)}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${channel.color} text-white`}>
                          {channel.icon} {channel.label}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs ${status.color}`}>
                          {status.label}
                        </span>
                        {report.language === 'pidgin' && (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-700">
                            🇳🇬 Pidgin
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {report.attachments > 0 && (
                          <span className="text-xs text-gray-400">📎 {report.attachments}</span>
                        )}
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                          report.riskScore >= 80 ? 'bg-red-100 text-red-700' :
                          report.riskScore >= 60 ? 'bg-orange-100 text-orange-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {report.riskScore}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-700 line-clamp-2">{report.content}</p>
                    <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
                      <span>{report.sender}</span>
                      <span>{new Date(report.receivedAt).toLocaleString()}</span>
                    </div>
                    {report.linkedSubject && (
                      <div className="mt-2">
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                          🔗 Linked: {report.linkedSubject}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Report Detail Modal */}
            {selectedReport && (
              <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50" onClick={() => setSelectedReport(null)}>
                <div className="bg-white rounded-t-2xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-gray-900">Report Details</h3>
                    <button onClick={() => setSelectedReport(null)} className="text-gray-400 text-xl">✕</button>
                  </div>

                  <div className="space-y-3">
                    <div className="bg-gray-50 rounded-xl p-4">
                      <p className="text-sm text-gray-700">{selectedReport.content}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-gray-400 text-xs">Channel</p>
                        <p className="font-medium">{CHANNEL_CONFIG[selectedReport.channel].label}</p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs">Sender</p>
                        <p className="font-medium">{selectedReport.sender}</p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs">Risk Score</p>
                        <p className="font-bold text-orange-600">{selectedReport.riskScore}/100</p>
                      </div>
                      <div>
                        <p className="text-gray-400 text-xs">Language</p>
                        <p className="font-medium capitalize">{selectedReport.language}</p>
                      </div>
                    </div>

                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => updateReportStatus(selectedReport.id, 'processing')}
                        className="flex-1 bg-blue-600 text-white py-2 rounded-xl text-sm font-medium"
                      >
                        Start Investigation
                      </button>
                      <button
                        onClick={() => updateReportStatus(selectedReport.id, 'verified')}
                        className="flex-1 bg-green-600 text-white py-2 rounded-xl text-sm font-medium"
                      >
                        Mark Verified
                      </button>
                      <button
                        onClick={() => updateReportStatus(selectedReport.id, 'dismissed')}
                        className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm font-medium"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Config Tab ── */}
        {activeTab === 'config' && (
          <div className="space-y-4">
            {/* WhatsApp Config */}
            <div className="bg-white border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">💬</span>
                <h3 className="font-semibold">WhatsApp Business API</h3>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500">Phone Number ID</label>
                  <input type="text" placeholder="Enter WhatsApp Phone Number ID" className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Access Token</label>
                  <input type="password" placeholder="Meta Business API Token" className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Webhook Verify Token</label>
                  <input type="text" placeholder="Your webhook verification token" className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
                <button className="w-full bg-green-600 text-white py-2 rounded-xl text-sm font-medium">
                  Save WhatsApp Config
                </button>
              </div>
            </div>

            {/* Telegram Config */}
            <div className="bg-white border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">✈️</span>
                <h3 className="font-semibold">Telegram Bot</h3>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500">Bot Token</label>
                  <input type="password" placeholder="Telegram Bot API Token" className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="anon" className="rounded" defaultChecked />
                  <label htmlFor="anon" className="text-sm text-gray-600">Allow anonymous reporting</label>
                </div>
                <button className="w-full bg-blue-600 text-white py-2 rounded-xl text-sm font-medium">
                  Save Telegram Config
                </button>
              </div>
            </div>

            {/* USSD Config */}
            <div className="bg-white border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">📟</span>
                <h3 className="font-semibold">USSD Gateway (Africa's Talking)</h3>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500">Africa's Talking API Key</label>
                  <input type="password" placeholder="AT API Key" className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">USSD Short Code</label>
                  <input type="text" placeholder="e.g. *347*247#" className="w-full border rounded-lg px-3 py-2 text-sm mt-1" defaultValue="*347*247#" />
                </div>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-700">
                  ⚠️ USSD sessions are limited to 182 characters per screen. The BIS USSD flow uses 5 screens to collect a complete report.
                </div>
                <button className="w-full bg-purple-600 text-white py-2 rounded-xl text-sm font-medium">
                  Save USSD Config
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── USSD Flow Tab ── */}
        {activeTab === 'ussd_flow' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">Preview the USSD menu flow that reporters experience when they dial *347*247#</p>

            {[
              {
                screen: 1,
                title: 'Welcome Screen',
                content: 'CON Welcome to BIS Report\n\n1. Report a Person\n2. Report a Business\n3. Check Report Status\n4. Emergency (EFCC Hotline)',
              },
              {
                screen: 2,
                title: 'Subject Name',
                content: 'CON Enter the full name of the person or business you are reporting:\n\n(Type name and press Send)',
              },
              {
                screen: 3,
                title: 'Location',
                content: 'CON Enter the location (State and LGA):\n\n1. Lagos\n2. Abuja\n3. Kano\n4. Rivers\n5. Ogun\n6. Other (type name)',
              },
              {
                screen: 4,
                title: 'Crime Type',
                content: 'CON Select the type of crime:\n\n1. Financial Fraud\n2. Land/Property Fraud\n3. Identity Theft\n4. Employment Scam\n5. Other',
              },
              {
                screen: 5,
                title: 'Confirmation',
                content: 'END Thank you for your report.\n\nReference: BIS-RPT-2026-4821\n\nYour report is being reviewed. You will receive an SMS update within 24 hours.\n\nFor emergencies call: 0800-EFCC-NOW',
              },
            ].map(screen => (
              <div key={screen.screen} className="bg-white border rounded-xl overflow-hidden">
                <div className="bg-gray-800 text-white px-4 py-2 flex items-center justify-between">
                  <span className="text-xs font-mono">Screen {screen.screen}: {screen.title}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    screen.content.startsWith('CON') ? 'bg-blue-500' : 'bg-green-500'
                  }`}>
                    {screen.content.startsWith('CON') ? 'CONTINUE' : 'END'}
                  </span>
                </div>
                <div className="p-4 bg-gray-900">
                  <pre className="text-green-400 text-xs font-mono whitespace-pre-wrap">
                    {screen.content}
                  </pre>
                </div>
              </div>
            ))}

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
              <p className="font-medium mb-1">📡 Network Coverage</p>
              <p className="text-xs">This USSD code is registered on MTN, Airtel, Glo, and 9mobile Nigeria. Works in all 36 states including rural areas with 2G coverage.</p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}


export default function MessagingChannelsPage() {
  return (
    <BISLayout>
      <MessagingChannelsPageInner />
    </BISLayout>
  );
}
