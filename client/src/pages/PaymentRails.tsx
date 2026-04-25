/**
 * Payment Rails Page
 *
 * Displays live transfer status, TigerBeetle batch queue depth, account balances,
 * and hot/warm/cold archival tier statistics.
 *
 * Architecture (1B payments lessons applied):
 *   - Transfers processed in batches of 8,190 (TigerBeetle MaxBatchSize)
 *   - Amounts displayed in NGN (stored as kobo in DB: divide by 100)
 *   - Status lifecycle: pending → posted | voided | failed | reversed
 *   - Backpressure: 503 responses when queue is saturated
 *
 * v57 additions:
 *   - Transfer Detail slide-over drawer (Sheet) with full TigerBeetle record
 *   - "Run Archival Now" button with progress toast and result card
 *   - "View Load Test Dashboard" Grafana link (VITE_GRAFANA_URL env var)
 */
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useLocation } from "wouter";
import {
  TrendingUp, Activity, AlertCircle, CheckCircle2, XCircle,
  Clock, RefreshCw, Database, Archive, Layers, Zap,
  ArrowUpDown, ExternalLink, Play, Copy, Check, Search, X, Download, Plus, Send,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

// ── Constants ──────────────────────────────────────────────────────────────────

const GRAFANA_URL = (import.meta.env.VITE_GRAFANA_URL ?? "http://localhost:3000").replace(/\/$/, "");
const GRAFANA_DASHBOARD_URL = `${GRAFANA_URL}/d/k6-payment-rails/k6-payment-rails`;

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatNGN(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString("en-NG");
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

type TransferStatus = "pending" | "posted" | "voided" | "failed" | "reversed";

function mapStatus(s: string): TransferStatus {
  const map: Record<string, TransferStatus> = {
    completed: "posted", failed: "failed", reversed: "reversed",
    blocked: "voided", pending: "pending", under_review: "pending", flagged: "pending",
  };
  return map[s] ?? "pending";
}

function StatusBadge({ status }: { status: TransferStatus }) {
  const config: Record<TransferStatus, { label: string; className: string; icon: React.ReactNode }> = {
    pending:  { label: "Pending",  className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",   icon: <Clock size={10} /> },
    posted:   { label: "Posted",   className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: <CheckCircle2 size={10} /> },
    voided:   { label: "Voided",   className: "bg-slate-500/15 text-slate-400 border-slate-500/30",       icon: <XCircle size={10} /> },
    failed:   { label: "Failed",   className: "bg-red-500/15 text-red-400 border-red-500/30",             icon: <XCircle size={10} /> },
    reversed: { label: "Reversed", className: "bg-orange-500/15 text-orange-400 border-orange-500/30",    icon: <ArrowUpDown size={10} /> },
  };
  const c = config[status] ?? config.pending;
  return (
    <Badge variant="outline" className={`gap-1 text-[10px] font-mono ${c.className}`}>
      {c.icon}
      {c.label}
    </Badge>
  );
}

// ── Copy-to-clipboard helper ───────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="ml-1 inline-flex items-center text-slate-500 hover:text-slate-300 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
    </button>
  );
}

// ── Transfer Detail Drawer ─────────────────────────────────────────────────────

interface TransferDetailDrawerProps {
  txRef: string | null;
  open: boolean;
  onClose: () => void;
}

function TransferDetailDrawer({ txRef, open, onClose }: TransferDetailDrawerProps) {
  const { data, isLoading, error } = trpc.paymentRails.getTransfer.useQuery(
    { txRef: txRef! },
    { enabled: !!txRef && open }
  );

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg bg-slate-900 border-slate-700 text-slate-200 overflow-y-auto"
      >
        <SheetHeader className="pb-4">
          <SheetTitle className="text-slate-100 flex items-center gap-2">
            <TrendingUp size={16} className="text-indigo-400" />
            Transfer Detail
          </SheetTitle>
          <SheetDescription className="text-slate-500 font-mono text-xs break-all">
            {txRef ?? "—"}
          </SheetDescription>
        </SheetHeader>

        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <Skeleton key={i} className="h-14 w-full bg-slate-800" />
            ))}
          </div>
        )}

        {error && (
          <Alert className="bg-red-900/20 border-red-700">
            <AlertCircle size={14} className="text-red-400" />
            <AlertDescription className="text-red-300 text-xs ml-2">
              {error.message}
            </AlertDescription>
          </Alert>
        )}

        {data && !isLoading && (
          <div className="space-y-4">
            {/* Status + Amount hero */}
            <div className="flex items-center justify-between bg-slate-800/60 rounded-lg p-4">
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Amount</p>
                <p className="text-2xl font-mono font-bold text-emerald-400">{formatNGN(data.amount ?? 0)}</p>
                <p className="text-xs text-slate-500 mt-0.5">{data.currency ?? "NGN"}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Status</p>
                <StatusBadge status={mapStatus(data.status ?? "pending")} />
                <p className="text-[10px] text-slate-500 mt-1">
                  {data.createdAt ? new Date(data.createdAt).toLocaleString("en-NG") : "—"}
                </p>
              </div>
            </div>

            <Separator className="bg-slate-800" />

            {/* Parties */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Parties</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-800/60 rounded-md p-3">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Originator</p>
                  <p className="text-sm text-slate-200 font-medium">{data.originatorName ?? "—"}</p>
                  {data.originatorAccount && (
                    <p className="text-[10px] font-mono text-slate-500 mt-0.5 break-all">{data.originatorAccount}</p>
                  )}
                </div>
                <div className="bg-slate-800/60 rounded-md p-3">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Beneficiary</p>
                  <p className="text-sm text-slate-200 font-medium">{data.beneficiaryName ?? "—"}</p>
                  {data.beneficiaryAccount && (
                    <p className="text-[10px] font-mono text-slate-500 mt-0.5 break-all">{data.beneficiaryAccount}</p>
                  )}
                </div>
              </div>
            </div>

            <Separator className="bg-slate-800" />

            {/* TigerBeetle fields */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">TigerBeetle Record</p>
              {[
                { label: "TigerBeetle ID", value: data.tigerBeetleId ?? "—", mono: true },
                { label: "Ledger", value: `${data.currency ?? "NGN"}_RETAIL`, mono: true },
                { label: "Transfer Type", value: data.type ?? "—", mono: false },
                { label: "Purpose Code", value: data.purposeCode ?? "—", mono: true },
                { label: "AML Risk", value: data.amlRiskLevel ?? "—", mono: false },
              ].map(({ label, value, mono }) => (
                <div key={label} className="flex items-start justify-between bg-slate-800/40 rounded px-3 py-2">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide w-32 flex-shrink-0">{label}</p>
                  <div className="flex items-center min-w-0 flex-1 justify-end">
                    <p className={`text-xs text-slate-200 break-all text-right ${mono ? "font-mono" : ""}`}>
                      {value}
                    </p>
                    {value !== "—" && mono && <CopyButton value={value} />}
                  </div>
                </div>
              ))}
            </div>

            <Separator className="bg-slate-800" />

            {/* Idempotency key */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Idempotency</p>
              <div className="bg-slate-800/40 rounded px-3 py-2">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Idempotency Key (SHA-256)</p>
                {data.idempotencyKey ? (
                  <div className="flex items-start gap-1">
                    <p className="text-[11px] font-mono text-indigo-300 break-all flex-1">{data.idempotencyKey}</p>
                    <CopyButton value={data.idempotencyKey} />
                  </div>
                ) : (
                  <p className="text-xs text-slate-600 italic">No idempotency key recorded</p>
                )}
              </div>
            </div>

            {/* Narration */}
            {data.narration && (
              <>
                <Separator className="bg-slate-800" />
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Narration</p>
                  <div className="bg-slate-800/40 rounded px-3 py-2">
                    <p className="text-xs text-slate-300">{data.narration}</p>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Queue Stats Card ───────────────────────────────────────────────────────────

function QueueStatsCard() {
  const { data, isLoading, refetch } = trpc.paymentRails.getQueueStats.useQuery(undefined, {
    refetchInterval: 10_000,
  });

  const batchFillPct = data ? Math.min(100, (data.pendingCount / data.batchSize) * 100) : 0;

  return (
    <Card className="bg-slate-900 border-slate-700">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Zap size={14} className="text-yellow-400" />
            Batch Queue (TigerBeetle)
          </CardTitle>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => refetch()}>
            <RefreshCw size={12} className="text-slate-400" />
          </Button>
        </div>
        <CardDescription className="text-xs text-slate-500">
          MaxBatchSize = 8,190 transfers · backpressure at 100% fill
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full bg-slate-800" />
            <Skeleton className="h-4 w-3/4 bg-slate-800" />
          </div>
        ) : data ? (
          <>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Queue depth</span>
                <span className={`font-mono font-semibold ${batchFillPct > 80 ? "text-red-400" : batchFillPct > 50 ? "text-yellow-400" : "text-emerald-400"}`}>
                  {data.pendingCount.toLocaleString()} / {data.batchSize.toLocaleString()}
                </span>
              </div>
              <Progress
                value={batchFillPct}
                className={`h-2 ${batchFillPct > 80 ? "[&>div]:bg-red-500" : batchFillPct > 50 ? "[&>div]:bg-yellow-500" : "[&>div]:bg-emerald-500"}`}
              />
              {batchFillPct > 80 && (
                <p className="text-[10px] text-red-400 flex items-center gap-1">
                  <AlertCircle size={10} /> Approaching backpressure threshold — 503s imminent
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-800/60 rounded-md p-2.5">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Posted (24h)</p>
                <p className="text-lg font-mono font-bold text-emerald-400">{data.postedLast24h.toLocaleString()}</p>
              </div>
              <div className="bg-slate-800/60 rounded-md p-2.5">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Failed (24h)</p>
                <p className="text-lg font-mono font-bold text-red-400">{data.failedLast24h.toLocaleString()}</p>
              </div>
              <div className="bg-slate-800/60 rounded-md p-2.5">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Reversed (24h)</p>
                <p className="text-lg font-mono font-bold text-orange-400">{data.reversedLast24h.toLocaleString()}</p>
              </div>
              <div className="bg-slate-800/60 rounded-md p-2.5">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Est. TPS</p>
                <p className="text-lg font-mono font-bold text-blue-400">{data.estimatedTps.toLocaleString()}</p>
              </div>
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-500">No data available</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Archival Tiers Card ────────────────────────────────────────────────────────

function ArchivalTiersCard() {
  const { data, isLoading } = trpc.paymentRails.getArchivalStats.useQuery();

  const tiers = data ? [
    { key: "hot",  label: "HOT",  color: "text-red-400",    bg: "bg-red-500/10",    icon: <Activity size={12} />, ...data.tiers.hot },
    { key: "warm", label: "WARM", color: "text-orange-400", bg: "bg-orange-500/10", icon: <Database size={12} />, ...data.tiers.warm },
    { key: "cold", label: "COLD", color: "text-blue-400",   bg: "bg-blue-500/10",   icon: <Archive size={12} />,  ...data.tiers.cold },
  ] : [];

  return (
    <Card className="bg-slate-900 border-slate-700">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <Layers size={14} className="text-blue-400" />
          Storage Tiers
        </CardTitle>
        <CardDescription className="text-xs text-slate-500">
          Next archival run: {data?.nextArchivalRun ?? "02:00 UTC daily"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full bg-slate-800" />)}
          </div>
        ) : tiers.length > 0 ? (
          tiers.map(tier => (
            <div key={tier.key} className={`flex items-center justify-between rounded-md p-2.5 ${tier.bg}`}>
              <div className="flex items-center gap-2">
                <span className={tier.color}>{tier.icon}</span>
                <div>
                  <p className={`text-xs font-bold font-mono ${tier.color}`}>{tier.label}</p>
                  <p className="text-[10px] text-slate-500">{tier.description}</p>
                </div>
              </div>
              <div className="text-right">
                <p className={`text-sm font-mono font-bold ${tier.color}`}>{(tier.count as number).toLocaleString()}</p>
                <p className="text-[10px] text-slate-500">records</p>
              </div>
            </div>
          ))
        ) : (
          <p className="text-xs text-slate-500">Admin access required to view tier stats</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Account Balances Card ──────────────────────────────────────────────────────

function AccountBalancesCard() {
  const { data, isLoading } = trpc.paymentRails.getAccountBalances.useQuery({ limit: 10 });
  const [, navigate] = useLocation();

  return (
    <Card className="bg-slate-900 border-slate-700">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <Database size={14} className="text-emerald-400" />
          Account Balances (Top 10)
        </CardTitle>
        <CardDescription className="text-xs text-slate-500">
          Derived from posted transactions · amounts in NGN
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-8 w-full bg-slate-800" />)}
          </div>
        ) : data && data.balances.length > 0 ? (
          <div className="space-y-1">
            {data.balances.map(acc => (
              <div
                key={acc.accountId}
                className="flex items-center justify-between py-1.5 border-b border-slate-800 last:border-0 cursor-pointer rounded-sm hover:bg-indigo-500/5 px-1 -mx-1 transition-colors group"
                onClick={() => navigate(`/payment-rails/accounts/${encodeURIComponent(acc.accountId)}`)}
                title={`View account detail for ${acc.accountId}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-200 truncate group-hover:text-indigo-300 transition-colors">{acc.accountName}</p>
                  <p className="text-[10px] font-mono text-slate-500">{acc.accountId}</p>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <div className="text-right">
                    <p className={`text-xs font-mono font-bold ${acc.netBalance >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {acc.netBalance >= 0 ? "+" : ""}{formatNGN(acc.netBalance)}
                    </p>
                    <p className="text-[10px] text-slate-500">{acc.currency}</p>
                  </div>
                  <ExternalLink size={10} className="text-slate-600 group-hover:text-indigo-400 transition-colors flex-shrink-0" />
                </div>
              </div>
            ))}
            <p className="text-[10px] text-slate-500 pt-1">
              {data.totalAccounts} accounts total · showing top {data.balances.length}
            </p>
          </div>
        ) : (
          <p className="text-xs text-slate-500">No account data available</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Archival Result Card ───────────────────────────────────────────────────────

interface ArchivalResultData {
  dryRun: boolean;
  summary: {
    totalRowsArchived: number;
    totalBytesWritten: number;
    errors: string[];
    completedAt: Date;
  };
  results: Array<{
    tier: string;
    rowsArchived: number;
    bytesWritten: number;
    durationMs: number;
    errors: string[];
  }>;
}

function ArchivalResultCard({ result, onDismiss }: { result: ArchivalResultData; onDismiss: () => void }) {
  const { summary, dryRun, results } = result;
  const hasErrors = summary.errors.length > 0;

  return (
    <Card className={`border ${hasErrors ? "bg-red-900/10 border-red-700/50" : "bg-emerald-900/10 border-emerald-700/50"}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            {hasErrors
              ? <AlertCircle size={14} className="text-red-400" />
              : <CheckCircle2 size={14} className="text-emerald-400" />}
            <span className={hasErrors ? "text-red-300" : "text-emerald-300"}>
              Archival {dryRun ? "Dry Run" : "Job"} Complete
            </span>
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-6 text-xs text-slate-500" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
        <CardDescription className="text-xs text-slate-500">
          Completed at {new Date(summary.completedAt).toLocaleString("en-NG")}
          {dryRun && " · Dry run — no data was moved"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-800/60 rounded p-2 text-center">
            <p className="text-[10px] text-slate-500 uppercase">Rows Archived</p>
            <p className="text-lg font-mono font-bold text-slate-200">{summary.totalRowsArchived.toLocaleString()}</p>
          </div>
          <div className="bg-slate-800/60 rounded p-2 text-center">
            <p className="text-[10px] text-slate-500 uppercase">Bytes Written</p>
            <p className="text-lg font-mono font-bold text-slate-200">{formatBytes(summary.totalBytesWritten)}</p>
          </div>
          <div className="bg-slate-800/60 rounded p-2 text-center">
            <p className="text-[10px] text-slate-500 uppercase">Errors</p>
            <p className={`text-lg font-mono font-bold ${hasErrors ? "text-red-400" : "text-emerald-400"}`}>
              {summary.errors.length}
            </p>
          </div>
        </div>

        {/* Per-tier breakdown */}
        {results.map(r => (
          <div key={r.tier} className="flex items-center justify-between bg-slate-800/40 rounded px-3 py-1.5 text-xs">
            <span className="font-mono font-bold text-slate-400 uppercase">{r.tier}</span>
            <span className="text-slate-300">{r.rowsArchived} rows · {formatBytes(r.bytesWritten)} · {r.durationMs}ms</span>
          </div>
        ))}

        {/* Errors */}
        {hasErrors && (
          <div className="space-y-1">
            {summary.errors.map((e, i) => (
              <p key={i} className="text-[10px] text-red-400 font-mono bg-red-900/20 rounded px-2 py-1">{e}</p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Transfer List ──────────────────────────────────────────────────────────────

function TransferList() {
  const [statusFilter, setStatusFilter] = useState<"all" | TransferStatus>("all");
  const [drawerTxRef, setDrawerTxRef] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, navigate] = useLocation();

  const exportTransfers = trpc.paymentRails.exportTransfers.useMutation({
    onMutate: () => {
      toast.loading("Preparing CSV export…", { id: "csv-export" });
    },
    onSuccess: (data) => {
      toast.dismiss("csv-export");
      toast.success(`CSV ready — ${data.rowCount.toLocaleString()} rows`, {
        description: "Click to download",
        action: { label: "Download", onClick: () => window.open(data.url, "_blank", "noopener,noreferrer") },
        duration: 15_000,
      });
    },
    onError: (err) => {
      toast.dismiss("csv-export");
      toast.error("Export failed", { description: err.message });
    },
  });

  // Debounce search input — 350 ms
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  const isSearching = debouncedQuery.length >= 2;

  const { data: listData, isLoading: listLoading, refetch } = trpc.paymentRails.listTransfers.useQuery(
    { status: statusFilter, limit: 50 },
    { refetchInterval: isSearching ? false : 15_000, enabled: !isSearching }
  );
  const { data: searchData, isLoading: searchLoading } = trpc.paymentRails.searchTransfers.useQuery(
    { query: debouncedQuery },
    { enabled: isSearching }
  );

  const data = isSearching ? (searchData ? { items: searchData.items, hasMore: false } : null) : listData;
  const isLoading = isSearching ? searchLoading : listLoading;

  return (
    <>
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <TrendingUp size={14} className="text-indigo-400" />
              Transfer Ledger
              {isSearching && (
                <Badge variant="outline" className="text-[10px] font-mono bg-indigo-500/10 text-indigo-400 border-indigo-500/30 ml-1">
                  {searchData?.items.length ?? 0} result{(searchData?.items.length ?? 0) !== 1 ? "s" : ""}
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              {/* Debounced search input */}
              <div className="relative">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search txRef, name, account…"
                  className="h-7 w-52 pl-6 pr-6 text-xs bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-600 focus-visible:ring-indigo-500/50"
                />
                {searchQuery && (
                  <button
                    onClick={() => { setSearchQuery(""); setDebouncedQuery(""); }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
              {!isSearching && (
                <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                  <SelectTrigger className="h-7 w-32 text-xs bg-slate-800 border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {(["all", "pending", "posted", "voided", "failed", "reversed"] as const).map(s => (
                      <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[10px] gap-1 border-slate-700 bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-700 px-2"
                disabled={exportTransfers.isPending}
                onClick={() => exportTransfers.mutate({
                  status: statusFilter,
                  search: debouncedQuery.length >= 2 ? debouncedQuery : undefined,
                })}
                title="Export current view to CSV (max 10,000 rows)"
              >
                {exportTransfers.isPending
                  ? <RefreshCw size={10} className="animate-spin" />
                  : <Download size={10} />}
                CSV
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()} disabled={isSearching}>
                <RefreshCw size={12} className="text-slate-400" />
              </Button>
            </div>
          </div>
          <CardDescription className="text-xs text-slate-500">
            {isSearching
              ? `Searching for "${debouncedQuery}" across txRef, originator, beneficiary, and account numbers`
              : "Click any row to open the Transfer Detail drawer · idempotency-keyed · batched at 8,190"}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 w-full bg-slate-800" />)}
            </div>
          ) : data && data.items.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-800 hover:bg-transparent">
                    <TableHead className="text-[10px] text-slate-500 uppercase tracking-wide w-32">Tx Ref</TableHead>
                    <TableHead className="text-[10px] text-slate-500 uppercase tracking-wide">Status</TableHead>
                    <TableHead className="text-[10px] text-slate-500 uppercase tracking-wide">Amount</TableHead>
                    <TableHead className="text-[10px] text-slate-500 uppercase tracking-wide hidden md:table-cell">Originator</TableHead>
                    <TableHead className="text-[10px] text-slate-500 uppercase tracking-wide hidden md:table-cell">Beneficiary</TableHead>
                    <TableHead className="text-[10px] text-slate-500 uppercase tracking-wide hidden lg:table-cell">Idempotency Key</TableHead>
                    <TableHead className="text-[10px] text-slate-500 uppercase tracking-wide">Time</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map(tx => (
                    <TableRow
                      key={tx.txRef}
                      className="border-slate-800 cursor-pointer hover:bg-indigo-500/5 transition-colors"
                      onClick={() => setDrawerTxRef(tx.txRef)}
                    >
                      <TableCell className="font-mono text-[11px] text-slate-300">{tx.txRef}</TableCell>
                      <TableCell><StatusBadge status={tx.status} /></TableCell>
                      <TableCell className="font-mono text-xs text-slate-200">{formatNGN(tx.amount)}</TableCell>
                      <TableCell className="text-xs text-slate-400 hidden md:table-cell max-w-[120px] truncate">{tx.originatorName ?? "—"}</TableCell>
                      <TableCell className="text-xs text-slate-400 hidden md:table-cell max-w-[120px] truncate">{tx.beneficiaryName ?? "—"}</TableCell>
                      <TableCell className="font-mono text-[10px] text-slate-500 hidden lg:table-cell max-w-[140px] truncate">
                        {tx.idempotencyKey
                          ? <span title={tx.idempotencyKey}>{tx.idempotencyKey.slice(0, 12)}…</span>
                          : <span className="text-slate-700">none</span>}
                      </TableCell>
                      <TableCell className="text-[10px] text-slate-500 whitespace-nowrap">
                        {formatRelativeTime(tx.createdAt)}
                      </TableCell>
                      <TableCell>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            const acct = (tx as any).originatorAccount ?? (tx as any).beneficiaryAccount;
                            if (acct) navigate(`/payment-rails/accounts/${encodeURIComponent(acct)}`);
                          }}
                          title="View account detail"
                          className="text-slate-600 hover:text-indigo-400 transition-colors"
                        >
                          <ExternalLink size={11} />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {data.hasMore && (
                <div className="p-3 text-center border-t border-slate-800">
                  <p className="text-[10px] text-slate-500">Showing 50 most recent · use status filter to narrow</p>
                </div>
              )}
            </>
          ) : (
            <div className="p-8 text-center">
              <TrendingUp size={32} className="text-slate-700 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No transfers found</p>
              <p className="text-xs text-slate-600 mt-1">Transfers will appear here once the payment pipeline processes them</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transfer Detail Drawer */}
      <TransferDetailDrawer
        txRef={drawerTxRef}
        open={!!drawerTxRef}
        onClose={() => setDrawerTxRef(null)}
      />
    </>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function PaymentRailsPage() {
  const [archivalResult, setArchivalResult] = useState<ArchivalResultData | null>(null);
  const [isDryRun, setIsDryRun] = useState(false);
  const [showNewTransfer, setShowNewTransfer] = useState(false);
  const [transferForm, setTransferForm] = useState({
    debitAccountId: "",
    creditAccountId: "",
    beneficiaryName: "",
    amountNgn: "",
    narration: "",
    reference: "",
  });
  const utils = trpc.useUtils();
  const initiateTransfer = trpc.paymentRails.initiateTransfer.useMutation({
    onSuccess: (data: any) => {
      toast.success(`Transfer initiated — ${data.txRef}`);
      utils.paymentRails.listTransfers.invalidate();
      setShowNewTransfer(false);
      setTransferForm({ debitAccountId: "", creditAccountId: "", beneficiaryName: "", amountNgn: "", narration: "", reference: "" });
    },
    onError: (err: any) => toast.error(err.message),
  });
  const runArchival = trpc.archival.runArchival.useMutation({
    onMutate: () => {
      toast.loading("Running archival job…", { id: "archival-job" });
    },
    onSuccess: (data) => {
      toast.dismiss("archival-job");
      const { summary, dryRun } = data;
      if (summary.errors.length > 0) {
        toast.error(`Archival finished with ${summary.errors.length} error(s)`, {
          description: `${summary.totalRowsArchived} rows archived · ${formatBytes(summary.totalBytesWritten)}`,
          duration: 6000,
        });
      } else {
        toast.success(dryRun ? "Dry run complete — no data moved" : "Archival job complete", {
          description: `${summary.totalRowsArchived} rows archived · ${formatBytes(summary.totalBytesWritten)}`,
          duration: 5000,
        });
      }
      setArchivalResult(data as ArchivalResultData);
    },
    onError: (err) => {
      toast.dismiss("archival-job");
      toast.error("Archival job failed", {
        description: err.message,
        duration: 6000,
      });
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <TrendingUp size={20} className="text-indigo-400" />
            Payment Rails
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            TigerBeetle ledger · batch size 8,190 · murmur2-partitioned Kafka · idempotency-keyed
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Grafana dashboard link */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5 border-slate-700 bg-slate-800/60 text-slate-300 hover:text-slate-100 hover:bg-slate-700"
            onClick={() => window.open(GRAFANA_DASHBOARD_URL, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink size={11} />
            View Load Test Dashboard
          </Button>

          {/* Dry-run toggle */}
          <div className="flex items-center gap-1.5 bg-slate-800/60 border border-slate-700 rounded-md px-2.5 h-8">
            <Switch
              id="dry-run-toggle"
              checked={isDryRun}
              onCheckedChange={setIsDryRun}
              className="scale-75"
            />
            <Label htmlFor="dry-run-toggle" className="text-[10px] text-slate-400 cursor-pointer select-none">
              Dry Run
            </Label>
          </div>
          {/* Run Archival Now */}
          <Button
            variant="outline"
            size="sm"
            className={`h-8 text-xs gap-1.5 ${
              isDryRun
                ? "border-slate-600 bg-slate-800/60 text-slate-300 hover:bg-slate-700"
                : "border-orange-700/50 bg-orange-900/10 text-orange-300 hover:bg-orange-900/20 hover:text-orange-200"
            }`}
            disabled={runArchival.isPending}
            onClick={() => runArchival.mutate({ tier: "all", dryRun: isDryRun })}
          >
            {runArchival.isPending
              ? <RefreshCw size={11} className="animate-spin" />
              : <Play size={11} />}
            {runArchival.isPending ? "Running…" : isDryRun ? "Preview Archival" : "Run Archival Now"}
          </Button>

          <Badge variant="outline" className="text-[10px] font-mono bg-indigo-500/10 text-indigo-400 border-indigo-500/30">
            1B payments/day architecture
          </Badge>
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
            onClick={() => setShowNewTransfer(true)}
          >
            <Plus size={11} />
            New Transfer
          </Button>
        </div>
      </div>

      {/* New Transfer Modal */}
      <Dialog open={showNewTransfer} onOpenChange={setShowNewTransfer}>
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-100">
              <Send size={16} className="text-indigo-400" />
              Initiate NIP Transfer
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400">Debit Account ID</Label>
                <Input
                  placeholder="e.g. ACC-001"
                  value={transferForm.debitAccountId}
                  onChange={e => setTransferForm(f => ({ ...f, debitAccountId: e.target.value }))}
                  className="bg-slate-800 border-slate-700 text-slate-100 text-xs h-8"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400">Credit Account ID</Label>
                <Input
                  placeholder="e.g. ACC-002"
                  value={transferForm.creditAccountId}
                  onChange={e => setTransferForm(f => ({ ...f, creditAccountId: e.target.value }))}
                  className="bg-slate-800 border-slate-700 text-slate-100 text-xs h-8"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Beneficiary Name</Label>
              <Input
                placeholder="e.g. Adaeze Okonkwo"
                value={transferForm.beneficiaryName}
                onChange={e => setTransferForm(f => ({ ...f, beneficiaryName: e.target.value }))}
                className="bg-slate-800 border-slate-700 text-slate-100 text-xs h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Amount (NGN)</Label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">₦</span>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={transferForm.amountNgn}
                  onChange={e => setTransferForm(f => ({ ...f, amountNgn: e.target.value }))}
                  className="bg-slate-800 border-slate-700 text-slate-100 text-xs h-8 pl-6"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Reference (optional)</Label>
              <Input
                placeholder="Auto-generated if blank"
                value={transferForm.reference}
                onChange={e => setTransferForm(f => ({ ...f, reference: e.target.value }))}
                className="bg-slate-800 border-slate-700 text-slate-100 text-xs h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Narration</Label>
              <Textarea
                placeholder="Payment narration…"
                value={transferForm.narration}
                onChange={e => setTransferForm(f => ({ ...f, narration: e.target.value }))}
                className="bg-slate-800 border-slate-700 text-slate-100 text-xs resize-none"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" className="border-slate-700 text-slate-400" onClick={() => setShowNewTransfer(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
              disabled={initiateTransfer.isPending || !transferForm.debitAccountId || !transferForm.creditAccountId || !transferForm.amountNgn || !transferForm.beneficiaryName}
              onClick={() => initiateTransfer.mutate({
                originatorAccountId: transferForm.debitAccountId,
                beneficiaryAccountId: transferForm.creditAccountId,
                beneficiaryName: transferForm.beneficiaryName || transferForm.creditAccountId,
                amount: parseFloat(transferForm.amountNgn),
                narration: transferForm.narration || undefined,
                reference: transferForm.reference || undefined,
              })}
            >
              {initiateTransfer.isPending ? <RefreshCw size={11} className="animate-spin" /> : <Send size={11} />}
              {initiateTransfer.isPending ? "Initiating…" : "Initiate Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Architecture note */}
      <Alert className="bg-slate-800/60 border-slate-700">
        <Zap size={14} className="text-yellow-400" />
        <AlertDescription className="text-xs text-slate-400 ml-2">
          <strong className="text-slate-300">1B payments lessons applied:</strong>{" "}
          Transfers are batched at 8,190 (TigerBeetle limit), partitioned by account via murmur2 hash across 32 Kafka partitions,
          and protected by idempotency keys. Backpressure returns HTTP 503 when the queue exceeds capacity.
          Data is tiered: hot (MySQL, 0–90d), warm (S3 JSONL, 90d–1yr), cold (S3 archive, 1yr+).
          Archival runs nightly at 02:00 UTC or on demand via the button above.
        </AlertDescription>
      </Alert>

      {/* Archival result card */}
      {archivalResult && (
        <ArchivalResultCard
          result={archivalResult}
          onDismiss={() => setArchivalResult(null)}
        />
      )}

      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <QueueStatsCard />
        <ArchivalTiersCard />
        <AccountBalancesCard />
      </div>

      {/* Transfer ledger */}
      <TransferList />
    </div>
  );
}
