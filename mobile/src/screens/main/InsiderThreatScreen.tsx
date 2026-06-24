/**
 * InsiderThreatScreen — live insider threat event feed with KPI summary cards,
 * severity/status badges, and a detail modal with status-update actions.
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Modal,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import { useInsiderEvents, useDashboardSummary, type InsiderEvent } from '../../hooks/useInsiderThreat';
import { colors, typography, spacing, radius } from '../../utils/theme';

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
  info: '#06b6d4',
};

const STATUS_COLOR: Record<string, string> = {
  open: '#3b82f6',
  investigating: '#8b5cf6',
  resolved: '#22c55e',
  false_positive: '#64748b',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  investigating: 'Investigating',
  resolved: 'Resolved',
  false_positive: 'False Positive',
};

export function InsiderThreatScreen() {
  const { events, total, loading, error, refresh, updateStatus } = useInsiderEvents();
  const { summary } = useDashboardSummary();
  const [selected, setSelected] = useState<InsiderEvent | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [notes, setNotes] = useState('');

  // Mobile session anomaly alert — show native dialog when concurrent sessions detected
  useEffect(() => {
    const sessionAnomalyEvents = events.filter(
      (e) => e.category === 'session_anomaly' && e.status === 'open' && e.severity !== 'info'
    );
    if (sessionAnomalyEvents.length > 0) {
      const evt = sessionAnomalyEvents[0];
      Alert.alert(
        '⚠️ Session Anomaly Detected',
        `Concurrent sessions from different IPs detected for user ${evt.subjectId}. ` +
          'This may indicate account compromise. Please review immediately.',
        [
          { text: 'Dismiss', style: 'cancel' },
          {
            text: 'Review Now',
            style: 'destructive',
            onPress: () => setSelected(evt),
          },
        ],
        { cancelable: false }
      );
    }
  // Only trigger once when events load (not on every re-render)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length]);

  const handleUpdateStatus = async (id: number, status: string) => {
    setActionLoading(true);
    try {
      await updateStatus(id, status, notes || undefined);
      setSelected(null);
      setNotes('');
    } finally {
      setActionLoading(false);
    }
  };

  const renderKpiCard = (label: string, value: number | string, accent: string) => (
    <View style={[styles.kpiCard, { borderLeftColor: accent }]}>
      <Text style={[styles.kpiValue, { color: accent }]}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );

  const renderEvent = ({ item }: { item: InsiderEvent }) => (
    <TouchableOpacity style={styles.card} onPress={() => setSelected(item)} activeOpacity={0.7}>
      <View style={styles.cardHeader}>
        <View style={[styles.badge, { backgroundColor: SEVERITY_COLOR[item.severity] + '22' }]}>
          <Text style={[styles.badgeText, { color: SEVERITY_COLOR[item.severity] }]}>
            {item.severity.toUpperCase()}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: STATUS_COLOR[item.status] + '22' }]}>
          <Text style={[styles.badgeText, { color: STATUS_COLOR[item.status] }]}>
            {STATUS_LABELS[item.status]}
          </Text>
        </View>
        <Text style={styles.anomalyScore}>Score: {item.anomalyScore.toFixed(1)}</Text>
      </View>
      <Text style={styles.eventType}>{item.eventType.replace(/_/g, ' ')}</Text>
      <Text style={styles.userName}>{item.userName}</Text>
      <Text style={styles.description} numberOfLines={2}>{item.description}</Text>
      {item.resourceAccessed && (
        <Text style={styles.resource} numberOfLines={1}>Resource: {item.resourceAccessed}</Text>
      )}
      <Text style={styles.timestamp}>{new Date(item.detectedAt).toLocaleString()}</Text>
    </TouchableOpacity>
  );

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Failed to load insider events</Text>
        <TouchableOpacity style={styles.retryButton} onPress={refresh}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* KPI Summary */}
      {summary && (
        <View style={styles.kpiRow}>
          {renderKpiCard('Open', summary.openEvents, '#3b82f6')}
          {renderKpiCard('Critical', summary.criticalEvents, '#ef4444')}
          {renderKpiCard('High-Risk Users', summary.highRiskUsers, '#f97316')}
          {renderKpiCard('Pending Reviews', summary.pendingReviews, '#8b5cf6')}
        </View>
      )}

      <View style={styles.listHeader}>
        <Text style={styles.title}>Insider Events</Text>
        <Text style={styles.totalCount}>{total} total</Text>
      </View>

      <FlatList
        data={events}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderEvent}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.loader} color={colors.primary} />
          ) : (
            <View style={styles.centered}>
              <Text style={styles.emptyText}>No insider events detected</Text>
            </View>
          )
        }
      />

      {/* Event Detail Modal */}
      <Modal
        visible={!!selected}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setSelected(null); setNotes(''); }}
      >
        {selected && (
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Event Detail</Text>
              <TouchableOpacity onPress={() => { setSelected(null); setNotes(''); }}>
                <Text style={styles.closeButton}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Event Type</Text>
                <Text style={styles.detailValue}>{selected.eventType.replace(/_/g, ' ')}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>User</Text>
                <Text style={styles.detailValue}>{selected.userName} ({selected.userId})</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Severity</Text>
                <Text style={[styles.detailValue, { color: SEVERITY_COLOR[selected.severity] }]}>
                  {selected.severity.toUpperCase()}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Anomaly Score</Text>
                <Text style={styles.detailValue}>{selected.anomalyScore.toFixed(2)}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Status</Text>
                <Text style={[styles.detailValue, { color: STATUS_COLOR[selected.status] }]}>
                  {STATUS_LABELS[selected.status]}
                </Text>
              </View>
              {selected.sourceIp && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Source IP</Text>
                  <Text style={styles.detailValue}>{selected.sourceIp}</Text>
                </View>
              )}
              {selected.resourceAccessed && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Resource</Text>
                  <Text style={styles.detailValue}>{selected.resourceAccessed}</Text>
                </View>
              )}
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Description</Text>
                <Text style={styles.detailValue}>{selected.description}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Detected At</Text>
                <Text style={styles.detailValue}>{new Date(selected.detectedAt).toLocaleString()}</Text>
              </View>

              {/* Notes input for status update */}
              {selected.status === 'open' || selected.status === 'investigating' ? (
                <View style={styles.notesSection}>
                  <Text style={styles.detailLabel}>Investigation Notes</Text>
                  <TextInput
                    style={styles.notesInput}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Add notes..."
                    placeholderTextColor={colors.textMuted}
                    multiline
                    numberOfLines={3}
                  />
                </View>
              ) : null}
            </ScrollView>

            {/* Action buttons */}
            {(selected.status === 'open' || selected.status === 'investigating') && (
              <View style={styles.modalActions}>
                {selected.status === 'open' && (
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: '#8b5cf6' }]}
                    onPress={() => handleUpdateStatus(selected.id, 'investigating')}
                    disabled={actionLoading}
                  >
                    {actionLoading
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={styles.actionButtonText}>Investigate</Text>}
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: '#22c55e' }]}
                  onPress={() => handleUpdateStatus(selected.id, 'resolved')}
                  disabled={actionLoading}
                >
                  <Text style={styles.actionButtonText}>Resolve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: '#64748b' }]}
                  onPress={() => handleUpdateStatus(selected.id, 'false_positive')}
                  disabled={actionLoading}
                >
                  <Text style={styles.actionButtonText}>False Positive</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  kpiRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: 8,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderLeftWidth: 3,
  },
  kpiValue: { fontSize: 20, fontWeight: '700' },
  kpiLabel: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: { ...typography.h2, color: colors.text },
  totalCount: { fontSize: 12, color: colors.textMuted },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: { flexDirection: 'row', gap: 6, marginBottom: 8, alignItems: 'center' },
  badge: { borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  anomalyScore: { marginLeft: 'auto', fontSize: 11, color: colors.textMuted },
  eventType: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 2, textTransform: 'capitalize' },
  userName: { fontSize: 12, color: colors.primary, marginBottom: 4 },
  description: { fontSize: 12, color: colors.textSecondary, lineHeight: 17, marginBottom: 4 },
  resource: { fontSize: 11, color: colors.textMuted, marginBottom: 4, fontFamily: 'Courier' },
  timestamp: { fontSize: 11, color: colors.textMuted },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  errorText: { color: colors.error, fontSize: 14, marginBottom: 12 },
  retryButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { color: '#fff', fontWeight: '600' },
  emptyText: { color: colors.textMuted, fontSize: 14 },
  loader: { marginTop: 40 },
  modal: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { ...typography.h3, color: colors.text },
  closeButton: { fontSize: 18, color: colors.textMuted, padding: 4 },
  modalBody: { flex: 1, padding: spacing.md },
  detailRow: { marginBottom: spacing.md },
  detailLabel: { fontSize: 11, color: colors.textMuted, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 },
  detailValue: { fontSize: 14, color: colors.text, lineHeight: 20 },
  notesSection: { marginTop: spacing.sm },
  notesInput: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    padding: spacing.sm,
    marginTop: 6,
    fontSize: 13,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 8,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionButton: { flex: 1, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center' },
  actionButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
