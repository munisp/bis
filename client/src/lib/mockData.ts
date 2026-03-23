// BIS Mock Data Store — replaces tRPC calls for standalone PWA demo
// Design: Forensic Intelligence Dark theme

export type InvestigationStatus = 'pending' | 'processing' | 'completed' | 'flagged' | 'draft';
export type InvestigationTier = 'basic' | 'standard' | 'comprehensive';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type EntityType = 'individual' | 'corporate' | 'government' | 'ngo';

export interface Investigation {
  id: string;
  ref: string;
  subjectName: string;
  subjectType: EntityType;
  tier: InvestigationTier;
  status: InvestigationStatus;
  riskScore: number;
  riskLevel: RiskLevel;
  country: string;
  createdAt: string;
  updatedAt: string;
  assignedTo: string;
  tags: string[];
  dataSources: string[];
  progress: number;
}

export interface BiometricRecord {
  id: string;
  bui: string; // BIS Unique Identifier
  subjectName: string;
  enrolledAt: string;
  enrolledBy: string;
  location: string;
  faceConfidence: number;
  fingerprintConfidence: number;
  livenessScore: number;
  status: 'verified' | 'pending' | 'duplicate' | 'failed';
  duplicateOf?: string;
}

export interface KYCRecord {
  id: string;
  subjectName: string;
  documentType: string;
  documentNumber: string;
  country: string;
  status: 'verified' | 'pending' | 'rejected' | 'expired';
  ocrConfidence: number;
  faceMatchScore: number;
  livenessScore: number;
  tamperingScore: number;
  submittedAt: string;
  verifiedAt?: string;
}

export interface MonitoringAlert {
  id: string;
  subjectRef: string;
  subjectName: string;
  alertType: 'criminal_record' | 'sanctions' | 'adverse_media' | 'pep' | 'license_change' | 'financial';
  severity: RiskLevel;
  source: string;
  summary: string;
  detectedAt: string;
  status: 'new' | 'reviewed' | 'dismissed' | 'escalated';
}

export interface FieldAgent {
  id: string;
  name: string;
  agentCode: string;
  region: string;
  state: string;
  enrollmentsToday: number;
  enrollmentsTotal: number;
  qualityScore: number;
  rewardBalance: number;
  status: 'active' | 'suspended' | 'pending';
  lastActive: string;
}

export interface DataSource {
  id: string;
  name: string;
  category: string;
  country: string;
  status: 'connected' | 'degraded' | 'offline';
  avgResponseMs: number;
  successRate: number;
  lastChecked: string;
  checksToday: number;
}

