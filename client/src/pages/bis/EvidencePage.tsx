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
  Shield, Plus, Search, Eye, ChevronLeft, ChevronRight,
  RefreshCw, CheckCircle, AlertTriangle, Lock, FileText
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  collected: "bg-blue-500/20 text-blue-400",
  in_transit: "bg-yellow-500/20 text-yellow-400",
  secured: "bg-green-500/20 text-green-400",
  analyzed: "bg-purple-500/20 text-purple-400",
  submitted: "bg-cyan-500/20 text-cyan-400",
  returned: "bg-gray-500/20 text-gray-400",
  destroyed: "bg-red-500/20 text-red-400",
};

const TYPE_ICONS: Record<string, any> = {
  document: FileText,
  photo: FileText,
  video: FileText,
  audio: FileText,
  digital_artifact: Shield,
  physical: Lock,
  witness_statement: FileText,
  financial_record: FileText,
  communication_log: FileText,
  other: Shield,
};

export default function EvidencePage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);

  const limit = 20;
  const utils = trpc.useUtils();

  const { data: evidenceData, isLoading } = trpc.evidence.list.useQuery({
    limit,
    offset: page * limit,
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    type: typeFilter !== "all" ? typeFilter : undefined,
  });

  const { data: stats } = trpc.evidence.stats.useQuery();

  const [form, setForm] = useState({
    type: "document" as any,
    title: "",
    description: "",
    fileUrl: "",
    fileHash: "",
    collectionLocation: "",
    caseId: "",
  });

  const createMutation = trpc.evidence.create.useMutation({
    onSuccess: () => {
      toast.success("Evidence item logged");
      utils.evidence.list.invalidate();
      utils.evidence.stats.invalidate();
      setShowCreate(false);
      setForm({ type: "document", title: "", description: "", fileUrl: "", fileHash: "", collectionLocation: "", caseId: "" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const transferMutation = trpc.evidence.transferCustody.useMutation({
    onSuccess: () => {
      toast.success("Custody transferred");
      utils.evidence.list.invalidate();
      setSelectedItem(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const verifyMutation = trpc.evidence.verifyIntegrity.useMutation({
    onSuccess: (data) => {
      if (data.hashMatch) {
        toast.success("Integrity verified — hash matches");
      } else {
        toast.error("Integrity check FAILED — hash mismatch!");
      }
      utils.evidence.list.invalidate();
      setSelectedItem(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const totalPages = Math.ceil((evidenceData?.total ?? 0) / limit);

  const NEXT_STATUS: Record<string, string> = {
    collected: "secured",
    secured: "analyzed",
    analyzed: "submitted",
    in_transit: "secured",
  };

  return (
    <BISLayout title="Evidence Chain of Custody" subtitle="Track and verify evidence integrity across the full investigation lifecycle">
      <div className="space-y-6">
        <div className="flex justify-end">
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Log Evidence
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Items", value: stats?.total ?? 0, icon: Shield, color: "text-blue-400" },
            { label: "Collected", value: stats?.collected ?? 0, icon: FileText, color: "text-cyan-400" },
            { label: "Secured", value: stats?.secured ?? 0, icon: Lock, color: "text-green-400" },
            { label: "Analyzed", value: stats?.analyzed ?? 0, icon: CheckCircle, color: "text-purple-400" },
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
              placeholder="Search by ref, title, location..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {Object.keys(STATUS_COLORS).map(k => (
                <SelectItem key={k} value={k}>{k.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {Object.keys(TYPE_ICONS).map(k => (
                <SelectItem key={k} value={k}>{k.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => utils.evidence.list.invalidate()}>
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
                  <th className="text-center p-3 font-medium">Status</th>
                  <th className="text-center p-3 font-medium">Integrity</th>
                  <th className="text-left p-3 font-medium">Location</th>
                  <th className="text-left p-3 font-medium">Collected</th>
                  <th className="text-right p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="p-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>
                      ))}
                    </tr>
                  ))
                ) : evidenceData?.items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      <Shield className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      No evidence items found
                    </td>
                  </tr>
                ) : evidenceData?.items.map((item: any) => {
                  const Icon = TYPE_ICONS[item.type] ?? Shield;
                  return (
                    <tr key={item.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="p-3 font-mono text-xs text-blue-400">{item.evidenceRef}</td>
                      <td className="p-3 font-medium text-xs max-w-[160px] truncate">{item.title}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          <Icon className="w-3 h-3 text-muted-foreground" />
                          <span className="text-xs capitalize">{item.type?.replace(/_/g, " ")}</span>
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <Badge className={`text-xs ${STATUS_COLORS[item.status] ?? ""}`}>
                          {item.status?.replace(/_/g, " ")}
                        </Badge>
                      </td>
                      <td className="p-3 text-center">
                        {item.integrityVerified ? (
                          <CheckCircle className="w-4 h-4 text-green-400 mx-auto" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-yellow-400 mx-auto" />
                        )}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">{item.collectionLocation ?? "—"}</td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {item.collectedAt ? new Date(item.collectedAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="p-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedItem(item)}>
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
              <span className="text-sm text-muted-foreground">{evidenceData?.total} items</span>
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

      {/* Log Evidence Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Log Evidence Item</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div>
              <Label>Type *</Label>
              <Select value={form.type} onValueChange={(v) => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(TYPE_ICONS).map(k => (
                    <SelectItem key={k} value={k}>{k.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Case ID (optional)</Label>
              <Input type="number" value={form.caseId} onChange={(e) => setForm(f => ({ ...f, caseId: e.target.value }))} placeholder="Linked case ID" />
            </div>
            <div className="col-span-2">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Bank statement Q3 2025" />
            </div>
            <div className="col-span-2">
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>File URL (if digital)</Label>
              <Input value={form.fileUrl} onChange={(e) => setForm(f => ({ ...f, fileUrl: e.target.value }))} placeholder="https://..." />
            </div>
            <div>
              <Label>SHA-256 Hash</Label>
              <Input value={form.fileHash} onChange={(e) => setForm(f => ({ ...f, fileHash: e.target.value }))} placeholder="For integrity verification" />
            </div>
            <div>
              <Label>Collection Location</Label>
              <Input value={form.collectionLocation} onChange={(e) => setForm(f => ({ ...f, collectionLocation: e.target.value }))} placeholder="e.g. Lagos Office, Safe 3" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({
                type: form.type,
                title: form.title,
                description: form.description || undefined,
                fileUrl: form.fileUrl || undefined,
                fileHash: form.fileHash || undefined,
                collectionLocation: form.collectionLocation || undefined,
                caseId: form.caseId ? parseInt(form.caseId) : undefined,
              })}
              disabled={createMutation.isPending || !form.title}
            >
              {createMutation.isPending ? "Logging..." : "Log Evidence"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Evidence Detail Dialog */}
      {selectedItem && (
        <Dialog open={true} onOpenChange={() => setSelectedItem(null)}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{selectedItem.evidenceRef} — {selectedItem.title}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Type:</span> <span className="capitalize">{selectedItem.type?.replace(/_/g, " ")}</span></div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <Badge className={`text-xs ${STATUS_COLORS[selectedItem.status] ?? ""}`}>{selectedItem.status?.replace(/_/g, " ")}</Badge>
                </div>
                <div><span className="text-muted-foreground">Location:</span> <span>{selectedItem.collectionLocation ?? "—"}</span></div>
                <div>
                  <span className="text-muted-foreground">Integrity:</span>{" "}
                  {selectedItem.integrityVerified ? (
                    <span className="text-green-400">✓ Verified</span>
                  ) : (
                    <span className="text-yellow-400">⚠ Unverified</span>
                  )}
                </div>
                {selectedItem.fileHash && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Hash:</span>
                    <span className="font-mono text-xs ml-1 break-all">{selectedItem.fileHash}</span>
                  </div>
                )}
              </div>

              {/* Chain of Custody */}
              {selectedItem.chainOfCustody && selectedItem.chainOfCustody.length > 0 && (
                <div>
                  <div className="font-medium mb-2 text-muted-foreground text-xs uppercase tracking-wide">Chain of Custody</div>
                  <div className="space-y-2">
                    {(selectedItem.chainOfCustody as any[]).map((entry: any, i: number) => (
                      <div key={i} className="flex gap-3 text-xs">
                        <div className="w-2 h-2 rounded-full bg-blue-400 mt-1 flex-shrink-0" />
                        <div>
                          <span className="font-medium capitalize">{entry.action?.replace(/_/g, " ")}</span>
                          <span className="text-muted-foreground ml-2">{new Date(entry.timestamp).toLocaleString()}</span>
                          {entry.notes && <div className="text-muted-foreground">{entry.notes}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-2">
                {NEXT_STATUS[selectedItem.status] && (
                  <Button size="sm" onClick={() => transferMutation.mutate({ id: selectedItem.id, toStatus: NEXT_STATUS[selectedItem.status] as any })} disabled={transferMutation.isPending}>
                    Transfer to: {NEXT_STATUS[selectedItem.status].replace(/_/g, " ")}
                  </Button>
                )}
                {!selectedItem.integrityVerified && (
                  <Button size="sm" variant="outline" onClick={() => verifyMutation.mutate({ id: selectedItem.id })} disabled={verifyMutation.isPending}>
                    Verify Integrity
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
