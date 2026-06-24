/**
 * UEBAScreen — User and Entity Behaviour Analytics profile browser.
 * Displays risk scores, anomaly counts, risk tier badges, and flagged behaviours.
 * Supports manual profile refresh and drill-down detail modal.
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
} from 'react-native';
import { useUebaProfiles, type UebaProfile } from '../../hooks/useInsiderThreat';
import { colors, typography, spacing, radius } from '../../utils/theme';

const RISK_TIER_COLOR: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
};

function RiskBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const barColor =
    pct >= 80 ? '#ef4444' :
    pct >= 60 ? '#f97316' :
    pct >= 40 ? '#eab308' : '#22c55e';
  return (
    <View style={riskBarStyles.track}>
      <View style={[riskBarStyles.fill, { width: `${pct}%` as any, backgroundColor: barColor }]} />
    </View>
  );
}

const riskBarStyles = StyleSheet.create({
  track: { height: 6, backgroundColor: '#1e293b', borderRadius: 3, overflow: 'hidden', flex: 1 },
  fill: { height: 6, borderRadius: 3 },
});

export function UEBAScreen() {
  const { profiles, total, loading, error, refresh, refreshProfile } = useUebaProfiles();
  const [selected, setSelected] = useState<UebaProfile | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = profiles.filter(p =>
    !search || p.userName.toLowerCase().includes(search.toLowerCase()) ||
    (p.department ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const handleRefreshProfile = async (userId: string) => {
    setRefreshing(true);
    try {
      await refreshProfile(userId);
      // Update selected if it's the same user
      if (selected?.userId === userId) {
        const updated = profiles.find(p => p.userId === userId);
        if (updated) setSelected(updated);
      }
    } finally {
      setRefreshing(false);
    }
  };

  const renderProfile = ({ item }: { item: UebaProfile }) => (
    <TouchableOpacity style={styles.card} onPress={() => setSelected(item)} activeOpacity={0.7}>
      <View style={styles.cardHeader}>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{item.userName}</Text>
          {item.department && <Text style={styles.department}>{item.department}</Text>}
        </View>
        <View style={[styles.tierBadge, { backgroundColor: RISK_TIER_COLOR[item.riskTier] + '22' }]}>
          <Text style={[styles.tierText, { color: RISK_TIER_COLOR[item.riskTier] }]}>
            {item.riskTier.toUpperCase()}
          </Text>
        </View>
      </View>
      <View style={styles.scoreRow}>
        <Text style={styles.scoreLabel}>Risk Score</Text>
        <Text style={[styles.scoreValue, { color: RISK_TIER_COLOR[item.riskTier] }]}>
          {item.riskScore.toFixed(1)}
        </Text>
      </View>
      <RiskBar score={item.riskScore} />
      <View style={styles.statsRow}>
        <Text style={styles.stat}>
          <Text style={styles.statValue}>{item.anomalyCount}</Text> anomalies
        </Text>
        {item.flaggedBehaviors.length > 0 && (
          <Text style={styles.stat}>
            <Text style={styles.statValue}>{item.flaggedBehaviors.length}</Text> flags
          </Text>
        )}
        {!item.baselineComputed && (
          <View style={styles.baselineBadge}>
            <Text style={styles.baselineText}>No Baseline</Text>
          </View>
        )}
      </View>
      {item.lastActivity && (
        <Text style={styles.lastActivity}>
          Last active: {new Date(item.lastActivity).toLocaleDateString()}
        </Text>
      )}
    </TouchableOpacity>
  );

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Failed to load UEBA profiles</Text>
        <TouchableOpacity style={styles.retryButton} onPress={refresh}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>UEBA Profiles</Text>
        <Text style={styles.totalCount}>{total} users</Text>
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or department..."
          placeholderTextColor={colors.textMuted}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.userId}
        renderItem={renderProfile}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.loader} color={colors.primary} />
          ) : (
            <View style={styles.centered}>
              <Text style={styles.emptyText}>No UEBA profiles found</Text>
            </View>
          )
        }
      />

      {/* Profile Detail Modal */}
      <Modal
        visible={!!selected}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelected(null)}
      >
        {selected && (
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>UEBA Profile</Text>
              <TouchableOpacity onPress={() => setSelected(null)}>
                <Text style={styles.closeButton}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>User</Text>
                <Text style={styles.detailValue}>{selected.userName}</Text>
              </View>
              {selected.department && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Department</Text>
                  <Text style={styles.detailValue}>{selected.department}</Text>
                </View>
              )}
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Risk Tier</Text>
                <Text style={[styles.detailValue, { color: RISK_TIER_COLOR[selected.riskTier] }]}>
                  {selected.riskTier.toUpperCase()}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Risk Score</Text>
                <View style={styles.scoreWithBar}>
                  <Text style={[styles.detailValue, { color: RISK_TIER_COLOR[selected.riskTier], marginRight: 12 }]}>
                    {selected.riskScore.toFixed(2)}
                  </Text>
                  <RiskBar score={selected.riskScore} />
                </View>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Anomaly Count</Text>
                <Text style={styles.detailValue}>{selected.anomalyCount}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Baseline Computed</Text>
                <Text style={[styles.detailValue, { color: selected.baselineComputed ? colors.success : colors.warning }]}>
                  {selected.baselineComputed ? 'Yes' : 'No — insufficient data'}
                </Text>
              </View>
              {selected.lastActivity && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Last Activity</Text>
                  <Text style={styles.detailValue}>{new Date(selected.lastActivity).toLocaleString()}</Text>
                </View>
              )}
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Profile Updated</Text>
                <Text style={styles.detailValue}>{new Date(selected.updatedAt).toLocaleString()}</Text>
              </View>
              {selected.flaggedBehaviors.length > 0 && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Flagged Behaviours</Text>
                  {selected.flaggedBehaviors.map((b, i) => (
                    <View key={i} style={styles.flagItem}>
                      <Text style={styles.flagDot}>•</Text>
                      <Text style={styles.flagText}>{b.replace(/_/g, ' ')}</Text>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: colors.primary }]}
                onPress={() => handleRefreshProfile(selected.userId)}
                disabled={refreshing}
              >
                {refreshing
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.actionButtonText}>Refresh Profile</Text>}
              </TouchableOpacity>
            </View>
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
  totalCount: { fontSize: 12, color: colors.textMuted },
  searchContainer: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  searchInput: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 13,
  },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  userInfo: { flex: 1 },
  userName: { fontSize: 14, fontWeight: '600', color: colors.text },
  department: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  tierBadge: { borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  tierText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  scoreLabel: { fontSize: 11, color: colors.textMuted },
  scoreValue: { fontSize: 13, fontWeight: '700' },
  statsRow: { flexDirection: 'row', gap: 12, marginTop: 8, alignItems: 'center' },
  stat: { fontSize: 12, color: colors.textMuted },
  statValue: { color: colors.text, fontWeight: '600' },
  baselineBadge: { backgroundColor: '#eab30822', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  baselineText: { fontSize: 10, color: '#eab308', fontWeight: '600' },
  lastActivity: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
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
  scoreWithBar: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  flagItem: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 4 },
  flagDot: { color: colors.warning, marginRight: 6, fontSize: 14 },
  flagText: { fontSize: 13, color: colors.textSecondary, flex: 1, textTransform: 'capitalize' },
  modalActions: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionButton: { borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
  actionButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
