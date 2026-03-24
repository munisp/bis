import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  RiskBadge, StatusBadge, ScoreGauge, CountrySelector,
  DataEnvironmentBanner, SectionCard, EmptyState
} from "../../components/bis/shared";
import type { DrugTestOrder, CollectionSite, SubstanceResult, DrugPanel, RiskLevel } from "../../types/bis";
import { getCountry } from "../../types/bis";
import BISLayout from '@/components/BISLayout';

// ─────────────────────────────────────────────────────────────────────────────
// Drug Screening Page — Tailored for Nigeria / Africa
// ─────────────────────────────────────────────────────────────────────────────

// Country-specific drug panel configurations
const COUNTRY_DRUG_CONFIG: Record<string, {
  panels: { value: DrugPanel; label: string; substances: string[]; priceUSD: number; turnaround: string; recommended: boolean }[];
  regulatoryBody: string;
  legalNote: string;
  consentRequired: boolean;
  accreditationBody: string;
}> = {
  NG: {
    regulatoryBody: "NAFDAC (National Agency for Food and Drug Administration and Control)",
    legalNote: "Drug testing in Nigeria must comply with the NAFDAC Act and Labour Act. Written consent is required. Results must be handled confidentially under the National Health Act 2014.",
    consentRequired: true,
    accreditationBody: "NAFDAC / ISO 15189",
    panels: [
      {
        value: "5_panel", label: "Standard 5-Panel (Nigeria)",
        substances: ["Cannabis (THC)", "Cocaine", "Opiates (Codeine/Tramadol)", "Amphetamines", "Benzodiazepines"],
        priceUSD: 18, turnaround: "24–48 hours", recommended: true,
      },
      {
        value: "10_panel", label: "Extended 10-Panel (Nigeria)",
        substances: ["Cannabis (THC)", "Cocaine", "Opiates", "Amphetamines", "Benzodiazepines", "Tramadol", "Methamphetamine", "PCP", "Barbiturates", "Methadone"],
        priceUSD: 35, turnaround: "48–72 hours", recommended: false,
      },
      {
        value: "hair_follicle", label: "Hair Follicle (90-day history)",
        substances: ["Cannabis", "Cocaine", "Opiates", "Amphetamines", "PCP"],
        priceUSD: 75, turnaround: "5–7 business days", recommended: false,
      },
      {
        value: "oral_fluid", label: "Oral Fluid (Rapid — same day)",
        substances: ["Cannabis", "Cocaine", "Opiates", "Amphetamines"],
        priceUSD: 25, turnaround: "Same day (2–4 hours)", recommended: false,
      },
    ],
  },
  KE: {
    regulatoryBody: "NACADA (National Authority for the Campaign Against Alcohol and Drug Abuse)",
    legalNote: "Drug testing in Kenya is governed by NACADA. Employer drug testing is permitted with employee consent under the Employment Act.",
    consentRequired: true,
    accreditationBody: "KEBS / ISO 15189",
    panels: [
      {
        value: "5_panel", label: "Standard 5-Panel (Kenya)",
        substances: ["Cannabis", "Cocaine", "Opiates", "Amphetamines", "Benzodiazepines"],
        priceUSD: 20, turnaround: "24–48 hours", recommended: true,
      },
      {
        value: "10_panel", label: "Extended 10-Panel",
        substances: ["Cannabis", "Cocaine", "Opiates", "Amphetamines", "Benzodiazepines", "Tramadol", "Methamphetamine", "Khat (Cathinone)", "Barbiturates", "Methadone"],
        priceUSD: 40, turnaround: "48–72 hours", recommended: false,
      },
    ],
  },
  GH: {
    regulatoryBody: "FDA Ghana (Food and Drugs Authority)",
    legalNote: "Drug testing in Ghana is regulated by the FDA. The Narcotic Drugs (Control, Enforcement and Sanctions) Act governs substance testing.",
    consentRequired: true,
    accreditationBody: "FDA Ghana / ISO 15189",
    panels: [
      {
        value: "5_panel", label: "Standard 5-Panel (Ghana)",
        substances: ["Cannabis", "Cocaine", "Opiates", "Amphetamines", "Benzodiazepines"],
        priceUSD: 22, turnaround: "24–48 hours", recommended: true,
      },
    ],
  },
  US: {
    regulatoryBody: "SAMHSA (Substance Abuse and Mental Health Services Administration)",
    legalNote: "DOT-regulated positions require SAMHSA-certified lab testing. Non-DOT testing follows state-specific laws. Some states restrict pre-employment testing.",
    consentRequired: true,
    accreditationBody: "SAMHSA / CAP / COLA",
    panels: [
      {
        value: "dot_5_panel", label: "DOT 5-Panel (Federal Mandate)",
        substances: ["Marijuana (THC)", "Cocaine", "Opioids (Codeine/Morphine/Heroin/Oxycodone/Oxymorphone/Hydrocodone/Hydromorphone)", "Amphetamines (Amphetamine/Methamphetamine/MDMA/MDA)", "Phencyclidine (PCP)"],
        priceUSD: 45, turnaround: "24–48 hours", recommended: true,
      },
      {
        value: "10_panel", label: "Non-DOT 10-Panel",
        substances: ["Marijuana", "Cocaine", "Opiates", "Amphetamines", "PCP", "Benzodiazepines", "Barbiturates", "Methadone", "Propoxyphene", "Methaqualone"],
        priceUSD: 65, turnaround: "24–48 hours", recommended: false,
      },
      {
        value: "hair_follicle", label: "Hair Follicle (90-day)",
        substances: ["Marijuana", "Cocaine", "Opiates", "Amphetamines", "PCP"],
        priceUSD: 120, turnaround: "3–5 business days", recommended: false,
      },
    ],
  },
};

