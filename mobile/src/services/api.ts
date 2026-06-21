/**
 * BIS Mobile API Service
 * Thin wrapper around fetch for the BIS REST API.
 * Uses MMKV for token storage and automatic token refresh.
 */

import { MMKV } from 'react-native-mmkv';

const storage = new MMKV({ id: 'bis-auth' });

export const BIS_API_URL = __DEV__
  ? 'http://10.0.2.2:3000/api' // Android emulator → host machine
  : 'https://bis.example.ng/api';

export function getStoredToken(): string | undefined {
  return storage.getString('access_token');
}

export function setStoredToken(token: string): void {
  storage.set('access_token', token);
}

export function clearStoredToken(): void {
  storage.delete('access_token');
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string | number>,
): Promise<T> {
  let url = `${BIS_API_URL}${path}`;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (qs) url += `?${qs}`;
  }

  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'bis-mobile/1.0.0',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw Object.assign(new Error(data.message ?? `HTTP ${response.status}`), {
      statusCode: response.status,
      data,
    });
  }

  return data as T;
}

// ── Auth ───────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    request<{ token: string; user: Record<string, unknown> }>('POST', '/auth/login', { email, password }),

  biometricLogin: (challenge: string, signature: string) =>
    request<{ token: string; user: Record<string, unknown> }>('POST', '/auth/biometric', { challenge, signature }),

  me: () => request<Record<string, unknown>>('GET', '/auth/me'),

  logout: () => request<void>('POST', '/auth/logout'),
};

// ── Investigations ─────────────────────────────────────────────────────────────

export const investigationsApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/investigations', undefined, params),

  get: (id: string) => request<Record<string, unknown>>('GET', `/investigations/${id}`),

  create: (data: Record<string, unknown>) =>
    request<Record<string, unknown>>('POST', '/investigations', data),

  update: (id: string, data: Record<string, unknown>) =>
    request<Record<string, unknown>>('PATCH', `/investigations/${id}`, data),

  addNote: (id: string, note: string) =>
    request<void>('POST', `/investigations/${id}/notes`, { note }),

  dispatchFieldAgent: (id: string, agentId: string, location: string) =>
    request<void>('POST', `/investigations/${id}/dispatch`, { agentId, location }),
};

// ── Alerts ─────────────────────────────────────────────────────────────────────

export const alertsApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/alerts', undefined, params),

  markRead: (id: string) => request<void>('POST', `/alerts/${id}/read`),

  markAllRead: () => request<void>('POST', '/alerts/read-all'),
};

// ── QuickCheck ─────────────────────────────────────────────────────────────────

export const quickCheckApi = {
  run: (data: Record<string, unknown>) =>
    request<Record<string, unknown>>('POST', '/quickcheck', data),

  getResult: (requestId: string) =>
    request<Record<string, unknown>>('GET', `/quickcheck/${requestId}`),

  getHistory: () =>
    request<{ data: unknown[] }>('GET', '/quickcheck/history'),
};

// ── Evidence ───────────────────────────────────────────────────────────────────

export const evidenceApi = {
  upload: async (investigationId: string, fileUri: string, mimeType: string, description: string) => {
    const formData = new FormData();
    formData.append('file', { uri: fileUri, type: mimeType, name: 'evidence' } as unknown as Blob);
    formData.append('investigationId', investigationId);
    formData.append('description', description);

    const token = getStoredToken();
    const response = await fetch(`${BIS_API_URL}/evidence/upload`, {
      method: 'POST',
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
        Accept: 'application/json',
      },
      body: formData,
    });
    return response.json();
  },
};

// ── Field Agent ────────────────────────────────────────────────────────────────

export const fieldAgentApi = {
  getAssignments: () =>
    request<{ data: unknown[] }>('GET', '/field-agent/assignments'),

  updateLocation: (lat: number, lng: number) =>
    request<void>('POST', '/field-agent/location', { lat, lng }),

  completeAssignment: (assignmentId: string, notes: string) =>
    request<void>('POST', `/field-agent/assignments/${assignmentId}/complete`, { notes }),
};

// ── KYC / KYB ─────────────────────────────────────────────────────────────────
export const kycApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/kyc/records', undefined, params),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/kyc/records/${id}`),
  create: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/kyc/verify', data),
  update: (id: number, data: Record<string, unknown>) =>
    request<{ data: unknown }>('PUT', `/kyc/records/${id}`, data),
  delete: (id: number) =>
    request<void>('DELETE', `/kyc/records/${id}`),
  bulkExport: (ids: number[]) =>
    request<{ url: string }>('POST', '/kyc/records/export', { ids }),
};

