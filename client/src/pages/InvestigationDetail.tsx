// InvestigationDetail — full investigation view with Evidence timeline tab
// Design: Forensic Intelligence Dark theme, JetBrains Mono typography

import { useState, useRef } from "react";
import { useLocation, useParams } from "wouter";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ArrowLeft, User, Building2, AlertTriangle, CheckCircle2,
  Clock, Loader2, FileText, Download, RefreshCw, Trash2,
  Shield, Activity, Globe, CreditCard, Fingerprint, Search,
  Link2, MessageSquare, Send, Camera, Paperclip, MapPin, X,
  ChevronDown
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  mockInvestigations, mockAlerts, getStatusBadgeClass, formatDateTime, formatDate
} from "@/lib/mockData";
import { cn } from "@/lib/utils";

// ─── Static module data ───────────────────────────────────────────────────────

const moduleIcons: Record<string, React.ReactNode> = {
  identity: <Fingerprint size={13} />,
  criminal: <Shield size={13} />,
  financial: <CreditCard size={13} />,
  employment: <User size={13} />,
  sanctions: <AlertTriangle size={13} />,
  social_media: <Globe size={13} />,
  directors: <Building2 size={13} />,
};

const moduleLabels: Record<string, string> = {
  identity: "Identity Verification",
  criminal: "Criminal Records",
  financial: "Financial Health",
  employment: "Employment History",
  sanctions: "Sanctions & PEP",
  social_media: "Social Media Analysis",
  directors: "Director Bundle",
};

const moduleResults: Record<string, { status: "pass" | "fail" | "warn" | "pending"; detail: string; source: string }> = {
  identity: { status: "pass", detail: "NIN verified via NIMC. BVN cross-referenced. Photo match 97.8%.", source: "NIMC / CBN" },
  criminal: { status: "warn", detail: "NPF POSSAP: 1 record found (2019 fraud charge, acquitted). EFCC: No active watchlist entry.", source: "NPF / EFCC" },
  financial: { status: "warn", detail: "CRC credit score: 512/850. 2 delinquent accounts (2021). FIRS: Tax compliance verified.", source: "CRC / FIRS" },
  employment: { status: "pass", detail: "NYSC certificate verified. Last employer confirmed via phone. 3-year gap unexplained.", source: "NYSC / Manual" },
  sanctions: { status: "fail", detail: "OFAC SDN list match detected — 94% confidence. UN Consolidated list: No match.", source: "OFAC / UN" },
  social_media: { status: "warn", detail: "3 adverse media mentions in Punch (2024). LinkedIn profile consistent. No extremist associations.", source: "Social Monitor" },
  directors: { status: "pass", detail: "2 directors investigated. Both cleared. No cross-directorship with sanctioned entities.", source: "CAC / BIS" },
};

const processingTimeline = [
  { time: "2026-03-10T08:00:00Z", event: "Investigation created", actor: "API", type: "info" },
  { time: "2026-03-10T08:01:00Z", event: "Identity module started — NIMC NIN lookup", actor: "AI Engine", type: "info" },
  { time: "2026-03-10T08:01:45Z", event: "Identity verified — NIN match confirmed", actor: "AI Engine", type: "success" },
  { time: "2026-03-10T08:02:00Z", event: "Criminal records module started — NPF POSSAP query", actor: "AI Engine", type: "info" },
  { time: "2026-03-10T08:03:12Z", event: "Criminal record found — 2019 fraud charge (acquitted)", actor: "AI Engine", type: "warning" },
  { time: "2026-03-10T08:04:00Z", event: "Sanctions module started — OFAC SDN list query", actor: "AI Engine", type: "info" },
  { time: "2026-03-10T08:04:08Z", event: "SANCTIONS HIT — OFAC SDN match at 94% confidence", actor: "AI Engine", type: "error" },
  { time: "2026-03-10T08:04:09Z", event: "Kill switch activated for subject", actor: "System", type: "error" },
  { time: "2026-03-10T08:04:10Z", event: "Alert dispatched to tenant webhook", actor: "System", type: "info" },
  { time: "2026-03-12T14:30:00Z", event: "Analyst note added: Confirmed sanctions match, escalated to compliance team", actor: "analyst@bis.io", type: "note" },
];

