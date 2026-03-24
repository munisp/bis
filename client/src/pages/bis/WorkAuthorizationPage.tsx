import React, { useState } from "react";
import {
  RiskBadge, StatusBadge, CountrySelector, DataEnvironmentBanner, SectionCard
} from "../../components/bis/shared";
import type { WorkAuthResult, WorkAuthType, WorkAuthStatus, RiskLevel } from "../../types/bis";
import { getCountry } from "../../types/bis";
import BISLayout from '@/components/BISLayout';

// ─────────────────────────────────────────────────────────────────────────────
// Work Authorization Page — E-Verify / Nigeria Work Permit / Right to Work
// ─────────────────────────────────────────────────────────────────────────────

const WORK_AUTH_COUNTRY_CONFIG: Record<string, {
  label: string;
  authTypes: { value: WorkAuthType; label: string; description: string; applicableTo: string }[];
  citizenNote: string;
  foreignerNote: string;
  legalBasis: string;
  icon: string;
}> = {
  NG: {
    label: "Nigeria",
    icon: "🇳🇬",
    citizenNote: "Nigerian citizens do not require a work permit. However, verify identity via NIN/BVN.",
    foreignerNote: "Foreign nationals must hold a valid CERPAC or Subject to Regularization (STR) permit issued by the Nigeria Immigration Service (NIS).",
    legalBasis: "Immigration Act 2015, Section 34 — Prohibition of employment of non-citizens without valid permit",
    authTypes: [
      { value: "ng_cerpac", label: "CERPAC Verification", description: "Combined Expatriate Residence Permit and Aliens Card — for foreign nationals residing and working in Nigeria", applicableTo: "Foreign nationals (non-ECOWAS)" },
      { value: "ng_work_permit", label: "STR / Work Permit", description: "Subject to Regularization permit or standard work permit issued by NIS", applicableTo: "Foreign nationals (ECOWAS + non-ECOWAS)" },
      { value: "global_passport_work", label: "ECOWAS Free Movement", description: "Citizens of ECOWAS member states have right to work in Nigeria without a formal permit", applicableTo: "ECOWAS citizens (Ghana, Senegal, Côte d'Ivoire, etc.)" },
    ],
  },
  KE: {
    label: "Kenya",
    icon: "🇰🇪",
    citizenNote: "Kenyan citizens do not require a work permit.",
    foreignerNote: "Foreign nationals must hold a Class G Work Permit issued by the Department of Immigration Services.",
    legalBasis: "Kenya Citizenship and Immigration Act 2011, Section 38",
    authTypes: [
      { value: "ng_work_permit", label: "Class G Work Permit", description: "Standard work permit for foreign nationals employed in Kenya", applicableTo: "Foreign nationals" },
      { value: "global_passport_work", label: "EAC Work Authorization", description: "East African Community citizens have preferential work access", applicableTo: "EAC citizens (Tanzania, Uganda, Rwanda, Burundi, South Sudan)" },
    ],
  },
  GH: {
    label: "Ghana",
    icon: "🇬🇭",
    citizenNote: "Ghanaian citizens do not require a work permit.",
    foreignerNote: "Foreign nationals must hold a Work Permit issued by the Ghana Immigration Service.",
    legalBasis: "Ghana Immigration Act 2000 (Act 573), Section 21",
    authTypes: [
      { value: "ng_work_permit", label: "Ghana Work Permit", description: "Work permit issued by Ghana Immigration Service", applicableTo: "Foreign nationals" },
      { value: "global_passport_work", label: "ECOWAS Free Movement", description: "ECOWAS citizens have right to work in Ghana", applicableTo: "ECOWAS citizens" },
    ],
  },
  US: {
    label: "United States",
    icon: "🇺🇸",
    citizenNote: "US citizens and permanent residents are automatically authorized to work.",
    foreignerNote: "Non-citizens must present valid I-9 documents. E-Verify is mandatory for federal contractors and recommended for all employers.",
    legalBasis: "Immigration Reform and Control Act 1986 (IRCA) — I-9 Employment Eligibility Verification",
    authTypes: [
      { value: "us_everify", label: "E-Verify (DHS)", description: "US Department of Homeland Security E-Verify system — compares I-9 data against SSA and DHS records", applicableTo: "All US employees (mandatory for federal contractors)" },
    ],
  },
  GB: {
    label: "United Kingdom",
    icon: "🇬🇧",
    citizenNote: "UK citizens and settled status holders have the right to work.",
    foreignerNote: "Non-UK nationals must provide a share code from the UK Visas and Immigration (UKVI) online service.",
    legalBasis: "Immigration, Asylum and Nationality Act 2006 — Right to Work checks",
    authTypes: [
      { value: "uk_right_to_work", label: "Right to Work (Share Code)", description: "UKVI online Right to Work check using the subject's share code", applicableTo: "Non-UK nationals with pre-settled, settled, or visa status" },
    ],
  },
};

