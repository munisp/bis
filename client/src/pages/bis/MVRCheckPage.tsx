import React, { useState } from "react";
import {
  RiskBadge, StatusBadge, ScoreGauge, CountrySelector,
  DataEnvironmentBanner, SectionCard, EmptyState
} from "../../components/bis/shared";
import type { MVRResult, MVRViolation, Country, RiskLevel } from "../../types/bis";
import { SUPPORTED_COUNTRIES, getCountry } from "../../types/bis";
import BISLayout from '@/components/BISLayout';

// ─────────────────────────────────────────────────────────────────────────────
// MVR Check Page — Motor Vehicle Record Check
// Tailored for developing countries (Nigeria/Africa focus)
// ─────────────────────────────────────────────────────────────────────────────

// Country-specific MVR data source labels
const MVR_COUNTRY_CONFIG: Record<string, {
  agency: string;
  idLabel: string;
  idPlaceholder: string;
  idHint: string;
  licenseClasses: { value: string; label: string }[];
  avgTurnaround: string;
  notes: string;
}> = {
  NG: {
    agency: "FRSC (Federal Road Safety Corps)",
    idLabel: "Driver's License Number",
    idPlaceholder: "e.g. ABC123456789",
    idHint: "Nigerian driver's license number (12 characters)",
    licenseClasses: [
      { value: "A", label: "Class A — Motorcycles" },
      { value: "B", label: "Class B — Private vehicles (cars, SUVs)" },
      { value: "C", label: "Class C — Commercial vehicles (buses, trucks)" },
      { value: "D", label: "Class D — Articulated vehicles (trailers)" },
      { value: "E", label: "Class E — Special vehicles (bulldozers, cranes)" },
    ],
    avgTurnaround: "2–4 hours",
    notes: "FRSC records cover all 36 states and FCT. Some rural states may have limited digitization.",
  },
  KE: {
    agency: "NTSA (National Transport and Safety Authority)",
    idLabel: "Driver's License Number",
    idPlaceholder: "e.g. DL1234567",
    idHint: "Kenya NTSA license number",
    licenseClasses: [
      { value: "A", label: "Class A — Motorcycles" },
      { value: "B", label: "Class B — Light motor vehicles" },
      { value: "C", label: "Class C — Medium commercial vehicles" },
      { value: "D", label: "Class D — Heavy commercial vehicles" },
      { value: "E", label: "Class E — Articulated vehicles" },
      { value: "F", label: "Class F — Agricultural vehicles" },
      { value: "G", label: "Class G — Special purpose vehicles" },
    ],
    avgTurnaround: "1–2 hours",
    notes: "NTSA has a well-digitized database. Results are typically fast.",
  },
  GH: {
    agency: "DVLA (Driver and Vehicle Licensing Authority)",
    idLabel: "Driver's License Number",
    idPlaceholder: "e.g. GHA-123456789-0",
    idHint: "Ghana DVLA license number",
    licenseClasses: [
      { value: "A", label: "Class A — Motorcycles" },
      { value: "B", label: "Class B — Motor vehicles up to 3,500kg" },
      { value: "C", label: "Class C — Motor vehicles over 3,500kg" },
      { value: "D", label: "Class D — Articulated vehicles" },
      { value: "G", label: "Class G — Agricultural vehicles" },
    ],
    avgTurnaround: "4–8 hours",
    notes: "DVLA Ghana is partially digitized. Some older records may require manual lookup.",
  },
  ZA: {
    agency: "eNaTIS (National Traffic Information System)",
    idLabel: "Driver's License Number",
    idPlaceholder: "e.g. 1234567890",
    idHint: "South African driver's license card number",
    licenseClasses: [
      { value: "A", label: "Code A — Motorcycles" },
      { value: "B", label: "Code B — Light motor vehicles" },
      { value: "C", label: "Code C — Heavy motor vehicles" },
      { value: "EB", label: "Code EB — Light motor vehicles (most common)" },
      { value: "EC", label: "Code EC — Heavy motor vehicles with trailer" },
    ],
    avgTurnaround: "< 1 hour",
    notes: "eNaTIS is fully digitized. Real-time results available.",
  },
  US: {
    agency: "State DMV (via AAMVA)",
    idLabel: "Driver's License Number",
    idPlaceholder: "e.g. D1234567",
    idHint: "State-issued driver's license number",
    licenseClasses: [
      { value: "A", label: "Class A — Commercial (combination vehicles)" },
      { value: "B", label: "Class B — Commercial (single vehicles)" },
      { value: "C", label: "Class C — Non-commercial / standard" },
      { value: "M", label: "Class M — Motorcycles" },
    ],
    avgTurnaround: "< 1 hour",
    notes: "AAMVA covers all 50 states. Results are typically instant.",
  },
};

