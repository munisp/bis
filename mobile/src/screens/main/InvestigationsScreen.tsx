/**
 * InvestigationsScreen — list of all investigations with search and filter.
 * Taps navigate to InvestigationDetailScreen.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { InvestigationsStackParamList } from '../../navigation/RootNavigator';
import { investigationsApi } from '../../services/api';
import { colors, typography, spacing } from '../../utils/theme';

type Nav = NativeStackNavigationProp<InvestigationsStackParamList, 'InvestigationsList'>;

const STATUS_COLORS: Record<string, string> = {
  open: '#3b82f6', in_progress: '#f97316', pending_review: '#eab308',
  closed: '#22c55e', escalated: '#ef4444',
};
const RISK_COLORS: Record<string, string> = {
  critical: '#ef4444', high: '#f97316', medium: '#eab308',
  low: '#22c55e', unknown: '#64748b',
};

interface Investigation {
  id: string; ref: string; title: string; status: string;
  riskLevel: string; subject: string; createdAt: string; updatedAt: string;
}

export function InvestigationsScreen() {
  const navigation = useNavigation<Nav>();
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchInvestigations = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await investigationsApi.list({ limit: 100 });
      setInvestigations((result.data ?? []) as Investigation[]);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load'));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchInvestigations(); }, [fetchInvestigations]);

  const filtered = investigations.filter(inv => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q || inv.title?.toLowerCase().includes(q) ||
      inv.ref?.toLowerCase().includes(q) || inv.subject?.toLowerCase().includes(q);
    return matchesSearch && (statusFilter === 'all' || inv.status === statusFilter);
  });

  const renderItem = ({ item }: { item: Investigation }) => (
    <TouchableOpacity style={styles.card}
      onPress={() => navigation.navigate('InvestigationDetail', { id: item.id })} activeOpacity={0.7}>
      <View style={styles.cardHeader}>
        <Text style={styles.ref}>{item.ref}</Text>
        <View style={[styles.badge, { backgroundColor: STATUS_COLORS[item.status] + '22' }]}>
          <Text style={[styles.badgeText, { color: STATUS_COLORS[item.status] }]}>
            {item.status?.replace(/_/g, ' ').toUpperCase()}
          </Text>
        </View>
      </View>
      <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
      <Text style={styles.subject} numberOfLines={1}>{item.subject}</Text>
      <View style={styles.cardFooter}>
        <View style={[styles.badge, { backgroundColor: RISK_COLORS[item.riskLevel] + '22' }]}>
          <Text style={[styles.badgeText, { color: RISK_COLORS[item.riskLevel] }]}>
            {item.riskLevel?.toUpperCase() ?? 'UNKNOWN'}
          </Text>
        </View>
        <Text style={styles.ts}>{new Date(item.updatedAt).toLocaleDateString()}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.searchWrap}>
        <TextInput style={styles.search} placeholder="Search investigations…"
          placeholderTextColor={colors.textMuted} value={searchQuery}
          onChangeText={setSearchQuery} returnKeyType="search" clearButtonMode="while-editing" />
      </View>
      <View style={styles.filtersRow}>
        {['all','open','in_progress','pending_review','closed'].map(s => (
          <TouchableOpacity key={s} style={[styles.chip, statusFilter===s && styles.chipActive]} onPress={() => setStatusFilter(s)}>
            <Text style={[styles.chipText, statusFilter===s && styles.chipTextActive]}>{s==='all'?'All':s.replace(/_/g,' ')}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Failed to load investigations</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchInvestigations}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>
        </View>
      ) : (
        <FlatList data={filtered} keyExtractor={(i: Investigation) => i.id} renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchInvestigations} tintColor={colors.primary} />}
          ListEmptyComponent={loading ? <ActivityIndicator style={styles.loader} color={colors.primary} /> :
            <View style={styles.centered}><Text style={styles.emptyText}>{searchQuery ? 'No results' : 'No investigations'}</Text></View>} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  searchWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 4 },
  search: { backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    color: colors.text, fontSize: 14, borderWidth: 1, borderColor: colors.border },
  filtersRow: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: 8, gap: 6, flexWrap: 'wrap' },
  chip: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary + '22', borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.textMuted, textTransform: 'capitalize' },
  chipTextActive: { color: colors.primary, fontWeight: '600' },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  ref: { fontSize: 11, fontFamily: 'Courier', color: colors.textMuted },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
  title: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 3, lineHeight: 19 },
  subject: { fontSize: 12, color: colors.textSecondary, marginBottom: 8 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ts: { fontSize: 11, color: colors.textMuted },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  errorText: { color: '#ef4444', fontSize: 14, marginBottom: 12 },
  retryBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { color: '#fff', fontWeight: '600' },
  emptyText: { color: colors.textMuted, fontSize: 14 },
  loader: { marginTop: 40 },
});
