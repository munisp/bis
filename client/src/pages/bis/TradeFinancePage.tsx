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
import {
  FileText, Plus, Search, Eye, ChevronLeft, ChevronRight,
  RefreshCw, Globe, DollarSign, Clock, CheckCircle
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-500/20 text-gray-400",
  issued: "bg-blue-500/20 text-blue-400",
  advised: "bg-cyan-500/20 text-cyan-400",
  confirmed: "bg-indigo-500/20 text-indigo-400",
  presented: "bg-yellow-500/20 text-yellow-400",
  accepted: "bg-orange-500/20 text-orange-400",
  paid: "bg-green-500/20 text-green-400",
  expired: "bg-gray-500/20 text-gray-400",
  cancelled: "bg-red-500/20 text-red-400",
  rejected: "bg-red-500/20 text-red-400",
};

const LC_TYPES: Record<string, string> = {
  sight: "Sight LC",
  usance: "Usance LC",
  standby: "Standby LC",
  revolving: "Revolving LC",
  deferred: "Deferred Payment LC",
};

export default function TradeFinancePage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedLC, setSelectedLC] = useState<any>(null);

  const limit = 20;
  const utils = trpc.useUtils();

  const { data: lcData, isLoading } = trpc.tradeFinance.list.useQuery({
    limit,
    offset: page * limit,
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  const { data: stats } = trpc.tradeFinance.stats.useQuery();

  const [form, setForm] = useState({
    lcType: "sight" as "sight" | "usance" | "deferred" | "revolving" | "standby",
    applicantName: "",
    applicantCountry: "NG",
    beneficiaryName: "",
    beneficiaryCountry: "",
    amount: "",
    currency: "USD",
    expiryDate: "",
    goodsDescription: "",
    portOfLoading: "",
    portOfDischarge: "",
    incoterms: "CIF",
  });

  const createMutation = trpc.tradeFinance.create.useMutation({
    onSuccess: () => {
      toast.success("Letter of Credit created");
      utils.tradeFinance.list.invalidate();
      utils.tradeFinance.stats.invalidate();
      setShowCreate(false);
      setForm({ lcType: "sight", applicantName: "", applicantCountry: "NG", beneficiaryName: "", beneficiaryCountry: "", amount: "", currency: "USD", expiryDate: "", goodsDescription: "", portOfLoading: "", portOfDischarge: "", incoterms: "CIF" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateStatusMutation = trpc.tradeFinance.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("LC status updated");
      utils.tradeFinance.list.invalidate();
      setSelectedLC(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const totalPages = Math.ceil((lcData?.total ?? 0) / limit);

  const NEXT_STATUS: Record<string, string> = {
    draft: "issued",
    issued: "advised",
    advised: "confirmed",
    confirmed: "presented",
    presented: "accepted",
    accepted: "paid",
  };

  return (
    <BISLayout title="Trade Finance" subtitle="Letters of Credit lifecycle — issue, advise, confirm, and settle">
      <div className="space-y-6">
        <div className="flex justify-end">
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            New Letter of Credit
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total LCs", value: stats?.total ?? 0, icon: FileText, color: "text-blue-400" },
            { label: "Issued", value: stats?.issued ?? 0, icon: Globe, color: "text-green-400" },
            { label: "Expired", value: stats?.expired ?? 0, icon: Clock, color: "text-yellow-400" },
            { label: "Total Value", value: `$${((stats?.totalValue ?? 0) / 1_000_000).toFixed(1)}M`, icon: DollarSign, color: "text-cyan-400" },
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

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by LC ref, applicant, beneficiary..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {Object.keys(STATUS_COLORS).map(k => (
                <SelectItem key={k} value={k}>{k.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => utils.tradeFinance.list.invalidate()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {/* Table */}
        <Card className="bg-card border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left p-3 font-medium">LC Ref</th>
                  <th className="text-left p-3 font-medium">Type</th>
                  <th className="text-left p-3 font-medium">Applicant</th>
                  <th className="text-left p-3 font-medium">Beneficiary</th>
                  <th className="text-right p-3 font-medium">Amount</th>
                  <th className="text-center p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium">Expiry</th>
                  <th className="text-right p-3 font-medium">Actions</th>
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
                ) : lcData?.items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      <Globe className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      No letters of credit found
                    </td>
                  </tr>
                ) : lcData?.items.map((lc: any) => (
                  <tr key={lc.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="p-3 font-mono text-xs text-blue-400">{lc.lcRef}</td>
                    <td className="p-3 text-xs">{LC_TYPES[lc.type] ?? lc.type}</td>
                    <td className="p-3">
                      <div className="font-medium text-xs">{lc.applicantName}</div>
                      <div className="text-muted-foreground text-xs">{lc.applicantCountry}</div>
                    </td>
                    <td className="p-3">
                      <div className="font-medium text-xs">{lc.beneficiaryName}</div>
                      <div className="text-muted-foreground text-xs">{lc.beneficiaryCountry}</div>
                    </td>
                    <td className="p-3 text-right font-mono text-xs">
                      {lc.currency} {Number(lc.amount).toLocaleString()}
                    </td>
                    <td className="p-3 text-center">
                      <Badge className={`text-xs ${STATUS_COLORS[lc.status] ?? ""}`}>
                        {lc.status?.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {lc.expiryDate ? new Date(lc.expiryDate).toLocaleDateString() : "—"}
                    </td>
                    <td className="p-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setSelectedLC(lc)}>
                        <Eye className="w-3 h-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-3 border-t border-border">
              <span className="text-sm text-muted-foreground">{lcData?.total} LCs</span>
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
      </div>

      {/* Create LC Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Letter of Credit</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div>
              <Label>LC Type</Label>
              <Select value={form.lcType} onValueChange={(v) => setForm(f => ({ ...f, lcType: v as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(LC_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={form.currency} onValueChange={(v) => setForm(f => ({ ...f, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["USD", "EUR", "GBP", "NGN", "GHS", "KES"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Applicant Name *</Label>
              <Input value={form.applicantName} onChange={(e) => setForm(f => ({ ...f, applicantName: e.target.value }))} />
            </div>
            <div>
              <Label>Applicant Country (2-letter)</Label>
              <Input value={form.applicantCountry} onChange={(e) => setForm(f => ({ ...f, applicantCountry: e.target.value.toUpperCase() }))} maxLength={2} />
            </div>
            <div>
              <Label>Beneficiary Name *</Label>
              <Input value={form.beneficiaryName} onChange={(e) => setForm(f => ({ ...f, beneficiaryName: e.target.value }))} />
            </div>
            <div>
              <Label>Beneficiary Country (2-letter) *</Label>
              <Input value={form.beneficiaryCountry} onChange={(e) => setForm(f => ({ ...f, beneficiaryCountry: e.target.value.toUpperCase() }))} maxLength={2} />
            </div>
            <div>
              <Label>Amount *</Label>
              <Input type="number" value={form.amount} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label>Expiry Date *</Label>
              <Input type="date" value={form.expiryDate} onChange={(e) => setForm(f => ({ ...f, expiryDate: e.target.value }))} />
            </div>
            <div>
              <Label>Port of Loading</Label>
              <Input value={form.portOfLoading} onChange={(e) => setForm(f => ({ ...f, portOfLoading: e.target.value }))} placeholder="e.g. Lagos, Apapa" />
            </div>
            <div>
              <Label>Port of Discharge</Label>
              <Input value={form.portOfDischarge} onChange={(e) => setForm(f => ({ ...f, portOfDischarge: e.target.value }))} placeholder="e.g. Rotterdam" />
            </div>
            <div>
              <Label>Incoterms</Label>
              <Select value={form.incoterms} onValueChange={(v) => setForm(f => ({ ...f, incoterms: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"].map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Goods Description</Label>
              <Input value={form.goodsDescription} onChange={(e) => setForm(f => ({ ...f, goodsDescription: e.target.value }))} placeholder="e.g. 500MT of refined petroleum products" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({
                lcType: form.lcType,
                applicantName: form.applicantName,
                applicantCountry: form.applicantCountry,
                beneficiaryName: form.beneficiaryName,
                beneficiaryCountry: form.beneficiaryCountry,
                amount: parseFloat(form.amount),
                currency: form.currency,
                expiryDate: form.expiryDate,
                goodsDescription: form.goodsDescription || undefined,
                portOfLoading: form.portOfLoading || undefined,
                portOfDischarge: form.portOfDischarge || undefined,
                incoterms: form.incoterms || undefined,
              })}
              disabled={createMutation.isPending || !form.applicantName || !form.beneficiaryName || !form.amount || !form.expiryDate || !form.beneficiaryCountry}
            >
              {createMutation.isPending ? "Creating..." : "Create LC"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* LC Detail Dialog */}
      {selectedLC && (
        <Dialog open={true} onOpenChange={() => setSelectedLC(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>LC {selectedLC.lcRef}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Type:</span> <span>{LC_TYPES[selectedLC.type] ?? selectedLC.type}</span></div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <Badge className={`text-xs ${STATUS_COLORS[selectedLC.status] ?? ""}`}>{selectedLC.status?.replace(/_/g, " ")}</Badge>
                </div>
                <div><span className="text-muted-foreground">Applicant:</span> <span className="font-medium">{selectedLC.applicantName}</span></div>
                <div><span className="text-muted-foreground">Beneficiary:</span> <span className="font-medium">{selectedLC.beneficiaryName}</span></div>
                <div><span className="text-muted-foreground">Amount:</span> <span className="font-mono">{selectedLC.currency} {Number(selectedLC.amount).toLocaleString()}</span></div>
                <div><span className="text-muted-foreground">Expiry:</span> <span>{selectedLC.expiryDate ? new Date(selectedLC.expiryDate).toLocaleDateString() : "—"}</span></div>
                {selectedLC.goodsDescription && (
                  <div className="col-span-2"><span className="text-muted-foreground">Goods:</span> <span>{selectedLC.goodsDescription}</span></div>
                )}
              </div>
              {NEXT_STATUS[selectedLC.status] && (
                <div className="pt-2">
                  <Button
                    size="sm"
                    onClick={() => updateStatusMutation.mutate({ id: selectedLC.id, status: NEXT_STATUS[selectedLC.status] as any })}
                    disabled={updateStatusMutation.isPending}
                  >
                    Advance to: {NEXT_STATUS[selectedLC.status].replace(/_/g, " ")}
                  </Button>
                </div>
              )}
              {selectedLC.status === "paid" && (
                <div className="flex items-center gap-2 text-green-400">
                  <CheckCircle className="w-4 h-4" />
                  <span className="text-sm">LC settled — payment made</span>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </BISLayout>
  );
}
