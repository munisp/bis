/**
 * Frozen Accounts Dashboard
 *
 * Lists all currently frozen accounts with bulk-unfreeze capability,
 * CSV export for regulatory reporting, and freeze history timeline.
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
import { Snowflake, AlertTriangle, Download, RefreshCw, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function FrozenAccountsDashboard() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [includeUnfrozen, setIncludeUnfrozen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkReason, setBulkReason] = useState("");
  const [showBulkDialog, setShowBulkDialog] = useState(false);

  const { data, isLoading, refetch } = trpc.paymentRails.listFrozenAccounts.useQuery({
    includeUnfrozen,
    cursor: 0,
    limit: 100,
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
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(r =>
      r.accountId.toLowerCase().includes(q) ||
      (r.accountName ?? "").toLowerCase().includes(q) ||
      r.reason.toLowerCase().includes(q)
    );
  }, [rows, search]);

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

        {/* Controls */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" /> Frozen Account List
              </CardTitle>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    id="show-unfrozen"
                    checked={includeUnfrozen}
                    onCheckedChange={setIncludeUnfrozen}
                  />
                  <Label htmlFor="show-unfrozen" className="text-sm">Show Unfrozen</Label>
                </div>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search accounts..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-8 w-64"
                  />
                </div>
              </div>
            </div>
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
                        <td className="py-2 pr-4 max-w-xs truncate" title={row.reason}>{row.reason}</td>
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
