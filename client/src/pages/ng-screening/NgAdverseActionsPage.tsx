import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertTriangle, CheckCircle2, Clock3, Gavel, Loader2, PauseCircle, Send, ShieldCheck, XCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const statusConfig: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  pre_notice_queued: { label: "Pre-notice queued", className: "text-amber-700 bg-amber-50 border-amber-200", icon: <Send size={13} /> },
  pre_notice_delivered: { label: "Pre-notice delivered", className: "text-sky-700 bg-sky-50 border-sky-200", icon: <CheckCircle2 size={13} /> },
  waiting: { label: "Waiting period", className: "text-blue-700 bg-blue-50 border-blue-200", icon: <Clock3 size={13} /> },
  paused_for_dispute: { label: "Paused for dispute", className: "text-violet-700 bg-violet-50 border-violet-200", icon: <PauseCircle size={13} /> },
  final_notice_queued: { label: "Final notice queued", className: "text-orange-700 bg-orange-50 border-orange-200", icon: <Send size={13} /> },
  completed: { label: "Completed", className: "text-emerald-700 bg-emerald-50 border-emerald-200", icon: <ShieldCheck size={13} /> },
  undeliverable: { label: "Undeliverable", className: "text-red-700 bg-red-50 border-red-200", icon: <AlertTriangle size={13} /> },
  manual_delivery: { label: "Manual delivery required", className: "text-red-700 bg-red-50 border-red-200", icon: <AlertTriangle size={13} /> },
  canceled: { label: "Canceled", className: "text-slate-700 bg-slate-50 border-slate-200", icon: <XCircle size={13} /> },
};

const statuses = ["all", ...Object.keys(statusConfig)];

export default function NgAdverseActionsPage() {
  const [status, setStatus] = useState("all");
  const [cancelCaseRef, setCancelCaseRef] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const utils = trpc.useUtils();
  const cases = trpc.complianceWorkflow.list.useQuery(status === "all" ? undefined : { status });
  const cancel = trpc.complianceWorkflow.cancel.useMutation({
    onSuccess: () => {
      toast.success("Adverse-action workflow canceled and queued deliveries invalidated.");
      setCancelCaseRef(null);
      setCancelReason("");
      void utils.complianceWorkflow.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6 p-6">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-primary"><Gavel size={22} /><span className="font-mono text-xs uppercase tracking-[0.18em]">Compliance operations</span></div>
          <h1 className="text-2xl font-semibold text-foreground">Adverse-action control queue</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">This queue contains workflow references and statuses only. It deliberately does not display candidate PII, report content, raw provider data, or notice text.</p>
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Filter status" /></SelectTrigger>
          <SelectContent>{statuses.map((value) => <SelectItem key={value} value={value}>{value === "all" ? "All statuses" : statusConfig[value]?.label ?? value}</SelectItem>)}</SelectContent>
        </Select>
      </section>

      <Card className="border-primary/20 bg-primary/5"><CardContent className="flex gap-3 pt-5 text-sm text-muted-foreground"><ShieldCheck className="mt-0.5 shrink-0 text-primary" size={18} /><p>Production activation is fail-closed: authorized staff require tenant-scoped policy approval, counsel-approved templates, active encryption keyrings, and a valid signed candidate consent. Notice dispatch remains held until an approved channel adapter is configured.</p></CardContent></Card>

      {cases.isLoading ? <div className="flex justify-center py-24"><Loader2 className="animate-spin text-muted-foreground" /></div> : cases.data?.length ? (
        <div className="space-y-3">{cases.data.map((item) => {
          const config = statusConfig[item.status] ?? statusConfig.pre_notice_queued;
          const canCancel = !["completed", "canceled"].includes(item.status);
          return <Card key={item.case_ref} className="border-border/60"><CardContent className="pt-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2"><div className="flex flex-wrap items-center gap-2"><span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${config.className}`}>{config.icon}{config.label}</span><code className="text-xs text-muted-foreground">{item.case_ref}</code></div>
                <p className="text-sm text-muted-foreground">Framework: <strong className="font-medium text-foreground uppercase">{item.framework}</strong> · Jurisdiction: <strong className="font-medium text-foreground">{item.jurisdiction_code}</strong> · Wait period: <strong className="font-medium text-foreground">{item.waiting_period_days} days</strong></p>
                {item.final_notice_eligible_at && <p className="text-xs text-muted-foreground">Final-notice eligibility: {new Date(item.final_notice_eligible_at).toLocaleString("en-NG")}</p>}</div>
              <div className="flex items-center gap-3"><span className="text-xs text-muted-foreground">Opened {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}</span>{canCancel && <Button size="sm" variant="outline" onClick={() => setCancelCaseRef(item.case_ref)}>Cancel</Button>}</div>
            </div>
          </CardContent></Card>;
        })}</div>
      ) : <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground"><Gavel size={40} className="mb-4 opacity-30"/><p className="font-medium">No adverse-action workflows match this filter.</p><p className="mt-1 max-w-md text-sm">New cases are created from completed, consent-valid screening orders by authorized adjudicators.</p></div>}

      <Dialog open={Boolean(cancelCaseRef)} onOpenChange={(open) => { if (!open) { setCancelCaseRef(null); setCancelReason(""); } }}>
        <DialogContent><DialogHeader><DialogTitle>Cancel adverse-action workflow</DialogTitle></DialogHeader><div className="space-y-3 py-2"><p className="text-sm text-muted-foreground">Cancellation invalidates only queued delivery work. It does not erase immutable compliance audit evidence.</p><div className="space-y-1"><Label htmlFor="cancel-reason">Reason</Label><Textarea id="cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Describe the reason for cancellation (minimum 20 characters)." rows={4}/></div></div><DialogFooter><Button variant="outline" onClick={() => setCancelCaseRef(null)}>Keep workflow</Button><Button variant="destructive" disabled={cancelReason.trim().length < 20 || cancel.isPending} onClick={() => { if (cancelCaseRef) cancel.mutate({ caseRef: cancelCaseRef, reason: cancelReason.trim() }); }}>{cancel.isPending && <Loader2 className="mr-2 animate-spin" size={14}/>}Cancel workflow</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}
