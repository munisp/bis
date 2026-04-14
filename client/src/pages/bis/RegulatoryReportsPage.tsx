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
  FileBarChart, Plus, Search, Eye, ChevronLeft, ChevronRight,
  RefreshCw, AlertTriangle, CheckCircle, Clock, Send
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-500/20 text-gray-400",
  generated: "bg-blue-500/20 text-blue-400",
  reviewed: "bg-yellow-500/20 text-yellow-400",
  submitted: "bg-cyan-500/20 text-cyan-400",
  acknowledged: "bg-green-500/20 text-green-400",
  rejected: "bg-red-500/20 text-red-400",
};

const REPORT_TYPES = [
  "CTR", "STR", "goAML_XML", "NFIU_monthly", "CBN_quarterly",
  "FATF_travel_rule", "PEP_disclosure", "sanctions_screening", "annual_AML_report"
];

export default function RegulatoryReportsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedReport, setSelectedReport] = useState<any>(null);

  const limit = 20;
  const utils = trpc.useUtils();

  const { data: reportData, isLoading } = trpc.regulatoryReports.list.useQuery({
    limit,
    offset: page * limit,
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    type: typeFilter !== "all" ? typeFilter : undefined,
  });

  const { data: stats } = trpc.regulatoryReports.stats.useQuery();

  const [form, setForm] = useState({
    type: "CTR" as any,
    title: "",
    regulatorName: "NFIU",
    periodStart: "",
    periodEnd: "",
    submissionDeadline: "",
  });

  const createMutation = trpc.regulatoryReports.create.useMutation({
    onSuccess: () => {
      toast.success("Regulatory report created");
      utils.regulatoryReports.list.invalidate();
      utils.regulatoryReports.stats.invalidate();
      setShowCreate(false);
      setForm({ type: "CTR", title: "", regulatorName: "NFIU", periodStart: "", periodEnd: "", submissionDeadline: "" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const transitionMutation = trpc.regulatoryReports.transition.useMutation({
    onSuccess: () => {
      toast.success("Report status updated");
      utils.regulatoryReports.list.invalidate();
      utils.regulatoryReports.stats.invalidate();
      setSelectedReport(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = trpc.regulatoryReports.delete.useMutation({
    onSuccess: () => {
      toast.success("Report deleted");
      utils.regulatoryReports.list.invalidate();
      utils.regulatoryReports.stats.invalidate();
      setSelectedReport(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const totalPages = Math.ceil((reportData?.total ?? 0) / limit);

  const NEXT_STATUS: Record<string, string> = {
    draft: "generated",
    generated: "reviewed",
    reviewed: "submitted",
  };

  return (
    <BISLayout title="Regulatory Reports" subtitle="CTR, STR, goAML XML, NFIU, CBN, FATF — full regulatory submission lifecycle">
      <div className="space-y-6">
        <div className="flex justify-end">
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            New Report
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: "Total", value: stats?.total ?? 0, icon: FileBarChart, color: "text-blue-400" },
            { label: "Draft", value: stats?.draft ?? 0, icon: Clock, color: "text-gray-400" },
            { label: "Submitted", value: stats?.submitted ?? 0, icon: Send, color: "text-cyan-400" },
            { label: "Acknowledged", value: stats?.acknowledged ?? 0, icon: CheckCircle, color: "text-green-400" },
            { label: "Overdue", value: stats?.overdue ?? 0, icon: AlertTriangle, color: "text-red-400" },
          ].map((s) => (
            <Card key={s.label} className="bg-card border-border">
              <CardContent className="p-4 flex items-center gap-3">
                <s.icon className={`w-7 h-7 ${s.color}`} />
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
              placeholder="Search by ref, title, regulator..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="pl-9"
            />
          </div>
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Report Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {REPORT_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {Object.keys(STATUS_COLORS).map(k => (
                <SelectItem key={k} value={k}>{k}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => utils.regulatoryReports.list.invalidate()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {/* Table */}
        <Card className="bg-card border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left p-3 font-medium">Ref</th>
                  <th className="text-left p-3 font-medium">Title</th>
                  <th className="text-left p-3 font-medium">Type</th>
                  <th className="text-left p-3 font-medium">Regulator</th>
                  <th className="text-center p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium">Deadline</th>
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
                ) : reportData?.items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      <FileBarChart className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      No regulatory reports found
                    </td>
                  </tr>
                ) : reportData?.items.map((report: any) => {
                  const isOverdue = report.submissionDeadline && new Date(report.submissionDeadline) < new Date() && !["submitted", "acknowledged"].includes(report.status);
                  return (
                    <tr key={report.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="p-3 font-mono text-xs text-blue-400">{report.reportRef}</td>
                      <td className="p-3 font-medium text-xs max-w-[200px] truncate">{report.title}</td>
                      <td className="p-3 text-xs font-mono">{report.type?.replace(/_/g, " ")}</td>
                      <td className="p-3 text-xs">{report.regulatorName}</td>
                      <td className="p-3 text-center">
                        <Badge className={`text-xs ${STATUS_COLORS[report.status] ?? ""}`}>{report.status}</Badge>
                      </td>
                      <td className={`p-3 text-xs ${isOverdue ? "text-red-400 font-medium" : "text-muted-foreground"}`}>
                        {report.submissionDeadline ? new Date(report.submissionDeadline).toLocaleDateString() : "—"}
                        {isOverdue && " ⚠"}
                      </td>
                      <td className="p-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedReport(report)}>
                          <Eye className="w-3 h-3" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-3 border-t border-border">
              <span className="text-sm text-muted-foreground">{reportData?.total} reports</span>
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

      {/* Create Report Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>New Regulatory Report</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div>
              <Label>Report Type *</Label>
              <Select value={form.type} onValueChange={(v) => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Regulator</Label>
              <Select value={form.regulatorName} onValueChange={(v) => setForm(f => ({ ...f, regulatorName: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["NFIU", "CBN", "SEC", "FATF", "GIABA", "ESAAMLG", "GABAC"].map(r => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Q3 2025 Currency Transaction Report" />
            </div>
            <div>
              <Label>Period Start</Label>
              <Input type="date" value={form.periodStart} onChange={(e) => setForm(f => ({ ...f, periodStart: e.target.value }))} />
            </div>
            <div>
              <Label>Period End</Label>
              <Input type="date" value={form.periodEnd} onChange={(e) => setForm(f => ({ ...f, periodEnd: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>Submission Deadline</Label>
              <Input type="date" value={form.submissionDeadline} onChange={(e) => setForm(f => ({ ...f, submissionDeadline: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({
                type: form.type,
                title: form.title,
                regulatorName: form.regulatorName,
                periodStart: form.periodStart || undefined,
                periodEnd: form.periodEnd || undefined,
                submissionDeadline: form.submissionDeadline || undefined,
              })}
              disabled={createMutation.isPending || !form.title}
            >
              {createMutation.isPending ? "Creating..." : "Create Report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Report Detail Dialog */}
      {selectedReport && (
        <Dialog open={true} onOpenChange={() => setSelectedReport(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{selectedReport.reportRef}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Title:</span> <span className="font-medium">{selectedReport.title}</span></div>
                <div><span className="text-muted-foreground">Type:</span> <span className="font-mono">{selectedReport.type?.replace(/_/g, " ")}</span></div>
                <div><span className="text-muted-foreground">Regulator:</span> <span>{selectedReport.regulatorName}</span></div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <Badge className={`text-xs ${STATUS_COLORS[selectedReport.status] ?? ""}`}>{selectedReport.status}</Badge>
                </div>
                <div><span className="text-muted-foreground">Deadline:</span> <span>{selectedReport.submissionDeadline ? new Date(selectedReport.submissionDeadline).toLocaleDateString() : "—"}</span></div>
                {selectedReport.submittedAt && (
                  <div><span className="text-muted-foreground">Submitted:</span> <span>{new Date(selectedReport.submittedAt).toLocaleDateString()}</span></div>
                )}
                {selectedReport.acknowledgementRef && (
                  <div className="col-span-2"><span className="text-muted-foreground">Ack Ref:</span> <span className="font-mono">{selectedReport.acknowledgementRef}</span></div>
                )}
                {selectedReport.rejectionReason && (
                  <div className="col-span-2 text-red-400"><span className="text-muted-foreground">Rejection:</span> <span>{selectedReport.rejectionReason}</span></div>
                )}
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                {NEXT_STATUS[selectedReport.status] && (
                  <Button size="sm" onClick={() => transitionMutation.mutate({ id: selectedReport.id, status: NEXT_STATUS[selectedReport.status] as any })} disabled={transitionMutation.isPending}>
                    Advance to: {NEXT_STATUS[selectedReport.status]}
                  </Button>
                )}
                {selectedReport.status === "draft" && (
                  <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate({ id: selectedReport.id })} disabled={deleteMutation.isPending}>
                    Delete Draft
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </BISLayout>
  );
}