const DEFAULT_MVR_CONFIG = {
  agency: "National Road Authority",
  idLabel: "Driver's License Number",
  idPlaceholder: "Enter license number",
  idHint: "National driver's license number",
  licenseClasses: [
    { value: "A", label: "Class A — Motorcycles" },
    { value: "B", label: "Class B — Light vehicles" },
    { value: "C", label: "Class C — Commercial vehicles" },
  ],
  avgTurnaround: "1–3 business days",
  notes: "Manual verification may be required for this country.",
};

// ─────────────────────────────────────────────────────────────────────────────

interface MVRFormData {
  subjectId: string;
  fullName: string;
  dateOfBirth: string;
  licenseNumber: string;
  country: string;
  state: string;
  lookbackYears: number;
  purpose: string;
}

const VIOLATION_SEVERITY_CONFIG = {
  minor:    { label: "Minor",    color: "text-slate-600",   bg: "bg-slate-100",   points: "1–2 pts" },
  moderate: { label: "Moderate", color: "text-amber-700",   bg: "bg-amber-100",   points: "3–5 pts" },
  major:    { label: "Major",    color: "text-orange-700",  bg: "bg-orange-100",  points: "6–9 pts" },
  fatal:    { label: "Fatal",    color: "text-red-700",     bg: "bg-red-100",     points: "10+ pts" },
};

const LICENSE_STATUS_CONFIG = {
  valid:      { label: "Valid",      color: "text-emerald-700", bg: "bg-emerald-100", icon: "✓" },
  expired:    { label: "Expired",    color: "text-amber-700",   bg: "bg-amber-100",   icon: "⏰" },
  suspended:  { label: "Suspended",  color: "text-red-700",     bg: "bg-red-100",     icon: "⛔" },
  revoked:    { label: "Revoked",    color: "text-red-800",     bg: "bg-red-200",     icon: "✕" },
  not_found:  { label: "Not Found",  color: "text-slate-600",   bg: "bg-slate-100",   icon: "?" },
};

// ─────────────────────────────────────────────────────────────────────────────

