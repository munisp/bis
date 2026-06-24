/**
 * useInsiderThreat — data hooks for insider threat, UEBA, and access review screens.
 * All hooks auto-refresh every 30 seconds to surface new events in near-real-time.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { insiderThreatApi } from '../services/api';

const REFRESH_INTERVAL_MS = 30_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InsiderEvent {
  id: number;
  userId: string;
  userName: string;
  eventType: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  description: string;
  sourceIp?: string;
  resourceAccessed?: string;
  anomalyScore: number;
  detectedAt: string;
  resolvedAt?: string;
  tenantId?: number;
}

export interface UebaProfile {
  id: number;
  userId: string;
  userName: string;
  department?: string;
  riskScore: number;
  riskTier: 'low' | 'medium' | 'high' | 'critical';
  anomalyCount: number;
  lastActivity?: string;
  baselineComputed: boolean;
  flaggedBehaviors: string[];
  updatedAt: string;
}

export interface AccessReview {
  id: number;
  targetUserId: string;
  targetUserName: string;
  reviewType: string;
  status: 'pending' | 'in_progress' | 'approved' | 'revoked' | 'escalated';
  requestedBy: string;
  reviewedBy?: string;
  decision?: string;
  notes?: string;
  dueAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface DashboardSummary {
  openEvents: number;
  criticalEvents: number;
  highRiskUsers: number;
  pendingReviews: number;
  recentEvents: InsiderEvent[];
}

// ── useInsiderEvents ──────────────────────────────────────────────────────────

export function useInsiderEvents(params?: Record<string, string | number>) {
  const [events, setEvents] = useState<InsiderEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await insiderThreatApi.listEvents({ limit: 50, ...params });
      setEvents((result.data ?? []) as InsiderEvent[]);
      setTotal(result.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load insider events'));
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(params)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch();
    timerRef.current = setInterval(fetch, REFRESH_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetch]);

  const updateStatus = useCallback(async (id: number, status: string, notes?: string) => {
    await insiderThreatApi.updateEventStatus(id, status, notes);
    setEvents(prev =>
      prev.map(e => e.id === id ? { ...e, status: status as InsiderEvent['status'] } : e)
    );
  }, []);

  return { events, total, loading, error, refresh: fetch, updateStatus };
}

// ── useDashboardSummary ───────────────────────────────────────────────────────

export function useDashboardSummary() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await insiderThreatApi.getDashboardSummary();
      setSummary(result.data as DashboardSummary);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load dashboard'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    timerRef.current = setInterval(fetch, REFRESH_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetch]);

  return { summary, loading, error, refresh: fetch };
}

// ── useUebaProfiles ───────────────────────────────────────────────────────────

export function useUebaProfiles(params?: Record<string, string | number>) {
  const [profiles, setProfiles] = useState<UebaProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await insiderThreatApi.listUebaProfiles({ limit: 50, ...params });
      setProfiles((result.data ?? []) as UebaProfile[]);
      setTotal(result.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load UEBA profiles'));
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(params)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch();
    timerRef.current = setInterval(fetch, REFRESH_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetch]);

  const refreshProfile = useCallback(async (userId: string) => {
    await insiderThreatApi.refreshUebaProfile(userId);
    await fetch();
  }, [fetch]);

  return { profiles, total, loading, error, refresh: fetch, refreshProfile };
}

// ── useAccessReviews ──────────────────────────────────────────────────────────

export function useAccessReviews(params?: Record<string, string | number>) {
  const [reviews, setReviews] = useState<AccessReview[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await insiderThreatApi.listAccessReviews({ limit: 50, ...params });
      setReviews((result.data ?? []) as AccessReview[]);
      setTotal(result.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load access reviews'));
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(params)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch();
    timerRef.current = setInterval(fetch, REFRESH_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetch]);

  const completeReview = useCallback(async (id: number, decision: string, notes?: string) => {
    await insiderThreatApi.completeAccessReview(id, decision, notes);
    setReviews(prev =>
      prev.map(r => r.id === id
        ? { ...r, status: decision === 'approve' ? 'approved' : 'revoked' as AccessReview['status'], decision, completedAt: new Date().toISOString() }
        : r
      )
    );
  }, []);

  return { reviews, total, loading, error, refresh: fetch, completeReview };
}
