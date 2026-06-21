// NewInvestigationSlideOver — slide-over panel for creating a new investigation
// Design: Dark forensic intelligence theme, JetBrains Mono typography
// Fields: subject type, tier, country, identifiers, purpose, priority, data sources

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  X, Loader2, User, Building2, Shield, Globe, ChevronRight,
  DollarSign, AlertTriangle, Fingerprint, Search, CheckCircle2,
  FileText, Users, Database, Zap
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (ref: string) => void;
}

const TIERS = [
  {
    id: "basic",
    label: "Basic",
    price: "$25",
    eta: "24–48 hrs",
    description: "Identity verification, criminal record check, address confirmation",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10 border-emerald-400/30",
  },
  {
    id: "standard",
    label: "Standard",
    price: "$75",
    eta: "3–5 days",
    description: "Basic + employment history, financial sanctions, social media scan",
    color: "text-amber-400",
    bg: "bg-amber-400/10 border-amber-400/30",
  },
  {
    id: "comprehensive",
    label: "Comprehensive",
    price: "$150",
    eta: "7–10 days",
    description: "Standard + deep web, field agent verification, community vouching",
    color: "text-red-400",
    bg: "bg-red-400/10 border-red-400/30",
  },
];

const SUBJECT_TYPES = [
  { id: "individual", label: "Individual", icon: <User size={14} /> },
  { id: "corporate", label: "Corporate Entity", icon: <Building2 size={14} /> },
  { id: "government", label: "Government Agency", icon: <Shield size={14} /> },
  { id: "ngo", label: "NGO / Non-Profit", icon: <Globe size={14} /> },
];

const COUNTRIES = [
  "Nigeria", "Ghana", "Kenya", "South Africa", "Ethiopia", "Tanzania",
  "Uganda", "Rwanda", "Senegal", "Côte d'Ivoire", "Cameroon", "Egypt",
  "United Kingdom", "United States", "Canada", "Germany", "France",
];

const DATA_SOURCES = [
  { id: "nimc", label: "NIMC — National ID", group: "Government" },
  { id: "bvn", label: "BVN — Bank Verification", group: "Government" },
  { id: "npf", label: "NPF — Police Records", group: "Government" },
  { id: "efcc", label: "EFCC — Financial Crimes", group: "Government" },
  { id: "icpc", label: "ICPC — Corruption", group: "Government" },
  { id: "cac", label: "CAC — Corporate Affairs", group: "Government" },
  { id: "frsc", label: "FRSC — Driver Records", group: "Government" },
  { id: "firs", label: "FIRS — Tax Records", group: "Government" },
  { id: "social", label: "Social Media Scan", group: "Digital" },
  { id: "darkweb", label: "Dark Web Monitor", group: "Digital" },
  { id: "field_agent", label: "Field Agent Verification", group: "Physical" },
  { id: "community", label: "Community Vouching", group: "Physical" },
];

const PRIORITIES = [
  { id: "low", label: "Low", color: "text-muted-foreground" },
  { id: "normal", label: "Normal", color: "text-blue-400" },
  { id: "high", label: "High", color: "text-amber-400" },
  { id: "urgent", label: "Urgent", color: "text-red-400" },
];