// ── AML ───────────────────────────────────────────────────────────────────────
export const amlApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/aml/transactions', undefined, params),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/aml/transactions/${id}`),
  screen: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/aml/screen', data),
  screenWithEngine: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/aml/screen-engine', data),
  listSanctions: (params?: Record<string, string | number>) =>
    request<{ data: unknown[] }>('GET', '/aml/sanctions', undefined, params),
  stats: () =>
    request<{ data: unknown }>('GET', '/aml/stats'),
  travelRule: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/aml/travel-rule', data),
};

// ── Screening ─────────────────────────────────────────────────────────────────
export const screeningApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/screening/records', undefined, params),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/screening/records/${id}`),
  create: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/screening/create', data),
  update: (id: number, data: Record<string, unknown>) =>
    request<{ data: unknown }>('PUT', `/screening/records/${id}`, data),
  delete: (id: number) =>
    request<void>('DELETE', `/screening/records/${id}`),
};

// ── Cases ─────────────────────────────────────────────────────────────────────
export const casesApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/cases', undefined, params),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/cases/${id}`),
  create: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/cases', data),
  update: (id: number, data: Record<string, unknown>) =>
    request<{ data: unknown }>('PUT', `/cases/${id}`, data),
  delete: (id: number) =>
    request<void>('DELETE', `/cases/${id}`),
  addNote: (id: number, note: string) =>
    request<void>('POST', `/cases/${id}/notes`, { note }),
  escalate: (id: number) =>
    request<void>('POST', `/cases/${id}/escalate`),
};

// ── Biometric ─────────────────────────────────────────────────────────────────
export const biometricApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/biometric/enrollments', undefined, params),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/biometric/enrollments/${id}`),
  enroll: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/biometric/enroll', data),
  verify: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/biometric/verify', data),
  revoke: (id: number) =>
    request<void>('DELETE', `/biometric/enrollments/${id}`),
};

// ── Onboarding ────────────────────────────────────────────────────────────────
export const onboardingApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/onboarding/applications', undefined, params),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/onboarding/applications/${id}`),
  create: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/onboarding/apply', data),
  update: (id: number, data: Record<string, unknown>) =>
    request<{ data: unknown }>('PUT', `/onboarding/applications/${id}`, data),
  approve: (id: number) =>
    request<void>('POST', `/onboarding/applications/${id}/approve`),
  reject: (id: number, reason: string) =>
    request<void>('POST', `/onboarding/applications/${id}/reject`, { reason }),
};

// ── goAML STR ─────────────────────────────────────────────────────────────────
export const goAmlApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/goaml/reports', undefined, params),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/goaml/reports/${id}`),
  create: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/goaml/reports', data),
  update: (id: number, data: Record<string, unknown>) =>
    request<{ data: unknown }>('PUT', `/goaml/reports/${id}`, data),
  submit: (id: number) =>
    request<void>('POST', `/goaml/reports/${id}/submit`),
  delete: (id: number) =>
    request<void>('DELETE', `/goaml/reports/${id}`),
  getXml: (id: number) =>
    request<{ xml: string }>('GET', `/goaml/reports/${id}/xml`),
  stats: () =>
    request<{ data: unknown }>('GET', '/goaml/stats'),
};

// ── Payment Rails ─────────────────────────────────────────────────────────────
export const paymentRailsApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/payment-rails', undefined, params),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/payment-rails/${id}`),
  create: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/payment-rails', data),
  update: (id: number, data: Record<string, unknown>) =>
    request<{ data: unknown }>('PUT', `/payment-rails/${id}`, data),
  freeze: (accountId: string, reason: string) =>
    request<void>('POST', '/payment-rails/freeze', { accountId, reason }),
  unfreeze: (accountId: string) =>
    request<void>('POST', '/payment-rails/unfreeze', { accountId }),
  stats: () =>
    request<{ data: unknown }>('GET', '/payment-rails/stats'),
};

// ── Document Vault ────────────────────────────────────────────────────────────
export const documentVaultApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/documents', undefined, params),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/documents/${id}`),
  delete: (id: number) =>
    request<void>('DELETE', `/documents/${id}`),
  getDownloadUrl: (id: number) =>
    request<{ url: string }>('GET', `/documents/${id}/download`),
};