const DEFAULT_WORK_AUTH_CONFIG = WORK_AUTH_COUNTRY_CONFIG.NG;

const WORK_AUTH_STATUS_CONFIG: Record<WorkAuthStatus, { label: string; color: string; bg: string; icon: string; description: string }> = {
  authorized:                  { label: "Authorized",               color: "text-emerald-700", bg: "bg-emerald-100", icon: "✓", description: "Subject is legally authorized to work in this country." },
  unauthorized:                { label: "Not Authorized",           color: "text-red-700",     bg: "bg-red-100",     icon: "✕", description: "Subject does not have valid work authorization. Do not employ." },
  tentative_non_confirmation:  { label: "Tentative Non-Confirmation", color: "text-amber-700", bg: "bg-amber-100",   icon: "⚠", description: "Possible mismatch. Subject has 8 business days to resolve with the relevant authority." },
  pending:                     { label: "Pending Verification",     color: "text-blue-700",    bg: "bg-blue-100",    icon: "⟳", description: "Verification is in progress. Manual check required." },
  expired:                     { label: "Expired",                  color: "text-orange-700",  bg: "bg-orange-100",  icon: "⏰", description: "Work authorization has expired. Subject must renew before employment." },
  not_applicable:              { label: "Not Required",             color: "text-muted-foreground",   bg: "bg-muted",   icon: "–", description: "Subject is a citizen of this country. No work permit required." },
};

const NIGERIAN_STATES = [
  "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno",
  "Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT","Gombe","Imo",
  "Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa",
  "Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara",
];

const ECOWAS_COUNTRIES = ["BJ","BF","CV","GM","GH","GN","GW","CI","LR","ML","MR","NE","NG","SN","SL","TG"];

// ─────────────────────────────────────────────────────────────────────────────

interface WorkAuthFormData {
  subjectId: string;
  fullName: string;
  dateOfBirth: string;
  workCountry: string;       // Country where they want to work
  nationality: string;       // Subject's nationality
  authType: WorkAuthType;
  documentNumber: string;
  documentExpiry: string;
  shareCode: string;
  ssn: string;
  i9DocumentType: string;
  employerName: string;
  employerState: string;
  isCitizen: boolean;
}

