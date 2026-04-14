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
  Building2, Plus, Search, Eye, ChevronLeft, ChevronRight,
  RefreshCw, Globe, Wallet
} from "lucide-react";

const RISK_COLORS: Record<string, string> = {
  low: "bg-green-500/20 text-green-400",
  medium: "bg-yellow-500/20 text-yellow-400",
  high: "bg-orange-500/20 text-orange-400",
  critical: "bg-red-500/20 text-red-400",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/20 text-green-400",
  suspended: "bg-yellow-500/20 text-yellow-400",
  terminated: "bg-red-500/20 text-red-400",
  under_review: "bg-blue-500/20 text-blue-400",
};

export default function CorrespondentBankingPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [showAddNostro, setShowAddNostro] = useState<number | null>(null);
  const [selectedBank, setSelectedBank] = useState<any>(null);

  const limit = 20;
  const utils = trpc.useUtils();

  const { data: bankData, isLoading } = trpc.correspondentBanking.list.useQuery({
    limit,
    offset: page * limit,
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  const { data: stats } = trpc.correspondentBanking.stats.useQuery();

  const [bankForm, setBankForm] = useState({
    bankName: "",
    bic: "",
    country: "NG",
    city: "",
    riskRating: "medium" as "low" | "medium" | "high" | "critical",
    notes: "",
    amlPolicyUrl: "",
  });

  const [nostroForm, setNostroForm] = useState({
    currency: "USD",
    accountNumber: "",
    balance: "0",
  });

  const createMutation = trpc.correspondentBanking.create.useMutation({
    onSuccess: () => {
      toast.success("Correspondent bank added");
      utils.correspondentBanking.list.invalidate();
      utils.correspondentBanking.stats.invalidate();
      setShowCreate(false);
      setBankForm({ bankName: "", bic: "", country: "NG", city: "", riskRating: "medium", notes: "", amlPolicyUrl: "" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const addNostroMutation = trpc.correspondentBanking.addNostroAccount.useMutation({
    onSuccess: () => {
      toast.success("Nostro account added");
      utils.correspondentBanking.list.invalidate();
      setShowAddNostro(null);
      setNostroForm({ currency: "USD", accountNumber: "", balance: "0" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const totalPages = Math.ceil((bankData?.total ?? 0) / limit);

  return (
    <BISLayout title="Correspondent Banking" subtitle="Manage correspondent bank relationships, nostro accounts, and CDD compliance">
      <div className="space-y-6">
        <div className="flex justify-end">
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Add Correspondent Bank
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Banks", value: stats?.total ?? 0, icon: Building2, color: "text-blue-400" },
            { label: "Active Relationships", value: stats?.active ?? 0, icon: Globe, color: "text-green-400" },
            { label: "Suspended", value: stats?.suspended ?? 0, icon: Globe, color: "text-yellow-400" },
            { label: "High Risk", value: stats?.highRisk ?? 0, icon: Globe, color: "text-orange-400" },
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
              placeholder="Search by bank name, BIC, country..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="terminated">Terminated</SelectItem>
              <SelectItem value="under_review">Under Review</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => utils.correspondentBanking.list.invalidate()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {/* Table */}
        <Card className="bg-card border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left p-3 font-medium">Bank Name</th>
                  <th className="text-left p-3 font-medium">BIC/SWIFT</th>
                  <th className="text-left p-3 font-medium">Country</th>
                  <th className="text-center p-3 font-medium">Risk</th>
                  <th className="text-center p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium">Since</th>
                  <th className="text-right p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="p-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>
                      ))}
                    </tr>
                  ))
                ) : bankData?.items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      <Building2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      No correspondent banks found
                    </td>
                  </tr>
                ) : bankData?.items.map((bank: any) => (
                  <tr key={bank.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="p-3 font-medium text-sm">{bank.bankName}</td>
                    <td className="p-3 font-mono text-xs text-blue-400">{bank.bic}</td>
                    <td className="p-3 text-xs">{bank.country}</td>
                    <td className="p-3 text-center">
                      <Badge className={`text-xs ${RISK_COLORS[bank.riskRating ?? "medium"]}`}>{bank.riskRating}</Badge>
                    </td>
                    <td className="p-3 text-center">
                      <Badge className={`text-xs ${STATUS_COLORS[bank.status ?? "active"]}`}>{bank.status?.replace(/_/g, " ")}</Badge>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {bank.relationshipSince ? new Date(bank.relationshipSince).toLocaleDateString() : "—"}
                    </td>
                    <td className="p-3 text-right flex gap-1 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => setSelectedBank(bank)}>
                        <Eye className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setShowAddNostro(bank.id)} title="Add Nostro Account">
                        <Wallet className="w-3 h-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-3 border-t border-border">
              <span className="text-sm text-muted-foreground">{bankData?.total} banks</span>
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

      {/* Create Bank Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Add Correspondent Bank</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2">
              <Label>Bank Name *</Label>
              <Input value={bankForm.bankName} onChange={(e) => setBankForm(f => ({ ...f, bankName: e.target.value }))} />
            </div>
            <div>
              <Label>BIC/SWIFT Code *</Label>
              <Input value={bankForm.bic} onChange={(e) => setBankForm(f => ({ ...f, bic: e.target.value.toUpperCase() }))} maxLength={11} placeholder="e.g. ZENITHNG" />
            </div>
            <div>
              <Label>Country (2-letter ISO) *</Label>
              <Input value={bankForm.country} onChange={(e) => setBankForm(f => ({ ...f, country: e.target.value.toUpperCase() }))} maxLength={2} />
            </div>
            <div>
              <Label>City</Label>
              <Input value={bankForm.city} onChange={(e) => setBankForm(f => ({ ...f, city: e.target.value }))} />
            </div>
            <div>
              <Label>Risk Rating</Label>
              <Select value={bankForm.riskRating} onValueChange={(v) => setBankForm(f => ({ ...f, riskRating: v as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>AML Policy URL</Label>
              <Input value={bankForm.amlPolicyUrl} onChange={(e) => setBankForm(f => ({ ...f, amlPolicyUrl: e.target.value }))} placeholder="https://..." />
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Input value={bankForm.notes} onChange={(e) => setBankForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({
                bankName: bankForm.bankName,
                bic: bankForm.bic,
                country: bankForm.country,
                city: bankForm.city || undefined,
                riskRating: bankForm.riskRating,
                notes: bankForm.notes || undefined,
                amlPolicyUrl: bankForm.amlPolicyUrl || undefined,
              })}
              disabled={createMutation.isPending || !bankForm.bankName || !bankForm.bic || bankForm.bic.length < 8 || bankForm.country.length !== 2}
            >
              {createMutation.isPending ? "Adding..." : "Add Bank"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Nostro Account Dialog */}
      <Dialog open={showAddNostro !== null} onOpenChange={() => setShowAddNostro(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Nostro Account</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div>
              <Label>Currency *</Label>
              <Select value={nostroForm.currency} onValueChange={(v) => setNostroForm(f => ({ ...f, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["USD", "EUR", "GBP", "NGN", "GHS", "KES", "ZAR", "JPY"].map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Account Number *</Label>
              <Input value={nostroForm.accountNumber} onChange={(e) => setNostroForm(f => ({ ...f, accountNumber: e.target.value }))} />
            </div>
            <div>
              <Label>Opening Balance</Label>
              <Input type="number" value={nostroForm.balance} onChange={(e) => setNostroForm(f => ({ ...f, balance: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddNostro(null)}>Cancel</Button>
            <Button
              onClick={() => showAddNostro !== null && addNostroMutation.mutate({
                correspondentBankId: showAddNostro,
                currency: nostroForm.currency,
                accountNumber: nostroForm.accountNumber,
                balance: parseFloat(nostroForm.balance) || 0,
              })}
              disabled={addNostroMutation.isPending || !nostroForm.accountNumber}
            >
              {addNostroMutation.isPending ? "Adding..." : "Add Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bank Detail Dialog */}
      {selectedBank && (
        <Dialog open={true} onOpenChange={() => setSelectedBank(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{selectedBank.bankName}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">BIC:</span> <span className="font-mono">{selectedBank.bic}</span></div>
                <div><span className="text-muted-foreground">Country:</span> <span>{selectedBank.country}</span></div>
                <div>
                  <span className="text-muted-foreground">Risk:</span>{" "}
                  <Badge className={`text-xs ${RISK_COLORS[selectedBank.riskRating ?? "medium"]}`}>{selectedBank.riskRating}</Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <Badge className={`text-xs ${STATUS_COLORS[selectedBank.status ?? "active"]}`}>{selectedBank.status}</Badge>
                </div>
                <div><span className="text-muted-foreground">City:</span> <span>{selectedBank.city ?? "—"}</span></div>
                <div><span className="text-muted-foreground">Next Review:</span> <span>{selectedBank.nextReviewDate ? new Date(selectedBank.nextReviewDate).toLocaleDateString() : "—"}</span></div>
                {selectedBank.notes && (
                  <div className="col-span-2"><span className="text-muted-foreground">Notes:</span> <span>{selectedBank.notes}</span></div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </BISLayout>
  );
}
