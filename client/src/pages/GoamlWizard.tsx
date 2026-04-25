/**
 * GoamlWizard.tsx — goAML STR/CTR/SAR Filing Wizard
 * Multi-step form for creating and submitting Suspicious Transaction Reports
 * to the NFIU via the goAML system.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText, Send, Plus, Search, Eye, Trash2, Download,
  CheckCircle2, Clock, XCircle, AlertTriangle, ChevronRight,
  ChevronLeft, Shield
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

const SUSPICIOUS_CATEGORIES = [
  "Structuring / Smurfing",
  "Unusual cash transactions",
  "Transactions inconsistent with customer profile",
  "Politically Exposed Person (PEP) activity",
  "Sanctions list match",
  "Terrorist financing indicators",
  "Proliferation financing",
  "Real estate money laundering",
  "Trade-based money laundering",
  "Cyber-enabled fraud",
  "Ponzi / investment fraud",
  "Human trafficking proceeds",
  "Drug trafficking proceeds",
  "Bribery and corruption",
  "Tax evasion indicators",
  "Other suspicious activity",
];

const NIGERIAN_BANKS = [
  "Access Bank", "Zenith Bank", "GTBank", "First Bank", "UBA",
  "Stanbic IBTC", "Fidelity Bank", "Union Bank", "Sterling Bank",
  "Polaris Bank", "Wema Bank", "FCMB", "Keystone Bank", "Ecobank",
  "Citibank Nigeria", "Standard Chartered", "Heritage Bank", "Jaiz Bank",
  "Kuda Bank", "OPay", "Moniepoint", "PalmPay", "Other",
];

type WizardStep = "type" | "subject" | "transaction" | "narrative" | "review";

interface FormData {
  reportType: "STR" | "CTR" | "SAR";
  investigationRef: string;
  subjectName: string;
  subjectBvn: string;
  subjectNin: string;
  subjectAccountNumber: string;
  subjectBank: string;
  transactionDate: string;
  transactionAmount: string;
  transactionCurrency: string;
  suspiciousActivity: string;
  narrativeDetails: string;
}

const INITIAL_FORM: FormData = {
  reportType: "STR",
  investigationRef: "",
  subjectName: "",
  subjectBvn: "",
  subjectNin: "",
  subjectAccountNumber: "",
  subjectBank: "",
  transactionDate: "",
  transactionAmount: "",
  transactionCurrency: "NGN",
  suspiciousActivity: "",
  narrativeDetails: "",
};

const STEPS: WizardStep[] = ["type", "subject", "transaction", "narrative", "review"];

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    draft:          { label: "Draft",          color: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",   icon: <Clock size={10} /> },
    submitted:      { label: "Submitted",      color: "bg-blue-500/20 text-blue-300 border-blue-500/30",   icon: <Send size={10} /> },
    accepted:       { label: "Accepted",       color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", icon: <CheckCircle2 size={10} /> },
    rejected:       { label: "Rejected",       color: "bg-red-500/20 text-red-300 border-red-500/30",      icon: <XCircle size={10} /> },
    pending_review: { label: "Pending Review", color: "bg-amber-500/20 text-amber-300 border-amber-500/30", icon: <AlertTriangle size={10} /> },
  };
  const c = cfg[status] ?? cfg.draft;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${c.color}`}>
      {c.icon}{c.label}
    </span>
  );
}

// ─── Wizard Form ──────────────────────────────────────────────────────────────

function WizardForm({ onSuccess }: { onSuccess: () => void }) {
  const [step, setStep] = useState<WizardStep>("type");
  const [form, setForm] = useState<FormData>(INITIAL_FORM);

  const createMutation = trpc.goaml.create.useMutation({
    onSuccess: (data) => {
      toast.success(`STR draft created — ${data.filingRef}`);
      onSuccess();
    },
    onError: (e) => toast.error(e.message),
  });

  const set = (field: keyof FormData, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const stepIndex = STEPS.indexOf(step);
  const canNext = () => {
    if (step === "type") return true;
    if (step === "subject") return form.subjectName.trim().length >= 2;
    if (step === "transaction") return true;
    if (step === "narrative") return form.suspiciousActivity.trim().length >= 10;
    return true;
  };

  const handleSubmit = () => {
    createMutation.mutate({
      reportType: form.reportType,
      investigationRef: form.investigationRef || undefined,
      subjectName: form.subjectName,
      subjectBvn: form.subjectBvn || undefined,
      subjectNin: form.subjectNin || undefined,
      subjectAccountNumber: form.subjectAccountNumber || undefined,
      subjectBank: form.subjectBank || undefined,
      transactionDate: form.transactionDate ? new Date(form.transactionDate) : undefined,
      transactionAmount: form.transactionAmount ? parseFloat(form.transactionAmount) : undefined,
      transactionCurrency: form.transactionCurrency,
      suspiciousActivity: form.suspiciousActivity,
      narrativeDetails: form.narrativeDetails || undefined,
    });
  };

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono font-bold border transition-all ${
              i < stepIndex ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300" :
              i === stepIndex ? "bg-blue-500/20 border-blue-500/50 text-blue-300" :
              "bg-muted/30 border-border text-muted-foreground"
            }`}>{i + 1}</div>
            {i < STEPS.length - 1 && <div className={`h-px w-8 ${i < stepIndex ? "bg-emerald-500/50" : "bg-border"}`} />}
          </div>
        ))}
        <span className="ml-3 text-xs font-mono text-muted-foreground capitalize">{step}</span>
      </div>

      {/* Step 1: Report type */}
      {step === "type" && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Select Report Type</h3>
          <div className="grid grid-cols-3 gap-3">
            {(["STR", "CTR", "SAR"] as const).map(t => (
              <button
                key={t}
                onClick={() => set("reportType", t)}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  form.reportType === t ? "border-blue-500/60 bg-blue-500/10" : "border-border hover:border-border/80"
                }`}
              >
                <div className="text-lg font-mono font-bold text-foreground">{t}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {t === "STR" && "Suspicious Transaction Report"}
                  {t === "CTR" && "Cash Transaction Report (≥₦5M)"}
                  {t === "SAR" && "Suspicious Activity Report"}
                </div>
              </button>
            ))}
          </div>
          <div>
            <label className="text-xs font-mono text-muted-foreground mb-1 block">Linked Investigation Ref (optional)</label>
            <Input
              value={form.investigationRef}
              onChange={e => set("investigationRef", e.target.value)}
              placeholder="BIS-2026-XXXX"
              className="font-mono text-sm"
            />
          </div>
        </div>
      )}

      {/* Step 2: Subject */}
      {step === "subject" && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Subject Information</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-mono text-muted-foreground mb-1 block">Full Name *</label>
              <Input value={form.subjectName} onChange={e => set("subjectName", e.target.value)} placeholder="Subject full name" />
            </div>
            <div>
              <label className="text-xs font-mono text-muted-foreground mb-1 block">BVN</label>
              <Input value={form.subjectBvn} onChange={e => set("subjectBvn", e.target.value)} placeholder="22-digit BVN" maxLength={22} className="font-mono" />
            </div>
            <div>
              <label className="text-xs font-mono text-muted-foreground mb-1 block">NIN</label>
              <Input value={form.subjectNin} onChange={e => set("subjectNin", e.target.value)} placeholder="11-digit NIN" maxLength={11} className="font-mono" />
            </div>
            <div>
              <label className="text-xs font-mono text-muted-foreground mb-1 block">Account Number</label>
              <Input value={form.subjectAccountNumber} onChange={e => set("subjectAccountNumber", e.target.value)} placeholder="10-digit NUBAN" maxLength={10} className="font-mono" />
            </div>
            <div>
              <label className="text-xs font-mono text-muted-foreground mb-1 block">Bank</label>
              <Select value={form.subjectBank} onValueChange={v => set("subjectBank", v)}>
                <SelectTrigger><SelectValue placeholder="Select bank" /></SelectTrigger>
                <SelectContent>
                  {NIGERIAN_BANKS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Transaction */}
      {step === "transaction" && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Transaction Details</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-mono text-muted-foreground mb-1 block">Transaction Date</label>
              <Input type="date" value={form.transactionDate} onChange={e => set("transactionDate", e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-mono text-muted-foreground mb-1 block">Currency</label>
              <Select value={form.transactionCurrency} onValueChange={v => set("transactionCurrency", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["NGN", "USD", "GBP", "EUR", "CNY"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-mono text-muted-foreground mb-1 block">Transaction Amount</label>
              <Input
                type="number"
                value={form.transactionAmount}
                onChange={e => set("transactionAmount", e.target.value)}
                placeholder="0.00"
                className="font-mono"
              />
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Narrative */}
      {step === "narrative" && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Suspicious Activity &amp; Narrative</h3>
          <div>
            <label className="text-xs font-mono text-muted-foreground mb-1 block">Suspicious Activity Category *</label>
            <Select value={form.suspiciousActivity} onValueChange={v => set("suspiciousActivity", v)}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {SUSPICIOUS_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-mono text-muted-foreground mb-1 block">Detailed Narrative</label>
            <Textarea
              value={form.narrativeDetails}
              onChange={e => set("narrativeDetails", e.target.value)}
              placeholder="Describe the suspicious activity in detail — include dates, amounts, parties involved, and why the activity is suspicious..."
              rows={6}
              className="text-sm"
            />
          </div>
        </div>
      )}

      {/* Step 5: Review */}
      {step === "review" && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Review &amp; Submit</h3>
          <div className="bg-muted/20 rounded-xl border border-border p-4 space-y-3 text-sm font-mono">
            <div className="flex justify-between"><span className="text-muted-foreground">Report Type</span><span>{form.reportType}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Subject</span><span>{form.subjectName}</span></div>
            {form.subjectBvn && <div className="flex justify-between"><span className="text-muted-foreground">BVN</span><span>{form.subjectBvn}</span></div>}
            {form.subjectBank && <div className="flex justify-between"><span className="text-muted-foreground">Bank</span><span>{form.subjectBank}</span></div>}
            {form.transactionAmount && <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span>{form.transactionCurrency} {parseFloat(form.transactionAmount).toLocaleString()}</span></div>}
            <div className="flex justify-between"><span className="text-muted-foreground">Activity</span><span className="text-right max-w-48 truncate">{form.suspiciousActivity}</span></div>
          </div>
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <AlertTriangle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-300">
              Submitting a false or misleading STR is a criminal offence under the MLPPA 2022. 
              This report will be saved as a <strong>draft</strong> — you can review the generated XML before submitting to NFIU.
            </p>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setStep(STEPS[stepIndex - 1])}
          disabled={stepIndex === 0}
          className="gap-1"
        >
          <ChevronLeft size={14} /> Back
        </Button>
        {step !== "review" ? (
          <Button
            size="sm"
            onClick={() => setStep(STEPS[stepIndex + 1])}
            disabled={!canNext()}
            className="gap-1"
          >
            Next <ChevronRight size={14} />
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <FileText size={14} /> Save Draft
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GoamlWizard() {
  const [showWizard, setShowWizard] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  const { data: filings, isLoading } = trpc.goaml.list.useQuery({
    status: statusFilter !== "all" ? (statusFilter as any) : undefined,
    search: search || undefined,
    limit: 50,
  });

  const { data: stats } = trpc.goaml.stats.useQuery();
  const { data: overdueData } = trpc.goaml.getOverdue.useQuery({ limit: 5 }, { refetchInterval: 60000 });

  const submitMutation = trpc.goaml.submit.useMutation({
    onSuccess: (data) => {
      toast.success(`Filed with NFIU — Ref: ${data.goamlReferenceNumber}`);
      utils.goaml.list.invalidate();
      utils.goaml.stats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.goaml.delete.useMutation({
    onSuccess: () => {
      toast.success("Draft deleted");
      utils.goaml.list.invalidate();
      utils.goaml.stats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const { data: xmlData } = trpc.goaml.getXml.useQuery(
    { id: selectedId! },
    { enabled: selectedId !== null }
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield size={18} className="text-primary" />
            <h1 className="text-xl font-mono font-bold text-foreground">goAML STR Wizard</h1>
            <Badge variant="outline" className="text-[10px] font-mono border-amber-500/40 text-amber-400">NFIU</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            File Suspicious Transaction Reports with the Nigerian Financial Intelligence Unit
          </p>
        </div>
        <Button onClick={() => setShowWizard(true)} className="gap-2">
          <Plus size={14} /> New Filing
        </Button>
      </div>

      {/* goAML Deadline Alert — 72h NFIU requirement */}
      {overdueData && overdueData.count > 0 && (
        <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-300">
                {overdueData.count} draft filing{overdueData.count > 1 ? 's' : ''} breaching the 72-hour NFIU deadline
              </p>
              <div className="mt-2 space-y-1">
                {overdueData.overdue.map((f: any) => (
                  <div key={f.filingRef} className="flex items-center gap-2 text-xs">
                    <Clock size={11} className="text-red-400 flex-shrink-0" />
                    <span className="font-mono text-red-300">{f.filingRef}</span>
                    <span className="text-muted-foreground truncate max-w-[160px]">{f.subjectName}</span>
                    <span className="text-red-400 font-semibold flex-shrink-0">{f.hoursOverdue}h overdue</span>
                    <button
                      onClick={() => submitMutation.mutate({ id: f.id })}
                      disabled={submitMutation.isPending}
                      className="text-xs text-red-300 hover:text-red-100 underline flex-shrink-0"
                    >
                      File Now →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: "Total", value: stats.total, color: "text-foreground" },
            { label: "Drafts", value: stats.drafts, color: "text-zinc-400" },
            { label: "Submitted", value: stats.submitted, color: "text-blue-400" },
            { label: "Accepted", value: stats.accepted, color: "text-emerald-400" },
            { label: "Rejected", value: stats.rejected, color: "text-red-400" },
          ].map(s => (
            <Card key={s.label} className="bg-card/50">
              <CardContent className="p-4">
                <div className={`text-2xl font-mono font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by subject name..."
            className="pl-8 text-sm"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="pending_review">Pending Review</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Filings table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono">STR Filings</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading filings...</div>
          ) : !filings?.length ? (
            <div className="p-12 text-center">
              <Shield size={32} className="mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No filings yet. Click <strong>New Filing</strong> to create your first STR.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filings.map(f => (
                <div key={f.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/10 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-semibold text-primary">{f.filingRef}</span>
                      <StatusBadge status={f.status} />
                      <span className="text-[10px] font-mono text-muted-foreground/60 border border-border rounded px-1">{f.reportType}</span>
                    </div>
                    <div className="text-sm text-foreground mt-0.5 truncate">{f.subjectName}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {f.subjectBank && <span>{f.subjectBank} · </span>}
                      {f.transactionAmount && <span>₦{f.transactionAmount.toLocaleString()} · </span>}
                      {new Date(f.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  {f.goamlReferenceNumber && (
                    <div className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-2 py-0.5">
                      {f.goamlReferenceNumber}
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="View XML"
                      onClick={() => setSelectedId(selectedId === f.id ? null : f.id)}
                    >
                      <Eye size={13} />
                    </Button>
                    {f.status === "draft" && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-blue-400 hover:text-blue-300"
                          title="Submit to NFIU"
                          onClick={() => submitMutation.mutate({ id: f.id })}
                          disabled={submitMutation.isPending}
                        >
                          <Send size={13} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-400 hover:text-red-300"
                          title="Delete draft"
                          onClick={() => deleteMutation.mutate({ id: f.id })}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* XML Preview */}
      {selectedId !== null && xmlData && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-mono">goAML XML — {xmlData.filingRef}</CardTitle>
              <Button
                variant="outline"
                size="sm"
                className="gap-1 text-xs"
                onClick={() => {
                  const blob = new Blob([xmlData.xml ?? ""], { type: "application/xml" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${xmlData.filingRef}.xml`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download size={12} /> Download XML
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="text-[11px] font-mono text-emerald-300 bg-black/40 rounded-lg p-4 overflow-x-auto max-h-80 overflow-y-auto leading-relaxed">
              {xmlData.xml}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Wizard Modal */}
      {showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-mono flex items-center gap-2">
                  <Shield size={16} className="text-primary" />
                  New STR Filing
                </CardTitle>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowWizard(false)}>
                  ×
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <WizardForm onSuccess={() => {
                setShowWizard(false);
                utils.goaml.list.invalidate();
                utils.goaml.stats.invalidate();
              }} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