export default function NewInvestigationSlideOver({ open, onClose, onCreated }: Props) {
  const [step, setStep] = useState(1);
  const utils = trpc.useUtils();
  const createMutation = trpc.investigations.create.useMutation({
    onSuccess: (data) => {
      toast.success(`Investigation ${data.ref} created`, {
        description: `Subject queued for processing`,
      });
      utils.investigations.list.invalidate();
      utils.dashboard.stats.invalidate();
      onCreated?.(data.ref);
      onClose();
      setStep(1);
      setForm({
        subjectName: "", subjectType: "individual", tier: "standard",
        country: "Nigeria", nin: "", bvn: "", rcNumber: "", phone: "",
        email: "", dob: "", address: "", purpose: "", priority: "normal",
        dataSources: ["nimc", "bvn", "npf", "social"], notes: "",
      });
    },
    onError: (err) => {
      toast.error("Failed to create investigation", { description: err.message });
    },
  });
  const [form, setForm] = useState({
    subjectName: "",
    subjectType: "individual",
    tier: "standard",
    country: "Nigeria",
    nin: "",
    bvn: "",
    rcNumber: "",
    phone: "",
    email: "",
    dob: "",
    address: "",
    purpose: "",
    priority: "normal",
    dataSources: ["nimc", "bvn", "npf", "social"],
    notes: "",
  });

  const set = (k: string, v: string | string[]) => setForm(p => ({ ...p, [k]: v }));

  const toggleSource = (id: string) => {
    set("dataSources", form.dataSources.includes(id)
      ? form.dataSources.filter(s => s !== id)
      : [...form.dataSources, id]);
  };

  const handleCreate = async () => {
    if (!form.subjectName.trim()) { toast.error("Subject name is required"); return; }
    if (!form.purpose.trim()) { toast.error("Purpose / reason is required"); return; }
    createMutation.mutate({
      subjectName: form.subjectName,
      subjectType: (form.subjectType === "government" || form.subjectType === "ngo") ? "individual" : form.subjectType as "individual" | "corporate",
      tier: form.tier as "basic" | "standard" | "comprehensive",
      country: form.country,
      priority: (form.priority === "normal" ? "medium" : form.priority === "urgent" ? "critical" : form.priority) as "low" | "medium" | "high" | "critical",
      purpose: form.purpose || undefined,
      nin: form.nin || undefined,
      bvn: form.bvn || undefined,
      rcNumber: form.rcNumber || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      address: form.address || undefined,
      dataSources: form.dataSources,
    });
  };

  const selectedTier = TIERS.find(t => t.id === form.tier)!;

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-xl z-50 flex flex-col bg-[var(--color-surface)] border-l border-border shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-[var(--color-surface)]">
          <div>
            <h2 className="text-sm font-semibold text-foreground font-mono tracking-wide">NEW INVESTIGATION</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Step {step} of 3 — {step === 1 ? "Subject & Tier" : step === 2 ? "Identifiers" : "Sources & Notes"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Step indicators */}
            <div className="flex items-center gap-1.5">
              {[1, 2, 3].map(s => (
                <div
                  key={s}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    s === step ? "w-6 bg-primary" : s < step ? "w-3 bg-primary/60" : "w-3 bg-muted"
                  )}
                />
              ))}
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* ── STEP 1: Subject & Tier ── */}
          {step === 1 && (
            <>
              {/* Subject Name */}
              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Subject Name *</Label>
                <Input
                  placeholder="Full legal name or registered company name"
                  value={form.subjectName}
                  onChange={e => set("subjectName", e.target.value)}
                  className="font-mono text-sm"
                  autoFocus
                />
              </div>

              {/* Subject Type */}
              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Subject Type</Label>
                <div className="grid grid-cols-2 gap-2">
                  {SUBJECT_TYPES.map(t => (
                    <button
                      key={t.id}
                      onClick={() => set("subjectType", t.id)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2.5 rounded-md border text-sm transition-all text-left",
                        form.subjectType === t.id
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-muted/20 text-muted-foreground hover:border-border/80 hover:text-foreground"
                      )}
                    >
                      {t.icon}
                      <span className="font-mono text-xs">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Country */}
              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Country</Label>
                <Select value={form.country} onValueChange={v => set("country", v)}>
                  <SelectTrigger className="font-mono text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Tier Selection */}
              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Investigation Tier</Label>
                <div className="space-y-2">
                  {TIERS.map(t => (
                    <button
                      key={t.id}
                      onClick={() => set("tier", t.id)}
                      className={cn(
                        "w-full flex items-start gap-3 px-4 py-3 rounded-md border text-left transition-all",
                        form.tier === t.id
                          ? `border-current ${t.bg}`
                          : "border-border bg-muted/10 hover:bg-muted/20"
                      )}
                    >
                      <div className={cn("mt-0.5 w-3 h-3 rounded-full border-2 flex-shrink-0 transition-all",
                        form.tier === t.id ? `border-current bg-current ${t.color}` : "border-muted-foreground"
                      )} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={cn("font-mono font-semibold text-sm", form.tier === t.id ? t.color : "text-foreground")}>
                            {t.label}
                          </span>
                          <span className={cn("font-mono text-sm font-bold", t.color)}>{t.price}</span>
                          <span className="text-xs text-muted-foreground ml-auto">{t.eta}</span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">{t.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Priority */}
              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Priority</Label>
                <div className="flex gap-2">
                  {PRIORITIES.map(p => (
                    <button
                      key={p.id}
                      onClick={() => set("priority", p.id)}
                      className={cn(
                        "flex-1 py-1.5 rounded-md border text-xs font-mono transition-all",
                        form.priority === p.id
                          ? "border-current bg-current/10 " + p.color
                          : "border-border text-muted-foreground hover:border-border/80"
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── STEP 2: Identifiers ── */}
          {step === 2 && (
            <>
              <p className="text-xs text-muted-foreground font-mono">
                Provide any available identifiers. All fields are optional but improve match accuracy.
              </p>

              {(form.subjectType === "individual" || form.subjectType === "government") && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">NIN</Label>
                      <Input placeholder="11-digit NIN" value={form.nin}
                        onChange={e => set("nin", e.target.value)} className="font-mono text-sm" maxLength={11} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">BVN</Label>
                      <Input placeholder="11-digit BVN" value={form.bvn}
                        onChange={e => set("bvn", e.target.value)} className="font-mono text-sm" maxLength={11} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Date of Birth</Label>
                      <Input type="date" value={form.dob}
                        onChange={e => set("dob", e.target.value)} className="font-mono text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Phone</Label>
                      <Input placeholder="+234 80X XXX XXXX" value={form.phone}
                        onChange={e => set("phone", e.target.value)} className="font-mono text-sm" />
                    </div>
                  </div>
                </>
              )}

              {(form.subjectType === "corporate" || form.subjectType === "ngo") && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">RC Number (CAC)</Label>
                  <Input placeholder="RC-XXXXXXX" value={form.rcNumber}
                    onChange={e => set("rcNumber", e.target.value)} className="font-mono text-sm" />
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Email</Label>
                <Input type="email" placeholder="subject@example.com" value={form.email}
                  onChange={e => set("email", e.target.value)} className="font-mono text-sm" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Last Known Address</Label>
                <Textarea placeholder="Street, City, State, Country" rows={2} value={form.address}
                  onChange={e => set("address", e.target.value)} className="font-mono text-sm resize-none" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Purpose / Reason *</Label>
                <Select value={form.purpose} onValueChange={v => set("purpose", v)}>
                  <SelectTrigger className="font-mono text-sm">
                    <SelectValue placeholder="Select purpose..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employment">Pre-Employment Screening</SelectItem>
                    <SelectItem value="tenant">Tenant Background Check</SelectItem>
                    <SelectItem value="vendor">Vendor / Supplier Due Diligence</SelectItem>
                    <SelectItem value="partner">Business Partner Verification</SelectItem>
                    <SelectItem value="loan">Loan / Credit Application</SelectItem>
                    <SelectItem value="kyc">KYC / AML Compliance</SelectItem>
                    <SelectItem value="investment">Investment Due Diligence</SelectItem>
                    <SelectItem value="legal">Legal / Court Proceeding</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {/* ── STEP 3: Data Sources & Notes ── */}
          {step === 3 && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  Data Sources ({form.dataSources.length} selected)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Select which sources to query. Tier determines which sources are available.
                </p>
                {["Government", "Digital", "Physical"].map(group => (
                  <div key={group} className="mt-3">
                    <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest mb-1.5">{group}</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {DATA_SOURCES.filter(s => s.group === group).map(src => {
                        const isPhysical = src.group === "Physical";
                        const disabled = isPhysical && form.tier === "basic";
                        const checked = form.dataSources.includes(src.id);
                        return (
                          <button
                            key={src.id}
                            onClick={() => !disabled && toggleSource(src.id)}
                            disabled={disabled}
                            className={cn(
                              "flex items-center gap-2 px-3 py-2 rounded-md border text-xs font-mono text-left transition-all",
                              disabled ? "opacity-30 cursor-not-allowed border-border/30 text-muted-foreground" :
                              checked ? "border-primary bg-primary/10 text-primary" :
                              "border-border bg-muted/10 text-muted-foreground hover:border-border/60 hover:text-foreground"
                            )}
                          >
                            <div className={cn(
                              "w-3 h-3 rounded-sm border flex-shrink-0 flex items-center justify-center",
                              checked && !disabled ? "bg-primary border-primary" : "border-muted-foreground"
                            )}>
                              {checked && !disabled && <CheckCircle2 size={8} className="text-primary-foreground" />}
                            </div>
                            <span className="truncate">{src.label}</span>
                            {disabled && <span className="ml-auto text-[9px]">Std+</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Additional Notes</Label>
                <Textarea
                  placeholder="Special instructions, context, or flags for the investigation team..."
                  rows={4}
                  value={form.notes}
                  onChange={e => set("notes", e.target.value)}
                  className="font-mono text-sm resize-none"
                />
              </div>

              {/* Summary card */}
              <div className={cn("rounded-md border p-4 space-y-2", selectedTier.bg)}>
                <p className="text-xs font-mono font-semibold text-foreground uppercase tracking-wider">Order Summary</p>
                <div className="grid grid-cols-2 gap-y-1 text-xs font-mono">
                  <span className="text-muted-foreground">Subject</span>
                  <span className="text-foreground truncate">{form.subjectName || "—"}</span>
                  <span className="text-muted-foreground">Type</span>
                  <span className="text-foreground capitalize">{form.subjectType}</span>
                  <span className="text-muted-foreground">Country</span>
                  <span className="text-foreground">{form.country}</span>
                  <span className="text-muted-foreground">Tier</span>
                  <span className={cn("font-bold", selectedTier.color)}>{selectedTier.label} — {selectedTier.price}</span>
                  <span className="text-muted-foreground">ETA</span>
                  <span className="text-foreground">{selectedTier.eta}</span>
                  <span className="text-muted-foreground">Sources</span>
                  <span className="text-foreground">{form.dataSources.length} queued</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-[var(--color-surface)] flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => step > 1 ? setStep(s => s - 1) : onClose()}
            className="font-mono text-xs"
          >
            {step > 1 ? "← Back" : "Cancel"}
          </Button>

          <div className="flex items-center gap-2">
            {step < 3 ? (
              <Button
                size="sm"
                onClick={() => setStep(s => s + 1)}
                disabled={step === 1 && !form.subjectName.trim()}
                className="font-mono text-xs gap-1.5"
              >
                Continue <ChevronRight size={12} />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={createMutation.isPending || !form.purpose}
                className="font-mono text-xs gap-1.5 min-w-36"
              >
                {createMutation.isPending ? (
                  <><Loader2 size={12} className="animate-spin" /> Creating...</>
                ) : (
                  <><Zap size={12} /> Launch Investigation</>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
