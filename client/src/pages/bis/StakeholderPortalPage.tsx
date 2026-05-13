import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Shield, Clock, FileText, AlertTriangle, MessageSquare,
  RefreshCw, Send, Bell, Upload, Paperclip, X, Download, Eye, ChevronDown, ChevronUp,
} from "lucide-react";
import { toast } from "sonner";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  open: "bg-blue-100 text-blue-700",
  under_review: "bg-amber-100 text-amber-700",
  pending_decision: "bg-orange-100 text-orange-700",
  closed: "bg-green-100 text-green-700",
  archived: "bg-slate-100 text-slate-500",
};

const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg / .jpeg",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};

const POLL_INTERVAL_MS = 30_000; // 30 seconds

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function StakeholderPortalPage() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token"));
  }, []);

  const { data, isLoading, error } = trpc.cases.portalAccess.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );

  // ── Real-time polling state ──────────────────────────────────────────────
  const [lastPollAt, setLastPollAt] = useState<string>(() => new Date().toISOString());
  const [newBadge, setNewBadge] = useState(0);
  const [allComments, setAllComments] = useState<any[]>([]);
  const [allDocuments, setAllDocuments] = useState<any[]>([]);
  const [previewDocId, setPreviewDocId] = useState<number | null>(null);
  const initialised = useRef(false);

  useEffect(() => {
    if (data && !initialised.current) {
      initialised.current = true;
      setAllDocuments(data.documents ?? []);
    }
  }, [data]);

  const pollQuery = trpc.cases.portalPollUpdates.useQuery(
    { token: token ?? "", since: lastPollAt },
    {
      enabled: !!token && !!data,
      refetchInterval: POLL_INTERVAL_MS,
      refetchIntervalInBackground: false,
    }
  );

  const prevPollDataRef = useRef<typeof pollQuery.data | null>(null);
  useEffect(() => {
    const result = pollQuery.data;
    if (!result || result === prevPollDataRef.current) return;
    prevPollDataRef.current = result;
    const hasNew = result.newComments.length > 0 || result.newDocuments.length > 0;
    if (hasNew) {
      setAllComments((prev) => {
        const existingIds = new Set(prev.map((c: any) => c.id));
        return [...prev, ...result.newComments.filter((c: any) => !existingIds.has(c.id))];
      });
      setAllDocuments((prev) => {
        const existingIds = new Set(prev.map((d: any) => d.id));
        return [...prev, ...result.newDocuments.filter((d: any) => !existingIds.has(d.id))];
      });
      setNewBadge((n) => n + result.newComments.length + result.newDocuments.length);
      toast.success("New updates", {
        description: `${result.newComments.length} comment(s) and ${result.newDocuments.length} document(s) added.`,
      });
    }
    setLastPollAt(result.pollTimestamp);
  }, [pollQuery.data]);

  // ── Comment submission ───────────────────────────────────────────────────
  const [commentText, setCommentText] = useState("");
  const postComment = trpc.cases.portalPostComment.useMutation({
    onSuccess: (comment) => {
      setAllComments((prev) => [...prev, comment]);
      setCommentText("");
      toast.success("Comment posted");
    },
    onError: (err) => toast.error("Failed to post comment", { description: err.message }),
  });

  // ── File upload state ────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [fileDescription, setFileDescription] = useState("");
  const [uploadProgress, setUploadProgress] = useState(false);

  const uploadDocument = trpc.cases.portalUploadDocument.useMutation({
    onSuccess: (doc) => {
      setAllDocuments((prev) => [...prev, doc]);
      setPendingFile(null);
      setFileDescription("");
      setUploadProgress(false);
      toast.success("Document uploaded", { description: `${doc.filename} (${formatBytes(doc.sizeBytes)}) attached successfully.` });
    },
    onError: (err) => {
      setUploadProgress(false);
      toast.error("Upload failed", { description: err.message });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_TYPES[file.type]) {
      toast.error("File type not allowed", {
        description: `Allowed types: ${Object.values(ALLOWED_TYPES).join(", ")}`,
      });
      e.target.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large", { description: "Maximum file size is 10 MB." });
      e.target.value = "";
      return;
    }
    setPendingFile(file);
  };

  const handleUpload = async () => {
    if (!pendingFile || !token) return;
    setUploadProgress(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      // Strip the data:mime/type;base64, prefix
      const base64 = dataUrl.split(",")[1] ?? "";
      uploadDocument.mutate({
        token,
        filename: pendingFile.name,
        mimeType: pendingFile.type,
        base64Content: base64,
        description: fileDescription.trim() || undefined,
        postComment: true,
      });
    };
    reader.onerror = () => {
      setUploadProgress(false);
      toast.error("Failed to read file");
    };
    reader.readAsDataURL(pendingFile);
  };

  // ── Guard states ─────────────────────────────────────────────────────────
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 pb-8 text-center">
            <AlertTriangle className="w-12 h-12 text-orange-500 mx-auto mb-3" />
            <h2 className="text-xl font-bold">Invalid Access Link</h2>
            <p className="text-muted-foreground mt-2">
              This portal link is missing a required access token. Please use the link provided in your invitation email.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-muted-foreground">Verifying access…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 pb-8 text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-3" />
            <h2 className="text-xl font-bold">Access Denied</h2>
            <p className="text-muted-foreground mt-2">
              {error?.message === "Access token expired"
                ? "Your access link has expired. Please contact the case lead to request a new link."
                : "This access link is invalid or has been revoked."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { case: c, stakeholder, timeline } = data;

  return (
    <div className="min-h-screen bg-muted/20">
      {/* Header */}
      <div className="bg-background border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Secure Stakeholder Portal</p>
              <p className="font-semibold text-sm">BIS Compliance Platform</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {newBadge > 0 && (
              <button
                onClick={() => setNewBadge(0)}
                className="relative flex items-center gap-1.5 text-xs bg-primary/10 text-primary px-2 py-1 rounded-full hover:bg-primary/20 transition-colors"
              >
                <Bell className="w-3.5 h-3.5" />
                {newBadge} new
              </button>
            )}
            <div className="text-right text-xs text-muted-foreground">
              <p>Viewing as: <span className="font-medium text-foreground">{stakeholder.name}</span></p>
              <p className="capitalize">{stakeholder.role?.replace(/_/g, " ")}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Case Summary */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-mono text-muted-foreground">{c.ref}</p>
                <CardTitle className="text-xl mt-1">{c.title}</CardTitle>
              </div>
              <Badge className={`text-xs ${STATUS_COLORS[c.status] ?? ""}`}>
                {c.status?.replace("_", " ")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {c.summary && <p className="text-muted-foreground text-sm mb-4">{c.summary}</p>}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              {[
                { label: "Type", value: c.type?.replace("_", " ") },
                { label: "Priority", value: c.priority },
                { label: "Jurisdiction", value: c.jurisdiction || "—" },
                { label: "Legal Basis", value: c.legalBasis || "—" },
                { label: "Created", value: new Date(c.createdAt).toLocaleDateString() },
                { label: "Due", value: c.dueAt ? new Date(c.dueAt).toLocaleDateString() : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="bg-muted/40 rounded p-2">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="font-medium capitalize">{value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Timeline */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" /> Case Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative border-l-2 border-border ml-3 space-y-4">
              {timeline.map((event: any) => (
                <div key={event.id} className="relative pl-5">
                  <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-background border-2 border-primary" />
                  <div className="bg-muted/40 rounded p-3">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-sm">{event.title}</p>
                      <span className="text-xs text-muted-foreground">
                        {new Date(event.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {event.actorName && (
                      <p className="text-xs text-muted-foreground mt-0.5">by {event.actorName}</p>
                    )}
                  </div>
                </div>
              ))}
              {timeline.length === 0 && (
                <p className="pl-5 text-sm text-muted-foreground">No timeline events yet.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Documents */}
        {stakeholder.canViewDocuments && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4" /> Documents
                {pollQuery.isFetching && (
                  <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground ml-auto" />
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Document list */}
              {allDocuments.length > 0 ? (
                <div className="space-y-2">
                  {allDocuments.map((doc: any) => {
                    const isImage = doc.mimeType?.startsWith("image/");
                    const isPdf = doc.mimeType === "application/pdf";
                    const canPreview = isImage || isPdf;
                    const isOpen = previewDocId === doc.id;
                    return (
                      <div key={doc.id} className="border rounded-lg overflow-hidden">
                        {/* Row header */}
                        <div className="flex items-center justify-between p-3 bg-muted/40">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate">{doc.filename}</p>
                            <p className="text-xs text-muted-foreground">
                              {doc.category?.replace(/_/g, " ")}
                              {doc.sizeBytes ? ` · ${formatBytes(doc.sizeBytes)}` : ""}
                              {" · "}{new Date(doc.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 ml-3 shrink-0">
                            {canPreview && (
                              <button
                                onClick={() => setPreviewDocId(isOpen ? null : doc.id)}
                                className="flex items-center gap-1 text-xs text-primary hover:underline"
                                title={isOpen ? "Hide preview" : "Preview inline"}
                              >
                                {isOpen ? <ChevronUp className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                {isOpen ? "Hide" : "Preview"}
                              </button>
                            )}
                            <a
                              href={doc.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
                            >
                              <Download className="w-3 h-3" /> Download
                            </a>
                          </div>
                        </div>
                        {/* Inline preview panel */}
                        {isOpen && (
                          <div className="border-t bg-background">
                            {isImage ? (
                              <img
                                src={doc.url}
                                alt={doc.filename}
                                className="max-w-full max-h-[480px] object-contain mx-auto block p-2"
                                loading="lazy"
                              />
                            ) : isPdf ? (
                              <iframe
                                src={`${doc.url}#toolbar=0`}
                                title={doc.filename}
                                className="w-full h-[520px] border-0"
                                loading="lazy"
                              />
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No documents shared yet.</p>
              )}

              {/* File upload — shown to all stakeholders who can view documents */}
              <div className="pt-3 border-t space-y-3">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5" /> Submit a Document
                </p>

                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={Object.keys(ALLOWED_TYPES).join(",")}
                  className="hidden"
                  onChange={handleFileSelect}
                />

                {!pendingFile ? (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 hover:bg-muted/30 transition-colors group"
                  >
                    <Paperclip className="w-6 h-6 text-muted-foreground group-hover:text-primary mx-auto mb-2 transition-colors" />
                    <p className="text-sm font-medium">Click to select a file</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      PDF, PNG, JPEG, DOC, DOCX, XLS, XLSX · Max 10 MB
                    </p>
                  </button>
                ) : (
                  <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{pendingFile.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {pendingFile.type} · {formatBytes(pendingFile.size)}
                        </p>
                      </div>
                      <button
                        onClick={() => { setPendingFile(null); setFileDescription(""); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                        className="text-muted-foreground hover:text-destructive ml-2 shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="file-desc" className="text-xs">Description (optional)</Label>
                      <Input
                        id="file-desc"
                        placeholder="Brief description of this document…"
                        value={fileDescription}
                        onChange={(e) => setFileDescription(e.target.value)}
                        maxLength={500}
                        className="text-sm h-8"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleUpload}
                        disabled={uploadProgress}
                        className="flex-1"
                      >
                        <Upload className="w-3.5 h-3.5 mr-1.5" />
                        {uploadProgress ? "Uploading…" : "Upload Document"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadProgress}
                      >
                        Change File
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Comments */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> Comments
              {pollQuery.isFetching && (
                <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground ml-auto" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {allComments.length === 0 && (
              <p className="text-sm text-muted-foreground">No comments yet.</p>
            )}
            <div className="space-y-3">
              {allComments.map((comment: any) => (
                <div key={comment.id} className="p-3 bg-muted/40 rounded">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-foreground">
                      {comment.authorName ?? "Unknown"}
                      {comment.authorRole && (
                        <span className="text-muted-foreground font-normal capitalize ml-1">
                          · {comment.authorRole.replace(/_/g, " ")}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(comment.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{comment.content}</p>
                </div>
              ))}
            </div>

            {stakeholder.canComment && (
              <div className="pt-2 border-t space-y-2">
                <Textarea
                  placeholder="Write a comment…"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  className="resize-none text-sm"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{commentText.length}/2000</span>
                  <Button
                    size="sm"
                    disabled={!commentText.trim() || postComment.isPending}
                    onClick={() =>
                      postComment.mutate({ token: token!, content: commentText.trim() })
                    }
                  >
                    <Send className="w-3.5 h-3.5 mr-1.5" />
                    {postComment.isPending ? "Posting…" : "Post Comment"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground pb-4">
          Secure view of case {c.ref}. Access expires on{" "}
          {stakeholder.accessExpiresAt
            ? new Date(stakeholder.accessExpiresAt).toLocaleDateString()
            : "—"}
          . All access and uploads are logged and audited. Auto-refreshes every 30 seconds.
        </p>
      </div>
    </div>
  );
}
