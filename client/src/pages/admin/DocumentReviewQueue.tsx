/**
 * DocumentReviewQueue — Admin KYC Document Review Page
 * ======================================================
 * Displays a paginated grid of uploaded KYC documents awaiting review.
 * Admins can approve, reject, or request re-upload with an optional note.
 * Route: /admin/documents (wrapped in AdminRoute)
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2, XCircle, RefreshCw, FileText, Loader2,
  Clock, Eye, ChevronRight, User, Calendar, HardDrive,
  AlertTriangle, Filter, RotateCcw
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReviewStatus = "pending" | "approved" | "rejected" | "reupload_requested";
type Decision = "approved" | "rejected" | "reupload_requested";

interface KycDoc {
  id: number;
  kycRecordId: number;
  documentType: string;
  fileName: string;
  fileUrl: string;
  fileSizeBytes: number | null;
  mimeType: string | null;
  reviewStatus: ReviewStatus;
  reviewedBy: number | null;
  reviewNote: string | null;
  reviewedAt: Date | null;
  uploadedBy: number;
  capturedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface DocRow {
  doc: KycDoc;
  subjectName: string | null;
  kycStatus: string | null;
  documentOcrData: Record<string, string | null> | null;
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ReviewStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending:            { label: "Pending Review", color: "bg-amber-500/15 text-amber-400 border-amber-500/30",   icon: <Clock size={11} /> },
  approved:           { label: "Approved",       color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: <CheckCircle2 size={11} /> },
  rejected:           { label: "Rejected",       color: "bg-red-500/15 text-red-400 border-red-500/30",         icon: <XCircle size={11} /> },
  reupload_requested: { label: "Re-upload Req.", color: "bg-blue-500/15 text-blue-400 border-blue-500/30",      icon: <RotateCcw size={11} /> },
};

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  national_id:    "National ID",
  passport:       "Passport",
  drivers_license: "Driver's Licence",
  voters_card:    "Voter's Card",
  utility_bill:   "Utility Bill",
  bank_statement: "Bank Statement",
  cac_certificate: "CAC Certificate",
  other:          "Other",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

// ─── Document Card ────────────────────────────────────────────────────────────

function DocumentCard({
  row,
  onReview,
}: {
  row: DocRow;
  onReview: (doc: KycDoc, decision: Decision, ocrData?: Record<string, string | null> | null) => void;
}) {
  const { doc, subjectName, kycStatus, documentOcrData } = row;
  const statusCfg = STATUS_CONFIG[doc.reviewStatus];
  const docLabel = DOCUMENT_TYPE_LABELS[doc.documentType] ?? doc.documentType;
  const isImage = doc.mimeType?.startsWith("image/") ?? false;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col hover:border-primary/30 transition-colors">
      {/* Thumbnail / Preview */}
      <div className="relative h-40 bg-muted/30 flex items-center justify-center border-b border-border">
        {isImage ? (
          <img
            src={doc.fileUrl}
            alt={doc.fileName}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <FileText size={32} className="opacity-40" />
            <span className="text-[10px] font-mono uppercase">{doc.mimeType ?? "document"}</span>
          </div>
        )}
        {/* Status badge overlay */}
        <div className="absolute top-2 right-2">
          <span className={cn("inline-flex items-center gap-1 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border", statusCfg.color)}>
            {statusCfg.icon}
            {statusCfg.label}
          </span>
        </div>
      </div>

      {/* Card body */}
      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Document type + file name */}
        <div>
          <p className="text-xs font-mono font-bold text-foreground">{docLabel}</p>
          <p className="text-[10px] text-muted-foreground truncate mt-0.5">{doc.fileName}</p>
        </div>

        {/* Subject info */}
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <User size={10} />
          <span className="font-mono truncate">{subjectName ?? `KYC #${doc.kycRecordId}`}</span>
          {kycStatus && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-auto">{kycStatus}</Badge>
          )}
        </div>

        {/* Metadata row */}
        <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <Calendar size={9} />
            <span>{formatDate(doc.createdAt)}</span>
          </div>
          <div className="flex items-center gap-1">
            <HardDrive size={9} />
            <span>{formatBytes(doc.fileSizeBytes)}</span>
          </div>
        </div>

        {/* Review note (if any) */}
        {doc.reviewNote && (
          <div className="bg-muted/20 rounded p-2 text-[10px] text-muted-foreground border border-border/50">
            <span className="font-mono font-bold">Note: </span>{doc.reviewNote}
          </div>
        )}

        {/* Action buttons — only shown for pending docs */}
        {doc.reviewStatus === "pending" && (
          <div className="flex gap-2 mt-auto pt-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-[10px] h-7 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
              onClick={() => onReview(doc, "approved", documentOcrData)}
            >
              <CheckCircle2 size={11} className="mr-1" /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-[10px] h-7 border-red-500/40 text-red-400 hover:bg-red-500/10"
              onClick={() => onReview(doc, "rejected", documentOcrData)}
            >
              <XCircle size={11} className="mr-1" /> Reject
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-[10px] h-7 px-2 border-blue-500/40 text-blue-400 hover:bg-blue-500/10"
              onClick={() => onReview(doc, "reupload_requested", documentOcrData)}
              title="Request re-upload"
            >
              <RotateCcw size={11} />
            </Button>
          </div>
        )}

        {/* View file link */}
        <a
          href={doc.fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[10px] font-mono text-primary/70 hover:text-primary transition-colors"
        >
          <Eye size={10} /> View file <ChevronRight size={9} />
        </a>
      </div>
    </div>
  );
}