// ─── Evidence items ───────────────────────────────────────────────────────────

type EvidenceType = 'social_mention' | 'incoming_report' | 'field_task' | 'analyst_note' | 'alert';

interface EvidenceItem {
  id: string;
  type: EvidenceType;
  timestamp: string;
  title: string;
  body: string;
  source?: string;
  attachments?: number;
  linkedBy?: string;
  riskScore?: number;
  status?: string;
  location?: string;
}

const MOCK_EVIDENCE: EvidenceItem[] = [
  {
    id: 'ev1', type: 'alert', timestamp: '2026-03-20T09:00:00Z',
    title: 'OFAC SDN List Match — 94% Confidence',
    body: 'Subject appears on OFAC Specially Designated Nationals list under Executive Order 13224. Automated kill-switch triggered.',
    source: 'OFAC SDN API', riskScore: 94, status: 'escalated',
  },
  {
    id: 'ev2', type: 'social_mention', timestamp: '2026-03-19T14:30:00Z',
    title: 'Adverse Media — Punch Newspaper',
    body: 'Subject mentioned in investigative report on procurement fraud at Lagos State Ministry of Works. Article by Segun Adeyemi. Engagement: 1,247 reactions.',
    source: '@PunchNigeria', riskScore: 78, linkedBy: 'analyst@bis.io',
  },
  {
    id: 'ev3', type: 'incoming_report', timestamp: '2026-03-19T10:15:00Z',
    title: 'WhatsApp Report — Land Fraud Allegation',
    body: 'Anonymous report via WhatsApp: Subject allegedly sold same plot of land in Lekki Phase 1 to 3 different buyers. Documents attached. Reporter claims to be one of the victims.',
    source: '+234 801 *** 5678', attachments: 3, riskScore: 82,
  },
  {
    id: 'ev4', type: 'field_task', timestamp: '2026-03-18T16:00:00Z',
    title: 'Address Verification — Completed',
    body: 'Field agent FA-NG-0142 (Adebayo Ogundimu) confirmed subject\'s residential address at 14B Bourdillon Road, Ikoyi, Lagos. Subject was present. 4 photographs taken. GPS-signed proof attached.',
    source: 'FA-NG-0142', attachments: 4, status: 'completed', location: 'Ikoyi, Lagos',
  },
  {
    id: 'ev5', type: 'social_mention', timestamp: '2026-03-17T08:45:00Z',
    title: 'Twitter/X Mention — @lagosinsider',
    body: 'Thread by @lagosinsider (12.4K followers) alleging subject is connected to a procurement cartel. Thread has 847 retweets and 2,341 likes. Sentiment: Critical.',
    source: '@lagosinsider', riskScore: 71, linkedBy: 'social_monitor_ai',
  },
  {
    id: 'ev6', type: 'incoming_report', timestamp: '2026-03-16T13:20:00Z',
    title: 'USSD Report — Fraud Allegation',
    body: 'USSD session report: Subject collected ₦2.5M from reporter claiming to facilitate government contract. No contract materialised. Reporter filed formal complaint.',
    source: 'USSD *347*BIS#', riskScore: 75,
  },
  {
    id: 'ev7', type: 'analyst_note', timestamp: '2026-03-15T11:00:00Z',
    title: 'Analyst Note — Cross-reference with BIS-2026-0002',
    body: 'Subject appears to share a registered address with Zenith Logistics Ltd (BIS-2026-0002). Director cross-check in progress. Possible shell company relationship.',
    linkedBy: 'senior_analyst@bis.io',
  },
  {
    id: 'ev8', type: 'field_task', timestamp: '2026-03-14T09:30:00Z',
    title: 'Employer Verification — Completed',
    body: 'Field agent FA-NG-0312 (Fatima Bello) conducted employer verification at Zenith House, Victoria Island. HR confirmed subject was employed 2019–2022. Departure was voluntary.',
    source: 'FA-NG-0312', status: 'completed', location: 'Victoria Island, Lagos',
  },
];

