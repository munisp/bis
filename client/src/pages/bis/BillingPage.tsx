/**
 * BillingPage.tsx
 * TigerBeetle-backed billing dashboard for the BIS platform.
 * Shows NGN balance, tier pricing, top-up form, and ledger transaction history.
 */

import { useState, useMemo } from "react";
import BISLayout from "@/components/BISLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Wallet,
  TrendingDown,
  TrendingUp,
  RefreshCw,
  Plus,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Receipt,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";

// ─── Mock transaction history (TigerBeetle doesn't expose history via HTTP proxy) ──
interface LedgerEntry {
  id: string;
  type: "debit" | "credit";
  amountKobo: number;
  description: string;
  investigationRef?: string;
  tier?: string;
  timestamp: Date;
  status: "posted" | "pending";
}

const MOCK_TRANSACTIONS: LedgerEntry[] = [
  { id: "tb-001", type: "debit",  amountKobo: 150_000, description: "Investigation BIS-2026-4821", investigationRef: "BIS-2026-4821", tier: "standard", timestamp: new Date(Date.now() - 1 * 3600_000), status: "posted" },
  { id: "tb-002", type: "debit",  amountKobo: 500_000, description: "Investigation BIS-2026-4820", investigationRef: "BIS-2026-4820", tier: "premium",  timestamp: new Date(Date.now() - 3 * 3600_000), status: "posted" },
  { id: "tb-003", type: "credit", amountKobo: 5_000_000, description: "Account top-up — REF/2026/0032", timestamp: new Date(Date.now() - 6 * 3600_000), status: "posted" },
  { id: "tb-004", type: "debit",  amountKobo: 50_000,  description: "Investigation BIS-2026-4819", investigationRef: "BIS-2026-4819", tier: "basic",    timestamp: new Date(Date.now() - 12 * 3600_000), status: "posted" },
  { id: "tb-005", type: "debit",  amountKobo: 150_000, description: "Investigation BIS-2026-4818", investigationRef: "BIS-2026-4818", tier: "standard", timestamp: new Date(Date.now() - 24 * 3600_000), status: "posted" },
  { id: "tb-006", type: "credit", amountKobo: 10_000_000, description: "Account top-up — REF/2026/0031", timestamp: new Date(Date.now() - 48 * 3600_000), status: "posted" },
  { id: "tb-007", type: "debit",  amountKobo: 500_000, description: "Investigation BIS-2026-4817", investigationRef: "BIS-2026-4817", tier: "premium",  timestamp: new Date(Date.now() - 72 * 3600_000), status: "posted" },
  { id: "tb-008", type: "debit",  amountKobo: 50_000,  description: "Investigation BIS-2026-4816", investigationRef: "BIS-2026-4816", tier: "basic",    timestamp: new Date(Date.now() - 96 * 3600_000), status: "posted" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatNGN(kobo: number): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 2 }).format(kobo / 100);
}

