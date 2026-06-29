import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Shield, AlertTriangle } from "lucide-react";

const AGENCIES = [
  { value: "npf",          label: "NPF — Nigeria Police Force (Federal)" },
  { value: "efcc",         label: "EFCC — Economic & Financial Crimes Commission" },
  { value: "icpc",         label: "ICPC — Independent Corrupt Practices Commission" },
  { value: "dss",          label: "DSS — Department of State Services" },
  { value: "ndlea",        label: "NDLEA — National Drug Law Enforcement Agency" },
  { value: "nscdc",        label: "NSCDC — Nigeria Security & Civil Defence Corps" },
  { value: "frsc",         label: "FRSC — Federal Road Safety Corps" },
  { value: "custom_state", label: "State Police Command (specify below)" },
];

const NIGERIAN_STATES = [
  "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno",
  "Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT — Abuja","Gombe",
  "Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos",
  "Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto",
  "Taraba","Yobe","Zamfara",
];

const CHECK_OPTIONS = [
  { id: "arrest",     label: "Arrest records" },
  { id: "conviction", label: "Conviction records" },
  { id: "warrant",    label: "Outstanding warrants" },
  { id: "watchlist",  label: "Agency watchlist status" },
  { id: "charges",    label: "Pending charges" },
  { id: "bail",       label: "Bail / bond history" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  investigationRef?: string;
  prefillName?: string;
  prefillNin?: string;
}

export function CriminalRequestDialog({ open, onClose, onSuccess, investigationRef, prefillName, prefillNin }: Props) {
  const [form, setForm] = useState({
    subjectName:     prefillName ?? "",
    subjectType:     "individual" as "individual" | "corporate",
    nin:             prefillNin ?? "",
    bvn:             "",
    dob:             "",
    gender:          "",
    agency:          "" as string,
    stateCommand:    "",
    contactOfficer:  "",
    contactEmail:    "",
    contactPhone:    "",
    priority:        "medium" as "low" | "medium" | "high" | "critical",
    purpose:         "",
    notes:           "",
    requestedChecks: ["arrest", "conviction", "warrant"] as string[],
  });

  const submitMutation = trpc.criminalRecords.submitRequest.useMutation();

  function toggleCheck(id: string) {
    setForm(f => ({
      ...f,
      requestedChecks: f.requestedChecks.includes(id)
        ? f.requestedChecks.filter(c => c !== id)
        : [...f.requestedChecks, id],
    }));
  }

  async function handleSubmit() {
    if (!form.subjectName.trim() || !form.agency) return;
    await submitMutation.mutateAsync({
      investigationRef: investigationRef,
      subjectName:      form.subjectName,
      subjectType:      form.subjectType,
      nin:              form.nin || undefined,
      bvn:              form.bvn || undefined,
      dob:              form.dob || undefined,
      gender:           form.gender || undefined,
      agency:           form.agency as any,
      stateCommand:     form.stateCommand || undefined,
      contactOfficer:   form.contactOfficer || undefined,
      contactEmail:     form.contactEmail || undefined,
      contactPhone:     form.contactPhone || undefined,
      priority:         form.priority,
      purpose:          form.purpose || undefined,
      notes:            form.notes || undefined,
      requestedChecks:  form.requestedChecks,
    });
    onSuccess();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            New Criminal Record Request
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Subject Information */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Subject Information</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Subject Name *</Label>
                <Input
                  value={form.subjectName}
                  onChange={e => setForm(f => ({ ...f, subjectName: e.target.value }))}
                  placeholder="Full legal name"
                />
              </div>
              <div>
                <Label>Subject Type</Label>
                <Select value={form.subjectType} onValueChange={v => setForm(f => ({ ...f, subjectType: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">Individual</SelectItem>
                    <SelectItem value="corporate">Corporate</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>NIN</Label>
                <Input value={form.nin} onChange={e => setForm(f => ({ ...f, nin: e.target.value }))} placeholder="11-digit NIN" maxLength={11} />
              </div>
              <div>
                <Label>BVN</Label>
                <Input value={form.bvn} onChange={e => setForm(f => ({ ...f, bvn: e.target.value }))} placeholder="11-digit BVN" maxLength={11} />
              </div>
              <div>
                <Label>Date of Birth</Label>
                <Input type="date" value={form.dob} onChange={e => setForm(f => ({ ...f, dob: e.target.value }))} />
              </div>
              <div>
                <Label>Gender</Label>
                <Select value={form.gender} onValueChange={v => setForm(f => ({ ...f, gender: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Agency Details */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Agency Details</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Law Enforcement Agency *</Label>
                <Select value={form.agency} onValueChange={v => setForm(f => ({ ...f, agency: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select agency" /></SelectTrigger>
                  <SelectContent>
                    {AGENCIES.map(a => (
                      <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {form.agency === "custom_state" && (
                <div className="col-span-2">
                  <Label>State Command</Label>
                  <Select value={form.stateCommand} onValueChange={v => setForm(f => ({ ...f, stateCommand: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                    <SelectContent>
                      {NIGERIAN_STATES.map(s => (
                        <SelectItem key={s} value={`${s} State Police Command`}>{s} State Police Command</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label>Contact Officer</Label>
                <Input value={form.contactOfficer} onChange={e => setForm(f => ({ ...f, contactOfficer: e.target.value }))} placeholder="Officer name / rank" />
              </div>
              <div>
                <Label>Contact Phone</Label>
                <Input value={form.contactPhone} onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} placeholder="+234…" />
              </div>
              <div className="col-span-2">
                <Label>Contact Email</Label>
                <Input type="email" value={form.contactEmail} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} placeholder="agency@example.gov.ng" />
              </div>
            </div>
          </div>

          {/* Checks Requested */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Checks Requested</h3>
            <div className="grid grid-cols-2 gap-2">
              {CHECK_OPTIONS.map(opt => (
                <label key={opt.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={form.requestedChecks.includes(opt.id)}
                    onCheckedChange={() => toggleCheck(opt.id)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Request Metadata */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Request Details</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Purpose / Justification</Label>
                <Textarea
                  value={form.purpose}
                  onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))}
                  placeholder="Reason for this data collection request…"
                  rows={2}
                />
              </div>
              <div className="col-span-2">
                <Label>Internal Notes</Label>
                <Textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional internal notes…"
                  rows={2}
                />
              </div>
            </div>
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              This request will be submitted to the selected Nigerian law enforcement agency.
              Ensure all subject identifiers are accurate before submitting.
              Requests are logged and audited.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!form.subjectName.trim() || !form.agency || submitMutation.isPending}
          >
            {submitMutation.isPending ? "Submitting…" : "Submit Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
