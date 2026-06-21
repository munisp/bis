/**
 * AccessReviewPanel — Periodic least-privilege access review task manager.
 *
 * Lists all access-review tasks with approve/revoke/escalate actions.
 * Integrates with Temporal workflows for SLA tracking.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  UserCheck, Clock, CheckCircle2, XCircle, AlertTriangle,
  RefreshCw, Search, ChevronLeft, ChevronRight, ShieldAlert,
  Calendar, User, ArrowUpCircle
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  pending:   "bg-amber-500/20 text-amber-400 border-amber-500/40",
  approved:  "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
  revoked:   "bg-red-500/20 text-red-400 border-red-500/40",
  escalated: "bg-orange-500/20 text-orange-400 border-orange-500/40",
  expired:   "bg-slate-500/20 text-slate-400 border-slate-500/40",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold border", STATUS_COLORS[status] ?? "bg-muted text-muted-foreground border-border/40")}>
      {status.toUpperCase()}
    </span>
  );
}

function SlaIndicator({ dueAt }: { dueAt: Date | string }) {
  const due = new Date(dueAt);
  const now = new Date();
  const hoursLeft = (due.getTime() - now.getTime()) / (1000 * 60 * 60);
  const isOverdue = hoursLeft < 0;
  const isUrgent = hoursLeft < 4 && !isOverdue;

  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[10px] font-mono",
      isOverdue ? "text-red-400" : isUrgent ? "text-orange-400" : "text-muted-foreground"
    )}>
      <Clock size={9} />
      {isOverdue
        ? `Overdue by ${Math.abs(Math.round(hoursLeft))}h`
        : `${Math.round(hoursLeft)}h left`}
    </span>
  );
}

// ─── Dialogs ─────────────────────────────────────────────────────────────────

interface CompleteDialogProps {
  reviewId: number;
  subjectId: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

function CompleteDialog({ reviewId, subjectId, open, onClose, onDone }: CompleteDialogProps) {
  const [decision, setDecision] = useState<"approved" | "revoked">("approved");
  const [notes, setNotes] = useState("");

  const complete = trpc.insiderThreat.completeAccessReview.useMutation({
    onSuccess: () => {
      toast.success(`Access review ${decision}`);
      onDone();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Complete Access Review</DialogTitle>
          <DialogDescription className="text-xs font-mono">
            Subject: <strong>{subjectId}</strong>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-mono">Decision</Label>
            <Select value={decision} onValueChange={v => setDecision(v as "approved" | "revoked")}>
              <SelectTrigger className="h-8 text-xs font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="approved">Approve — access retained</SelectItem>
                <SelectItem value="revoked">Revoke — access removed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-mono">Notes (optional)</Label>
            <Textarea
              placeholder="Justification or notes..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="text-xs font-mono h-20 resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">Cancel</Button>
          <Button
            size="sm"
            className={cn("text-xs", decision === "revoked" ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700")}
            disabled={complete.isPending}
            onClick={() => complete.mutate({ id: reviewId, decision, notes: notes || undefined })}
          >
            {complete.isPending ? <RefreshCw size={11} className="animate-spin mr-1" /> : null}
            {decision === "approved" ? "Approve" : "Revoke"} Access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface EscalateDialogProps {
  reviewId: number;
  subjectId: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

function EscalateDialog({ reviewId, subjectId, open, onClose, onDone }: EscalateDialogProps) {
  const [reason, setReason] = useState("");

  const escalate = trpc.insiderThreat.escalateAccessReview.useMutation({
    onSuccess: () => {
      toast.success("Review escalated to senior analyst");
      onDone();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Escalate Access Review</DialogTitle>
          <DialogDescription className="text-xs font-mono">
            Subject: <strong>{subjectId}</strong>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-mono">Escalation Reason *</Label>
            <Textarea
              placeholder="Why is this being escalated?"
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="text-xs font-mono h-24 resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">Cancel</Button>
          <Button
            size="sm"
            className="text-xs bg-orange-600 hover:bg-orange-700"
            disabled={!reason.trim() || escalate.isPending}
            onClick={() => escalate.mutate({ id: reviewId, reason })}
          >
            {escalate.isPending ? <RefreshCw size={11} className="animate-spin mr-1" /> : null}
            Escalate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

export default function AccessReviewPanel() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [page, setPage] = useState(0);
  const [completeDialog, setCompleteDialog] = useState<{ id: number; subjectId: string } | null>(null);
  const [escalateDialog, setEscalateDialog] = useState<{ id: number; subjectId: string } | null>(null);

  const { data, isLoading, refetch } = trpc.insiderThreat.listAccessReviews.useQuery({
    status: statusFilter !== "all" ? (statusFilter as any) : undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }, { refetchInterval: 30_000 });

  const filteredRows = (data?.rows ?? []).filter(r =>
    !search || r.subjectId.toLowerCase().includes(search.toLowerCase())
  );
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const pendingCount = statusFilter === "pending" ? total : undefined;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <UserCheck size={20} className="text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold font-mono text-foreground">Access Reviews</h1>
            <p className="text-xs text-muted-foreground font-mono">Least-privilege review tasks — approve, revoke, or escalate</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 text-xs">
          <RefreshCw size={12} /> Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search subject ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs font-mono"
          />
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="h-8 w-36 text-xs font-mono">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="escalated">Escalated</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="revoked">Revoked</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs font-mono text-muted-foreground">{total} reviews</span>
      </div>

      {/* Review list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : filteredRows.length === 0 ? (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="flex flex-col items-center py-16 text-muted-foreground">
            <CheckCircle2 size={32} className="mb-3 text-emerald-500/40" />
            <p className="text-sm font-mono">No access reviews found</p>
            <p className="text-xs font-mono mt-1">
              {statusFilter === "pending"
                ? "All reviews are up to date"
                : "No reviews match the selected filter"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredRows.map(review => {
            const isActionable = review.status === "pending" || review.status === "escalated";
            const due = new Date(review.dueAt);
            const isOverdue = due < new Date();

            return (
              <Card
                key={review.id}
                className={cn(
                  "bg-card/50 border-border/50 hover:border-border transition-colors",
                  isOverdue && review.status === "pending" && "border-red-500/30"
                )}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div className={cn(
                      "flex-shrink-0 p-2 rounded-lg",
                      review.status === "escalated" ? "bg-orange-500/10" :
                      review.status === "pending" ? "bg-amber-500/10" :
                      review.status === "approved" ? "bg-emerald-500/10" :
                      "bg-red-500/10"
                    )}>
                      {review.status === "escalated" ? <ShieldAlert size={16} className="text-orange-400" /> :
                       review.status === "approved" ? <CheckCircle2 size={16} className="text-emerald-400" /> :
                       review.status === "revoked" ? <XCircle size={16} className="text-red-400" /> :
                       <UserCheck size={16} className="text-amber-400" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-mono font-semibold text-foreground truncate">{review.subjectId}</span>
                        <StatusBadge status={review.status} />
                        {isOverdue && review.status === "pending" && (
                          <span className="text-[10px] font-mono text-red-400 bg-red-500/10 border border-red-500/30 px-1.5 py-0.5 rounded">
                            OVERDUE
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-4 text-[10px] font-mono text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <UserCheck size={9} /> {review.reviewType.replace(/_/g, " ")}
                        </span>
                        {review.triggeredBy && (
                          <span className="flex items-center gap-1">
                            <User size={9} /> {review.triggeredBy}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar size={9} /> Due: {new Date(review.dueAt).toLocaleString()}
                        </span>
                        <SlaIndicator dueAt={review.dueAt} />
                        {review.completedAt && (
                          <span className="flex items-center gap-1 text-emerald-400">
                            <CheckCircle2 size={9} /> Completed: {new Date(review.completedAt).toLocaleString()}
                          </span>
                        )}
                      </div>

                      {review.decision && (
                        <p className="mt-1.5 text-[10px] font-mono text-muted-foreground bg-muted/20 rounded px-2 py-1 border border-border/30">
                          {review.decision}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    {isActionable && (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs gap-1 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                          onClick={() => setCompleteDialog({ id: review.id, subjectId: review.subjectId })}
                        >
                          <CheckCircle2 size={11} /> Review
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs gap-1 border-orange-500/40 text-orange-400 hover:bg-orange-500/10"
                          onClick={() => setEscalateDialog({ id: review.id, subjectId: review.subjectId })}
                        >
                          <ArrowUpCircle size={11} /> Escalate
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft size={14} />
          </Button>
          <span className="text-xs font-mono text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
            <ChevronRight size={14} />
          </Button>
        </div>
      )}

      {/* Dialogs */}
      {completeDialog && (
        <CompleteDialog
          reviewId={completeDialog.id}
          subjectId={completeDialog.subjectId}
          open={true}
          onClose={() => setCompleteDialog(null)}
          onDone={() => refetch()}
        />
      )}
      {escalateDialog && (
        <EscalateDialog
          reviewId={escalateDialog.id}
          subjectId={escalateDialog.subjectId}
          open={true}
          onClose={() => setEscalateDialog(null)}
          onDone={() => refetch()}
        />
      )}
    </div>
  );
}
