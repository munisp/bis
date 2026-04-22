/**
 * TigerBeetle Account Detail Page
 *
 * Route: /payment-rails/accounts/:accountId
 *
 * Shows:
 *   - Balance summary (net, posted debits/credits, pending)
 *   - 30-day running balance chart (Recharts AreaChart)
 *   - Recent transfer history table
 *   - "Freeze Account" admin action
 */
import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  ArrowLeft, TrendingUp, TrendingDown, AlertTriangle, Snowflake,
  ArrowUpDown, CheckCircle2, XCircle, Clock, AlertCircle, RefreshCw, History, Unlock,
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
  const cfg = {
    pending:  { label: "Pending",  cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30", icon: <Clock size={9} /> },
    posted:   { label: "Posted",   cls: "bg-green-500/10 text-green-400 border-green-500/30",   icon: <CheckCircle2 size={9} /> },
    voided:   { label: "Voided",   cls: "bg-slate-500/10 text-slate-400 border-slate-500/30",   icon: <XCircle size={9} /> },
    failed:   { label: "Failed",   cls: "bg-red-500/10 text-red-400 border-red-500/30",         icon: <AlertCircle size={9} /> },
    reversed: { label: "Reversed", cls: "bg-purple-500/10 text-purple-400 border-purple-500/30", icon: <ArrowUpDown size={9} /> },
  }[status] ?? { label: status, cls: "bg-slate-500/10 text-slate-400 border-slate-500/30", icon: null };
  return (
    <Badge variant="outline" className={`text-[10px] gap-1 ${cfg.cls}`}>
      {cfg.icon}{cfg.label}
    </Badge>
  );
}

// ── Balance Chart ──────────────────────────────────────────────────────────────

interface DaySeries {
  day: string;
  credits: number;
  debits: number;
  net: number;
}

