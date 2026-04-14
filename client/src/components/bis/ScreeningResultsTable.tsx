import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, RefreshCw, ChevronLeft, ChevronRight, Eye, CheckCircle, Clock, XCircle, AlertTriangle } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  processing: "bg-blue-500/20 text-blue-400",
  completed: "bg-green-500/20 text-green-400",
  failed: "bg-red-500/20 text-red-400",
  review: "bg-purple-500/20 text-purple-400",
};

const STATUS_ICONS: Record<string, any> = {
  pending: Clock,
  processing: RefreshCw,
  completed: CheckCircle,
  failed: XCircle,
  review: AlertTriangle,
};

interface ScreeningResultsTableProps {
  screeningType: string;
  title?: string;
}

export default function ScreeningResultsTable({ screeningType, title = "Recent Screenings" }: ScreeningResultsTableProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const limit = 10;
  const utils = trpc.useUtils();

  const { data, isLoading, refetch } = trpc.screening.list.useQuery({
    type: screeningType,
    status: statusFilter !== "all" ? statusFilter : undefined,
    limit,
    offset: page * limit,
  });

  const updateMutation = trpc.screening.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("Status updated");
      utils.screening.list.invalidate();
      setSelectedRecord(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = (data?.records ?? []).filter((r: any) =>
    !search || r.subjectName?.toLowerCase().includes(search.toLowerCase()) || r.requestRef?.toLowerCase().includes(search.toLowerCase())
  );

  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-3 h-3" />
        </Button>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input
            placeholder="Search by name or ref..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-8 h-8 text-xs"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="review">Review</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="bg-card border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left p-2 font-medium">Ref</th>
                <th className="text-left p-2 font-medium">Subject</th>
                <th className="text-center p-2 font-medium">Priority</th>
                <th className="text-center p-2 font-medium">Status</th>
                <th className="text-center p-2 font-medium">Risk</th>
                <th className="text-left p-2 font-medium">Date</th>
                <th className="text-right p-2 font-medium">View</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="p-2"><div className="h-3 bg-muted rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">No records found</td>
                </tr>
              ) : filtered.map((record: any) => {
                const Icon = STATUS_ICONS[record.status] ?? Clock;
                const riskColor = record.riskScore >= 70 ? "text-red-400" : record.riskScore >= 40 ? "text-yellow-400" : "text-green-400";
                return (
                  <tr key={record.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="p-2 font-mono text-blue-400">{record.requestRef}</td>
                    <td className="p-2 font-medium max-w-[120px] truncate">{record.subjectName}</td>
                    <td className="p-2 text-center capitalize">{record.priority}</td>
                    <td className="p-2 text-center">
                      <Badge className={`text-[10px] ${STATUS_COLORS[record.status] ?? ""}`}>
                        <Icon className="w-2.5 h-2.5 mr-1" />
                        {record.status}
                      </Badge>
                    </td>
                    <td className={`p-2 text-center font-mono font-bold ${riskColor}`}>
                      {record.riskScore ?? "—"}
                    </td>
                    <td className="p-2 text-muted-foreground">
                      {record.createdAt ? new Date(record.createdAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="p-2 text-right">
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setSelectedRecord(record)}>
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
          <div className="flex items-center justify-between p-2 border-t border-border">
            <span className="text-xs text-muted-foreground">{total} records</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" className="h-6 w-6 p-0" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="w-3 h-3" />
              </Button>
              <span className="text-xs px-2 py-1">{page + 1}/{totalPages}</span>
              <Button variant="outline" size="sm" className="h-6 w-6 p-0" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Record Detail Dialog */}
      {selectedRecord && (
        <Dialog open={true} onOpenChange={() => setSelectedRecord(null)}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-mono text-sm">{selectedRecord.requestRef}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Subject:</span> <span className="font-medium">{selectedRecord.subjectName}</span></div>
                <div><span className="text-muted-foreground">Type:</span> <span className="capitalize">{selectedRecord.type?.replace(/_/g, " ")}</span></div>
                <div><span className="text-muted-foreground">Priority:</span> <span className="capitalize">{selectedRecord.priority}</span></div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <Badge className={`text-xs ${STATUS_COLORS[selectedRecord.status] ?? ""}`}>{selectedRecord.status}</Badge>
                </div>
                {selectedRecord.riskScore !== null && selectedRecord.riskScore !== undefined && (
                  <div><span className="text-muted-foreground">Risk Score:</span> <span className="font-bold font-mono">{selectedRecord.riskScore}/100</span></div>
                )}
                {selectedRecord.completedAt && (
                  <div><span className="text-muted-foreground">Completed:</span> <span>{new Date(selectedRecord.completedAt).toLocaleString()}</span></div>
                )}
              </div>
              {selectedRecord.resultSummary && (
                <div>
                  <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Summary</div>
                  <div className="text-xs bg-muted/30 rounded p-2 whitespace-pre-wrap">{selectedRecord.resultSummary}</div>
                </div>
              )}
              {selectedRecord.status === "pending" && (
                <div className="flex gap-2 pt-2">
                  <Button size="sm" onClick={() => updateMutation.mutate({ id: selectedRecord.id, status: "processing" })} disabled={updateMutation.isPending}>
                    Mark Processing
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => updateMutation.mutate({ id: selectedRecord.id, status: "completed", riskScore: 0 })} disabled={updateMutation.isPending}>
                    Mark Complete
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => updateMutation.mutate({ id: selectedRecord.id, status: "failed" })} disabled={updateMutation.isPending}>
                    Mark Failed
                  </Button>
                </div>
              )}
              {selectedRecord.status === "processing" && (
                <div className="flex gap-2 pt-2">
                  <Button size="sm" onClick={() => updateMutation.mutate({ id: selectedRecord.id, status: "completed", riskScore: 0 })} disabled={updateMutation.isPending}>
                    Mark Complete
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => updateMutation.mutate({ id: selectedRecord.id, status: "review" })} disabled={updateMutation.isPending}>
                    Send to Review
                  </Button>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
