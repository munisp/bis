// ─────────────────────────────────────────────────────────────────────────────
// BIS Shared Types — used across all PWA and mobile BIS feature pages
// ─────────────────────────────────────────────────────────────────────────────

// ── Country & Data Source ─────────────────────────────────────────────────────

export interface Country {
  code: string;           // ISO 3166-1 alpha-2
  name: string;
  flag: string;           // Emoji flag
  dataEnvironment: "rich" | "moderate" | "sparse" | "minimal";
  primarySources: string[];
  currency: string;
  phonePrefix: string;
  hasDirectAPI: boolean;
}

export const SUPPORTED_COUNTRIES: Country[] = [
  { code: "NG", name: "Nigeria", flag: "🇳🇬", dataEnvironment: "moderate", currency: "NGN", phonePrefix: "+234", hasDirectAPI: true,
    primarySources: ["NIMC NIN", "CBN BVN", "FRSC Driver's License", "INEC PVC", "CAC", "EFCC Watchlist"] },
  { code: "KE", name: "Kenya", flag: "🇰🇪", dataEnvironment: "moderate", currency: "KES", phonePrefix: "+254", hasDirectAPI: true,
    primarySources: ["Huduma Namba", "NTSA", "MPESA", "KRA PIN"] },
  { code: "GH", name: "Ghana", flag: "🇬🇭", dataEnvironment: "moderate", currency: "GHS", phonePrefix: "+233", hasDirectAPI: true,
    primarySources: ["Ghana Card (NIA)", "DVLA", "GRA TIN", "Voters ID"] },
  { code: "ZA", name: "South Africa", flag: "🇿🇦", dataEnvironment: "rich", currency: "ZAR", phonePrefix: "+27", hasDirectAPI: true,
    primarySources: ["DHA ID", "SAPS Criminal Records", "CIPC", "Credit Bureau"] },
  { code: "TZ", name: "Tanzania", flag: "🇹🇿", dataEnvironment: "sparse", currency: "TZS", phonePrefix: "+255", hasDirectAPI: false,
    primarySources: ["NIDA", "TRA TIN"] },
  { code: "UG", name: "Uganda", flag: "🇺🇬", dataEnvironment: "sparse", currency: "UGX", phonePrefix: "+256", hasDirectAPI: false,
    primarySources: ["NIRA", "URA TIN"] },
  { code: "RW", name: "Rwanda", flag: "🇷🇼", dataEnvironment: "moderate", currency: "RWF", phonePrefix: "+250", hasDirectAPI: true,
    primarySources: ["Irembo ID", "RRA TIN"] },
  { code: "SN", name: "Senegal", flag: "🇸🇳", dataEnvironment: "sparse", currency: "XOF", phonePrefix: "+221", hasDirectAPI: false,
    primarySources: ["CNI", "NINEA"] },
  { code: "CM", name: "Cameroon", flag: "🇨🇲", dataEnvironment: "sparse", currency: "XAF", phonePrefix: "+237", hasDirectAPI: false,
    primarySources: ["CNI", "RCCM"] },
  { code: "ET", name: "Ethiopia", flag: "🇪🇹", dataEnvironment: "minimal", currency: "ETB", phonePrefix: "+251", hasDirectAPI: false,
    primarySources: ["Fayda ID (new)"] },
  { code: "US", name: "United States", flag: "🇺🇸", dataEnvironment: "rich", currency: "USD", phonePrefix: "+1", hasDirectAPI: true,
    primarySources: ["SSN", "Federal Criminal", "State Criminal", "OFAC", "Credit Bureau"] },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧", dataEnvironment: "rich", currency: "GBP", phonePrefix: "+44", hasDirectAPI: true,
    primarySources: ["DBS Check", "DVLA", "Right to Work", "Credit Bureau"] },
];

export const getCountry = (code: string): Country | undefined =>
  SUPPORTED_COUNTRIES.find(c => c.code === code);

// ── Risk Levels ───────────────────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high" | "critical";

