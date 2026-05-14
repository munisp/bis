import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import BISLayout from "@/components/BISLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import {
  Search, Download, RefreshCw, ChevronRight, FlaskConical,
  Car, Briefcase, Fingerprint, Eye, Filter, X
} from "lucide-react";

const TYPE_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  drug: { label: "Drug Screen", icon: <FlaskConical className="w-3.5 h-3.5" />, color: "text-purple-400 bg-purple-400/10" },
  mvr: { label: "MVR Check", icon: <Car className="w-3.5 h-3.5" />, color: "text-blue-400 bg-blue-400/10" },
  work_authorization: { label: "Work Auth", icon: <Briefcase className="w-3.5 h-3.5" />, color: "text-amber-400 bg-amber-400/10" },
  biometric: { label: "Biometric", icon: <Fingerprint className="w-3.5 h-3.5" />, color: "text-green-400 bg-green-400/10" },
  zero_footprint: { label: "Zero Footprint", icon: <Eye className="w-3.5 h-3.5" />, color: "text-rose-400 bg-rose-400/10" },
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-400/10 text-yellow-400 border-yellow-400/20",
  processing: "bg-blue-400/10 text-blue-400 border-blue-400/20",
  completed: "bg-green-400/10 text-green-400 border-green-400/20",
  failed: "bg-red-400/10 text-red-400 border-red-400/20",
  review: "bg-orange-400/10 text-orange-400 border-orange-400/20",
};

type ScreeningRecord = {
  id: number;
  requestRef: string;
  type: string;
  subjectName: string;
  subjectType: string;
  status: string;
  priority: string;
  riskScore: number | null;
  resultSummary: string | null;
  result: Record<string, unknown> | null;
  requestData: Record<string, unknown> | null;
  createdAt: Date;
  completedAt: Date | null;
};

