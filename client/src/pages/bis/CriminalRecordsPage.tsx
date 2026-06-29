import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Shield, Search, Plus, AlertTriangle, CheckCircle2, Clock,
  XCircle, FileText, BarChart3, Building2, Gavel,
} from "lucide-react";
import { toast } from 'sonner';
import { CriminalRequestDialog } from "@/components/CriminalRequestDialog";
import { CriminalRequestDrawer } from "@/components/CriminalRequestDrawer";

const AGENCY_LABELS: Record<string, string> = {
  npf:          "NPF — Nigeria Police Force",
  efcc:         "EFCC",
  icpc:         "ICPC",
  dss:          "DSS",
  ndlea:        "NDLEA",
  nscdc:        "NSCDC",
  frsc:         "FRSC",
  custom_state: "State Command",
};

const AGENCY_COLORS: Record<string, string> = {
  npf:          "bg-blue-100 text-blue-800",
  efcc:         "bg-purple-100 text-purple-800",
  icpc:         "bg-indigo-100 text-indigo-800",
  dss:          "bg-gray-100 text-gray-800",
  ndlea:        "bg-green-100 text-green-800",
  nscdc:        "bg-yellow-100 text-yellow-800",
  frsc:         "bg-orange-100 text-orange-800",
  custom_state: "bg-slate-100 text-slate-800",
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft:        { label: "Draft",        color: "bg-gray-100 text-gray-600",    icon: <FileText className="w-3 h-3" /> },
  submitted:    { label: "Submitted",    color: "bg-blue-100 text-blue-700",    icon: <Clock className="w-3 h-3" /> },
  acknowledged: { label: "Acknowledged", color: "bg-cyan-100 text-cyan-700",    icon: <CheckCircle2 className="w-3 h-3" /> },
  processing:   { label: "Processing",   color: "bg-amber-100 text-amber-700",  icon: <Clock className="w-3 h-3" /> },
  completed:    { label: "Completed",    color: "bg-green-100 text-green-700",  icon: <CheckCircle2 className="w-3 h-3" /> },
  rejected:     { label: "Rejected",     color: "bg-red-100 text-red-700",      icon: <XCircle className="w-3 h-3" /> },
  expired:      { label: "Expired",      color: "bg-slate-100 text-slate-500",  icon: <XCircle className="w-3 h-3" /> },
};

