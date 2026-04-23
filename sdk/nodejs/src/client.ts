/**
 * BIS Node.js SDK — Main Client
 */

import type {
  BISClientConfig,
  PaginatedResponse,
  Investigation,
  KYCRecord,
  Alert,
  Transaction,
  SARFiling,
  QuickCheckResult,
  LexSubmission,
  TransferAnalytics,
} from './types';
import {
  BISError,
  BISAuthError,
  BISRateLimitError,
  BISNotFoundError,
} from './errors';

const DEFAULT_BASE_URL = 'https://bis.example.ng/api/v1';
const DEFAULT_TIMEOUT = 30_000;

type RequestOptions = {
  method?: string;
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

class Resource {
  constructor(protected readonly client: BISClient) {}

  protected request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.client['_request']<T>(path, options);
  }
}

class InvestigationsResource extends Resource {
  list(params?: {
    status?: string;
    priority?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<Investigation>> {
    return this.request('/investigations', { params: params as Record<string, string> });
  }

  get(id: string): Promise<Investigation> {
    return this.request(`/investigations/${id}`);
  }

  create(data: {
    subject: { name: string; nin?: string; bvn?: string; phone?: string };
    priority: string;
    notes?: string;
  }): Promise<Investigation> {
    return this.request('/investigations', { method: 'POST', body: data });
  }
}

class KYCResource extends Resource {
  list(params?: { status?: string; page?: number }): Promise<PaginatedResponse<KYCRecord>> {
    return this.request('/kyc', { params: params as Record<string, string> });
  }

  submit(data: { nin: string; bvn?: string; documentType?: string }): Promise<KYCRecord> {
    return this.request('/kyc', { method: 'POST', body: data });
  }
}

class AlertsResource extends Resource {
  list(params?: {
    severity?: string;
    isRead?: boolean;
    type?: string;
  }): Promise<PaginatedResponse<Alert>> {
    return this.request('/alerts', { params: params as Record<string, string> });
  }

  markRead(alertId: string): Promise<{ success: boolean }> {
    return this.request(`/alerts/${alertId}/read`, { method: 'POST' });
  }
}

class TransactionsResource extends Resource {
  list(params?: {
    status?: string;
    minAmlScore?: number;
    channel?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<PaginatedResponse<Transaction>> {
    return this.request('/transactions', { params: params as Record<string, string> });
  }

  flag(id: string, reason?: string): Promise<Transaction> {
    return this.request(`/transactions/${id}/flag`, {
      method: 'POST',
      body: reason ? { reason } : undefined,
    });
  }

  block(id: string): Promise<Transaction> {
    return this.request(`/transactions/${id}/block`, { method: 'POST' });
  }
}

class SARResource extends Resource {
  list(): Promise<PaginatedResponse<SARFiling>> {
    return this.request('/sar');
  }

  submit(data: {
    reportType: 'STR' | 'CTR' | 'SAR';
    subjectName: string;
    amountInvolved: number;
    narrative: string;
    currency?: string;
  }): Promise<SARFiling> {
    return this.request('/sar', { method: 'POST', body: data });
  }
}

class QuickCheckResource extends Resource {
  run(data: {
    name: string;
    phone?: string;
    nin?: string;
    bvn?: string;
    category?: string;
    tier?: 'basic' | 'standard' | 'premium';
  }): Promise<QuickCheckResult> {
    return this.request('/quickcheck', { method: 'POST', body: data });
  }
}

class LEXResource extends Resource {
  list(params?: {
    state?: string;
    status?: string;
    incidentType?: string;
  }): Promise<PaginatedResponse<LexSubmission>> {
    return this.request('/lex/submissions', { params: params as Record<string, string> });
  }

  submit(data: {
    agencyCode: string;
    state: string;
    incidentType: string;
    narrative: string;
    subjectName?: string;
    subjectNin?: string;
    subjectPhone?: string;
    gpsLat?: number;
    gpsLng?: number;
  }): Promise<LexSubmission> {
    return this.request('/lex/submissions', { method: 'POST', body: data });
  }
}

class AnalyticsResource extends Resource {
  transferVolume(params?: {
    period?: 'daily' | 'weekly' | 'monthly';
    dateFrom?: string;
    dateTo?: string;
  }): Promise<TransferAnalytics> {
    return this.request('/analytics/transfers', { params: params as Record<string, string> });
  }

  riskDistribution(): Promise<Record<string, unknown>> {
    return this.request('/analytics/risk');
  }
}

export class BISClient {
  readonly investigations: InvestigationsResource;
  readonly kyc: KYCResource;
  readonly alerts: AlertsResource;
  readonly transactions: TransactionsResource;
  readonly sar: SARResource;
  readonly quickcheck: QuickCheckResource;
  readonly lex: LEXResource;
  readonly analytics: AnalyticsResource;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(config: BISClientConfig = {}) {
    this.apiKey = config.apiKey ?? process.env['BIS_API_KEY'] ?? '';
    if (!this.apiKey) {
      throw new BISAuthError('apiKey is required. Set BIS_API_KEY env var or pass apiKey in config.');
    }
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;

    this.investigations = new InvestigationsResource(this);
    this.kyc = new KYCResource(this);
    this.alerts = new AlertsResource(this);
    this.transactions = new TransactionsResource(this);
    this.sar = new SARResource(this);
    this.quickcheck = new QuickCheckResource(this);
    this.lex = new LEXResource(this);
    this.analytics = new AnalyticsResource(this);
  }

  private async _request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body } = options;

    let url = this.baseUrl + path;
    if (params) {
      const qs = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      if (qs) url += `?${qs}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'bis-nodejs-sdk/1.0.0',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 401) throw new BISAuthError(data.message);
        if (response.status === 404) throw new BISNotFoundError(data.message);
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') ?? '60', 10);
          throw new BISRateLimitError(data.message, retryAfter);
        }
        throw new BISError(data.message ?? `HTTP ${response.status}`, response.status);
      }

      return data as T;
    } catch (err) {
      if (err instanceof BISError) throw err;
      if ((err as Error).name === 'AbortError') {
        throw new BISError(`Request timed out after ${this.timeout}ms`);
      }
      throw new BISError(`Network error: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