// ─── Mock Investigations ───────────────────────────────────────────────────
export const mockInvestigations: Investigation[] = [
  { id: '1', ref: 'BIS-2026-0001', subjectName: 'Adebayo Okafor', subjectType: 'individual', tier: 'comprehensive', status: 'completed', riskScore: 82, riskLevel: 'high', country: 'NG', createdAt: '2026-03-10T08:00:00Z', updatedAt: '2026-03-12T14:30:00Z', assignedTo: 'AI Engine', tags: ['EFCC Watch', 'PEP'], dataSources: ['NIMC', 'BVN', 'EFCC', 'NPF', 'INEC'], progress: 100 },
  { id: '2', ref: 'BIS-2026-0002', subjectName: 'Zenith Logistics Ltd', subjectType: 'corporate', tier: 'standard', status: 'processing', riskScore: 45, riskLevel: 'medium', country: 'NG', createdAt: '2026-03-15T10:00:00Z', updatedAt: '2026-03-15T16:00:00Z', assignedTo: 'AI Engine', tags: ['CAC Registered'], dataSources: ['CAC', 'FIRS', 'CRC'], progress: 65 },
  { id: '3', ref: 'BIS-2026-0003', subjectName: 'Chidinma Eze', subjectType: 'individual', tier: 'basic', status: 'completed', riskScore: 12, riskLevel: 'low', country: 'NG', createdAt: '2026-03-18T09:00:00Z', updatedAt: '2026-03-18T11:00:00Z', assignedTo: 'AI Engine', tags: ['Clean Record'], dataSources: ['NIMC', 'BVN'], progress: 100 },
  { id: '4', ref: 'BIS-2026-0004', subjectName: 'Emeka Nwosu', subjectType: 'individual', tier: 'comprehensive', status: 'flagged', riskScore: 91, riskLevel: 'critical', country: 'NG', createdAt: '2026-03-19T07:00:00Z', updatedAt: '2026-03-20T09:00:00Z', assignedTo: 'AI Engine', tags: ['Sanctions Hit', 'EFCC Watch', 'Adverse Media'], dataSources: ['NIMC', 'EFCC', 'ICPC', 'OFAC', 'NPF'], progress: 100 },
  { id: '5', ref: 'BIS-2026-0005', subjectName: 'Lagos Tourism Board', subjectType: 'government', tier: 'standard', status: 'pending', riskScore: 0, riskLevel: 'low', country: 'NG', createdAt: '2026-03-22T11:00:00Z', updatedAt: '2026-03-22T11:00:00Z', assignedTo: 'Unassigned', tags: [], dataSources: [], progress: 0 },
  { id: '6', ref: 'BIS-2026-0006', subjectName: 'Fatima Al-Hassan', subjectType: 'individual', tier: 'standard', status: 'processing', riskScore: 38, riskLevel: 'low', country: 'NG', createdAt: '2026-03-21T14:00:00Z', updatedAt: '2026-03-22T08:00:00Z', assignedTo: 'AI Engine', tags: [], dataSources: ['NIMC', 'BVN', 'INEC'], progress: 72 },
  { id: '7', ref: 'BIS-2026-0007', subjectName: 'Greenfield Agro Ltd', subjectType: 'corporate', tier: 'comprehensive', status: 'completed', riskScore: 28, riskLevel: 'low', country: 'NG', createdAt: '2026-03-14T08:00:00Z', updatedAt: '2026-03-16T17:00:00Z', assignedTo: 'AI Engine', tags: ['Clean Record'], dataSources: ['CAC', 'FIRS', 'CRC', 'EFCC'], progress: 100 },
  { id: '8', ref: 'BIS-2026-0008', subjectName: 'Ibrahim Musa', subjectType: 'individual', tier: 'basic', status: 'draft', riskScore: 0, riskLevel: 'low', country: 'NG', createdAt: '2026-03-23T10:00:00Z', updatedAt: '2026-03-23T10:00:00Z', assignedTo: 'Unassigned', tags: [], dataSources: [], progress: 0 },
];

// ─── Mock Biometric Records ────────────────────────────────────────────────
export const mockBiometrics: BiometricRecord[] = [
  { id: '1', bui: 'BUI-NG-2026-000001', subjectName: 'Adebayo Okafor', enrolledAt: '2026-03-10T08:30:00Z', enrolledBy: 'AGT-0042', location: 'Lagos, Ikeja', faceConfidence: 98.7, fingerprintConfidence: 99.1, livenessScore: 97.3, status: 'verified' },
  { id: '2', bui: 'BUI-NG-2026-000002', subjectName: 'Chidinma Eze', enrolledAt: '2026-03-18T09:15:00Z', enrolledBy: 'AGT-0018', location: 'Enugu, GRA', faceConfidence: 97.2, fingerprintConfidence: 98.5, livenessScore: 99.0, status: 'verified' },
  { id: '3', bui: 'BUI-NG-2026-000003', subjectName: 'Emeka Nwosu', enrolledAt: '2026-03-19T07:45:00Z', enrolledBy: 'AGT-0031', location: 'Abuja, Maitama', faceConfidence: 95.1, fingerprintConfidence: 96.8, livenessScore: 94.2, status: 'verified' },
  { id: '4', bui: 'BUI-NG-2026-000004', subjectName: 'Fatima Al-Hassan', enrolledAt: '2026-03-21T14:20:00Z', enrolledBy: 'AGT-0055', location: 'Kano, Nassarawa', faceConfidence: 88.4, fingerprintConfidence: 91.2, livenessScore: 86.7, status: 'pending' },
  { id: '5', bui: 'BUI-NG-2026-000005', subjectName: 'Tunde Bakare (Duplicate)', enrolledAt: '2026-03-20T11:00:00Z', enrolledBy: 'AGT-0042', location: 'Lagos, Ikeja', faceConfidence: 99.2, fingerprintConfidence: 99.8, livenessScore: 98.1, status: 'duplicate', duplicateOf: 'BUI-NG-2026-000001' },
];

