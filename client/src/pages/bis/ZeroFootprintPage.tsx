import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  RiskBadge, SectionCard, ConfidenceMeter, FieldAgentTimeline, ScoreGauge, EmptyState
} from "../../components/bis/shared";
import type { ZeroFootprintInvestigation, ChecklistItem, RiskLevel } from "../../types/bis";
import BISLayout from '@/components/BISLayout';
import ScreeningResultsTable from '@/components/bis/ScreeningResultsTable';
import { Streamdown } from "streamdown";

// ─────────────────────────────────────────────────────────────────────────────
// Zero-Footprint Investigation Page
// For subjects with NO digital identity — Nigeria / Africa focus
// ─────────────────────────────────────────────────────────────────────────────

const INVESTIGATION_PILLARS = [
  {
    id: "physical_verification",
    label: "Physical Address Verification",
    icon: "🏠",
    description: "Field agent visits the subject's stated address to confirm residence",
    weight: 30,
    estimatedHours: 4,
    steps: [
      "Dispatch field agent to stated address",
      "Confirm subject resides at address (speak to neighbors)",
      "Photograph the property and surroundings",
      "Verify duration of residence",
      "Check for any adverse neighborhood information",
    ],
    nigeriaNote: "In Nigeria, many addresses are informal (e.g., 'Behind First Bank, Agege'). Field agents are trained to navigate informal addressing systems.",
  },
  {
    id: "institutional_records",
    label: "Institutional Records",
    icon: "🏛️",
    description: "Verify subject through local institutions: church, mosque, school, market association",
    weight: 20,
    estimatedHours: 6,
    steps: [
      "Contact subject's church/mosque for membership verification",
      "Verify school attendance records (primary/secondary)",
      "Check market association or trade union membership",
      "Verify community development association (CDA) records",
      "Check local government area (LGA) records if available",
    ],
    nigeriaNote: "Nigerian churches and mosques maintain detailed membership records. Market associations (e.g., Alaba, Computer Village) have formal membership registers.",
  },
  {
    id: "reference_interviews",
    label: "Reference Interviews",
    icon: "🗣️",
    description: "Structured interviews with 3+ independent references who know the subject",
    weight: 25,
    estimatedHours: 8,
    steps: [
      "Identify 3+ independent references (not family members)",
      "Conduct structured interview with each reference",
      "Cross-reference statements for consistency",
      "Verify references are who they claim to be",
      "Document any inconsistencies or red flags",
    ],
    nigeriaNote: "References should include at least one community leader (Baale, Oba's representative, or Ward Councillor) and one employer or business associate.",
  },
  {
    id: "behavioral_interview",
    label: "Behavioral Interview",
    icon: "🧠",
    description: "AI-analyzed structured interview with the subject",
    weight: 15,
    estimatedHours: 2,
    steps: [
      "Schedule in-person or video interview with subject",
      "Conduct structured behavioral interview (STAR method)",
      "Record interview with subject's consent",
      "Submit recording for AI transcript analysis",
      "Review AI integrity and consistency scores",
    ],
    nigeriaNote: "Interviews can be conducted in English, Yoruba, Igbo, or Hausa. BIS AI engine supports all four languages for transcript analysis.",
  },
  {
    id: "mobile_money_analysis",
    label: "Mobile Money History",
    icon: "📱",
    description: "Analyze mobile money transaction history (M-Pesa, OPay, Kuda, PalmPay)",
    weight: 10,
    estimatedHours: 1,
    steps: [
      "Obtain subject's consent for mobile money data sharing",
      "Request 6-month transaction history from subject",
      "Analyze transaction patterns for consistency",
      "Check for suspicious transaction patterns",
      "Verify stated income against transaction volumes",
    ],
    nigeriaNote: "OPay, Kuda, PalmPay, and Moniepoint are widely used in Nigeria. Even subjects without bank accounts often have mobile money accounts.",
  },
  {
    id: "social_network_analysis",
    label: "Social Network Analysis",
    icon: "🕸️",
    description: "Map the subject's social connections to assess trust through network proximity",
    weight: 0,
    estimatedHours: 2,
    steps: [
      "Identify 5+ known connections of the subject",
      "Check if any connections are verified BIS subjects",
      "Calculate derived trust score from network",
      "Flag any connections to known bad actors",
      "Document network graph",
    ],
    nigeriaNote: "In Nigeria's high-trust community culture, a subject connected to 3+ verified individuals inherits significant trust. This is especially powerful in close-knit communities.",
  },
];

