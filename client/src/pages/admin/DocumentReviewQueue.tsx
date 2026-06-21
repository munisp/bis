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
  AlertTriangle, Filter, RotateCcw, ChevronDown, History
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

// OCR field can be a plain string (v1 schema) or a {value, confidence} object (v2 schema)
type OcrFieldValue = string | null | { value: string | null; confidence: number };

interface DocRow {
  doc: KycDoc;
  subjectName: string | null;
  kycStatus: string | null;
  documentOcrData: Record<string, OcrFieldValue> | null;
  previousOcrData?: Record<string, OcrFieldValue> | null;
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
  onReview: (doc: KycDoc, decision: Decision, ocrData?: Record<string, OcrFieldValue> | null, previousOcrData?: Record<string, OcrFieldValue> | null) => void;
}) {
  const { doc, subjectName, kycStatus, documentOcrData, previousOcrData } = row;
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
              onClick={() => onReview(doc, "approved", documentOcrData, previousOcrData)}
            >
              <CheckCircle2 size={11} className="mr-1" /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-[10px] h-7 border-red-500/40 text-red-400 hover:bg-red-500/10"
              onClick={() => onReview(doc, "rejected", documentOcrData, previousOcrData)}
            >
              <XCircle size={11} className="mr-1" /> Reject
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-[10px] h-7 px-2 border-blue-500/40 text-blue-400 hover:bg-blue-500/10"
              onClick={() => onReview(doc, "reupload_requested", documentOcrData, previousOcrData)}
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

// Normalise an OCR field value to {value, confidence} regardless of schema version
function normaliseOcrField(raw: OcrFieldValue): { value: string | null; confidence: number } {
  if (raw === null || raw === undefined) return { value: null, confidence: 0 };
  if (typeof raw === 'string') return { value: raw, confidence: 1 }; // v1 schema — assume full confidence
  return { value: raw.value, confidence: raw.confidence ?? 0 };
}

// Returns Tailwind classes for a confidence badge
function confidenceClass(c: number): string {
  if (c >= 0.85) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  if (c >= 0.5)  return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  return 'bg-red-500/15 text-red-400 border-red-500/30';
}

function OcrDataPanel({
  ocrData,
  documentId,
  onReextract,
  reextractingField,
}: {
  ocrData: Record<string, OcrFieldValue> | null | undefined;
  documentId?: number;
  onReextract?: (fieldName: string) => void;
  reextractingField?: string | null;
}) {
  if (!ocrData) return null;

  const LABELS: Record<string, string> = {
    fullName: 'Full Name', surname: 'Surname', firstName: 'First Name',
    middleName: 'Middle Name', dateOfBirth: 'Date of Birth', gender: 'Gender',
    idNumber: 'ID Number', documentNumber: 'Document No.', nationality: 'Nationality',
    expiryDate: 'Expiry Date', issueDate: 'Issue Date', address: 'Address',
    placeOfBirth: 'Place of Birth', mrz: 'MRZ',
  };

  const entries = Object.entries(ocrData)
    .map(([k, raw]) => ({ key: k, ...normaliseOcrField(raw) }))
    .filter(e => e.value !== null && e.value !== '');

  if (entries.length === 0) return null;

  const lowConfidenceCount = entries.filter(e => e.confidence < 0.5).length;
  const medConfidenceCount = entries.filter(e => e.confidence >= 0.5 && e.confidence < 0.85).length;

  return (
    <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-mono font-semibold text-emerald-400 flex items-center gap-1">
          <span>🔍</span> OCR Extracted Fields
        </p>
        <div className="flex items-center gap-1">
          {lowConfidenceCount > 0 && (
            <span className={cn('text-[9px] font-mono px-1.5 py-0.5 rounded border', confidenceClass(0))}>
              {lowConfidenceCount} low
            </span>
          )}
          {medConfidenceCount > 0 && (
            <span className={cn('text-[9px] font-mono px-1.5 py-0.5 rounded border', confidenceClass(0.6))}>
              {medConfidenceCount} medium
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {entries.map(({ key, value, confidence }) => (
          <div key={key} className={cn(
            'flex flex-col rounded px-1.5 py-1 group',
            confidence < 0.5 ? 'bg-red-500/5 border border-red-500/20' :
            confidence < 0.85 ? 'bg-amber-500/5 border border-amber-500/20' :
            'bg-transparent border border-transparent'
          )}>
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wide">
                {LABELS[key] ?? key}
              </span>
              <div className="flex items-center gap-1">
                {onReextract && documentId && (
                  <button
                    type="button"
                    title={`Re-extract ${LABELS[key] ?? key} with AI`}
                    onClick={() => onReextract(key)}
                    disabled={!!reextractingField}
                    className={cn(
                      'opacity-0 group-hover:opacity-100 transition-opacity text-[8px] font-mono px-1 py-0.5 rounded border',
                      'border-primary/30 text-primary hover:bg-primary/10 disabled:opacity-30',
                      reextractingField === key && 'opacity-100'
                    )}
                  >
                    {reextractingField === key
                      ? <Loader2 size={8} className="animate-spin inline" />
                      : '↺'}
                  </button>
                )}
                <span className={cn(
                  'text-[8px] font-mono px-1 py-0.5 rounded border',
                  confidenceClass(confidence)
                )}>
                  {Math.round(confidence * 100)}%
                </span>
              </div>
            </div>
            <span
              className={cn(
                'text-[11px] font-mono truncate mt-0.5',
                confidence < 0.5 ? 'text-red-300' :
                confidence < 0.85 ? 'text-amber-300' :
                'text-foreground'
              )}
              title={value ?? ''}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── OCR History Timeline ────────────────────────────────────────────────────
/**
 * Shows a collapsible per-field history timeline fetched from kyc_ocr_history.
 * Displayed below the OcrDataPanel inside the ReviewDialog.
 */
function OcrHistoryTimeline({ documentId }: { documentId: number }) {
  const [open, setOpen] = useState(false);
  const { data: history, isLoading } = trpc.kyc.getOcrHistory.useQuery(
    { documentId },
    { enabled: open },
  );

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
      >
        <History size={11} />
        <span>OCR Re-extraction History</span>
        <ChevronDown size={10} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-2 space-y-2 max-h-48 overflow-y-auto pr-1">
          {isLoading ? (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Loader2 size={10} className="animate-spin" /> Loading history…
            </div>
          ) : !history?.length ? (
            <p className="text-[10px] text-muted-foreground">No re-extraction history for this document.</p>
          ) : (
            history.map((row) => (
              <div key={row.id} className="border border-border/40 rounded p-2 text-[10px] font-mono">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-primary/80 font-semibold">{row.fieldName}</span>
                  <span className="text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3">
                  <div>
                    <span className="text-[9px] text-muted-foreground uppercase">Before</span>
                    <p className="text-foreground/70 truncate">{row.oldValue ?? '—'}</p>
                  </div>
                  <div>
                    <span className="text-[9px] text-muted-foreground uppercase">After</span>
                    <p className="text-foreground truncate">{row.newValue ?? '—'}</p>
                  </div>
                </div>
                {row.newConfidence !== null && (
                  <span className={cn(
                    'text-[9px] px-1 py-0.5 rounded border mt-1 inline-block',
                    confidenceClass(Number(row.newConfidence)),
                  )}>
                    {Math.round(Number(row.newConfidence) * 100)}% confidence
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── OCR Diff Panel ───────────────────────────────────────────────────────────

const OCR_LABELS: Record<string, string> = {
  fullName: 'Full Name', surname: 'Surname', firstName: 'First Name',
  middleName: 'Middle Name', dateOfBirth: 'Date of Birth', gender: 'Gender',
  idNumber: 'ID Number', documentNumber: 'Document No.', nationality: 'Nationality',
  expiryDate: 'Expiry Date', issueDate: 'Issue Date', address: 'Address',
  placeOfBirth: 'Place of Birth', mrz: 'MRZ',
};

function OcrDiffPanel({
  before,
  after,
}: {
  before: Record<string, OcrFieldValue> | null | undefined;
  after: Record<string, OcrFieldValue> | null | undefined;
}) {
  if (!before || !after) return null;

  // Collect all keys from both snapshots
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));

  // Only show fields where value or confidence changed
  const changedFields = allKeys.filter(k => {
    const b = normaliseOcrField(before[k] ?? null);
    const a = normaliseOcrField(after[k] ?? null);
    return b.value !== a.value || Math.abs(b.confidence - a.confidence) > 0.01;
  });

  if (changedFields.length === 0) {
    return (
      <div className="mt-2 rounded-lg border border-border bg-muted/5 p-3">
        <p className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
          <span>✓</span> OCR re-run produced identical results — no field changes detected.
        </p>
      </div>
    );
  }

  const improved = changedFields.filter(k => {
    const b = normaliseOcrField(before[k] ?? null);
    const a = normaliseOcrField(after[k] ?? null);
    return a.confidence > b.confidence;
  }).length;

  const degraded = changedFields.filter(k => {
    const b = normaliseOcrField(before[k] ?? null);
    const a = normaliseOcrField(after[k] ?? null);
    return a.confidence < b.confidence;
  }).length;

  return (
    <div className="mt-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-mono font-semibold text-blue-400 flex items-center gap-1">
          <span>⟳</span> OCR Re-run Diff
        </p>
        <div className="flex items-center gap-1.5">
          {improved > 0 && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
              ↑ {improved} improved
            </span>
          )}
          {degraded > 0 && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border bg-red-500/10 text-red-400 border-red-500/30">
              ↓ {degraded} degraded
            </span>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        {changedFields.map(k => {
          const b = normaliseOcrField(before[k] ?? null);
          const a = normaliseOcrField(after[k] ?? null);
          const confidenceUp = a.confidence > b.confidence;
          const confidenceDown = a.confidence < b.confidence;
          return (
            <div key={k} className="rounded border border-border bg-muted/10 px-2 py-1.5">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wide">
                  {OCR_LABELS[k] ?? k}
                </span>
                <div className="flex items-center gap-1">
                  <span className={cn('text-[8px] font-mono px-1 py-0.5 rounded border', confidenceClass(b.confidence))}>
                    {Math.round(b.confidence * 100)}%
                  </span>
                  <span className="text-[8px] text-muted-foreground">→</span>
                  <span className={cn('text-[8px] font-mono px-1 py-0.5 rounded border', confidenceClass(a.confidence))}>
                    {Math.round(a.confidence * 100)}%
                    {confidenceUp && ' ↑'}
                    {confidenceDown && ' ↓'}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[8px] font-mono text-muted-foreground mb-0.5">Before</p>
                  <p className="text-[10px] font-mono text-muted-foreground line-through truncate" title={b.value ?? ''}>
                    {b.value ?? <em>empty</em>}
                  </p>
                </div>
                <div>
                  <p className="text-[8px] font-mono text-muted-foreground mb-0.5">After</p>
                  <p className={cn(
                    'text-[10px] font-mono truncate',
                    confidenceUp ? 'text-emerald-400' : confidenceDown ? 'text-red-400' : 'text-foreground'
                  )} title={a.value ?? ''}>
                    {a.value ?? <em>empty</em>}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReviewDialog({
  doc,
  decision,
  ocrData,
  previousOcrData,
  onConfirm,
  onCancel,
  isPending,
  onRerunOcr,
  isRerunningOcr,
  onReextract,
  reextractingField,
}: {
  doc: KycDoc | null;
  decision: Decision | null;
  ocrData?: Record<string, OcrFieldValue> | null;
  previousOcrData?: Record<string, OcrFieldValue> | null;
  onConfirm: (note: string) => void;
  onCancel: () => void;
  isPending: boolean;
  onRerunOcr?: () => void;
  isRerunningOcr?: boolean;
  onReextract?: (fieldName: string) => void;
  reextractingField?: string | null;
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

        <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto">
          {/* OCR diff view — shown when previousOcrData exists (after a re-run) */}
          {previousOcrData && ocrData
            ? <OcrDiffPanel before={previousOcrData} after={ocrData} />
            : <OcrDataPanel
                ocrData={ocrData}
                documentId={doc?.id}
                onReextract={onReextract}
                reextractingField={reextractingField}
              />
          }
          {/* OCR history timeline — collapsible, lazy-loaded */}
          {doc?.id && <OcrHistoryTimeline documentId={doc.id} />}
          {onRerunOcr && (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-[10px] font-mono h-6 px-2"
                onClick={onRerunOcr}
                disabled={isRerunningOcr}
                title="Re-extract document fields with AI OCR"
              >
                {isRerunningOcr
                  ? <Loader2 size={10} className="animate-spin" />
                  : <RefreshCw size={10} />}
                Re-run OCR
              </Button>
            </div>
          )}

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
  const [reviewTarget, setReviewTarget] = useState<{ doc: KycDoc; decision: Decision; ocrData?: Record<string, OcrFieldValue> | null; previousOcrData?: Record<string, OcrFieldValue> | null } | null>(null);

  const utils = trpc.useUtils();

  const [reextractingField, setReextractingField] = useState<string | null>(null);

  const rerunOcrMutation = trpc.kyc.rerunOcr.useMutation({
    onSuccess: () => {
      toast.success("OCR re-run queued — results will appear in a few seconds");
      // Refresh the list after a short delay to pick up updated OCR data
      setTimeout(() => utils.kyc.listPendingDocuments.invalidate(), 3000);
    },
    onError: (err) => toast.error(`OCR re-run failed: ${err.message}`),
  });

  const reextractFieldMutation = trpc.kyc.reextractField.useMutation({
    onSuccess: (data) => {
      const conf = Math.round((data.result.confidence ?? 0) * 100);
      toast.success(`Re-extracted "${data.fieldName}" — confidence ${conf}%`);
      setReextractingField(null);
      // Update the reviewTarget ocrData in-place so the panel refreshes immediately
      setReviewTarget(prev => {
        if (!prev) return prev;
        const updatedOcrData = { ...(prev.ocrData ?? {}), [data.fieldName]: data.result };
        return { ...prev, ocrData: updatedOcrData };
      });
    },
    onError: (err) => {
      toast.error(`Re-extraction failed: ${err.message}`);
      setReextractingField(null);
    },
  });

  function handleReextractField(fieldName: string) {
    if (!reviewTarget?.doc?.id) return;
    setReextractingField(fieldName);
    reextractFieldMutation.mutate({ documentId: reviewTarget.doc.id, fieldName });
  }

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

  function handleReview(doc: KycDoc, decision: Decision, ocrData?: Record<string, OcrFieldValue> | null, previousOcrData?: Record<string, OcrFieldValue> | null) {
    setReviewTarget({ doc, decision, ocrData, previousOcrData });
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
        previousOcrData={reviewTarget?.previousOcrData}
        onConfirm={handleConfirm}
        onCancel={() => setReviewTarget(null)}
        isPending={reviewMutation.isPending}
        onRerunOcr={reviewTarget?.doc
          ? () => rerunOcrMutation.mutate({ documentId: reviewTarget.doc.id })
          : undefined
        }
        isRerunningOcr={rerunOcrMutation.isPending}
        onReextract={reviewTarget?.doc ? handleReextractField : undefined}
        reextractingField={reextractingField}
      />
    </BISLayout>
  );
}
