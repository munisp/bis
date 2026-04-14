import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle, TrendingUp, Shield, DollarSign, Search,
  Plus, Eye, ChevronLeft, ChevronRight, RefreshCw, CheckCircle
} from "lucide-react";

const RISK_COLORS: Record<string, string> = {
  low: "bg-green-500/20 text-green-400 border-green-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-blue-500/20 text-blue-400",
  completed: "bg-green-500/20 text-green-400",
  blocked: "bg-red-500/20 text-red-400",
  under_review: "bg-yellow-500/20 text-yellow-400",
  flagged: "bg-orange-500/20 text-orange-400",
  failed: "bg-gray-500/20 text-gray-400",
  reversed: "bg-purple-500/20 text-purple-400",
};

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

export default function AMLTransactionsPage() {
  const [tab, setTab] = useState("transactions");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [alertResolution, setAlertResolution] = useState<{ id: number; resolution: string; notes: string } | null>(null);

  const limit = 20;
  const utils = trpc.useUtils();

  const { data: stats } = trpc.transactions.stats.useQuery();
  const { data: txData, isLoading } = trpc.transactions.list.useQuery({
    limit,
    offset: page * limit,
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    riskLevel: riskFilter !== "all" ? riskFilter : undefined,
  });
  const { data: alertData } = trpc.transactions.listAlerts.useQuery({
    limit: 50,
    status: "open",
  });

  const createMutation = trpc.transactions.create.useMutation({
    onSuccess: () => {
      toast.success("Transaction recorded — AML scoring applied");
      utils.transactions.list.invalidate();
      utils.transactions.stats.invalidate();
      setShowCreate(false);
      setForm({ txType: "wire_transfer", amount: "", currency: "NGN", originatorName: "", originatorAccount: "", originatorBank: "", originatorCountry: "NG", beneficiaryName: "", beneficiaryAccount: "", beneficiaryBank: "", beneficiaryCountry: "NG", narration: "", purposeCode: "" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resolveMutation = trpc.transactions.resolveAlert.useMutation({
    onSuccess: () => {
      toast.success("Alert resolved");
      utils.transactions.listAlerts.invalidate();
      utils.transactions.stats.invalidate();
      setAlertResolution(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const [form, setForm] = useState({
    txType: "wire_transfer" as any,
    amount: "",
    currency: "NGN",
    originatorName: "",
    originatorAccount: "",
    originatorBank: "",
    originatorCountry: "NG",
    beneficiaryName: "",
    beneficiaryAccount: "",
    beneficiaryBank: "",
    beneficiaryCountry: "NG",
    narration: "",
    purposeCode: "",
  });

  const totalPages = Math.ceil((txData?.total ?? 0) / limit);

  return (
    <BISLayout title="AML Transaction Monitoring" subtitle="Real-time financial crime detection and suspicious transaction reporting">
      <div className="space-y-6">
        {/* Header action */}
        <div className="flex justify-end">
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Record Transaction
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Transactions", value: stats?.transactions.total ?? 0, icon: TrendingUp, color: "text-blue-400" },
            { label: "High Risk", value: stats?.transactions.highRisk ?? 0, icon: AlertTriangle, color: "text-orange-400" },
            { label: "Open Alerts", value: stats?.alerts.open ?? 0, icon: Shield, color: "text-red-400" },
            { label: "Total Volume (₦M)", value: `${((stats?.transactions.totalVolume ?? 0) / 1_000_000).toFixed(1)}M`, icon: DollarSign, color: "text-green-400" },
          ].map((s) => (
            <Card key={s.label} className="bg-card border-border">
              <CardContent className="p-4 flex items-center gap-3">
                <s.icon className={`w-8 h-8 ${s.color}`} />
                <div>
                  <div className="text-2xl font-bold">{s.value}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="alerts" className="relative">
              Alerts
              {(stats?.alerts.open ?? 0) > 0 && (
                <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">
                  {stats?.alerts.open}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="transactions" className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by ref, name, narration..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  className="pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                  <SelectItem value="under_review">Under Review</SelectItem>
                  <SelectItem value="flagged">Flagged</SelectItem>
                </SelectContent>
              </Select>
              <Select value={riskFilter} onValueChange={(v) => { setRiskFilter(v); setPage(0); }}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Risk Level" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Risk</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={() => utils.transactions.list.invalidate()}>
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>

            <Card className="bg-card border-border">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left p-3 font-medium">Ref</th>
                      <th className="text-left p-3 font-medium">Type</th>
                      <th className="text-left p-3 font-medium">Originator</th>
                      <th className="text-left p-3 font-medium">Beneficiary</th>
                      <th className="text-right p-3 font-medium">Amount</th>
                      <th className="text-center p-3 font-medium">Risk</th>
                      <th className="text-center p-3 font-medium">Status</th>
                      <th className="text-center p-3 font-medium">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/50">
                          {Array.from({ length: 8 }).map((_, j) => (
                            <td key={j} className="p-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>
                          ))}
                        </tr>
                      ))
                    ) : txData?.items.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-muted-foreground">
                          <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-30" />
                          No transactions found
                        </td>
                      </tr>
                    ) : txData?.items.map((tx: any) => (
                      <tr key={tx.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="p-3 font-mono text-xs text-blue-400">{tx.txRef}</td>
                        <td className="p-3 text-xs capitalize">{tx.type?.replace(/_/g, " ")}</td>
                        <td className="p-3">
                          <div className="font-medium text-xs">{tx.originatorName}</div>
                          <div className="text-muted-foreground text-xs">{tx.originatorCountry}</div>
                        </td>
                        <td className="p-3">
                          <div className="font-medium text-xs">{tx.beneficiaryName}</div>
                          <div className="text-muted-foreground text-xs">{tx.beneficiaryCountry}</div>
                        </td>
                        <td className="p-3 text-right font-mono text-xs">
                          {formatAmount(tx.amount, tx.currency)}
                        </td>
                        <td className="p-3 text-center">
                          <Badge className={`text-xs ${RISK_COLORS[tx.amlRiskLevel ?? "low"]}`}>
                            {tx.amlRiskLevel ?? "low"}
                          </Badge>
                        </td>
                        <td className="p-3 text-center">
                          <Badge className={`text-xs ${STATUS_COLORS[tx.status ?? "pending"]}`}>
                            {tx.status}
                          </Badge>
                        </td>
                        <td className="p-3 text-center">
                          <div className={`text-sm font-bold ${(tx.amlScore ?? 0) >= 75 ? "text-red-400" : (tx.amlScore ?? 0) >= 50 ? "text-orange-400" : "text-green-400"}`}>
                            {tx.amlScore ?? 0}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between p-3 border-t border-border">
                  <span className="text-sm text-muted-foreground">{txData?.total} transactions</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-sm px-2 py-1">{page + 1} / {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="alerts" className="space-y-4">
            <Card className="bg-card border-border">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left p-3 font-medium">Alert Ref</th>
                      <th className="text-left p-3 font-medium">Title</th>
                      <th className="text-center p-3 font-medium">Risk</th>
                      <th className="text-right p-3 font-medium">Value</th>
                      <th className="text-left p-3 font-medium">Created</th>
                      <th className="text-right p-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alertData?.items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-muted-foreground">
                          <CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-30 text-green-400" />
                          No open alerts
                        </td>
                      </tr>
                    ) : alertData?.items.map((alert: any) => (
                      <tr key={alert.id} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="p-3 font-mono text-xs text-blue-400">{alert.alertRef}</td>
                        <td className="p-3 text-xs max-w-xs truncate">{alert.title}</td>
                        <td className="p-3 text-center">
                          <Badge className={`text-xs ${RISK_COLORS[alert.riskLevel]}`}>{alert.riskLevel}</Badge>
                        </td>
                        <td className="p-3 text-right font-mono text-xs">
                          {alert.triggeredValue ? `₦${alert.triggeredValue.toLocaleString()}` : "—"}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {new Date(alert.createdAt).toLocaleDateString()}
                        </td>
                        <td className="p-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => setAlertResolution({ id: alert.id, resolution: "cleared", notes: "" })}
                          >
                            Resolve
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Create Transaction Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record Transaction</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 grid grid-cols-3 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={form.txType} onValueChange={(v) => setForm(f => ({ ...f, txType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["cash_deposit", "cash_withdrawal", "wire_transfer", "swift_mt103", "swift_mt202",
                      "sepa_credit", "sepa_debit", "internal_transfer", "fx_conversion", "mobile_money",
                      "rtgs", "nip", "cheque"].map(t => (
                      <SelectItem key={t} value={t}>{t.replace(/_/g, " ").toUpperCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Amount</Label>
                <Input type="number" value={form.amount} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
              </div>
              <div>
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={(v) => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["NGN", "USD", "EUR", "GBP", "GHS", "KES", "ZAR"].map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Originator Name *</Label>
              <Input value={form.originatorName} onChange={(e) => setForm(f => ({ ...f, originatorName: e.target.value }))} />
            </div>
            <div>
              <Label>Originator Account</Label>
              <Input value={form.originatorAccount} onChange={(e) => setForm(f => ({ ...f, originatorAccount: e.target.value }))} />
            </div>
            <div>
              <Label>Originator Bank</Label>
              <Input value={form.originatorBank} onChange={(e) => setForm(f => ({ ...f, originatorBank: e.target.value }))} />
            </div>
            <div>
              <Label>Originator Country</Label>
              <Input value={form.originatorCountry} onChange={(e) => setForm(f => ({ ...f, originatorCountry: e.target.value }))} maxLength={2} />
            </div>
            <div>
              <Label>Beneficiary Name *</Label>
              <Input value={form.beneficiaryName} onChange={(e) => setForm(f => ({ ...f, beneficiaryName: e.target.value }))} />
            </div>
            <div>
              <Label>Beneficiary Account</Label>
              <Input value={form.beneficiaryAccount} onChange={(e) => setForm(f => ({ ...f, beneficiaryAccount: e.target.value }))} />
            </div>
            <div>
              <Label>Beneficiary Bank</Label>
              <Input value={form.beneficiaryBank} onChange={(e) => setForm(f => ({ ...f, beneficiaryBank: e.target.value }))} />
            </div>
            <div>
              <Label>Beneficiary Country</Label>
              <Input value={form.beneficiaryCountry} onChange={(e) => setForm(f => ({ ...f, beneficiaryCountry: e.target.value }))} maxLength={2} />
            </div>
            <div className="col-span-2">
              <Label>Narration</Label>
              <Input value={form.narration} onChange={(e) => setForm(f => ({ ...f, narration: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({
                txType: form.txType,
                amount: parseFloat(form.amount),
                currency: form.currency,
                originatorName: form.originatorName,
                originatorAccount: form.originatorAccount || undefined,
                originatorBank: form.originatorBank || undefined,
                originatorCountry: form.originatorCountry,
                beneficiaryName: form.beneficiaryName,
                beneficiaryAccount: form.beneficiaryAccount || undefined,
                beneficiaryBank: form.beneficiaryBank || undefined,
                beneficiaryCountry: form.beneficiaryCountry,
                narration: form.narration || undefined,
                purposeCode: form.purposeCode || undefined,
              })}
              disabled={createMutation.isPending || !form.originatorName || !form.beneficiaryName || !form.amount}
            >
              {createMutation.isPending ? "Processing..." : "Record & Score"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve Alert Dialog */}
      {alertResolution && (
        <Dialog open={true} onOpenChange={() => setAlertResolution(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Resolve Alert</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label>Resolution</Label>
                <Select
                  value={alertResolution.resolution}
                  onValueChange={(v) => setAlertResolution(a => a ? { ...a, resolution: v } : null)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cleared">Cleared — No suspicious activity</SelectItem>
                    <SelectItem value="escalated">Escalated — Requires investigation</SelectItem>
                    <SelectItem value="filed">Filed — STR submitted to NFIU</SelectItem>
                    <SelectItem value="false_positive">False Positive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Notes</Label>
                <Input
                  value={alertResolution.notes}
                  onChange={(e) => setAlertResolution(a => a ? { ...a, notes: e.target.value } : null)}
                  placeholder="Analyst notes..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAlertResolution(null)}>Cancel</Button>
              <Button
                onClick={() => resolveMutation.mutate({
                  alertId: alertResolution.id,
                  resolution: alertResolution.resolution as any,
                  notes: alertResolution.notes,
                })}
                disabled={resolveMutation.isPending}
              >
                {resolveMutation.isPending ? "Saving..." : "Resolve Alert"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </BISLayout>
  );
}
