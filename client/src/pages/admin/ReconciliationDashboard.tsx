/**
 * ReconciliationDashboard v3 — Admin view for failed TigerBeetle transactions
 * =============================================================================
 * Features:
 *   - 7-day failure rate time-series chart (recharts AreaChart)
 *   - Tab navigation: Pending | Dead Letter
 *   - Row-level checkboxes for selective bulk retry with progress bar
 *   - Keyboard shortcuts: Ctrl+A (select all), Ctrl+Shift+R (retry selected)
 *   - Date filtering and column sorting
 *   - CSV export of filtered transactions
 *   - Detail modal with full JSON payload and error logs
 *   - Dead Letter tab with manual resolution notes
 */
import { useState, useMemo, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, AlertTriangle, CheckCircle2, RefreshCw, Database,
  DollarSign, ArrowUpDown, Eye, PlayCircle, X, Copy, Download,
  Keyboard, SkullIcon, StickyNote,
} from "lucide-react";
import { toast } from "sonner";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────
interface RetryQueueItem {
  id: number;
  reference: string;
  tenantId: string;
  amountKobo: number;
  attempts: number;
  nextRetryAt: string;
  status: string;
  lastError: string | null;
  createdAt: string;
  channel?: string;
  verifiedAt?: string;
}

type SortField = "date" | "amount" | "attempts" | "tenant";
type SortDir = "asc" | "desc";
type TabView = "pending" | "dead_letter" | "approvals";

interface ForceCreditApproval {
  id: number;
  reference: string;
  tenantId: string;
  amountKobo: number;
  auditNote: string;
  status: "pending" | "executing" | "executed" | "failed";
  requesterId: number;
  requesterName?: string | null;
  approverId?: number | null;
  approverName?: string | null;
  approvalNote?: string | null;
  ledgerTransferId?: string | null;
  requestedAt: string;
  approvedAt?: string | null;
  executedAt?: string | null;
}

