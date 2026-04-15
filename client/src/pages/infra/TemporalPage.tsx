// TemporalPage.tsx — Temporal Workflow Orchestration management
// Admin-only: workflow list, start/terminate/signal, activity history

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import BISLayout from "@/components/BISLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Workflow, Play, Square, Send, RefreshCw, CheckCircle2,
  AlertTriangle, XCircle, Activity, MoreHorizontal, Clock,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ─── Status helpers ───────────────────────────────────────────────────────────
const WF_STATUS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  RUNNING:    { label: "Running",    color: "text-blue-400 bg-blue-950/40 border-blue-700/40",    icon: <Activity className="h-3 w-3" /> },
  COMPLETED:  { label: "Completed",  color: "text-emerald-400 bg-emerald-950/40 border-emerald-700/40", icon: <CheckCircle2 className="h-3 w-3" /> },
  FAILED:     { label: "Failed",     color: "text-red-400 bg-red-950/40 border-red-700/40",       icon: <XCircle className="h-3 w-3" /> },
  TERMINATED: { label: "Terminated", color: "text-orange-400 bg-orange-950/40 border-orange-700/40", icon: <Square className="h-3 w-3" /> },
  CANCELLED:  { label: "Cancelled",  color: "text-slate-400 bg-slate-950/40 border-slate-700/40", icon: <XCircle className="h-3 w-3" /> },
};