export const RISK_CONFIG: Record<RiskLevel, { label: string; color: string; bg: string; border: string; icon: string }> = {
  low:      { label: "Low Risk",      color: "text-emerald-700", bg: "bg-emerald-50",  border: "border-emerald-200", icon: "✓" },
  medium:   { label: "Medium Risk",   color: "text-amber-700",   bg: "bg-amber-50",    border: "border-amber-200",   icon: "⚠" },
  high:     { label: "High Risk",     color: "text-orange-700",  bg: "bg-orange-50",   border: "border-orange-200",  icon: "⚠" },
  critical: { label: "Critical Risk", color: "text-red-700",     bg: "bg-red-50",      border: "border-red-200",     icon: "✕" },
};

// ── Investigation Status ──────────────────────────────────────────────────────

export type InvestigationStatus =
  | "pending" | "processing" | "completed" | "flagged"
  | "ordered" | "scheduled" | "collected" | "in_lab"
  | "mro_review" | "cancelled" | "expired" | "manual_required";

export const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending:         { label: "Pending",          color: "text-slate-600",   bg: "bg-slate-100" },
  processing:      { label: "Processing",       color: "text-blue-600",    bg: "bg-blue-100" },
  completed:       { label: "Completed",        color: "text-emerald-600", bg: "bg-emerald-100" },
  flagged:         { label: "Flagged",          color: "text-red-600",     bg: "bg-red-100" },
  ordered:         { label: "Ordered",          color: "text-blue-600",    bg: "bg-blue-100" },
  scheduled:       { label: "Scheduled",        color: "text-indigo-600",  bg: "bg-indigo-100" },
  collected:       { label: "Collected",        color: "text-violet-600",  bg: "bg-violet-100" },
  in_lab:          { label: "In Lab",           color: "text-purple-600",  bg: "bg-purple-100" },
  mro_review:      { label: "MRO Review",       color: "text-amber-600",   bg: "bg-amber-100" },
  cancelled:       { label: "Cancelled",        color: "text-slate-500",   bg: "bg-slate-100" },
  expired:         { label: "Expired",          color: "text-red-500",     bg: "bg-red-100" },
  manual_required: { label: "Manual Required",  color: "text-orange-600",  bg: "bg-orange-100" },
};

// ── Nigerian Data Sources ─────────────────────────────────────────────────────

export interface NigerianDataSource {
  id: string;
  name: string;
  shortName: string;
  tier: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  category: "identity" | "business" | "financial" | "watchlist" | "criminal" | "telecom" | "education";
  provider: string;
  avgCostUSD: number;
  avgTurnaround: string;
  reliability: number;   // 0-1
  requiresConsent: boolean;
  dataReturned: string[];
  description: string;
}