// ─── Mock KYC Records ─────────────────────────────────────────────────────
export const mockKYCRecords: KYCRecord[] = [
  { id: '1', subjectName: 'Adebayo Okafor', documentType: 'National ID (NIN)', documentNumber: 'NIN-7823****', country: 'NG', status: 'verified', ocrConfidence: 98.2, faceMatchScore: 97.8, livenessScore: 99.1, tamperingScore: 0.3, submittedAt: '2026-03-10T08:00:00Z', verifiedAt: '2026-03-10T08:05:00Z' },
  { id: '2', subjectName: 'Chidinma Eze', documentType: "Driver's Licence (FRSC)", documentNumber: 'ABJ-****-2024', country: 'NG', status: 'verified', ocrConfidence: 96.5, faceMatchScore: 95.2, livenessScore: 97.8, tamperingScore: 1.1, submittedAt: '2026-03-18T09:00:00Z', verifiedAt: '2026-03-18T09:04:00Z' },
  { id: '3', subjectName: 'Ibrahim Musa', documentType: 'International Passport', documentNumber: 'A0****23', country: 'NG', status: 'pending', ocrConfidence: 91.3, faceMatchScore: 0, livenessScore: 0, tamperingScore: 2.4, submittedAt: '2026-03-23T10:00:00Z' },
  { id: '4', subjectName: 'Unknown Subject', documentType: 'Voters Card (INEC)', documentNumber: 'VIN-****', country: 'NG', status: 'rejected', ocrConfidence: 45.2, faceMatchScore: 32.1, livenessScore: 88.0, tamperingScore: 78.4, submittedAt: '2026-03-22T15:00:00Z' },
];

// ─── Mock Monitoring Alerts ────────────────────────────────────────────────
export const mockAlerts: MonitoringAlert[] = [
  { id: '1', subjectRef: 'BIS-2026-0004', subjectName: 'Emeka Nwosu', alertType: 'sanctions', severity: 'critical', source: 'OFAC SDN List', summary: 'Subject appears on OFAC Specially Designated Nationals list under Executive Order 13224.', detectedAt: '2026-03-20T09:00:00Z', status: 'escalated' },
  { id: '2', subjectRef: 'BIS-2026-0001', subjectName: 'Adebayo Okafor', alertType: 'adverse_media', severity: 'high', source: 'Punch Newspaper', summary: 'Subject mentioned in investigative report on procurement fraud at Lagos State Ministry.', detectedAt: '2026-03-19T14:30:00Z', status: 'reviewed' },
  { id: '3', subjectRef: 'BIS-2026-0002', subjectName: 'Zenith Logistics Ltd', alertType: 'criminal_record', severity: 'medium', source: 'NPF POSSAP', summary: 'Director Ade Bello has a 2019 fraud charge (acquitted) on record.', detectedAt: '2026-03-15T16:00:00Z', status: 'reviewed' },
  { id: '4', subjectRef: 'BIS-2026-0006', subjectName: 'Fatima Al-Hassan', alertType: 'pep', severity: 'medium', source: 'INEC Database', summary: 'Subject is a registered political party official (ward level). PEP classification applied.', detectedAt: '2026-03-22T08:00:00Z', status: 'new' },
  { id: '5', subjectRef: 'BIS-2026-0007', subjectName: 'Greenfield Agro Ltd', alertType: 'license_change', severity: 'low', source: 'CAC Registry', summary: 'Company filed for change of registered address. New address verified.', detectedAt: '2026-03-16T10:00:00Z', status: 'dismissed' },
];

// ─── Mock Field Agents ─────────────────────────────────────────────────────
export const mockAgents: FieldAgent[] = [
  { id: '1', name: 'Oluwaseun Adeyemi', agentCode: 'AGT-0042', region: 'South-West', state: 'Lagos', enrollmentsToday: 12, enrollmentsTotal: 847, qualityScore: 96.2, rewardBalance: 423.50, status: 'active', lastActive: '2026-03-23T09:45:00Z' },
  { id: '2', name: 'Aisha Suleiman', agentCode: 'AGT-0018', region: 'South-East', state: 'Enugu', enrollmentsToday: 8, enrollmentsTotal: 612, qualityScore: 94.8, rewardBalance: 306.00, status: 'active', lastActive: '2026-03-23T10:15:00Z' },
  { id: '3', name: 'Chukwuemeka Obi', agentCode: 'AGT-0031', region: 'FCT', state: 'Abuja', enrollmentsToday: 15, enrollmentsTotal: 1203, qualityScore: 98.1, rewardBalance: 601.50, status: 'active', lastActive: '2026-03-23T10:30:00Z' },
  { id: '4', name: 'Musa Tanko', agentCode: 'AGT-0055', region: 'North-West', state: 'Kano', enrollmentsToday: 6, enrollmentsTotal: 389, qualityScore: 87.3, rewardBalance: 194.50, status: 'active', lastActive: '2026-03-23T08:00:00Z' },
  { id: '5', name: 'Blessing Okonkwo', agentCode: 'AGT-0067', region: 'South-South', state: 'Rivers', enrollmentsToday: 0, enrollmentsTotal: 245, qualityScore: 72.1, rewardBalance: 122.50, status: 'suspended', lastActive: '2026-03-20T14:00:00Z' },
];