function MVRCheckPageInner() {
  const [form, setForm] = useState<MVRFormData>({
    subjectId: "", fullName: "", dateOfBirth: "", licenseNumber: "",
    country: "NG", state: "", lookbackYears: 7, purpose: "employment",
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MVRResult | null>(null);
  const [tab, setTab] = useState<"form" | "result">("form");

  const country = getCountry(form.country);
  const mvrConfig = MVR_COUNTRY_CONFIG[form.country] ?? DEFAULT_MVR_CONFIG;

  const nigerianStates = [
    "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno",
    "Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT","Gombe","Imo",
    "Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa",
    "Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara",
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // In production: call BIS API
      // const res = await bisClient.mvr.check(form);
      // Simulated result for demonstration
      await new Promise(r => setTimeout(r, 2000));
      const mockResult: MVRResult = {
        subjectId: form.subjectId,
        country: form.country,
        licenseNumber: form.licenseNumber,
        licenseStatus: "valid",
        licenseClass: "B",
        licenseExpiry: "2027-03-15",
        totalPoints: 4,
        violations: [
          { date: "2023-06-12", description: "Speeding (15km/h over limit)", severity: "minor", points: 2, disposition: "convicted", state: form.state || "Lagos" },
          { date: "2022-11-03", description: "Failure to stop at traffic light", severity: "minor", points: 2, disposition: "convicted", state: form.state || "Lagos" },
        ],
        accidentsCount: 0,
        duiCount: 0,
        suspensionsCount: 0,
        riskScore: 18,
        riskLevel: "low",
        recommendation: "APPROVE. Clean driving record with minor violations only.",
        dataSource: mvrConfig.agency,
        verifiedAt: new Date().toISOString(),
      };
      setResult(mockResult);
      setTab("result");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white text-xl">🚗</div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Motor Vehicle Record Check</h1>
              <p className="text-sm text-slate-500">Verify driving history, license status, and violations</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setTab("form")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "form" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              New Check
            </button>
            {result && (
              <button onClick={() => setTab("result")} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "result" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                Results
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
        {tab === "form" ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Country Selection & Data Environment */}
            <SectionCard title="Country & Data Source" icon="🌍">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <CountrySelector value={form.country} onChange={c => setForm(f => ({ ...f, country: c, state: "" }))} required />
                {form.country && (
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-slate-700">Data Agency</label>
                    <div className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-700">
                      {mvrConfig.agency}
                    </div>
                  </div>
                )}
              </div>
              {country && (
                <div className="mt-4">
                  <DataEnvironmentBanner country={country} />
                </div>
              )}
              {mvrConfig.notes && (
                <div className="mt-3 flex items-start gap-2 text-sm text-slate-600 bg-blue-50 border border-blue-100 rounded-lg p-3">
                  <span>ℹ️</span>
                  <span>{mvrConfig.notes}</span>
                </div>
              )}
            </SectionCard>

            {/* Subject Information */}
            <SectionCard title="Subject Information" icon="👤">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-slate-700">Subject ID / Reference <span className="text-red-500">*</span></label>
                  <input
                    type="text" required value={form.subjectId}
                    onChange={e => setForm(f => ({ ...f, subjectId: e.target.value }))}
                    placeholder="e.g. INV-2024-0042"
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-slate-700">Full Name <span className="text-red-500">*</span></label>
                  <input
                    type="text" required value={form.fullName}
                    onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
                    placeholder={form.country === "NG" ? "e.g. Adebayo Oluwaseun Emmanuel" : "Full legal name"}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {form.country === "NG" && (
                    <p className="text-xs text-slate-400">Enter name exactly as it appears on the driver's license</p>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-slate-700">Date of Birth <span className="text-red-500">*</span></label>
                  <input
                    type="date" required value={form.dateOfBirth}
                    onChange={e => setForm(f => ({ ...f, dateOfBirth: e.target.value }))}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-slate-700">Purpose of Check <span className="text-red-500">*</span></label>
                  <select
                    value={form.purpose}
                    onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="employment">Pre-employment (Driver role)</option>
                    <option value="ride_hailing">Ride-hailing / Transport operator</option>
                    <option value="delivery">Delivery / Logistics</option>
                    <option value="tourism_transport">Tourism transport operator</option>
                    <option value="dot_compliance">DOT compliance (US)</option>
                    <option value="insurance">Insurance underwriting</option>
                    <option value="continuous_monitoring">Continuous monitoring update</option>
                  </select>
                </div>
              </div>
            </SectionCard>

            {/* License Information */}
            <SectionCard title="License Information" icon="🪪">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-slate-700">{mvrConfig.idLabel} <span className="text-red-500">*</span></label>
                  <input
                    type="text" required value={form.licenseNumber}
                    onChange={e => setForm(f => ({ ...f, licenseNumber: e.target.value.toUpperCase() }))}
                    placeholder={mvrConfig.idPlaceholder}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-slate-400">{mvrConfig.idHint}</p>
                </div>
                {form.country === "NG" && (
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-slate-700">State of Issue</label>
                    <select
                      value={form.state}
                      onChange={e => setForm(f => ({ ...f, state: e.target.value }))}
                      className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="">All states</option>
                      {nigerianStates.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-slate-700">Lookback Period</label>
                  <select
                    value={form.lookbackYears}
                    onChange={e => setForm(f => ({ ...f, lookbackYears: Number(e.target.value) }))}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value={3}>3 years</option>
                    <option value={5}>5 years</option>
                    <option value={7}>7 years (recommended)</option>
                    <option value={10}>10 years</option>
                  </select>
                </div>
              </div>

              {/* License classes info */}
              <div className="mt-4">
                <p className="text-xs font-medium text-slate-500 mb-2">LICENSE CLASSES IN {form.country || "THIS COUNTRY"}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {mvrConfig.licenseClasses.map(cls => (
                    <div key={cls.value} className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 rounded-lg px-2.5 py-1.5">
                      <span className="font-bold text-blue-700 w-6">{cls.value}</span>
                      <span>{cls.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>

            {/* Estimated cost & turnaround */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⏱</span>
                <div>
                  <div className="font-semibold text-blue-900 text-sm">Estimated Turnaround</div>
                  <div className="text-blue-700 text-sm">{mvrConfig.avgTurnaround}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl">💰</span>
                <div>
                  <div className="font-semibold text-blue-900 text-sm">Estimated Cost</div>
                  <div className="text-blue-700 text-sm">$0.12 – $0.50 USD</div>
                </div>
              </div>
              <button
                type="submit" disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-all flex items-center gap-2"
              >
                {loading ? (
                  <><span className="animate-spin">⟳</span> Running Check...</>
                ) : (
                  <><span>🔍</span> Run MVR Check</>
                )}
              </button>
            </div>
          </form>
        ) : result ? (
          <MVRResultView result={result} onNewCheck={() => { setResult(null); setTab("form"); }} />
        ) : null}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MVR Result View
// ─────────────────────────────────────────────────────────────────────────────

function MVRResultView({ result, onNewCheck }: { result: MVRResult; onNewCheck: () => void }) {
  const licCfg = LICENSE_STATUS_CONFIG[result.licenseStatus];
  const country = getCountry(result.country);

  return (
    <div className="space-y-6">
      {/* Summary Header */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <ScoreGauge score={100 - result.riskScore} label="Safety Score" size={100} />
            <div>
              <h2 className="text-xl font-bold text-slate-900">MVR Check Complete</h2>
              <p className="text-slate-500 text-sm mt-0.5">Subject ID: {result.subjectId}</p>
              <div className="flex items-center gap-2 mt-2">
                <RiskBadge level={result.riskLevel as RiskLevel} />
                <span className={`inline-flex items-center gap-1 text-sm font-semibold px-2.5 py-1 rounded-full ${licCfg.color} ${licCfg.bg}`}>
                  {licCfg.icon} License {licCfg.label}
                </span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400">Data Source</div>
            <div className="text-sm font-medium text-slate-700">{result.dataSource}</div>
            <div className="text-xs text-slate-400 mt-1">
              {new Date(result.verifiedAt).toLocaleString()}
            </div>
          </div>
        </div>

        {/* Recommendation */}
        <div className={`mt-4 p-4 rounded-xl border-2 ${
          result.riskLevel === "low" ? "bg-emerald-50 border-emerald-300 text-emerald-800" :
          result.riskLevel === "medium" ? "bg-amber-50 border-amber-300 text-amber-800" :
          "bg-red-50 border-red-300 text-red-800"
        }`}>
          <div className="font-bold text-sm mb-0.5">Recommendation</div>
          <div className="text-sm">{result.recommendation}</div>
        </div>
      </div>

      {/* License Details */}
      <SectionCard title="License Details" icon="🪪">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "License Number", value: result.licenseNumber },
            { label: "License Class", value: result.licenseClass },
            { label: "Expiry Date", value: result.licenseExpiry },
            { label: "Total Points", value: `${result.totalPoints} pts` },
          ].map(item => (
            <div key={item.label} className="bg-slate-50 rounded-xl p-3">
              <div className="text-xs text-slate-500 mb-1">{item.label}</div>
              <div className="font-semibold text-slate-800">{item.value}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Statistics */}
      <SectionCard title="Driving Statistics" icon="📊">
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Violations", value: result.violations.length, icon: "⚠️", color: result.violations.length > 3 ? "text-orange-600" : "text-slate-800" },
            { label: "Accidents", value: result.accidentsCount, icon: "💥", color: result.accidentsCount > 0 ? "text-red-600" : "text-slate-800" },
            { label: "DUI Count", value: result.duiCount, icon: "🍺", color: result.duiCount > 0 ? "text-red-700 font-bold" : "text-slate-800" },
          ].map(stat => (
            <div key={stat.label} className="bg-slate-50 rounded-xl p-4 text-center">
              <div className="text-2xl mb-1">{stat.icon}</div>
              <div className={`text-3xl font-bold ${stat.color}`}>{stat.value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Violations List */}
      {result.violations.length > 0 ? (
        <SectionCard title={`Violations (${result.violations.length})`} icon="📋">
          <div className="space-y-3">
            {result.violations.map((v, i) => {
              const sev = VIOLATION_SEVERITY_CONFIG[v.severity];
              return (
                <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sev.color} ${sev.bg} shrink-0 mt-0.5`}>
                    {sev.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800">{v.description}</div>
                    <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-3">
                      <span>📅 {v.date}</span>
                      <span>📍 {v.state}</span>
                      <span>⚖️ {v.disposition}</span>
                      <span className="font-medium text-slate-700">+{v.points} pts</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      ) : (
        <SectionCard title="Violations" icon="📋">
          <EmptyState icon="✅" title="No violations found" description={`No traffic violations recorded in the past ${7} years.`} />
        </SectionCard>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onNewCheck}
          className="flex-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium py-2.5 rounded-xl text-sm transition-all"
        >
          New Check
        </button>
        <button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-xl text-sm transition-all flex items-center justify-center gap-2">
          <span>📄</span> Download Report
        </button>
        <button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2.5 rounded-xl text-sm transition-all flex items-center justify-center gap-2">
          <span>👁</span> Enroll Monitoring
        </button>
      </div>
    </div>
  );
}


export default function MVRCheckPage() {
  return (
    <BISLayout>
      <MVRCheckPageInner />
    </BISLayout>
  );
}