function WorkAuthorizationPageInner() {
  const [form, setForm] = useState<WorkAuthFormData>({
    subjectId: "", fullName: "", dateOfBirth: "",
    workCountry: "NG", nationality: "NG",
    authType: "ng_cerpac",
    documentNumber: "", documentExpiry: "",
    shareCode: "", ssn: "", i9DocumentType: "passport",
    employerName: "", employerState: "",
    isCitizen: false,
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WorkAuthResult | null>(null);

  const workCountry = getCountry(form.workCountry);
  const nationalityCountry = getCountry(form.nationality);
  const authConfig = WORK_AUTH_COUNTRY_CONFIG[form.workCountry] ?? DEFAULT_WORK_AUTH_CONFIG;

  // Determine if citizen check applies
  const isSameCountry = form.workCountry === form.nationality;
  const isECOWAS = ECOWAS_COUNTRIES.includes(form.nationality) && ["NG","GH","SN","CI","ML","BF"].includes(form.workCountry);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await new Promise(r => setTimeout(r, 1800));
      let status: WorkAuthStatus = "authorized";
      let notes = "";

      if (isSameCountry) {
        status = "not_applicable";
        notes = `${nationalityCountry?.name ?? form.nationality} citizen — no work permit required in ${workCountry?.name ?? form.workCountry}.`;
      } else if (isECOWAS && form.workCountry !== "US" && form.workCountry !== "GB") {
        status = "authorized";
        notes = `ECOWAS citizen — free movement applies. No formal work permit required.`;
      } else if (!form.documentNumber) {
        status = "pending";
        notes = "No document number provided — manual verification required.";
      } else if (form.documentExpiry && new Date(form.documentExpiry) < new Date()) {
        status = "expired";
        notes = "Document has expired. Subject must renew before employment.";
      }

      const mockResult: WorkAuthResult = {
        subjectId: form.subjectId,
        authType: form.authType,
        status,
        authorizedUntil: form.documentExpiry || undefined,
        documentValid: status === "authorized" || status === "not_applicable",
        documentExpiry: form.documentExpiry || undefined,
        permitType: form.authType === "ng_cerpac" ? "CERPAC" : form.authType === "uk_right_to_work" ? "Share Code" : "Work Permit",
        restrictions: status === "authorized" ? ["Specific employer only (if CERPAC)", "Must renew before expiry"] : [],
        notes,
        dataSource: form.workCountry === "NG" ? "NIS (Nigeria Immigration Service)" : form.workCountry === "GB" ? "UKVI" : "USCIS E-Verify",
        verifiedAt: new Date().toISOString(),
      };
      setResult(mockResult);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted">
      {/* Header */}
      <div className="bg-card border-b border-border px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white text-xl">📋</div>
          <div>
            <h1 className="text-xl font-bold text-muted-foreground">Work Authorization Check</h1>
            <p className="text-sm text-muted-foreground">Verify right to work — E-Verify, CERPAC, Right to Work, ECOWAS</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6">
        {!result ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Country Context */}
            <SectionCard title="Work Country & Nationality" icon="🌍">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <CountrySelector
                  value={form.workCountry}
                  onChange={c => setForm(f => ({ ...f, workCountry: c, authType: (WORK_AUTH_COUNTRY_CONFIG[c] ?? DEFAULT_WORK_AUTH_CONFIG).authTypes[0].value }))}
                  label="Country of Employment"
                  required
                />
                <CountrySelector
                  value={form.nationality}
                  onChange={c => setForm(f => ({ ...f, nationality: c }))}
                  label="Subject's Nationality"
                  required
                />
              </div>

              {/* Citizen / ECOWAS detection */}
              {isSameCountry && (
                <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-800">
                  ✅ <strong>Citizen check:</strong> {authConfig.citizenNote}
                </div>
              )}
              {!isSameCountry && isECOWAS && (
                <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-800">
                  🌍 <strong>ECOWAS Free Movement:</strong> Citizens of ECOWAS member states have the right to work in Nigeria and other ECOWAS countries without a formal work permit. Verify identity only.
                </div>
              )}
              {!isSameCountry && !isECOWAS && (
                <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
                  ⚠️ <strong>Permit Required:</strong> {authConfig.foreignerNote}
                </div>
              )}

              {workCountry && (
                <div className="mt-4">
                  <DataEnvironmentBanner country={workCountry} />
                </div>
              )}

              <div className="mt-4 bg-muted border border-border rounded-xl p-3 text-xs text-muted-foreground">
                <span className="font-semibold">⚖️ Legal Basis: </span>{authConfig.legalBasis}
              </div>
            </SectionCard>

            {/* Subject Information */}
            <SectionCard title="Subject Information" icon="👤">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground">Subject ID <span className="text-red-500">*</span></label>
                  <input type="text" required value={form.subjectId}
                    onChange={e => setForm(f => ({ ...f, subjectId: e.target.value }))}
                    placeholder="e.g. INV-2024-0042"
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground">Full Name <span className="text-red-500">*</span></label>
                  <input type="text" required value={form.fullName}
                    onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
                    placeholder="Full legal name"
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground">Date of Birth <span className="text-red-500">*</span></label>
                  <input type="date" required value={form.dateOfBirth}
                    onChange={e => setForm(f => ({ ...f, dateOfBirth: e.target.value }))}
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground">Employer Name</label>
                  <input type="text" value={form.employerName}
                    onChange={e => setForm(f => ({ ...f, employerName: e.target.value }))}
                    placeholder="Employing organization"
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
            </SectionCard>

            {/* Auth Type Selection */}
            {!isSameCountry && (
              <SectionCard title="Authorization Type" icon="📄">
                <div className="space-y-3">
                  {authConfig.authTypes.map(at => (
                    <button
                      key={at.value} type="button"
                      onClick={() => setForm(f => ({ ...f, authType: at.value }))}
                      className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                        form.authType === at.value ? "border-emerald-500 bg-emerald-50" : "border-border bg-card hover:border-border"
                      }`}
                    >
                      <div className="font-semibold text-sm text-muted-foreground">{at.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{at.description}</div>
                      <div className="text-xs text-emerald-700 mt-1 font-medium">Applies to: {at.applicableTo}</div>
                    </button>
                  ))}
                </div>
              </SectionCard>
            )}

            {/* Document Details — Nigeria CERPAC */}
            {form.authType === "ng_cerpac" && !isSameCountry && (
              <SectionCard title="CERPAC / Work Permit Details" icon="🪪">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-muted-foreground">CERPAC / Permit Number <span className="text-red-500">*</span></label>
                    <input type="text" value={form.documentNumber}
                      onChange={e => setForm(f => ({ ...f, documentNumber: e.target.value.toUpperCase() }))}
                      placeholder="e.g. CERPAC/2023/12345"
                      className="border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <p className="text-xs text-muted-foreground">Found on the CERPAC card or NIS approval letter</p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-muted-foreground">Permit Expiry Date <span className="text-red-500">*</span></label>
                    <input type="date" value={form.documentExpiry}
                      onChange={e => setForm(f => ({ ...f, documentExpiry: e.target.value }))}
                      className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
                <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
                  <strong>Verification process:</strong> BIS will query the NIS CERPAC database directly. If the NIS API is unavailable (common), the system will flag for manual verification via <a href="https://www.immigration.gov.ng" target="_blank" rel="noopener noreferrer" className="underline">immigration.gov.ng</a>.
                </div>
              </SectionCard>
            )}

            {/* UK Right to Work */}
            {form.authType === "uk_right_to_work" && (
              <SectionCard title="UK Right to Work — Share Code" icon="🇬🇧">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-muted-foreground">Share Code <span className="text-red-500">*</span></label>
                    <input type="text" value={form.shareCode}
                      onChange={e => setForm(f => ({ ...f, shareCode: e.target.value.toUpperCase() }))}
                      placeholder="e.g. W4B-3X7-P9Q"
                      className="border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <p className="text-xs text-muted-foreground">Subject generates this at gov.uk/prove-right-to-work</p>
                  </div>
                </div>
              </SectionCard>
            )}

            {/* US E-Verify */}
            {form.authType === "us_everify" && (
              <SectionCard title="US E-Verify / I-9 Details" icon="🇺🇸">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-muted-foreground">I-9 Document Type <span className="text-red-500">*</span></label>
                    <select value={form.i9DocumentType}
                      onChange={e => setForm(f => ({ ...f, i9DocumentType: e.target.value }))}
                      className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-card"
                    >
                      <option value="passport">US Passport (List A)</option>
                      <option value="green_card">Permanent Resident Card (List A)</option>
                      <option value="work_visa">Employment Authorization Document (List A)</option>
                      <option value="drivers_license_ssn">Driver's License + SSN Card (List B+C)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-muted-foreground">Document Number <span className="text-red-500">*</span></label>
                    <input type="text" value={form.documentNumber}
                      onChange={e => setForm(f => ({ ...f, documentNumber: e.target.value }))}
                      placeholder="Passport / Green Card / EAD number"
                      className="border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-muted-foreground">SSN (last 4 digits)</label>
                    <input type="text" value={form.ssn} maxLength={4}
                      onChange={e => setForm(f => ({ ...f, ssn: e.target.value }))}
                      placeholder="XXXX"
                      className="border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
              </SectionCard>
            )}

            <button
              type="submit" disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
            >
              {loading ? <><span className="animate-spin">⟳</span> Verifying...</> : <><span>🔍</span> Verify Work Authorization</>}
            </button>
          </form>
        ) : (
          <WorkAuthResultView result={result} onNewCheck={() => setResult(null)} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Work Auth Result View
// ─────────────────────────────────────────────────────────────────────────────

function WorkAuthResultView({ result, onNewCheck }: { result: WorkAuthResult; onNewCheck: () => void }) {
  const cfg = WORK_AUTH_STATUS_CONFIG[result.status];

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      <div className={`rounded-2xl border-2 p-6 ${cfg.bg} border-current/20`}>
        <div className="flex items-center gap-4">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center text-3xl font-bold ${cfg.color} bg-card/60`}>
            {cfg.icon}
          </div>
          <div>
            <h2 className={`text-2xl font-bold ${cfg.color}`}>{cfg.label}</h2>
            <p className={`text-sm mt-0.5 ${cfg.color} opacity-80`}>{cfg.description}</p>
          </div>
        </div>
        {result.notes && (
          <div className={`mt-4 text-sm ${cfg.color} bg-card/50 rounded-xl p-3`}>{result.notes}</div>
        )}
      </div>

      <SectionCard title="Verification Details" icon="📋">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          {[
            { label: "Subject ID", value: result.subjectId },
            { label: "Auth Type", value: result.authType.replace(/_/g, " ").toUpperCase() },
            { label: "Permit Type", value: result.permitType ?? "—" },
            { label: "Document Valid", value: result.documentValid ? "✓ Yes" : "✕ No" },
            { label: "Authorized Until", value: result.authorizedUntil ? new Date(result.authorizedUntil).toLocaleDateString() : "—" },
            { label: "Data Source", value: result.dataSource },
          ].map(item => (
            <div key={item.label} className="bg-muted rounded-xl p-3">
              <div className="text-xs text-muted-foreground mb-0.5">{item.label}</div>
              <div className="font-medium text-muted-foreground">{item.value}</div>
            </div>
          ))}
        </div>
        {result.restrictions && result.restrictions.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-semibold text-muted-foreground mb-2">RESTRICTIONS</div>
            <ul className="space-y-1">
              {result.restrictions.map((r, i) => (
                <li key={i} className="text-sm text-amber-700 flex items-start gap-2">
                  <span>⚠</span><span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </SectionCard>

      <div className="flex gap-3">
        <button onClick={onNewCheck} className="flex-1 bg-card border border-border text-muted-foreground font-medium py-3 rounded-xl text-sm">
          New Check
        </button>
        <button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-xl text-sm flex items-center justify-center gap-2">
          <span>📄</span> Download Report
        </button>
      </div>
    </div>
  );
}


export default function WorkAuthorizationPage() {
  return (
    <BISLayout>
      <WorkAuthorizationPageInner />
    </BISLayout>
  );
}
