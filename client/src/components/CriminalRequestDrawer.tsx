import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  CheckCircle2, Clock, XCircle, AlertTriangle, FileText,
  Upload, Plus, Shield, User, Building2, Gavel, Eye,
} from "lucide-react";
import { toast } from 'sonner';
import { CriminalRecordDetailModal } from "@/components/CriminalRecordDetailModal";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:        { label: "Draft",        color: "bg-gray-100 text-gray-600" },
  submitted:    { label: "Submitted",    color: "bg-blue-100 text-blue-700" },
  acknowledged: { label: "Acknowledged", color: "bg-cyan-100 text-cyan-700" },
  processing:   { label: "Processing",   color: "bg-amber-100 text-amber-700" },
  completed:    { label: "Completed",    color: "bg-green-100 text-green-700" },
  rejected:     { label: "Rejected",     color: "bg-red-100 text-red-700" },
  expired:      { label: "Expired",      color: "bg-slate-100 text-slate-500" },
};

const AGENCY_LABELS: Record<string, string> = {
  npf: "NPF", efcc: "EFCC", icpc: "ICPC", dss: "DSS",
  ndlea: "NDLEA", nscdc: "NSCDC", frsc: "FRSC", custom_state: "State Command",
};

const OFFENCE_CATEGORIES = [
  "violent","financial","drug","cybercrime","terrorism","corruption","traffic","sexual","property","other"
];

const VERDICTS = ["convicted","acquitted","discharged","pending","nolle_prosequi","unknown"];

interface Props {
  requestRef: string;
  onClose: () => void;
  onUpdate: () => void;
}

