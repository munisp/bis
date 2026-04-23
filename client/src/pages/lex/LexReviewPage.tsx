import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CheckCircle2, XCircle, AlertTriangle, MapPin, FileText, User, Calendar, Building2, BarChart3, Link2, Sparkles, ExternalLink, Download } from "lucide-react";

const NIGERIAN_STATES = [
  { code: "AB", name: "Abia" }, { code: "AD", name: "Adamawa" }, { code: "AK", name: "Akwa Ibom" },
  { code: "AN", name: "Anambra" }, { code: "BA", name: "Bauchi" }, { code: "BY", name: "Bayelsa" },
  { code: "BE", name: "Benue" }, { code: "BO", name: "Borno" }, { code: "CR", name: "Cross River" },
  { code: "DE", name: "Delta" }, { code: "EB", name: "Ebonyi" }, { code: "ED", name: "Edo" },
  { code: "EK", name: "Ekiti" }, { code: "EN", name: "Enugu" }, { code: "GO", name: "Gombe" },
  { code: "IM", name: "Imo" }, { code: "JI", name: "Jigawa" }, { code: "KD", name: "Kaduna" },
  { code: "KN", name: "Kano" }, { code: "KT", name: "Katsina" }, { code: "KE", name: "Kebbi" },
  { code: "KO", name: "Kogi" }, { code: "KW", name: "Kwara" }, { code: "LA", name: "Lagos" },
  { code: "NA", name: "Nasarawa" }, { code: "NI", name: "Niger" }, { code: "OG", name: "Ogun" },
  { code: "ON", name: "Ondo" }, { code: "OS", name: "Osun" }, { code: "OY", name: "Oyo" },
  { code: "PL", name: "Plateau" }, { code: "RI", name: "Rivers" }, { code: "SO", name: "Sokoto" },
  { code: "TA", name: "Taraba" }, { code: "YO", name: "Yobe" }, { code: "ZA", name: "Zamfara" },
  { code: "FC", name: "FCT Abuja" },
];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  under_review: "bg-blue-100 text-blue-800",
  validated: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  escalated: "bg-purple-100 text-purple-800",
  expunged: "bg-gray-100 text-gray-600",
};

const INCIDENT_LABELS: Record<string, string> = {
  arrest: "Arrest", seizure: "Seizure", witness_statement: "Witness Statement",
  court_order: "Court Order", intel_tip: "Intel Tip", missing_person: "Missing Person",
  homicide: "Homicide", fraud: "Fraud", cybercrime: "Cybercrime", other: "Other",
};

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted-foreground text-xs">—</span>;
  const color = score >= 70 ? "text-green-700 bg-green-100" : score >= 40 ? "text-yellow-700 bg-yellow-100" : "text-red-700 bg-red-100";
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>{score}/100</span>;
}

