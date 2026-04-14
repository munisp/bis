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
import { Textarea } from "@/components/ui/textarea";
import {
  FileText, Plus, Search, Eye, ChevronLeft, ChevronRight,
  RefreshCw, Send, CheckCircle
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-500/20 text-gray-400",
  under_review: "bg-yellow-500/20 text-yellow-400",
  approved: "bg-blue-500/20 text-blue-400",
  filed: "bg-green-500/20 text-green-400",
  rejected: "bg-red-500/20 text-red-400",
  withdrawn: "bg-gray-500/20 text-gray-400",
  acknowledged: "bg-teal-500/20 text-teal-400",
};

const CATEGORY_LABELS: Record<string, string> = {
  money_laundering: "Money Laundering",
  terrorist_financing: "Terrorist Financing",
  fraud: "Fraud",
  corruption: "Corruption",
  drug_trafficking: "Drug Trafficking",
  human_trafficking: "Human Trafficking",
  tax_evasion: "Tax Evasion",
  sanctions_evasion: "Sanctions Evasion",
  cybercrime: "Cybercrime",
  other: "Other",
};

export default function SARFilingPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedSar, setSelectedSar] = useState<any>(null);

  const limit = 20;
  const utils = trpc.useUtils();

  const { data: sarData, isLoading } = trpc.sar.list.useQuery({
    limit,
    offset: page * limit,
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  const { data: stats } = trpc.sar.stats.useQuery();

  const [form, setForm] = useState({
    category: "money_laundering" as any,
    title: "",
    subjectName: "",
    subjectNin: "",
    subjectBvn: "",
    suspiciousAmount: "",
    suspiciousCurrency: "NGN",
    activityStartDate: "",
    activityEndDate: "",
    narrative: "",
  });

  const createMutation = trpc.sar.create.useMutation({
    onSuccess: () => {
      toast.success("SAR created — saved as draft");
      utils.sar.list.invalidate();
      utils.sar.stats.invalidate();
      setShowCreate(false);
      setForm({ category: "money_laundering", title: "", subjectName: "", subjectNin: "", subjectBvn: "", suspiciousAmount: "", suspiciousCurrency: "NGN", activityStartDate: "", activityEndDate: "", narrative: "" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const submitMutation = trpc.sar.submitForReview.useMutation({
    onSuccess: () => { toast.success("SAR submitted for review"); utils.sar.list.invalidate(); setSelectedSar(null); },
    onError: (e: any) => toast.error(e.message),
  });

  const approveMutation = trpc.sar.approve.useMutation({
    onSuccess: () => { toast.success("SAR approved"); utils.sar.list.invalidate(); setSelectedSar(null); },
    onError: (e: any) => toast.error(e.message),
  });

  const rejectMutation = trpc.sar.reject.useMutation({
    onSuccess: () => { toast.success("SAR rejected"); utils.sar.list.invalidate(); setSelectedSar(null); },
    onError: (e: any) => toast.error(e.message),
  });

  const fileMutation = trpc.sar.file.useMutation({
    onSuccess: () => { toast.success("SAR filed with NFIU"); utils.sar.list.invalidate(); utils.sar.stats.invalidate(); setSelectedSar(null); },
    onError: (e: any) => toast.error(e.message),
  });

  const totalPages = Math.ceil((sarData?.total ?? 0) / limit);

  return (
    <BISLayout title="Suspicious Activity Reports" subtitle="SAR lifecycle — draft, review, approve, and file with NFIU">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div />
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            New SAR
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total SARs", value: stats?.total ?? 0, color: "text-blue-400" },
            { label: "Drafts", value: stats?.draft ?? 0, color: "text-gray-400" },
            { label: "Under Review", value: stats?.underReview ?? 0, color: "text-yellow-400" },
            { label: "Filed with NFIU", value: stats?.filed ?? 0, color: "text-green-400" },
          ].map((s) => (
            <Card key={s.label} className="bg-card border-border">
              <CardContent className="p-4">
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by ref, subject name..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="under_review">Under Review</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="filed">Filed</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => utils.sar.list.invalidate()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {/* Table */}
        <Card className="bg-card border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left p-3 font-medium">SAR Ref</th>
                  <th className="text-left p-3 font-medium">Subject</th>
                  <th className="text-left p-3 font-medium">Category</th>
                  <th className="text-right p-3 font-medium">Amount</th>
                  <th className="text-center p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium">Created</th>
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
                ) : sarData?.items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      No SARs found
                    </td>
                  </tr>
                ) : sarData?.items.map((sar: any) => (
                  <tr key={sar.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="p-3 font-mono text-xs text-blue-400">{sar.sarRef}</td>
                    <td className="p-3">
                      <div className="font-medium text-xs">{sar.subjectName}</div>
                    </td>
                    <td className="p-3 text-xs">{CATEGORY_LABELS[sar.category] ?? sar.category}</td>
                    <td className="p-3 text-right font-mono text-xs">
                      {sar.suspiciousAmount ? `${sar.suspiciousCurrency} ${Number(sar.suspiciousAmount).toLocaleString()}` : "—"}
                    </td>
                    <td className="p-3 text-center">
                      <Badge className={`text-xs ${STATUS_COLORS[sar.status] ?? ""}`}>
                        {sar.status?.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {new Date(sar.createdAt).toLocaleDateString()}
                    </td>
                    <td className="p-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setSelectedSar(sar)}>
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
              <span className="text-sm text-muted-foreground">{sarData?.total} SARs</span>
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

      {/* Create SAR Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Suspicious Activity Report</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div>
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={form.suspiciousCurrency} onValueChange={(v) => setForm(f => ({ ...f, suspiciousCurrency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["NGN", "USD", "EUR", "GBP"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Brief title for this SAR..." />
            </div>
            <div className="col-span-2">
              <Label>Subject Name *</Label>
              <Input value={form.subjectName} onChange={(e) => setForm(f => ({ ...f, subjectName: e.target.value }))} />
            </div>
            <div>
              <Label>NIN / RC Number</Label>
              <Input value={form.subjectNin} onChange={(e) => setForm(f => ({ ...f, subjectNin: e.target.value }))} />
            </div>
            <div>
              <Label>BVN</Label>
              <Input value={form.subjectBvn} onChange={(e) => setForm(f => ({ ...f, subjectBvn: e.target.value }))} />
            </div>
            <div>
              <Label>Suspicious Amount</Label>
              <Input type="number" value={form.suspiciousAmount} onChange={(e) => setForm(f => ({ ...f, suspiciousAmount: e.target.value }))} />
            </div>
            <div />
            <div>
              <Label>Activity Start</Label>
              <Input type="date" value={form.activityStartDate} onChange={(e) => setForm(f => ({ ...f, activityStartDate: e.target.value }))} />
            </div>
            <div>
              <Label>Activity End</Label>
              <Input type="date" value={form.activityEndDate} onChange={(e) => setForm(f => ({ ...f, activityEndDate: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>Narrative * (min 20 chars)</Label>
              <Textarea
                value={form.narrative}
                onChange={(e) => setForm(f => ({ ...f, narrative: e.target.value }))}
                rows={4}
                placeholder="Describe the suspicious activity in detail..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({
                category: form.category,
                title: form.title,
                subjectName: form.subjectName,
                subjectNin: form.subjectNin || undefined,
                subjectBvn: form.subjectBvn || undefined,
                suspiciousAmount: form.suspiciousAmount ? parseFloat(form.suspiciousAmount) : undefined,
                suspiciousCurrency: form.suspiciousCurrency,
                activityStartDate: form.activityStartDate || undefined,
                activityEndDate: form.activityEndDate || undefined,
                narrative: form.narrative,
              })}
              disabled={createMutation.isPending || !form.subjectName || !form.narrative || form.narrative.length < 20 || !form.title}
            >
              {createMutation.isPending ? "Saving..." : "Save as Draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SAR Detail / Workflow Dialog */}
      {selectedSar && (
        <Dialog open={true} onOpenChange={() => setSelectedSar(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>SAR {selectedSar.sarRef}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Subject:</span> <span className="font-medium">{selectedSar.subjectName}</span></div>
                <div><span className="text-muted-foreground">Category:</span> <span>{CATEGORY_LABELS[selectedSar.category]}</span></div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <Badge className={`text-xs ${STATUS_COLORS[selectedSar.status] ?? ""}`}>{selectedSar.status?.replace(/_/g, " ")}</Badge>
                </div>
                <div><span className="text-muted-foreground">Amount:</span> <span className="font-mono">{selectedSar.suspiciousCurrency} {Number(selectedSar.suspiciousAmount ?? 0).toLocaleString()}</span></div>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Narrative:</span>
                <p className="text-xs bg-muted/30 rounded p-2 leading-relaxed">{selectedSar.narrative}</p>
              </div>
              {/* Workflow actions */}
              <div className="flex flex-wrap gap-2 pt-2">
                {selectedSar.status === "draft" && (
                  <Button size="sm" onClick={() => submitMutation.mutate({ id: selectedSar.id })} disabled={submitMutation.isPending}>
                    Submit for Review
                  </Button>
                )}
                {selectedSar.status === "under_review" && (
                  <>
                    <Button size="sm" onClick={() => approveMutation.mutate({ id: selectedSar.id })} disabled={approveMutation.isPending}>
                      Approve
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => rejectMutation.mutate({ id: selectedSar.id, notes: "Rejected by reviewer — does not meet SAR threshold" })} disabled={rejectMutation.isPending}>
                      Reject
                    </Button>
                  </>
                )}
                {selectedSar.status === "approved" && (
                  <Button
                    size="sm"
                    className="gap-2"
                    onClick={() => fileMutation.mutate({ id: selectedSar.id, filedWith: "NFIU" })}
                    disabled={fileMutation.isPending}
                  >
                    <Send className="w-3 h-3" />
                    File with NFIU
                  </Button>
                )}
                {selectedSar.status === "filed" && (
                  <div className="flex items-center gap-2 text-green-400">
                    <CheckCircle className="w-4 h-4" />
                    <span className="text-sm">Filed — Ref: {selectedSar.filingReference}</span>
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </BISLayout>
  );
}