export function CriminalRequestDrawer({ requestRef, onClose, onUpdate }: Props) {
  
  const [activeTab, setActiveTab] = useState("overview");
  const [ingestOpen, setIngestOpen] = useState(false);
  const [statusUpdateOpen, setStatusUpdateOpen] = useState(false);
  const [selectedRecordRef, setSelectedRecordRef] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const requestQuery = trpc.criminalRecords.getRequest.useQuery({ requestRef });
  const updateStatusMutation = trpc.criminalRecords.updateRequestStatus.useMutation();
  const ingestMutation = trpc.criminalRecords.ingestRecord.useMutation();
  const uploadMutation = trpc.criminalRecords.uploadAttachment.useMutation();

  const data = requestQuery.data;
  const req = data?.request;

  // Status update form
  const [statusForm, setStatusForm] = useState({
    status: "" as any,
    agencyRefNumber: "",
    contactOfficer: "",
    rejectedReason: "",
    notes: "",
  });

  // Ingest record form
  const [ingestForm, setIngestForm] = useState({
    subjectName:         req?.subjectName ?? "",
    nin:                 req?.nin ?? "",
    offenceCategory:     "other" as string,
    offenceCode:         "",
    offenceDescription:  "",
    offenceDate:         "",
    offenceLocation:     "",
    offenceState:        "",
    dateArrested:        "",
    arrestingStation:    "",
    dateCharged:         "",
    chargingAuthority:   "",
    courtName:           "",
    caseNumber:          "",
    verdict:             "unknown" as string,
    dateConvicted:       "",
    sentence:            "",
    dateReleased:        "",
    outstandingWarrant:  false,
    warrantDetails:      "",
    warrantIssuedBy:     "",
    agencyRef:           "",
    dataSource:          "agency_response" as string,
    confidence:          0.8,
  });

  async function handleStatusUpdate() {
    if (!statusForm.status) return;
    await updateStatusMutation.mutateAsync({
      requestRef,
      status:          statusForm.status,
      agencyRefNumber: statusForm.agencyRefNumber || undefined,
      contactOfficer:  statusForm.contactOfficer || undefined,
      rejectedReason:  statusForm.rejectedReason || undefined,
      notes:           statusForm.notes || undefined,
    });
    setStatusUpdateOpen(false);
    requestQuery.refetch();
    onUpdate();
    toast.success("Status updated");
  }

  async function handleIngest() {
    if (!ingestForm.offenceDescription.trim()) return;
    await ingestMutation.mutateAsync({
      requestRef,
      investigationRef: req?.investigationRef ?? undefined,
      agency:           req?.agency as any,
      agencyRef:        ingestForm.agencyRef || undefined,
      stateCommand:     req?.stateCommand ?? undefined,
      subjectName:      ingestForm.subjectName || req?.subjectName || "",
      nin:              ingestForm.nin || req?.nin || undefined,
      offenceCategory:  ingestForm.offenceCategory as any,
      offenceCode:      ingestForm.offenceCode || undefined,
      offenceDescription: ingestForm.offenceDescription,
      offenceDate:      ingestForm.offenceDate || undefined,
      offenceLocation:  ingestForm.offenceLocation || undefined,
      offenceState:     ingestForm.offenceState || undefined,
      dateArrested:     ingestForm.dateArrested || undefined,
      arrestingStation: ingestForm.arrestingStation || undefined,
      dateCharged:      ingestForm.dateCharged || undefined,
      chargingAuthority: ingestForm.chargingAuthority || undefined,
      courtName:        ingestForm.courtName || undefined,
      caseNumber:       ingestForm.caseNumber || undefined,
      verdict:          ingestForm.verdict as any,
      dateConvicted:    ingestForm.dateConvicted || undefined,
      sentence:         ingestForm.sentence || undefined,
      dateReleased:     ingestForm.dateReleased || undefined,
      outstandingWarrant: ingestForm.outstandingWarrant,
      warrantDetails:   ingestForm.warrantDetails || undefined,
      warrantIssuedBy:  ingestForm.warrantIssuedBy || undefined,
      dataSource:       ingestForm.dataSource as any,
      confidence:       ingestForm.confidence,
    });
    setIngestOpen(false);
    requestQuery.refetch();
    onUpdate();
    toast.success(ingestForm.outstandingWarrant ? "Record ingested — ⚠ Outstanding warrant alert created." : "Record ingested successfully.");
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      await uploadMutation.mutateAsync({
        requestRef,
        fileName:     file.name,
        fileBase64:   base64,
        mimeType:     file.type || "application/octet-stream",
        documentType: "other",
      });
      requestQuery.refetch();
      toast.success("Attachment uploaded");
    };
    reader.readAsDataURL(file);
  }

  if (!req && !requestQuery.isLoading) return null;

  const sc = req ? (STATUS_CONFIG[req.status] ?? STATUS_CONFIG.draft) : null;

  return (
    <>
      <Sheet open onOpenChange={v => !v && onClose()}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto p-0">
          {requestQuery.isLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">Loading…</div>
          ) : req ? (
            <>
              {/* Header */}
              <div className="p-6 border-b">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Shield className="w-5 h-5 text-blue-600" />
                      <span className="font-mono text-sm text-muted-foreground">{req.requestRef}</span>
                      {sc && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${sc.color}`}>
                          {sc.label}
                        </span>
                      )}
                    </div>
                    <h2 className="text-xl font-bold">{req.subjectName}</h2>
                    <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{AGENCY_LABELS[req.agency] ?? req.agency}</span>
                      {req.stateCommand && <span>· {req.stateCommand}</span>}
                      {req.nin && <span>· NIN: {req.nin}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setStatusUpdateOpen(true)}>
                      Update Status
                    </Button>
                    <Button size="sm" onClick={() => setIngestOpen(true)} className="gap-1">
                      <Plus className="w-3 h-3" /> Ingest Record
                    </Button>
                  </div>
                </div>
              </div>

              <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
                <div className="px-6 pt-4">
                  <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="records">
                      Records {data?.records.length ? `(${data.records.length})` : ""}
                    </TabsTrigger>
                    <TabsTrigger value="attachments">
                      Attachments {data?.attachments.length ? `(${data.attachments.length})` : ""}
                    </TabsTrigger>
                    <TabsTrigger value="audit">Audit Trail</TabsTrigger>
                  </TabsList>
                </div>

                {/* Overview */}
                <TabsContent value="overview" className="px-6 pb-6 space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      ["Agency", AGENCY_LABELS[req.agency] ?? req.agency],
                      ["State Command", req.stateCommand ?? "—"],
                      ["Agency Ref", req.agencyRefNumber ?? "—"],
                      ["Priority", req.priority],
                      ["Subject Type", req.subjectType],
                      ["Nationality", req.nationality ?? "Nigerian"],
                      ["Date of Birth", req.dob ?? "—"],
                      ["Gender", req.gender ?? "—"],
                      ["BVN", req.bvn ?? "—"],
                      ["Contact Officer", req.contactOfficer ?? "—"],
                      ["Contact Email", req.contactEmail ?? "—"],
                      ["Contact Phone", req.contactPhone ?? "—"],
                    ].map(([k, v]) => (
                      <div key={k} className="flex flex-col">
                        <span className="text-xs text-muted-foreground">{k}</span>
                        <span className="font-medium capitalize">{v}</span>
                      </div>
                    ))}
                  </div>

                  {req.purpose && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Purpose</div>
                      <p className="text-sm bg-muted/40 rounded p-3">{req.purpose}</p>
                    </div>
                  )}

                  {Array.isArray(req.requestedChecks) && req.requestedChecks.length > 0 && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-2">Checks Requested</div>
                      <div className="flex flex-wrap gap-2">
                        {(req.requestedChecks as string[]).map(c => (
                          <span key={c} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs capitalize">{c}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Timeline */}
                  <div>
                    <div className="text-xs text-muted-foreground mb-2">Status Timeline</div>
                    <div className="space-y-2">
                      {[
                        { label: "Submitted",    ts: req.submittedAt },
                        { label: "Acknowledged", ts: req.acknowledgedAt },
                        { label: "Processing",   ts: req.processingAt },
                        { label: "Completed",    ts: req.completedAt },
                        { label: "Rejected",     ts: req.rejectedAt },
                      ].filter(t => t.ts).map(t => (
                        <div key={t.label} className="flex items-center gap-2 text-sm">
                          <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                          <span className="font-medium">{t.label}</span>
                          <span className="text-muted-foreground">{new Date(t.ts!).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {req.rejectedReason && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
                      <strong>Rejection reason:</strong> {req.rejectedReason}
                    </div>
                  )}
                </TabsContent>

                {/* Records */}
                <TabsContent value="records" className="px-6 pb-6 mt-4">
                  {!data?.records.length ? (
                    <div className="text-center py-10">
                      <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-muted-foreground text-sm">No records ingested yet</p>
                      <Button size="sm" variant="outline" className="mt-3" onClick={() => setIngestOpen(true)}>
                        Ingest first record
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {data.records.map(r => (
                        <Card
                          key={r.recordRef}
                          className={`cursor-pointer hover:shadow-md transition-shadow ${r.outstandingWarrant ? "border-red-300 bg-red-50/30" : ""}`}
                          onClick={() => setSelectedRecordRef(r.recordRef)}
                        >
                          <CardContent className="pt-4 pb-3">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-mono text-xs text-muted-foreground">{r.recordRef}</span>
                                  <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs capitalize">{r.offenceCategory}</span>
                                  <span className={`px-2 py-0.5 rounded text-xs capitalize ${
                                    r.verdict === "convicted" ? "bg-red-100 text-red-700" :
                                    r.verdict === "acquitted" ? "bg-green-100 text-green-700" :
                                    "bg-gray-100 text-gray-600"
                                  }`}>{r.verdict}</span>
                                </div>
                                <p className="text-sm font-medium">{r.offenceDescription}</p>
                                <div className="text-xs text-muted-foreground mt-1 flex gap-3">
                                  {r.courtName && <span>Court: {r.courtName}</span>}
                                  {r.caseNumber && <span>Case: {r.caseNumber}</span>}
                                  {r.dateArrested && <span>Arrested: {r.dateArrested}</span>}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                {r.outstandingWarrant && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-bold">
                                    <AlertTriangle className="w-3 h-3" /> WARRANT
                                  </span>
                                )}
                                {r.verifiedAt && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                                    <CheckCircle2 className="w-3 h-3" /> Verified
                                  </span>
                                )}
                                <Eye className="w-4 h-4 text-muted-foreground mt-1" />
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Attachments */}
                <TabsContent value="attachments" className="px-6 pb-6 mt-4">
                  <div className="flex justify-between items-center mb-4">
                    <p className="text-sm text-muted-foreground">Police extracts, court judgements, warrant copies</p>
                    <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-1">
                      <Upload className="w-3 h-3" /> Upload
                    </Button>
                    <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload}
                      accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" />
                  </div>
                  {!data?.attachments.length ? (
                    <div className="text-center py-10">
                      <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-muted-foreground text-sm">No attachments yet</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {data.attachments.map(a => (
                        <div key={a.attachmentRef} className="flex items-center justify-between p-3 border rounded-md text-sm">
                          <div>
                            <div className="font-medium">{a.fileName}</div>
                            <div className="text-xs text-muted-foreground capitalize">{a.documentType} · {a.mimeType}</div>
                          </div>
                          <a href={a.fileUrl} target="_blank" rel="noopener noreferrer">
                            <Button size="sm" variant="outline">View</Button>
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Audit Trail */}
                <TabsContent value="audit" className="px-6 pb-6 mt-4">
                  {!data?.auditTrail.length ? (
                    <p className="text-muted-foreground text-sm text-center py-8">No audit entries</p>
                  ) : (
                    <div className="space-y-2">
                      {data.auditTrail.map(entry => (
                        <div key={entry.auditRef} className="flex gap-3 text-sm">
                          <div className="w-1 bg-border rounded-full shrink-0 mt-1" />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium capitalize">{entry.action.replace(/_/g, " ")}</span>
                              <span className="text-xs text-muted-foreground">by {entry.actorName}</span>
                            </div>
                            <div className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Status Update Dialog */}
      <Dialog open={statusUpdateOpen} onOpenChange={v => !v && setStatusUpdateOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Update Request Status</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>New Status</Label>
              <Select value={statusForm.status} onValueChange={v => setStatusForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="acknowledged">Acknowledged</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Agency Reference Number</Label>
              <Input value={statusForm.agencyRefNumber} onChange={e => setStatusForm(f => ({ ...f, agencyRefNumber: e.target.value }))} placeholder="Agency's own ref" />
            </div>
            <div>
              <Label>Contact Officer</Label>
              <Input value={statusForm.contactOfficer} onChange={e => setStatusForm(f => ({ ...f, contactOfficer: e.target.value }))} placeholder="Officer name" />
            </div>
            {statusForm.status === "rejected" && (
              <div>
                <Label>Rejection Reason</Label>
                <Textarea value={statusForm.rejectedReason} onChange={e => setStatusForm(f => ({ ...f, rejectedReason: e.target.value }))} rows={2} />
              </div>
            )}
            <div>
              <Label>Notes</Label>
              <Textarea value={statusForm.notes} onChange={e => setStatusForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusUpdateOpen(false)}>Cancel</Button>
            <Button onClick={handleStatusUpdate} disabled={!statusForm.status || updateStatusMutation.isPending}>
              {updateStatusMutation.isPending ? "Saving…" : "Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ingest Record Dialog */}
      <Dialog open={ingestOpen} onOpenChange={v => !v && setIngestOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Gavel className="w-4 h-4" /> Ingest Criminal Record</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Subject Name</Label>
                <Input value={ingestForm.subjectName} onChange={e => setIngestForm(f => ({ ...f, subjectName: e.target.value }))} />
              </div>
              <div>
                <Label>NIN</Label>
                <Input value={ingestForm.nin} onChange={e => setIngestForm(f => ({ ...f, nin: e.target.value }))} />
              </div>
              <div>
                <Label>Agency Reference</Label>
                <Input value={ingestForm.agencyRef} onChange={e => setIngestForm(f => ({ ...f, agencyRef: e.target.value }))} placeholder="Agency's case ref" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Offence Category *</Label>
                <Select value={ingestForm.offenceCategory} onValueChange={v => setIngestForm(f => ({ ...f, offenceCategory: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OFFENCE_CATEGORIES.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Offence Code</Label>
                <Input value={ingestForm.offenceCode} onChange={e => setIngestForm(f => ({ ...f, offenceCode: e.target.value }))} placeholder="e.g. S.419 CC" />
              </div>
              <div className="col-span-2">
                <Label>Offence Description *</Label>
                <Textarea value={ingestForm.offenceDescription} onChange={e => setIngestForm(f => ({ ...f, offenceDescription: e.target.value }))} rows={2} placeholder="Describe the offence…" />
              </div>
              <div>
                <Label>Offence Date</Label>
                <Input type="date" value={ingestForm.offenceDate} onChange={e => setIngestForm(f => ({ ...f, offenceDate: e.target.value }))} />
              </div>
              <div>
                <Label>Offence State</Label>
                <Input value={ingestForm.offenceState} onChange={e => setIngestForm(f => ({ ...f, offenceState: e.target.value }))} placeholder="e.g. Lagos" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date Arrested</Label>
                <Input type="date" value={ingestForm.dateArrested} onChange={e => setIngestForm(f => ({ ...f, dateArrested: e.target.value }))} />
              </div>
              <div>
                <Label>Arresting Station</Label>
                <Input value={ingestForm.arrestingStation} onChange={e => setIngestForm(f => ({ ...f, arrestingStation: e.target.value }))} placeholder="Police station / unit" />
              </div>
              <div>
                <Label>Date Charged</Label>
                <Input type="date" value={ingestForm.dateCharged} onChange={e => setIngestForm(f => ({ ...f, dateCharged: e.target.value }))} />
              </div>
              <div>
                <Label>Charging Authority</Label>
                <Input value={ingestForm.chargingAuthority} onChange={e => setIngestForm(f => ({ ...f, chargingAuthority: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Court Name</Label>
                <Input value={ingestForm.courtName} onChange={e => setIngestForm(f => ({ ...f, courtName: e.target.value }))} />
              </div>
              <div>
                <Label>Case Number</Label>
                <Input value={ingestForm.caseNumber} onChange={e => setIngestForm(f => ({ ...f, caseNumber: e.target.value }))} />
              </div>
              <div>
                <Label>Verdict</Label>
                <Select value={ingestForm.verdict} onValueChange={v => setIngestForm(f => ({ ...f, verdict: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VERDICTS.map(v => <SelectItem key={v} value={v} className="capitalize">{v.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Date Convicted</Label>
                <Input type="date" value={ingestForm.dateConvicted} onChange={e => setIngestForm(f => ({ ...f, dateConvicted: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label>Sentence</Label>
                <Input value={ingestForm.sentence} onChange={e => setIngestForm(f => ({ ...f, sentence: e.target.value }))} placeholder="e.g. 5 years IHL, ₦500,000 fine" />
              </div>
              <div>
                <Label>Date Released</Label>
                <Input type="date" value={ingestForm.dateReleased} onChange={e => setIngestForm(f => ({ ...f, dateReleased: e.target.value }))} />
              </div>
            </div>

            {/* Outstanding Warrant */}
            <div className={`p-3 rounded-md border ${ingestForm.outstandingWarrant ? "border-red-300 bg-red-50" : "border-border"}`}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ingestForm.outstandingWarrant}
                  onChange={e => setIngestForm(f => ({ ...f, outstandingWarrant: e.target.checked }))}
                  className="w-4 h-4"
                />
                <span className="font-medium text-sm">Outstanding Warrant</span>
                {ingestForm.outstandingWarrant && (
                  <span className="text-xs text-red-600 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> A critical alert will be created
                  </span>
                )}
              </label>
              {ingestForm.outstandingWarrant && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Warrant Details</Label>
                    <Textarea value={ingestForm.warrantDetails} onChange={e => setIngestForm(f => ({ ...f, warrantDetails: e.target.value }))} rows={2} />
                  </div>
                  <div>
                    <Label className="text-xs">Issued By</Label>
                    <Input value={ingestForm.warrantIssuedBy} onChange={e => setIngestForm(f => ({ ...f, warrantIssuedBy: e.target.value }))} />
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Data Source</Label>
                <Select value={ingestForm.dataSource} onValueChange={v => setIngestForm(f => ({ ...f, dataSource: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agency_response">Agency Response</SelectItem>
                    <SelectItem value="manual_entry">Manual Entry</SelectItem>
                    <SelectItem value="api_integration">API Integration</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Confidence (0–1)</Label>
                <Input type="number" min={0} max={1} step={0.05} value={ingestForm.confidence}
                  onChange={e => setIngestForm(f => ({ ...f, confidence: parseFloat(e.target.value) }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIngestOpen(false)}>Cancel</Button>
            <Button onClick={handleIngest} disabled={!ingestForm.offenceDescription.trim() || ingestMutation.isPending}>
              {ingestMutation.isPending ? "Saving…" : "Ingest Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record Detail Modal */}
      {selectedRecordRef && (
        <CriminalRecordDetailModal
          recordRef={selectedRecordRef}
          onClose={() => setSelectedRecordRef(null)}
          onVerified={() => requestQuery.refetch()}
        />
      )}
    </>
  );
}
