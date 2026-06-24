/**
 * AccessReviewScreen — access review task manager with dual-control approve/revoke.
 * Shows pending reviews, due dates, and allows reviewers to complete tasks with notes.
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
import { useAccessReviews, type AccessReview } from '../../hooks/useInsiderThreat';
import { colors, typography, spacing, radius } from '../../utils/theme';

const STATUS_COLOR: Record<string, string> = {
  pending: '#eab308',
  in_progress: '#3b82f6',
  approved: '#22c55e',
  revoked: '#ef4444',
  escalated: '#f97316',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  approved: 'Approved',
  revoked: 'Revoked',
  escalated: 'Escalated',
};

const REVIEW_TYPE_LABEL: Record<string, string> = {
  access_certification: 'Access Certification',
  privilege_review: 'Privilege Review',
  separation_of_duties: 'Separation of Duties',
  termination_review: 'Termination Review',
  periodic_recertification: 'Periodic Recertification',
};

function isOverdue(dueAt?: string): boolean {
  if (!dueAt) return false;
  return new Date(dueAt) < new Date();
}

export function AccessReviewScreen() {
  const { reviews, total, loading, error, refresh, completeReview } = useAccessReviews();
  const [selected, setSelected] = useState<AccessReview | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('pending');

  const filtered = reviews.filter(r => {
    if (filter === 'pending') return r.status === 'pending' || r.status === 'in_progress';
    if (filter === 'completed') return r.status === 'approved' || r.status === 'revoked';
    return true;
  });

  const pendingCount = reviews.filter(r => r.status === 'pending' || r.status === 'in_progress').length;

  const handleDecision = async (decision: 'approve' | 'revoke') => {
    if (!selected) return;
    if (!notes.trim()) {
      Alert.alert('Notes Required', 'Please add notes before completing this review.');
      return;
    }
    setActionLoading(true);
    try {
      await completeReview(selected.id, decision, notes);
      setSelected(null);
      setNotes('');
    } finally {
      setActionLoading(false);
    }
  };

  const renderReview = ({ item }: { item: AccessReview }) => {
    const overdue = isOverdue(item.dueAt) && (item.status === 'pending' || item.status === 'in_progress');
    return (
      <TouchableOpacity
        style={[styles.card, overdue && styles.cardOverdue]}
        onPress={() => setSelected(item)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[item.status] + '22' }]}>
            <Text style={[styles.statusText, { color: STATUS_COLOR[item.status] }]}>
              {STATUS_LABEL[item.status]}
            </Text>
          </View>
          {overdue && (
            <View style={styles.overdueBadge}>
              <Text style={styles.overdueText}>OVERDUE</Text>
            </View>
          )}
        </View>
        <Text style={styles.reviewType}>
          {REVIEW_TYPE_LABEL[item.reviewType] ?? item.reviewType.replace(/_/g, ' ')}
        </Text>
        <Text style={styles.targetUser}>{item.targetUserName}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>Requested by: {item.requestedBy}</Text>
          {item.dueAt && (
            <Text style={[styles.meta, overdue && { color: colors.error }]}>
              Due: {new Date(item.dueAt).toLocaleDateString()}
            </Text>
          )}
        </View>
        {item.reviewedBy && (
          <Text style={styles.meta}>Reviewed by: {item.reviewedBy}</Text>
        )}
        <Text style={styles.createdAt}>{new Date(item.createdAt).toLocaleDateString()}</Text>
      </TouchableOpacity>
    );
  };

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Failed to load access reviews</Text>
        <TouchableOpacity style={styles.retryButton} onPress={refresh}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Access Reviews</Text>
        {pendingCount > 0 && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingCount}>{pendingCount} pending</Text>
          </View>
        )}
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {(['all', 'pending', 'completed'] as const).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
        <Text style={styles.totalCount}>{total} total</Text>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderReview}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.loader} color={colors.primary} />
          ) : (
            <View style={styles.centered}>
              <Text style={styles.emptyText}>No access reviews found</Text>
            </View>
          )
        }
      />

      {/* Review Detail / Action Modal */}
      <Modal
        visible={!!selected}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setSelected(null); setNotes(''); }}
      >
        {selected && (
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Access Review</Text>
              <TouchableOpacity onPress={() => { setSelected(null); setNotes(''); }}>
                <Text style={styles.closeButton}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Review Type</Text>
                <Text style={styles.detailValue}>
                  {REVIEW_TYPE_LABEL[selected.reviewType] ?? selected.reviewType.replace(/_/g, ' ')}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Target User</Text>
                <Text style={styles.detailValue}>{selected.targetUserName} ({selected.targetUserId})</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Status</Text>
                <Text style={[styles.detailValue, { color: STATUS_COLOR[selected.status] }]}>
                  {STATUS_LABEL[selected.status]}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Requested By</Text>
                <Text style={styles.detailValue}>{selected.requestedBy}</Text>
              </View>
              {selected.dueAt && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Due Date</Text>
                  <Text style={[
                    styles.detailValue,
                    isOverdue(selected.dueAt) && (selected.status === 'pending' || selected.status === 'in_progress')
                      ? { color: colors.error } : {}
                  ]}>
                    {new Date(selected.dueAt).toLocaleString()}
                    {isOverdue(selected.dueAt) && (selected.status === 'pending' || selected.status === 'in_progress')
                      ? ' — OVERDUE' : ''}
                  </Text>
                </View>
              )}
              {selected.reviewedBy && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Reviewed By</Text>
                  <Text style={styles.detailValue}>{selected.reviewedBy}</Text>
                </View>
              )}
              {selected.decision && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Decision</Text>
                  <Text style={[
                    styles.detailValue,
                    { color: selected.decision === 'approve' ? colors.success : colors.error }
                  ]}>
                    {selected.decision.toUpperCase()}
                  </Text>
                </View>
              )}
              {selected.notes && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Notes</Text>
                  <Text style={styles.detailValue}>{selected.notes}</Text>
                </View>
              )}
              {selected.completedAt && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Completed At</Text>
                  <Text style={styles.detailValue}>{new Date(selected.completedAt).toLocaleString()}</Text>
                </View>
              )}
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Created</Text>
                <Text style={styles.detailValue}>{new Date(selected.createdAt).toLocaleString()}</Text>
              </View>

              {/* Notes input for pending/in-progress reviews */}
              {(selected.status === 'pending' || selected.status === 'in_progress') && (
                <View style={styles.notesSection}>
                  <Text style={styles.detailLabel}>Review Notes <Text style={{ color: colors.error }}>*</Text></Text>
                  <TextInput
                    style={styles.notesInput}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Document your review decision..."
                    placeholderTextColor={colors.textMuted}
                    multiline
                    numberOfLines={4}
                  />
                </View>
              )}
            </ScrollView>

            {/* Dual-control action buttons */}
            {(selected.status === 'pending' || selected.status === 'in_progress') && (
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: '#22c55e' }]}
                  onPress={() => handleDecision('approve')}
                  disabled={actionLoading}
                >
                  {actionLoading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.actionButtonText}>✓ Approve Access</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: '#ef4444' }]}
                  onPress={() => handleDecision('revoke')}
                  disabled={actionLoading}
                >
                  <Text style={styles.actionButtonText}>✕ Revoke Access</Text>
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
  pendingBadge: { backgroundColor: '#eab30822', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  pendingCount: { color: '#eab308', fontSize: 12, fontWeight: '600' },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: 8,
    alignItems: 'center',
  },
  filterTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterTabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterTabText: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  filterTabTextActive: { color: '#fff' },
  totalCount: { marginLeft: 'auto', fontSize: 11, color: colors.textMuted },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardOverdue: { borderColor: '#ef444466' },
  cardHeader: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  statusBadge: { borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  overdueBadge: { backgroundColor: '#ef444422', borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 3 },
  overdueText: { fontSize: 10, fontWeight: '700', color: '#ef4444', letterSpacing: 0.4 },
  reviewType: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 2 },
  targetUser: { fontSize: 12, color: colors.primary, marginBottom: 6 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  meta: { fontSize: 11, color: colors.textMuted },
  createdAt: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
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
    minHeight: 88,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionButton: { flex: 1, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
  actionButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