// ─── Mock Data Sources ─────────────────────────────────────────────────────
export const mockDataSources: DataSource[] = [
  { id: '1', name: 'NIMC Identity Verification', category: 'Identity', country: 'NG', status: 'connected', avgResponseMs: 342, successRate: 99.2, lastChecked: '2026-03-23T10:00:00Z', checksToday: 1247 },
  { id: '2', name: 'CBN BVN Lookup', category: 'Financial', country: 'NG', status: 'connected', avgResponseMs: 218, successRate: 98.7, lastChecked: '2026-03-23T10:00:00Z', checksToday: 892 },
  { id: '3', name: 'EFCC Watchlist API', category: 'Criminal/Legal', country: 'NG', status: 'connected', avgResponseMs: 567, successRate: 97.1, lastChecked: '2026-03-23T10:00:00Z', checksToday: 456 },
  { id: '4', name: 'NPF POSSAP', category: 'Criminal/Legal', country: 'NG', status: 'degraded', avgResponseMs: 1823, successRate: 84.3, lastChecked: '2026-03-23T10:00:00Z', checksToday: 123 },
  { id: '5', name: 'CAC Company Registry', category: 'Corporate', country: 'NG', status: 'connected', avgResponseMs: 445, successRate: 99.5, lastChecked: '2026-03-23T10:00:00Z', checksToday: 334 },
  { id: '6', name: 'INEC Voter Registry', category: 'Identity', country: 'NG', status: 'connected', avgResponseMs: 289, successRate: 98.9, lastChecked: '2026-03-23T10:00:00Z', checksToday: 678 },
  { id: '7', name: 'FRSC Driver Licence', category: 'Identity', country: 'NG', status: 'connected', avgResponseMs: 512, successRate: 96.4, lastChecked: '2026-03-23T10:00:00Z', checksToday: 289 },
  { id: '8', name: 'OFAC SDN Sanctions', category: 'Sanctions', country: 'GLOBAL', status: 'connected', avgResponseMs: 145, successRate: 99.9, lastChecked: '2026-03-23T10:00:00Z', checksToday: 1891 },
  { id: '9', name: 'ICPC Watchlist', category: 'Criminal/Legal', country: 'NG', status: 'offline', avgResponseMs: 0, successRate: 0, lastChecked: '2026-03-22T18:00:00Z', checksToday: 0 },
  { id: '10', name: 'MTN Mobile Money', category: 'Telecom/Mobile Money', country: 'NG', status: 'connected', avgResponseMs: 198, successRate: 99.1, lastChecked: '2026-03-23T10:00:00Z', checksToday: 567 },
];

// ─── Dashboard Stats ───────────────────────────────────────────────────────
export const dashboardStats = {
  totalInvestigations: 2847,
  activeInvestigations: 143,
  completedToday: 28,
  flaggedCritical: 7,
  biometricEnrollments: 48291,
  duplicatesDetected: 134,
  kycVerificationsToday: 892,
  kycPassRate: 94.2,
  activeMonitors: 1203,
  alertsToday: 47,
  fieldAgents: 312,
  dataSourcesOnline: 23,
  avgRiskScore: 34.2,
  avgProcessingTimeMin: 4.7,
};

// ─── Helpers ───────────────────────────────────────────────────────────────
export function getRiskColor(level: RiskLevel): string {
  switch (level) {
    case 'low': return 'text-emerald-400';
    case 'medium': return 'text-amber-400';
    case 'high': return 'text-orange-400';
    case 'critical': return 'text-red-400';
  }
}

export function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'completed': case 'verified': case 'connected': case 'active': return 'bis-badge-verified';
    case 'pending': case 'processing': case 'new': return 'bis-badge-processing';
    case 'flagged': case 'rejected': case 'failed': case 'offline': case 'escalated': return 'bis-badge-flagged';
    case 'draft': case 'dismissed': case 'suspended': return 'bis-badge-draft';
    case 'degraded': case 'reviewed': return 'bis-badge-pending';
    default: return 'bis-badge-draft';
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