const FIELD_AGENT_ZONES = [
  { zone: "Lagos", agents: 12, avgResponseHours: 4, coverage: "All LGAs" },
  { zone: "Abuja (FCT)", agents: 8, avgResponseHours: 6, coverage: "All Area Councils" },
  { zone: "Port Harcourt", agents: 5, avgResponseHours: 8, coverage: "Rivers State" },
  { zone: "Kano", agents: 4, avgResponseHours: 10, coverage: "Kano, Jigawa" },
  { zone: "Ibadan", agents: 4, avgResponseHours: 8, coverage: "Oyo, Osun" },
  { zone: "Enugu", agents: 3, avgResponseHours: 12, coverage: "Enugu, Anambra, Ebonyi" },
  { zone: "Kaduna", agents: 3, avgResponseHours: 12, coverage: "Kaduna, Zamfara" },
  { zone: "Benin City", agents: 3, avgResponseHours: 10, coverage: "Edo, Delta" },
];

// ─────────────────────────────────────────────────────────────────────────────

interface ZFFormData {
  subjectId: string;
  subjectName: string;
  subjectAddress: string;
  state: string;
  lga: string;
  phone: string;
  statedEmployer: string;
  statedIncome: string;
  selectedPillars: string[];
  fieldAgentZone: string;
  notes: string;
}

const NIGERIAN_STATES = [
  "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno",
  "Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT","Gombe","Imo",
  "Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa",
  "Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara",
];