// ─── Review Dialog ────────────────────────────────────────────────────────────

function OcrDataPanel({ ocrData }: { ocrData: Record<string, string | null> | null | undefined }) {
  if (!ocrData) return null;
  const entries = Object.entries(ocrData).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (entries.length === 0) return null;
  const LABELS: Record<string, string> = {
    fullName: "Full Name", surname: "Surname", firstName: "First Name",
    middleName: "Middle Name", dateOfBirth: "Date of Birth", gender: "Gender",
    idNumber: "ID Number", documentNumber: "Document No.", nationality: "Nationality",
    expiryDate: "Expiry Date", issueDate: "Issue Date", address: "Address",
    placeOfBirth: "Place of Birth", mrz: "MRZ",
  };
  return (
    <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
      <p className="text-[10px] font-mono font-semibold text-emerald-400 mb-2 flex items-center gap-1">
        <span>🔍</span> OCR Extracted Fields
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {entries.map(([k, v]) => (
          <div key={k} className="flex flex-col">
            <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wide">
              {LABELS[k] ?? k}
            </span>
            <span className="text-[11px] font-mono text-foreground truncate" title={v ?? ""}>
              {v}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewDialog({
  doc,
  decision,
  ocrData,
  onConfirm,
  onCancel,
  isPending,
}: {
  doc: KycDoc | null;
  decision: Decision | null;
  ocrData?: Record<string, string | null> | null;
  onConfirm: (note: string) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [note, setNote] = useState("");

  if (!doc || !decision) return null;

  const requireNote = decision === "rejected" || decision === "reupload_requested";
  const decisionLabel = decision === "approved" ? "Approve" : decision === "rejected" ? "Reject" : "Request Re-upload";
  const decisionColor = decision === "approved" ? "text-emerald-400" : decision === "rejected" ? "text-red-400" : "text-blue-400";

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className={cn("font-mono text-sm", decisionColor)}>
            {decisionLabel} Document
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {DOCUMENT_TYPE_LABELS[doc.documentType] ?? doc.documentType} — {doc.fileName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* OCR extracted fields — read-only preview */}
          <OcrDataPanel ocrData={ocrData} />

          {requireNote && (
            <div className="space-y-1.5">
              <label className="text-xs font-mono text-muted-foreground">
                {decision === "rejected" ? "Rejection reason" : "Re-upload instructions"}{" "}
                <span className="text-red-400">*</span>
              </label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={decision === "rejected" ? "Explain why this document was rejected..." : "Describe what needs to be corrected..."}
                className="text-xs font-mono min-h-[80px] resize-none"
              />
            </div>
          )}
          {!requireNote && (
            <div className="space-y-1.5">
              <label className="text-xs font-mono text-muted-foreground">Note (optional)</label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional approval note..."
                className="text-xs font-mono min-h-[60px] resize-none"
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={isPending || (requireNote && !note.trim())}
            onClick={() => onConfirm(note)}
            className={cn(
              decision === "approved" && "bg-emerald-600 hover:bg-emerald-700 text-white",
              decision === "rejected" && "bg-red-600 hover:bg-red-700 text-white",
              decision === "reupload_requested" && "bg-blue-600 hover:bg-blue-700 text-white",
            )}
          >
            {isPending ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
            Confirm {decisionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DocumentReviewQueue() {
  const [statusFilter, setStatusFilter] = useState<ReviewStatus>("pending");
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<number[]>([]);
  const [reviewTarget, setReviewTarget] = useState<{ doc: KycDoc; decision: Decision; ocrData?: Record<string, string | null> | null } | null>(null);

  const utils = trpc.useUtils();

  const { data, isLoading, isError } = trpc.kyc.listPendingDocuments.useQuery({
    status: statusFilter,
    limit: 24,
    cursor,
  });

  const reviewMutation = trpc.kyc.reviewDocument.useMutation({
    onSuccess: (result) => {
      toast.success(`Document ${result.reviewStatus.replace("_", " ")} successfully`);
      setReviewTarget(null);
      utils.kyc.listPendingDocuments.invalidate();
    },
    onError: (err) => {
      toast.error(`Review failed: ${err.message}`);
    },
  });

  function handleReview(doc: KycDoc, decision: Decision, ocrData?: Record<string, string | null> | null) {
    setReviewTarget({ doc, decision, ocrData });
  }

  function handleConfirm(note: string) {
    if (!reviewTarget) return;
    reviewMutation.mutate({
      documentId: reviewTarget.doc.id,
      decision: reviewTarget.decision,
      reviewNote: note || undefined,
    });
  }

  function handleNextPage() {
    if (data?.nextCursor) {
      setCursorStack(prev => [...prev, cursor ?? 0]);
      setCursor(data.nextCursor);
    }
  }

  function handlePrevPage() {
    const prev = [...cursorStack];
    const last = prev.pop();
    setCursorStack(prev);
    setCursor(last === 0 ? undefined : last);
  }

  const items = data?.items ?? [];
  const hasNext = !!data?.nextCursor;
  const hasPrev = cursorStack.length > 0;

  return (
    <BISLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-mono font-bold text-foreground">Document Review Queue</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Review KYC documents uploaded by field agents and mobile users
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs font-mono"
            onClick={() => utils.kyc.listPendingDocuments.invalidate()}
          >
            <RefreshCw size={12} /> Refresh
          </Button>
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-3">
          <Filter size={13} className="text-muted-foreground" />
          <span className="text-xs font-mono text-muted-foreground">Filter:</span>
          <div className="flex gap-2">
            {(["pending", "approved", "rejected", "reupload_requested"] as ReviewStatus[]).map(s => {
              const cfg = STATUS_CONFIG[s];
              return (
                <button
                  key={s}
                  onClick={() => { setStatusFilter(s); setCursor(undefined); setCursorStack([]); }}
                  className={cn(
                    "inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-1 rounded border transition-colors",
                    statusFilter === s ? cfg.color : "border-border text-muted-foreground hover:border-primary/30"
                  )}
                >
                  {cfg.icon}
                  {cfg.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        {isLoading && (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 size={20} className="animate-spin mr-2" />
            <span className="text-sm font-mono">Loading documents…</span>
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm font-mono">
            <AlertTriangle size={14} />
            Failed to load documents. Please refresh.
          </div>
        )}

        {!isLoading && !isError && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <CheckCircle2 size={32} className="mb-3 opacity-30" />
            <p className="text-sm font-mono">No documents with status "{STATUS_CONFIG[statusFilter].label}"</p>
          </div>
        )}

        {!isLoading && items.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map(row => (
              <DocumentCard
                key={row.doc.id}
                row={row as DocRow}
                onReview={handleReview}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {(hasPrev || hasNext) && (
          <div className="flex items-center justify-center gap-3 pt-4">
            <Button
              variant="outline"
              size="sm"
              disabled={!hasPrev}
              onClick={handlePrevPage}
              className="text-xs font-mono"
            >
              ← Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNext}
              onClick={handleNextPage}
              className="text-xs font-mono"
            >
              Next →
            </Button>
          </div>
        )}
      </div>

      {/* Review dialog */}
      <ReviewDialog
        doc={reviewTarget?.doc ?? null}
        decision={reviewTarget?.decision ?? null}
        ocrData={reviewTarget?.ocrData}
        onConfirm={handleConfirm}
        onCancel={() => setReviewTarget(null)}
        isPending={reviewMutation.isPending}
      />
    </BISLayout>
  );
}
