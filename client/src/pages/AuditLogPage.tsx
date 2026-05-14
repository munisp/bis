// AuditLogPage — live tRPC-backed audit trail
// Design: Forensic Intelligence theme, semantic CSS variables

import { useState, useMemo, useEffect } from "react";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Search, Download, Filter, Shield, FileText, Bell,
  UserCheck, Bookmark, LogIn, Settings, Eye,
  AlertTriangle, ChevronDown, ChevronUp, RefreshCw, Loader2
} from "lucide-react";
import { trpc } from "@/lib/trpc";

// ─── Config ────────────────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  investigation: { label: "Investigation", icon: <Eye size={11} />, color: "text-blue-400" },
  kyc:           { label: "KYC",           icon: <UserCheck size={11} />, color: "text-violet-400" },
  alert:         { label: "Alert",         icon: <Bell size={11} />, color: "text-amber-400" },
  report:        { label: "Report",        icon: <FileText size={11} />, color: "text-cyan-400" },
  user:          { label: "User",          icon: <Shield size={11} />, color: "text-emerald-400" },
  system:        { label: "System",        icon: <Settings size={11} />, color: "text-muted-foreground" },
  api:           { label: "API",           icon: <Bookmark size={11} />, color: "text-orange-400" },
};

const RESULT_CONFIG: Record<string, { label: string; color: string }> = {
  success: { label: "Success", color: "text-emerald-400" },
  warning: { label: "Warning", color: "text-amber-400" },
  failure: { label: "Failure", color: "text-red-400" },
};

