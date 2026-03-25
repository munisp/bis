import { useState, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ArrowLeft,
  Users,
  FileText,
  Clock,
  UserPlus,
  FilePlus,
  MessageSquare,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Copy,
  Shield,
  Eye,
  X,
  Download,
  Image as ImageIcon,
  Trash2,
  FileDown,
  Loader2,
  RefreshCw,
  UserCheck,
  Lock,
  Pencil,
  Send,
  BarChart2,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  open: "bg-blue-100 text-blue-700",
  under_review: "bg-amber-100 text-amber-700",
  pending_decision: "bg-orange-100 text-orange-700",
  closed: "bg-green-100 text-green-700",
  archived: "bg-slate-100 text-slate-500",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

const TIMELINE_ICONS: Record<string, any> = {
  case_created: CheckCircle2,
  status_changed: Clock,
  party_added: Users,
  document_uploaded: FileText,
  document_deleted: Trash2,
  comment_added: MessageSquare,
  stakeholder_invited: UserPlus,
  investigation_linked: ExternalLink,
  alert_triggered: AlertTriangle,
  decision_recorded: Shield,
  case_closed: CheckCircle2,
  field_task_dispatched: ExternalLink,
};

function RiskBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-muted-foreground text-sm">—</span>;
  const color = score >= 75 ? "text-red-600 bg-red-50 border-red-200" : score >= 50 ? "text-orange-600 bg-orange-50 border-orange-200" : score >= 25 ? "text-amber-600 bg-amber-50 border-amber-200" : "text-green-600 bg-green-50 border-green-200";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-sm font-semibold ${color}`}>
      <BarChart2 className="w-3 h-3" />
      {score}/100
    </span>
  );
}

export default function CaseDetailPage() {
  const [, params] = useRoute("/cases/:ref");
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const caseRef = params?.ref ?? "";

  // Dialog state
  const [addPartyOpen, setAddPartyOpen] = useState(false);
  const [inviteStakeholderOpen, setInviteStakeholderOpen] = useState(false);
  const [updateStatusOpen, setUpdateStatusOpen] = useState(false);
  const [deleteDocId, setDeleteDocId] = useState<number | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{ url: string; filename: string; mimeType: string } | null>(null);
  const [uploadDocOpen, setUploadDocOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadConfidential, setUploadConfidential] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedAnalystId, setSelectedAnalystId] = useState<string>("");

  // Comment state
  const [commentText, setCommentText] = useState("");
  const [commentConfidential, setCommentConfidential] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [deleteCommentId, setDeleteCommentId] = useState<number | null>(null);

  // Form state
  const [partyForm, setPartyForm] = useState({ role: "subject" as const, name: "", nin: "", bvn: "", phone: "", email: "", notes: "" });
  const [stakeholderForm, setStakeholderForm] = useState({ role: "reviewer" as const, name: "", email: "", organisation: "", canComment: false, canViewDocuments: true, expiryDays: 30 });
  const [newStatus, setNewStatus] = useState("");

  // Queries
  const { data: caseData, isLoading } = trpc.cases.get.useQuery({ ref: caseRef }, { enabled: !!caseRef });
  const { data: comments, refetch: refetchComments } = trpc.cases.listComments.useQuery({ caseRef }, { enabled: !!caseRef });
  const { data: analysts } = trpc.users.list.useQuery({ role: "analyst" }, { enabled: assignOpen });

  // Mutations
  const updateCase = trpc.cases.update.useMutation({
    onSuccess: () => { utils.cases.get.invalidate({ ref: caseRef }); setUpdateStatusOpen(false); toast.success("Case updated"); },
    onError: (e) => toast.error(e.message),
  });
  const addParty = trpc.cases.addParty.useMutation({
    onSuccess: () => { utils.cases.get.invalidate({ ref: caseRef }); setAddPartyOpen(false); toast.success("Party added"); },
    onError: (e) => toast.error(e.message),
  });
  const inviteStakeholder = trpc.cases.inviteStakeholder.useMutation({
    onSuccess: (result) => {
      utils.cases.get.invalidate({ ref: caseRef });
      setInviteStakeholderOpen(false);
      const portalUrl = `${window.location.origin}/cases/portal?token=${result.accessToken}`;
      navigator.clipboard.writeText(portalUrl).catch(() => {});
      toast.success("Stakeholder invited — portal link copied to clipboard");
    },
    onError: (e) => toast.error(e.message),
  });
  const uploadDocument = trpc.cases.uploadDocument.useMutation({
    onSuccess: () => {
      utils.cases.get.invalidate({ ref: caseRef });
      setUploadDocOpen(false); setUploadFile(null); setUploadDescription(""); setUploadConfidential(false);
      toast.success("Document uploaded successfully");
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteDocument = trpc.cases.deleteDocument.useMutation({
    onSuccess: () => { utils.cases.get.invalidate({ ref: caseRef }); setDeleteDocId(null); toast.success("Document deleted"); },
    onError: (e) => { toast.error(e.message); setDeleteDocId(null); },
  });
  const exportCasePdf = trpc.cases.exportCasePdf.useMutation({
    onSuccess: (result) => {
      setExportingPdf(false);
      const a = document.createElement("a");
      a.href = result.url; a.download = result.filename; a.target = "_blank"; a.click();
      toast.success(`Case report exported (${result.format.toUpperCase()})`);
    },
    onError: (e) => { setExportingPdf(false); toast.error(e.message); },
  });
  const recalculateRisk = trpc.cases.recalculateRiskScore.useMutation({
    onSuccess: (result) => {
      utils.cases.get.invalidate({ ref: caseRef });
      toast.success(`Risk score updated: ${result.riskScore}/100${result.llmRiskNotes ? ` — ${result.llmRiskNotes.slice(0, 60)}…` : ""}`);
    },
    onError: (e) => toast.error(e.message),
  });
  const assignLeadAnalyst = trpc.cases.assignLeadAnalyst.useMutation({
    onSuccess: () => {
      utils.cases.get.invalidate({ ref: caseRef });
      setAssignOpen(false);
      toast.success("Lead analyst assigned");
    },
    onError: (e) => toast.error(e.message),
  });
  const addComment = trpc.cases.addComment.useMutation({
    onSuccess: () => {
      refetchComments();
      utils.cases.get.invalidate({ ref: caseRef });
      setCommentText(""); setCommentConfidential(false);
      toast.success("Comment added");
    },
    onError: (e) => toast.error(e.message),
  });
  const editComment = trpc.cases.editComment.useMutation({
    onSuccess: () => { refetchComments(); setEditingCommentId(null); setEditingContent(""); toast.success("Comment updated"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteComment = trpc.cases.deleteComment.useMutation({
    onSuccess: () => { refetchComments(); setDeleteCommentId(null); toast.success("Comment deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const handleUploadDocument = async () => {
    if (!uploadFile || !caseRef) return;
    const MAX_SIZE = 16 * 1024 * 1024;
    if (uploadFile.size > MAX_SIZE) { toast.error("File exceeds 16 MB limit"); return; }
    setUploading(true);
    try {
      const arrayBuffer = await uploadFile.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
      const base64 = btoa(binary);
      await uploadDocument.mutateAsync({ caseRef, fileName: uploadFile.name, mimeType: uploadFile.type || "application/octet-stream", fileBase64: base64, fileSize: uploadFile.size, confidential: uploadConfidential, description: uploadDescription || undefined });
    } catch { /* handled by onError */ } finally { setUploading(false); }
  };

  const copyPortalLink = (token: string) => {
    const url = `${window.location.origin}/cases/portal?token=${token}`;
    navigator.clipboard.writeText(url);
    toast.success("Portal link copied");
  };

  const handleAssign = () => {
    if (!selectedAnalystId) return;
    const analystId = selectedAnalystId === "unassign" ? null : parseInt(selectedAnalystId);
    const analyst = analysts?.find((a: any) => a.id === analystId);
    assignLeadAnalyst.mutate({ caseRef, analystId, analystName: analyst?.name ?? undefined });
  };

  if (isLoading) return <div className="p-6 space-y-4">{[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}</div>;
  if (!caseData) return (
    <div className="p-6 text-center">
      <p className="text-muted-foreground">Case not found.</p>
      <Button variant="ghost" onClick={() => navigate("/cases")} className="mt-2"><ArrowLeft className="w-4 h-4 mr-1" /> Back to Cases</Button>
    </div>
  );

  const c = caseData;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/cases")} className="mb-2 -ml-2">
            <ArrowLeft className="w-4 h-4 mr-1" /> Cases
          </Button>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-muted-foreground">{c.ref}</span>
            <Badge className={`text-xs ${STATUS_COLORS[c.status] ?? ""}`}>{c.status?.replace("_", " ")}</Badge>
            <Badge className={`text-xs ${PRIORITY_COLORS[c.priority] ?? ""}`}>{c.priority}</Badge>
            <RiskBadge score={c.riskScore} />
          </div>
          <h1 className="text-2xl font-bold mt-1">{c.title}</h1>
          {c.summary && <p className="text-muted-foreground mt-1 max-w-2xl">{c.summary}</p>}
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap justify-end">
          <Button variant="outline" size="sm" onClick={() => recalculateRisk.mutate({ caseRef })} disabled={recalculateRisk.isPending}>
            {recalculateRisk.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            Recalc Risk
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}>
            <UserCheck className="w-4 h-4 mr-1" /> Assign
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setExportingPdf(true); exportCasePdf.mutate({ caseRef }); }} disabled={exportingPdf}>
            {exportingPdf ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileDown className="w-4 h-4 mr-1" />}
            {exportingPdf ? "Generating…" : "Export PDF"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setUpdateStatusOpen(true)}>Update Status</Button>
        </div>
      </div>

      {/* Meta grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        {[
          { label: "Type", value: c.type?.replace("_", " ") },
          { label: "Legal Basis", value: c.legalBasis || "—" },
          { label: "Jurisdiction", value: c.jurisdiction || "—" },
          { label: "Regulatory Framework", value: c.regulatoryFramework || "—" },
          { label: "Created", value: new Date(c.createdAt).toLocaleDateString() },
          { label: "Due", value: c.dueAt ? new Date(c.dueAt).toLocaleDateString() : "—" },
          { label: "Lead Analyst", value: c.leadAnalystId ? `Analyst #${c.leadAnalystId}` : "Unassigned" },
          { label: "Tags", value: (c.tags as string[])?.join(", ") || "—" },
        ].map(({ label, value }) => (
          <div key={label} className="bg-muted/40 rounded-lg p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="font-medium capitalize truncate">{value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="comments">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="comments">
            <MessageSquare className="w-4 h-4 mr-1" /> Comments ({comments?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="timeline">
            <Clock className="w-4 h-4 mr-1" /> Timeline ({c.timeline?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="parties">
            <Users className="w-4 h-4 mr-1" /> Parties ({c.parties?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="documents">
            <FileText className="w-4 h-4 mr-1" /> Documents ({c.documents?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="stakeholders">
            <Shield className="w-4 h-4 mr-1" /> Stakeholders ({c.stakeholders?.length ?? 0})
          </TabsTrigger>
        </TabsList>

        {/* Comments Tab */}
        <TabsContent value="comments" className="mt-4 space-y-4">
          {/* Add comment box */}
          <Card>
            <CardContent className="pt-4 space-y-3">
              <Textarea
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                rows={3}
                placeholder="Add a comment, decision note, or observation…"
                className="resize-none"
              />
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={commentConfidential}
                    onChange={e => setCommentConfidential(e.target.checked)}
                    className="rounded"
                  />
                  <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Confidential (analysts only)</span>
                </label>
                <Button
                  size="sm"
                  onClick={() => addComment.mutate({ caseRef, content: commentText, confidential: commentConfidential })}
                  disabled={!commentText.trim() || addComment.isPending}
                >
                  {addComment.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
                  Post
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Comment thread */}
          <div className="space-y-3">
            {(comments ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No comments yet. Be the first to add one.</p>
            )}
            {(comments ?? []).map((comment: any) => (
              <div key={comment.id} className={`rounded-lg border p-4 ${comment.confidential ? "border-amber-200 bg-amber-50/50" : "bg-muted/30"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-medium text-sm">{comment.authorName ?? "Unknown"}</span>
                      {comment.authorRole && <Badge variant="outline" className="text-xs capitalize">{comment.authorRole}</Badge>}
                      {comment.confidential && (
                        <Badge className="text-xs bg-amber-100 text-amber-700 border-amber-200">
                          <Lock className="w-2.5 h-2.5 mr-0.5" /> Confidential
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">{new Date(comment.createdAt).toLocaleString()}</span>
                      {comment.editedAt && <span className="text-xs text-muted-foreground italic">(edited)</span>}
                    </div>
                    {editingCommentId === comment.id ? (
                      <div className="space-y-2 mt-2">
                        <Textarea
                          value={editingContent}
                          onChange={e => setEditingContent(e.target.value)}
                          rows={3}
                          className="resize-none text-sm"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => editComment.mutate({ commentId: comment.id, content: editingContent })} disabled={!editingContent.trim() || editComment.isPending}>
                            {editComment.isPending ? "Saving…" : "Save"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setEditingCommentId(null); setEditingContent(""); }}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap">{comment.content}</p>
                    )}
                  </div>
                  {/* Actions: only show for author or admin */}
                  {(comment.authorId === user?.id || user?.role === "admin") && editingCommentId !== comment.id && (
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => { setEditingCommentId(comment.id); setEditingContent(comment.content); }}
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        onClick={() => setDeleteCommentId(comment.id)}
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* Timeline Tab */}
        <TabsContent value="timeline" className="mt-4">
          <div className="relative border-l-2 border-border ml-4 space-y-4">
            {(c.timeline ?? []).map((event: any) => {
              const Icon = TIMELINE_ICONS[event.eventType] ?? Clock;
              return (
                <div key={event.id} className="relative pl-6">
                  <div className="absolute -left-[11px] top-1 w-5 h-5 rounded-full bg-background border-2 border-primary flex items-center justify-center">
                    <Icon className="w-2.5 h-2.5 text-primary" />
                  </div>
                  <div className="bg-muted/40 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-sm">{event.title}</p>
                      <span className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</span>
                    </div>
                    {event.actorName && <p className="text-xs text-muted-foreground mt-0.5">by {event.actorName}</p>}
                  </div>
                </div>
              );
            })}
            {(c.timeline ?? []).length === 0 && <p className="text-sm text-muted-foreground pl-6 py-4">No timeline events yet.</p>}
          </div>
        </TabsContent>

        {/* Parties Tab */}
        <TabsContent value="parties" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button size="sm" onClick={() => setAddPartyOpen(true)}>
              <UserPlus className="w-4 h-4 mr-1" /> Add Party
            </Button>
          </div>
          <div className="space-y-3">
            {(c.parties ?? []).map((party: any) => (
              <Card key={party.id}>
                <CardContent className="py-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{party.name}</span>
                        <Badge variant="outline" className="text-xs capitalize">{party.role?.replace("_", " ")}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 space-x-3">
                        {party.nin && <span>NIN: {party.nin}</span>}
                        {party.bvn && <span>BVN: {party.bvn}</span>}
                        {party.phone && <span>{party.phone}</span>}
                        {party.email && <span>{party.email}</span>}
                      </div>
                      {party.notes && <p className="text-xs text-muted-foreground mt-1 italic">{party.notes}</p>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {(c.parties ?? []).length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No parties added yet.</p>}
          </div>
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button size="sm" onClick={() => setUploadDocOpen(true)}>
              <FilePlus className="w-4 h-4 mr-1" /> Upload Document
            </Button>
          </div>
          <div className="space-y-2">
            {(c.documents ?? []).map((doc: any) => (
              <div key={doc.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-muted/20 hover:bg-muted/40 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{doc.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {doc.mimeType} · {doc.sizeBytes ? `${(doc.sizeBytes / 1024).toFixed(1)} KB` : "—"}
                      {doc.confidential && <span className="ml-2 text-amber-600"><Lock className="w-3 h-3 inline" /> Confidential</span>}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {(doc.mimeType?.startsWith("image/") || doc.mimeType === "application/pdf") && (
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setPreviewDoc({ url: doc.url, filename: doc.filename, mimeType: doc.mimeType })} title="Preview">
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => window.open(doc.url, "_blank")} title="Download">
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteDocId(doc.id)} title="Delete">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            {(c.documents ?? []).length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No documents uploaded yet.</p>}
          </div>
        </TabsContent>

        {/* Stakeholders Tab */}
        <TabsContent value="stakeholders" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button size="sm" onClick={() => setInviteStakeholderOpen(true)}>
              <UserPlus className="w-4 h-4 mr-1" /> Invite Stakeholder
            </Button>
          </div>
          <div className="space-y-3">
            {(c.stakeholders ?? []).map((s: any) => (
              <Card key={s.id}>
                <CardContent className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{s.name}</span>
                        <Badge variant="outline" className="text-xs capitalize">{s.role?.replace("_", " ")}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{s.email} {s.organisation && `· ${s.organisation}`}</p>
                      {s.accessExpiresAt && <p className="text-xs text-muted-foreground">Expires: {new Date(s.accessExpiresAt).toLocaleDateString()}</p>}
                    </div>
                    {s.accessToken && (
                      <Button variant="ghost" size="sm" onClick={() => copyPortalLink(s.accessToken)} title="Copy portal link">
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
            {(c.stakeholders ?? []).length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No stakeholders invited yet.</p>}
          </div>
        </TabsContent>
      </Tabs>

      {/* ─── Dialogs ─────────────────────────────────────────────────────── */}

      {/* Assign Lead Analyst Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Assign Lead Analyst</DialogTitle></DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              Current: {c.leadAnalystId ? `Analyst #${c.leadAnalystId}` : "Unassigned"}
            </p>
            <Select value={selectedAnalystId} onValueChange={setSelectedAnalystId}>
              <SelectTrigger>
                <SelectValue placeholder="Select analyst…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassign">— Unassign —</SelectItem>
                {(analysts ?? []).map((a: any) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name ?? a.email ?? `#${a.id}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button onClick={handleAssign} disabled={!selectedAnalystId || assignLeadAnalyst.isPending}>
              {assignLeadAnalyst.isPending ? "Assigning…" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Comment Confirm */}
      <Dialog open={deleteCommentId !== null} onOpenChange={() => setDeleteCommentId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Comment</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-2">This comment will be permanently removed. This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteCommentId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteCommentId && deleteComment.mutate({ commentId: deleteCommentId })} disabled={deleteComment.isPending}>
              {deleteComment.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Document Confirm */}
      <Dialog open={deleteDocId !== null} onOpenChange={() => setDeleteDocId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Document</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-2">This document will be permanently removed from the case. This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDocId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteDocId && deleteDocument.mutate({ caseRef, documentId: deleteDocId })} disabled={deleteDocument.isPending}>
              {deleteDocument.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Document Preview Dialog */}
      <Dialog open={!!previewDoc} onOpenChange={() => setPreviewDoc(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span className="truncate">{previewDoc?.filename}</span>
              <Button variant="ghost" size="sm" onClick={() => window.open(previewDoc?.url, "_blank")}>
                <Download className="w-4 h-4 mr-1" /> Download
              </Button>
            </DialogTitle>
          </DialogHeader>
          <div className="h-[70vh] overflow-auto">
            {previewDoc?.mimeType?.startsWith("image/") ? (
              <img src={previewDoc.url} alt={previewDoc.filename} className="max-w-full mx-auto" />
            ) : previewDoc?.mimeType === "application/pdf" ? (
              <iframe src={previewDoc.url} className="w-full h-full border-0" title={previewDoc.filename} />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload Document Dialog */}
      <Dialog open={uploadDocOpen} onOpenChange={setUploadDocOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>File *</Label>
              <Input type="file" onChange={e => setUploadFile(e.target.files?.[0] ?? null)} className="mt-1" />
              <p className="text-xs text-muted-foreground mt-1">Max 16 MB</p>
            </div>
            <div>
              <Label>Description</Label>
              <Input value={uploadDescription} onChange={e => setUploadDescription(e.target.value)} placeholder="Optional description…" />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={uploadConfidential} onChange={e => setUploadConfidential(e.target.checked)} className="rounded" />
              Mark as Confidential
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadDocOpen(false)}>Cancel</Button>
            <Button onClick={handleUploadDocument} disabled={!uploadFile || uploading}>
              {uploading ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Uploading…</> : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Party Dialog */}
      <Dialog open={addPartyOpen} onOpenChange={setAddPartyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Party to Case</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Role</Label>
              <Select value={partyForm.role} onValueChange={v => setPartyForm(f => ({ ...f, role: v as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["subject","suspect","witness","victim","legal_rep","regulator","other"].map(r => (
                    <SelectItem key={r} value={r}>{r.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Full Name *</Label><Input value={partyForm.name} onChange={e => setPartyForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>NIN</Label><Input value={partyForm.nin} onChange={e => setPartyForm(f => ({ ...f, nin: e.target.value }))} /></div>
              <div><Label>BVN</Label><Input value={partyForm.bvn} onChange={e => setPartyForm(f => ({ ...f, bvn: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Phone</Label><Input value={partyForm.phone} onChange={e => setPartyForm(f => ({ ...f, phone: e.target.value }))} /></div>
              <div><Label>Email</Label><Input value={partyForm.email} onChange={e => setPartyForm(f => ({ ...f, email: e.target.value }))} /></div>
            </div>
            <div><Label>Notes</Label><Textarea value={partyForm.notes} onChange={e => setPartyForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddPartyOpen(false)}>Cancel</Button>
            <Button onClick={() => addParty.mutate({ caseRef, ...partyForm })} disabled={!partyForm.name.trim() || addParty.isPending}>
              {addParty.isPending ? "Adding…" : "Add Party"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite Stakeholder Dialog */}
      <Dialog open={inviteStakeholderOpen} onOpenChange={setInviteStakeholderOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Invite Stakeholder</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Role</Label>
              <Select value={stakeholderForm.role} onValueChange={v => setStakeholderForm(f => ({ ...f, role: v as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["lead_analyst","reviewer","external_counsel","regulator","compliance_officer","subject_representative"].map(r => (
                    <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Full Name *</Label><Input value={stakeholderForm.name} onChange={e => setStakeholderForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>Email *</Label><Input type="email" value={stakeholderForm.email} onChange={e => setStakeholderForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div><Label>Organisation</Label><Input value={stakeholderForm.organisation} onChange={e => setStakeholderForm(f => ({ ...f, organisation: e.target.value }))} /></div>
            <div>
              <Label>Access Expiry (days)</Label>
              <Input type="number" min={1} max={90} value={stakeholderForm.expiryDays} onChange={e => setStakeholderForm(f => ({ ...f, expiryDays: parseInt(e.target.value) || 30 }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteStakeholderOpen(false)}>Cancel</Button>
            <Button onClick={() => inviteStakeholder.mutate({ caseRef, ...stakeholderForm })} disabled={!stakeholderForm.name.trim() || !stakeholderForm.email.trim() || inviteStakeholder.isPending}>
              {inviteStakeholder.isPending ? "Inviting…" : "Send Invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update Status Dialog */}
      <Dialog open={updateStatusOpen} onOpenChange={setUpdateStatusOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Update Case Status</DialogTitle></DialogHeader>
          <div className="py-2">
            <Select value={newStatus} onValueChange={setNewStatus}>
              <SelectTrigger><SelectValue placeholder="Select new status" /></SelectTrigger>
              <SelectContent>
                {["draft","open","under_review","pending_decision","closed","archived"].map(s => (
                  <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateStatusOpen(false)}>Cancel</Button>
            <Button onClick={() => updateCase.mutate({ ref: caseRef, status: newStatus as any })} disabled={!newStatus || updateCase.isPending}>
              {updateCase.isPending ? "Updating…" : "Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
