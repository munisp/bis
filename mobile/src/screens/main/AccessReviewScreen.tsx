/**
 * AccessReviewScreen — SLA-tracked access review task manager for the BIS mobile app.
 *
 * Features:
 *   - Paginated review list with SLA countdown badges
 *   - Status filter (pending / approved / revoked / escalated / expired)
 *   - Approve / Revoke modal with mandatory reason field and dual-control notice
 *   - Escalate modal with reason field
 *   - Auto-refresh every 30 seconds
 *   - Pull-to-refresh and infinite scroll
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
  TextInput,
  Alert,
} from 'react-native';
import { useAccessReviews } from '../../hooks/useInsiderThreat';
import { AccessReview } from '../../services/api';
import { colors, typography, spacing } from '../../utils/theme';

const STATUS_COLORS: Record<string, string> = {
  pending: colors.warning,
  approved: colors.success,
  revoked: colors.error,
  escalated: colors.high,
  expired: colors.textMuted,
};

const STATUS_FILTERS = ['all', 'pending', 'approved', 'revoked', 'escalated', 'expired'];

function slaLabel(dueAt: string): { text: string; color: string } {
  const msLeft = new Date(dueAt).getTime() - Date.now();
  if (msLeft <= 0) return { text: 'OVERDUE', color: colors.critical };
  const hLeft = msLeft / 3_600_000;
  if (hLeft < 1) return { text: `${Math.ceil(hLeft * 60)}m left`, color: colors.error };
  if (hLeft < 4) return { text: `${hLeft.toFixed(1)}h left`, color: colors.high };
  if (hLeft < 24) return { text: `${hLeft.toFixed(0)}h left`, color: colors.warning };
  return { text: `${(hLeft / 24).toFixed(0)}d left`, color: colors.success };
}

export function AccessReviewScreen() {
  const [statusFilter, setStatusFilter] = useState('pending');
  const [selected, setSelected] = useState<AccessReview | null>(null);
  const [modalMode, setModalMode] = useState<'decide' | 'escalate' | null>(null);
  const [decision, setDecision] = useState<'approved' | 'revoked'>('approved');
  const [reason, setReason] = useState('');

  const {
    reviews,
    total,
    loading,
    refreshing,
    error,
    refresh,
    loadMore,
    hasMore,
    completeReview,
    escalateReview,
    submitting,
  } = useAccessReviews({
    status: statusFilter === 'all' ? undefined : statusFilter,
    autoRefreshMs: 30_000,
  });

  const pendingCount = reviews.filter(r => r.status === 'pending').length;
  const overdueCount = reviews.filter(
    r => r.status === 'pending' && new Date(r.dueAt).getTime() < Date.now(),
  ).length;

  const openDecideModal = (review: AccessReview, dec: 'approved' | 'revoked') => {
    setSelected(review);
    setDecision(dec);
    setReason('');
    setModalMode('decide');
  };

  const openEscalateModal = (review: AccessReview) => {
    setSelected(review);
    setReason('');
    setModalMode('escalate');
  };

  const handleDecide = async () => {
    if (!selected || !reason.trim()) {
      Alert.alert('Reason required', 'Please provide a reason for this decision.');
      return;
    }
    try {
      await completeReview({ id: selected.id, decision, reason: reason.trim() });
      setModalMode(null);
      setSelected(null);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to complete review');
    }
  };

  const handleEscalate = async () => {
    if (!selected || !reason.trim()) {
      Alert.alert('Reason required', 'Please provide an escalation reason.');
      return;
    }
    try {
      await escalateReview(selected.id, reason.trim());
      setModalMode(null);
      setSelected(null);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to escalate review');
    }
  };

  const renderReview = ({ item }: { item: AccessReview }) => {
    const sla = slaLabel(item.dueAt);
    const isPending = item.status === 'pending';
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: STATUS_COLORS[item.status] + '22' },
            ]}
          >
            <Text
              style={[styles.statusText, { color: STATUS_COLORS[item.status] }]}
            >
              {item.status.toUpperCase()}
            </Text>
          </View>
          {isPending && (
            <View style={[styles.slaBadge, { backgroundColor: sla.color + '22' }]}>
              <Text style={[styles.slaText, { color: sla.color }]}>{sla.text}</Text>
            </View>
          )}
          <Text style={styles.reviewTypeText}>
            {item.reviewType.replace(/_/g, ' ')}
          </Text>
        </View>

        <Text style={styles.subjectText} numberOfLines={1}>
          {item.subjectId}
        </Text>
        {item.tenantId && (
          <Text style={styles.tenantText}>{item.tenantId}</Text>
        )}

        <View style={styles.metaRow}>
          <Text style={styles.metaText}>
            SLA: {item.slaHours}h · Due:{' '}
            {new Date(item.dueAt).toLocaleDateString()}
          </Text>
          {item.decision && (
            <Text style={styles.decisionText}>
              Decision: {item.decision}
            </Text>
          )}
        </View>

        {isPending && (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.success + '22', borderColor: colors.success }]}
              onPress={() => openDecideModal(item, 'approved')}
            >
              <Text style={[styles.actionBtnText, { color: colors.success }]}>
                ✓ Approve
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.error + '22', borderColor: colors.error }]}
              onPress={() => openDecideModal(item, 'revoked')}
            >
              <Text style={[styles.actionBtnText, { color: colors.error }]}>
                ✕ Revoke
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.high + '22', borderColor: colors.high }]}
              onPress={() => openEscalateModal(item)}
            >
              <Text style={[styles.actionBtnText, { color: colors.high }]}>
                ↑ Escalate
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

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
          <Text style={[styles.kpiValue, { color: colors.warning }]}>
            {pendingCount}
          </Text>
          <Text style={styles.kpiLabel}>Pending</Text>
        </View>
        <View style={[styles.kpiItem, styles.kpiDivider]}>
          <Text style={[styles.kpiValue, { color: colors.critical }]}>
            {overdueCount}
          </Text>
          <Text style={styles.kpiLabel}>Overdue</Text>
        </View>
      </View>

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
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {loading && reviews.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.loadingText}>Loading access reviews...</Text>
        </View>
      ) : (
        <FlatList
          data={reviews}
          keyExtractor={item => String(item.id)}
          renderItem={renderReview}
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
              <Text style={styles.emptyIcon}>✅</Text>
              <Text style={styles.emptyText}>No reviews found</Text>
              <Text style={styles.emptySubtext}>
                {statusFilter === 'pending'
                  ? 'No pending reviews — all clear!'
                  : 'Adjust the filter to see other reviews'}
              </Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* Decide Modal (Approve / Revoke) */}
      <Modal
        visible={modalMode === 'decide'}
        animationType="slide"
        transparent
        onRequestClose={() => setModalMode(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {decision === 'approved' ? '✓ Approve Access' : '✕ Revoke Access'}
              </Text>
              <TouchableOpacity onPress={() => setModalMode(null)}>
                <Text style={styles.closeButton}>✕</Text>
              </TouchableOpacity>
            </View>

            {selected && (
              <>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Subject</Text>
                  <Text style={styles.detailValue}>{selected.subjectId}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Review Type</Text>
                  <Text style={styles.detailValue}>
                    {selected.reviewType.replace(/_/g, ' ')}
                  </Text>
                </View>
              </>
            )}

            <View style={styles.dualControlNotice}>
              <Text style={styles.dualControlText}>
                ⚠️ Dual-control: A second approver must confirm this decision.
              </Text>
            </View>

            <Text style={styles.inputLabel}>Reason *</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Enter reason for this decision..."
              placeholderTextColor={colors.textMuted}
              value={reason}
              onChangeText={setReason}
              multiline
              numberOfLines={3}
            />

            <TouchableOpacity
              style={[
                styles.submitButton,
                {
                  backgroundColor:
                    decision === 'approved' ? colors.success : colors.error,
                },
                submitting && styles.submitButtonDisabled,
              ]}
              onPress={handleDecide}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitButtonText}>
                  {decision === 'approved' ? 'Confirm Approval' : 'Confirm Revocation'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Escalate Modal */}
      <Modal
        visible={modalMode === 'escalate'}
        animationType="slide"
        transparent
        onRequestClose={() => setModalMode(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>↑ Escalate Review</Text>
              <TouchableOpacity onPress={() => setModalMode(null)}>
                <Text style={styles.closeButton}>✕</Text>
              </TouchableOpacity>
            </View>

            {selected && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Subject</Text>
                <Text style={styles.detailValue}>{selected.subjectId}</Text>
              </View>
            )}

            <Text style={styles.inputLabel}>Escalation Reason *</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Explain why this review needs escalation..."
              placeholderTextColor={colors.textMuted}
              value={reason}
              onChangeText={setReason}
              multiline
              numberOfLines={3}
            />

            <TouchableOpacity
              style={[
                styles.submitButton,
                { backgroundColor: colors.high },
                submitting && styles.submitButtonDisabled,
              ]}
              onPress={handleEscalate}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitButtonText}>Escalate to Senior Analyst</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  kpiBar: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  kpiItem: { flex: 1, alignItems: 'center' },
  kpiDivider: { borderLeftWidth: 1, borderLeftColor: colors.border },
  kpiValue: { ...typography.h2, color: colors.text },
  kpiLabel: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
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
  filterChipText: { ...typography.caption, color: colors.textSecondary },
  filterChipTextActive: { color: colors.primary, fontWeight: '600' },
  errorBanner: {
    backgroundColor: colors.error + '22',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.error + '44',
  },
  errorText: { ...typography.body, color: colors.error, textAlign: 'center' },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: { ...typography.body, color: colors.textMuted },
  listContent: { padding: spacing.md },
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
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  slaBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 6,
  },
  slaText: { fontSize: 10, fontWeight: '700' },
  reviewTypeText: {
    ...typography.caption,
    color: colors.textMuted,
    flex: 1,
    textAlign: 'right',
    textTransform: 'capitalize',
  },
  subjectText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  tenantText: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  metaText: { ...typography.caption, color: colors.textMuted },
  decisionText: { ...typography.caption, color: colors.textSecondary },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  actionBtnText: { fontSize: 12, fontWeight: '700' },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
    gap: spacing.sm,
  },
  emptyIcon: { fontSize: 48 },
  emptyText: { ...typography.h3, color: colors.textSecondary },
  emptySubtext: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
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
  modalTitle: { ...typography.h3, color: colors.text, flex: 1 },
  closeButton: { ...typography.h3, color: colors.textMuted, paddingLeft: spacing.md },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailLabel: { ...typography.body, color: colors.textMuted, flex: 1 },
  detailValue: { ...typography.body, color: colors.text, flex: 2, textAlign: 'right' },
  dualControlNotice: {
    backgroundColor: colors.warning + '22',
    borderRadius: 8,
    padding: spacing.md,
    marginVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.warning + '44',
  },
  dualControlText: { ...typography.caption, color: colors.warning },
  inputLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  textInput: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 8,
    padding: spacing.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    textAlignVertical: 'top',
    minHeight: 80,
    ...typography.body,
  },
  submitButton: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: 10,
    alignItems: 'center',
  },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { ...typography.body, color: '#fff', fontWeight: '700' },
});
