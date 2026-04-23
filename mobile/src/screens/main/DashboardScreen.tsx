/**
 * Dashboard Screen — Main home screen for authenticated users.
 * Shows: summary stats, recent alerts, quick actions.
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import { alertsApi, investigationsApi } from '../../services/api';

interface StatCardProps {
  label: string;
  value: string | number;
  color: string;
}

function StatCard({ label, value, color }: StatCardProps) {
  return (
    <View style={[styles.statCard, { borderLeftColor: color }]}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function DashboardScreen() {
  const user = useSelector((state: RootState) => state.auth.user);

  const {
    data: investigations,
    isLoading: invLoading,
    refetch: refetchInv,
  } = useQuery({
    queryKey: ['investigations', 'dashboard'],
    queryFn: () => investigationsApi.list({ limit: 5, status: 'open' }),
  });

  const {
    data: alerts,
    isLoading: alertsLoading,
    refetch: refetchAlerts,
  } = useQuery({
    queryKey: ['alerts', 'dashboard'],
    queryFn: () => alertsApi.list({ isRead: 0, limit: 5 }),
  });

  const isLoading = invLoading || alertsLoading;

  const onRefresh = useCallback(() => {
    refetchInv();
    refetchAlerts();
  }, [refetchInv, refetchAlerts]);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.greeting}>
          Good {getTimeOfDay()}, {user?.name?.split(' ')[0] ?? 'Analyst'}
        </Text>
        <Text style={styles.subtitle}>BIS Platform — {new Date().toLocaleDateString('en-NG')}</Text>
      </View>

      <View style={styles.statsRow}>
        <StatCard label="Open Cases" value={investigations?.total ?? '—'} color="#3b82f6" />
        <StatCard label="Unread Alerts" value={alerts?.total ?? '—'} color="#ef4444" />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Alerts</Text>
        {alertsLoading ? (
          <ActivityIndicator color="#3b82f6" />
        ) : (
          (alerts?.data ?? []).slice(0, 5).map((alert: any) => (
            <View key={alert.id} style={styles.alertItem}>
              <View style={[styles.alertDot, { backgroundColor: getSeverityColor(alert.severity) }]} />
              <View style={styles.alertContent}>
                <Text style={styles.alertTitle}>{alert.title}</Text>
                <Text style={styles.alertTime}>{new Date(alert.createdAt).toLocaleString('en-NG')}</Text>
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          {[
            { label: 'New Investigation', color: '#3b82f6' },
            { label: 'QuickCheck', color: '#10b981' },
            { label: 'File STR', color: '#f59e0b' },
            { label: 'LEX Report', color: '#8b5cf6' },
          ].map(action => (
            <TouchableOpacity key={action.label} style={[styles.actionBtn, { backgroundColor: action.color }]}>
              <Text style={styles.actionBtnText}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function getTimeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'critical': return '#ef4444';
    case 'warning': return '#f59e0b';
    default: return '#3b82f6';
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { padding: 20, paddingTop: 10 },
  greeting: { fontSize: 22, fontWeight: '700', color: '#f8fafc' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 2 },
  statsRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 12, marginBottom: 8 },
  statCard: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
  },
  statValue: { fontSize: 28, fontWeight: '800', color: '#f8fafc' },
  statLabel: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
  section: { padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#f8fafc', marginBottom: 12 },
  alertItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  alertDot: { width: 8, height: 8, borderRadius: 4, marginRight: 12 },
  alertContent: { flex: 1 },
  alertTitle: { fontSize: 14, color: '#e2e8f0' },
  alertTime: { fontSize: 11, color: '#64748b', marginTop: 2 },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionBtn: { borderRadius: 10, paddingVertical: 14, paddingHorizontal: 16, minWidth: '45%' },
  actionBtnText: { color: '#fff', fontWeight: '600', fontSize: 14, textAlign: 'center' },
});