const EVIDENCE_TYPE_CONFIG: Record<EvidenceType, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  alert:           { label: 'ALERT',    color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/30',     icon: <AlertTriangle size={11} /> },
  social_mention:  { label: 'SOCIAL',   color: 'text-blue-400',    bg: 'bg-blue-500/10 border-blue-500/30',   icon: <MessageSquare size={11} /> },
  incoming_report: { label: 'REPORT',   color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/30', icon: <Send size={11} /> },
  field_task:      { label: 'FIELD',    color: 'text-violet-400',  bg: 'bg-violet-500/10 border-violet-500/30', icon: <MapPin size={11} /> },
  analyst_note:    { label: 'NOTE',     color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', icon: <FileText size={11} /> },
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function InvestigationDetail() {
  const [, navigate] = useLocation();
  const params = useParams<{ id: string }>();
  const inv = mockInvestigations.find(i => i.id === params.id) ?? mockInvestigations[0];
  const relatedAlerts = mockAlerts.filter(a => a.subjectRef === inv.ref);
  const [note, setNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const MENTION_USERS = [
    'analyst@bis.io', 'senior_analyst@bis.io', 'compliance@bis.io',
    'supervisor@bis.io', 'admin@bis.platform',
  ];

  const filteredMentions = mentionQuery !== null
    ? MENTION_USERS.filter(u => u.toLowerCase().includes(mentionQuery.toLowerCase()))
    : [];

  const handleNoteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNote(val);
    const cursor = e.target.selectionStart ?? val.length;
    const textBefore = val.slice(0, cursor);
    const atIdx = textBefore.lastIndexOf('@');
    if (atIdx !== -1 && !textBefore.slice(atIdx + 1).includes(' ')) {
      setMentionQuery(textBefore.slice(atIdx + 1));
      setMentionStart(atIdx);
    } else {
      setMentionQuery(null);
    }
  };

  const insertMention = (user: string) => {
    const cursor = noteRef.current?.selectionStart ?? note.length;
    const before = note.slice(0, mentionStart);
    const after = note.slice(cursor);
    const newNote = `${before}@${user} ${after}`;
    setNote(newNote);
    setMentionQuery(null);
    toast.info(`@${user} will be notified when this note is saved`);
    setTimeout(() => noteRef.current?.focus(), 0);
  };
  const [activeTab, setActiveTab] = useState<'overview' | 'evidence' | 'timeline'>('overview');
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>(MOCK_EVIDENCE);
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceType | 'all'>('all');
  const [currentStatus, setCurrentStatus] = useState<string>(inv.status);
  const [assignedTo, setAssignedTo] = useState<string>(inv.assignedTo ?? 'analyst@bis.io');

  const ANALYSTS = [
    'analyst@bis.io',
    'senior_analyst@bis.io',
    'compliance@bis.io',
    'supervisor@bis.io',
    'admin@bis.platform',
  ];

  const handleAssign = (newAnalyst: string) => {
    const prev = assignedTo;
    if (prev === newAnalyst) return;
    setAssignedTo(newAnalyst);
    const assignNote: EvidenceItem = {
      id: `assign_${Date.now()}`,
      type: 'analyst_note',
      timestamp: new Date().toISOString(),
      title: `Reassigned: ${prev} → ${newAnalyst}`,
      body: `Investigation reassigned from ${prev} to ${newAnalyst} by supervisor@bis.io`,
      linkedBy: 'supervisor@bis.io',
    };
    setEvidenceItems(p => [assignNote, ...p]);
    toast.success(`Assigned to ${newAnalyst}`);
  };

  const STATUS_FLOW: Record<string, { label: string; color: string; transitions: string[] }> = {
    draft:      { label: 'Draft',      color: 'text-muted-foreground', transitions: ['pending', 'cancelled'] },
    pending:    { label: 'Pending',    color: 'text-amber-500',        transitions: ['processing', 'cancelled'] },
    processing: { label: 'Processing', color: 'text-blue-400',         transitions: ['completed', 'flagged', 'pending'] },
    completed:  { label: 'Completed',  color: 'text-emerald-500',      transitions: ['processing', 'archived'] },
    flagged:    { label: 'Flagged',    color: 'text-red-500',          transitions: ['processing', 'completed', 'archived'] },
    archived:   { label: 'Archived',   color: 'text-muted-foreground', transitions: ['pending'] },
    cancelled:  { label: 'Cancelled',  color: 'text-muted-foreground', transitions: ['pending'] },
  };

  const handleStatusChange = (newStatus: string) => {
    const prev = currentStatus;
    setCurrentStatus(newStatus);
    const statusNote: EvidenceItem = {
      id: `status_${Date.now()}`,
      type: 'analyst_note',
      timestamp: new Date().toISOString(),
      title: `Status changed: ${STATUS_FLOW[prev]?.label ?? prev} → ${STATUS_FLOW[newStatus]?.label ?? newStatus}`,
      body: `Investigation status updated from "${STATUS_FLOW[prev]?.label ?? prev}" to "${STATUS_FLOW[newStatus]?.label ?? newStatus}" by analyst@bis.io`,
      linkedBy: 'analyst@bis.io',
    };
    setEvidenceItems(p => [statusNote, ...p]);
    toast.success(`Status updated to ${STATUS_FLOW[newStatus]?.label ?? newStatus}`);
  };

  const riskColor = inv.riskScore >= 80 ? "#f87171" : inv.riskScore >= 60 ? "#fb923c" : inv.riskScore >= 30 ? "#fbbf24" : "#34d399";

  const handleAddNote = async () => {
    if (!note.trim()) return;
    setAddingNote(true);
    await new Promise(r => setTimeout(r, 800));
    const newItem: EvidenceItem = {
      id: `note_${Date.now()}`,
      type: 'analyst_note',
      timestamp: new Date().toISOString(),
      title: 'Analyst Note',
      body: note.trim(),
      linkedBy: 'analyst@bis.io',
    };
    setEvidenceItems(prev => [newItem, ...prev]);
    setAddingNote(false);
    setNote("");
    toast.success("Note added to investigation evidence log");
  };

  const handleDownloadReport = () => {
    toast.success("Report download started — PDF generating...");
  };

  const handleRerun = () => {
    toast.info("Investigation re-queued for processing");
  };

  const filteredEvidence = evidenceItems.filter(e =>
    evidenceFilter === 'all' || e.type === evidenceFilter
  );

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
      title={inv.ref}
      subtitle={inv.subjectName}
      actions={
        <div className="flex items-center gap-2">
          <Select value={assignedTo} onValueChange={handleAssign}>
            <SelectTrigger className="h-7 w-40 text-xs">
              <span className="font-mono text-xs text-muted-foreground truncate">{assignedTo.split('@')[0]}</span>
            </SelectTrigger>
            <SelectContent>
              {ANALYSTS.map(a => (
                <SelectItem key={a} value={a}>
                  <span className="font-mono text-xs">{a}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={currentStatus} onValueChange={handleStatusChange}>
            <SelectTrigger className="h-7 w-36 text-xs">
              <span className={cn("font-mono text-xs", STATUS_FLOW[currentStatus]?.color ?? 'text-foreground')}>
                {STATUS_FLOW[currentStatus]?.label ?? currentStatus}
              </span>
            </SelectTrigger>
            <SelectContent>
              {/* Current status always shown */}
              <SelectItem value={currentStatus}>
                <span className={cn("font-mono text-xs", STATUS_FLOW[currentStatus]?.color)}>
                  {STATUS_FLOW[currentStatus]?.label ?? currentStatus} (current)
                </span>
              </SelectItem>
              {(STATUS_FLOW[currentStatus]?.transitions ?? []).map(t => (
                <SelectItem key={t} value={t}>
                  <span className={cn("font-mono text-xs", STATUS_FLOW[t]?.color)}>
                    → {STATUS_FLOW[t]?.label ?? t}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleRerun}>
            <RefreshCw size={11} /> Re-run
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleDownloadReport}>
            <Download size={11} /> Report
          </Button>
        </div>
      }
    >
      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 mb-4 -ml-1" onClick={() => navigate("/investigations")}>
        <ArrowLeft size={12} /> Back to Investigations
      </Button>

      {/* Subject card — always visible */}
      <div className="bis-card p-4 mb-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            {inv.subjectType === "individual" ? <User size={20} className="text-primary" /> : <Building2 size={20} className="text-primary" />}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-foreground">{inv.subjectName}</h2>
              <span className={`bis-badge ${getStatusBadgeClass(inv.status)}`}>{inv.status}</span>
              {inv.tags.map(tag => (
                <Badge key={tag} variant="outline" className="text-[10px] h-4 px-1.5 border-red-500/30 text-red-400">{tag}</Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
              <span className="capitalize">{inv.subjectType}</span>
              <span>·</span>
              <span className="font-mono">{inv.ref}</span>
              <span>·</span>
              <span className="capitalize">{inv.tier} tier</span>
              <span>·</span>
              <span>{inv.country}</span>
            </div>
            <div className="flex flex-wrap gap-4 mt-1 text-xs text-muted-foreground">
              <span>Created: {formatDate(inv.createdAt)}</span>
              <span>Updated: {formatDateTime(inv.updatedAt)}</span>
              <span>Assigned: {inv.assignedTo}</span>
            </div>
          </div>
          <div className="text-center shrink-0">
            <div className="text-3xl font-bold font-mono" style={{ color: riskColor }}>{inv.riskScore}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Risk Score</div>
            <div className="text-xs capitalize font-medium mt-0.5" style={{ color: riskColor }}>{inv.riskLevel}</div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {([
          { id: 'overview', label: 'Overview' },
          { id: 'evidence', label: `Evidence (${evidenceItems.length})` },
          { id: 'timeline', label: 'Processing Log' },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2 text-xs font-mono transition-all border-b-2 -mb-px",
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            {/* Module results */}
            <div className="bis-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Activity size={14} className="text-primary" /> Investigation Modules
              </h3>
              <div className="space-y-2">
                {inv.dataSources.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No modules run yet — investigation is pending.</p>
                ) : (
                  inv.dataSources.map((mod: string) => {
                    const result = moduleResults[mod] ?? { status: "pass", detail: "Module completed.", source: "BIS" };
                    const statusColor = result.status === "pass" ? "text-emerald-400" : result.status === "fail" ? "text-red-400" : result.status === "warn" ? "text-amber-400" : "text-muted-foreground";
                    const statusIcon = result.status === "pass" ? <CheckCircle2 size={12} /> : result.status === "fail" ? <AlertTriangle size={12} /> : result.status === "warn" ? <AlertTriangle size={12} /> : <Clock size={12} />;
                    return (
                      <div key={mod} className="flex items-start gap-3 p-3 rounded-lg bg-muted/20 border border-border/50">
                        <div className={`mt-0.5 ${statusColor}`}>{moduleIcons[mod] ?? <Search size={13} />}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground">{moduleLabels[mod] ?? mod}</span>
                            <span className={`text-[10px] font-mono ${statusColor}`}>{result.source}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{result.detail}</p>
                        </div>
                        <div className={`shrink-0 ${statusColor}`}>{statusIcon}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Alerts */}
            {relatedAlerts.length > 0 && (
              <div className="bis-card p-4">
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <AlertTriangle size={14} className="text-red-400" /> Active Alerts ({relatedAlerts.length})
                </h3>
                <div className="space-y-2">
                  {relatedAlerts.map(alert => (
                    <div key={alert.id} className="flex items-start gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                      <AlertTriangle size={13} className="text-red-400 mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-red-400 uppercase">{alert.alertType.replace("_", " ")}</span>
                          <span className="text-[10px] text-muted-foreground">{alert.source}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{alert.summary}</p>
                      </div>
                      <span className={`bis-badge ${getStatusBadgeClass(alert.status)} shrink-0`}>{alert.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add note */}
            <div className="bis-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <FileText size={14} className="text-primary" /> Add Note to Evidence Log
              </h3>
              <div className="relative">
                <Textarea
                  ref={noteRef}
                  placeholder="Add analyst notes, context, or follow-up actions... (type @ to mention)"
                  rows={3} value={note} onChange={handleNoteChange}
                  className="text-sm resize-none"
                />
                {filteredMentions.length > 0 && (
                  <div className="absolute left-0 bottom-full mb-1 z-50 w-64 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
                    <div className="px-2 py-1 border-b border-border">
                      <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Mention analyst</span>
                    </div>
                    {filteredMentions.map(u => (
                      <button
                        key={u}
                        className="w-full text-left px-3 py-1.5 text-xs font-mono text-foreground hover:bg-muted/50 transition-colors flex items-center gap-2"
                        onMouseDown={e => { e.preventDefault(); insertMention(u); }}
                      >
                        <span className="text-primary">@</span>{u}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex justify-end mt-2">
                <Button size="sm" className="h-7 text-xs" onClick={handleAddNote} disabled={addingNote || !note.trim()}>
                  {addingNote ? <><Loader2 size={11} className="animate-spin mr-1" />Saving...</> : "Add to Evidence"}
                </Button>
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-4">
            {/* Data sources */}
            <div className="bis-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Globe size={14} className="text-primary" /> Data Sources
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {inv.dataSources.length > 0 ? inv.dataSources.map(src => (
                  <Badge key={src} variant="outline" className="text-[10px] h-5 px-2 font-mono">{src}</Badge>
                )) : <span className="text-xs text-muted-foreground">None yet</span>}
              </div>
            </div>

            {/* Evidence summary */}
            <div className="bis-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Link2 size={14} className="text-primary" /> Evidence Summary
              </h3>
              <div className="space-y-2">
                {(Object.entries(EVIDENCE_TYPE_CONFIG) as [EvidenceType, typeof EVIDENCE_TYPE_CONFIG.alert][]).map(([type, cfg]) => {
                  const count = evidenceItems.filter(e => e.type === type).length;
                  if (count === 0) return null;
                  return (
                    <button
                      key={type}
                      onClick={() => { setActiveTab('evidence'); setEvidenceFilter(type); }}
                      className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-muted/20 transition-colors"
                    >
                      <span className={cn("flex items-center gap-2 text-xs font-mono", cfg.color)}>
                        {cfg.icon} {cfg.label}
                      </span>
                      <span className={cn("text-xs font-mono font-bold rounded px-2 py-0.5 border", cfg.bg, cfg.color)}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Evidence Tab ── */}
      {activeTab === 'evidence' && (
        <>
          {/* Filter row */}
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => setEvidenceFilter('all')}
              className={cn("px-3 py-1.5 rounded-md border text-[10px] font-mono transition-all",
                evidenceFilter === 'all' ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              All ({evidenceItems.length})
            </button>
            {(Object.entries(EVIDENCE_TYPE_CONFIG) as [EvidenceType, typeof EVIDENCE_TYPE_CONFIG.alert][]).map(([type, cfg]) => {
              const count = evidenceItems.filter(e => e.type === type).length;
              if (count === 0) return null;
              return (
                <button
                  key={type}
                  onClick={() => setEvidenceFilter(type)}
                  className={cn("px-3 py-1.5 rounded-md border text-[10px] font-mono transition-all flex items-center gap-1.5",
                    evidenceFilter === type ? `${cfg.bg} ${cfg.color} border-current` : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {cfg.icon} {cfg.label} ({count})
                </button>
              );
            })}
          </div>

          {/* Evidence timeline */}
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-5 top-0 bottom-0 w-px bg-border/50" />

            <div className="space-y-3">
              {filteredEvidence.map((item, idx) => {
                const cfg = EVIDENCE_TYPE_CONFIG[item.type];
                return (
                  <div key={item.id} className="flex gap-4 relative">
                    {/* Timeline dot */}
                    <div className={cn(
                      "w-10 h-10 rounded-full border-2 flex items-center justify-center flex-shrink-0 z-10",
                      cfg.bg, cfg.color, "border-current"
                    )}>
                      {cfg.icon}
                    </div>

                    {/* Card */}
                    <div className="flex-1 bis-card p-4 mb-1">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn("text-[9px] font-mono font-bold rounded px-1.5 py-0.5 border", cfg.bg, cfg.color)}>
                              {cfg.label}
                            </span>
                            <span className="text-sm font-mono font-semibold text-foreground">{item.title}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-muted-foreground flex-wrap">
                            {item.source && <span>{item.source}</span>}
                            {item.source && <span>·</span>}
                            <span>{timeAgo(item.timestamp)}</span>
                            <span>·</span>
                            <span>{formatDateTime(item.timestamp)}</span>
                            {item.linkedBy && <><span>·</span><span>Linked by {item.linkedBy}</span></>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {item.riskScore !== undefined && (
                            <span className={cn("text-xs font-mono font-bold",
                              item.riskScore >= 80 ? 'text-red-400' : item.riskScore >= 60 ? 'text-amber-400' : 'text-emerald-400'
                            )}>
                              Risk {item.riskScore}
                            </span>
                          )}
                          {item.status && (
                            <span className="text-[9px] font-mono text-muted-foreground border border-border/50 rounded px-1.5 py-0.5 capitalize">
                              {item.status}
                            </span>
                          )}
                        </div>
                      </div>

                       <p className="text-sm text-foreground/85 leading-relaxed">
                         {item.body?.split(/(@[\w.@]+)/g).map((part, pi) =>
                           part.match(/^@[\w.@]+$/) ? (
                             <span key={pi} className="inline-flex items-center gap-0.5 bg-primary/10 text-primary border border-primary/20 rounded px-1 py-0.5 text-[11px] font-mono">
                               {part}
                             </span>
                           ) : part
                         )}
                       </p>

                      <div className="flex items-center gap-3 mt-2">
                        {item.attachments && item.attachments > 0 && (
                          <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                            <Paperclip size={9} /> {item.attachments} attachment{item.attachments > 1 ? 's' : ''}
                          </span>
                        )}
                        {item.location && (
                          <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                            <MapPin size={9} /> {item.location}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {filteredEvidence.length === 0 && (
                <div className="bis-card p-12 text-center ml-14">
                  <Link2 size={32} className="mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">No evidence items match this filter.</p>
                </div>
              )}
            </div>
          </div>

          {/* Quick add note */}
          <div className="bis-card p-4 mt-4 ml-14">
            <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <FileText size={11} /> Add Analyst Note to Evidence
            </h3>
            <div className="relative">
              <Textarea
                ref={noteRef}
                placeholder="Add context, findings, or follow-up actions... (type @ to mention)"
                rows={2} value={note} onChange={handleNoteChange}
                className="text-sm resize-none"
              />
              {filteredMentions.length > 0 && (
                <div className="absolute left-0 bottom-full mb-1 z-50 w-64 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
                  <div className="px-2 py-1 border-b border-border">
                    <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Mention analyst</span>
                  </div>
                  {filteredMentions.map(u => (
                    <button
                      key={u}
                      className="w-full text-left px-3 py-1.5 text-xs font-mono text-foreground hover:bg-muted/50 transition-colors flex items-center gap-2"
                      onMouseDown={e => { e.preventDefault(); insertMention(u); }}
                    >
                      <span className="text-primary">@</span>{u}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end mt-2">
              <Button size="sm" className="h-7 text-xs" onClick={handleAddNote} disabled={addingNote || !note.trim()}>
                {addingNote ? <><Loader2 size={11} className="animate-spin mr-1" />Saving...</> : "Add Note"}
              </Button>
            </div>
          </div>
        </>
      )}

      {/* ── Processing Log Tab ── */}
      {activeTab === 'timeline' && (
        <div className="max-w-2xl space-y-2">
          {processingTimeline.map((event, i) => {
            const color = event.type === "error" ? "text-red-400 bg-red-500/10 border-red-500/20"
              : event.type === "warning" ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
              : event.type === "success" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
              : event.type === "note" ? "text-blue-400 bg-blue-500/10 border-blue-500/20"
              : "text-muted-foreground bg-muted/20 border-border/50";
            return (
              <div key={i} className={`p-3 rounded-lg border text-xs ${color}`}>
                <div className="font-mono font-semibold">{event.event}</div>
                <div className="flex items-center gap-2 mt-1 opacity-70">
                  <span>{event.actor}</span>
                  <span>·</span>
                  <span className="font-mono">{formatDateTime(event.time)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </BISLayout>
  );
}
