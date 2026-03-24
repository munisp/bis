/**
 * KYC Records Dashboard
 * =====================
 * Lists all KYC records with pass/fail/review/pending filter chips,
 * cursor-based pagination (Load More), CSV export, and a re-verify
 * action for flagged records.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Search, RefreshCw, Download, CheckCircle2, XCircle, Clock,
  AlertTriangle, Loader2, ShieldCheck, RotateCcw, Eye, ChevronDown
} from "lucide-react";

type KYCStatus = "pending" | "processing" | "passed" | "failed" | "review";

const STATUS_CONFIG: Record<KYCStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending:    { label: "Pending",    color: "bg-muted text-muted-foreground",                                                   icon: <Clock className="w-3 h-3" /> },
  processing: { label: "Processing", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",                icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  passed:     { label: "Passed",     color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",            icon: <CheckCircle2 className="w-3 h-3" /> },
  failed:     { label: "Failed",     color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",                    icon: <XCircle className="w-3 h-3" /> },
  review:     { label: "Review",     color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",        icon: <AlertTriangle className="w-3 h-3" /> },
};

function StatusChip({ status, active, count, onClick }: {
  status: KYCStatus | "all"; active: boolean; count: number; onClick: () => void;
}) {
  const cfg = status === "all" ? { label: "All", color: "" } : STATUS_CONFIG[status];
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all
        ${active
          ? "bg-primary text-primary-foreground border-primary shadow-sm"
          : "bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
        }`}
    >
      {status !== "all" && STATUS_CONFIG[status as KYCStatus].icon}
      {cfg.label} <span className="opacity-70">({count})</span>
    </button>
  );
}

type KYCRecord = {
  id: number;
  subjectName: string;
  status: KYCStatus;
  riskScore?: number | null;
  nin?: string | null;
  bvn?: string | null;
  dob?: string | null;
  phone?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function riskColor(score?: number | null) {
  if (score == null) return "text-muted-foreground";
  if (score >= 80) return "text-red-500 font-semibold";
  if (score >= 60) return "text-yellow-500 font-semibold";
  return "text-green-500 font-semibold";
}

const PAGE_SIZE = 50;

export default function KYCRecordsPage() {
  const [statusFilter, setStatusFilter] = useState<KYCStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<KYCRecord | null>(null);
  const [reVerifying, setReVerifying] = useState<number | null>(null);

  // Cursor pagination state
  const [pages, setPages] = useState<KYCRecord[][]>([]);
  const [nextCursor, setNextCursor] = useState<number | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);

  // Initial load
  const { data: firstPage, isLoading, refetch: refetchFirst } = trpc.kyc.list.useQuery(
    { limit: PAGE_SIZE },
  );

  // Sync first page into local state
  useEffect(() => {
    if (!firstPage) return;
    setPages([firstPage.items as KYCRecord[]]);
    setNextCursor(firstPage.nextCursor ?? undefined);
    setHasMore(firstPage.nextCursor !== null);
    setTotal(firstPage.total);
  }, [firstPage]);

  const utils = trpc.useUtils();

  const handleRefresh = useCallback(() => {
    setPages([]);
    setNextCursor(undefined);
    setHasMore(true);
    refetchFirst();
  }, [refetchFirst]);

  // Load more via imperative query
  const handleLoadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await utils.kyc.list.fetch({ limit: PAGE_SIZE, cursor: nextCursor });
      setPages(prev => [...prev, result.items as KYCRecord[]]);
      setNextCursor(result.nextCursor ?? undefined);
      setHasMore(result.nextCursor !== null);
      setTotal(result.total);
    } catch (e) {
      toast.error("Failed to load more records");
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, utils]);

  const verifyMutation = trpc.kyc.verify.useMutation({
    onSuccess: (result, vars) => {
      toast.success(`Re-verification complete — ${vars.subjectName}: ${result.status} (score ${result.riskScore})`);
      setReVerifying(null);
      handleRefresh();
    },
    onError: (e) => {
      toast.error(`Re-verification failed: ${e.message}`);
      setReVerifying(null);
    },
  });

  const handleReVerify = (record: KYCRecord) => {
    setReVerifying(record.id);
    verifyMutation.mutate({
      subjectName: record.subjectName,
      nin: record.nin ?? undefined,
      bvn: record.bvn ?? undefined,
      dob: record.dob ?? undefined,
      phone: record.phone ?? undefined,
    });
  };

  // Flatten all loaded pages
  const allLoaded = useMemo(() => pages.flat(), [pages]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: total };
    allLoaded.forEach(r => { c[r.status] = (c[r.status] ?? 0) + 1; });
    return c;
  }, [allLoaded, total]);

  const filtered = useMemo(() => {
    return allLoaded.filter(r => {
      const matchStatus = statusFilter === "all" || r.status === statusFilter;
      const q = search.toLowerCase();
      const matchSearch = !q ||
        r.subjectName.toLowerCase().includes(q) ||
        (r.nin ?? "").includes(q) ||
        (r.bvn ?? "").includes(q);
      return matchStatus && matchSearch;
    });
  }, [allLoaded, statusFilter, search]);

  const handleExportCSV = () => {
    const headers = ["ID", "Subject Name", "Status", "Risk Score", "NIN", "BVN", "DOB", "Phone", "Created At"];
    const rows = filtered.map(r => [
      r.id,
      `"${r.subjectName}"`,
      r.status,
      r.riskScore ?? "",
      r.nin ?? "",
      r.bvn ?? "",
      r.dob ?? "",
      r.phone ?? "",
      new Date(r.createdAt).toISOString(),
    ]);
    const csv = [headers.join(","), ...rows.map(row => row.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kyc-records-${statusFilter}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} records to CSV`);
  };

  return (
    <BISLayout title="KYC Records" subtitle="Batch status dashboard for all KYC verifications">
      {/* ── Toolbar ── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name, NIN, BVN…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={filtered.length === 0}>
            <Download className="w-4 h-4 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

      {/* ── Status Filter Chips ── */}
      <div className="flex flex-wrap gap-2 mb-5">
        <StatusChip status="all" active={statusFilter === "all"} count={total} onClick={() => setStatusFilter("all")} />
        {(["passed", "review", "failed", "pending", "processing"] as KYCStatus[]).map(s => (
          <StatusChip key={s} status={s} active={statusFilter === s} count={counts[s] ?? 0} onClick={() => setStatusFilter(s)} />
        ))}
      </div>

      {/* ── Summary Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {(["passed", "review", "failed", "pending", "processing"] as KYCStatus[]).map(s => (
          <div key={s} className="bg-card border border-border rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-foreground">{counts[s] ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{STATUS_CONFIG[s].label}</div>
          </div>
        ))}
      </div>

      {/* ── Table ── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {isLoading && pages.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading KYC records…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
            <ShieldCheck className="w-8 h-8 opacity-40" />
            <p className="text-sm">No records match the current filter</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Subject</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Risk Score</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">NIN / BVN</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((record, i) => (
                    <tr
                      key={record.id}
                      className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{record.subjectName}</div>
                        {record.phone && <div className="text-xs text-muted-foreground">{record.phone}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CONFIG[record.status]?.color ?? ""}`}>
                          {STATUS_CONFIG[record.status]?.icon}
                          {STATUS_CONFIG[record.status]?.label ?? record.status}
                        </span>
                      </td>
                      <td className={`px-4 py-3 font-mono text-sm ${riskColor(record.riskScore)}`}>
                        {record.riskScore != null ? record.riskScore : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                        {record.nin ? <div>NIN: {record.nin}</div> : null}
                        {record.bvn ? <div>BVN: {record.bvn}</div> : null}
                        {!record.nin && !record.bvn && "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(record.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelected(record)}>
                            <Eye className="w-3 h-3 mr-1" /> View
                          </Button>
                          {(record.status === "review" || record.status === "failed") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-amber-600 hover:text-amber-700"
                              disabled={reVerifying === record.id}
                              onClick={() => handleReVerify(record)}
                            >
                              {reVerifying === record.id
                                ? <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                : <RotateCcw className="w-3 h-3 mr-1" />}
                              Re-verify
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Footer: count + Load More ── */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/50 bg-muted/10">
              <span className="text-xs text-muted-foreground">
                Showing {filtered.length} of {total} total records
                {statusFilter !== "all" && ` · filtered by "${STATUS_CONFIG[statusFilter]?.label}"`}
                {allLoaded.length < total && ` · ${allLoaded.length} loaded`}
              </span>
              {hasMore && !search && statusFilter === "all" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore
                    ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Loading…</>
                    : <><ChevronDown className="w-3 h-3 mr-1" /> Load more ({total - allLoaded.length} remaining)</>}
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Record Detail Dialog ── */}
      <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}>
        <DialogContent className="max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                  {selected.subjectName}
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CONFIG[selected.status]?.color ?? ""}`}>
                    {STATUS_CONFIG[selected.status]?.icon}
                    {STATUS_CONFIG[selected.status]?.label}
                  </span>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3 mt-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="text-muted-foreground">Record ID:</span> <span className="font-mono">#{selected.id}</span></div>
                  <div><span className="text-muted-foreground">Risk Score:</span> <span className={riskColor(selected.riskScore)}>{selected.riskScore ?? "—"}</span></div>
                  <div><span className="text-muted-foreground">NIN:</span> {selected.nin ?? "—"}</div>
                  <div><span className="text-muted-foreground">BVN:</span> {selected.bvn ?? "—"}</div>
                  <div><span className="text-muted-foreground">DOB:</span> {selected.dob ?? "—"}</div>
                  <div><span className="text-muted-foreground">Phone:</span> {selected.phone ?? "—"}</div>
                  <div><span className="text-muted-foreground">Created:</span> {new Date(selected.createdAt).toLocaleString()}</div>
                  <div><span className="text-muted-foreground">Updated:</span> {new Date(selected.updatedAt).toLocaleString()}</div>
                </div>
              </div>

              <DialogFooter className="mt-4 gap-2">
                {(selected.status === "review" || selected.status === "failed") && (
                  <Button
                    variant="outline"
                    className="text-amber-600 border-amber-200 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                    disabled={reVerifying === selected.id}
                    onClick={() => { handleReVerify(selected); setSelected(null); }}
                  >
                    {reVerifying === selected.id
                      ? <Loader2 className="w-4 h-4 animate-spin mr-1" />
                      : <RotateCcw className="w-4 h-4 mr-1" />}
                    Re-verify Now
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </BISLayout>
  );
}
