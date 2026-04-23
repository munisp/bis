/** BIS SDK TypeScript Types */

export interface BISClientConfig {
  /** Your BIS API key (from the Developer Portal). Defaults to BIS_API_KEY env var. */
  apiKey?: string;
  /** API base URL. Defaults to https://bis.example.ng/api/v1 */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 30000 */
  timeout?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Investigation {
  id: string;
  refNumber: string;
  subject: {
    name: string;
    nin?: string;
    bvn?: string;
    phone?: string;
  };
  status: 'open' | 'in_progress' | 'pending_review' | 'closed' | 'escalated';
  priority: 'low' | 'medium' | 'high' | 'critical';
  riskScore: number;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KYCRecord {
  id: string;
  subjectId: string;
  nin: string;
  bvn?: string;
  status: 'pending' | 'verified' | 'failed' | 'expired';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  verifiedAt?: string;
}

export interface Alert {
  id: string;
  type: 'aml' | 'sanctions' | 'fraud' | 'kyc' | 'system';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface Transaction {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  senderAccount: string;
  receiverAccount: string;
  channel: 'nip' | 'rtgs' | 'mobile' | 'ussd' | 'pos' | 'web';
  status: 'pending' | 'completed' | 'failed' | 'reversed' | 'flagged' | 'blocked';
  amlScore: number;
  createdAt: string;
}

export interface SARFiling {
  id: string;
  filingRef: string;
  reportType: 'STR' | 'CTR' | 'SAR';
  status: 'draft' | 'under_review' | 'approved' | 'filed' | 'acknowledged' | 'rejected';
  subjectName: string;
  amountInvolved: number;
  currency: string;
  filedAt?: string;
}

export interface QuickCheckResult {
  requestId: string;
  subject: {
    name: string;
    phone?: string;
    nin?: string;
  };
  verdict: 'pass' | 'flag' | 'fail';
  riskScore: number;
  checks: {
    identity: 'pass' | 'fail' | 'not_found';
    criminalRecord: 'clear' | 'flagged' | 'not_found';
    adverseMedia: 'clear' | 'flagged' | 'not_found';
    sanctions: 'clear' | 'flagged' | 'not_found';
  };
  reportUrl: string;
  completedAt: string;
}

export interface LexSubmission {
  submissionRef: string;
  agencyCode: string;
  state: string;
  incidentType: string;
  status: 'pending' | 'validated' | 'rejected' | 'linked';
  validationScore: number;
  createdAt: string;
}

export interface TransferAnalytics {
  totalVolume: number;
  totalCount: number;
  buckets: Array<{
    date: string;
    volume: number;
    count: number;
  }>;
}
