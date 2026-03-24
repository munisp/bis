import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { SectionCard, StatusBadge, RiskBadge, ScoreGauge } from "../../components/bis/shared";
import BISLayout from '@/components/BISLayout';

// ─────────────────────────────────────────────────────────────────────────────
// Nigerian Data Bundle Page — All NG data sources in one unified check
// ─────────────────────────────────────────────────────────────────────────────

const NG_DATA_SOURCES = [
  {
    id: "nimc_nin",
    category: "Identity",
    label: "NIMC — National Identity Number",
    icon: "🪪",
    description: "Verify NIN against the National Identity Management Commission database",
    fields: ["nin"],
    apiProvider: "NIMC API / Youverify",
    turnaround: "Real-time",
    priceUSD: 0.50,
    reliability: 95,
    coverage: "All Nigerians 16+",
    color: "green",
  },
  {
    id: "bvn",
    category: "Financial",
    label: "CBN — Bank Verification Number (BVN)",
    icon: "🏦",
    description: "Verify BVN against the Central Bank of Nigeria NIBSS database",
    fields: ["bvn"],
    apiProvider: "NIBSS / Youverify / Dojah",
    turnaround: "Real-time",
    priceUSD: 0.75,
    reliability: 98,
    coverage: "All banked Nigerians",
    color: "blue",
  },
  {
    id: "drivers_license",
    category: "Identity",
    label: "FRSC — Driver's License Verification",
    icon: "🚗",
    description: "Verify driver's license against Federal Road Safety Corps database",
    fields: ["license_number"],
    apiProvider: "FRSC / Youverify",
    turnaround: "Real-time",
    priceUSD: 0.50,
    reliability: 88,
    coverage: "Licensed drivers",
    color: "amber",
  },
  {
    id: "voters_card",
    category: "Identity",
    label: "INEC — Voter's Card (PVC) Verification",
    icon: "🗳️",
    description: "Verify Permanent Voter's Card against INEC voter register",
    fields: ["vin"],
    apiProvider: "INEC / Youverify",
    turnaround: "Real-time",
    priceUSD: 0.50,
    reliability: 82,
    coverage: "Registered voters",
    color: "purple",
  },
  {
    id: "passport",
    category: "Identity",
    label: "NIS — International Passport Verification",
    icon: "📘",
    description: "Verify Nigerian passport against Nigeria Immigration Service database",
    fields: ["passport_number", "date_of_birth"],
    apiProvider: "NIS / Youverify",
    turnaround: "Real-time",
    priceUSD: 0.75,
    reliability: 92,
    coverage: "Passport holders",
    color: "indigo",
  },
  {
    id: "cac",
    category: "Corporate",
    label: "CAC — Company Registration Verification",
    icon: "🏢",
    description: "Verify company registration, directors, and shareholding with Corporate Affairs Commission",
    fields: ["rc_number"],
    apiProvider: "CAC API / Youverify",
    turnaround: "Real-time",
    priceUSD: 1.00,
    reliability: 90,
    coverage: "All registered Nigerian companies",
    color: "teal",
  },
  {
    id: "efcc_watchlist",
    category: "Compliance",
    label: "EFCC — Watchlist & Wanted Persons",
    icon: "⚖️",
    description: "Check against EFCC published watchlist, wanted persons, and debarment list",
    fields: ["full_name", "nin"],
    apiProvider: "EFCC Public Database",
    turnaround: "Real-time",
    priceUSD: 0.25,
    reliability: 75,
    coverage: "EFCC investigated persons",
    color: "red",
  },
  {
    id: "icpc_watchlist",
    category: "Compliance",
    label: "ICPC — Corruption Watchlist",
    icon: "🔍",
    description: "Check against ICPC (Independent Corrupt Practices Commission) records",
    fields: ["full_name"],
    apiProvider: "ICPC Public Database",
    turnaround: "Real-time",
    priceUSD: 0.25,
    reliability: 70,
    coverage: "ICPC investigated persons",
    color: "orange",
  },
  {
    id: "nfiu_aml",
    category: "Compliance",
    label: "NFIU — AML / Financial Intelligence",
    icon: "💰",
    description: "Check against Nigeria Financial Intelligence Unit AML database and PEP lists",
    fields: ["full_name", "bvn"],
    apiProvider: "NFIU",
    turnaround: "1–4 hours",
    priceUSD: 1.50,
    reliability: 85,
    coverage: "PEPs, high-risk individuals",
    color: "rose",
  },
  {
    id: "credit_bureau",
    category: "Financial",
    label: "CRC / FirstCentral — Credit Bureau",
    icon: "📊",
    description: "Pull credit report from CRC Credit Bureau or FirstCentral Credit Bureau",
    fields: ["bvn", "full_name", "date_of_birth"],
    apiProvider: "CRC Credit Bureau / FirstCentral",
    turnaround: "Real-time",
    priceUSD: 2.00,
    reliability: 88,
    coverage: "Banked Nigerians with credit history",
    color: "cyan",
  },
  {
    id: "tax_tin",
    category: "Financial",
    label: "FIRS — Tax Identification Number (TIN)",
    icon: "🧾",
    description: "Verify TIN and tax compliance status with Federal Inland Revenue Service",
    fields: ["tin"],
    apiProvider: "FIRS API / Youverify",
    turnaround: "Real-time",
    priceUSD: 0.50,
    reliability: 80,
    coverage: "Registered taxpayers",
    color: "lime",
  },
  {
    id: "mobile_number",
    category: "Telecom",
    label: "NCC — Mobile Number Verification",
    icon: "📱",
    description: "Verify phone number registration against NCC SIM registration database (NIN-linked)",
    fields: ["phone_number"],
    apiProvider: "MTN / Airtel / Glo / 9mobile APIs",
    turnaround: "Real-time",
    priceUSD: 0.25,
    reliability: 92,
    coverage: "All registered SIM cards",
    color: "violet",
  },
];