// ── Regulatory Reports ────────────────────────────────────────────────────────
export const regulatoryReportsApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/regulatory-reports', undefined, params),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/regulatory-reports/${id}`),
  create: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/regulatory-reports', data),
  update: (id: number, data: Record<string, unknown>) =>
    request<{ data: unknown }>('PUT', `/regulatory-reports/${id}`, data),
  submit: (id: number) =>
    request<void>('POST', `/regulatory-reports/${id}/submit`),
  delete: (id: number) =>
    request<void>('DELETE', `/regulatory-reports/${id}`),
};

// ── Duplicate Identity Check ──────────────────────────────────────────────────
export const duplicateCheckApi = {
  check: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/duplicate-check', data),
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/duplicate-check/history', undefined, params),
};

// ── Alert Rules ───────────────────────────────────────────────────────────────
export const alertRulesApi = {
  list: () =>
    request<{ data: unknown[] }>('GET', '/alert-rules'),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/alert-rules/${id}`),
  create: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/alert-rules', data),
  update: (id: number, data: Record<string, unknown>) =>
    request<{ data: unknown }>('PUT', `/alert-rules/${id}`, data),
  delete: (id: number) =>
    request<void>('DELETE', `/alert-rules/${id}`),
  testFire: (id: number) =>
    request<{ data: unknown }>('POST', `/alert-rules/${id}/test`),
};

// ── Social Monitoring ─────────────────────────────────────────────────────────
export const socialMonitoringApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/social-monitoring', undefined, params),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/social-monitoring/${id}`),
  create: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/social-monitoring', data),
  delete: (id: number) =>
    request<void>('DELETE', `/social-monitoring/${id}`),
};

// ── Nigerian Data Bundle ──────────────────────────────────────────────────────
export const nigerianDataApi = {
  lookup: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/nigeria-data/lookup', data),
  listRecords: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/nigeria-data/records', undefined, params),
};

// ── Hosted Verify Links ───────────────────────────────────────────────────────
export const hostedLinksApi = {
  list: () =>
    request<{ data: unknown[] }>('GET', '/hosted-links'),
  create: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/hosted-links', data),
  revoke: (id: number) =>
    request<void>('DELETE', `/hosted-links/${id}`),
};

// ── LEX ───────────────────────────────────────────────────────────────────────
export const lexApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/lex/submissions', undefined, params),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/lex/submissions/${id}`),
  submit: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/lex/submit', data),
  update: (id: number, data: Record<string, unknown>) =>
    request<{ data: unknown }>('PUT', `/lex/submissions/${id}`, data),
  analytics: () =>
    request<{ data: unknown }>('GET', '/lex/analytics'),
};

// ── Tenants & API Keys ────────────────────────────────────────────────────────
export const tenantsApi = {
  list: () =>
    request<{ data: unknown[] }>('GET', '/tenants'),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/tenants/${id}`),
  create: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/tenants', data),
  update: (id: number, data: Record<string, unknown>) =>
    request<{ data: unknown }>('PUT', `/tenants/${id}`, data),
  delete: (id: number) =>
    request<void>('DELETE', `/tenants/${id}`),
  rotateKey: (id: number) =>
    request<{ key: string }>('POST', `/tenants/${id}/rotate-key`),
};

// ── Reports ───────────────────────────────────────────────────────────────────
export const reportsApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/reports', undefined, params),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/reports/${id}`),
  create: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/reports', data),
  delete: (id: number) =>
    request<void>('DELETE', `/reports/${id}`),
  download: (id: number) =>
    request<{ url: string }>('GET', `/reports/${id}/download`),
};

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const dashboardApi = {
  stats: () =>
    request<{ data: unknown }>('GET', '/dashboard/stats'),
  recentActivity: () =>
    request<{ data: unknown[] }>('GET', '/dashboard/activity'),
};

// ── SAR Filings ───────────────────────────────────────────────────────────────
export const sarApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/sar', undefined, params),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/sar/${id}`),
  create: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/sar', data),
  update: (id: number, data: Record<string, unknown>) =>
    request<{ data: unknown }>('PUT', `/sar/${id}`, data),
  submit: (id: number) =>
    request<void>('POST', `/sar/${id}/submit`),
  delete: (id: number) =>
    request<void>('DELETE', `/sar/${id}`),
};