export const NIGERIAN_DATA_SOURCES: NigerianDataSource[] = [
  { id: "nimc_nin", name: "National Identification Number (NIN)", shortName: "NIN", tier: 1, category: "identity",
    provider: "NIMC via Dojah/Youverify", avgCostUSD: 0.15, avgTurnaround: "< 5 seconds", reliability: 0.92,
    requiresConsent: false, dataReturned: ["Full name", "Date of birth", "Gender", "Photo", "Address", "Phone"],
    description: "Nigeria's primary biometric national identity number. Highest weight in identity verification." },
  { id: "cbn_bvn", name: "Bank Verification Number (BVN)", shortName: "BVN", tier: 1, category: "identity",
    provider: "CBN/NIBSS via Youverify", avgCostUSD: 0.20, avgTurnaround: "< 3 seconds", reliability: 0.95,
    requiresConsent: true, dataReturned: ["Full name", "Date of birth", "Phone", "Enrollment bank", "Photo"],
    description: "Bank-linked biometric identifier. Required for all Nigerian bank account holders." },
  { id: "frsc_drivers_license", name: "FRSC Driver's License", shortName: "DL", tier: 1, category: "identity",
    provider: "FRSC via Prembly", avgCostUSD: 0.12, avgTurnaround: "< 10 seconds", reliability: 0.88,
    requiresConsent: false, dataReturned: ["Full name", "Date of birth", "License class", "Expiry date", "State of issue"],
    description: "Federal Road Safety Corps driver's license verification. Also used for MVR checks." },
  { id: "inec_voters_card", name: "Permanent Voter Card (PVC)", shortName: "PVC", tier: 1, category: "identity",
    provider: "INEC via Dojah", avgCostUSD: 0.10, avgTurnaround: "< 15 seconds", reliability: 0.82,
    requiresConsent: false, dataReturned: ["Full name", "Date of birth", "Polling unit", "State", "LGA", "Ward"],
    description: "INEC voter registration card. Useful for address and LGA verification." },
  { id: "nis_passport", name: "Nigerian International Passport", shortName: "Passport", tier: 1, category: "identity",
    provider: "NIS via Youverify", avgCostUSD: 0.15, avgTurnaround: "< 5 seconds", reliability: 0.90,
    requiresConsent: false, dataReturned: ["Full name", "Date of birth", "Passport number", "Expiry date"],
    description: "Nigeria Immigration Service passport verification." },
  { id: "firs_tin", name: "Tax Identification Number (TIN)", shortName: "TIN", tier: 1, category: "identity",
    provider: "FIRS via Dojah", avgCostUSD: 0.10, avgTurnaround: "< 10 seconds", reliability: 0.85,
    requiresConsent: false, dataReturned: ["Full name", "TIN", "Registration date", "Tax office"],
    description: "Federal Inland Revenue Service tax ID. Useful for employed individuals and business owners." },
  { id: "cac_company", name: "Corporate Affairs Commission (CAC)", shortName: "CAC", tier: 2, category: "business",
    provider: "CAC/NIBSS via Mono", avgCostUSD: 0.25, avgTurnaround: "< 10 seconds", reliability: 0.90,
    requiresConsent: false, dataReturned: ["Company name", "RC number", "Directors", "Shareholders", "Status", "Date incorporated"],
    description: "Company registration verification. Required for all business entity investigations." },
  { id: "crc_credit", name: "CRC Credit Bureau Report", shortName: "Credit", tier: 3, category: "financial",
    provider: "CRC Credit Bureau via Youverify", avgCostUSD: 0.50, avgTurnaround: "< 30 seconds", reliability: 0.88,
    requiresConsent: true, dataReturned: ["Credit score", "Loan count", "Active loans", "Defaults", "Repayment history"],
    description: "Individual credit report from Nigeria's CRC Credit Bureau." },
  { id: "efcc_watchlist", name: "EFCC Watchlist", shortName: "EFCC", tier: 4, category: "watchlist",
    provider: "EFCC via Dojah", avgCostUSD: 0.20, avgTurnaround: "< 5 seconds", reliability: 0.80,
    requiresConsent: false, dataReturned: ["Wanted status", "Conviction status", "Case details", "Crime type"],
    description: "Economic and Financial Crimes Commission watchlist. Hard stop if positive hit." },
  { id: "ofac_sanctions", name: "OFAC / UN / EU Sanctions", shortName: "Sanctions", tier: 4, category: "watchlist",
    provider: "Sanctions.io", avgCostUSD: 0.02, avgTurnaround: "< 1 second", reliability: 0.999,
    requiresConsent: false, dataReturned: ["Sanctions hit", "List names", "Match score", "Entity type"],
    description: "International sanctions screening. Always included. Hard stop if positive hit." },
  { id: "npf_possap", name: "Police Clearance Certificate (POSSAP)", shortName: "PCC", tier: 5, category: "criminal",
    provider: "Nigeria Police Force", avgCostUSD: 5.00, avgTurnaround: "2-5 business days", reliability: 0.70,
    requiresConsent: true, dataReturned: ["Criminal record status", "Certificate number", "Issue date"],
    description: "Official police clearance certificate. Manual process via POSSAP portal." },
  { id: "mtn_sim", name: "MTN SIM Registration", shortName: "MTN SIM", tier: 6, category: "telecom",
    provider: "MTN Nigeria via Dojah", avgCostUSD: 0.15, avgTurnaround: "< 5 seconds", reliability: 0.90,
    requiresConsent: true, dataReturned: ["Registered name", "SIM tenure", "SIM swap count", "Active status"],
    description: "MTN SIM registration verification. Useful for subjects without formal ID." },
  { id: "waec_results", name: "WAEC Examination Results", shortName: "WAEC", tier: 7, category: "education",
    provider: "WAEC Direct", avgCostUSD: 0.30, avgTurnaround: "< 30 seconds", reliability: 0.85,
    requiresConsent: false, dataReturned: ["Candidate name", "Exam year", "Subjects", "Grades", "Certificate number"],
    description: "West African Examination Council results verification." },
  { id: "nysc_service", name: "NYSC Service Verification", shortName: "NYSC", tier: 7, category: "education",
    provider: "NYSC Portal", avgCostUSD: 0.20, avgTurnaround: "< 30 seconds", reliability: 0.80,
    requiresConsent: false, dataReturned: ["Name", "Service year", "State of deployment", "Discharge status"],
    description: "National Youth Service Corps service verification. Required for graduates." },
];

