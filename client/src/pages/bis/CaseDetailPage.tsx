import { useState } from "react";
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
} from "lucide-react";

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
};

export default function CaseDetailPage() {
  const [, params] = useRoute("/cases/:ref");
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const caseRef = params?.ref ?? "";

  const [addPartyOpen, setAddPartyOpen] = useState(false);
  const [inviteStakeholderOpen, setInviteStakeholderOpen] = useState(false);
  const [addCommentOpen, setAddCommentOpen] = useState(false);
  const [updateStatusOpen, setUpdateStatusOpen] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [deleteDocId, setDeleteDocId] = useState<number | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  const [partyForm, setPartyForm] = useState({ role: "subject" as const, name: "", nin: "", bvn: "", phone: "", email: "", notes: "" });
  const [stakeholderForm, setStakeholderForm] = useState({ role: "reviewer" as const, name: "", email: "", organisation: "", canComment: false, canViewDocuments: true, expiryDays: 30 });
  const [commentText, setCommentText] = useState("");
  const [newStatus, setNewStatus] = useState("");

  const { data: caseData, isLoading } = trpc.cases.get.useQuery({ ref: caseRef }, { enabled: !!caseRef });

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
      toast.success(`Stakeholder invited — portal link copied to clipboard`);
    },
    onError: (e) => toast.error(e.message),
  });

  const addTimelineEvent = trpc.cases.addTimelineEvent.useMutation({
    onSuccess: () => { utils.cases.get.invalidate({ ref: caseRef }); setAddCommentOpen(false); setCommentText(""); toast.success("Note added"); },
    onError: (e) => toast.error(e.message),
  });

  const [previewDoc, setPreviewDoc] = useState<{ url: string; filename: string; mimeType: string } | null>(null);

  const [uploadDocOpen, setUploadDocOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadConfidential, setUploadConfidential] = useState(false);
  const [uploading, setUploading] = useState(false);

  const uploadDocument = trpc.cases.uploadDocument.useMutation({
    onSuccess: () => {
      utils.cases.get.invalidate({ ref: caseRef });
      setUploadDocOpen(false);
      setUploadFile(null);
      setUploadDescription("");
      setUploadConfidential(false);
      toast.success("Document uploaded successfully");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteDocument = trpc.cases.deleteDocument.useMutation({
    onSuccess: () => {
      utils.cases.get.invalidate({ ref: caseRef });
      setDeleteDocId(null);
      toast.success("Document deleted");
    },
    onError: (e) => { toast.error(e.message); setDeleteDocId(null); },
  });

  const exportCasePdf = trpc.cases.exportCasePdf.useMutation({
    onSuccess: (result) => {
      setExportingPdf(false);
      // Trigger download
      const a = document.createElement("a");
      a.href = result.url;
      a.download = result.filename;
      a.target = "_blank";
      a.click();
      toast.success(`Case report exported (${result.format.toUpperCase()})`);
    },
    onError: (e) => { setExportingPdf(false); toast.error(e.message); },
  });

  const handleUploadDocument = async () => {
    if (!uploadFile || !caseRef) return;
    const MAX_SIZE = 16 * 1024 * 1024;
    if (uploadFile.size > MAX_SIZE) { toast.error("File exceeds 16 MB limit"); return; }
    setUploading(true);
    try {
      const arrayBuffer = await uploadFile.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
      const base64 = btoa(binary);
      await uploadDocument.mutateAsync({
        caseRef,
        fileName: uploadFile.name,
        mimeType: uploadFile.type || "application/octet-stream",
        fileBase64: base64,
        fileSize: uploadFile.size,
        confidential: uploadConfidential,
        description: uploadDescription || undefined,
      });
    } catch { /* handled by onError */ } finally {
      setUploading(false);
    }
  };

  const handleExportPdf = () => {
    setExportingPdf(true);
    exportCasePdf.mutate({ caseRef });
  };

  const copyPortalLink = (token: string) => {
    const url = `${window.location.origin}/cases/portal?token=${token}`;
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="h-40 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="p-6 text-center py-20">
        <p className="text-muted-foreground">Case not found</p>
        <Button variant="link" onClick={() => navigate("/cases")}>Back to Cases</Button>
      </div>
    );
  }

  const c = caseData;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/cases")} className="mb-2 -ml-2">
            <ArrowLeft className="w-4 h-4 mr-1" /> Cases
          </Button>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-muted-foreground">{c.ref}</span>
            <Badge className={`text-xs ${STATUS_COLORS[c.status] ?? ""}`}>{c.status?.replace("_", " ")}</Badge>
            <Badge className={`text-xs ${PRIORITY_COLORS[c.priority] ?? ""}`}>{c.priority}</Badge>
          </div>
          <h1 className="text-2xl font-bold mt-1">{c.title}</h1>
          {c.summary && <p className="text-muted-foreground mt-1 max-w-2xl">{c.summary}</p>}
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap justify-end">
          <Button variant="outline" size="sm" onClick={handleExportPdf} disabled={exportingPdf}>
            {exportingPdf ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileDown className="w-4 h-4 mr-1" />}
            {exportingPdf ? "Generating..." : "Export PDF"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setUpdateStatusOpen(true)}>Update Status</Button>
          <Button size="sm" onClick={() => setAddCommentOpen(true)}>
            <MessageSquare className="w-4 h-4 mr-1" /> Add Note
          </Button>
        </div>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        {[
          { label: "Type", value: c.type?.replace("_", " ") },
          { label: "Legal Basis", value: c.legalBasis || "—" },
          { label: "Jurisdiction", value: c.jurisdiction || "—" },
          { label: "Regulatory Framework", value: c.regulatoryFramework || "—" },
          { label: "Created", value: new Date(c.createdAt).toLocaleDateString() },
          { label: "Due", value: c.dueAt ? new Date(c.dueAt).toLocaleDateString() : "—" },
          { label: "Risk Score", value: c.riskScore != null ? `${c.riskScore}/100` : "—" },
          { label: "Tags", value: (c.tags as string[])?.join(", ") || "—" },
        ].map(({ label, value }) => (
          <div key={label} className="bg-muted/40 rounded-lg p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="font-medium capitalize truncate">{value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="timeline">
        <TabsList>
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

        {/* Timeline */}
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
            {(c.timeline ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground pl-6 py-4">No timeline events yet.</p>
            )}
          </div>
        </TabsContent>

        {/* Parties */}
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
                        <span className="font-semibold">{party.name}</span>
                        <Badge variant="outline" className="text-xs capitalize">{party.role}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 space-x-2">
                        {party.nin && <span>NIN: {party.nin}</span>}
                        {party.bvn && <span>BVN: {party.bvn}</span>}
                        {party.phone && <span>Tel: {party.phone}</span>}
                        {party.email && <span>{party.email}</span>}
                      </div>
                      {party.notes && <p className="text-xs text-muted-foreground mt-1 italic">{party.notes}</p>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {(c.parties ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No parties added yet.</p>
            )}
          </div>
        </TabsContent>

        {/* Documents */}
        <TabsContent value="documents" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button size="sm" onClick={() => setUploadDocOpen(true)}>
              <FilePlus className="w-4 h-4 mr-1" /> Upload Document
            </Button>
          </div>
          <div className="space-y-3">
            {(c.documents ?? []).map((doc: any) => {
              const isImage = doc.mimeType?.startsWith("image/");
              const isPdf = doc.mimeType === "application/pdf";
              const canPreview = isImage || isPdf;
              return (
                <Card key={doc.id}>
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {isImage ? <ImageIcon className="w-5 h-5 text-muted-foreground" /> : <FileText className="w-5 h-5 text-muted-foreground" />}
                        <div>
                          <p className="font-medium text-sm">{doc.filename}</p>
                          <p className="text-xs text-muted-foreground">
                            {doc.confidential && <span className="text-red-500 font-medium mr-1">CONFIDENTIAL ·</span>}
                            {doc.sizeBytes ? `${(doc.sizeBytes / 1024).toFixed(1)} KB` : ""} · {new Date(doc.createdAt).toLocaleDateString()}
                            {doc.description && ` · ${doc.description}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {canPreview && (
                          <Button variant="ghost" size="sm" onClick={() => setPreviewDoc({ url: doc.url, filename: doc.filename, mimeType: doc.mimeType })} title="Preview">
                            <Eye className="w-4 h-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" asChild title="Download">
                          <a href={doc.url} download={doc.filename} target="_blank" rel="noopener noreferrer">
                            <Download className="w-4 h-4" />
                          </a>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteDocId(doc.id)}
                          title="Delete document"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {(c.documents ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No documents uploaded yet. Click "Upload Document" to add files.</p>
            )}
          </div>

          {/* Upload Document Dialog */}
          <Dialog open={uploadDocOpen} onOpenChange={setUploadDocOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Upload Document</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <Label>File <span className="text-red-500">*</span></Label>
                  <Input
                    type="file"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt"
                    className="mt-1 cursor-pointer"
                    onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  />
                  <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, XLSX, PNG, JPG, TXT — max 16 MB</p>
                </div>
                <div>
                  <Label>Description</Label>
                  <Input
                    className="mt-1"
                    placeholder="Optional description"
                    value={uploadDescription}
                    onChange={(e) => setUploadDescription(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="confidential"
                    checked={uploadConfidential}
                    onChange={(e) => setUploadConfidential(e.target.checked)}
                    className="rounded"
                  />
                  <Label htmlFor="confidential" className="cursor-pointer">Mark as Confidential</Label>
                </div>
                {uploadFile && (
                  <p className="text-sm text-muted-foreground">
                    Selected: <span className="font-medium">{uploadFile.name}</span> ({(uploadFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setUploadDocOpen(false)}>Cancel</Button>
                <Button onClick={handleUploadDocument} disabled={!uploadFile || uploading}>
                  {uploading ? "Uploading..." : "Upload"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Delete Document Confirm Dialog */}
          <Dialog open={deleteDocId !== null} onOpenChange={(open) => { if (!open) setDeleteDocId(null); }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Delete Document</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground py-2">
                Are you sure you want to delete this document? This action cannot be undone. A record of the deletion will be added to the case timeline.
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteDocId(null)}>Cancel</Button>
                <Button
                  variant="destructive"
                  onClick={() => deleteDocId !== null && deleteDocument.mutate({ caseRef, documentId: deleteDocId })}
                  disabled={deleteDocument.isPending}
                >
                  {deleteDocument.isPending ? "Deleting..." : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Document Preview Dialog */}
          <Dialog open={!!previewDoc} onOpenChange={(open) => { if (!open) setPreviewDoc(null); }}>
            <DialogContent className="max-w-4xl w-full h-[80vh] flex flex-col">
              <DialogHeader className="flex-shrink-0">
                <div className="flex items-center justify-between">
                  <DialogTitle className="truncate max-w-lg">{previewDoc?.filename}</DialogTitle>
                  <div className="flex items-center gap-2">
                    {previewDoc && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={previewDoc.url} download={previewDoc.filename} target="_blank" rel="noopener noreferrer">
                          <Download className="w-4 h-4 mr-1" /> Download
                        </a>
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setPreviewDoc(null)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </DialogHeader>
              <div className="flex-1 overflow-hidden rounded-md border bg-muted">
                {previewDoc?.mimeType?.startsWith("image/") ? (
                  <div className="w-full h-full flex items-center justify-center p-4">
                    <img
                      src={previewDoc.url}
                      alt={previewDoc.filename}
                      className="max-w-full max-h-full object-contain rounded"
                    />
                  </div>
                ) : previewDoc?.mimeType === "application/pdf" ? (
                  <iframe
                    src={previewDoc.url}
                    title={previewDoc.filename}
                    className="w-full h-full border-0"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                    <FileText className="w-12 h-12" />
                    <p className="text-sm">Preview not available for this file type.</p>
                    {previewDoc && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={previewDoc.url} download={previewDoc.filename} target="_blank" rel="noopener noreferrer">
                          <Download className="w-4 h-4 mr-1" /> Download to view
                        </a>
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* Stakeholders */}
        <TabsContent value="stakeholders" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button size="sm" onClick={() => setInviteStakeholderOpen(true)}>
              <UserPlus className="w-4 h-4 mr-1" /> Invite Stakeholder
            </Button>
          </div>
          <div className="space-y-3">
            {(c.stakeholders ?? []).map((sh: any) => (
              <Card key={sh.id}>
                <CardContent className="py-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{sh.name}</span>
                        <Badge variant="outline" className="text-xs capitalize">{sh.role?.replace("_", " ")}</Badge>
                        {sh.canComment && <Badge className="text-xs bg-blue-100 text-blue-700">Can Comment</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{sh.email} {sh.organisation ? `· ${sh.organisation}` : ""}</p>
                      {sh.accessExpiresAt && (
                        <p className="text-xs text-muted-foreground">
                          Access expires: {new Date(sh.accessExpiresAt).toLocaleDateString()}
                          {sh.lastAccessedAt && ` · Last accessed: ${new Date(sh.lastAccessedAt).toLocaleDateString()}`}
                        </p>
                      )}
                    </div>
                    {sh.accessToken && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyPortalLink(sh.accessToken)}
                      >
                        {copiedToken === sh.accessToken ? (
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                        <span className="ml-1 text-xs">{copiedToken === sh.accessToken ? "Copied!" : "Copy Link"}</span>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
            {(c.stakeholders ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No stakeholders invited yet.</p>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Add Party Dialog */}
      <Dialog open={addPartyOpen} onOpenChange={setAddPartyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Party</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Role</Label>
              <Select value={partyForm.role} onValueChange={v => setPartyForm(f => ({ ...f, role: v as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["subject","witness","associate","victim","entity"].map(r => (
                    <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Full Name *</Label><Input value={partyForm.name} onChange={e => setPartyForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>NIN</Label><Input value={partyForm.nin} onChange={e => setPartyForm(f => ({ ...f, nin: e.target.value }))} /></div>
              <div><Label>BVN</Label><Input value={partyForm.bvn} onChange={e => setPartyForm(f => ({ ...f, bvn: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Phone</Label><Input value={partyForm.phone} onChange={e => setPartyForm(f => ({ ...f, phone: e.target.value }))} /></div>
              <div><Label>Email</Label><Input value={partyForm.email} onChange={e => setPartyForm(f => ({ ...f, email: e.target.value }))} /></div>
            </div>
            <div><Label>Notes</Label><Textarea value={partyForm.notes} onChange={e => setPartyForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddPartyOpen(false)}>Cancel</Button>
            <Button onClick={() => addParty.mutate({ caseRef, ...partyForm })} disabled={!partyForm.name.trim() || addParty.isPending}>
              {addParty.isPending ? "Adding..." : "Add Party"}
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
            <Button
              onClick={() => inviteStakeholder.mutate({ caseRef, ...stakeholderForm })}
              disabled={!stakeholderForm.name.trim() || !stakeholderForm.email.trim() || inviteStakeholder.isPending}
            >
              {inviteStakeholder.isPending ? "Inviting..." : "Send Invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Comment Dialog */}
      <Dialog open={addCommentOpen} onOpenChange={setAddCommentOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Note / Comment</DialogTitle></DialogHeader>
          <div className="py-2">
            <Textarea value={commentText} onChange={e => setCommentText(e.target.value)} rows={4} placeholder="Add a note, decision, or observation..." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddCommentOpen(false)}>Cancel</Button>
            <Button
              onClick={() => addTimelineEvent.mutate({ caseRef, eventType: "comment_added", title: commentText })}
              disabled={!commentText.trim() || addTimelineEvent.isPending}
            >
              {addTimelineEvent.isPending ? "Saving..." : "Add Note"}
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
            <Button
              onClick={() => updateCase.mutate({ ref: caseRef, status: newStatus as any })}
              disabled={!newStatus || updateCase.isPending}
            >
              {updateCase.isPending ? "Updating..." : "Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
