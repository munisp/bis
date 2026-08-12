/**
 * ReconciliationDashboard — Admin view for failed TigerBeetle transactions
 * =========================================================================
 * Features:
 *   - Summary stats (unreconciled count, total outstanding, oldest age)
 *   - Row-level checkboxes for selective bulk retry with progress bar
 *   - Date filtering and column sorting
 *   - CSV export of filtered transactions
 *   - Detail modal with full JSON payload and error logs
 *   - Individual retry per row
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2, AlertTriangle, CheckCircle2, RefreshCw, Database,
  DollarSign, ArrowUpDown, Eye, PlayCircle, X, Copy, Download,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────
interface RetryQueueItem {
  id: number;
  reference: string;
  tenantId: string;
  amountKobo: number;
  attempts: number;
  nextRetryAt: string;
  status: string;
  lastError: string | null;
  createdAt: string;
  channel?: string;
  verifiedAt?: string;
}

type SortField = "date" | "amount" | "attempts" | "tenant";
type SortDir = "asc" | "desc";

// ── CSV Export ────────────────────────────────────────────────────────────────
function escapeCSV(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function exportToCSV(items: RetryQueueItem[]) {
  const headers = ["Reference", "Tenant", "Amount (NGN)", "Attempts", "Status", "Last Error", "Created", "Next Retry"];
  const rows = items.map((item) => [
    item.reference,
    item.tenantId,
    String(item.amountKobo / 100),
    String(item.attempts),
    item.status,
    item.lastError || "",
    item.createdAt ? new Date(item.createdAt).toISOString() : "",
    item.nextRetryAt ? new Date(item.nextRetryAt).toISOString() : "",
  ]);
  const csv = [headers.join(","), ...rows.map((row) => row.map(escapeCSV).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bis-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`Exported ${items.length} records to CSV`);
}

// ── Detail Modal ──────────────────────────────────────────────────────────────
function DetailModal({ item, onClose }: { item: RetryQueueItem; onClose: () => void }) {
  const jsonPayload = JSON.stringify(item, null, 2);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(jsonPayload);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background border rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="font-semibold text-lg">Transaction Detail</h3>
            <p className="text-xs text-muted-foreground font-mono">{item.reference}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Tenant</span>
              <p className="font-medium">{item.tenantId}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Amount</span>
              <p className="font-medium">₦{(item.amountKobo / 100).toLocaleString()}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Attempts</span>
              <p className="font-medium">{item.attempts} / 7</p>
            </div>
            <div>
              <span className="text-muted-foreground">Status</span>
              <Badge variant={item.status === "dead_letter" ? "destructive" : "outline"}>
                {item.status}
              </Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Created</span>
              <p className="font-medium">{new Date(item.createdAt).toLocaleString()}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Next Retry</span>
              <p className="font-medium">{new Date(item.nextRetryAt).toLocaleString()}</p>
            </div>
          </div>
          {item.lastError && (
            <div>
              <Label className="text-xs text-muted-foreground">Last Error</Label>
              <div className="mt-1 p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-800 font-mono">
                {item.lastError}
              </div>
            </div>
          )}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs text-muted-foreground">Full JSON Payload</Label>
              <Button variant="ghost" size="sm" onClick={copyToClipboard} className="h-6 text-xs">
                <Copy className="h-3 w-3 mr-1" /> Copy
              </Button>
            </div>
            <pre className="p-3 rounded-md bg-muted text-xs font-mono overflow-x-auto max-h-[200px] overflow-y-auto">
              {jsonPayload}
            </pre>
          </div>
        </div>
        <div className="p-4 border-t flex justify-end">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

// ── Progress Bar ──────────────────────────────────────────────────────────────
function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Retrying {current} of {total}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-blue-600 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function ReconciliationDashboard() {
  const [retrying, setRetrying] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);
  const [selectedItem, setSelectedItem] = useState<RetryQueueItem | null>(null);
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());

  const { data, isLoading, refetch } = trpc.admin.reconciliation.listUnreconciled.useQuery(
    { limit: 200 },
    { refetchInterval: 30_000 }
  );

  const retryMutation = trpc.admin.reconciliation.retryCredit.useMutation({
    onSuccess: (result) => {
      if (result.recorded) {
        toast.success(`Transfer ${result.transferId} reconciled`);
      } else {
        toast.error("Retry failed — TigerBeetle still unavailable");
      }
      refetch();
      setRetrying(null);
    },
    onError: (err) => {
      toast.error(err.message || "Retry failed");
      setRetrying(null);
    },
  });

  const handleRetry = (reference: string, tenantId: string, amountKobo: number) => {
    setRetrying(reference);
    retryMutation.mutate({ reference, tenantId, amountKobo });
  };

  // ── Selective Bulk Retry ───────────────────────────────────────────────────
  const handleRetrySelected = async () => {
    const items = filteredAndSorted.filter((i) => selectedRefs.has(i.reference));
    if (items.length === 0) {
      toast.error("No items selected");
      return;
    }
    setBulkProgress({ current: 0, total: items.length });

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setBulkProgress({ current: i + 1, total: items.length });
      try {
        await retryMutation.mutateAsync({
          reference: item.reference,
          tenantId: item.tenantId,
          amountKobo: item.amountKobo,
        });
      } catch {
        // Continue processing remaining items
      }
    }

    setBulkProgress(null);
    setSelectedRefs(new Set());
    refetch();
    toast.success(`Bulk retry complete — processed ${items.length} items`);
  };

  // ── Select All / None ─────────────────────────────────────────────────────
  const toggleSelectAll = () => {
    if (selectedRefs.size === filteredAndSorted.length) {
      setSelectedRefs(new Set());
    } else {
      setSelectedRefs(new Set(filteredAndSorted.map((i) => i.reference)));
    }
  };

  const toggleSelect = (ref: string) => {
    setSelectedRefs((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  };

  // ── Filtering & Sorting ───────────────────────────────────────────────────
  const filteredAndSorted = useMemo(() => {
    let items: RetryQueueItem[] = (data?.items ?? []) as any[];
    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      items = items.filter((i) => new Date(i.verifiedAt || i.createdAt).getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo).getTime() + 86_400_000;
      items = items.filter((i) => new Date(i.verifiedAt || i.createdAt).getTime() <= to);
    }
    items = [...items].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "date": cmp = new Date(a.verifiedAt || a.createdAt).getTime() - new Date(b.verifiedAt || b.createdAt).getTime(); break;
        case "amount": cmp = a.amountKobo - b.amountKobo; break;
        case "attempts": cmp = a.attempts - b.attempts; break;
        case "tenant": cmp = a.tenantId.localeCompare(b.tenantId); break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return items;
  }, [data?.items, dateFrom, dateTo, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stats = data?.stats ?? { total: 0, totalAmountNGN: 0, oldestAge: "—" };
  const allSelected = filteredAndSorted.length > 0 && selectedRefs.size === filteredAndSorted.length;

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Database className="h-6 w-6" />
            Payment Reconciliation
          </h1>
          <p className="text-muted-foreground mt-1">
            Transactions where TigerBeetle recording failed — verified by Paystack but not credited.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => exportToCSV(filteredAndSorted)}
            disabled={filteredAndSorted.length === 0}
          >
            <Download className="h-4 w-4 mr-1" />
            CSV
          </Button>
          <Button
            onClick={handleRetrySelected}
            disabled={selectedRefs.size === 0 || bulkProgress !== null}
            className="gap-2"
          >
            {bulkProgress ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="h-4 w-4" />
            )}
            Retry Selected ({selectedRefs.size})
          </Button>
        </div>
      </div>

      {/* Bulk Progress Bar */}
      {bulkProgress && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="pt-4">
            <ProgressBar current={bulkProgress.current} total={bulkProgress.total} />
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="text-sm text-muted-foreground">Unreconciled</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-red-600" />
              <span className="text-sm text-muted-foreground">Total Outstanding</span>
            </div>
            <p className="text-2xl font-bold mt-1">₦{stats.totalAmountNGN.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-blue-600" />
              <span className="text-sm text-muted-foreground">Oldest</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats.oldestAge}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs">From Date</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To Date</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
            </div>
            {(dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>
                Clear Filters
              </Button>
            )}
            <div className="ml-auto text-xs text-muted-foreground">
              Showing {filteredAndSorted.length} of {data?.items?.length ?? 0} items
              {selectedRefs.size > 0 && ` · ${selectedRefs.size} selected`}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transaction List */}
      <Card>
        <CardHeader>
          <CardTitle>Failed Ledger Credits</CardTitle>
          <CardDescription>
            Use checkboxes to select items for bulk retry. Click column headers to sort.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredAndSorted.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
              <p className="font-medium text-green-800">All Reconciled</p>
              <p className="text-sm text-muted-foreground mt-1">
                No outstanding unreconciled transactions{(dateFrom || dateTo) ? " in this date range" : ""}.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {/* Header Row */}
              <div className="grid grid-cols-[32px_1fr_1fr_80px_60px_80px_70px_70px] gap-2 text-xs font-medium text-muted-foreground border-b pb-2 items-center">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all"
                />
                <span>Reference</span>
                <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("tenant")}>
                  Tenant <ArrowUpDown className="h-3 w-3" />
                </button>
                <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("amount")}>
                  Amount <ArrowUpDown className="h-3 w-3" />
                </button>
                <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("attempts")}>
                  Tries <ArrowUpDown className="h-3 w-3" />
                </button>
                <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("date")}>
                  Date <ArrowUpDown className="h-3 w-3" />
                </button>
                <span>Status</span>
                <span>Actions</span>
              </div>

              {/* Data Rows */}
              {filteredAndSorted.map((item: any) => (
                <div
                  key={item.reference}
                  className={`grid grid-cols-[32px_1fr_1fr_80px_60px_80px_70px_70px] gap-2 items-center text-sm py-2 border-b border-dashed hover:bg-muted/30 transition-colors ${
                    selectedRefs.has(item.reference) ? "bg-blue-50/50" : ""
                  }`}
                >
                  <Checkbox
                    checked={selectedRefs.has(item.reference)}
                    onCheckedChange={() => toggleSelect(item.reference)}
                    aria-label={`Select ${item.reference}`}
                  />
                  <span className="font-mono text-xs truncate" title={item.reference}>
                    {item.reference.slice(0, 18)}...
                  </span>
                  <span className="truncate text-xs">{item.tenantId}</span>
                  <span className="font-medium text-xs">₦{(item.amountKobo / 100).toLocaleString()}</span>
                  <span className="text-xs">{item.attempts ?? 0}/7</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(item.verifiedAt || item.createdAt).toLocaleDateString()}
                  </span>
                  <Badge
                    variant={item.status === "dead_letter" ? "destructive" : "outline"}
                    className="w-fit text-[10px]"
                  >
                    {item.status === "dead_letter" ? "dead" : item.status || "pending"}
                  </Badge>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setSelectedItem(item)} title="View details">
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="sm" className="h-7 w-7 p-0"
                      disabled={retrying === item.reference || bulkProgress !== null}
                      onClick={() => handleRetry(item.reference, item.tenantId, item.amountKobo)}
                      title="Retry credit"
                    >
                      {retrying === item.reference ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Modal */}
      {selectedItem && (
        <DetailModal item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </div>
  );
}
