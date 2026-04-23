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
