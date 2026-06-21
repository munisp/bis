/**
 * InsiderThreatScreen — Real-time insider threat event feed for the BIS mobile app.
 *
 * Features:
 *   - KPI summary bar (total, open, high/critical, resolved)
 *   - Severity-filtered event list with pull-to-refresh and infinite scroll
 *   - Inline status triage (open → investigating → resolved / false_positive)
 *   - Event detail modal with HMAC integrity hash display
 *   - Auto-refresh every 60 seconds
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
  Alert,
} from 'react-native';
import { useInsiderEvents } from '../../hooks/useInsiderThreat';
import { InsiderEvent } from '../../services/api';
import { colors, typography, spacing } from '../../utils/theme';

const SEVERITY_COLORS: Record<string, string> = {
  critical: colors.critical,
  high: colors.high,
  medium: colors.medium,
  low: colors.low,
};

const STATUS_COLORS: Record<string, string> = {
  open: colors.open,
  investigating: colors.info,
  resolved: colors.success,
  false_positive: colors.textMuted,
};

const CATEGORY_ICONS: Record<string, string> = {
  data_exfiltration: '📤',
  privilege_abuse: '🔑',
  off_hours_access: '🌙',
  policy_violation: '⚠️',
  anomalous_behavior: '🔍',
  account_takeover: '👤',
  lateral_movement: '↔️',
};

const SEVERITY_FILTERS = ['all', 'critical', 'high', 'medium', 'low'];
const STATUS_FILTERS = ['all', 'open', 'investigating', 'resolved', 'false_positive'];

export function InsiderThreatScreen() {
  const [severityFilter, setSeverityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState<InsiderEvent | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const {
    events,
    total,
    loading,
    refreshing,
    error,
    refresh,
    loadMore,
    hasMore,
    updateStatus,
  } = useInsiderEvents({
    severity: severityFilter === 'all' ? undefined : severityFilter,
    status: statusFilter === 'all' ? undefined : statusFilter,
    autoRefreshMs: 60_000,
  });

  // KPI counts derived from the loaded events
  const openCount = events.filter(e => e.status === 'open').length;
  const criticalHighCount = events.filter(
    e => e.severity === 'critical' || e.severity === 'high',
  ).length;
  const resolvedCount = events.filter(e => e.status === 'resolved').length;

  const handleStatusChange = async (
    ev: InsiderEvent,
    newStatus: InsiderEvent['status'],
  ) => {
    setActionLoading(true);
    try {
      await updateStatus(ev.id, newStatus);
      setSelected(null);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to update status');
    } finally {
      setActionLoading(false);
    }
  };

  const renderEvent = ({ item }: { item: InsiderEvent }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => setSelected(item)}
      activeOpacity={0.75}
    >
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.severityBadge,
            { backgroundColor: SEVERITY_COLORS[item.severity] + '22' },
          ]}
        >
          <Text
            style={[styles.severityText, { color: SEVERITY_COLORS[item.severity] }]}
          >
            {item.severity.toUpperCase()}
          </Text>
        </View>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: STATUS_COLORS[item.status] + '22' },
          ]}
        >
          <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] }]}>
            {item.status.replace('_', ' ').toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.categoryIcon}>
          {CATEGORY_ICONS[item.category] ?? '🛡️'}
        </Text>
        <View style={styles.cardContent}>
          <Text style={styles.subjectText} numberOfLines={1}>
            {item.subjectId}
          </Text>
          <Text style={styles.categoryText}>
            {item.category.replace(/_/g, ' ')}
          </Text>
          {item.anomalyScore !== undefined && (
            <Text style={styles.scoreText}>
              Anomaly: {(item.anomalyScore * 100).toFixed(0)}%
            </Text>
          )}
        </View>
        <Text style={styles.timeText}>
          {new Date(item.createdAt).toLocaleTimeString()}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderFooter = () => {
    if (!hasMore) return null;
    return (
      <ActivityIndicator
        color={colors.primary}
        style={{ marginVertical: spacing.md }}
      />
    );
  };

  return (
    <View style={styles.container}>
      {/* KPI Bar */}
      <View style={styles.kpiBar}>
        <View style={styles.kpiItem}>
          <Text style={styles.kpiValue}>{total}</Text>
          <Text style={styles.kpiLabel}>Total</Text>
        </View>
        <View style={[styles.kpiItem, styles.kpiDivider]}>
          <Text style={[styles.kpiValue, { color: colors.error }]}>{openCount}</Text>
          <Text style={styles.kpiLabel}>Open</Text>
        </View>
        <View style={[styles.kpiItem, styles.kpiDivider]}>
          <Text style={[styles.kpiValue, { color: colors.high }]}>
            {criticalHighCount}
          </Text>
          <Text style={styles.kpiLabel}>High+</Text>
        </View>
        <View style={[styles.kpiItem, styles.kpiDivider]}>
          <Text style={[styles.kpiValue, { color: colors.success }]}>
            {resolvedCount}
          </Text>
          <Text style={styles.kpiLabel}>Resolved</Text>
        </View>
      </View>

      {/* Severity Filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={styles.filterContent}
      >
        {SEVERITY_FILTERS.map(f => (
          <TouchableOpacity
            key={f}
            style={[
              styles.filterChip,
              severityFilter === f && styles.filterChipActive,
            ]}
            onPress={() => setSeverityFilter(f)}
          >
            <Text
              style={[
                styles.filterChipText,
                severityFilter === f && styles.filterChipTextActive,
              ]}
            >
              {f === 'all' ? 'All Severity' : f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Status Filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={styles.filterContent}
      >
        {STATUS_FILTERS.map(f => (
          <TouchableOpacity
            key={f}
            style={[
              styles.filterChip,
              statusFilter === f && styles.filterChipActive,
            ]}
            onPress={() => setStatusFilter(f)}
          >
            <Text
              style={[
                styles.filterChipText,
                statusFilter === f && styles.filterChipTextActive,
              ]}
            >
              {f === 'all' ? 'All Status' : f.replace('_', ' ')}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Error */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Event List */}
      {loading && events.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.loadingText}>Loading events...</Text>
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={item => String(item.id)}
          renderItem={renderEvent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={colors.primary}
            />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🛡️</Text>
              <Text style={styles.emptyText}>No events found</Text>
              <Text style={styles.emptySubtext}>
                Adjust filters or pull to refresh
              </Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* Event Detail Modal */}
      <Modal
        visible={!!selected}
        animationType="slide"
        transparent
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <ScrollView>
              {selected && (
                <>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>
                      {CATEGORY_ICONS[selected.category] ?? '🛡️'}{' '}
                      {selected.category.replace(/_/g, ' ').toUpperCase()}
                    </Text>
                    <TouchableOpacity onPress={() => setSelected(null)}>
                      <Text style={styles.closeButton}>✕</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Subject</Text>
                    <Text style={styles.detailValue}>{selected.subjectId}</Text>
                  </View>
                  {selected.tenantId && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Tenant</Text>
                      <Text style={styles.detailValue}>{selected.tenantId}</Text>
                    </View>
                  )}
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Severity</Text>
                    <Text
                      style={[
                        styles.detailValue,
                        { color: SEVERITY_COLORS[selected.severity] },
                      ]}
                    >
                      {selected.severity.toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Status</Text>
                    <Text
                      style={[
                        styles.detailValue,
                        { color: STATUS_COLORS[selected.status] },
                      ]}
                    >
                      {selected.status.replace('_', ' ').toUpperCase()}
                    </Text>
                  </View>
                  {selected.anomalyScore !== undefined && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Anomaly Score</Text>
                      <Text style={styles.detailValue}>
                        {(selected.anomalyScore * 100).toFixed(1)}%
                      </Text>
                    </View>
                  )}
                  {selected.driftScore !== undefined && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Drift Score</Text>
                      <Text style={styles.detailValue}>
                        {(selected.driftScore * 100).toFixed(1)}%
                      </Text>
                    </View>
                  )}
                  {selected.sourceIp && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Source IP</Text>
                      <Text style={styles.detailValue}>{selected.sourceIp}</Text>
                    </View>
                  )}
                  {selected.resourcePath && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Resource</Text>
                      <Text style={styles.detailValue} numberOfLines={2}>
                        {selected.resourcePath}
                      </Text>
                    </View>
                  )}
                  {selected.payloadBytes !== undefined && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Payload</Text>
                      <Text style={styles.detailValue}>
                        {(selected.payloadBytes / 1024).toFixed(1)} KB
                      </Text>
                    </View>
                  )}
                  {selected.ruleId && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Rule</Text>
                      <Text style={styles.detailValue}>{selected.ruleId}</Text>
                    </View>
                  )}
                  {selected.integrityHash && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Integrity</Text>
                      <Text style={[styles.detailValue, styles.hashText]} numberOfLines={1}>
                        {selected.integrityHash.substring(0, 16)}…
                      </Text>
                    </View>
                  )}
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Created</Text>
                    <Text style={styles.detailValue}>
                      {new Date(selected.createdAt).toLocaleString()}
                    </Text>
                  </View>

                  {/* Action Buttons */}
                  {selected.status === 'open' && (
                    <TouchableOpacity
                      style={[styles.actionButton, { backgroundColor: colors.info }]}
                      onPress={() => handleStatusChange(selected, 'investigating')}
                      disabled={actionLoading}
                    >
                      {actionLoading ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.actionButtonText}>Start Investigating</Text>
                      )}
                    </TouchableOpacity>
                  )}
                  {selected.status === 'investigating' && (
                    <>
                      <TouchableOpacity
                        style={[styles.actionButton, { backgroundColor: colors.success }]}
                        onPress={() => handleStatusChange(selected, 'resolved')}
                        disabled={actionLoading}
                      >
                        {actionLoading ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Text style={styles.actionButtonText}>Mark Resolved</Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.actionButton,
                          { backgroundColor: colors.textMuted, marginTop: spacing.sm },
                        ]}
                        onPress={() => handleStatusChange(selected, 'false_positive')}
                        disabled={actionLoading}
                      >
                        <Text style={styles.actionButtonText}>False Positive</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  kpiBar: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  kpiItem: {
    flex: 1,
    alignItems: 'center',
  },
  kpiDivider: {
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  kpiValue: {
    ...typography.h2,
    color: colors.text,
  },
  kpiLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  filterRow: {
    maxHeight: 44,
    backgroundColor: colors.backgroundSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    flexDirection: 'row',
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primary + '33',
    borderColor: colors.primary,
  },
  filterChipText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  filterChipTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  errorBanner: {
    backgroundColor: colors.error + '22',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.error + '44',
  },
  errorText: {
    ...typography.body,
    color: colors.error,
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    ...typography.body,
    color: colors.textMuted,
  },
  listContent: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  severityBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 6,
  },
  severityText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  categoryIcon: {
    fontSize: 24,
  },
  cardContent: {
    flex: 1,
  },
  subjectText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  categoryText: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  scoreText: {
    ...typography.caption,
    color: colors.warning,
    marginTop: 2,
  },
  timeText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
    gap: spacing.sm,
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyText: {
    ...typography.h3,
    color: colors.textSecondary,
  },
  emptySubtext: {
    ...typography.body,
    color: colors.textMuted,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  modalTitle: {
    ...typography.h3,
    color: colors.text,
    flex: 1,
  },
  closeButton: {
    ...typography.h3,
    color: colors.textMuted,
    paddingLeft: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailLabel: {
    ...typography.body,
    color: colors.textMuted,
    flex: 1,
  },
  detailValue: {
    ...typography.body,
    color: colors.text,
    flex: 2,
    textAlign: 'right',
  },
  hashText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: colors.textMuted,
  },
  actionButton: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionButtonText: {
    ...typography.body,
    color: '#fff',
    fontWeight: '700',
  },
});