const PRIORITY_COLORS: Record<string, string> = {
  low:      "bg-slate-100 text-slate-600",
  medium:   "bg-blue-100 text-blue-700",
  high:     "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

export default function CriminalRecordsPage() {
  
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [agencyFilter, setAgencyFilter] = useState("all");
  const [newRequestOpen, setNewRequestOpen] = useState(false);
  const [selectedRequestRef, setSelectedRequestRef] = useState<string | null>(null);

  const statsQuery = trpc.criminalRecords.getStats.useQuery();
  const requestsQuery = trpc.criminalRecords.listRequests.useQuery({
    search:  search || undefined,
    status:  statusFilter !== "all" ? statusFilter : undefined,
    agency:  agencyFilter !== "all" ? agencyFilter : undefined,
    limit:   100,
    offset:  0,
  });

  const stats = statsQuery.data;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="w-6 h-6 text-blue-600" />
              Criminal Records
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Nigerian law enforcement data collection — NPF, EFCC, ICPC, DSS, NDLEA and state commands
            </p>
          </div>
          <Button onClick={() => setNewRequestOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            New Request
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold">{stats?.totalRequests ?? "—"}</div>
              <div className="text-xs text-muted-foreground mt-1">Total Requests</div>
            </CardContent>
          </Card>
          <Card className="border-amber-200 bg-amber-50/40">
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold text-amber-700">{stats?.pendingRequests ?? "—"}</div>
              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <Clock className="w-3 h-3" /> Pending
              </div>
            </CardContent>
          </Card>
          <Card className="border-green-200 bg-green-50/40">
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold text-green-700">{stats?.completedRequests ?? "—"}</div>
              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Completed
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold">{stats?.totalRecords ?? "—"}</div>
              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <FileText className="w-3 h-3" /> Records
              </div>
            </CardContent>
          </Card>
          <Card className={stats?.warrantCount ? "border-red-300 bg-red-50/40" : ""}>
            <CardContent className="pt-4 pb-3">
              <div className={`text-2xl font-bold ${stats?.warrantCount ? "text-red-700" : ""}`}>
                {stats?.warrantCount ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-red-500" /> Warrants
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold text-red-600">{stats?.rejectedRequests ?? "—"}</div>
              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <XCircle className="w-3 h-3" /> Rejected
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Agency breakdown */}
        {stats && stats.byAgency.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="w-4 h-4" /> Requests by Agency
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {stats.byAgency.map(r => (
                  <div key={r.agency} className="flex items-center justify-between text-sm">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${AGENCY_COLORS[r.agency] ?? "bg-gray-100 text-gray-700"}`}>
                      {AGENCY_LABELS[r.agency] ?? r.agency}
                    </span>
                    <span className="font-semibold">{r.count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Gavel className="w-4 h-4" /> Records by Offence Category
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {stats.byCategory.map(r => (
                  <div key={r.category} className="flex items-center justify-between text-sm">
                    <span className="capitalize text-muted-foreground">{r.category}</span>
                    <span className="font-semibold">{r.count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by subject name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={agencyFilter} onValueChange={setAgencyFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All agencies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All agencies</SelectItem>
              {Object.entries(AGENCY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Status tabs + table */}
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="submitted">Submitted</TabsTrigger>
            <TabsTrigger value="acknowledged">Acknowledged</TabsTrigger>
            <TabsTrigger value="processing">Processing</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
          </TabsList>

          <div className="mt-4 rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Agency</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Records</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requestsQuery.isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      Loading requests…
                    </TableCell>
                  </TableRow>
                )}
                {!requestsQuery.isLoading && (!requestsQuery.data?.items.length) && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12">
                      <Shield className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-muted-foreground text-sm">No requests found</p>
                      <Button variant="outline" size="sm" className="mt-3" onClick={() => setNewRequestOpen(true)}>
                        Submit first request
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
                {requestsQuery.data?.items.map(req => {
                  const sc = STATUS_CONFIG[req.status] ?? STATUS_CONFIG.draft;
                  return (
                    <TableRow
                      key={req.requestRef}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedRequestRef(req.requestRef)}
                    >
                      <TableCell className="font-mono text-xs">{req.requestRef}</TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{req.subjectName}</div>
                        {req.nin && <div className="text-xs text-muted-foreground">NIN: {req.nin}</div>}
                      </TableCell>
                      <TableCell>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${AGENCY_COLORS[req.agency] ?? "bg-gray-100 text-gray-700"}`}>
                          {AGENCY_LABELS[req.agency] ?? req.agency}
                        </span>
                        {req.stateCommand && (
                          <div className="text-xs text-muted-foreground mt-0.5">{req.stateCommand}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${PRIORITY_COLORS[req.priority] ?? ""}`}>
                          {req.priority}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${sc.color}`}>
                          {sc.icon} {sc.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {req.submittedAt ? new Date(req.submittedAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        <BarChart3 className="w-4 h-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Tabs>
      </div>

      {/* New Request Dialog */}
      <CriminalRequestDialog
        open={newRequestOpen}
        onClose={() => setNewRequestOpen(false)}
        onSuccess={() => {
          setNewRequestOpen(false);
          requestsQuery.refetch();
          statsQuery.refetch();
          toast.success("Request submitted: The data collection request has been sent.");
        }}
      />

      {/* Request Detail Drawer */}
      {selectedRequestRef && (
        <CriminalRequestDrawer
          requestRef={selectedRequestRef}
          onClose={() => setSelectedRequestRef(null)}
          onUpdate={() => { requestsQuery.refetch(); statsQuery.refetch(); }}
        />
      )}
    </DashboardLayout>
  );
}