function WorkflowStatusBadge({ status }: { status: string }) {
  const cfg = WF_STATUS[status] ?? { label: status, color: "text-muted-foreground bg-muted border-border", icon: <Clock className="h-3 w-3" /> };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

// ─── Start Workflow Dialog ────────────────────────────────────────────────────
function StartWorkflowDialog({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: () => void }) {
  const [ref, setRef] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [subjectType, setSubjectType] = useState<"individual" | "company">("individual");
  const [nin, setNin] = useState("");
  const [bvn, setBvn] = useState("");

  const start = trpc.temporal.startInvestigation.useMutation({
    onSuccess: () => { toast.success("Investigation workflow started"); onStarted(); onClose(); },
    onError: (e) => toast.error("Start failed: " + e.message),
  });

  const handleStart = () => {
    if (!ref || !subjectName) { toast.error("Ref and subject name are required"); return; }
    start.mutate({
      ref,
      subjectName,
      subjectType,
      nin: nin || undefined,
      bvn: bvn || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Start Investigation Workflow</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Investigation Ref</Label>
              <Input placeholder="INV-2026-001" value={ref} onChange={e => setRef(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Subject Type</Label>
              <select
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
                value={subjectType}
                onChange={e => setSubjectType(e.target.value as "individual" | "company")}
              >
                <option value="individual">Individual</option>
                <option value="company">Company</option>
              </select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Subject Name</Label>
            <Input placeholder="John Doe / Acme Ltd" value={subjectName} onChange={e => setSubjectName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">NIN (optional)</Label>
              <Input placeholder="12345678901" value={nin} onChange={e => setNin(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">BVN (optional)</Label>
              <Input placeholder="22345678901" value={bvn} onChange={e => setBvn(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleStart} disabled={start.isPending} className="gap-2">
            <Play className="h-3.5 w-3.5" />
            {start.isPending ? "Starting…" : "Start"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Signal Dialog ────────────────────────────────────────────────────────────
function SignalDialog({ wfId, open, onClose }: { wfId: string; open: boolean; onClose: () => void }) {
  const [signalName, setSignalName] = useState("approve");
  const [payload, setPayload] = useState("{}");
  const signal = trpc.temporal.signalWorkflow.useMutation({
    onSuccess: () => { toast.success("Signal sent"); onClose(); },
    onError: (e) => toast.error("Signal failed: " + e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Send Signal</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Signal Name</Label>
            <Input value={signalName} onChange={e => setSignalName(e.target.value)} placeholder="approve" />
          </div>
          <div>
            <Label className="text-xs">Payload JSON</Label>
            <Textarea value={payload} onChange={e => setPayload(e.target.value)} rows={3} className="font-mono text-xs" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => {
            let p: unknown;
            try { p = JSON.parse(payload); } catch { toast.error("Invalid JSON"); return; }
            signal.mutate({ workflowId: wfId, signalName, payload: p });
          }} disabled={signal.isPending}>
            <Send className="h-3.5 w-3.5 mr-1" />Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
function TemporalPageInner() {
  const [startOpen, setStartOpen] = useState(false);
  const [signalWfId, setSignalWfId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "TERMINATED" | undefined>("RUNNING");

  const { data: status } = trpc.temporal.status.useQuery();
  const { data: workflowsData, refetch, isLoading } = trpc.temporal.listWorkflows.useQuery({
    status: statusFilter,
    pageSize: 50,
  });

  const terminate = trpc.temporal.terminateWorkflow.useMutation({
    onSuccess: () => { toast.success("Workflow terminated"); refetch(); },
    onError: (e) => toast.error("Terminate failed: " + e.message),
  });
  const cancel = trpc.temporal.cancelWorkflow.useMutation({
    onSuccess: () => { toast.success("Workflow cancelled"); refetch(); },
    onError: (e) => toast.error("Cancel failed: " + e.message),
  });

  const wfList: any[] = workflowsData && "workflows" in workflowsData ? (workflowsData.workflows as any[]) : [];
  const running = wfList.filter((w: any) => w.status === "RUNNING").length;

  const STATUS_FILTERS: Array<{ label: string; value: typeof statusFilter }> = [
    { label: "Running", value: "RUNNING" },
    { label: "Completed", value: "COMPLETED" },
    { label: "Failed", value: "FAILED" },
    { label: "Terminated", value: "TERMINATED" },
    { label: "All", value: undefined },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Workflow className="h-6 w-6 text-purple-400" />
            Temporal Workflow Engine
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Orchestrate long-running investigation, KYC, and compliance workflows.
          </p>
        </div>
        <Button onClick={() => setStartOpen(true)} className="gap-2">
          <Play className="h-4 w-4" />
          Start Workflow
        </Button>
      </div>

      {/* Connection status */}
      <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm border ${
        status?.configured
          ? "bg-emerald-950/30 border-emerald-700/40 text-emerald-300"
          : "bg-amber-950/30 border-amber-700/40 text-amber-300"
      }`}>
        {status?.configured
          ? <><CheckCircle2 className="h-4 w-4" />Temporal configured — {status.host} · namespace: {status.namespace} · queue: {status.taskQueue}</>
          : <><AlertTriangle className="h-4 w-4" />Temporal not configured — set TEMPORAL_HOST env var</>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Running", value: running, color: "text-blue-400" },
          { label: "Total Loaded", value: wfList.length, color: "text-slate-400" },
          { label: "Namespace", value: status?.namespace ?? "—", color: "text-purple-400" },
          { label: "Task Queue", value: status?.taskQueue ?? "—", color: "text-emerald-400" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-4">
              <div className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Workflow list */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Workflows</CardTitle>
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {STATUS_FILTERS.map(sf => (
                  <button
                    key={sf.label}
                    onClick={() => setStatusFilter(sf.value)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      statusFilter === sf.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {sf.label}
                  </button>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workflow ID</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Closed</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading workflows…</TableCell></TableRow>
              ) : wfList.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No workflows found — Temporal may not be configured</TableCell></TableRow>
              ) : wfList.map((wf: any) => (
                <TableRow key={wf.workflow_id}>
                  <TableCell className="font-mono text-xs max-w-[200px] truncate">{wf.workflow_id}</TableCell>
                  <TableCell className="text-sm">{wf.workflow_type}</TableCell>
                  <TableCell><WorkflowStatusBadge status={wf.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {wf.start_time ? new Date(wf.start_time).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {wf.close_time ? new Date(wf.close_time).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setSignalWfId(wf.workflow_id)}>
                          <Send className="h-3.5 w-3.5 mr-2" />Send Signal
                        </DropdownMenuItem>
                        {wf.status === "RUNNING" && (
                          <>
                            <DropdownMenuItem onClick={() => cancel.mutate({ workflowId: wf.workflow_id })}>
                              <XCircle className="h-3.5 w-3.5 mr-2" />Cancel
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => { if (confirm("Terminate workflow?")) terminate.mutate({ workflowId: wf.workflow_id }); }}
                            >
                              <Square className="h-3.5 w-3.5 mr-2" />Terminate
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <StartWorkflowDialog open={startOpen} onClose={() => setStartOpen(false)} onStarted={() => refetch()} />
      {signalWfId && (
        <SignalDialog wfId={signalWfId} open={true} onClose={() => setSignalWfId(null)} />
      )}
    </div>
  );
}

export default function TemporalPage() {
  return <BISLayout title="Temporal Workflows" subtitle="Workflow Orchestration Engine"><TemporalPageInner /></BISLayout>;
}
