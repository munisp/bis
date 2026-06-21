// useInsiderThreat.ts — React hooks for insider threat data in the BIS mobile app
//
// Provides:
//   useInsiderEvents()       — paginated event feed with severity/status filters
//   useUebaProfiles()        — UEBA profile browser with ML refresh action
//   useAccessReviews()       — access review task manager with approve/revoke/escalate

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  insiderThreatApi,
  AccessReview,
  InsiderEvent,
  UebaProfile,
} from '../services/api';

// ─── useInsiderEvents ─────────────────────────────────────────────────────────

export interface UseInsiderEventsOptions {
  severity?: string;
  status?: string;
  tenantId?: string;
  pageSize?: number;
  autoRefreshMs?: number;
}

export interface UseInsiderEventsResult {
  events: InsiderEvent[];
  total: number;
  page: number;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
  loadMore: () => void;
  hasMore: boolean;
  updateStatus: (
    id: number,
    status: InsiderEvent['status'],
    notes?: string,
  ) => Promise<void>;
}

export function useInsiderEvents(
  opts: UseInsiderEventsOptions = {},
): UseInsiderEventsResult {
  const { severity, status, tenantId, pageSize = 20, autoRefreshMs } = opts;
  const [events, setEvents] = useState<InsiderEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPage = useCallback(
    async (p: number, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await insiderThreatApi.listEvents({
          page: p,
          pageSize,
          severity,
          status,
          tenantId,
        });
        if (p === 1) {
          setEvents(res.events);
        } else {
          setEvents(prev => [...prev, ...res.events]);
        }
        setTotal(res.total);
        setPage(p);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load events');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [severity, status, tenantId, pageSize],
  );

  // Initial load and filter changes
  useEffect(() => {
    fetchPage(1);
  }, [fetchPage]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefreshMs) return;
    timerRef.current = setInterval(() => fetchPage(1, true), autoRefreshMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchPage, autoRefreshMs]);

  const refresh = useCallback(() => fetchPage(1, true), [fetchPage]);
  const loadMore = useCallback(() => {
    if (!loading && events.length < total) {
      fetchPage(page + 1);
    }
  }, [loading, events.length, total, page, fetchPage]);

  const updateStatus = useCallback(
    async (id: number, newStatus: InsiderEvent['status'], notes?: string) => {
      await insiderThreatApi.updateEventStatus(id, newStatus, notes);
      // Optimistic update
      setEvents(prev =>
        prev.map(ev =>
          ev.id === id ? { ...ev, status: newStatus } : ev,
        ),
      );
    },
    [],
  );

  return {
    events,
    total,
    page,
    loading,
    refreshing,
    error,
    refresh,
    loadMore,
    hasMore: events.length < total,
    updateStatus,
  };
}

// ─── useUebaProfiles ──────────────────────────────────────────────────────────

export interface UseUebaProfilesOptions {
  tenantId?: string;
  pageSize?: number;
}

export interface UseUebaProfilesResult {
  profiles: UebaProfile[];
  total: number;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
  loadMore: () => void;
  hasMore: boolean;
  refreshProfile: (subjectId: string, tenantId?: string) => Promise<void>;
  refreshingSubject: string | null;
}

export function useUebaProfiles(
  opts: UseUebaProfilesOptions = {},
): UseUebaProfilesResult {
  const { tenantId, pageSize = 20 } = opts;
  const [profiles, setProfiles] = useState<UebaProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshingSubject, setRefreshingSubject] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (p: number, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await insiderThreatApi.listUebaProfiles({ page: p, pageSize, tenantId });
        if (p === 1) {
          setProfiles(res.profiles);
        } else {
          setProfiles(prev => [...prev, ...res.profiles]);
        }
        setTotal(res.total);
        setPage(p);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load UEBA profiles');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [tenantId, pageSize],
  );

  useEffect(() => {
    fetchPage(1);
  }, [fetchPage]);

  const refresh = useCallback(() => fetchPage(1, true), [fetchPage]);
  const loadMore = useCallback(() => {
    if (!loading && profiles.length < total) fetchPage(page + 1);
  }, [loading, profiles.length, total, page, fetchPage]);

  const refreshProfile = useCallback(
    async (subjectId: string, tid?: string) => {
      setRefreshingSubject(subjectId);
      try {
        const updated = await insiderThreatApi.refreshUebaProfile(subjectId, tid);
        setProfiles(prev =>
          prev.map(p => (p.subjectId === subjectId ? updated : p)),
        );
      } finally {
        setRefreshingSubject(null);
      }
    },
    [],
  );

  return {
    profiles,
    total,
    loading,
    refreshing,
    error,
    refresh,
    loadMore,
    hasMore: profiles.length < total,
    refreshProfile,
    refreshingSubject,
  };
}

// ─── useAccessReviews ─────────────────────────────────────────────────────────

export interface UseAccessReviewsOptions {
  status?: string;
  tenantId?: string;
  pageSize?: number;
  autoRefreshMs?: number;
}

export interface UseAccessReviewsResult {
  reviews: AccessReview[];
  total: number;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
  loadMore: () => void;
  hasMore: boolean;
  completeReview: (params: {
    id: number;
    decision: 'approved' | 'revoked';
    reason: string;
    approverToken?: string;
  }) => Promise<void>;
  escalateReview: (id: number, reason: string) => Promise<void>;
  submitting: boolean;
}

export function useAccessReviews(
  opts: UseAccessReviewsOptions = {},
): UseAccessReviewsResult {
  const { status, tenantId, pageSize = 20, autoRefreshMs } = opts;
  const [reviews, setReviews] = useState<AccessReview[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPage = useCallback(
    async (p: number, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await insiderThreatApi.listAccessReviews({
          page: p,
          pageSize,
          status,
          tenantId,
        });
        if (p === 1) {
          setReviews(res.reviews);
        } else {
          setReviews(prev => [...prev, ...res.reviews]);
        }
        setTotal(res.total);
        setPage(p);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load access reviews');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [status, tenantId, pageSize],
  );

  useEffect(() => {
    fetchPage(1);
  }, [fetchPage]);

  useEffect(() => {
    if (!autoRefreshMs) return;
    timerRef.current = setInterval(() => fetchPage(1, true), autoRefreshMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchPage, autoRefreshMs]);

  const refresh = useCallback(() => fetchPage(1, true), [fetchPage]);
  const loadMore = useCallback(() => {
    if (!loading && reviews.length < total) fetchPage(page + 1);
  }, [loading, reviews.length, total, page, fetchPage]);

  const completeReview = useCallback(
    async (params: {
      id: number;
      decision: 'approved' | 'revoked';
      reason: string;
      approverToken?: string;
    }) => {
      setSubmitting(true);
      try {
        const updated = await insiderThreatApi.completeAccessReview(params);
        setReviews(prev => prev.map(r => (r.id === params.id ? updated : r)));
      } finally {
        setSubmitting(false);
      }
    },
    [],
  );

  const escalateReview = useCallback(async (id: number, reason: string) => {
    setSubmitting(true);
    try {
      const updated = await insiderThreatApi.escalateAccessReview(id, reason);
      setReviews(prev => prev.map(r => (r.id === id ? updated : r)));
    } finally {
      setSubmitting(false);
    }
  }, []);

  return {
    reviews,
    total,
    loading,
    refreshing,
    error,
    refresh,
    loadMore,
    hasMore: reviews.length < total,
    completeReview,
    escalateReview,
    submitting,
  };
}