// ── MVR Types ─────────────────────────────────────────────────────────────────

export interface MVRResult {
  subjectId: string;
  country: string;
  licenseNumber: string;
  licenseStatus: "valid" | "expired" | "suspended" | "revoked" | "not_found";
  licenseClass: string;
  licenseExpiry: string;
  totalPoints: number;
  violations: MVRViolation[];
  accidentsCount: number;
  duiCount: number;
  suspensionsCount: number;
  riskScore: number;
  riskLevel: RiskLevel;
  recommendation: string;
  dataSource: string;
  verifiedAt: string;
}

export interface MVRViolation {
  date: string;
  description: string;
  severity: "minor" | "moderate" | "major" | "fatal";
  points: number;
  disposition: string;
  state: string;
}

// ── Drug Screening Types ──────────────────────────────────────────────────────

export type DrugPanel = "5_panel" | "10_panel" | "dot_5_panel" | "hair_follicle" | "oral_fluid";
export type DrugTestResult = "negative" | "positive" | "negative_dilute" | "positive_dilute" | "refusal" | "cancelled" | "inconclusive";

export interface DrugTestOrder {
  orderId: string;
  subjectId: string;
  panel: DrugPanel;
  specimenType: "urine" | "hair" | "oral_fluid";
  status: InvestigationStatus;
  collectionSite?: CollectionSite;
  orderedAt: string;
  collectionDeadline: string;
  collectedAt?: string;
  completedAt?: string;
  result?: DrugTestResult;
  substanceResults?: SubstanceResult[];
  labName?: string;
  reportUrl?: string;
}

export interface CollectionSite {
  siteId: string;
  name: string;
  address: string;
  city: string;
  country: string;
  phone: string;
  hours: string;
  distanceKm?: number;
  accredited: boolean;
}

export interface SubstanceResult {
  substance: string;
  result: string;
  cutoffNgMl: number;
  levelNgMl: number;
}

// ── Continuous Monitoring Types ───────────────────────────────────────────────

export type MonitoringType = "criminal" | "mvr" | "sanctions" | "adverse_media" | "professional_license" | "court_filings";

export interface MonitoringEnrollment {
  enrollmentId: string;
  subjectId: string;
  subjectName: string;
  monitorTypes: MonitoringType[];
  enrolledAt: string;
  expiresAt?: string;
  active: boolean;
  lastScannedAt: string;
  alertCount: number;
}

export interface MonitoringAlert {
  alertId: string;
  enrollmentId: string;
  subjectId: string;
  subjectName: string;
  monitorType: MonitoringType;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  eventDate: string;
  source: string;
  detectedAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  actionTaken?: string;
}

// ── Zero-Footprint Investigation Types ───────────────────────────────────────

export interface ZeroFootprintInvestigation {
  investigationId: string;
  subjectId: string;
  subjectName: string;
  subjectAddress: string;
  country: string;
  state: string;
  lga?: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  estimatedCompletionDays: number;
  compositeScore: number;
  confidenceLevel: number;
  riskLevel: RiskLevel;
  recommendation: string;
  fieldAgentStatus: "pending" | "assigned" | "in_progress" | "completed" | "failed";
  checklist: ChecklistItem[];
}

export interface ChecklistItem {
  step: number;
  pillar: string;
  action: string;
  required: boolean;
  estimatedHours: number;
  completed: boolean;
  completedAt?: string;
  notes?: string;
}

// ── Work Authorization Types ──────────────────────────────────────────────────

export type WorkAuthType = "us_everify" | "uk_right_to_work" | "ng_work_permit" | "ng_cerpac" | "global_passport_work";
export type WorkAuthStatus = "authorized" | "unauthorized" | "tentative_non_confirmation" | "pending" | "expired" | "not_applicable";

export interface WorkAuthResult {
  subjectId: string;
  authType: WorkAuthType;
  status: WorkAuthStatus;
  authorizedUntil?: string;
  documentValid: boolean;
  documentExpiry?: string;
  permitType?: string;
  restrictions?: string[];
  notes?: string;
  dataSource: string;
  verifiedAt: string;
}