function BalanceChart({ series }: { series: DaySeries[] }) {
  if (series.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-slate-600 text-sm">
        No transaction history in the last 30 days
      </div>
    );
  }

  const chartData = series.map(d => ({
    day: d.day,
    Credits: Math.round(d.credits / 100),
    Debits: Math.round(d.debits / 100),
    Net: Math.round(d.net / 100),
  }));

  const formatYAxis = (v: number) =>
    v >= 1_000_000 ? `₦${(v / 1_000_000).toFixed(1)}M`
    : v >= 1_000 ? `₦${(v / 1_000).toFixed(0)}K`
    : `₦${v}`;

  const formatTooltip = (value: number) =>
    `₦${value.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="creditsGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="debitsGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="day"
          tick={{ fontSize: 9, fill: "#64748b" }}
          tickFormatter={v => v.slice(5)} // MM-DD
          interval="preserveStartEnd"
        />
        <YAxis tick={{ fontSize: 9, fill: "#64748b" }} tickFormatter={formatYAxis} width={55} />
        <Tooltip
          contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, fontSize: 11 }}
          labelStyle={{ color: "#94a3b8" }}
          formatter={(value: number, name: string) => [formatTooltip(value), name]}
        />
        <Legend wrapperStyle={{ fontSize: 10, color: "#94a3b8" }} />
        <Area type="monotone" dataKey="Credits" stroke="#22c55e" strokeWidth={1.5} fill="url(#creditsGrad)" dot={false} />
        <Area type="monotone" dataKey="Debits"  stroke="#ef4444" strokeWidth={1.5} fill="url(#debitsGrad)"  dot={false} />
        <Area type="monotone" dataKey="Net"     stroke="#6366f1" strokeWidth={2}   fill="url(#netGrad)"     dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Freeze Account Dialog ──────────────────────────────────────────────────────

function FreezeAccountDialog({
  accountId,
  open,
  onClose,
}: {
  accountId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const utils = trpc.useUtils();

  const freeze = trpc.paymentRails.freezeAccount.useMutation({
    onSuccess: (data) => {
      toast.success("Account frozen", {
        description: `${data.affectedTransactions} pending transfer(s) blocked · ${new Date(data.frozenAt).toLocaleString()}`,
        duration: 6000,
      });
      utils.paymentRails.getAccountDetail.invalidate({ accountId });
      utils.paymentRails.getFreezeHistory.invalidate({ accountId });
      onClose();
      setReason("");
    },
    onError: (err) => {
      toast.error("Failed to freeze account", { description: err.message, duration: 6000 });
    },
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-200 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-400">
            <Snowflake size={16} />
            Freeze Account
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-sm">
            This will block all pending and under-review transfers for account{" "}
            <span className="font-mono text-slate-300">{accountId}</span>. This action is logged.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-400">Reason (required)</Label>
            <Textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Suspected fraudulent activity — AML alert #4521"
              className="bg-slate-800 border-slate-700 text-slate-200 text-sm resize-none h-24 placeholder:text-slate-600"
            />
          </div>
          <Alert className="bg-red-900/10 border-red-700/40">
            <AlertTriangle size={12} className="text-red-400" />
            <AlertDescription className="text-xs text-red-300 ml-2">
              All pending transfers will be set to <strong>blocked</strong> status immediately.
              Posted transfers are not affected.
            </AlertDescription>
          </Alert>
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
            onClick={onClose}
            disabled={freeze.isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-red-600 hover:bg-red-700 text-white gap-1.5"
            disabled={reason.trim().length < 5 || freeze.isPending}
            onClick={() => freeze.mutate({ accountId, reason: reason.trim() })}
          >
            {freeze.isPending ? <RefreshCw size={11} className="animate-spin" /> : <Snowflake size={11} />}
            {freeze.isPending ? "Freezing…" : "Freeze Account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Freeze History Tab ─────────────────────────────────────────────────────────

function FreezeHistoryTab({ accountId, isAdmin }: { accountId: string; isAdmin: boolean }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.paymentRails.getFreezeHistory.useQuery({ accountId });

  const unfreeze = trpc.paymentRails.unfreezeAccount.useMutation({
    onSuccess: () => {
      toast.success("Account unfrozen");
      utils.paymentRails.getFreezeHistory.invalidate({ accountId });
      utils.paymentRails.getAccountDetail.invalidate({ accountId });
    },
    onError: (err) => toast.error("Unfreeze failed", { description: err.message }),
  });

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full bg-slate-800" />)}
      </div>
    );
  }

  if (!data || data.events.length === 0) {
    return (
      <div className="p-8 text-center">
        <History size={32} className="text-slate-700 mx-auto mb-2" />
        <p className="text-sm text-slate-500">No freeze events recorded for this account</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      {data.events.map(ev => (
        <div key={ev.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Snowflake size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-slate-200">
                  Frozen by {ev.frozenByName ?? "Admin"}
                </p>
                <p className="text-[10px] text-slate-500">
                  {new Date(ev.frozenAt).toLocaleString()} · {ev.affectedTransactions} transfer(s) blocked
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {ev.unfrozenAt ? (
                <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/30 gap-1">
                  <Unlock size={9} /> Unfrozen
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-400 border-red-500/30 gap-1">
                  <Snowflake size={9} /> Active
                </Badge>
              )}
              {isAdmin && !ev.unfrozenAt && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] gap-1 border-green-700/50 bg-green-900/10 text-green-400 hover:bg-green-900/20 px-2"
                  disabled={unfreeze.isPending}
                  onClick={() => unfreeze.mutate({ accountId })}
                >
                  {unfreeze.isPending ? <RefreshCw size={9} className="animate-spin" /> : <Unlock size={9} />}
                  Unfreeze
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-slate-400 pl-5">
            <span className="font-medium text-slate-500">Reason: </span>{ev.reason}
          </p>
          {ev.unfrozenAt && (
            <p className="text-[10px] text-slate-500 pl-5">
              Unfrozen by {ev.unfrozenByName ?? "Admin"} · {new Date(ev.unfrozenAt).toLocaleString()}
              {ev.notes ? ` · ${ev.notes}` : ""}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function AccountDetailPage() {
  const params = useParams<{ accountId: string }>();
  const accountId = decodeURIComponent(params.accountId ?? "");
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [freezeOpen, setFreezeOpen] = useState(false);

  const { data, isLoading, error, refetch } = trpc.paymentRails.getAccountDetail.useQuery(
    { accountId },
    { enabled: !!accountId, refetchInterval: 30_000 }
  );

  if (!accountId) {
    return (
      <div className="p-6 text-center text-slate-500">
        <AlertCircle size={32} className="mx-auto mb-2 text-slate-700" />
        <p>No account ID provided.</p>
        <Button variant="ghost" size="sm" className="mt-3 text-slate-400" onClick={() => navigate("/payment-rails")}>
          <ArrowLeft size={12} className="mr-1" /> Back to Payment Rails
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-slate-400 hover:text-slate-200 gap-1.5 -ml-1"
            onClick={() => navigate("/payment-rails")}
          >
            <ArrowLeft size={12} /> Payment Rails
          </Button>
          <span className="text-slate-700">/</span>
          <div>
            <h1 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <ArrowUpDown size={16} className="text-indigo-400" />
              {isLoading ? <Skeleton className="h-5 w-40 bg-slate-800" /> : (data?.accountName ?? accountId)}
            </h1>
            <p className="text-xs text-slate-500 font-mono mt-0.5">{accountId}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-slate-400 hover:text-slate-200 gap-1.5"
            onClick={() => refetch()}
          >
            <RefreshCw size={11} /> Refresh
          </Button>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 border-red-700/50 bg-red-900/10 text-red-400 hover:bg-red-900/20 hover:text-red-300"
              onClick={() => setFreezeOpen(true)}
            >
              <Snowflake size={11} /> Freeze Account
            </Button>
          )}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <Alert className="bg-red-900/10 border-red-700/40">
          <AlertCircle size={14} className="text-red-400" />
          <AlertDescription className="text-sm text-red-300 ml-2">
            {error.message === "Account not found"
              ? `No transactions found for account "${accountId}". The account may not exist or have no activity.`
              : error.message}
          </AlertDescription>
        </Alert>
      )}

      {/* Balance summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Net Balance",
            value: data?.balance.net,
            icon: <TrendingUp size={14} />,
            color: (data?.balance.net ?? 0) >= 0 ? "text-green-400" : "text-red-400",
            bg: (data?.balance.net ?? 0) >= 0 ? "bg-green-500/10" : "bg-red-500/10",
          },
          {
            label: "Credits Posted",
            value: data?.balance.creditsPosted,
            icon: <TrendingUp size={14} />,
            color: "text-green-400",
            bg: "bg-green-500/10",
          },
          {
            label: "Debits Posted",
            value: data?.balance.debitsPosted,
            icon: <TrendingDown size={14} />,
            color: "text-red-400",
            bg: "bg-red-500/10",
          },
          {
            label: "Pending",
            value: (data?.balance.creditsPending ?? 0) + (data?.balance.debitsPending ?? 0),
            icon: <Clock size={14} />,
            color: "text-yellow-400",
            bg: "bg-yellow-500/10",
          },
        ].map(card => (
          <Card key={card.label} className="bg-slate-900 border-slate-700">
            <CardContent className="p-4">
              <div className={`flex items-center gap-1.5 mb-2 ${card.color}`}>
                {card.icon}
                <span className="text-[10px] font-medium uppercase tracking-wide">{card.label}</span>
              </div>
              {isLoading ? (
                <Skeleton className="h-7 w-24 bg-slate-800" />
              ) : (
                <p className={`text-lg font-bold font-mono ${card.color}`}>
                  {card.value !== undefined ? formatNGN(card.value) : "—"}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 30-day balance chart */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <TrendingUp size={14} className="text-indigo-400" />
            30-Day Balance History
          </CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Daily posted credits, debits, and net balance (NGN)
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <Skeleton className="h-48 w-full bg-slate-800" />
          ) : (
            <BalanceChart series={data?.dailySeries ?? []} />
          )}
        </CardContent>
      </Card>

      {/* Tabbed section: Transfer History + Freeze History */}
      <Tabs defaultValue="transfers" className="space-y-0">
        <TabsList className="bg-slate-800/60 border border-slate-700 h-9 p-1 rounded-lg">
          <TabsTrigger value="transfers" className="text-xs gap-1.5 data-[state=active]:bg-slate-700 data-[state=active]:text-slate-100">
            <ArrowUpDown size={11} /> Transfer History
            {data && (
              <Badge variant="outline" className="text-[10px] font-mono bg-slate-700 text-slate-400 border-slate-600 ml-0.5 h-4 px-1">
                {data.history.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="freezes" className="text-xs gap-1.5 data-[state=active]:bg-slate-700 data-[state=active]:text-slate-100">
            <History size={11} /> Freeze History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="transfers" className="mt-0">
      <Card className="bg-slate-900 border-slate-700 rounded-tl-none">
        <CardHeader className="pb-3">
          <CardDescription className="text-xs text-slate-500">
            Most recent 50 transfers involving this account
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 w-full bg-slate-800" />)}
            </div>
          ) : data && data.history.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-[10px] text-slate-500 uppercase tracking-wide w-32">Tx Ref</TableHead>
                  <TableHead className="text-[10px] text-slate-500 uppercase tracking-wide">Status</TableHead>
                  <TableHead className="text-[10px] text-slate-500 uppercase tracking-wide">Amount</TableHead>
                  <TableHead className="text-[10px] text-slate-500 uppercase tracking-wide hidden md:table-cell">Direction</TableHead>
                  <TableHead className="text-[10px] text-slate-500 uppercase tracking-wide hidden md:table-cell">Counterparty</TableHead>
                  <TableHead className="text-[10px] text-slate-500 uppercase tracking-wide">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.history.map(tx => {
                  const isDebit = tx.originatorAccount === accountId;
                  const counterparty = isDebit
                    ? (tx.beneficiaryName ?? tx.beneficiaryAccount ?? "—")
                    : (tx.originatorName ?? tx.originatorAccount ?? "—");
                  return (
                    <TableRow key={tx.txRef} className="border-slate-800 hover:bg-indigo-500/5 transition-colors">
                      <TableCell className="font-mono text-[11px] text-slate-300">{tx.txRef}</TableCell>
                      <TableCell><StatusBadge status={tx.status as TransferStatus} /></TableCell>
                      <TableCell className={`font-mono text-xs font-semibold ${isDebit ? "text-red-400" : "text-green-400"}`}>
                        {isDebit ? "−" : "+"}{formatNGN(tx.amount)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="outline" className={`text-[10px] gap-1 ${isDebit ? "bg-red-500/10 text-red-400 border-red-500/30" : "bg-green-500/10 text-green-400 border-green-500/30"}`}>
                          {isDebit ? <TrendingDown size={9} /> : <TrendingUp size={9} />}
                          {isDebit ? "Debit" : "Credit"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-400 hidden md:table-cell max-w-[140px] truncate">
                        {counterparty}
                      </TableCell>
                      <TableCell className="text-[10px] text-slate-500 whitespace-nowrap">
                        {formatRelativeTime(tx.createdAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="p-8 text-center">
              <ArrowUpDown size={32} className="text-slate-700 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No transfers found for this account</p>
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="freezes" className="mt-0">
          <Card className="bg-slate-900 border-slate-700 rounded-tl-none">
            <CardHeader className="pb-3">
              <CardDescription className="text-xs text-slate-500">
                All freeze and unfreeze events for this account, ordered by most recent
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <FreezeHistoryTab accountId={accountId} isAdmin={isAdmin} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Freeze dialog */}
      {isAdmin && (
        <FreezeAccountDialog
          accountId={accountId}
          open={freezeOpen}
          onClose={() => setFreezeOpen(false)}
        />
      )}
    </div>
  );
}
