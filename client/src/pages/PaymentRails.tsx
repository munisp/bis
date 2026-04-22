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
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  TrendingUp, Activity, AlertCircle, CheckCircle2, XCircle,
  Clock, RefreshCw, Database, Archive, Layers, Zap,
  ArrowUpDown, ChevronRight
} from "lucide-react";
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

type TransferStatus = "pending" | "posted" | "voided" | "failed" | "reversed";

function StatusBadge({ status }: { status: TransferStatus }) {
  const config: Record<TransferStatus, { label: string; className: string; icon: React.ReactNode }> = {
    pending: { label: "Pending", className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30", icon: <Clock size={10} /> },
    posted:  { label: "Posted",  className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: <CheckCircle2 size={10} /> },
    voided:  { label: "Voided",  className: "bg-slate-500/15 text-slate-400 border-slate-500/30", icon: <XCircle size={10} /> },
    failed:  { label: "Failed",  className: "bg-red-500/15 text-red-400 border-red-500/30", icon: <XCircle size={10} /> },
    reversed:{ label: "Reversed",className: "bg-orange-500/15 text-orange-400 border-orange-500/30", icon: <ArrowUpDown size={10} /> },
  };
  const c = config[status] ?? config.pending;
  return (
    <Badge variant="outline" className={`gap-1 text-[10px] font-mono ${c.className}`}>
      {c.icon}
      {c.label}
    </Badge>
  );
}

// ── Queue Stats Card ───────────────────────────────────────────────────────────

function QueueStatsCard() {
  const { data, isLoading, refetch } = trpc.paymentRails.getQueueStats.useQuery(undefined, {
    refetchInterval: 10_000, // Poll every 10s
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
            {/* Batch fill gauge */}
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

            {/* Stats grid */}
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
              <div key={acc.accountId} className="flex items-center justify-between py-1.5 border-b border-slate-800 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-200 truncate">{acc.accountName}</p>
                  <p className="text-[10px] font-mono text-slate-500">{acc.accountId}</p>
                </div>
                <div className="text-right ml-4">
                  <p className={`text-xs font-mono font-bold ${acc.netBalance >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {acc.netBalance >= 0 ? "+" : ""}{formatNGN(acc.netBalance)}
                  </p>
                  <p className="text-[10px] text-slate-500">{acc.currency}</p>
                </div>
              </div>
            ))}
            <p className="text-[10px] text-slate-500 pt-1">
              {data.totalAccounts} total accounts · showing top {data.balances.length} by net balance
            </p>
          </div>
        ) : (
          <p className="text-xs text-slate-500">No account data available</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Transfer List ──────────────────────────────────────────────────────────────

function TransferList() {
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "posted" | "voided" | "failed" | "reversed">("all");
  const [selectedTxRef, setSelectedTxRef] = useState<string | null>(null);

  const { data, isLoading, refetch } = trpc.paymentRails.listTransfers.useQuery(
    { status: statusFilter, limit: 50 },
    { refetchInterval: 15_000 }
  );

  const { data: detail } = trpc.paymentRails.getTransfer.useQuery(
    { txRef: selectedTxRef! },
    { enabled: !!selectedTxRef }
  );

  return (
    <Card className="bg-slate-900 border-slate-700">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <TrendingUp size={14} className="text-indigo-400" />
            Transfer Ledger
          </CardTitle>
          <div className="flex items-center gap-2">
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
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()}>
              <RefreshCw size={12} className="text-slate-400" />
            </Button>
          </div>
        </div>
        <CardDescription className="text-xs text-slate-500">
          Idempotency-keyed · batched at 8,190 · murmur2-partitioned Kafka events
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
                    className={`border-slate-800 cursor-pointer transition-colors ${selectedTxRef === tx.txRef ? "bg-indigo-500/10" : "hover:bg-slate-800/50"}`}
                    onClick={() => setSelectedTxRef(selectedTxRef === tx.txRef ? null : tx.txRef)}
                  >
                    <TableCell className="font-mono text-[11px] text-slate-300">{tx.txRef}</TableCell>
                    <TableCell><StatusBadge status={tx.status} /></TableCell>
                    <TableCell className="font-mono text-xs text-slate-200">{formatNGN(tx.amount)}</TableCell>
                    <TableCell className="text-xs text-slate-400 hidden md:table-cell max-w-[120px] truncate">{tx.originatorName ?? "—"}</TableCell>
                    <TableCell className="text-xs text-slate-400 hidden md:table-cell max-w-[120px] truncate">{tx.beneficiaryName ?? "—"}</TableCell>
                    <TableCell className="font-mono text-[10px] text-slate-500 hidden lg:table-cell max-w-[140px] truncate">
                      {tx.idempotencyKey ? (
                        <span title={tx.idempotencyKey}>{tx.idempotencyKey.slice(0, 12)}…</span>
                      ) : <span className="text-slate-700">none</span>}
                    </TableCell>
                    <TableCell className="text-[10px] text-slate-500 whitespace-nowrap">
                      {formatRelativeTime(tx.createdAt)}
                    </TableCell>
                    <TableCell>
                      <ChevronRight size={12} className={`text-slate-600 transition-transform ${selectedTxRef === tx.txRef ? "rotate-90" : ""}`} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Detail panel */}
            {selectedTxRef && detail && (
              <div className="border-t border-slate-700 p-4 bg-slate-800/40">
                <p className="text-xs font-semibold text-slate-300 mb-3">Transfer Detail — {detail.txRef}</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  {[
                    { label: "Status", value: <StatusBadge status={mapStatus(detail.status ?? "pending")} /> },
                    { label: "Amount", value: <span className="font-mono text-emerald-400">{formatNGN(detail.amount ?? 0)}</span> },
                    { label: "Currency", value: detail.currency ?? "NGN" },
                    { label: "TigerBeetle ID", value: <span className="font-mono text-[10px]">{detail.tigerBeetleId ?? "—"}</span> },
                    { label: "Idempotency Key", value: <span className="font-mono text-[10px] break-all">{detail.idempotencyKey ?? "—"}</span> },
                    { label: "Originator", value: detail.originatorName ?? "—" },
                    { label: "Beneficiary", value: detail.beneficiaryName ?? "—" },
                    { label: "Created", value: new Date(detail.createdAt).toLocaleString("en-NG") },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-slate-900/60 rounded p-2">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">{label}</p>
                      <div className="text-slate-200">{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.hasMore && (
              <div className="p-3 text-center border-t border-slate-800">
                <p className="text-[10px] text-slate-500">Showing 50 most recent transfers · use status filter to narrow results</p>
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
  );
}

// ── Helper for detail panel ────────────────────────────────────────────────────

function mapStatus(s: string): TransferStatus {
  const map: Record<string, TransferStatus> = {
    completed: "posted", failed: "failed", reversed: "reversed",
    blocked: "voided", pending: "pending", under_review: "pending", flagged: "pending",
  };
  return map[s] ?? "pending";
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function PaymentRailsPage() {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <TrendingUp size={20} className="text-indigo-400" />
            Payment Rails
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            TigerBeetle ledger · batch size 8,190 · murmur2-partitioned Kafka · idempotency-keyed
          </p>
        </div>
        <Badge variant="outline" className="text-[10px] font-mono bg-indigo-500/10 text-indigo-400 border-indigo-500/30">
          1B payments/day architecture
        </Badge>
      </div>

      {/* Architecture note */}
      <Alert className="bg-slate-800/60 border-slate-700">
        <Zap size={14} className="text-yellow-400" />
        <AlertDescription className="text-xs text-slate-400 ml-2">
          <strong className="text-slate-300">1B payments lessons applied:</strong>{" "}
          Transfers are batched at 8,190 (TigerBeetle limit), partitioned by account via murmur2 hash across 32 Kafka partitions,
          and protected by idempotency keys. Backpressure returns HTTP 503 when the queue exceeds capacity.
          Data is tiered: hot (MySQL, 0–90d), warm (S3 JSONL, 90d–1yr), cold (S3 archive, 1yr+).
          Archival runs nightly at 02:00 UTC.
        </AlertDescription>
      </Alert>

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