// ── Trade Finance ─────────────────────────────────────────────────────────────
export const tradeFinanceApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/trade-finance', undefined, params),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/trade-finance/${id}`),
  create: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/trade-finance', data),
  update: (id: number, data: Record<string, unknown>) =>
    request<{ data: unknown }>('PUT', `/trade-finance/${id}`, data),
  approve: (id: number) =>
    request<void>('POST', `/trade-finance/${id}/approve`),
  reject: (id: number, reason: string) =>
    request<void>('POST', `/trade-finance/${id}/reject`, { reason }),
};

// ── Correspondent Banking ─────────────────────────────────────────────────────
export const correspondentBankingApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/correspondent-banking', undefined, params),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/correspondent-banking/${id}`),
  create: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/correspondent-banking', data),
  update: (id: number, data: Record<string, unknown>) =>
    request<{ data: unknown }>('PUT', `/correspondent-banking/${id}`, data),
  delete: (id: number) =>
    request<void>('DELETE', `/correspondent-banking/${id}`),
};

// ── Risk Dashboard ────────────────────────────────────────────────────────────
export const riskDashboardApi = {
  summary: () =>
    request<{ data: unknown }>('GET', '/risk-dashboard/summary'),
  entityRisk: (params?: Record<string, string | number>) =>
    request<{ data: unknown[] }>('GET', '/risk-dashboard/entities', undefined, params),
  trends: () =>
    request<{ data: unknown }>('GET', '/risk-dashboard/trends'),
};

// ── Billing ───────────────────────────────────────────────────────────────────
export const billingApi = {
  summary: () =>
    request<{ data: unknown }>('GET', '/billing/summary'),
  transactions: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/billing/transactions', undefined, params),
  invoices: () =>
    request<{ data: unknown[] }>('GET', '/billing/invoices'),
};

// ── Audit Log ─────────────────────────────────────────────────────────────────
export const auditLogApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/audit-log', undefined, params),
};

// ── Users ─────────────────────────────────────────────────────────────────────
export const usersApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/users', undefined, params),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/users/${id}`),
  update: (id: number, data: Record<string, unknown>) =>
    request<{ data: unknown }>('PUT', `/users/${id}`, data),
  updateRole: (id: number, role: string) =>
    request<void>('PUT', `/users/${id}/role`, { role }),
  delete: (id: number) =>
    request<void>('DELETE', `/users/${id}`),
};

// ── Continuous Monitoring ─────────────────────────────────────────────────────
export const continuousMonitoringApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/continuous-monitoring', undefined, params),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/continuous-monitoring/${id}`),
  create: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/continuous-monitoring', data),
  update: (id: number, data: Record<string, unknown>) =>
    request<{ data: unknown }>('PUT', `/continuous-monitoring/${id}`, data),
  delete: (id: number) =>
    request<void>('DELETE', `/continuous-monitoring/${id}`),
};

// ── Messaging Channels ────────────────────────────────────────────────────────
export const messagingApi = {
  list: (params?: Record<string, string | number>) =>
    request<{ data: unknown[]; total: number }>('GET', '/messaging', undefined, params),
  send: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/messaging/send', data),
  getThread: (id: number) =>
    request<{ data: unknown }>('GET', `/messaging/threads/${id}`),
};