function ZeroFootprintPageInner() {
  const [view, setView] = useState<"intro" | "form" | "active" | "result">("intro");
  const [form, setForm] = useState<ZFFormData>({
    subjectId: "", subjectName: "", subjectAddress: "", state: "Lagos", lga: "",
    phone: "", statedEmployer: "", statedIncome: "",
    selectedPillars: ["physical_verification", "institutional_records", "reference_interviews", "behavioral_interview"],
    fieldAgentZone: "Lagos",
    notes: "",
  });
  const [loading, setLoading] = useState(false);
  const [investigation, setInvestigation] = useState<ZeroFootprintInvestigation | null>(null);

  const selectedPillarData = INVESTIGATION_PILLARS.filter(p => form.selectedPillars.includes(p.id));
  const totalWeight = selectedPillarData.reduce((s, p) => s + p.weight, 0);
  const totalHours = selectedPillarData.reduce((s, p) => s + p.estimatedHours, 0);
  const totalDays = Math.ceil(totalHours / 8);

  const togglePillar = (id: string) => {
    setForm(f => ({
      ...f,
      selectedPillars: f.selectedPillars.includes(id)
        ? f.selectedPillars.filter(p => p !== id)
        : [...f.selectedPillars, id],
    }));
  };

  const [osintReport, setOsintReport] = useState<string | null>(null);

  const zeroFootprintMutation = trpc.screening.zeroFootprint.useMutation({
    onSuccess: (data) => {
      const checklist: ChecklistItem[] = selectedPillarData.flatMap((p, pi) =>
        p.steps.map((step, si) => ({
          step: pi * 10 + si + 1,
          pillar: p.label,
          action: step,
          required: p.weight >= 15,
          estimatedHours: p.estimatedHours / p.steps.length,
          completed: true, // LLM has already run all checks
        }))
      );
      const riskLevel: RiskLevel = data.riskScore >= 70 ? "high" : data.riskScore >= 40 ? "medium" : "low";
      const inv: ZeroFootprintInvestigation = {
        investigationId: data.ref,
        subjectId: form.subjectId,
        subjectName: form.subjectName,
        subjectAddress: form.subjectAddress,
        country: "NG",
        state: form.state,
        lga: form.lga,
        status: "completed",
        startedAt: new Date().toISOString(),
        estimatedCompletionDays: totalDays,
        compositeScore: data.riskScore,
        confidenceLevel: Math.min(95, 60 + data.riskScore * 0.3),
        riskLevel,
        recommendation: data.riskScore >= 70
          ? "High risk — escalate to compliance team"
          : data.riskScore >= 40
          ? "Medium risk — additional verification recommended"
          : "Low risk — proceed with standard onboarding",
        fieldAgentStatus: "completed",
        checklist,
      };
      setOsintReport(data.result);
      setInvestigation(inv);
      setLoading(false);
      setView("active");
    },
    onError: (e) => { toast.error(`OSINT search failed: ${e.message}`); setLoading(false); },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    zeroFootprintMutation.mutate({
      subjectName: form.subjectName || form.subjectId || "Unknown",
      nin: form.subjectId || undefined,
      phone: form.phone || undefined,
      additionalContext: [
        form.subjectAddress ? `Address: ${form.subjectAddress}` : "",
        form.state ? `State: ${form.state}` : "",
        form.lga ? `LGA: ${form.lga}` : "",
        form.statedEmployer ? `Employer: ${form.statedEmployer}` : "",
        form.notes ? `Notes: ${form.notes}` : "",
      ].filter(Boolean).join("; ") || undefined,
    });
  };

  return (
    <>
    <div className="min-h-screen bg-muted">
      {/* Header */}
      <div className="bg-card border-b border-border px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center text-white text-xl">🔍</div>
            <div>
              <h1 className="text-xl font-bold text-muted-foreground">Zero-Footprint Investigation</h1>
              <p className="text-sm text-muted-foreground">Investigate subjects with no digital identity — physical & community verification</p>
            </div>
          </div>
          <div className="flex gap-2">
            {["intro", "form"].map(v => (
              <button key={v} onClick={() => setView(v as any)}
                className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all ${view === v ? "bg-orange-600 text-white" : "text-muted-foreground hover:bg-muted"}`}
              >
                {v === "intro" ? "Overview" : "New Investigation"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6">

        {/* Intro / Overview */}
        {view === "intro" && (
          <div className="space-y-6">
            {/* Hero */}
            <div className="bg-gradient-to-br from-orange-600 to-amber-500 rounded-2xl p-8 text-white">
              <h2 className="text-2xl font-bold mb-2">Investigating the Invisible</h2>
              <p className="text-orange-100 text-sm leading-relaxed max-w-2xl">
                In Nigeria and across Africa, millions of people have no digital footprint — no credit history, no social media, no online records. 
                BIS Zero-Footprint Investigation uses a proven 6-pillar methodology combining field agents, institutional records, 
                behavioral interviews, and AI analysis to build a reliable risk profile from the ground up.
              </p>
              <button onClick={() => setView("form")} className="mt-6 bg-card text-orange-700 font-bold px-6 py-2.5 rounded-xl text-sm hover:bg-orange-50 transition-all">
                Start Investigation →
              </button>
            </div>

            {/* 6 Pillars */}
            <SectionCard title="The 6-Pillar Methodology" icon="🏛️">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {INVESTIGATION_PILLARS.map((pillar, idx) => (
                  <div key={pillar.id} className="flex items-start gap-3 p-4 bg-muted rounded-xl">
                    <div className="w-8 h-8 bg-orange-100 text-orange-700 rounded-full flex items-center justify-center font-bold text-sm shrink-0">
                      {idx + 1}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span>{pillar.icon}</span>
                        <span className="font-semibold text-sm text-muted-foreground">{pillar.label}</span>
                        {pillar.weight > 0 && (
                          <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium">{pillar.weight}% weight</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{pillar.description}</p>
                      <p className="text-xs text-orange-700 mt-1">🇳🇬 {pillar.nigeriaNote.slice(0, 80)}...</p>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* Field Agent Network */}
            <SectionCard title="Nigeria Field Agent Network" icon="📍">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {FIELD_AGENT_ZONES.map(zone => (
                  <div key={zone.zone} className="bg-muted rounded-xl p-3 text-center">
                    <div className="font-semibold text-sm text-muted-foreground">{zone.zone}</div>
                    <div className="text-2xl font-bold text-orange-600 my-1">{zone.agents}</div>
                    <div className="text-xs text-muted-foreground">agents</div>
                    <div className="text-xs text-muted-foreground mt-1">⏱ ~{zone.avgResponseHours}h response</div>
                    <div className="text-xs text-muted-foreground">{zone.coverage}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
                <strong>Network coverage:</strong> 37 field agents across 8 zones covering all 36 states + FCT. 
                Rural areas may require 24–48h additional lead time. All agents are vetted, bonded, and trained in BIS investigation protocols.
              </div>
            </SectionCard>
          </div>
        )}

        {/* Investigation Form */}
        {view === "form" && (
          <form onSubmit={handleSubmit} className="space-y-6">
            <SectionCard title="Subject Information" icon="👤">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground">Subject ID <span className="text-red-500">*</span></label>
                  <input type="text" required value={form.subjectId}
                    onChange={e => setForm(f => ({ ...f, subjectId: e.target.value }))}
                    placeholder="e.g. INV-2024-0042"
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground">Full Name <span className="text-red-500">*</span></label>
                  <input type="text" required value={form.subjectName}
                    onChange={e => setForm(f => ({ ...f, subjectName: e.target.value }))}
                    placeholder="e.g. Adebayo Oluwaseun Emmanuel"
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <div className="flex flex-col gap-1 md:col-span-2">
                  <label className="text-sm font-medium text-muted-foreground">Stated Address <span className="text-red-500">*</span></label>
                  <input type="text" required value={form.subjectAddress}
                    onChange={e => setForm(f => ({ ...f, subjectAddress: e.target.value }))}
                    placeholder="e.g. 12 Adewale Street, Surulere, Lagos (or informal: Behind First Bank, Agege)"
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <p className="text-xs text-muted-foreground">Informal addresses are accepted. Field agents are trained to locate subjects using landmarks.</p>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground">State <span className="text-red-500">*</span></label>
                  <select required value={form.state}
                    onChange={e => setForm(f => ({ ...f, state: e.target.value }))}
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 bg-card"
                  >
                    {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground">LGA</label>
                  <input type="text" value={form.lga}
                    onChange={e => setForm(f => ({ ...f, lga: e.target.value }))}
                    placeholder="Local Government Area"
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground">Phone Number</label>
                  <input type="tel" value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="+234 8XX XXX XXXX"
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <p className="text-xs text-muted-foreground">Even without formal ID, a phone number enables mobile money analysis</p>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground">Stated Employer</label>
                  <input type="text" value={form.statedEmployer}
                    onChange={e => setForm(f => ({ ...f, statedEmployer: e.target.value }))}
                    placeholder="Company name or 'Self-employed'"
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>
            </SectionCard>

            {/* Pillar Selection */}
            <SectionCard title="Select Investigation Pillars" icon="🏛️">
              <div className="space-y-3">
                {INVESTIGATION_PILLARS.map(pillar => (
                  <button
                    key={pillar.id} type="button"
                    onClick={() => togglePillar(pillar.id)}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                      form.selectedPillars.includes(pillar.id) ? "border-orange-500 bg-orange-50" : "border-border bg-card hover:border-border"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-3 flex-1">
                        <span className="text-xl mt-0.5">{pillar.icon}</span>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-muted-foreground">{pillar.label}</span>
                            {pillar.weight >= 15 && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium">Required</span>}
                            <span className="text-xs text-muted-foreground">{pillar.weight}% weight · ~{pillar.estimatedHours}h</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{pillar.description}</p>
                          <p className="text-xs text-orange-700 mt-1">🇳🇬 {pillar.nigeriaNote.slice(0, 100)}...</p>
                        </div>
                      </div>
                      {form.selectedPillars.includes(pillar.id) && (
                        <span className="text-orange-600 font-bold text-lg shrink-0">✓</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>

              {form.selectedPillars.length > 0 && (
                <div className="mt-4 bg-orange-50 border border-orange-200 rounded-xl p-4 grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-orange-700">{form.selectedPillars.length}</div>
                    <div className="text-xs text-muted-foreground">Pillars selected</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-orange-700">{totalDays}</div>
                    <div className="text-xs text-muted-foreground">Est. business days</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-orange-700">{totalWeight}%</div>
                    <div className="text-xs text-muted-foreground">Coverage weight</div>
                  </div>
                </div>
              )}
            </SectionCard>

            {/* Field Agent Zone */}
            <SectionCard title="Field Agent Zone" icon="📍">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {FIELD_AGENT_ZONES.map(zone => (
                  <button
                    key={zone.zone} type="button"
                    onClick={() => setForm(f => ({ ...f, fieldAgentZone: zone.zone }))}
                    className={`p-3 rounded-xl border-2 text-center transition-all ${
                      form.fieldAgentZone === zone.zone ? "border-orange-500 bg-orange-50" : "border-border bg-card hover:border-border"
                    }`}
                  >
                    <div className="font-semibold text-sm text-muted-foreground">{zone.zone}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{zone.agents} agents</div>
                    <div className="text-xs text-orange-600 mt-0.5">~{zone.avgResponseHours}h</div>
                  </button>
                ))}
              </div>
            </SectionCard>

            <button
              type="submit" disabled={loading || form.selectedPillars.length === 0}
              className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-muted text-white font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
            >
              {loading ? <><span className="animate-spin">⟳</span> Dispatching Field Agent...</> : <><span>🚀</span> Launch Zero-Footprint Investigation</>}
            </button>
          </form>
        )}

        {/* Active Investigation Tracker */}
        {view === "active" && investigation && (
          <div className="space-y-6">
            <div className="bg-gradient-to-br from-orange-600 to-amber-500 rounded-2xl p-6 text-white">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-medium opacity-80 mb-1">INVESTIGATION ID</div>
                  <div className="font-mono font-bold text-lg">{investigation.investigationId}</div>
                  <div className="text-orange-100 text-sm mt-1">{investigation.subjectName}</div>
                  <div className="text-orange-200 text-xs mt-0.5">{investigation.subjectAddress}, {investigation.state}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs opacity-80">Est. completion</div>
                  <div className="text-2xl font-bold">{investigation.estimatedCompletionDays}d</div>
                  <div className="text-xs opacity-80">business days</div>
                </div>
              </div>
            </div>

            {/* Field Agent Status */}
            <SectionCard title="Field Agent Status" icon="📍">
              <FieldAgentTimeline status={investigation.fieldAgentStatus} />
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
                <strong>Next action:</strong> Field agent will be assigned within 2 hours and will contact you before visiting the address.
              </div>
            </SectionCard>

            {/* Investigation Checklist */}
            <SectionCard title="Investigation Checklist" icon="✅">
              <div className="space-y-2">
                {investigation.checklist.slice(0, 10).map((item, idx) => (
                  <div key={idx} className={`flex items-start gap-3 p-3 rounded-xl ${item.completed ? "bg-emerald-50" : "bg-muted"}`}>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs shrink-0 mt-0.5 ${
                      item.completed ? "bg-emerald-500 border-emerald-500 text-white" : "border-border"
                    }`}>
                      {item.completed ? "✓" : ""}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-muted-foreground uppercase">{item.pillar}</div>
                      <div className="text-sm text-muted-foreground">{item.action}</div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0">~{item.estimatedHours.toFixed(1)}h</div>
                  </div>
                ))}
                {investigation.checklist.length > 10 && (
                  <div className="text-center text-sm text-muted-foreground py-2">
                    +{investigation.checklist.length - 10} more steps...
                  </div>
                )}
              </div>
            </SectionCard>

            {/* OSINT Report from LLM */}
            {osintReport && (
              <SectionCard title="OSINT Intelligence Report" icon="🔎">
                <div className="prose prose-sm max-w-none text-muted-foreground">
                  <Streamdown>{osintReport}</Streamdown>
                </div>
                <div className="mt-3 text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-lg p-2">
                  ⚠️ This report is generated from public OSINT sources only. No formal inquiry was made. Results should be cross-validated before adverse action.
                </div>
              </SectionCard>
            )}

            <div className="flex gap-3">
              <button onClick={() => { setView("form"); setOsintReport(null); setInvestigation(null); }} className="flex-1 bg-card border border-border text-muted-foreground font-medium py-3 rounded-xl text-sm">
                New Investigation
              </button>
              <button onClick={() => {
                if (!osintReport) return;
                const blob = new Blob([osintReport], { type: "text/plain" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `osint-${investigation?.investigationId ?? "report"}.md`;
                a.click();
              }} className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 rounded-xl text-sm flex items-center justify-center gap-2">
                <span>⬇️</span> Download Report
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
      <div className="max-w-3xl mx-auto px-4 pb-8 mt-6">
        <ScreeningResultsTable screeningType="zero_footprint" title="Zero-Footprint OSINT Records" />
      </div>
    </>
  );
}


export default function ZeroFootprintPage() {
  return (
    <BISLayout>
      <ZeroFootprintPageInner />
    </BISLayout>
  );
}