const CATEGORY_COLORS: Record<string, string> = {
  Identity: "bg-blue-100 text-blue-700",
  Financial: "bg-emerald-100 text-emerald-700",
  Corporate: "bg-teal-100 text-teal-700",
  Compliance: "bg-red-100 text-red-700",
  Telecom: "bg-violet-100 text-violet-700",
};

const BUNDLE_PRESETS = [
  {
    id: "basic_kyc",
    label: "Basic KYC",
    icon: "🪪",
    description: "NIN + BVN verification — minimum for onboarding",
    sources: ["nimc_nin", "bvn"],
    priceUSD: 1.25,
    useCase: "Fintech onboarding, wallet creation",
  },
  {
    id: "employment_check",
    label: "Employment Bundle",
    icon: "💼",
    description: "Full identity + compliance check for employment",
    sources: ["nimc_nin", "bvn", "drivers_license", "efcc_watchlist", "icpc_watchlist"],
    priceUSD: 2.25,
    useCase: "HR onboarding, staff screening",
  },
  {
    id: "financial_risk",
    label: "Financial Risk Bundle",
    icon: "💰",
    description: "Identity + credit + AML for financial services",
    sources: ["nimc_nin", "bvn", "credit_bureau", "nfiu_aml", "efcc_watchlist"],
    priceUSD: 5.25,
    useCase: "Loan origination, merchant onboarding",
  },
  {
    id: "comprehensive_ng",
    label: "Comprehensive Nigeria",
    icon: "🇳🇬",
    description: "All 12 Nigerian data sources — maximum coverage",
    sources: NG_DATA_SOURCES.map(s => s.id),
    priceUSD: 9.25,
    useCase: "High-value transactions, C-suite screening",
  },
];

// ─────────────────────────────────────────────────────────────────────────────

interface BundleFormData {
  subjectId: string;
  fullName: string;
  nin: string;
  bvn: string;
  licenseNumber: string;
  vin: string;
  passportNumber: string;
  dateOfBirth: string;
  rcNumber: string;
  tin: string;
  phoneNumber: string;
  selectedSources: string[];
}

interface SourceResult {
  sourceId: string;
  status: "verified" | "not_found" | "mismatch" | "error" | "pending";
  data?: Record<string, string>;
  message?: string;
  checkedAt: string;
}