export default function ScreeningRecordsPage() {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ScreeningRecord | null>(null);
  const [records, setRecords] = useState<ScreeningRecord[]>([]);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const { data, isLoading, isError, refetch } = trpc.screening.list.useQuery({
    type: typeFilter !== "all" ? typeFilter : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    limit: LIMIT,
    offset,
  });

  useEffect(() => {
    if (data) {
      const rows = (data as any).records ?? (Array.isArray(data) ? data : []);
      if (offset === 0) setRecords(rows as ScreeningRecord[]);
      else setRecords(prev => [...prev, ...(rows as ScreeningRecord[])]);
    }
  }, [data, offset]);

  // Reset pagination when filters change
  useEffect(() => { setOffset(0); setRecords([]); }, [typeFilter, statusFilter]);

  const filtered = records.filter(r =>
    !search || r.subjectName.toLowerCase().includes(search.toLowerCase()) || r.requestRef.toLowerCase().includes(search.toLowerCase())
  );

  // Count by type
  const typeCounts = records.reduce((acc, r) => { acc[r.type] = (acc[r.type] || 0) + 1; return acc; }, {} as Record<string, number>);
  const statusCounts = records.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {} as Record<string, number>);

  function exportCSV() {
    const headers = ["Ref", "Type", "Subject", "Status", "Priority", "Risk Score", "Summary", "Created", "Completed"];
    const rows = filtered.map(r => [
      r.requestRef, r.type, r.subjectName, r.status, r.priority,
      r.riskScore ?? "", r.resultSummary ?? "",
      new Date(r.createdAt).toLocaleDateString(),
      r.completedAt ? new Date(r.completedAt).toLocaleDateString() : "",
    ]);
    const csv = [headers, ...rows].map(row => row.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "screening-records.csv"; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} records to CSV`);
  }

  return (
    <BISLayout>
    <div className="flex flex-col h-full bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-xl font-semibold">Screening Records</h1>
          <p className="text-sm text-muted-foreground mt-0.5">All background screening requests across all types</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setOffset(0); setRecords([]); refetch(); }}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-5 gap-3 px-6 py-4 shrink-0">
        {Object.entries(TYPE_META).map(([type, meta]) => (
          <button
            key={type}
            onClick={() => setTypeFilter(typeFilter === type ? "all" : type)}
            className={`rounded-lg border p-3 text-left transition-all ${typeFilter === type ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}
          >
            <div className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full mb-2 ${meta.color}`}>
              {meta.icon} {meta.label}
            </div>
            <div className="text-2xl font-bold">{typeCounts[type] ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-0.5">requests</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 pb-3 shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search subject or ref..." className="pl-8 h-8 text-sm" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          {["all", "pending", "processing", "completed", "failed", "review"].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${statusFilter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}
            >
              {s === "all" ? `All (${records.length})` : `${s.charAt(0).toUpperCase() + s.slice(1)} (${statusCounts[s] ?? 0})`}
            </button>
          ))}
        </div>
        {(typeFilter !== "all" || statusFilter !== "all" || search) && (
          <button onClick={() => { setTypeFilter("all"); setStatusFilter("all"); setSearch(""); }} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <X className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6">
        {isError ? (
          <div className="flex items-center justify-center h-48 text-destructive gap-2 text-sm">
            <span>Failed to load screening records. <button className="underline" onClick={() => refetch()}>Retry</button></span>
          </div>
        ) : isLoading && records.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Loading screening records...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
            <FlaskConical className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-sm">No screening records found</p>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium">Reference</th>
                  <th className="text-left py-2 pr-4 font-medium">Type</th>
                  <th className="text-left py-2 pr-4 font-medium">Subject</th>
                  <th className="text-left py-2 pr-4 font-medium">Status</th>
                  <th className="text-left py-2 pr-4 font-medium">Priority</th>
                  <th className="text-left py-2 pr-4 font-medium">Risk Score</th>
                  <th className="text-left py-2 pr-4 font-medium">Created</th>
                  <th className="text-left py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const meta = TYPE_META[r.type] ?? { label: r.type, icon: null, color: "text-muted-foreground bg-muted" };
                  return (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 pr-4 font-mono text-xs text-primary">{r.requestRef}</td>
                      <td className="py-2.5 pr-4">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${meta.color}`}>
                          {meta.icon} {meta.label}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 font-medium">{r.subjectName}</td>
                      <td className="py-2.5 pr-4">
                        <Badge variant="outline" className={`text-xs ${STATUS_COLORS[r.status] ?? ""}`}>
                          {r.status}
                        </Badge>
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className={`text-xs font-medium ${r.priority === "critical" ? "text-red-400" : r.priority === "high" ? "text-orange-400" : "text-muted-foreground"}`}>
                          {r.priority}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">
                        {r.riskScore != null ? (
                          <span className={`text-sm font-bold ${r.riskScore >= 70 ? "text-red-400" : r.riskScore >= 40 ? "text-yellow-400" : "text-green-400"}`}>
                            {r.riskScore}
                          </span>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-2.5">
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelected(r)}>
                          View <ChevronRight className="w-3 h-3 ml-1" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* Load more */}
            {data && ((data as any).records ?? (Array.isArray(data) ? data : [])).length === LIMIT && (
              <div className="flex justify-center py-4">
                <Button variant="outline" size="sm" onClick={() => setOffset(o => o + LIMIT)} disabled={isLoading}>
                  {isLoading ? "Loading..." : `Load more`}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Detail drawer */}
      <Sheet open={!!selected} onOpenChange={open => !open && setSelected(null)}>
        <SheetContent side="right" className="w-[520px] sm:max-w-[520px] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader className="mb-4">
                <SheetTitle className="flex items-center gap-2">
                  <span className="font-mono text-primary text-sm">{selected.requestRef}</span>
                  <Badge variant="outline" className={`text-xs ${STATUS_COLORS[selected.status] ?? ""}`}>{selected.status}</Badge>
                </SheetTitle>
              </SheetHeader>
              <div className="space-y-5">
                {/* Summary */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ["Type", TYPE_META[selected.type]?.label ?? selected.type],
                    ["Subject", selected.subjectName],
                    ["Subject Type", selected.subjectType],
                    ["Priority", selected.priority],
                    ["Risk Score", selected.riskScore != null ? String(selected.riskScore) : "—"],
                    ["Created", new Date(selected.createdAt).toLocaleString()],
                    ["Completed", selected.completedAt ? new Date(selected.completedAt).toLocaleString() : "—"],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-muted/30 rounded-lg p-3">
                      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
                      <div className="font-medium text-sm">{value}</div>
                    </div>
                  ))}
                </div>

                {/* Result summary */}
                {selected.resultSummary && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Result Summary</h3>
                    <p className="text-sm bg-muted/30 rounded-lg p-3">{selected.resultSummary}</p>
                  </div>
                )}

                {/* Full result JSON */}
                {selected.result && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Full Result</h3>
                    <pre className="text-xs bg-muted/30 rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap">
                      {JSON.stringify(selected.result, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Request data */}
                {selected.requestData && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Request Data</h3>
                    <pre className="text-xs bg-muted/30 rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap">
                      {JSON.stringify(selected.requestData, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
    </BISLayout>
  );
}