function tierColor(tier?: string) {
  switch (tier) {
    case "premium":  return "bg-purple-500/20 text-purple-300 border-purple-500/30";
    case "standard": return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    default:         return "bg-slate-500/20 text-slate-300 border-slate-500/30";
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const tenantId = "tenant-001"; // In production: from auth context

  const [topUpOpen, setTopUpOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpRef, setTopUpRef] = useState("");
  const [filterType, setFilterType] = useState<"all" | "debit" | "credit">("all");

  // ── tRPC queries ──────────────────────────────────────────────────────────
  const { data: balance, isLoading: balanceLoading, refetch: refetchBalance } =
    trpc.billing.getBalance.useQuery({ tenantId });

  const { data: pricing } = trpc.billing.getTierPricing.useQuery();

  const creditMutation = trpc.billing.creditAccount.useMutation({
    onSuccess: (data) => {
      toast.success("Top-up successful", { description: `${formatNGN(data.amountKobo)} credited to your account. Transfer ID: ${data.transferId}` });
      setTopUpOpen(false);
      setTopUpAmount("");
      setTopUpRef("");
      refetchBalance();
    },
    onError: (err) => {
      toast.error("Top-up failed", { description: err.message });
    },
  });

  // ── Derived state ─────────────────────────────────────────────────────────
  const balanceKobo = balance?.balanceKobo ?? 0;
  const balanceAvailable = balance?.available ?? false;

  const totalDebits = useMemo(
    () => MOCK_TRANSACTIONS.filter((t) => t.type === "debit").reduce((s, t) => s + t.amountKobo, 0),
    []
  );
  const totalCredits = useMemo(
    () => MOCK_TRANSACTIONS.filter((t) => t.type === "credit").reduce((s, t) => s + t.amountKobo, 0),
    []
  );

  const filteredTx = useMemo(
    () => filterType === "all" ? MOCK_TRANSACTIONS : MOCK_TRANSACTIONS.filter((t) => t.type === filterType),
    [filterType]
  );

  const handleTopUp = () => {
    const amountNGN = parseFloat(topUpAmount);
    if (isNaN(amountNGN) || amountNGN <= 0) {
      toast.error("Invalid amount", { description: "Enter a positive NGN amount." });
      return;
    }
    creditMutation.mutate({
      tenantId,
      amountKobo: Math.round(amountNGN * 100),
      reference: topUpRef || undefined,
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <BISLayout
      title="Billing & Ledger"
      subtitle="TigerBeetle double-entry financial audit trail"
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchBalance()}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setTopUpOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Plus className="h-4 w-4 mr-1" />
            Top Up
          </Button>
        </div>
      }
    >
      {/* ── KPI Row ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {/* Balance */}
        <Card className="bg-slate-900 border-slate-700">
          <CardContent className="pt-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Available Balance</p>
                {balanceLoading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                ) : (
                  <p className="text-2xl font-bold text-emerald-400 font-mono">
                    {formatNGN(balanceAvailable ? balanceKobo : 14_300_000)}
                  </p>
                )}
                <p className="text-xs text-slate-500 mt-1">
                  {balanceAvailable ? "Live from TigerBeetle" : "Simulated balance"}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <Wallet className="h-5 w-5 text-emerald-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Total debits */}
        <Card className="bg-slate-900 border-slate-700">
          <CardContent className="pt-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Total Debits (30d)</p>
                <p className="text-2xl font-bold text-red-400 font-mono">{formatNGN(totalDebits)}</p>
                <p className="text-xs text-slate-500 mt-1">{MOCK_TRANSACTIONS.filter((t) => t.type === "debit").length} investigations</p>
              </div>
              <div className="p-2 rounded-lg bg-red-500/10">
                <TrendingDown className="h-5 w-5 text-red-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Total credits */}
        <Card className="bg-slate-900 border-slate-700">
          <CardContent className="pt-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Total Credits (30d)</p>
                <p className="text-2xl font-bold text-blue-400 font-mono">{formatNGN(totalCredits)}</p>
                <p className="text-xs text-slate-500 mt-1">{MOCK_TRANSACTIONS.filter((t) => t.type === "credit").length} top-ups</p>
              </div>
              <div className="p-2 rounded-lg bg-blue-500/10">
                <TrendingUp className="h-5 w-5 text-blue-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Tier Pricing ──────────────────────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-4">
          <Card className="bg-slate-900 border-slate-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-slate-400" />
                Investigation Tier Pricing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {pricing ? (
                pricing.map((tier) => (
                  <div
                    key={tier.tier}
                    className="flex items-center justify-between p-3 rounded-lg bg-slate-800/60 border border-slate-700/50"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-200 capitalize">{tier.tier}</p>
                      <p className="text-xs text-slate-500">{tier.currency}</p>
                    </div>
                    <p className="text-sm font-bold text-slate-100 font-mono">
                      {formatNGN(tier.amountKobo)}
                    </p>
                  </div>
                ))
              ) : (
                [
                  { tier: "basic", amountKobo: 50_000 },
                  { tier: "standard", amountKobo: 150_000 },
                  { tier: "premium", amountKobo: 500_000 },
                ].map((t) => (
                  <div key={t.tier} className="flex items-center justify-between p-3 rounded-lg bg-slate-800/60 border border-slate-700/50">
                    <p className="text-sm font-medium text-slate-200 capitalize">{t.tier}</p>
                    <p className="text-sm font-bold text-slate-100 font-mono">{formatNGN(t.amountKobo)}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Ledger info */}
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="pt-5 space-y-3">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Receipt className="h-4 w-4 text-slate-500" />
                <span>Powered by TigerBeetle</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Every investigation deduction is recorded as an immutable double-entry ledger
                transaction in TigerBeetle. Debit account: tenant wallet. Credit account:
                TourismPay revenue. All amounts in NGN kobo (1 NGN = 100 kobo).
              </p>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500">Ledger:</span>
                <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">NGN (ISO 566)</Badge>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500">Tenant ID:</span>
                <code className="text-slate-300 bg-slate-800 px-1.5 py-0.5 rounded text-xs">{tenantId}</code>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Transaction History ───────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <Card className="bg-slate-900 border-slate-700 h-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-slate-400" />
                  Ledger Transactions
                </CardTitle>
                <Select value={filterType} onValueChange={(v) => setFilterType(v as typeof filterType)}>
                  <SelectTrigger className="w-32 h-7 text-xs bg-slate-800 border-slate-700 text-slate-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="debit">Debits</SelectItem>
                    <SelectItem value="credit">Credits</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[480px]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700/50">
                      <th className="text-left text-xs text-slate-500 font-medium px-4 py-2">Type</th>
                      <th className="text-left text-xs text-slate-500 font-medium px-4 py-2">Description</th>
                      <th className="text-left text-xs text-slate-500 font-medium px-4 py-2">Tier</th>
                      <th className="text-right text-xs text-slate-500 font-medium px-4 py-2">Amount</th>
                      <th className="text-right text-xs text-slate-500 font-medium px-4 py-2">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTx.map((tx) => (
                      <tr
                        key={tx.id}
                        className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {tx.type === "debit" ? (
                              <ArrowDownLeft className="h-3.5 w-3.5 text-red-400" />
                            ) : (
                              <ArrowUpRight className="h-3.5 w-3.5 text-emerald-400" />
                            )}
                            <span className={`text-xs font-medium ${tx.type === "debit" ? "text-red-400" : "text-emerald-400"}`}>
                              {tx.type === "debit" ? "Debit" : "Credit"}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-xs text-slate-300 truncate max-w-[200px]">{tx.description}</p>
                          {tx.investigationRef && (
                            <p className="text-xs text-slate-500 font-mono">{tx.investigationRef}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {tx.tier ? (
                            <Badge variant="outline" className={`text-xs ${tierColor(tx.tier)}`}>
                              {tx.tier}
                            </Badge>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-xs font-mono font-semibold ${tx.type === "debit" ? "text-red-400" : "text-emerald-400"}`}>
                            {tx.type === "debit" ? "−" : "+"}{formatNGN(tx.amountKobo)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-xs text-slate-500">
                            {tx.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            <br />
                            <span className="text-slate-600">{tx.timestamp.toLocaleDateString()}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredTx.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                    <Receipt className="h-8 w-8 mb-2 opacity-40" />
                    <p className="text-sm">No transactions found</p>
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Top-Up Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={topUpOpen} onOpenChange={setTopUpOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-emerald-400" />
              Top Up Account
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Credit your tenant wallet. The transfer is recorded as a double-entry
              ledger transaction in TigerBeetle.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Amount (NGN)</Label>
              <Input
                type="number"
                min="100"
                step="100"
                placeholder="e.g. 50000"
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-600"
              />
              {topUpAmount && !isNaN(parseFloat(topUpAmount)) && (
                <p className="text-xs text-slate-500">
                  = {formatNGN(Math.round(parseFloat(topUpAmount) * 100))}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Payment Reference (optional)</Label>
              <Input
                placeholder="e.g. REF/2026/0033"
                value={topUpRef}
                onChange={(e) => setTopUpRef(e.target.value)}
                className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-600"
              />
            </div>

            {/* Quick amounts */}
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Quick Select</Label>
              <div className="flex flex-wrap gap-2">
                {[10_000, 50_000, 100_000, 500_000].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setTopUpAmount(String(amt))}
                    className="text-xs px-2.5 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
                  >
                    {formatNGN(amt * 100)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setTopUpOpen(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleTopUp}
              disabled={creditMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {creditMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Processing…</>
              ) : (
                <><CheckCircle2 className="h-4 w-4 mr-1" /> Confirm Top-Up</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BISLayout>
  );
}
