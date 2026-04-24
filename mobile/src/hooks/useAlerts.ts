import { useState, useEffect, useCallback } from 'react';
import { alertsApi } from '../services/api';

interface Alert {
  id: number;
  ruleId: number;
  ruleName: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'acknowledged' | 'resolved' | 'escalated';
  subject: string;
  description: string;
  triggeredAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  assignedTo?: string;
}

export function useAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await alertsApi.list({ limit: 50 });
      setAlerts((result.data ?? []) as Alert[]);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load alerts'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const acknowledge = useCallback(async (alertId: number) => {
    await alertsApi.markRead(String(alertId));
    setAlerts(prev =>
      prev.map(a => a.id === alertId ? { ...a, status: 'acknowledged' as const, acknowledgedAt: new Date().toISOString() } : a)
    );
  }, []);

  const escalate = useCallback(async (alertId: number) => {
    // Escalation marks as escalated status
    await alertsApi.markRead(String(alertId));
    setAlerts(prev =>
      prev.map(a => a.id === alertId ? { ...a, status: 'escalated' as const } : a)
    );
  }, []);

  return {
    alerts,
    loading,
    error,
    refresh: fetchAlerts,
    acknowledge,
    escalate,
  };
}