// ── CSV Export ────────────────────────────────────────────────────────────────
function escapeCSV(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function exportToCSV(items: RetryQueueItem[]) {
  const headers = ["Reference", "Tenant", "Amount (NGN)", "Attempts", "Status", "Last Error", "Created", "Next Retry"];
  const rows = items.map((item) => [
    item.reference, item.tenantId, String(item.amountKobo / 100),
    String(item.attempts), item.status, item.lastError || "",
    item.createdAt ? new Date(item.createdAt).toISOString() : "",
    item.nextRetryAt ? new Date(item.nextRetryAt).toISOString() : "",
  ]);
  const csv = [headers.join(","), ...rows.map((row) => row.map(escapeCSV).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bis-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`Exported ${items.length} records to CSV`);
}

// ── Detail Modal ──────────────────────────────────────────────────────────────
function DetailModal({ item, onClose }: { item: RetryQueueItem; onClose: () => void }) {
  const jsonPayload = JSON.stringify(item, null, 2);
  const copyToClipboard = () => {
    navigator.clipboard.writeText(jsonPayload);
    toast.success("Copied to clipboard");
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background border rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="font-semibold text-lg">Transaction Detail</h3>
            <p className="text-xs text-muted-foreground font-mono">{item.reference}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-muted-foreground">Tenant</span><p className="font-medium">{item.tenantId}</p></div>
            <div><span className="text-muted-foreground">Amount</span><p className="font-medium">₦{(item.amountKobo / 100).toLocaleString()}</p></div>
            <div><span className="text-muted-foreground">Attempts</span><p className="font-medium">{item.attempts} / 7</p></div>
            <div><span className="text-muted-foreground">Status</span><Badge variant={item.status === "dead_letter" ? "destructive" : "outline"}>{item.status}</Badge></div>
            <div><span className="text-muted-foreground">Created</span><p className="font-medium">{new Date(item.createdAt).toLocaleString()}</p></div>
            <div><span className="text-muted-foreground">Next Retry</span><p className="font-medium">{new Date(item.nextRetryAt).toLocaleString()}</p></div>
          </div>
          {item.lastError && (
            <div>
              <Label className="text-xs text-muted-foreground">Error Log / Notes</Label>
              <div className="mt-1 p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-800 font-mono whitespace-pre-wrap max-h-[150px] overflow-y-auto">
                {item.lastError}
              </div>
            </div>
          )}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs text-muted-foreground">Full JSON Payload</Label>
              <Button variant="ghost" size="sm" onClick={copyToClipboard} className="h-6 text-xs"><Copy className="h-3 w-3 mr-1" /> Copy</Button>
            </div>
            <pre className="p-3 rounded-md bg-muted text-xs font-mono overflow-x-auto max-h-[200px] overflow-y-auto">{jsonPayload}</pre>
          </div>
        </div>
        <div className="p-4 border-t flex justify-end"><Button variant="outline" onClick={onClose}>Close</Button></div>
      </div>
    </div>
  );
}

// ── Resolution Note Dialog ────────────────────────────────────────────────────
function ResolutionDialog({ item, onClose, onSubmit }: { item: RetryQueueItem; onClose: () => void; onSubmit: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background border rounded-xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="font-semibold">Add Resolution Note</h3>
            <p className="text-xs text-muted-foreground font-mono">{item.reference.slice(0, 30)}...</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-sm text-muted-foreground">
            Amount: <strong>₦{(item.amountKobo / 100).toLocaleString()}</strong> · Tenant: <strong>{item.tenantId}</strong>
          </div>
          <Textarea
            placeholder="Describe the manual resolution (e.g., credited manually via bank transfer, refunded to customer, duplicate detected)..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
          />
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!note.trim()} onClick={() => onSubmit(note.trim())}>
            <StickyNote className="h-4 w-4 mr-1" /> Save Note
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Progress Bar ──────────────────────────────────────────────────────────────
function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Retrying {current} of {total}</span><span>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-blue-600 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}


// ── Force Credit Dialog ───────────────────────────────────────────────────────
function ForceCreditDialog({ item, onClose, onSubmit, isLoading }: { item: RetryQueueItem; onClose: () => void; onSubmit: (note: string) => void; isLoading: boolean }) {
  const [note, setNote] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-red-200 rounded-xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-red-200 bg-red-50/50 rounded-t-xl">
          <div>
            <h3 className="font-semibold text-red-800">Force Credit (Bypass TigerBeetle)</h3>
            <p className="text-xs text-red-600 font-mono">{item.reference.slice(0, 30)}...</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="p-4 space-y-3">
          <div className="p-3 rounded bg-red-50 border border-red-200 text-sm text-red-800">
            <strong>Controlled recovery:</strong> This re-attempts the credit against TigerBeetle with a mandatory
            compliance note. It cannot resolve the payment unless the authoritative double-entry ledger records it.
          </div>
          <div className="text-sm text-muted-foreground">
            Amount: <strong>\u20a6{(item.amountKobo / 100).toLocaleString()}</strong> \u00b7 Tenant: <strong>{item.tenantId}</strong>
          </div>
          <Textarea
            placeholder="Mandatory audit note: explain why this is being force-credited (min 10 chars)..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="border-red-200 focus:border-red-400"
          />
          <p className="text-xs text-muted-foreground">{note.length}/10 minimum characters</p>
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={note.trim().length < 10 || isLoading} onClick={() => onSubmit(note.trim())}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Force Credit
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Dual Approval Request Dialog ──────────────────────────────────────────────
function DualApprovalRequestDialog({ item, thresholdNGN, onClose, onSubmit, isLoading }: { item: RetryQueueItem; thresholdNGN: number; onClose: () => void; onSubmit: (note: string) => void; isLoading: boolean }) {
  const [note, setNote] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-amber-300 rounded-xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-amber-200 bg-amber-50 rounded-t-xl">
          <div>
            <h3 className="font-semibold text-amber-900">Request Dual Approval</h3>
            <p className="text-xs text-amber-700 font-mono">{item.reference.slice(0, 30)}...</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="p-4 space-y-3">
          <div className="p-3 rounded bg-amber-50 border border-amber-200 text-sm text-amber-900">
            This ₦{(item.amountKobo / 100).toLocaleString()} recovery exceeds the ₦{thresholdNGN.toLocaleString()} control threshold. A different administrator must approve and execute the TigerBeetle ledger transfer.
          </div>
          <Textarea placeholder="Mandatory request rationale (min 10 characters)..." value={note} onChange={(event) => setNote(event.target.value)} rows={4} />
          <p className="text-xs text-muted-foreground">{note.length}/10 minimum characters</p>
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-amber-600 hover:bg-amber-700" disabled={note.trim().length < 10 || isLoading} onClick={() => onSubmit(note.trim())}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Submit for Approval
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Second Approver Dialog ────────────────────────────────────────────────────
function ApprovalDialog({ approval, onClose, onSubmit, isLoading }: { approval: ForceCreditApproval; onClose: () => void; onSubmit: (note: string, totpCode: string) => void; isLoading: boolean }) {
  const [note, setNote] = useState("");
  const [totpCode, setTotpCode] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-red-300 rounded-xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-red-200 bg-red-50 rounded-t-xl">
          <div>
            <h3 className="font-semibold text-red-900">Approve & Execute Recovery</h3>
            <p className="text-xs text-red-700 font-mono">{approval.reference.slice(0, 30)}...</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="p-4 space-y-3">
          <div className="p-3 rounded bg-red-50 border border-red-200 text-sm text-red-900">
            You are the independent second approver. Approval triggers a TigerBeetle credit attempt; the payment remains unresolved if the ledger cannot record it.
          </div>
          <div className="text-sm"><span className="text-muted-foreground">Request rationale:</span> {approval.auditNote}</div>
          <Textarea placeholder="Mandatory approval rationale (min 10 characters)..." value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
          <div className="space-y-1"><Label htmlFor="approval-totp">Authenticator code</Label><Input id="approval-totp" value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="font-mono tracking-[0.35em]" placeholder="000000" /><p className="text-xs text-muted-foreground">A fresh code from your verified authenticator app is required before a ledger credit can be attempted.</p></div>
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={note.trim().length < 10 || !/^\d{6}$/.test(totpCode) || isLoading} onClick={() => onSubmit(note.trim(), totpCode)}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Approve & Execute
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Force Credit Audit Modal ──────────────────────────────────────────────────
function ForceCreditAuditModal({ reference, history, isLoading, onClose }: { reference: string; history?: any; isLoading: boolean; onClose: () => void }) {
  const approval = history?.approval as ForceCreditApproval | null | undefined;
  const events = (history?.events ?? []) as Array<{ eventType: string; actorId?: number | null; payload?: unknown; source?: string; createdAt: string }>;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-background border rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="font-semibold">Force Credit Audit History</h3>
            <p className="text-xs text-muted-foreground font-mono break-all">{reference}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="overflow-y-auto p-4 space-y-4">
          {isLoading ? (
            <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <>
              {approval && (
                <Card className="bg-muted/30"><CardContent className="pt-4 grid gap-3 text-sm md:grid-cols-2">
                  <div><p className="text-xs text-muted-foreground">Requester</p><p>{approval.requesterName ?? `user ${approval.requesterId}`}</p></div>
                  <div><p className="text-xs text-muted-foreground">Approver</p><p>{approval.approverName ?? (approval.approverId ? `user ${approval.approverId}` : "Awaiting independent approval")}</p></div>
                  <div><p className="text-xs text-muted-foreground">Request note</p><p>{approval.auditNote}</p></div>
                  <div><p className="text-xs text-muted-foreground">Approval note</p><p>{approval.approvalNote ?? "Not yet approved"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Ledger transfer</p><p className="font-mono text-xs">{approval.ledgerTransferId ?? "Not recorded"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Status</p><Badge variant={approval.status === "executed" ? "default" : approval.status === "failed" ? "destructive" : "outline"}>{approval.status}</Badge></div>
                </CardContent></Card>
              )}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Immutable Events</h4>
                {events.length === 0 ? <p className="text-sm text-muted-foreground">No Force Credit events have been recorded for this reference.</p> : events.map((event, index) => (
                  <div key={`${event.eventType}-${event.createdAt}-${index}`} className="border-l-2 border-primary/40 pl-3 py-1">
                    <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{event.eventType}</Badge><span className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</span></div>
                    <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 text-[11px] whitespace-pre-wrap">{JSON.stringify(event.payload, null, 2)}</pre>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Server-Enforced Threshold Configuration Dialog ────────────────────────────
function ThresholdConfigurationDialog({ thresholdKobo, approvers, candidates, history, onClose, onSubmit, onSetApprover, onRollback, isLoading, isSavingApprover, isRollingBack }: { thresholdKobo: number; approvers: Array<any>; candidates: Array<any>; history: Array<any>; onClose: () => void; onSubmit: (kobo: number) => void; onSetApprover: (userId: number, active: boolean) => void; onRollback: (historyEventId: number) => void; isLoading: boolean; isSavingApprover: boolean; isRollingBack: boolean }) {
  const [naira, setNaira] = useState(String(thresholdKobo / 100));
  const [selectedUserId, setSelectedUserId] = useState("");
  const parsedKobo = Math.round(Number(naira) * 100);
  const valid = Number.isSafeInteger(parsedKobo) && parsedKobo >= 10_000;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-background border rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div><h3 className="font-semibold">Dual-Approval Threshold</h3><p className="text-xs text-muted-foreground">Server-enforced payment recovery control</p></div>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="p-4 space-y-5 overflow-y-auto">
          <div className="rounded bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">Force Credit requests at or above this amount require a requester and a different approver. Changes are persisted and written to the immutable audit log.</div>
          <div className="space-y-1"><Label htmlFor="threshold-naira">Threshold (NGN)</Label><Input id="threshold-naira" inputMode="decimal" value={naira} onChange={(event) => setNaira(event.target.value)} /><p className="text-xs text-muted-foreground">Minimum: ₦100. Stored as {Number.isFinite(parsedKobo) ? parsedKobo.toLocaleString() : "invalid"} kobo.</p></div>
          <div className="space-y-2 border-t pt-4">
            <div><p className="text-sm font-semibold">Designated Approvers</p><p className="text-xs text-muted-foreground">Only active designated administrators can execute a high-value approval.</p></div>
            <div className="flex gap-2">
              <select aria-label="Select administrator to designate" value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)} className="flex-1 h-9 rounded-md border border-input bg-background px-2 text-sm">
                <option value="">Select an administrator</option>
                {candidates.filter((candidate) => !approvers.some((approver) => Number(approver.userId) === Number(candidate.id) && approver.active)).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name ?? candidate.email ?? `Admin ${candidate.id}`}</option>)}
              </select>
              <Button type="button" variant="outline" disabled={!selectedUserId || isSavingApprover} onClick={() => { onSetApprover(Number(selectedUserId), true); setSelectedUserId(""); }}>Designate</Button>
            </div>
            <div className="space-y-2">
              {approvers.length === 0 ? <p className="text-xs text-amber-700">No approvers are designated. High-value requests will fail closed until an independent approver is assigned.</p> : approvers.map((approver) => (
                <div key={approver.userId} className="flex items-center justify-between rounded border p-2 text-sm">
                  <div><p>{approver.userName ?? approver.email ?? `User ${approver.userId}`}</p><p className="text-xs text-muted-foreground">{approver.active ? "Active approver" : "Revoked"}</p></div>
                  <Button type="button" size="sm" variant={approver.active ? "destructive" : "outline"} disabled={isSavingApprover} onClick={() => onSetApprover(Number(approver.userId), !approver.active)}>{approver.active ? "Revoke" : "Restore"}</Button>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2 border-t pt-4">
            <div><p className="text-sm font-semibold">Threshold Version History</p><p className="text-xs text-muted-foreground">Restoring a version creates a new immutable rollback event; prior records are never overwritten.</p></div>
            {history.length === 0 ? <p className="text-xs text-muted-foreground">No persisted threshold changes have been recorded yet.</p> : history.map((entry) => {
              const payload = typeof entry.payload === "string" ? JSON.parse(entry.payload) : entry.payload ?? {};
              const historicalKobo = Number(payload.thresholdKobo);
              return (
                <div key={entry.id} className="flex items-center justify-between gap-3 rounded border p-2 text-sm">
                  <div><p>₦{Number.isFinite(historicalKobo) ? (historicalKobo / 100).toLocaleString() : "Unknown"}</p><p className="text-xs text-muted-foreground">{entry.actorName ?? entry.actorEmail ?? `user ${entry.actorId ?? "unknown"}`} · {new Date(entry.createdAt).toLocaleString()}</p></div>
                  <Button type="button" size="sm" variant="outline" disabled={!Number.isSafeInteger(historicalKobo) || isLoading || isRollingBack || historicalKobo === thresholdKobo} onClick={() => onRollback(Number(entry.id))}>Revert</Button>
                </div>
              );
            })}
          </div>
        </div>
        <div className="p-4 border-t flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid || isLoading} onClick={() => onSubmit(parsedKobo)}>{isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Save Threshold</Button></div>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function ReconciliationDashboard() {
  const [retrying, setRetrying] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);
  const [selectedItem, setSelectedItem] = useState<RetryQueueItem | null>(null);
  const [resolvingItem, setResolvingItem] = useState<RetryQueueItem | null>(null);
  const [forceCreditItem, setForceCreditItem] = useState<RetryQueueItem | null>(null);
  const [approvalRequestItem, setApprovalRequestItem] = useState<RetryQueueItem | null>(null);
  const [approvalExecutionItem, setApprovalExecutionItem] = useState<ForceCreditApproval | null>(null);
  const [auditReference, setAuditReference] = useState<string | null>(null);
  const [thresholdConfigOpen, setThresholdConfigOpen] = useState(false);
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<TabView>("pending");
  const [chartChannel, setChartChannel] = useState("");

  // ── Queries ─────────────────────────────────────────────────────────────────
  const { data, isLoading, refetch } = trpc.admin.reconciliation.listUnreconciled.useQuery(
    { limit: 200 }, { refetchInterval: 30_000 }
  );
  const { data: deadLetterData, refetch: refetchDead } = trpc.admin.reconciliation.listDeadLetters.useQuery(
    { limit: 200 }, { refetchInterval: 60_000 }
  );
  const { data: channelsData } = trpc.admin.reconciliation.listPaymentChannels.useQuery(undefined, {
    staleTime: 60_000,
  });
  const { data: forceCreditPolicy, refetch: refetchForceCreditPolicy } = trpc.admin.reconciliation.forceCreditPolicy.useQuery(undefined, {
    staleTime: 60_000,
  });
  const { data: policyHistoryData, refetch: refetchPolicyHistory } = trpc.admin.reconciliation.forceCreditPolicyHistory.useQuery(
    { limit: 25 }, { staleTime: 30_000 }
  );
  const { data: approvalData, refetch: refetchApprovals } = trpc.admin.reconciliation.listForceCreditApprovals.useQuery(
    {}, { refetchInterval: 30_000 }
  );
  const { data: approversData, refetch: refetchApprovers } = trpc.admin.reconciliation.listForceCreditApprovers.useQuery(undefined, {
    staleTime: 30_000,
  });
  const { data: approverCandidatesData } = trpc.admin.reconciliation.listForceCreditApproverCandidates.useQuery(undefined, {
    staleTime: 30_000,
  });
  const { data: auditHistory, isLoading: auditHistoryLoading } = trpc.admin.reconciliation.forceCreditAuditHistory.useQuery(
    { reference: auditReference ?? "unselected" },
    { enabled: Boolean(auditReference), refetchOnWindowFocus: false }
  );
  const { data: chartData } = trpc.admin.reconciliation.failureRateChart.useQuery(
    chartChannel ? { channel: chartChannel } : undefined,
    {
    refetchInterval: 60_000, staleTime: 30_000,
    }
  );

  // ── Filtering & Sorting ───────────────────────────────────────────────────
  const filteredAndSorted = useMemo(() => {
    let items: RetryQueueItem[] = (data?.items ?? []) as any[];
    if (dateFrom) { const from = new Date(dateFrom).getTime(); items = items.filter((i) => new Date(i.verifiedAt || i.createdAt).getTime() >= from); }
    if (dateTo) { const to = new Date(dateTo).getTime() + 86_400_000; items = items.filter((i) => new Date(i.verifiedAt || i.createdAt).getTime() <= to); }
    items = [...items].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "date": cmp = new Date(a.verifiedAt || a.createdAt).getTime() - new Date(b.verifiedAt || b.createdAt).getTime(); break;
        case "amount": cmp = a.amountKobo - b.amountKobo; break;
        case "attempts": cmp = a.attempts - b.attempts; break;
        case "tenant": cmp = a.tenantId.localeCompare(b.tenantId); break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return items;
  }, [data?.items, dateFrom, dateTo, sortField, sortDir]);

  // ── Mutations ───────────────────────────────────────────────────────────────
  const retryMutation = trpc.admin.reconciliation.retryCredit.useMutation({
    onSuccess: (result) => {
      if (result.recorded) toast.success(`Transfer ${result.transferId} reconciled`);
      else toast.error("Retry failed — TigerBeetle still unavailable");
      refetch(); setRetrying(null);
    },
    onError: (err) => { toast.error(err.message || "Retry failed"); setRetrying(null); },
  });

  const forceCreditMutation = trpc.admin.reconciliation.forceCredit.useMutation({
    onSuccess: (result) => {
      toast.success(`Force credited — ${result.transferId} by ${result.operator}`);
      refetchDead(); refetch();
      setForceCreditItem(null);
    },
    onError: (err) => toast.error(err.message || "Force credit failed"),
  });

  const requestForceCreditMutation = trpc.admin.reconciliation.requestForceCredit.useMutation({
    onSuccess: () => {
      toast.success("Dual approval request submitted for a second administrator");
      setApprovalRequestItem(null);
      refetchApprovals();
    },
    onError: (error) => toast.error(error.message || "Approval request failed"),
  });

  const approveForceCreditMutation = trpc.admin.reconciliation.approveForceCredit.useMutation({
    onSuccess: (result) => {
      toast.success(`Dual-approved credit recorded as ${result.transferId}`);
      setApprovalExecutionItem(null);
      refetchApprovals();
      refetchDead();
      refetch();
    },
    onError: (error) => toast.error(error.message || "Approval execution failed"),
  });

  const updateForceCreditPolicyMutation = trpc.admin.reconciliation.updateForceCreditPolicy.useMutation({
    onSuccess: (result) => {
      toast.success(`Dual approval now applies from ₦${(result.thresholdKobo / 100).toLocaleString()}`);
      setThresholdConfigOpen(false);
      refetchForceCreditPolicy();
      refetchPolicyHistory();
    },
    onError: (error) => toast.error(error.message || "Threshold update failed"),
  });
  const rollbackForceCreditPolicyMutation = trpc.admin.reconciliation.rollbackForceCreditPolicy.useMutation({
    onSuccess: (result) => {
      toast.success(`Threshold restored to ₦${(result.thresholdKobo / 100).toLocaleString()}`);
      refetchForceCreditPolicy();
      refetchPolicyHistory();
    },
    onError: (error) => toast.error(error.message || "Threshold rollback failed"),
  });
  const setForceCreditApproverMutation = trpc.admin.reconciliation.setForceCreditApprover.useMutation({
    onSuccess: (result) => {
      toast.success(result.active ? "Approver designated" : "Approver designation revoked");
      refetchApprovers();
    },
    onError: (error) => toast.error(error.message || "Approver update failed"),
  });

  const resolveMutation = trpc.admin.reconciliation.addResolutionNote.useMutation({
    onSuccess: () => {
      toast.success("Resolution note saved");
      refetchDead();
      setResolvingItem(null);
    },
    onError: (err) => toast.error(err.message || "Failed to save note"),
  });

  const handleRetry = (reference: string, tenantId: string, amountKobo: number) => {
    setRetrying(reference);
    retryMutation.mutate({ reference, tenantId, amountKobo });
  };

  // ── Selective Bulk Retry ───────────────────────────────────────────────────
  const handleRetrySelected = useCallback(async () => {
    const items = filteredAndSorted.filter((i) => selectedRefs.has(i.reference));
    if (items.length === 0) { toast.error("No items selected"); return; }
    setBulkProgress({ current: 0, total: items.length });
    for (let i = 0; i < items.length; i++) {
      setBulkProgress({ current: i + 1, total: items.length });
      try {
        await retryMutation.mutateAsync({ reference: items[i].reference, tenantId: items[i].tenantId, amountKobo: items[i].amountKobo });
      } catch { /* continue */ }
    }
    setBulkProgress(null); setSelectedRefs(new Set()); refetch();
    toast.success(`Bulk retry complete — processed ${items.length} items`);
  }, [selectedRefs]);

  // ── Keyboard Shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+A — select all visible rows (prevent browser select-all)
      if (e.ctrlKey && !e.shiftKey && e.key === "a" && activeTab === "pending") {
        e.preventDefault();
        setSelectedRefs(new Set(filteredAndSorted.map((i) => i.reference)));
        toast.info(`Selected ${filteredAndSorted.length} items (Ctrl+A)`);
      }
      // Ctrl+Shift+R — retry selected
      if (e.ctrlKey && e.shiftKey && e.key === "R" && activeTab === "pending") {
        e.preventDefault();
        if (selectedRefs.size > 0) handleRetrySelected();
        else toast.error("No items selected (Ctrl+Shift+R)");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab, filteredAndSorted, selectedRefs, handleRetrySelected]);



  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  };

  const toggleSelectAll = () => {
    if (selectedRefs.size === filteredAndSorted.length) setSelectedRefs(new Set());
    else setSelectedRefs(new Set(filteredAndSorted.map((i) => i.reference)));
  };

  const toggleSelect = (ref: string) => {
    setSelectedRefs((prev) => { const next = new Set(prev); if (next.has(ref)) next.delete(ref); else next.add(ref); return next; });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  const stats = data?.stats ?? { total: 0, totalAmountNGN: 0, oldestAge: "—" };
  const deadLetters: RetryQueueItem[] = (deadLetterData?.items ?? []) as any[];
  const approvals: ForceCreditApproval[] = (approvalData?.approvals ?? []) as any[];
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const dualApprovalThresholdKobo = forceCreditPolicy?.thresholdKobo ?? 5_000_000;
  const allSelected = filteredAndSorted.length > 0 && selectedRefs.size === filteredAndSorted.length;

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Database className="h-6 w-6" /> Payment Reconciliation</h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-2">
            Failed TigerBeetle credits — verified by Paystack but not ledgered.
            <span className="text-xs border rounded px-1.5 py-0.5 flex items-center gap-1"><Keyboard className="h-3 w-3" /> Ctrl+A / Ctrl+Shift+R</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => exportToCSV(activeTab === "pending" ? filteredAndSorted : deadLetters)} disabled={(activeTab === "pending" ? filteredAndSorted : deadLetters).length === 0}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
          {activeTab === "pending" && (
            <Button onClick={handleRetrySelected} disabled={selectedRefs.size === 0 || bulkProgress !== null} className="gap-2">
              {bulkProgress ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              Retry Selected ({selectedRefs.size})
            </Button>
          )}
        </div>
      </div>

      {/* 7-Day Failure Rate Chart */}
      {chartData?.days && chartData.days.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm">7-Day Failure Rate</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  {chartChannel ? `Filtered to ${chartChannel}` : "All payment channels"}
                </CardDescription>
              </div>
              <select
                aria-label="Filter reconciliation chart by payment channel"
                value={chartChannel}
                onChange={(event) => setChartChannel(event.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">All channels</option>
                {(channelsData?.channels ?? []).map((channel: string) => (
                  <option key={channel} value={channel}>{channel}</option>
                ))}
              </select>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={chartData.days} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                  labelFormatter={(label) => {
                    const d = new Date(label + "T00:00:00");
                    return d.toLocaleDateString("en-NG", { weekday: "short", month: "short", day: "numeric" });
                  }}
                  formatter={(value: number, name: string) => {
                    const labels: Record<string, string> = { total: "Total Failures", succeeded: "Retried Successfully", deadLettered: "Dead Lettered", pending: "Still Pending" };
                    return [value + " txns", labels[name] ?? name];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="total" stackId="1" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} name="Total" />
                <Area type="monotone" dataKey="succeeded" stackId="2" stroke="#22c55e" fill="#22c55e" fillOpacity={0.3} name="Succeeded" />
                <Area type="monotone" dataKey="deadLettered" stackId="3" stroke="#ef4444" fill="#ef4444" fillOpacity={0.3} name="Dead Letter" />
                <Area type="monotone" dataKey="pending" stackId="4" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} name="Pending" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Bulk Progress Bar */}
      {bulkProgress && (
        <Card className="border-blue-200 bg-blue-50/50"><CardContent className="pt-4"><ProgressBar current={bulkProgress.current} total={bulkProgress.total} /></CardContent></Card>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /><span className="text-sm text-muted-foreground">Pending</span></div><p className="text-2xl font-bold mt-1">{stats.total}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><DollarSign className="h-4 w-4 text-red-600" /><span className="text-sm text-muted-foreground">Outstanding</span></div><p className="text-2xl font-bold mt-1">₦{stats.totalAmountNGN.toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><SkullIcon className="h-4 w-4 text-red-800" /><span className="text-sm text-muted-foreground">Dead Letters</span></div><p className="text-2xl font-bold mt-1">{deadLetters.length}</p></CardContent></Card>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "pending" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          onClick={() => setActiveTab("pending")}
        >
          Pending ({stats.total})
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "dead_letter" ? "border-red-600 text-red-600" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          onClick={() => setActiveTab("dead_letter")}
        >
          Dead Letter ({deadLetters.length})
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "approvals" ? "border-amber-600 text-amber-700" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          onClick={() => setActiveTab("approvals")}
        >
          Pending Approvals ({pendingApprovals.length})
        </button>
      </div>

      {/* ═══ PENDING TAB ═══ */}
      {activeTab === "pending" && (
        <>
          {/* Filters */}
          <Card><CardContent className="pt-4"><div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-1"><Label className="text-xs">From Date</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" /></div>
            <div className="space-y-1"><Label className="text-xs">To Date</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" /></div>
            {(dateFrom || dateTo) && <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>Clear</Button>}
            <div className="ml-auto text-xs text-muted-foreground">
              {filteredAndSorted.length} items{selectedRefs.size > 0 && ` · ${selectedRefs.size} selected`}
            </div>
          </div></CardContent></Card>

          {/* Transaction List */}
          <Card>
            <CardHeader><CardTitle>Failed Ledger Credits</CardTitle><CardDescription>Checkboxes + Ctrl+A to select, Ctrl+Shift+R to retry.</CardDescription></CardHeader>
            <CardContent>
              {filteredAndSorted.length === 0 ? (
                <div className="text-center py-8"><CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" /><p className="font-medium text-green-800">All Reconciled</p></div>
              ) : (
                <div className="space-y-1">
                  <div className="grid grid-cols-[32px_1fr_1fr_80px_60px_80px_70px_70px] gap-2 text-xs font-medium text-muted-foreground border-b pb-2 items-center">
                    <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} aria-label="Select all" />
                    <span>Reference</span>
                    <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("tenant")}>Tenant <ArrowUpDown className="h-3 w-3" /></button>
                    <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("amount")}>Amount <ArrowUpDown className="h-3 w-3" /></button>
                    <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("attempts")}>Tries <ArrowUpDown className="h-3 w-3" /></button>
                    <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("date")}>Date <ArrowUpDown className="h-3 w-3" /></button>
                    <span>Status</span>
                    <span>Actions</span>
                  </div>
                  {filteredAndSorted.map((item: any) => (
                    <div key={item.reference} className={`grid grid-cols-[32px_1fr_1fr_80px_60px_80px_70px_70px] gap-2 items-center text-sm py-2 border-b border-dashed hover:bg-muted/30 transition-colors ${selectedRefs.has(item.reference) ? "bg-blue-50/50" : ""}`}>
                      <Checkbox checked={selectedRefs.has(item.reference)} onCheckedChange={() => toggleSelect(item.reference)} />
                      <span className="font-mono text-xs truncate" title={item.reference}>{item.reference.slice(0, 18)}...</span>
                      <span className="truncate text-xs">{item.tenantId}</span>
                      <span className="font-medium text-xs">₦{(item.amountKobo / 100).toLocaleString()}</span>
                      <span className="text-xs">{item.attempts ?? 0}/7</span>
                      <span className="text-xs text-muted-foreground">{new Date(item.verifiedAt || item.createdAt).toLocaleDateString()}</span>
                      <Badge variant="outline" className="w-fit text-[10px]">pending</Badge>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setSelectedItem(item)} title="View details"><Eye className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={retrying === item.reference || bulkProgress !== null} onClick={() => handleRetry(item.reference, item.tenantId, item.amountKobo)} title="Retry">
                          {retrying === item.reference ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ═══ DEAD LETTER TAB ═══ */}
      {activeTab === "dead_letter" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><SkullIcon className="h-5 w-5 text-red-600" /> Dead Letter Queue</CardTitle>
            <CardDescription>Items that exceeded 7 retry attempts. Add resolution notes to mark them as manually handled.</CardDescription>
          </CardHeader>
          <CardContent>
            {deadLetters.length === 0 ? (
              <div className="text-center py-8"><CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" /><p className="font-medium text-green-800">No Dead Letters</p></div>
            ) : (
              <div className="space-y-3">
                {deadLetters.map((item: any) => (
                  <div key={item.reference} className="border rounded-lg p-3 space-y-2 hover:border-red-200 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Badge variant="destructive" className="text-[10px]">DEAD</Badge>
                        <span className="font-mono text-xs">{item.reference.slice(0, 30)}...</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">₦{(item.amountKobo / 100).toLocaleString()}</span>
                        <Button variant="outline" size="sm" onClick={() => setSelectedItem(item)}><Eye className="h-3 w-3 mr-1" /> Detail</Button>
                        <Button variant="outline" size="sm" onClick={() => setResolvingItem(item)}><StickyNote className="h-3 w-3 mr-1" /> Resolve</Button>
                        {item.amountKobo >= dualApprovalThresholdKobo ? (
                          <Button className="bg-amber-600 hover:bg-amber-700" size="sm" onClick={() => setApprovalRequestItem(item)}>Request Approval</Button>
                        ) : (
                          <Button variant="destructive" size="sm" onClick={() => setForceCreditItem(item)}>Force Credit</Button>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>Tenant: {item.tenantId}</span>
                      <span>Attempts: {item.attempts}</span>
                      <span>Created: {new Date(item.createdAt).toLocaleDateString()}</span>
                    </div>
                    {item.lastError && (
                      <div className="text-xs font-mono text-red-700 bg-red-50 rounded p-2 max-h-[60px] overflow-y-auto whitespace-pre-wrap">
                        {item.lastError}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══ DUAL APPROVAL TAB ═══ */}
      {activeTab === "approvals" && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" /> Pending High-Value Force Credit Approvals</CardTitle>
                <CardDescription>Each high-value recovery requires two different administrators and a successful TigerBeetle ledger record.</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setThresholdConfigOpen(true)}>Configure Threshold</Button>
            </div>
          </CardHeader>
          <CardContent>
            {approvals.length === 0 ? (
              <div className="text-center py-8"><CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" /><p className="font-medium text-green-800">No Approval Requests</p></div>
            ) : (
              <div className="space-y-3">
                {approvals.map((approval) => (
                  <div key={approval.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-mono text-xs">{approval.reference}</p>
                        <p className="text-sm font-medium mt-1">₦{(Number(approval.amountKobo) / 100).toLocaleString()} · {approval.tenantId}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={approval.status === "executed" ? "default" : approval.status === "pending" ? "outline" : "destructive"}>{approval.status}</Badge>
                        <Button size="sm" variant="outline" onClick={() => setAuditReference(approval.reference)}>Audit Trail</Button>
                        {approval.status === "pending" && <Button size="sm" variant="destructive" onClick={() => setApprovalExecutionItem(approval)}>Review & Approve</Button>}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">Requested by {approval.requesterName ?? `user ${approval.requesterId}`} on {new Date(approval.requestedAt).toLocaleString()}</p>
                    <div className="rounded bg-muted/60 p-2 text-xs"><span className="font-medium">Requester note:</span> {approval.auditNote}</div>
                    {approval.approvalNote && <div className="rounded bg-green-50 p-2 text-xs text-green-900"><span className="font-medium">Approver note:</span> {approval.approvalNote}</div>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Modals */}
      {selectedItem && <DetailModal item={selectedItem} onClose={() => setSelectedItem(null)} />}
      {resolvingItem && (
        <ResolutionDialog
          item={resolvingItem}
          onClose={() => setResolvingItem(null)}
          onSubmit={(note) => resolveMutation.mutate({ reference: resolvingItem.reference, note })}
        />
      )}
      {forceCreditItem && (
        <ForceCreditDialog
          item={forceCreditItem}
          onClose={() => setForceCreditItem(null)}
          onSubmit={(note) => forceCreditMutation.mutate({
            reference: forceCreditItem.reference,
            tenantId: forceCreditItem.tenantId,
            amountKobo: forceCreditItem.amountKobo,
            auditNote: note,
          })}
          isLoading={forceCreditMutation.isPending}
        />
      )}
      {approvalRequestItem && (
        <DualApprovalRequestDialog
          item={approvalRequestItem}
          thresholdNGN={dualApprovalThresholdKobo / 100}
          onClose={() => setApprovalRequestItem(null)}
          onSubmit={(auditNote) => requestForceCreditMutation.mutate({
            reference: approvalRequestItem.reference,
            tenantId: approvalRequestItem.tenantId,
            amountKobo: approvalRequestItem.amountKobo,
            auditNote,
          })}
          isLoading={requestForceCreditMutation.isPending}
        />
      )}
      {approvalExecutionItem && (
        <ApprovalDialog
          approval={approvalExecutionItem}
          onClose={() => setApprovalExecutionItem(null)}
          onSubmit={(approvalNote, totpCode) => approveForceCreditMutation.mutate({ approvalId: approvalExecutionItem.id, approvalNote, totpCode })}
          isLoading={approveForceCreditMutation.isPending}
        />
      )}
      {auditReference && (
        <ForceCreditAuditModal
          reference={auditReference}
          history={auditHistory}
          isLoading={auditHistoryLoading}
          onClose={() => setAuditReference(null)}
        />
      )}
      {thresholdConfigOpen && (
        <ThresholdConfigurationDialog
          thresholdKobo={dualApprovalThresholdKobo}
          approvers={(approversData?.approvers ?? []) as any[]}
          candidates={(approverCandidatesData?.users ?? []) as any[]}
          history={(policyHistoryData?.history ?? []) as any[]}
          onClose={() => setThresholdConfigOpen(false)}
          onSubmit={(thresholdKobo) => updateForceCreditPolicyMutation.mutate({ thresholdKobo })}
          onSetApprover={(userId, active) => setForceCreditApproverMutation.mutate({ userId, active })}
          onRollback={(historyEventId) => rollbackForceCreditPolicyMutation.mutate({ historyEventId })}
          isLoading={updateForceCreditPolicyMutation.isPending}
          isSavingApprover={setForceCreditApproverMutation.isPending}
          isRollingBack={rollbackForceCreditPolicyMutation.isPending}
        />
      )}
    </div>
  );
}
