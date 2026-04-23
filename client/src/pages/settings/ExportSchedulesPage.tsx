import { useState } from "react";
import BISLayout from "@/components/BISLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Calendar, Download, Plus, Trash2, Play, Clock } from "lucide-react";
import { toast } from "sonner";

const EXPORT_TYPES = [
  { value: "cases", label: "Cases" },
  { value: "investigations", label: "Investigations" },
  { value: "lex_submissions", label: "LEX Submissions" },
  { value: "audit_log", label: "Audit Log" },
  { value: "transactions", label: "Transaction History" },
  { value: "aml_alerts", label: "AML Alerts" },
  { value: "frozen_accounts", label: "Frozen Accounts" },
  { value: "sar_filings", label: "SAR Filings" },
  { value: "kyc_records", label: "KYC Records" },
  { value: "regulatory_reports", label: "Regulatory Reports" },
] as const;

const CRON_PRESETS = [
  { label: "Every Monday at 8am", value: "0 8 * * 1" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Daily at 6am", value: "0 6 * * *" },
  { label: "Every Sunday at 6am", value: "0 6 * * 0" },
  { label: "1st of every month", value: "0 8 1 * *" },
  { label: "15th of every month", value: "0 8 15 * *" },
  { label: "Every weekday at 5pm", value: "0 17 * * 1-5" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Quarterly (Jan/Apr/Jul/Oct 1st)", value: "0 8 1 1,4,7,10 *" },
];

export default function ExportSchedulesPage() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", exportType: "cases" as const, format: "csv" as "csv" | "json", cronExpression: "0 8 * * 1" });

  const { data: schedules, isLoading } = trpc.exportSchedules.list.useQuery();

  const create = trpc.exportSchedules.create.useMutation({
    onSuccess: () => {
      toast.success("Export schedule created");
      utils.exportSchedules.list.invalidate();
      setOpen(false);
      setForm({ name: "", exportType: "cases", format: "csv", cronExpression: "0 8 * * 1" });
    },
    onError: (e) => toast.error(e.message),
  });

  const toggle = trpc.exportSchedules.update.useMutation({
    onSuccess: () => utils.exportSchedules.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.exportSchedules.delete.useMutation({
    onSuccess: () => {
      toast.success("Schedule deleted");
      utils.exportSchedules.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const runNow = trpc.exportSchedules.runNow.useMutation({
    onSuccess: (d) => {
      toast.success("Export ready", { description: "Click to download", action: { label: "Download", onClick: () => window.open(d.url, "_blank") } });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <BISLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Calendar className="h-6 w-6 text-blue-400" />
              Scheduled Transaction History Reports
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Automate recurring data exports — transaction history, AML alerts, SAR filings, KYC records, and more.
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                New Schedule
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Export Schedule</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label>Schedule name</Label>
                  <Input placeholder="Weekly cases export" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Data type</Label>
                  <Select value={form.exportType} onValueChange={v => setForm(f => ({ ...f, exportType: v as typeof form.exportType }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EXPORT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Format</Label>
                  <Select value={form.format} onValueChange={v => setForm(f => ({ ...f, format: v as "csv" | "json" }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="csv">CSV</SelectItem>
                      <SelectItem value="json">JSON</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Schedule</Label>
                  <Select value={form.cronExpression} onValueChange={v => setForm(f => ({ ...f, cronExpression: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CRON_PRESETS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full"
                  onClick={() => create.mutate(form)}
                  disabled={!form.name || create.isPending}
                >
                  Create Schedule
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Summary Stats */}
        {schedules && schedules.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="text-sm text-muted-foreground">Total Schedules</div>
                <div className="text-2xl font-bold mt-1">{schedules.length}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-sm text-muted-foreground">Active</div>
                <div className="text-2xl font-bold mt-1 text-green-400">{schedules.filter(s => s.enabled).length}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-sm text-muted-foreground">Paused</div>
                <div className="text-2xl font-bold mt-1 text-yellow-400">{schedules.filter(s => !s.enabled).length}</div>
              </CardContent>
            </Card>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />)}
          </div>
        ) : !schedules?.length ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <Calendar className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No export schedules</p>
              <p className="text-sm mt-1">Create a schedule to automate recurring data exports.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {schedules.map(schedule => (
              <Card key={schedule.id}>
                <CardContent className="flex items-center justify-between py-4 px-5">
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-full bg-muted">
                      <Download className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{schedule.name}</span>
                        <Badge variant="outline" className="text-xs">{schedule.exportType.replace("_", " ")}</Badge>
                        <Badge variant="outline" className="text-xs uppercase">{schedule.format}</Badge>
                        {!schedule.enabled && <Badge variant="secondary" className="text-xs">Paused</Badge>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{schedule.cronExpression}</span>
                        {schedule.lastRunAt && <span>Last run: {new Date(schedule.lastRunAt).toLocaleDateString()}</span>}
                        {schedule.nextRunAt && <span>Next: {new Date(schedule.nextRunAt).toLocaleDateString()}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={schedule.enabled}
                      onCheckedChange={v => toggle.mutate({ id: schedule.id, enabled: v })}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => runNow.mutate({ id: schedule.id })}
                      disabled={runNow.isPending}
                    >
                      <Play className="h-3.5 w-3.5 mr-1" />
                      Run now
                    </Button>
                    {schedule.lastFileUrl && (
                      <Button variant="ghost" size="sm" onClick={() => window.open(schedule.lastFileUrl!, "_blank")}>
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => del.mutate({ id: schedule.id })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </BISLayout>
  );
}