export default function LexReviewPage() {
  
  const utils = trpc.useUtils();

  const [stateFilter, setStateFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reviewDialog, setReviewDialog] = useState<{ id: number; action: "validate" | "reject" | "escalate" } | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [activeTab, setActiveTab] = useState<"queue" | "stats">("queue");
  const [showCaseLinkDialog, setShowCaseLinkDialog] = useState(false);
  const [caseLinkTarget, setCaseLinkTarget] = useState<number | null>(null);

  const { data: listData, isLoading } = trpc.lex.listSubmissions.useQuery({
    state: stateFilter || undefined,
    status: statusFilter || undefined,
    incidentType: typeFilter || undefined,
    search: search || undefined,
  });

  const { data: detail } = trpc.lex.getSubmission.useQuery(
    { id: selectedId! },
    { enabled: !!selectedId }
  );

  const { data: stats } = trpc.lex.stateStats.useQuery();
  const { data: overdueData } = trpc.lex.overdueSubmissions.useQuery({ hours: 72 });

  // LEX-to-Case auto-linking
  const { data: caseMatches, isLoading: matchesLoading } = trpc.lex.possibleCaseMatches.useQuery(
    { submissionId: selectedId! },
    { enabled: !!selectedId }
  );

  const linkToCaseMutation = trpc.lex.linkToCase.useMutation({
    onSuccess: (result) => {
      utils.lex.listSubmissions.invalidate();
      utils.lex.getSubmission.invalidate({ id: selectedId! });
      setShowCaseLinkDialog(false);
      setCaseLinkTarget(null);
      toast.success(`Submission linked to case ${result.caseRef}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const reviewMutation = trpc.lex.reviewSubmission.useMutation({
    onSuccess: () => {
      utils.lex.listSubmissions.invalidate();
      utils.lex.stateStats.invalidate();
      setReviewDialog(null);
      setRejectionReason("");
      setSelectedId(null);
      toast("Submission reviewed");
    },
    onError: (e) => toast.error(e.message),
  });

  const submissions = listData?.submissions ?? [];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* SLA 72h Alert Banner */}
      {overdueData && overdueData.count > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-800">
              SLA Breach: {overdueData.count} submission{overdueData.count !== 1 ? 's' : ''} pending &gt; 72 hours
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              These submissions require immediate review to comply with the 72-hour SLA policy.
            </p>
          </div>
          <Button size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-100"
            onClick={() => { setStatusFilter('pending'); setActiveTab('queue'); }}>
            View Overdue
          </Button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">LEX Review Queue</h1>
          <p className="text-muted-foreground text-sm mt-1">Review and validate law enforcement incident submissions. Filter by state to see your jurisdiction.</p>
        </div>
        <div className="flex gap-2">
          <Button variant={activeTab === "queue" ? "default" : "outline"} size="sm" onClick={() => setActiveTab("queue")}>
            <FileText className="w-4 h-4 mr-1" /> Queue
          </Button>
          <Button variant={activeTab === "stats" ? "default" : "outline"} size="sm" onClick={() => setActiveTab("stats")}>
            <BarChart3 className="w-4 h-4 mr-1" /> State Stats
          </Button>
        </div>
      </div>

      {activeTab === "stats" ? (
        /* State Statistics */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(stats ?? []).length === 0 ? (
            <Card className="col-span-full">
              <CardContent className="py-12 text-center text-muted-foreground">No submissions yet.</CardContent>
            </Card>
          ) : (stats ?? []).map(s => (
            <Card key={s.state}>
              <CardContent className="py-4 px-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-semibold">{s.stateName}</p>
                    <p className="text-xs text-muted-foreground font-mono">{s.state}</p>
                  </div>
                  <span className="text-2xl font-bold text-slate-700">{s.total}</span>
                </div>
                <div className="flex gap-3 text-xs">
                  <span className="text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded">{s.pending} pending</span>
                  <span className="text-green-700 bg-green-50 px-2 py-0.5 rounded">{s.validated} validated</span>
                  <span className="text-red-700 bg-red-50 px-2 py-0.5 rounded">{s.rejected} rejected</span>
                </div>
                <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden flex">
                  {s.total > 0 && <>
                    <div className="bg-green-400 h-full" style={{ width: `${(s.validated / s.total) * 100}%` }} />
                    <div className="bg-yellow-400 h-full" style={{ width: `${(s.pending / s.total) * 100}%` }} />
                    <div className="bg-red-400 h-full" style={{ width: `${(s.rejected / s.total) * 100}%` }} />
                  </>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        /* Review Queue */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* List */}
          <div className="lg:col-span-2 space-y-4">
            {/* Filters */}
            <div className="flex gap-3 flex-wrap">
              <Input placeholder="Search ref, subject, NIN..." value={search} onChange={e => setSearch(e.target.value)} className="w-48" />
              <Select value={stateFilter} onValueChange={setStateFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="All states" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All states</SelectItem>
                  {NIGERIAN_STATES.map(s => <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="under_review">Under Review</SelectItem>
                  <SelectItem value="validated">Validated</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="escalated">Escalated</SelectItem>
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All types</SelectItem>
                  {Object.entries(INCIDENT_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {isLoading ? (
              <div className="text-muted-foreground text-sm">Loading submissions...</div>
            ) : submissions.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No submissions match the current filters.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {submissions.map(sub => (
                  <Card
                    key={sub.id}
                    className={`cursor-pointer transition-colors ${selectedId === sub.id ? "border-blue-500 bg-blue-50/30" : "hover:bg-muted/30"}`}
                    onClick={() => setSelectedId(sub.id)}
                  >
                    <CardContent className="py-3 px-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-medium">{sub.submissionRef}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[sub.status] ?? ""}`}>{sub.status.replace("_", " ")}</span>
                            <Badge variant="outline" className="text-xs">{INCIDENT_LABELS[sub.incidentType] ?? sub.incidentType}</Badge>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                            {sub.subjectName && <span className="flex items-center gap-1"><User className="w-3 h-3" />{sub.subjectName}</span>}
                            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{NIGERIAN_STATES.find(s => s.code === sub.incidentState)?.name ?? sub.incidentState}</span>
                            {sub.agencyCode && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{sub.agencyCode}</span>}
                            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(sub.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <ScoreBadge score={sub.validationScore} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Detail Panel */}
          <div>
            {selectedId && detail ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-mono">{detail.submission.submissionRef}</CardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[detail.submission.status] ?? ""}`}>{detail.submission.status.replace("_", " ")}</span>
                    <ScoreBadge score={detail.submission.validationScore} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Agency</p>
                    <p className="font-medium">{detail.agency?.name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground font-mono">{detail.agency?.agencyCode}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {NIGERIAN_STATES.find(s => s.code === detail.agency?.state)?.name ?? detail.agency?.state}
                      {detail.agency?.lga ? ` — ${detail.agency.lga}` : ""}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Incident</p>
                    <p><span className="text-muted-foreground">Type:</span> {INCIDENT_LABELS[detail.submission.incidentType] ?? detail.submission.incidentType}</p>
                    <p><span className="text-muted-foreground">State:</span> {NIGERIAN_STATES.find(s => s.code === detail.submission.incidentState)?.name}</p>
                    {detail.submission.incidentLga && <p><span className="text-muted-foreground">LGA:</span> {detail.submission.incidentLga}</p>}
                    {detail.submission.incidentDate && <p><span className="text-muted-foreground">Date:</span> {new Date(detail.submission.incidentDate).toLocaleDateString()}</p>}
                    {detail.submission.gpsLat && <p><span className="text-muted-foreground">GPS:</span> {detail.submission.gpsLat?.toFixed(4)}, {detail.submission.gpsLng?.toFixed(4)}</p>}
                  </div>

                  {detail.submission.subjectName && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</p>
                      <p className="font-medium">{detail.submission.subjectName}</p>
                      {detail.submission.subjectNin && <p className="text-xs text-muted-foreground">NIN: {detail.submission.subjectNin}</p>}
                      {detail.submission.subjectPhone && <p className="text-xs text-muted-foreground">Phone: {detail.submission.subjectPhone}</p>}
                    </div>
                  )}

                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Narrative</p>
                    <p className="text-xs leading-relaxed bg-muted/40 rounded p-2 max-h-32 overflow-y-auto">{detail.submission.narrative}</p>
                  </div>

                  {detail.submission.validationNotes != null && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Validation Notes</p>
                      <div className="text-xs space-y-0.5">
                        {Object.entries(detail.submission.validationNotes as Record<string, string>).map(([k, v]) => (
                          <div key={k} className="flex items-center gap-2">
                            {v === "pass" ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <AlertTriangle className="w-3 h-3 text-yellow-500" />}
                            <span className="text-muted-foreground">{k}:</span>
                            <span>{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* LEX-to-Case Auto-Linking */}
                  {caseMatches && caseMatches.matches.length > 0 && (
                    <div className="space-y-2 pt-2 border-t">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                        <p className="text-xs font-semibold text-amber-700">Possible Case Matches</p>
                        <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">{caseMatches.matches.length}</Badge>
                      </div>
                      <div className="space-y-1.5">
                        {caseMatches.matches.map((m) => (
                          <div key={m.caseId} className="flex items-start justify-between gap-2 bg-amber-50 border border-amber-200 rounded p-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-mono font-semibold text-amber-800">{m.caseRef}</p>
                              <p className="text-xs text-amber-700 truncate">{m.caseTitle}</p>
                              <div className="flex items-center gap-1 mt-0.5">
                                <span className="text-xs text-muted-foreground">{m.matchType === 'nin_exact' ? 'NIN match' : m.matchType === 'phone_exact' ? 'Phone match' : 'Name similarity'}</span>
                                <span className="text-xs font-semibold text-amber-700">{m.confidence}%</span>
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs border-amber-400 text-amber-800 hover:bg-amber-100 shrink-0"
                              onClick={() => { setCaseLinkTarget(m.caseId); setShowCaseLinkDialog(true); }}
                            >
                              <Link2 className="w-3 h-3 mr-1" /> Link
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {matchesLoading && selectedId && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t">
                      <Sparkles className="w-3.5 h-3.5 animate-pulse" /> Checking for case matches...
                    </div>
                  )}
                  {/* LEX-01 PDF Download */}
                  {detail.submission.status === "validated" && (
                    <div className="pt-2 border-t">
                      <a
                        href={`/api/trpc/lex.generateLex01Pdf?input=${encodeURIComponent(JSON.stringify({ id: detail.submission.id }))}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs text-blue-600 hover:text-blue-700 font-medium"
                      >
                        <Download className="w-3.5 h-3.5" /> Download LEX-01 PDF
                      </a>
                    </div>
                  )}
                  {/* Review Actions */}
                  {(detail.submission.status === "pending" || detail.submission.status === "under_review") && (
                    <div className="flex flex-col gap-2 pt-2 border-t">
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => setReviewDialog({ id: detail.submission.id, action: "validate" })}>
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Validate
                      </Button>
                      <Button size="sm" variant="outline" className="text-purple-700 border-purple-300" onClick={() => setReviewDialog({ id: detail.submission.id, action: "escalate" })}>
                        <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Escalate
                      </Button>
                      <Button size="sm" variant="outline" className="text-red-700 border-red-300" onClick={() => setReviewDialog({ id: detail.submission.id, action: "reject" })}>
                        <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground text-sm">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  Select a submission to review
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Case Link Confirmation Dialog */}
      <Dialog open={showCaseLinkDialog} onOpenChange={(open) => { if (!open) { setShowCaseLinkDialog(false); setCaseLinkTarget(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-amber-600" /> Link to Case
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              This will link submission <span className="font-mono font-semibold">{detail?.submission.submissionRef}</span> to the selected case.
              A timeline entry will be added to the case record.
            </p>
            {caseLinkTarget && caseMatches?.matches.find(m => m.caseId === caseLinkTarget) && (
              <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm">
                <p className="font-mono font-semibold text-amber-800">{caseMatches.matches.find(m => m.caseId === caseLinkTarget)?.caseRef}</p>
                <p className="text-amber-700">{caseMatches.matches.find(m => m.caseId === caseLinkTarget)?.caseTitle}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCaseLinkDialog(false); setCaseLinkTarget(null); }}>Cancel</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700"
              disabled={linkToCaseMutation.isPending || !caseLinkTarget}
              onClick={() => {
                if (!selectedId || !caseLinkTarget) return;
                linkToCaseMutation.mutate({ submissionId: selectedId, caseId: caseLinkTarget });
              }}
            >
              {linkToCaseMutation.isPending ? "Linking..." : "Confirm Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Confirmation Dialog */}
      <Dialog open={!!reviewDialog} onOpenChange={() => { setReviewDialog(null); setRejectionReason(""); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {reviewDialog?.action === "validate" ? "Validate Submission" : reviewDialog?.action === "reject" ? "Reject Submission" : "Escalate Submission"}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            {reviewDialog?.action === "validate" && (
              <p className="text-sm text-muted-foreground">This will mark the submission as validated and make it available for case linkage. This action is logged in the audit trail.</p>
            )}
            {reviewDialog?.action === "escalate" && (
              <p className="text-sm text-muted-foreground">This will escalate the submission to a supervisor for a second opinion. The submitter's reputation score will not be affected.</p>
            )}
            {reviewDialog?.action === "reject" && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Provide a reason for rejection. This will reduce the submitter's reputation score by 15 points.</p>
                <div>
                  <Label>Rejection Reason *</Label>
                  <Textarea value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} rows={3} placeholder="e.g. Insufficient evidence, duplicate submission, jurisdiction mismatch..." />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReviewDialog(null); setRejectionReason(""); }}>Cancel</Button>
            <Button
              disabled={reviewDialog?.action === "reject" && !rejectionReason.trim() || reviewMutation.isPending}
              className={reviewDialog?.action === "validate" ? "bg-green-600 hover:bg-green-700" : reviewDialog?.action === "reject" ? "bg-red-600 hover:bg-red-700" : ""}
              onClick={() => {
                if (!reviewDialog) return;
                reviewMutation.mutate({ id: reviewDialog.id, action: reviewDialog.action, rejectionReason: rejectionReason || undefined });
              }}
            >
              {reviewMutation.isPending ? "Processing..." : `Confirm ${reviewDialog?.action}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