const DEFAULT_DRUG_CONFIG = COUNTRY_DRUG_CONFIG.NG;

// Mock collection sites for Nigeria
const NIGERIA_COLLECTION_SITES: CollectionSite[] = [
  { siteId: "lag-01", name: "Synlab Nigeria — Victoria Island", address: "Plot 1649, Adeola Hopewell Street", city: "Lagos", country: "NG", phone: "+234 1 280 4444", hours: "Mon–Fri 7am–6pm, Sat 8am–2pm", distanceKm: 2.1, accredited: true },
  { siteId: "lag-02", name: "PathCare Nigeria — Ikeja", address: "15 Allen Avenue, Ikeja", city: "Lagos", country: "NG", phone: "+234 1 453 2000", hours: "Mon–Fri 7am–5pm, Sat 8am–1pm", distanceKm: 5.4, accredited: true },
  { siteId: "abj-01", name: "Clina-Lancet Laboratories — Abuja", address: "Plot 1109, Cadastral Zone, Wuse 2", city: "Abuja", country: "NG", phone: "+234 9 291 5000", hours: "Mon–Fri 7:30am–5:30pm", distanceKm: 3.2, accredited: true },
  { siteId: "ph-01", name: "Reddington Hospital Lab — Port Harcourt", address: "4 Stadium Road, GRA Phase 1", city: "Port Harcourt", country: "NG", phone: "+234 84 462 000", hours: "Mon–Fri 8am–5pm", distanceKm: 8.7, accredited: true },
  { siteId: "kn-01", name: "AKTH Laboratory — Kano", address: "Aminu Kano Teaching Hospital, Zaria Road", city: "Kano", country: "NG", phone: "+234 64 666 000", hours: "Mon–Fri 8am–4pm", distanceKm: 12.0, accredited: false },
];

const RESULT_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  negative:          { label: "Negative",         color: "text-emerald-700", bg: "bg-emerald-100", icon: "✓" },
  positive:          { label: "Positive",          color: "text-red-700",     bg: "bg-red-100",     icon: "✕" },
  negative_dilute:   { label: "Negative Dilute",   color: "text-amber-700",   bg: "bg-amber-100",   icon: "~" },
  positive_dilute:   { label: "Positive Dilute",   color: "text-orange-700",  bg: "bg-orange-100",  icon: "!" },
  refusal:           { label: "Refusal",           color: "text-red-800",     bg: "bg-red-200",     icon: "✕" },
  cancelled:         { label: "Cancelled",         color: "text-muted-foreground",   bg: "bg-muted",   icon: "–" },
  inconclusive:      { label: "Inconclusive",      color: "text-muted-foreground",   bg: "bg-muted",   icon: "?" },
};

// ─────────────────────────────────────────────────────────────────────────────

interface DrugScreeningFormData {
  subjectId: string;
  subjectName: string;
  subjectEmail: string;
  subjectPhone: string;
  country: string;
  city: string;
  panel: DrugPanel;
  specimenType: "urine" | "hair" | "oral_fluid";
  purpose: string;
  consentObtained: boolean;
  collectionSiteId: string;
  scheduledDate: string;
  donorInstructions: string;
}

