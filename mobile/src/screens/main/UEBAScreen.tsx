/**
 * UEBAScreen — User and Entity Behaviour Analytics profile browser for the BIS mobile app.
 *
 * Features:
 *   - Paginated UEBA profile list with anomaly/drift score progress bars
 *   - Baseline readiness indicator
 *   - Per-subject ML refresh action (calls Python risk engine via BFF)
 *   - Pull-to-refresh and infinite scroll
 *   - Profile detail modal with full metric breakdown
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
import { useUebaProfiles } from '../../hooks/useInsiderThreat';
import { UebaProfile } from '../../services/api';
import { colors, typography, spacing } from '../../utils/theme';

function ScoreBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const pct = Math.min(Math.max(value, 0), 1);
  return (
    <View style={scoreBarStyles.container}>
      <View style={scoreBarStyles.labelRow}>
        <Text style={scoreBarStyles.label}>{label}</Text>
        <Text style={[scoreBarStyles.value, { color }]}>
          {(pct * 100).toFixed(0)}%
        </Text>
      </View>
      <View style={scoreBarStyles.track}>
        <View
          style={[
            scoreBarStyles.fill,
            { width: `${pct * 100}%`, backgroundColor: color },
          ]}
        />
      </View>
    </View>
  );
}

const scoreBarStyles = StyleSheet.create({
  container: { marginBottom: spacing.sm },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  label: { ...typography.caption, color: colors.textSecondary },
  value: { ...typography.caption, fontWeight: '700' },
  track: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 3 },
});

function anomalyColor(score: number): string {
  if (score >= 0.8) return colors.critical;
  if (score >= 0.6) return colors.high;
  if (score >= 0.4) return colors.warning;
  return colors.success;
}

export function UEBAScreen() {
  const [selected, setSelected] = useState<UebaProfile | null>(null);

  const {
    profiles,
    total,
    loading,
    refreshing,
    error,
    refresh,
    loadMore,
    hasMore,
    refreshProfile,
    refreshingSubject,
  } = useUebaProfiles({ pageSize: 20 });

  const handleRefreshProfile = async (profile: UebaProfile) => {
    try {
      await refreshProfile(profile.subjectId, profile.tenantId ?? undefined);
      // Update selected if it's the same profile
      if (selected?.subjectId === profile.subjectId) {
        setSelected(prev =>
          prev
            ? {
                ...prev,
                anomalyScore: profile.anomalyScore,
                driftScore: profile.driftScore,
              }
            : null,
        );
      }
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Refresh failed');
    }
  };

  const renderProfile = ({ item }: { item: UebaProfile }) => {
    const isRefreshing = refreshingSubject === item.subjectId;
    const aColor = anomalyColor(item.anomalyScore);
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => setSelected(item)}
        activeOpacity={0.75}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.subjectText} numberOfLines={1}>
              {item.subjectId}
            </Text>
            {item.baselineReady ? (
              <View style={styles.baselineBadge}>
                <Text style={styles.baselineBadgeText}>BASELINE</Text>
              </View>
            ) : (
              <View style={[styles.baselineBadge, styles.baselineBadgePending]}>
                <Text style={[styles.baselineBadgeText, { color: colors.warning }]}>
                  LEARNING
                </Text>
              </View>
            )}
          </View>
          {item.tenantId && (
            <Text style={styles.tenantText}>{item.tenantId}</Text>
          )}
        </View>

        <ScoreBar label="Anomaly Score" value={item.anomalyScore} color={aColor} />
        <ScoreBar label="Drift Score" value={item.driftScore} color={colors.info} />

        <View style={styles.cardFooter}>
          <Text style={styles.metaText}>
            Auth failures: {item.failedAuthCount} · Priv changes:{' '}
            {item.privilegeChangeCount}
          </Text>
          <TouchableOpacity
            style={[styles.refreshBtn, isRefreshing && styles.refreshBtnDisabled]}
            onPress={() => handleRefreshProfile(item)}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Text style={styles.refreshBtnText}>↻ Refresh</Text>
            )}
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
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
      {/* Header Stats */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{total}</Text>
          <Text style={styles.statLabel}>Profiles</Text>
        </View>
        <View style={[styles.statItem, styles.statDivider]}>
          <Text style={[styles.statValue, { color: colors.success }]}>
            {profiles.filter(p => p.baselineReady).length}
          </Text>
          <Text style={styles.statLabel}>Baseline Ready</Text>
        </View>
        <View style={[styles.statItem, styles.statDivider]}>
          <Text style={[styles.statValue, { color: colors.error }]}>
            {profiles.filter(p => p.anomalyScore >= 0.7).length}
          </Text>
          <Text style={styles.statLabel}>High Anomaly</Text>
        </View>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {loading && profiles.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.loadingText}>Loading UEBA profiles...</Text>
        </View>
      ) : (
        <FlatList
          data={profiles}
          keyExtractor={item => String(item.id)}
          renderItem={renderProfile}
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
              <Text style={styles.emptyIcon}>📊</Text>
              <Text style={styles.emptyText}>No UEBA profiles yet</Text>
              <Text style={styles.emptySubtext}>
                Profiles are created as events are ingested
              </Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* Profile Detail Modal */}
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
                    <Text style={styles.modalTitle}>📊 UEBA Profile</Text>
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
                    <Text style={styles.detailLabel}>Baseline</Text>
                    <Text
                      style={[
                        styles.detailValue,
                        {
                          color: selected.baselineReady
                            ? colors.success
                            : colors.warning,
                        },
                      ]}
                    >
                      {selected.baselineReady ? 'Ready' : 'Learning'}
                    </Text>
                  </View>

                  <View style={{ marginVertical: spacing.md }}>
                    <ScoreBar
                      label="Anomaly Score"
                      value={selected.anomalyScore}
                      color={anomalyColor(selected.anomalyScore)}
                    />
                    <ScoreBar
                      label="Drift Score"
                      value={selected.driftScore}
                      color={colors.info}
                    />
                    <ScoreBar
                      label="Off-Hours Ratio"
                      value={selected.offHoursRatio}
                      color={colors.warning}
                    />
                  </View>

                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Failed Auth</Text>
                    <Text style={styles.detailValue}>{selected.failedAuthCount}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Priv Changes</Text>
                    <Text style={styles.detailValue}>
                      {selected.privilegeChangeCount}
                    </Text>
                  </View>
                  {selected.lastRefreshedAt && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Last Refresh</Text>
                      <Text style={styles.detailValue}>
                        {new Date(selected.lastRefreshedAt).toLocaleString()}
                      </Text>
                    </View>
                  )}
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Created</Text>
                    <Text style={styles.detailValue}>
                      {new Date(selected.createdAt).toLocaleString()}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.actionButton,
                      refreshingSubject === selected.subjectId &&
                        styles.actionButtonDisabled,
                    ]}
                    onPress={() => handleRefreshProfile(selected)}
                    disabled={refreshingSubject === selected.subjectId}
                  >
                    {refreshingSubject === selected.subjectId ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.actionButtonText}>
                        ↻ Refresh ML Score
                      </Text>
                    )}
                  </TouchableOpacity>
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
  container: { flex: 1, backgroundColor: colors.background },
  statsBar: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statDivider: { borderLeftWidth: 1, borderLeftColor: colors.border },
  statValue: { ...typography.h2, color: colors.text },
  statLabel: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
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
  cardHeader: { marginBottom: spacing.sm },
  cardTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  subjectText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    flex: 1,
  },
  tenantText: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  baselineBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: colors.success + '22',
  },
  baselineBadgePending: { backgroundColor: colors.warning + '22' },
  baselineBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.success,
    letterSpacing: 0.5,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  metaText: { ...typography.caption, color: colors.textMuted, flex: 1 },
  refreshBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.primary + '22',
    borderWidth: 1,
    borderColor: colors.primary,
    minWidth: 80,
    alignItems: 'center',
  },
  refreshBtnDisabled: { opacity: 0.5 },
  refreshBtnText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
    gap: spacing.sm,
  },
  emptyIcon: { fontSize: 48 },
  emptyText: { ...typography.h3, color: colors.textSecondary },
  emptySubtext: { ...typography.body, color: colors.textMuted },
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
  actionButton: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  actionButtonDisabled: { opacity: 0.5 },
  actionButtonText: { ...typography.body, color: '#fff', fontWeight: '700' },
});