const STATUS_CONFIG: Record<SourceResult["status"], { label: string; color: string; bg: string; icon: string }> = {
  verified:  { label: "Verified",   color: "text-emerald-700", bg: "bg-emerald-100", icon: "✓" },
  not_found: { label: "Not Found",  color: "text-amber-700",   bg: "bg-amber-100",   icon: "?" },
  mismatch:  { label: "Mismatch",   color: "text-red-700",     bg: "bg-red-100",     icon: "✕" },
  error:     { label: "Error",      color: "text-muted-foreground",   bg: "bg-muted",   icon: "!" },
  pending:   { label: "Pending",    color: "text-blue-700",    bg: "bg-blue-100",    icon: "⟳" },
};

function NigerianDataBundlePageInner() {
  const [view, setView] = useState<"bundle" | "custom" | "results">("bundle");
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [form, setForm] = useState<BundleFormData>({
    subjectId: "", fullName: "", nin: "", bvn: "", licenseNumber: "",
    vin: "", passportNumber: "", dateOfBirth: "", rcNumber: "", tin: "", phoneNumber: "",
    selectedSources: ["nimc_nin", "bvn"],
  });
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SourceResult[]>([]);
  const [overallScore, setOverallScore] = useState(0);

  const selectedSourceData = NG_DATA_SOURCES.filter(s => form.selectedSources.includes(s.id));
  const totalPrice = selectedSourceData.reduce((sum, s) => sum + s.priceUSD, 0);

  const applyPreset = (preset: typeof BUNDLE_PRESETS[0]) => {
    setSelectedPreset(preset.id);
    setForm(f => ({ ...f, selectedSources: preset.sources }));
    setView("custom");
  };

  const toggleSource = (id: string) => {
    setForm(f => ({
      ...f,
      selectedSources: f.selectedSources.includes(id)
        ? f.selectedSources.filter(s => s !== id)
        : [...f.selectedSources, id],
    }));
  };

  const runBundle = trpc.lookup.nigerianDataBundle.useMutation({
    onSuccess: (data) => {
      const sourceResults: SourceResult[] = form.selectedSources.map((sourceId) => {
        const match = data.results.find((r: any) => r.sourceId === sourceId);
        if (match) return { ...match, status: match.status as SourceResult["status"] };
        return {
          sourceId,
          status: "pending" as SourceResult["status"],
          data: {},
          checkedAt: new Date().toISOString(),
        };
      });
      const verifiedCount = sourceResults.filter(r => r.status === "verified").length;
      const score = sourceResults.length > 0 ? Math.round((verifiedCount / sourceResults.length) * 100) : 0;
      setResults(sourceResults);
      setOverallScore(score);
      setLoading(false);
      setView("results");
    },
    onError: (e) => { toast.error(`Bundle check failed: ${e.message}`); setLoading(false); },
  });

  const handleRun = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    runBundle.mutate({
      fullName: form.fullName,
      nin: form.nin,
      bvn: form.bvn,
      phone: form.phoneNumber,
      dateOfBirth: form.dateOfBirth,
      selectedSources: form.selectedSources,
    });
  };

  return (
    <div className="min-h-screen bg-muted">
      {/* Header */}
      <div className="bg-card border-b border-border px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-700 rounded-xl flex items-center justify-center text-white text-xl">🇳🇬</div>
            <div>
              <h1 className="text-xl font-bold text-muted-foreground">Nigerian Data Bundle</h1>
              <p className="text-sm text-muted-foreground">NIMC, BVN, FRSC, INEC, CAC, EFCC, ICPC, NFIU, CRC, FIRS, NCC — all in one check</p>
            </div>
          </div>
          <div className="flex gap-2">
            {[{ v: "bundle", label: "Presets" }, { v: "custom", label: "Custom" }].map(tab => (
              <button key={tab.v} onClick={() => setView(tab.v as any)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${view === tab.v ? "bg-green-700 text-white" : "text-muted-foreground hover:bg-muted"}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6">

        {/* Bundle Presets */}
        {view === "bundle" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {BUNDLE_PRESETS.map(preset => (
                <div key={preset.id} className="bg-card rounded-2xl border border-border p-5 hover:border-green-400 transition-all cursor-pointer" onClick={() => applyPreset(preset)}>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{preset.icon}</span>
                      <div>
                        <div className="font-bold text-muted-foreground">{preset.label}</div>
                        <div className="text-xs text-muted-foreground">{preset.useCase}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold text-green-700">${preset.priceUSD.toFixed(2)}</div>
                      <div className="text-xs text-muted-foreground">per check</div>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">{preset.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {preset.sources.map(sourceId => {
                      const src = NG_DATA_SOURCES.find(s => s.id === sourceId);
                      return src ? (
                        <span key={sourceId} className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{src.icon} {src.label.split("—")[0].trim()}</span>
                      ) : null;
                    })}
                  </div>
                  <button className="mt-4 w-full bg-green-700 hover:bg-green-800 text-white font-medium py-2 rounded-xl text-sm transition-all">
                    Use This Bundle →
                  </button>
                </div>
              ))}
            </div>

            {/* All data sources overview */}
            <SectionCard title="All Available Nigerian Data Sources" icon="📋">
              <div className="space-y-2">
                {["Identity", "Financial", "Corporate", "Compliance", "Telecom"].map(cat => (
                  <div key={cat}>
                    <div className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold mb-2 ${CATEGORY_COLORS[cat]}`}>{cat}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
                      {NG_DATA_SOURCES.filter(s => s.category === cat).map(src => (
                        <div key={src.id} className="flex items-center justify-between p-3 bg-muted rounded-xl text-sm">
                          <div className="flex items-center gap-2">
                            <span>{src.icon}</span>
                            <div>
                              <div className="font-medium text-muted-foreground text-xs">{src.label}</div>
                              <div className="text-xs text-muted-foreground">{src.coverage}</div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-bold text-green-700 text-xs">${src.priceUSD.toFixed(2)}</div>
                            <div className="text-xs text-muted-foreground">{src.reliability}% reliable</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        )}

        {/* Custom Builder */}
        {view === "custom" && (
          <form onSubmit={handleRun} className="space-y-6">
            <SectionCard title="Subject Information" icon="👤">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground">Subject ID <span className="text-red-500">*</span></label>
                  <input type="text" required value={form.subjectId}
                    onChange={e => setForm(f => ({ ...f, subjectId: e.target.value }))}
                    placeholder="e.g. INV-2024-0042"
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground">Full Name <span className="text-red-500">*</span></label>
                  <input type="text" required value={form.fullName}
                    onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
                    placeholder="Full legal name"
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground">Date of Birth</label>
                  <input type="date" value={form.dateOfBirth}
                    onChange={e => setForm(f => ({ ...f, dateOfBirth: e.target.value }))}
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground">Phone Number</label>
                  <input type="tel" value={form.phoneNumber}
                    onChange={e => setForm(f => ({ ...f, phoneNumber: e.target.value }))}
                    placeholder="+234 8XX XXX XXXX"
                    className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
                  />
                </div>
              </div>
            </SectionCard>

            {/* Document Numbers */}
            <SectionCard title="Document Numbers (provide what you have)" icon="🪪">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { id: "nin", label: "NIN", placeholder: "11-digit NIN", field: "nin" as const },
                  { id: "bvn", label: "BVN", placeholder: "11-digit BVN", field: "bvn" as const },
                  { id: "drivers_license", label: "Driver's License No.", placeholder: "e.g. AAA00000AA00", field: "licenseNumber" as const },
                  { id: "voters_card", label: "Voter ID Number (VIN)", placeholder: "19-character VIN", field: "vin" as const },
                  { id: "passport", label: "Passport Number", placeholder: "e.g. A00000000", field: "passportNumber" as const },
                  { id: "cac", label: "RC Number (Company)", placeholder: "e.g. RC1234567", field: "rcNumber" as const },
                  { id: "tax_tin", label: "TIN", placeholder: "10-digit TIN", field: "tin" as const },
                ].map(item => (
                  <div key={item.id} className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-muted-foreground">{item.label}</label>
                    <input type="text" value={form[item.field]}
                      onChange={e => setForm(f => ({ ...f, [item.field]: e.target.value }))}
                      placeholder={item.placeholder}
                      className="border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-600"
                    />
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* Source Selection */}
            <SectionCard title="Select Data Sources" icon="🔍">
              <div className="space-y-4">
                {["Identity", "Financial", "Corporate", "Compliance", "Telecom"].map(cat => (
                  <div key={cat}>
                    <div className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold mb-2 ${CATEGORY_COLORS[cat]}`}>{cat}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {NG_DATA_SOURCES.filter(s => s.category === cat).map(src => (
                        <button
                          key={src.id} type="button"
                          onClick={() => toggleSource(src.id)}
                          className={`text-left p-3 rounded-xl border-2 transition-all ${
                            form.selectedSources.includes(src.id) ? "border-green-500 bg-green-50" : "border-border bg-card hover:border-border"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span>{src.icon}</span>
                              <div>
                                <div className="font-medium text-xs text-muted-foreground">{src.label.split("—")[1]?.trim() ?? src.label}</div>
                                <div className="text-xs text-muted-foreground">{src.turnaround} · {src.reliability}% reliable</div>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-bold text-green-700 text-xs">${src.priceUSD.toFixed(2)}</div>
                              {form.selectedSources.includes(src.id) && <span className="text-green-600 font-bold text-sm">✓</span>}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {form.selectedSources.length > 0 && (
                <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-green-800 text-sm">{form.selectedSources.length} sources selected</div>
                    <div className="text-green-600 text-xs mt-0.5">
                      Avg reliability: {Math.round(selectedSourceData.reduce((s, src) => s + src.reliability, 0) / selectedSourceData.length)}%
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-green-700">${totalPrice.toFixed(2)}</div>
                </div>
              )}
            </SectionCard>

            <button
              type="submit" disabled={loading || form.selectedSources.length === 0}
              className="w-full bg-green-700 hover:bg-green-800 disabled:bg-muted text-white font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
            >
              {loading ? <><span className="animate-spin">⟳</span> Running {form.selectedSources.length} checks...</> : <><span>🇳🇬</span> Run Nigerian Data Bundle</>}
            </button>
          </form>
        )}

        {/* Results */}
        {view === "results" && (
          <div className="space-y-6">
            {/* Score Summary */}
            <div className="bg-card rounded-2xl border border-border p-6">
              <div className="flex items-center gap-6">
                <ScoreGauge score={overallScore} size={120} />
                <div>
                  <h2 className="text-xl font-bold text-muted-foreground">
                    {overallScore >= 80 ? "High Confidence" : overallScore >= 50 ? "Moderate Confidence" : "Low Confidence"}
                  </h2>
                  <p className="text-muted-foreground text-sm mt-1">
                    {results.filter(r => r.status === "verified").length} of {results.length} sources verified
                  </p>
                  <div className="flex gap-2 mt-3">
                    <RiskBadge level={overallScore >= 80 ? "low" : overallScore >= 50 ? "medium" : "high"} />
                    <span className="text-xs text-muted-foreground self-center">Overall risk level</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Individual Source Results */}
            <SectionCard title="Source Results" icon="📋">
              <div className="space-y-3">
                {results.map(result => {
                  const src = NG_DATA_SOURCES.find(s => s.id === result.sourceId);
                  const cfg = STATUS_CONFIG[result.status];
                  if (!src) return null;
                  return (
                    <div key={result.sourceId} className={`p-4 rounded-xl border ${cfg.bg} border-current/20`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{src.icon}</span>
                          <div>
                            <div className="font-semibold text-sm text-muted-foreground">{src.label}</div>
                            <div className="text-xs text-muted-foreground">{src.apiProvider}</div>
                          </div>
                        </div>
                        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${cfg.bg} ${cfg.color}`}>
                          <span>{cfg.icon}</span>
                          <span>{cfg.label}</span>
                        </div>
                      </div>
                      {result.status === "verified" && result.data && (
                        <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                          {Object.entries(result.data).map(([k, v]) => (
                            <div key={k} className="bg-card/60 rounded-lg p-2">
                              <div className="text-xs text-muted-foreground">{k}</div>
                              <div className="text-xs font-medium text-muted-foreground">{v}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      {result.message && (
                        <div className={`mt-2 text-xs ${cfg.color}`}>{result.message}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </SectionCard>

            <div className="flex gap-3">
              <button onClick={() => setView("bundle")} className="flex-1 bg-card border border-border text-muted-foreground font-medium py-3 rounded-xl text-sm">
                New Check
              </button>
              <button className="flex-1 bg-green-700 hover:bg-green-800 text-white font-semibold py-3 rounded-xl text-sm flex items-center justify-center gap-2">
                <span>📄</span> Download Full Report
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


export default function NigerianDataBundlePage() {
  return (
    <BISLayout>
      <NigerianDataBundlePageInner />
    </BISLayout>
  );
}
