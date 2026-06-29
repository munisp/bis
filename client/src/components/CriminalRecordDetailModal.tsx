import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CheckCircle2, AlertTriangle, Shield, Copy, Check,
} from "lucide-react";
import { toast } from 'sonner';

const AGENCY_LABELS: Record<string, string> = {
  npf: "NPF — Nigeria Police Force",
  efcc: "EFCC — Economic & Financial Crimes Commission",
  icpc: "ICPC — Independent Corrupt Practices Commission",
  dss: "DSS — Department of State Services",
  ndlea: "NDLEA — National Drug Law Enforcement Agency",
  nscdc: "NSCDC — Nigeria Security & Civil Defence Corps",
  frsc: "FRSC — Federal Road Safety Corps",
  custom_state: "State Police Command",
};

interface Props {
  recordRef: string;
  onClose: () => void;
  onVerified?: () => void;
}

export function CriminalRecordDetailModal({ recordRef, onClose, onVerified }: Props) {
  
  const [copied, setCopied] = useState(false);
  const [rawExpanded, setRawExpanded] = useState(false);

  const recordQuery = trpc.criminalRecords.getRecord.useQuery({ recordRef });
  const verifyMutation = trpc.criminalRecords.verifyRecord.useMutation();

  const data = recordQuery.data;
  const r = data?.record;

  async function handleVerify() {
    await verifyMutation.mutateAsync({ recordRef });
    recordQuery.refetch();
    onVerified?.();
    toast.success(`Record verified: ${recordRef} marked as verified.`);
  }

  function copyRaw() {
    if (!r?.rawPayload) return;
    navigator.clipboard.writeText(JSON.stringify(r.rawPayload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!r && !recordQuery.isLoading) return null;

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-600" />
                Criminal Record
              </DialogTitle>
              {r && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="font-mono text-xs text-muted-foreground">{r.recordRef}</span>
                  {r.outstandingWarrant && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-bold">
                      <AlertTriangle className="w-3 h-3" /> OUTSTANDING WARRANT
                    </span>
                  )}
                  {r.verifiedAt && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                      <CheckCircle2 className="w-3 h-3" /> Verified
                    </span>
                  )}
                </div>
              )}
            </div>
            {r && !r.verifiedAt && (
              <Button size="sm" variant="outline" onClick={handleVerify} disabled={verifyMutation.isPending} className="gap-1 shrink-0">
                <CheckCircle2 className="w-3 h-3" />
                {verifyMutation.isPending ? "Verifying…" : "Verify Record"}
              </Button>
            )}
          </div>
        </DialogHeader>

        {recordQuery.isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading…</div>
        ) : r ? (
          <Tabs defaultValue="details">
            <TabsList>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="court">Court & Verdict</TabsTrigger>
              {r.outstandingWarrant && <TabsTrigger value="warrant">Warrant</TabsTrigger>}
              <TabsTrigger value="attachments">
                Attachments {data?.attachments.length ? `(${data.attachments.length})` : ""}
              </TabsTrigger>
              {!!r.rawPayload && <TabsTrigger value="raw">Raw Data</TabsTrigger>}
            </TabsList>

            {/* Details */}
            <TabsContent value="details" className="space-y-4 mt-4">
              {/* Subject */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Subject</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {[
                    ["Name", r.subjectName],
                    ["NIN", r.nin ?? "—"],
                    ["Date of Birth", r.dob ?? "—"],
                    ["Gender", r.gender ?? "—"],
                    ["Nationality", r.nationality ?? "—"],
                    ["Aliases", Array.isArray(r.aliases) && r.aliases.length ? (r.aliases as string[]).join(", ") : "—"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div className="text-xs text-muted-foreground">{k}</div>
                      <div className="font-medium">{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Agency */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Agency</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {[
                    ["Agency", AGENCY_LABELS[r.agency] ?? r.agency],
                    ["State Command", r.stateCommand ?? "—"],
                    ["Agency Ref", r.agencyRef ?? "—"],
                    ["Data Source", r.dataSource ?? "—"],
                    ["Confidence", r.confidence != null ? `${Math.round(r.confidence * 100)}%` : "—"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div className="text-xs text-muted-foreground">{k}</div>
                      <div className="font-medium capitalize">{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Offence */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Offence</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {[
                    ["Category", r.offenceCategory],
                    ["Code", r.offenceCode ?? "—"],
                    ["Date", r.offenceDate ?? "—"],
                    ["Location", r.offenceLocation ?? "—"],
                    ["State", r.offenceState ?? "—"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div className="text-xs text-muted-foreground">{k}</div>
                      <div className="font-medium capitalize">{v}</div>
                    </div>
                  ))}
                  <div className="col-span-2">
                    <div className="text-xs text-muted-foreground">Description</div>
                    <div className="font-medium bg-muted/40 rounded p-2 mt-1">{r.offenceDescription}</div>
                  </div>
                </div>
              </div>

              {/* Arrest */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Arrest & Charge</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {[
                    ["Date Arrested", r.dateArrested ?? "—"],
                    ["Arresting Station", r.arrestingStation ?? "—"],
                    ["Date Charged", r.dateCharged ?? "—"],
                    ["Charging Authority", r.chargingAuthority ?? "—"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div className="text-xs text-muted-foreground">{k}</div>
                      <div className="font-medium">{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>

            {/* Court & Verdict */}
            <TabsContent value="court" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ["Court Name", r.courtName ?? "—"],
                  ["Case Number", r.caseNumber ?? "—"],
                  ["Verdict", r.verdict ?? "—"],
                  ["Date Convicted", r.dateConvicted ?? "—"],
                  ["Sentence", r.sentence ?? "—"],
                  ["Date Released", r.dateReleased ?? "—"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div className="text-xs text-muted-foreground">{k}</div>
                    <div className={`font-medium capitalize ${k === "Verdict" && v === "convicted" ? "text-red-600" : k === "Verdict" && v === "acquitted" ? "text-green-600" : ""}`}>
                      {v}
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* Warrant */}
            {r.outstandingWarrant && (
              <TabsContent value="warrant" className="mt-4">
                <div className="p-4 bg-red-50 border border-red-200 rounded-md space-y-3">
                  <div className="flex items-center gap-2 text-red-700 font-bold">
                    <AlertTriangle className="w-5 h-5" />
                    Outstanding Warrant Active
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      ["Issued By", r.warrantIssuedBy ?? "—"],
                      ["Issued At", r.warrantIssuedAt ?? "—"],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div className="text-xs text-muted-foreground">{k}</div>
                        <div className="font-medium">{v}</div>
                      </div>
                    ))}
                    {r.warrantDetails && (
                      <div className="col-span-2">
                        <div className="text-xs text-muted-foreground">Details</div>
                        <div className="font-medium mt-1 bg-red-100 rounded p-2">{r.warrantDetails}</div>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>
            )}

            {/* Attachments */}
            <TabsContent value="attachments" className="mt-4">
              {!data?.attachments.length ? (
                <p className="text-muted-foreground text-sm text-center py-6">No attachments</p>
              ) : (
                <div className="space-y-2">
                  {data.attachments.map(a => (
                    <div key={a.attachmentRef} className="flex items-center justify-between p-3 border rounded text-sm">
                      <div>
                        <div className="font-medium">{a.fileName}</div>
                        <div className="text-xs text-muted-foreground capitalize">{a.documentType}</div>
                      </div>
                      <a href={a.fileUrl} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="outline">View</Button>
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Raw Data */}
            {!!r.rawPayload && (
              <TabsContent value="raw" className="mt-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-muted-foreground">Original agency payload</span>
                  <Button size="sm" variant="outline" onClick={copyRaw} className="gap-1">
                    {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <pre className="text-xs bg-muted/60 rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap">
                  {JSON.stringify(r.rawPayload, null, 2)}
                </pre>
              </TabsContent>
            )}
          </Tabs>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
