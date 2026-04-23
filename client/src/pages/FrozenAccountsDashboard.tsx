/**
 * Frozen Accounts Dashboard
 *
 * Lists all currently frozen accounts with bulk-unfreeze capability,
 * CSV export for regulatory reporting, and freeze history timeline.
 * v61: Added filter by reason category, status, and date range.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import BISLayout from "@/components/BISLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Snowflake, AlertTriangle, Download, RefreshCw, Search, Users, Filter, X, Unlock } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

const FREEZE_REASON_CATEGORIES = [
  { value: "all", label: "All Reasons" },
  { value: "aml", label: "AML Suspicion", keywords: ["aml", "anti-money", "money launder"] },
  { value: "fraud", label: "Fraud Investigation", keywords: ["fraud", "scam", "deception"] },
  { value: "sanctions", label: "Sanctions Match", keywords: ["sanction", "ofac", "un list", "eu list"] },
  { value: "court_order", label: "Court Order", keywords: ["court", "judicial", "tribunal"] },
  { value: "regulatory", label: "Regulatory Directive", keywords: ["regulatory", "cbn", "nfiu", "efcc"] },
  { value: "pep", label: "PEP Screening", keywords: ["pep", "politically exposed"] },
];

function getReasonCategory(reason: string): string {
  const rl = reason.toLowerCase();
  for (const cat of FREEZE_REASON_CATEGORIES.slice(1)) {
    if (cat.keywords && cat.keywords.some(kw => rl.includes(kw))) return cat.value;
  }
  return "other";
}

const REASON_COLORS: Record<string, string> = {
  aml: "text-orange-400 border-orange-400",
  fraud: "text-red-400 border-red-400",
  sanctions: "text-purple-400 border-purple-400",
  court_order: "text-yellow-400 border-yellow-400",
  regulatory: "text-blue-400 border-blue-400",
  pep: "text-pink-400 border-pink-400",
  other: "text-gray-400 border-gray-400",
};

export default function FrozenAccountsDashboard() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [includeUnfrozen, setIncludeUnfrozen] = useState(false);
  const [reasonFilter, setReasonFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "frozen" | "unfrozen">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkReason, setBulkReason] = useState("");
  const [showBulkDialog, setShowBulkDialog] = useState(false);

  const { data, isLoading, refetch } = trpc.paymentRails.listFrozenAccounts.useQuery({
    includeUnfrozen: true,
    cursor: 0,
    limit: 200,
  });

  const bulkUnfreeze = trpc.paymentRails.bulkUnfreeze.useMutation({
    onSuccess: (res) => {
      toast.success(`${res.unfrozen} account(s) unfrozen successfully`);
      setSelectedIds([]);
      setBulkReason("");
      setShowBulkDialog(false);
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const rows = data?.rows ?? [];

  const filtered = useMemo(() => {
    return rows.filter(r => {
      // Text search
      const q = search.toLowerCase();
      if (q && !(
        r.accountId.toLowerCase().includes(q) ||
        (r.accountName ?? "").toLowerCase().includes(q) ||
        r.reason.toLowerCase().includes(q)
      )) return false;

      // Reason category filter
      if (reasonFilter !== "all") {
        const cat = getReasonCategory(r.reason);
        if (cat !== reasonFilter) return false;
      }

      // Status filter
      if (statusFilter === "frozen" && r.unfrozenAt) return false;
      if (statusFilter === "unfrozen" && !r.unfrozenAt) return false;

      // Date range filter
      if (dateFrom) {
        if (new Date(r.frozenAt) < new Date(dateFrom)) return false;
      }
      if (dateTo) {
        if (new Date(r.frozenAt) > new Date(dateTo + "T23:59:59")) return false;
      }

      return true;
    });
  }, [rows, search, reasonFilter, statusFilter, dateFrom, dateTo]);

  const frozenCount = rows.filter(r => !r.unfrozenAt).length;
  const unfrozenCount = rows.filter(r => r.unfrozenAt).length;

  const toggleSelect = (accountId: string) => {
    setSelectedIds(prev =>
      prev.includes(accountId) ? prev.filter(id => id !== accountId) : [...prev, accountId]
    );
  };

  const toggleAll = () => {
    const activeFrozen = filtered.filter(r => !r.unfrozenAt).map(r => r.accountId);
    if (selectedIds.length === activeFrozen.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(activeFrozen);
    }
  };

  const exportCSV = () => {
    const headers = ["accountId", "accountName", "reason", "frozenBy", "frozenAt", "unfrozenAt", "unfrozenBy", "notes"];
    const lines = [
      headers.join(","),
      ...rows.map(r => headers.map(h => {
        const v = r[h as keyof typeof r];
        if (v === null || v === undefined) return "";
        const s = v instanceof Date ? v.toISOString() : String(v);
        return s.includes(",") ? `"${s}"` : s;
      }).join(","))
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `frozen-accounts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  };

  return (
    <BISLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Snowflake className="h-6 w-6 text-blue-400" />
              Frozen Accounts Dashboard
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage frozen accounts, bulk unfreeze, and export for regulatory reporting
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
            {selectedIds.length > 0 && (
              <Button size="sm" onClick={() => setShowBulkDialog(true)}>
                Unfreeze {selectedIds.length} Selected
              </Button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-blue-400">{frozenCount}</div>
              <div className="text-sm text-muted-foreground">Currently Frozen</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-green-400">{unfrozenCount}</div>
              <div className="text-sm text-muted-foreground">Unfrozen (Historical)</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{rows.length}</div>
              <div className="text-sm text-muted-foreground">Total Events</div>
            </CardContent>
          </Card>
        </div>

        {/* Reason Breakdown Cards */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {FREEZE_REASON_CATEGORIES.slice(1).map(cat => {
            const count = rows.filter(r => !r.unfrozenAt && getReasonCategory(r.reason) === cat.value).length;
            return (
              <button
                key={cat.value}
                onClick={() => setReasonFilter(reasonFilter === cat.value ? "all" : cat.value)}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  reasonFilter === cat.value ? "border-blue-500 bg-blue-500/10" : "border-border hover:border-muted-foreground"
                }`}
              >
                <div className="text-xs text-muted-foreground truncate">{cat.label}</div>
                <div className="text-xl font-bold mt-1">{count}</div>
              </button>
            );
          })}
        </div>

        {/* Controls */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" /> Frozen Account List
                <Badge variant="outline" className="ml-2">{filtered.length} results</Badge>
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search accounts..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-8 w-52"
                  />
                </div>
                <Select value={reasonFilter} onValueChange={setReasonFilter}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {FREEZE_REASON_CATEGORIES.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | "frozen" | "unfrozen")}>
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="frozen">Frozen Only</SelectItem>
                    <SelectItem value="unfrozen">Unfrozen Only</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDateFilter(!showDateFilter)}
                  className={showDateFilter ? "border-blue-500" : ""}
                >
                  <Filter className="h-4 w-4 mr-1" /> Date
                </Button>
                {(search || reasonFilter !== "all" || statusFilter !== "all" || dateFrom || dateTo) && (
                  <Button variant="ghost" size="sm" onClick={() => {
                    setSearch(""); setReasonFilter("all"); setStatusFilter("all"); setDateFrom(""); setDateTo("");
                  }}>
                    <X className="h-4 w-4 mr-1" /> Clear
                  </Button>
                )}
              </div>
            </div>
            {showDateFilter && (
              <div className="flex items-center gap-3 pt-2 border-t mt-2">
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">Frozen From</Label>
                  <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36 h-8 text-xs" />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">To</Label>
                  <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36 h-8 text-xs" />
                </div>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No frozen accounts found
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-2 pr-4 w-8">
                        <Checkbox
                          checked={selectedIds.length === filtered.filter(r => !r.unfrozenAt).length && filtered.filter(r => !r.unfrozenAt).length > 0}
                          onCheckedChange={toggleAll}
                        />
                      </th>
                      <th className="text-left py-2 pr-4">Account ID</th>
                      <th className="text-left py-2 pr-4">Account Name</th>
                      <th className="text-left py-2 pr-4">Reason</th>
                      <th className="text-left py-2 pr-4">Frozen At</th>
                      <th className="text-left py-2 pr-4">Status</th>
                      <th className="text-left py-2 pr-4">Affected Txns</th>
                      <th className="text-left py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(row => (
                      <tr key={row.id} className="border-b hover:bg-muted/30">
                        <td className="py-2 pr-4">
                          {!row.unfrozenAt && (
                            <Checkbox
                              checked={selectedIds.includes(row.accountId)}
                              onCheckedChange={() => toggleSelect(row.accountId)}
                            />
                          )}
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">
                          <button
                            className="text-blue-400 hover:underline"
                            onClick={() => navigate(`/payment-rails/accounts/${row.accountId}`)}
                          >
                            {row.accountId}
                          </button>
                        </td>
                        <td className="py-2 pr-4">{row.accountName ?? "—"}</td>
                        <td className="py-2 pr-4 max-w-xs">
                          <div className="truncate text-sm" title={row.reason}>{row.reason}</div>
                          <Badge variant="outline" className={`text-xs mt-0.5 ${REASON_COLORS[getReasonCategory(row.reason)]}`}>
                            {getReasonCategory(row.reason).replace("_", " ").toUpperCase()}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4 text-xs text-muted-foreground">
                          {new Date(row.frozenAt).toLocaleString()}
                        </td>
                        <td className="py-2 pr-4">
                          {row.unfrozenAt ? (
                            <Badge variant="outline" className="text-green-400 border-green-400">Unfrozen</Badge>
                          ) : (
                            <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                              <AlertTriangle className="h-3 w-3" /> Frozen
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 pr-4">{row.affectedTransactions}</td>
                        <td className="py-2">
                          {!row.unfrozenAt && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedIds([row.accountId]);
                                setShowBulkDialog(true);
                              }}
                            >
                              Unfreeze
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bulk Unfreeze Dialog */}
      <Dialog open={showBulkDialog} onOpenChange={setShowBulkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unfreeze {selectedIds.length} Account(s)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Accounts to unfreeze</Label>
              <div className="mt-1 text-sm text-muted-foreground font-mono">
                {selectedIds.join(", ")}
              </div>
            </div>
            <div>
              <Label htmlFor="bulk-reason">Reason for unfreezing *</Label>
              <Textarea
                id="bulk-reason"
                placeholder="Regulatory clearance / investigation closed / error correction..."
                value={bulkReason}
                onChange={e => setBulkReason(e.target.value)}
                className="mt-1"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkDialog(false)}>Cancel</Button>
            <Button
              disabled={bulkReason.length < 5 || bulkUnfreeze.isPending}
              onClick={() => bulkUnfreeze.mutate({ accountIds: selectedIds, reason: bulkReason })}
            >
              {bulkUnfreeze.isPending ? "Processing..." : `Unfreeze ${selectedIds.length} Account(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BISLayout>
  );
}
