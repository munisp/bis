// InvestigationDetail — full investigation view with Evidence timeline tab
// Design: Forensic Intelligence Dark theme, JetBrains Mono typography

import { useState, useRef, useMemo } from "react";
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
  ChevronDown, UserCheck, Truck, ChevronLeft, ChevronRight
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getStatusBadgeClass, formatDateTime, formatDate } from "@/lib/bisUtils";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import GoamlXmlPreviewSheet from "@/components/GoamlXmlPreviewSheet";

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

  // ── Live data: try to load investigation by ref (params.id may be ref or mock id)
  const { data: liveInv, isLoading: invLoading } = trpc.investigations.get.useQuery(
    { ref: params.id ?? "" },
    { enabled: !!params.id }
  );

  // ── Live audit log for this investigation (used in Processing Log tab)
  const { data: auditData, isLoading: auditLoading } = trpc.audit.list.useQuery(
    { targetRef: params.id ?? "", limit: 50 },
    { enabled: !!params.id }
  );

  // Use live data; show loading skeleton while fetching
  const inv = liveInv as any | null;
  const relatedAlerts: any[] = [];
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
  const [activeTab, setActiveTab] = useState<'overview' | 'evidence' | 'timeline' | 'str-filings'>('overview');

  // ── STR Filings for this investigation
  const { data: strFilings, isLoading: strFilingsLoading, refetch: refetchFilings } = trpc.goaml.list.useQuery(
    { investigationRef: params.id ?? "", limit: 50 },
    { enabled: !!params.id && activeTab === 'str-filings' }
  );
  // Seed evidence items from live audit log when available, else fall back to mock
  const liveEvidenceItems: EvidenceItem[] = (auditData?.items ?? []).map(a => ({
    id: String(a.id),
    type: 'analyst_note' as EvidenceType,
    timestamp: a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt),
    title: a.action,
    body: a.detail != null ? String(a.detail) : a.action,
    source: a.category,
    linkedBy: a.userEmail ?? undefined,
  }));
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([]);
  // Use live audit items; fall back to empty list
  const mergedEvidence: EvidenceItem[] = liveEvidenceItems.length > 0
    ? liveEvidenceItems
    : evidenceItems;
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceType | 'all'>('all');
  const [currentStatus, setCurrentStatus] = useState<string>((inv as any)?.status ?? 'pending');
  // Live assignee state — seed from live data or mock, updated by assign mutation
  const [assignedToId, setAssignedToId] = useState<string>("");
  const [assignedToName, setAssignedToName] = useState<string>(
    (liveInv as any)?.assignedTo ? String((liveInv as any).assignedTo) : ""
  );

  // ── Live users list for assignee dropdown ─────────────────────────────────
  const { data: usersList, isLoading: usersLoading } = trpc.users.list.useQuery({});

  const assignMutation = trpc.investigations.assign.useMutation({
    onSuccess: (_data, variables) => {
      const user = usersList?.find(u => u.id === variables.assigneeId);
      const name = user?.name ?? user?.email ?? String(variables.assigneeId);
      setAssignedToId(String(variables.assigneeId));
      setAssignedToName(name);
      const assignNote: EvidenceItem = {
        id: `assign_${Date.now()}`,
        type: 'analyst_note',
        timestamp: new Date().toISOString(),
        title: `Reassigned to ${name}`,
        body: `Investigation reassigned to ${name} (ID: ${variables.assigneeId})`,
        linkedBy: 'you',
      };
      setEvidenceItems(p => [assignNote, ...p]);
      toast.success(`Assigned to ${name}`);
    },
    onError: (err) => {
      toast.error("Assignment failed", { description: err.message });
    },
  });

  const handleAssign = (userIdStr: string) => {
    const userId = parseInt(userIdStr, 10);
    if (isNaN(userId)) return;
    const user = usersList?.find(u => u.id === userId);
    const name = user?.name ?? user?.email ?? userIdStr;
    assignMutation.mutate({ ref: inv.ref, assigneeId: userId, assigneeName: name });
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

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState("");
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);

  const updateNoteMutation = trpc.investigations.updateNote.useMutation({
    onSuccess: (result) => {
      setEvidenceItems(prev => prev.map(item =>
        item.id === editingNoteId
          ? { ...item, body: editNoteText, title: 'Analyst Note (edited)' }
          : item
      ));
      setEditingNoteId(null);
      setEditNoteText("");
      toast.success("Note updated");
    },
    onError: (e) => toast.error(`Failed to update note: ${e.message}`),
  });

  const deleteNoteMutation = trpc.investigations.deleteNote.useMutation({
    onSuccess: () => {
      setEvidenceItems(prev => prev.filter(item => item.id !== deletingNoteId));
      setDeletingNoteId(null);
      toast.success("Note deleted");
    },
    onError: (e) => {
      toast.error(`Failed to delete note: ${e.message}`);
      setDeletingNoteId(null);
    },
  });

  // ── goAML STR Wizard modal ──────────────────────────────────────────────────
  const [goamlOpen, setGoamlOpen] = useState(false);
  const [xmlPreviewOpen, setXmlPreviewOpen] = useState(false);
  const [lastFilingId, setLastFilingId] = useState<number | null>(null);
  const [lastFilingRef, setLastFilingRef] = useState<string | undefined>(undefined);
  const [goamlStep, setGoamlStep] = useState<0|1|2|3>(0);
  const [goamlForm, setGoamlForm] = useState({
    reportType: "STR" as "STR" | "CTR" | "SAR",
    subjectName: "",
    subjectBvn: "",
    subjectNin: "",
    subjectAccountNumber: "",
    subjectBank: "",
    transactionDate: "",
    transactionAmount: "",
    transactionCurrency: "NGN",
    suspiciousActivity: "",
    narrativeDetails: "",
  });

  const goamlCreateMutation = trpc.goaml.create.useMutation({
    onSuccess: (data) => {
      setLastFilingId(data.id);
      setLastFilingRef(data.filingRef);
      setGoamlOpen(false);
      setGoamlStep(0);
      toast.success(`STR draft created — ${data.filingRef}`, {
        action: {
          label: 'Preview XML',
          onClick: () => setXmlPreviewOpen(true),
        },
      });
    },
    onError: (e) => toast.error(e.message),
  });

  const openGoamlWizard = () => {
    const subject = (liveInv as any) ?? inv;
    setGoamlForm(prev => ({
      ...prev,
      subjectName: subject?.subjectName ?? "",
      subjectBvn: subject?.bvn ?? "",
      subjectNin: subject?.nin ?? "",
    }));
    setGoamlStep(0);
    setGoamlOpen(true);
  };

  const GOAML_SUSPICIOUS_CATEGORIES = [
    "Structuring / Smurfing", "Unusual cash transactions",
    "Transactions inconsistent with customer profile",
    "Politically Exposed Person (PEP) activity", "Sanctions list match",
    "Terrorist financing indicators", "Cyber-enabled fraud",
    "Real estate money laundering", "Trade-based money laundering",
    "Bribery and corruption", "Other suspicious activity",
  ];

  const NIGERIAN_BANKS = [
    "Access Bank", "Zenith Bank", "GTBank", "First Bank", "UBA",
    "Fidelity Bank", "Union Bank", "Sterling Bank", "Polaris Bank",
    "FCMB", "Kuda Bank", "OPay", "Moniepoint", "PalmPay", "Other",
  ];

  const goamlCanNext = () => {
    if (goamlStep === 0) return true;
    if (goamlStep === 1) return goamlForm.subjectName.trim().length >= 2;
    if (goamlStep === 2) return true;
    if (goamlStep === 3) return goamlForm.suspiciousActivity.trim().length >= 5;
    return true;
  };

  const handleGoamlSubmit = () => {
    const subject = (liveInv as any) ?? inv;
    goamlCreateMutation.mutate({
      reportType: goamlForm.reportType,
      investigationRef: subject?.ref,
      subjectName: goamlForm.subjectName,
      subjectBvn: goamlForm.subjectBvn || undefined,
      subjectNin: goamlForm.subjectNin || undefined,
      subjectAccountNumber: goamlForm.subjectAccountNumber || undefined,
      subjectBank: goamlForm.subjectBank || undefined,
      transactionDate: goamlForm.transactionDate ? new Date(goamlForm.transactionDate) : undefined,
      transactionAmount: goamlForm.transactionAmount ? parseFloat(goamlForm.transactionAmount) : undefined,
      transactionCurrency: goamlForm.transactionCurrency,
      suspiciousActivity: goamlForm.suspiciousActivity,
      narrativeDetails: goamlForm.narrativeDetails || undefined,
    });
  };

  // ── Field Agent Dispatch slide-over ─────────────────────────────────────────
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchAgentId, setDispatchAgentId] = useState("");
  const [dispatchTaskType, setDispatchTaskType] = useState<string>("address_verification");
  const [dispatchPriority, setDispatchPriority] = useState<string>("medium");
  const [dispatchAddress, setDispatchAddress] = useState("");
  const [dispatchInstructions, setDispatchInstructions] = useState("");

  const { data: agentsList, isLoading: agentsLoading } = trpc.fieldAgents.list.useQuery(
    { status: "active", limit: 100 },
    { enabled: dispatchOpen }
  );

  const dispatchMutation = trpc.fieldTasks.dispatch.useMutation({
    onSuccess: (result) => {
      const agent = agentsList?.find(a => String(a.id) === dispatchAgentId);
      const agentName = agent?.name ?? dispatchAgentId;
      const newEvidence: EvidenceItem = {
        id: `ft_${Date.now()}`,
        type: 'field_task',
        timestamp: new Date().toISOString(),
        title: `Field task dispatched — ${TASK_TYPE_LABELS[dispatchTaskType] ?? dispatchTaskType}`,
        body: `Agent: ${agentName} · Ref: ${result.taskRef}${dispatchAddress ? ` · Address: ${dispatchAddress}` : ''}`,
        linkedBy: 'you',
        status: 'dispatched',
      };
      setEvidenceItems(p => [newEvidence, ...p]);
      setDispatchOpen(false);
      setDispatchAgentId("");
      setDispatchAddress("");
      setDispatchInstructions("");
      toast.success(`Field task ${result.taskRef} dispatched to ${agentName}`);
    },
    onError: (e) => toast.error(`Dispatch failed: ${e.message}`),
  });

  const exportTimelineMutation = trpc.investigations.exportTimeline.useMutation({
    onSuccess: (result) => {
      const a = document.createElement("a");
      a.href = result.url;
      a.download = result.filename;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("Timeline PDF exported successfully");
    },
    onError: (e) => toast.error(`PDF export failed: ${e.message}`),
  });

  const handleExportTimeline = () => {
    const ref = params.id;
    if (!ref) return;
    exportTimelineMutation.mutate({ ref });
  };

  const handleDispatch = () => {
    if (!dispatchAgentId) { toast.error("Select a field agent"); return; }
    const agent = agentsList?.find(a => String(a.id) === dispatchAgentId);
    dispatchMutation.mutate({
      agentId: dispatchAgentId,
      agentName: agent?.name ?? dispatchAgentId,
      taskType: dispatchTaskType as any,
      priority: dispatchPriority as any,
      subjectName: (liveInv as any)?.subjectName ?? inv.subjectName,
      address: dispatchAddress || undefined,
      instructions: dispatchInstructions || undefined,
      investigationId: (liveInv as any)?.id ?? undefined,
    });
  };

  const TASK_TYPE_LABELS: Record<string, string> = {
    address_verification: "Address Verification",
    biometric_capture: "Biometric Capture",
    document_collection: "Document Collection",
    surveillance: "Surveillance",
    interview: "Interview",
  };

  const addNoteMutation = trpc.investigations.addNote.useMutation({
    onSuccess: (result) => {
      const newItem: EvidenceItem = {
        id: `note_${Date.now()}`,
        type: 'analyst_note',
        timestamp: result.timestamp,
        title: 'Analyst Note',
        body: note.trim(),
        linkedBy: result.author,
      };
      setEvidenceItems(prev => [newItem, ...prev]);
      setAddingNote(false);
      setNote("");
      toast.success("Note added to investigation evidence log");
    },
    onError: (e) => {
      toast.error(`Failed to add note: ${e.message}`);
      setAddingNote(false);
    },
  });

  const handleAddNote = () => {
    if (!note.trim() || !inv?.ref) return;
    setAddingNote(true);
    addNoteMutation.mutate({ ref: inv.ref, note: note.trim() });
  };

  const handleDownloadReport = () => {
    toast.success("Report download started — PDF generating...");
  };

  const handleRerun = () => {
    toast.info("Investigation re-queued for processing");
  };

  const filteredEvidence = mergedEvidence.filter(e =>
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

  // Show loading skeleton while fetching live investigation
  if (invLoading) {
    return (
      <BISLayout title="Loading…" subtitle="Fetching investigation data">
        <div className="flex items-center justify-center py-24">
          <Loader2 size={28} className="animate-spin text-muted-foreground" />
        </div>
      </BISLayout>
    );
  }

  return (
    <BISLayout
      title={inv.ref}
      subtitle={(liveInv as any)?.subjectName ?? inv.subjectName}
      actions={
        <div className="flex items-center gap-2">
          <Select
            value={assignedToId}
            onValueChange={handleAssign}
            disabled={usersLoading || assignMutation.isPending}
          >
            <SelectTrigger className="h-7 w-44 text-xs">
              {assignMutation.isPending ? (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Loader2 size={10} className="animate-spin" /> Assigning…
                </span>
              ) : (
                <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground truncate">
                  <UserCheck size={11} />
                  {assignedToName || (usersLoading ? "Loading…" : "Assign analyst")}
                </span>
              )}
            </SelectTrigger>
            <SelectContent>
              {usersLoading ? (
                <div className="px-2 py-1 text-xs text-muted-foreground">Loading users…</div>
              ) : usersList && usersList.length > 0 ? (
                usersList.map(u => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    <div className="flex flex-col">
                      <span className="font-mono text-xs">{u.name ?? u.email ?? `User #${u.id}`}</span>
                      {u.email && u.name && (
                        <span className="text-[10px] text-muted-foreground">{u.email}</span>
                      )}
                    </div>
                  </SelectItem>
                ))
              ) : (
                <div className="px-2 py-1 text-xs text-muted-foreground">No users found</div>
              )}
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
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1 border-amber-500/40 text-amber-400 hover:bg-amber-500/10" onClick={openGoamlWizard}>
            <Shield size={11} /> File STR
          </Button>
          {lastFilingId && (
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1 border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10" onClick={() => setXmlPreviewOpen(true)}>
              <FileText size={11} /> Preview XML
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setDispatchOpen(true)}>
            <Truck size={11} /> Dispatch Agent
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleRerun}>
            <RefreshCw size={11} /> Re-run
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleDownloadReport}>
            <Download size={11} /> Report
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={handleExportTimeline}
            disabled={exportTimelineMutation.isPending}
          >
            {exportTimelineMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <FileText size={11} />}
            {exportTimelineMutation.isPending ? "Generating…" : "Export PDF"}
          </Button>
        </div>
      }
    >
      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 mb-4 -ml-1" onClick={() => navigate("/investigations")}>
        <ArrowLeft size={12} /> Back to Investigations
      </Button>

      {/* Subject card — always visible, live data when available */}
      <div className="bis-card p-4 mb-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            {((liveInv as any)?.subjectType ?? inv.subjectType) === "individual" ? <User size={20} className="text-primary" /> : <Building2 size={20} className="text-primary" />}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-foreground">{(liveInv as any)?.subjectName ?? inv.subjectName}</h2>
              <span className={`bis-badge ${getStatusBadgeClass(currentStatus)}`}>{currentStatus}</span>
              {/* Tags: live investigation may not have tags, fall back to mock */}
              {((inv as any).tags ?? []).map((tag: string) => (
                <Badge key={tag} variant="outline" className="text-[10px] h-4 px-1.5 border-red-500/30 text-red-400">{tag}</Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
              <span className="capitalize">{(liveInv as any)?.subjectType ?? inv.subjectType}</span>
              <span>·</span>
              <span className="font-mono">{(liveInv as any)?.ref ?? inv.ref}</span>
              <span>·</span>
              <span className="capitalize">{(liveInv as any)?.tier ?? inv.tier} tier</span>
              <span>·</span>
              <span>{(liveInv as any)?.country ?? inv.country}</span>
              {liveInv && <><span>·</span><span className="text-emerald-400/70 font-mono text-[10px]">LIVE</span></>}
            </div>
            <div className="flex flex-wrap gap-4 mt-1 text-xs text-muted-foreground">
              <span>Created: {formatDate((liveInv as any)?.createdAt ?? inv.createdAt)}</span>
              <span>Updated: {formatDateTime((liveInv as any)?.updatedAt ?? inv.updatedAt)}</span>
              {assignedToName && <span>Assigned: {assignedToName}</span>}
            </div>
          </div>
          <div className="text-center shrink-0">
            <div className="text-3xl font-bold font-mono" style={{ color: riskColor }}>
              {(liveInv as any)?.riskScore ?? inv.riskScore}
            </div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Risk Score</div>
            <div className="text-xs capitalize font-medium mt-0.5" style={{ color: riskColor }}>
              {(inv as any).riskLevel ?? ""}
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {([
          { id: 'overview', label: 'Overview' },
          { id: 'evidence', label: `Evidence (${mergedEvidence.length})` },
          { id: 'timeline', label: 'Processing Log' },
          { id: 'str-filings', label: `STR Filings${strFilings && strFilings.length > 0 ? ` (${strFilings.length})` : ''}` },
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
                {(inv?.dataSources ?? []).length > 0 ? (inv?.dataSources ?? []).map((src: string) => (
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
                  const count = mergedEvidence.filter(e => e.type === type).length;
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
              All ({mergedEvidence.length})
            </button>
            {(Object.entries(EVIDENCE_TYPE_CONFIG) as [EvidenceType, typeof EVIDENCE_TYPE_CONFIG.alert][]).map(([type, cfg]) => {
              const count = mergedEvidence.filter(e => e.type === type).length;
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
                          {item.type === 'analyst_note' && !item.id.startsWith('mock_') && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => { setEditingNoteId(item.id); setEditNoteText(item.body); }}
                                className="p-1 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors"
                                title="Edit note"
                              >
                                <FileText size={11} />
                              </button>
                              <button
                                onClick={() => {
                                  setDeletingNoteId(item.id);
                                  const noteId = parseInt(item.id.replace('note_', '').replace('audit_', ''));
                                  if (!isNaN(noteId)) deleteNoteMutation.mutate({ id: noteId });
                                  else { toast.error('Cannot delete this note'); setDeletingNoteId(null); }
                                }}
                                disabled={deletingNoteId === item.id}
                                className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                                title="Delete note"
                              >
                                {deletingNoteId === item.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                       {editingNoteId === item.id ? (
                         <div className="space-y-2">
                           <Textarea
                             value={editNoteText}
                             onChange={e => setEditNoteText(e.target.value)}
                             className="text-sm font-mono min-h-[80px] bg-muted/20"
                             autoFocus
                           />
                           <div className="flex items-center gap-2">
                             <Button
                               size="sm"
                               className="h-7 text-xs"
                               disabled={updateNoteMutation.isPending || !editNoteText.trim()}
                               onClick={() => {
                                 const noteId = parseInt(item.id.replace('note_', '').replace('audit_', ''));
                                 if (!isNaN(noteId)) updateNoteMutation.mutate({ id: noteId, note: editNoteText.trim() });
                                 else toast.error('Cannot edit this note');
                               }}
                             >
                               {updateNoteMutation.isPending ? <Loader2 size={11} className="animate-spin mr-1" /> : null}
                               Save
                             </Button>
                             <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setEditingNoteId(null); setEditNoteText(""); }}>
                               Cancel
                             </Button>
                           </div>
                         </div>
                       ) : (
                         <p className="text-sm text-foreground/85 leading-relaxed">
                           {item.body?.split(/(@[\w.@]+)/g).map((part, pi) =>
                             part.match(/^@[\w.@]+$/) ? (
                               <span key={pi} className="inline-flex items-center gap-0.5 bg-primary/10 text-primary border border-primary/20 rounded px-1 py-0.5 text-[11px] font-mono">
                                 {part}
                               </span>
                             ) : part
                           )}
                         </p>
                       )}

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
          {auditLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
              <Loader2 size={12} className="animate-spin" /> Loading live audit log…
            </div>
          )}
          {/* Live audit entries */}
          {(auditData?.items ?? []).map((entry, i) => {
            const color = entry.result === "failure" ? "text-red-400 bg-red-500/10 border-red-500/20"
              : entry.result === "warning" ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
              : entry.result === "success" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
              : "text-muted-foreground bg-muted/20 border-border/50";
            const detailStr = entry.detail != null ? String(entry.detail) : null;
            return (
              <div key={entry.id} className={`p-3 rounded-lg border text-xs ${color}`}>
                <div className="font-mono font-semibold">{entry.action}</div>
                <div className="flex items-center gap-2 mt-1 opacity-70">
                  <span>{entry.userEmail ?? entry.category}</span>
                  <span>·</span>
                  <span className="font-mono">
                    {entry.createdAt instanceof Date
                      ? formatDateTime(entry.createdAt.toISOString())
                      : formatDateTime(String(entry.createdAt))}
                  </span>
                  {detailStr && <><span>·</span><span className="truncate max-w-[200px]">{detailStr}</span></>}
                </div>
              </div>
            );
          })}
          {/* Fall back to static mock processing timeline when no live entries */}
          {!auditLoading && (auditData?.items ?? []).length === 0 && (
            <>
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Simulated processing log (no live DB entries)</p>
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
            </>
          )}
        </div>
      )}
      {/* ── STR Filings Tab ── */}
      {activeTab === 'str-filings' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground font-mono">Suspicious Transaction Reports filed for this investigation</p>
            <Button size="sm" variant="outline" onClick={() => refetchFilings()} className="text-xs h-7">
              <RefreshCw size={11} className="mr-1" /> Refresh
            </Button>
          </div>
          {strFilingsLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
              <Loader2 size={13} className="animate-spin" /> Loading STR filings…
            </div>
          )}
          {!strFilingsLoading && (!strFilings || strFilings.length === 0) && (
            <div className="text-center py-10 text-muted-foreground">
              <FileText size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm font-mono">No STR filings yet</p>
              <p className="text-xs mt-1">Use the <span className="text-amber-400">File STR</span> button to create a Suspicious Transaction Report.</p>
            </div>
          )}
          {(strFilings ?? []).map((filing: any) => {
            const statusColors: Record<string, string> = {
              draft: 'text-muted-foreground bg-muted/20 border-border/50',
              submitted: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
              accepted: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
              rejected: 'text-red-400 bg-red-500/10 border-red-500/20',
              pending_review: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
            };
            return (
              <div key={filing.id} className={`p-4 rounded-xl border text-xs ${statusColors[filing.status] ?? statusColors.draft}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm">{filing.filingRef ?? `FILING-${filing.id}`}</span>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusColors[filing.status] ?? ''}`}>
                        {filing.status.replace('_', ' ').toUpperCase()}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground">
                      {filing.reportType} · {filing.subjectName}
                    </div>
                    {filing.narrative && (
                      <div className="text-muted-foreground/70 line-clamp-2 max-w-xl">{filing.narrative}</div>
                    )}
                    <div className="font-mono text-[10px] text-muted-foreground/60">
                      Created {formatDateTime(filing.createdAt instanceof Date ? filing.createdAt.toISOString() : String(filing.createdAt))}
                      {filing.submittedAt && <> · Submitted {formatDateTime(filing.submittedAt instanceof Date ? filing.submittedAt.toISOString() : String(filing.submittedAt))}</>}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[10px] h-7 shrink-0"
                    onClick={() => {
                      setLastFilingId(filing.id);
                      setLastFilingRef(filing.filingRef ?? `FILING-${filing.id}`);
                      setXmlPreviewOpen(true);
                    }}
                  >
                    <FileText size={10} className="mr-1" /> View XML
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Dispatch Field Agent Slide-over ── */}
      <Sheet open={dispatchOpen} onOpenChange={setDispatchOpen}>
        <SheetContent side="right" className="w-[480px] sm:max-w-[480px] overflow-y-auto">
          <SheetHeader className="mb-5">
            <SheetTitle className="flex items-center gap-2">
              <Truck size={16} className="text-violet-400" />
              Dispatch Field Agent
            </SheetTitle>
            <p className="text-xs text-muted-foreground">
              Assign a field task linked to investigation{" "}
              <span className="font-mono text-primary">{(liveInv as any)?.ref ?? inv.ref}</span>
            </p>
          </SheetHeader>

          <div className="space-y-5">
            {/* Agent selector */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Field Agent *</Label>
              <Select value={dispatchAgentId} onValueChange={setDispatchAgentId} disabled={agentsLoading}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder={agentsLoading ? "Loading agents…" : "Select active agent"} />
                </SelectTrigger>
                <SelectContent>
                  {(agentsList ?? []).map(a => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      <div className="flex flex-col">
                        <span className="font-mono text-sm">{a.name}</span>
                        <span className="text-[10px] text-muted-foreground">{a.agentCode} · {a.state ?? "—"} · {a.tier}</span>
                      </div>
                    </SelectItem>
                  ))}
                  {!agentsLoading && (agentsList ?? []).length === 0 && (
                    <div className="px-2 py-3 text-xs text-muted-foreground text-center">No active agents found</div>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Task type */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Task Type *</Label>
              <Select value={dispatchTaskType} onValueChange={setDispatchTaskType}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TASK_TYPE_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Priority */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Priority</Label>
              <Select value={dispatchPriority} onValueChange={setDispatchPriority}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["low", "medium", "high", "critical"].map(p => (
                    <SelectItem key={p} value={p} className="capitalize">{p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Address */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Field Address</Label>
              <input
                type="text"
                value={dispatchAddress}
                onChange={e => setDispatchAddress(e.target.value)}
                placeholder="e.g. 14 Broad Street, Lagos Island"
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            {/* Instructions */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Instructions</Label>
              <Textarea
                value={dispatchInstructions}
                onChange={e => setDispatchInstructions(e.target.value)}
                placeholder="Specific instructions for the field agent…"
                rows={3}
                className="text-sm resize-none"
              />
            </div>

            {/* Subject preview */}
            <div className="bg-muted/20 rounded-lg p-3 border border-border/50">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Subject</div>
              <div className="text-sm font-medium">{(liveInv as any)?.subjectName ?? inv.subjectName}</div>
              <div className="text-xs text-muted-foreground font-mono mt-0.5">{(liveInv as any)?.ref ?? inv.ref}</div>
            </div>
          </div>

          <SheetFooter className="mt-6 flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => setDispatchOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
              onClick={handleDispatch}
              disabled={!dispatchAgentId || dispatchMutation.isPending}
            >
              {dispatchMutation.isPending ? (
                <><Loader2 size={12} className="animate-spin mr-1" /> Dispatching…</>
              ) : (
                <><Truck size={12} className="mr-1" /> Dispatch Task</>
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ── goAML STR Wizard Modal ─────────────────────────────────────────── */}
      <Dialog open={goamlOpen} onOpenChange={setGoamlOpen}>
        <DialogContent className="max-w-lg bg-[#0f0f1a] border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-mono">
              <Shield size={14} className="text-amber-400" />
              goAML STR Wizard
              <span className="ml-auto text-[10px] font-mono text-muted-foreground">Step {goamlStep + 1} / 4</span>
            </DialogTitle>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-1 pb-2">
            {([0,1,2,3] as const).map((s) => (
              <div key={s} className="flex items-center gap-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-bold border transition-all ${
                  s < goamlStep ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300" :
                  s === goamlStep ? "bg-amber-500/20 border-amber-500/50 text-amber-300" :
                  "bg-muted/30 border-border text-muted-foreground"
                }`}>{s + 1}</div>
                {s < 3 && <div className={`h-px w-8 ${s < goamlStep ? "bg-emerald-500/50" : "bg-border"}`} />}
              </div>
            ))}
            <span className="ml-3 text-[10px] font-mono text-muted-foreground">
              {["Report Type", "Subject", "Transaction", "Narrative"][goamlStep]}
            </span>
          </div>

          {/* Step 0: Report type */}
          {goamlStep === 0 && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {(["STR", "CTR", "SAR"] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setGoamlForm(p => ({ ...p, reportType: t }))}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${
                      goamlForm.reportType === t ? "border-amber-500/60 bg-amber-500/10" : "border-border hover:border-border/80"
                    }`}
                  >
                    <div className="text-sm font-mono font-bold text-foreground">{t}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {t === "STR" && "Suspicious Transaction"}
                      {t === "CTR" && "Cash Transaction ≥₦5M"}
                      {t === "SAR" && "Suspicious Activity"}
                    </div>
                  </button>
                ))}
              </div>
              <div className="bg-muted/10 rounded-lg p-3 border border-border/50 text-xs text-muted-foreground">
                <span className="text-amber-400 font-semibold">Linked to:</span> {((liveInv as any) ?? inv)?.ref} — {((liveInv as any) ?? inv)?.subjectName}
              </div>
            </div>
          )}

          {/* Step 1: Subject */}
          {goamlStep === 1 && (
            <div className="space-y-3">
              <div>
                <Label className="text-[10px] font-mono text-muted-foreground mb-1 block">Full Name *</Label>
                <Input value={goamlForm.subjectName} onChange={e => setGoamlForm(p => ({ ...p, subjectName: e.target.value }))} placeholder="Subject full name" className="text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] font-mono text-muted-foreground mb-1 block">BVN</Label>
                  <Input value={goamlForm.subjectBvn} onChange={e => setGoamlForm(p => ({ ...p, subjectBvn: e.target.value }))} placeholder="22-digit BVN" className="font-mono text-sm" maxLength={22} />
                </div>
                <div>
                  <Label className="text-[10px] font-mono text-muted-foreground mb-1 block">NIN</Label>
                  <Input value={goamlForm.subjectNin} onChange={e => setGoamlForm(p => ({ ...p, subjectNin: e.target.value }))} placeholder="11-digit NIN" className="font-mono text-sm" maxLength={11} />
                </div>
                <div>
                  <Label className="text-[10px] font-mono text-muted-foreground mb-1 block">Account Number</Label>
                  <Input value={goamlForm.subjectAccountNumber} onChange={e => setGoamlForm(p => ({ ...p, subjectAccountNumber: e.target.value }))} placeholder="10-digit NUBAN" className="font-mono text-sm" maxLength={10} />
                </div>
                <div>
                  <Label className="text-[10px] font-mono text-muted-foreground mb-1 block">Bank</Label>
                  <Select value={goamlForm.subjectBank} onValueChange={v => setGoamlForm(p => ({ ...p, subjectBank: v }))}>
                    <SelectTrigger className="text-sm"><SelectValue placeholder="Select bank" /></SelectTrigger>
                    <SelectContent>{NIGERIAN_BANKS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Transaction */}
          {goamlStep === 2 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] font-mono text-muted-foreground mb-1 block">Transaction Date</Label>
                  <Input type="date" value={goamlForm.transactionDate} onChange={e => setGoamlForm(p => ({ ...p, transactionDate: e.target.value }))} className="text-sm" />
                </div>
                <div>
                  <Label className="text-[10px] font-mono text-muted-foreground mb-1 block">Currency</Label>
                  <Select value={goamlForm.transactionCurrency} onValueChange={v => setGoamlForm(p => ({ ...p, transactionCurrency: v }))}>
                    <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{["NGN","USD","GBP","EUR"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="text-[10px] font-mono text-muted-foreground mb-1 block">Amount</Label>
                  <Input type="number" value={goamlForm.transactionAmount} onChange={e => setGoamlForm(p => ({ ...p, transactionAmount: e.target.value }))} placeholder="0.00" className="font-mono text-sm" />
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Narrative */}
          {goamlStep === 3 && (
            <div className="space-y-3">
              <div>
                <Label className="text-[10px] font-mono text-muted-foreground mb-1 block">Suspicious Activity Category *</Label>
                <Select value={goamlForm.suspiciousActivity} onValueChange={v => setGoamlForm(p => ({ ...p, suspiciousActivity: v }))}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>{GOAML_SUSPICIOUS_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] font-mono text-muted-foreground mb-1 block">Detailed Narrative</Label>
                <Textarea
                  value={goamlForm.narrativeDetails}
                  onChange={e => setGoamlForm(p => ({ ...p, narrativeDetails: e.target.value }))}
                  placeholder="Describe the suspicious activity in detail…"
                  rows={4}
                  className="text-sm resize-none"
                />
              </div>
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <AlertTriangle size={12} className="text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-[10px] text-amber-300">Filing a false STR is a criminal offence under MLPPA 2022. This will be saved as a draft for your review before submission to NFIU.</p>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between pt-3 border-t border-border">
            <Button variant="outline" size="sm" onClick={() => setGoamlStep(s => Math.max(0, s - 1) as 0|1|2|3)} disabled={goamlStep === 0} className="gap-1">
              <ChevronLeft size={12} /> Back
            </Button>
            {goamlStep < 3 ? (
              <Button size="sm" onClick={() => setGoamlStep(s => (s + 1) as 0|1|2|3)} disabled={!goamlCanNext()} className="gap-1">
                Next <ChevronRight size={12} />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleGoamlSubmit}
                disabled={goamlCreateMutation.isPending || !goamlCanNext()}
                className="gap-1 bg-amber-600 hover:bg-amber-700 text-white"
              >
                {goamlCreateMutation.isPending ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : <><FileText size={12} /> Save Draft</>}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── goAML XML Preview Sheet ─────────────────────────────────────────── */}
      <GoamlXmlPreviewSheet
        open={xmlPreviewOpen}
        onOpenChange={setXmlPreviewOpen}
        filingId={lastFilingId}
        filingRef={lastFilingRef}
        onSubmitSuccess={(ref) => {
          toast.success(`STR submitted to NFIU — ${ref}`);
          setXmlPreviewOpen(false);
        }}
      />
    </BISLayout>
  );
}
