import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Briefcase,
  Plus,
  Search,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Archive,
  FileText,
  Users,
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  open: "bg-blue-100 text-blue-700",
  under_review: "bg-amber-100 text-amber-700",
  pending_decision: "bg-orange-100 text-orange-700",
  closed: "bg-green-100 text-green-700",
  archived: "bg-slate-100 text-slate-500",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

const TYPE_LABELS: Record<string, string> = {
  fraud: "Fraud",
  aml: "AML",
  kyc_failure: "KYC Failure",
  sanctions: "Sanctions",
  corruption: "Corruption",
  cyber: "Cybercrime",
  regulatory: "Regulatory",
  other: "Other",
};

export default function CasesPage() {
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  // Form state
  const [form, setForm] = useState({
    title: "",
    type: "fraud" as const,
    priority: "medium" as const,
    summary: "",
    legalBasis: "",
    jurisdiction: "Nigeria",
    regulatoryFramework: "",
    tags: "",
  });

  const { data, isLoading } = trpc.cases.list.useQuery({
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    type: typeFilter !== "all" ? typeFilter : undefined,
    priority: priorityFilter !== "all" ? priorityFilter : undefined,
    page,
    pageSize: 20,
  });

  const { data: stats } = trpc.cases.stats.useQuery();

  const createCase = trpc.cases.create.useMutation({
    onSuccess: (newCase) => {
      utils.cases.list.invalidate();
      utils.cases.stats.invalidate();
      setCreateOpen(false);
      setForm({ title: "", type: "fraud", priority: "medium", summary: "", legalBasis: "", jurisdiction: "Nigeria", regulatoryFramework: "", tags: "" });
      toast.success(`Case created: ${newCase.ref} — ${newCase.title}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleCreate = () => {
    if (!form.title.trim()) return;
    createCase.mutate({
      title: form.title,
      type: form.type,
      priority: form.priority,
      summary: form.summary || undefined,
      legalBasis: form.legalBasis || undefined,
      jurisdiction: form.jurisdiction || undefined,
      regulatoryFramework: form.regulatoryFramework || undefined,
      tags: form.tags ? form.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      investigationRefs: [],
    });
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Briefcase className="w-6 h-6 text-primary" />
            Case Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Integrated compliance case lifecycle — from draft to closure
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Case
        </Button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total Cases</div>
            </CardContent>
          </Card>
          {stats.statusCounts.slice(0, 3).map((s: any) => (
            <Card key={s.status}>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{s.count}</div>
                <div className="text-xs text-muted-foreground capitalize">{s.status?.replace("_", " ")}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search cases..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {["draft","open","under_review","pending_decision","closed","archived"].map(s => (
              <SelectItem key={s} value={s}>{s.replace("_"," ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={v => { setPriorityFilter(v); setPage(1); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            {["low","medium","high","critical"].map(p => (
              <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Cases list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {(data?.cases ?? []).map((c: any) => (
            <Link key={c.id} href={`/cases/${c.ref}`}>
              <Card className="cursor-pointer hover:border-primary/50 transition-colors">
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-muted-foreground">{c.ref}</span>
                        <Badge className={`text-xs ${STATUS_COLORS[c.status] ?? ""}`}>
                          {c.status?.replace("_", " ")}
                        </Badge>
                        <Badge className={`text-xs ${PRIORITY_COLORS[c.priority] ?? ""}`}>
                          {c.priority}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {TYPE_LABELS[c.type] ?? c.type}
                        </Badge>
                      </div>
                      <p className="font-semibold mt-1 truncate">{c.title}</p>
                      {c.summary && (
                        <p className="text-sm text-muted-foreground truncate mt-0.5">{c.summary}</p>
                      )}
                    </div>
                    <div className="text-right text-xs text-muted-foreground shrink-0">
                      <div>{new Date(c.createdAt).toLocaleDateString()}</div>
                      {c.dueAt && (
                        <div className="text-orange-600">
                          Due {new Date(c.dueAt).toLocaleDateString()}
                        </div>
                      )}
                      {c.riskScore != null && (
                        <div className={`font-semibold mt-1 ${c.riskScore >= 75 ? "text-red-600" : c.riskScore >= 50 ? "text-orange-600" : "text-green-600"}`}>
                          Risk: {c.riskScore}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {(data?.cases ?? []).length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <Briefcase className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No cases found</p>
              <p className="text-sm">Create your first case to get started</p>
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {data && data.total > data.pageSize && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground self-center">
            Page {page} of {Math.ceil(data.total / data.pageSize)}
          </span>
          <Button variant="outline" size="sm" disabled={page >= Math.ceil(data.total / data.pageSize)} onClick={() => setPage(p => p + 1)}>
            Next
          </Button>
        </div>
      )}

      {/* Create Case Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Compliance Case</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Title *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. AML Investigation — Acme Corp" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["low","medium","high","critical"].map(p => (
                      <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Summary</Label>
              <Textarea value={form.summary} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} rows={2} placeholder="Brief description of the case..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Legal Basis</Label>
                <Input value={form.legalBasis} onChange={e => setForm(f => ({ ...f, legalBasis: e.target.value }))} placeholder="e.g. EFCC Act 2004" />
              </div>
              <div>
                <Label>Jurisdiction</Label>
                <Input value={form.jurisdiction} onChange={e => setForm(f => ({ ...f, jurisdiction: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Regulatory Framework</Label>
              <Input value={form.regulatoryFramework} onChange={e => setForm(f => ({ ...f, regulatoryFramework: e.target.value }))} placeholder="e.g. FATF, CBN AML/CFT" />
            </div>
            <div>
              <Label>Tags (comma-separated)</Label>
              <Input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="fraud, shell-company, lagos" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.title.trim() || createCase.isPending}>
              {createCase.isPending ? "Creating..." : "Create Case"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