function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuditLogPage() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [userIdFilter, setUserIdFilter] = useState<number | undefined>(undefined);
  const PAGE_SIZE = 50;

  // Read ?userId=X from URL and pre-filter on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const uid = params.get("userId");
    if (uid && !isNaN(Number(uid))) {
      setUserIdFilter(Number(uid));
    }
  }, []);

  const utils = trpc.useUtils();

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const verifyIntegrityMutation = trpc.audit.verifyIntegrity.useMutation({
    onSuccess: (result) => {
      if (result.tamperedCount === 0) {
        toast.success(`Integrity verified — ${result.checkedCount} entries checked, all valid`);
      } else {
        toast.error(`Integrity check failed — ${result.tamperedCount}/${result.checkedCount} entries tampered!`);
      }
      setSelectedIds([]);
    },
    onError: (e) => toast.error(`Integrity check failed: ${e.message}`),
  });

  const exportMutation = trpc.audit.export.useMutation({
    onSuccess: (data) => {
      toast.success(`Exported ${data.count} entries`, {
        description: "Click to download",
        action: { label: "Download", onClick: () => window.open(data.url, "_blank") },
      });
    },
    onError: (err) => toast.error(`Export failed: ${err.message}`),
  });

  const handleServerExport = (format: "csv" | "json") => {
    exportMutation.mutate({
      format,
      category: categoryFilter !== "all" ? categoryFilter : undefined,
      limit: 10000,
    });
  };

  const { data, isLoading, refetch } = trpc.audit.list.useQuery({
    category: categoryFilter !== "all" ? categoryFilter : undefined,
    result: resultFilter !== "all" ? resultFilter : undefined,
    userId: userIdFilter,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter((e: any) =>
      (e.action ?? "").toLowerCase().includes(q) ||
      (e.targetRef ?? "").toLowerCase().includes(q) ||
      (e.category ?? "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const handleExportCSV = () => {
    if (filtered.length === 0) { toast.error("No entries to export."); return; }
    const headers = ["ID", "Timestamp", "Category", "Action", "Target Ref", "Result", "Detail"];
    const rows = filtered.map((e: any) => [
      e.id,
      formatDateTime(e.createdAt),
      e.category,
      e.action,
      e.targetRef ?? "",
      e.result,
      e.detail ?? "",
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bis-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} entries.`);
  };

  // Stats from current page
  const stats = useMemo(() => ({
    total: items.length,
    success: items.filter((e: any) => e.result === "success").length,
    warning: items.filter((e: any) => e.result === "warning").length,
    failure: items.filter((e: any) => e.result === "failure").length,
  }), [items]);

  return (
    <BISLayout
      title="Audit Log"
      subtitle={`${total.toLocaleString()} total events`}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => refetch()}>
            <RefreshCw size={11} className={isLoading ? "animate-spin" : ""} /> Refresh
          </Button>
          {selectedIds.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
              onClick={() => verifyIntegrityMutation.mutate({ ids: selectedIds })}
              disabled={verifyIntegrityMutation.isPending}
            >
              {verifyIntegrityMutation.isPending ? <RefreshCw size={11} className="animate-spin" /> : <Shield size={11} />}
              Verify {selectedIds.length} Selected
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => handleServerExport("csv")} disabled={exportMutation.isPending}>
            <Download size={11} /> {exportMutation.isPending ? "Exporting..." : "Export CSV"}
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => handleServerExport("json")} disabled={exportMutation.isPending}>
            <Download size={11} /> JSON
          </Button>
        </div>
      }
    >
      {/* ── Stats row ── */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: "Total", value: stats.total, color: "text-foreground" },
          { label: "Success", value: stats.success, color: "text-emerald-400" },
          { label: "Warning", value: stats.warning, color: "text-amber-400" },
          { label: "Failure", value: stats.failure, color: "text-red-400" },
        ].map(s => (
          <div key={s.label} className="bis-card p-3">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">{s.label}</p>
            <p className={cn("text-xl font-mono font-bold mt-1", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Search action or reference…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
          />
        </div>
        <Select value={categoryFilter} onValueChange={v => { setCategoryFilter(v); setPage(0); }}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <Filter size={11} className="mr-1 shrink-0" /><SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {Object.entries(CATEGORY_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={resultFilter} onValueChange={v => { setResultFilter(v); setPage(0); }}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue placeholder="Result" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Results</SelectItem>
            {Object.entries(RESULT_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 size={20} className="animate-spin mr-2" /> Loading audit log…
        </div>
      )}

      {/* ── Timeline table ── */}
      {!isLoading && (
        <div className="bis-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 w-8">
                    <input type="checkbox" className="w-3 h-3 accent-primary" checked={selectedIds.length === filtered.length && filtered.length > 0} onChange={e => setSelectedIds(e.target.checked ? filtered.map((r: any) => r.id) : [])} />
                  </th>
                  {["Timestamp", "Category", "Action", "Target Ref", "Result", ""].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((e: any) => {
                  const cat = CATEGORY_CONFIG[e.category] ?? { label: e.category, icon: <Eye size={11} />, color: "text-muted-foreground" };
                  const res = RESULT_CONFIG[e.result] ?? { label: e.result, color: "text-muted-foreground" };
                  const isExpanded = expandedId === e.id;
                  return (
                    <>
                      <tr
                        key={e.id}
                        className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
                        onClick={() => setExpandedId(isExpanded ? null : e.id)}
                      >
                        <td className="px-4 py-3" onClick={ev => ev.stopPropagation()}>
                          <input type="checkbox" className="w-3 h-3 accent-primary" checked={selectedIds.includes(e.id)} onChange={ev => setSelectedIds(prev => ev.target.checked ? [...prev, e.id] : prev.filter(id => id !== e.id))} />
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-mono text-muted-foreground">{formatDateTime(e.createdAt)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn("flex items-center gap-1 text-[10px] font-mono font-semibold", cat.color)}>
                            {cat.icon} {cat.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-mono text-foreground">{e.action}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[10px] font-mono text-primary">{e.targetRef ?? "—"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn("text-[10px] font-mono font-semibold", res.color)}>{res.label}</span>
                        </td>
                        <td className="px-4 py-3">
                          {isExpanded ? <ChevronUp size={13} className="text-muted-foreground" /> : <ChevronDown size={13} className="text-muted-foreground" />}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${e.id}-detail`} className="border-b border-border/50 bg-muted/10">
                          <td colSpan={7} className="px-6 py-3">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[10px] font-mono">
                              <div>
                                <p className="text-muted-foreground uppercase tracking-wider mb-0.5">Event ID</p>
                                <p className="text-foreground">{e.id}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground uppercase tracking-wider mb-0.5">User ID</p>
                                <p className="text-foreground">{e.userId ?? "—"}</p>
                              </div>
                              {e.detail && (
                                <div className="col-span-2">
                                  <p className="text-muted-foreground uppercase tracking-wider mb-0.5">Detail</p>
                                  <p className="text-foreground">{String(e.detail)}</p>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground text-sm">
                      No audit entries match your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-4 py-2.5 border-t border-border/50 flex items-center justify-between">
            <span className="text-[10px] font-mono text-muted-foreground">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-6 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" className="h-6 text-xs" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </BISLayout>
  );
}