function DrugScreeningPageInner() {
  const [form, setForm] = useState<DrugScreeningFormData>({
    subjectId: "", subjectName: "", subjectEmail: "", subjectPhone: "",
    country: "NG", city: "Lagos", panel: "5_panel", specimenType: "urine",
    purpose: "pre_employment", consentObtained: false, collectionSiteId: "",
    scheduledDate: "", donorInstructions: "",
  });
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<DrugTestOrder | null>(null);

  const country = getCountry(form.country);
  const drugConfig = COUNTRY_DRUG_CONFIG[form.country] ?? DEFAULT_DRUG_CONFIG;
  const selectedPanel = drugConfig.panels.find(p => p.value === form.panel) ?? drugConfig.panels[0];
  const specimenTypeForPanel: Record<DrugPanel, "urine" | "hair" | "oral_fluid"> = {
    "5_panel": "urine", "10_panel": "urine", "dot_5_panel": "urine",
    "hair_follicle": "hair", "oral_fluid": "oral_fluid",
  };

  const createScreening = trpc.screening.create.useMutation({
    onSuccess: (record) => {
      const mockOrder: DrugTestOrder = {
        orderId: record.requestRef,
        subjectId: form.subjectId,
        panel: form.panel,
        specimenType: specimenTypeForPanel[form.panel],
        status: "ordered",
        collectionSite: NIGERIA_COLLECTION_SITES.find(s => s.siteId === form.collectionSiteId),
        orderedAt: record.createdAt.toISOString(),
        collectionDeadline: new Date(record.createdAt.getTime() + 72 * 3600 * 1000).toISOString(),
        labName: "Synlab Nigeria",
      };
      setOrder(mockOrder);
      setStep(4);
      setLoading(false);
    },
    onError: (e) => { toast.error(`Order failed: ${e.message}`); setLoading(false); },
  });

  const handleSubmit = () => {
    setLoading(true);
    createScreening.mutate({
      type: "drug",
      subjectName: form.subjectName || form.subjectId || "Unknown",
      subjectType: "individual",
      priority: "medium",
      requestData: {
        subjectId: form.subjectId,
        panel: form.panel,
        specimenType: specimenTypeForPanel[form.panel],
        country: form.country,
        city: form.city,
        purpose: form.purpose,
        collectionSiteId: form.collectionSiteId,
        scheduledDate: form.scheduledDate,
        consentObtained: form.consentObtained,
      },
    });
  };

  const steps = [
    { n: 1, label: "Country & Panel" },
    { n: 2, label: "Subject Info" },
    { n: 3, label: "Collection Site" },
    { n: 4, label: "Confirmation" },
  ];

  return (
    <div className="min-h-screen bg-muted">
      {/* Header */}
      <div className="bg-card border-b border-border px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center text-white text-xl">🧪</div>
            <div>
              <h1 className="text-xl font-bold text-muted-foreground">Drug Screening</h1>
              <p className="text-sm text-muted-foreground">Order substance abuse testing — compliant with local regulations</p>
            </div>
          </div>
          {/* Step indicator */}
          <div className="flex items-center gap-0">
            {steps.map((s, idx) => (
              <React.Fragment key={s.n}>
                <div className="flex flex-col items-center gap-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all ${
                    step > s.n ? "bg-violet-600 border-violet-600 text-white" :
                    step === s.n ? "bg-card border-violet-600 text-violet-600" :
                    "bg-card border-border text-muted-foreground"
                  }`}>
                    {step > s.n ? "✓" : s.n}
                  </div>
                  <span className={`text-xs font-medium hidden sm:block ${step >= s.n ? "text-violet-700" : "text-muted-foreground"}`}>{s.label}</span>
                </div>
                {idx < steps.length - 1 && (
                  <div className={`flex-1 h-0.5 mb-5 ${step > s.n ? "bg-violet-500" : "bg-muted"}`} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">

        {/* Step 1: Country & Panel Selection */}
        {step === 1 && (
          <div className="space-y-6">
            <SectionCard title="Country & Regulatory Context" icon="🌍">
              <CountrySelector value={form.country} onChange={c => setForm(f => ({ ...f, country: c }))} required />
              {country && (
                <div className="mt-4">
                  <DataEnvironmentBanner country={country} />
                </div>
              )}
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
                <div className="font-semibold text-amber-800 mb-1">⚖️ Regulatory Authority</div>
                <div className="text-amber-700">{drugConfig.regulatoryBody}</div>
                <div className="text-amber-600 mt-2 text-xs">{drugConfig.legalNote}</div>
              </div>
            </SectionCard>

            <SectionCard title="Select Drug Panel" icon="🧪">
              <div className="space-y-3">
                {drugConfig.panels.map(panel => (
                  <button
                    key={panel.value}
                    onClick={() => setForm(f => ({ ...f, panel: panel.value, specimenType: specimenTypeForPanel[panel.value] }))}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                      form.panel === panel.value ? "border-violet-500 bg-violet-50" : "border-border bg-card hover:border-border"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-muted-foreground">{panel.label}</span>
                          {panel.recommended && (
                            <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-medium">Recommended</span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {panel.substances.map(s => (
                            <span key={s} className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{s}</span>
                          ))}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold text-violet-700">${panel.priceUSD}</div>
                        <div className="text-xs text-muted-foreground">{panel.turnaround}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </SectionCard>

            {/* Consent requirement */}
            {drugConfig.consentRequired && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox" id="consent"
                    checked={form.consentObtained}
                    onChange={e => setForm(f => ({ ...f, consentObtained: e.target.checked }))}
                    className="mt-0.5 w-4 h-4 text-blue-600"
                  />
                  <label htmlFor="consent" className="text-sm text-blue-800">
                    <span className="font-semibold">I confirm written consent has been obtained</span> from the subject prior to ordering this drug test, in compliance with {drugConfig.regulatoryBody} requirements.
                  </label>
                </div>
              </div>
            )}

            <button
              onClick={() => setStep(2)}
              disabled={drugConfig.consentRequired && !form.consentObtained}
              className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-muted text-white font-semibold py-3 rounded-xl transition-all"
            >
              Continue to Subject Information →
            </button>
          </div>
        )}

        {/* Step 2: Subject Information */}
        {step === 2 && (
          <div className="space-y-6">
            <SectionCard title="Subject Information" icon="👤">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground">Subject ID <span className="text-red-500">*</span></label>
                  <input type="text" required value={form.subjectId}
                    onChange={e => setForm(f => ({ ...f, subjectId: e.target.value }))}
                    placeholder="e.g. INV-2024-0042"
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground">Full Name <span className="text-red-500">*</span></label>
                  <input type="text" required value={form.subjectName}
                    onChange={e => setForm(f => ({ ...f, subjectName: e.target.value }))}
                    placeholder={form.country === "NG" ? "e.g. Adebayo Oluwaseun Emmanuel" : "Full legal name"}
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground">Email Address</label>
                  <input type="email" value={form.subjectEmail}
                    onChange={e => setForm(f => ({ ...f, subjectEmail: e.target.value }))}
                    placeholder="For result notification"
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground">Phone Number <span className="text-red-500">*</span></label>
                  <input type="tel" required value={form.subjectPhone}
                    onChange={e => setForm(f => ({ ...f, subjectPhone: e.target.value }))}
                    placeholder={form.country === "NG" ? "+234 8XX XXX XXXX" : "Phone number"}
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                  <p className="text-xs text-muted-foreground">SMS notification will be sent with collection instructions</p>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground">City</label>
                  <input type="text" value={form.city}
                    onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                    placeholder="City for collection site lookup"
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground">Purpose</label>
                  <select value={form.purpose}
                    onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))}
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-card"
                  >
                    <option value="pre_employment">Pre-employment screening</option>
                    <option value="random">Random / periodic testing</option>
                    <option value="reasonable_suspicion">Reasonable suspicion</option>
                    <option value="post_accident">Post-accident</option>
                    <option value="return_to_duty">Return to duty</option>
                    <option value="follow_up">Follow-up testing</option>
                    <option value="dot_compliance">DOT compliance</option>
                  </select>
                </div>
              </div>

              {/* Special instructions for Nigeria */}
              {form.country === "NG" && (
                <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm">
                  <div className="font-semibold text-emerald-800 mb-2">🇳🇬 Nigeria-Specific Instructions</div>
                  <ul className="space-y-1 text-emerald-700 text-xs">
                    <li>• Subject must bring a valid government-issued ID (NIN slip, driver's license, or international passport)</li>
                    <li>• Subject should avoid excessive water intake 2 hours before urine collection</li>
                    <li>• Tramadol and codeine are commonly prescribed in Nigeria — subject should declare any medications</li>
                    <li>• Results are sent to the requesting organization only, not the subject</li>
                  </ul>
                </div>
              )}
            </SectionCard>

            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 bg-card border border-border text-muted-foreground font-medium py-3 rounded-xl text-sm">
                ← Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!form.subjectId || !form.subjectName || !form.subjectPhone}
                className="flex-1 bg-violet-600 hover:bg-violet-700 disabled:bg-muted text-white font-semibold py-3 rounded-xl transition-all"
              >
                Select Collection Site →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Collection Site */}
        {step === 3 && (
          <div className="space-y-6">
            <SectionCard title={`Collection Sites — ${form.city || form.country}`} icon="🏥">
              <div className="space-y-3">
                {NIGERIA_COLLECTION_SITES.map(site => (
                  <button
                    key={site.siteId}
                    onClick={() => setForm(f => ({ ...f, collectionSiteId: site.siteId }))}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                      form.collectionSiteId === site.siteId ? "border-violet-500 bg-violet-50" : "border-border bg-card hover:border-border"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-muted-foreground">{site.name}</span>
                          {site.accredited && (
                            <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">✓ Accredited</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{site.address}, {site.city}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3">
                          <span>📞 {site.phone}</span>
                          <span>🕐 {site.hours}</span>
                        </div>
                      </div>
                      {site.distanceKm && (
                        <div className="text-right shrink-0">
                          <div className="text-sm font-semibold text-muted-foreground">{site.distanceKm} km</div>
                          <div className="text-xs text-muted-foreground">away</div>
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Schedule Collection" icon="📅">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-muted-foreground">Preferred Collection Date</label>
                <input type="date" value={form.scheduledDate}
                  onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))}
                  min={new Date().toISOString().split("T")[0]}
                  className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <p className="text-xs text-muted-foreground">Subject has 72 hours from order to complete collection</p>
              </div>
            </SectionCard>

            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className="flex-1 bg-card border border-border text-muted-foreground font-medium py-3 rounded-xl text-sm">
                ← Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex-1 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-400 text-white font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
              >
                {loading ? <><span className="animate-spin">⟳</span> Placing Order...</> : "Place Order ✓"}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Confirmation */}
        {step === 4 && order && (
          <div className="space-y-6">
            <div className="bg-emerald-50 border-2 border-emerald-400 rounded-2xl p-6 text-center">
              <div className="text-4xl mb-3">✅</div>
              <h2 className="text-xl font-bold text-emerald-800">Drug Test Ordered</h2>
              <p className="text-emerald-700 text-sm mt-1">Order ID: <span className="font-mono font-bold">{order.orderId}</span></p>
              <p className="text-emerald-600 text-xs mt-2">
                SMS instructions sent to subject. Collection deadline: {new Date(order.collectionDeadline).toLocaleDateString()}
              </p>
            </div>

            <SectionCard title="Order Summary" icon="📋">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: "Panel", value: selectedPanel?.label },
                  { label: "Specimen", value: order.specimenType },
                  { label: "Status", value: <StatusBadge status={order.status} /> },
                  { label: "Lab", value: order.labName },
                  { label: "Collection Deadline", value: new Date(order.collectionDeadline).toLocaleDateString() },
                  { label: "Collection Site", value: order.collectionSite?.name },
                ].map(item => (
                  <div key={item.label} className="bg-muted rounded-xl p-3">
                    <div className="text-xs text-muted-foreground mb-0.5">{item.label}</div>
                    <div className="font-medium text-muted-foreground">{item.value}</div>
                  </div>
                ))}
              </div>
            </SectionCard>

            <div className="flex gap-3">
              <button
                onClick={() => { setOrder(null); setStep(1); setForm(f => ({ ...f, subjectId: "", subjectName: "", subjectPhone: "", subjectEmail: "" })); }}
                className="flex-1 bg-card border border-border text-muted-foreground font-medium py-3 rounded-xl text-sm"
              >
                New Order
              </button>
              <button className="flex-1 bg-violet-600 hover:bg-violet-700 text-white font-semibold py-3 rounded-xl text-sm flex items-center justify-center gap-2">
                <span>📄</span> Download Order Form
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


export default function DrugScreeningPage() {
  return (
    <BISLayout>
      <DrugScreeningPageInner />
    </BISLayout>
  );
}
