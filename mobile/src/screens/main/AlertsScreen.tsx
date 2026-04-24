/**
 * AlertsScreen — real-time compliance alerts with acknowledge/escalate actions.
 * Displays severity badges, status indicators, and a detail modal.
 */
import React, { useState } from 'react';
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
} from 'react-native';
import { useAlerts } from '../../hooks/useAlerts';
import { colors, typography, spacing } from '../../utils/theme';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
};

const STATUS_COLORS: Record<string, string> = {
  open: '#3b82f6',
  acknowledged: '#8b5cf6',
  resolved: '#22c55e',
  escalated: '#ef4444',
};

interface Alert {
  id: number;
  ruleId: number;
  ruleName: string;
  severity: string;
  status: string;
  subject: string;
  description: string;
  triggeredAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  assignedTo?: string;
}

export function AlertsScreen() {
  const { alerts, loading, error, refresh, acknowledge, escalate } = useAlerts();
  const [selected, setSelected] = useState<Alert | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const handleAcknowledge = async (alertId: number) => {
    setActionLoading(true);
    try {
      await acknowledge(alertId);
      setSelected(null);
    } finally {
      setActionLoading(false);
    }
  };

  const handleEscalate = async (alertId: number) => {
    setActionLoading(true);
    try {
      await escalate(alertId);
      setSelected(null);
    } finally {
      setActionLoading(false);
    }
  };

  const renderAlert = ({ item }: { item: Alert }) => (
    <TouchableOpacity style={styles.card} onPress={() => setSelected(item)} activeOpacity={0.7}>
      <View style={styles.cardHeader}>
        <View style={[styles.severityBadge, { backgroundColor: SEVERITY_COLORS[item.severity] + '22' }]}>
          <Text style={[styles.severityText, { color: SEVERITY_COLORS[item.severity] }]}>
            {item.severity.toUpperCase()}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] + '22' }]}>
          <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] }]}>
            {item.status.toUpperCase()}
          </Text>
        </View>
      </View>
      <Text style={styles.ruleName}>{item.ruleName}</Text>
      <Text style={styles.subject} numberOfLines={1}>{item.subject}</Text>
      <Text style={styles.description} numberOfLines={2}>{item.description}</Text>
      <Text style={styles.timestamp}>
        {new Date(item.triggeredAt).toLocaleString()}
      </Text>
    </TouchableOpacity>
  );

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Failed to load alerts</Text>
        <TouchableOpacity style={styles.retryButton} onPress={refresh}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const openCount = (alerts as Alert[]).filter((a: Alert) => a.status === 'open').length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Alerts</Text>
        {openCount > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{openCount} open</Text>
          </View>
        )}
      </View>

      <FlatList
        data={alerts as Alert[]}
        keyExtractor={(item: Alert) => String(item.id)}
        renderItem={renderAlert}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.primary} />}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.loader} color={colors.primary} />
          ) : (
            <View style={styles.centered}>
              <Text style={styles.emptyText}>No alerts found</Text>
            </View>
          )
        }
      />

      {/* Alert Detail Modal */}
      <Modal
        visible={!!selected}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelected(null)}
      >
        {selected && (
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Alert Detail</Text>
              <TouchableOpacity onPress={() => setSelected(null)}>
                <Text style={styles.closeButton}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Rule</Text>
                <Text style={styles.detailValue}>{selected.ruleName}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Severity</Text>
                <Text style={[styles.detailValue, { color: SEVERITY_COLORS[selected.severity] }]}>
                  {selected.severity.toUpperCase()}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Status</Text>
                <Text style={[styles.detailValue, { color: STATUS_COLORS[selected.status] }]}>
                  {selected.status.toUpperCase()}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Subject</Text>
                <Text style={styles.detailValue}>{selected.subject}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Description</Text>
                <Text style={styles.detailValue}>{selected.description}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Triggered</Text>
                <Text style={styles.detailValue}>{new Date(selected.triggeredAt).toLocaleString()}</Text>
              </View>
              {selected.acknowledgedAt && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Acknowledged</Text>
                  <Text style={styles.detailValue}>{new Date(selected.acknowledgedAt).toLocaleString()}</Text>
                </View>
              )}
            </ScrollView>
            {selected.status === 'open' && (
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.actionButton, styles.acknowledgeButton]}
                  onPress={() => handleAcknowledge(selected.id)}
                  disabled={actionLoading}
                >
                  {actionLoading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.actionButtonText}>Acknowledge</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, styles.escalateButton]}
                  onPress={() => handleEscalate(selected.id)}
                  disabled={actionLoading}
                >
                  <Text style={styles.actionButtonText}>Escalate</Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: { ...typography.h2, color: colors.text },
  countBadge: { backgroundColor: '#ef444422', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  countText: { color: '#ef4444', fontSize: 12, fontWeight: '600' },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  severityBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  severityText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 10, fontWeight: '600' },
  ruleName: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 2 },
  subject: { fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
  description: { fontSize: 12, color: colors.textMuted, lineHeight: 17, marginBottom: 6 },
  timestamp: { fontSize: 11, color: colors.textMuted },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  errorText: { color: '#ef4444', fontSize: 14, marginBottom: 12 },
  retryButton: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
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
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionButton: { flex: 1, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  acknowledgeButton: { backgroundColor: '#8b5cf6' },
  escalateButton: { backgroundColor: '#ef4444' },
  actionButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