// ── Data Sources ──────────────────────────────────────────────────────────────
export const dataSourcesApi = {
  list: () =>
    request<{ data: unknown[] }>('GET', '/data-sources'),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/data-sources/${id}`),
  create: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/data-sources', data),
  update: (id: number, data: Record<string, unknown>) =>
    request<{ data: unknown }>('PUT', `/data-sources/${id}`, data),
  delete: (id: number) =>
    request<void>('DELETE', `/data-sources/${id}`),
  test: (id: number) =>
    request<{ ok: boolean; latencyMs: number }>('POST', `/data-sources/${id}/test`),
};

// ── Playbooks ─────────────────────────────────────────────────────────────────
export const playbooksApi = {
  list: () =>
    request<{ data: unknown[] }>('GET', '/playbooks'),
  get: (id: number) =>
    request<{ data: unknown }>('GET', `/playbooks/${id}`),
  create: (data: Record<string, unknown>) =>
    request<{ data: unknown }>('POST', '/playbooks', data),
  update: (id: number, data: Record<string, unknown>) =>
    request<{ data: unknown }>('PUT', `/playbooks/${id}`, data),
  delete: (id: number) =>
    request<void>('DELETE', `/playbooks/${id}`),
};

// ── Lakehouse Analytics ───────────────────────────────────────────────────────
export const lakehouseApi = {
  stats: () =>
    request<{ data: unknown }>('GET', '/lakehouse/stats'),
  runQuery: (sql: string, params?: unknown[]) =>
    request<{ data: unknown[] }>('POST', '/lakehouse/query', { sql, params }),
  listTables: () =>
    request<{ data: string[] }>('GET', '/lakehouse/tables'),
};

// ── Insider Threat ────────────────────────────────────────────────────────────
// All calls go through the BFF tRPC batch endpoint at /api/trpc/insiderThreat.*
// The mobile app uses the same REST-style wrapper (request()) but targets the
// tRPC batch URL so the BFF can handle auth and dual-control enforcement.

export interface InsiderEvent {
  id: number;
  subjectId: string;
  tenantId?: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  anomalyScore?: number;
  driftScore?: number;
  sourceIp?: string;
  resourcePath?: string;
  payloadBytes?: number;
  ruleId?: string;
  integrityHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UebaProfile {
  id: number;
  subjectId: string;
  tenantId?: string;
  anomalyScore: number;
  driftScore: number;
  offHoursRatio: number;
  failedAuthCount: number;
  privilegeChangeCount: number;
  baselineReady: boolean;
  lastRefreshedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccessReview {
  id: number;
  subjectId: string;
  tenantId?: string;
  reviewType: string;
  status: 'pending' | 'approved' | 'revoked' | 'escalated' | 'expired';
  reviewerId?: string;
  secondApproverId?: string;
  decision?: string;
  reason?: string;
  slaHours: number;
  dueAt: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Call a tRPC query procedure via the batch GET endpoint */
async function trpcQuery<T>(
  procedure: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const token = getStoredToken();
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  const url = `${BIS_API_URL}/trpc/${procedure}?input=${encoded}&batch=1`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`tRPC ${procedure} failed: ${res.status}`);
  const json = await res.json();
  // tRPC batch response: [{ result: { data: { json: T } } }]
  return json[0]?.result?.data?.json as T;
}

/** Call a tRPC mutation procedure via the batch POST endpoint */
async function trpcMutate<T>(
  procedure: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const token = getStoredToken();
  const url = `${BIS_API_URL}/trpc/${procedure}?batch=1`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
    body: JSON.stringify([{ json: input }]),
  });
  if (!res.ok) throw new Error(`tRPC ${procedure} mutation failed: ${res.status}`);
  const json = await res.json();
  return json[0]?.result?.data?.json as T;
}

export const insiderThreatApi = {
  // Events
  listEvents: (params: {
    page?: number;
    pageSize?: number;
    severity?: string;
    status?: string;
    tenantId?: string;
  } = {}) =>
    trpcQuery<{ events: InsiderEvent[]; total: number; page: number; pageSize: number }>(
      'insiderThreat.listEvents',
      params,
    ),

  getEvent: (id: number) =>
    trpcQuery<InsiderEvent>('insiderThreat.getEvent', { id }),

  updateEventStatus: (id: number, status: InsiderEvent['status'], notes?: string) =>
    trpcMutate<InsiderEvent>('insiderThreat.updateEventStatus', { id, status, notes }),

  // UEBA Profiles
  listUebaProfiles: (params: { page?: number; pageSize?: number; tenantId?: string } = {}) =>
    trpcQuery<{ profiles: UebaProfile[]; total: number; page: number; pageSize: number }>(
      'insiderThreat.listUebaProfiles',
      params,
    ),

  refreshUebaProfile: (subjectId: string, tenantId?: string) =>
    trpcMutate<UebaProfile>('insiderThreat.refreshUebaProfile', { subjectId, tenantId }),

  // Access Reviews
  listAccessReviews: (params: {
    page?: number;
    pageSize?: number;
    status?: string;
    tenantId?: string;
  } = {}) =>
    trpcQuery<{ reviews: AccessReview[]; total: number; page: number; pageSize: number }>(
      'insiderThreat.listAccessReviews',
      params,
    ),

  completeAccessReview: (params: {
    id: number;
    decision: 'approved' | 'revoked';
    reason: string;
    approverToken?: string;
  }) =>
    trpcMutate<AccessReview>('insiderThreat.completeAccessReview', params),

  escalateAccessReview: (id: number, reason: string) =>
    trpcMutate<AccessReview>('insiderThreat.escalateAccessReview', { id, reason }),
};
