import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "@/lib/trpc";

const COLORS = {
  bg: "#0a0a0f",
  card: "#0f0f1a",
  border: "#1e1e2e",
  primary: "#818cf8",
  text: "#e2e8f0",
  muted: "#6b7280",
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
};

function riskColor(score: number) {
  if (score >= 80) return COLORS.critical;
  if (score >= 60) return COLORS.high;
  if (score >= 40) return COLORS.medium;
  return COLORS.low;
}

function InvestigationCard({ item, onPress }: { item: any; onPress: () => void }) {
  const rc = riskColor(item.riskScore ?? 0);
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardRef}>{item.ref}</Text>
        <View style={[styles.riskBadge, { backgroundColor: rc + "20", borderColor: rc + "40" }]}>
          <Text style={[styles.riskText, { color: rc }]}>{(item.riskScore ?? 0).toFixed(0)}</Text>
        </View>
      </View>
      <Text style={styles.cardName}>{item.subjectName}</Text>
      <View style={styles.cardMeta}>
        <Text style={styles.metaText}>{item.status?.toUpperCase()}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaText}>{item.priority}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaText}>{item.country}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function InvestigationsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch, isRefetching } = trpc.investigations.list.useQuery(
    { page, limit: 20, search: search || undefined },
    { staleTime: 30_000 }
  );

  const investigations = (data as any)?.investigations ?? [];
  const total = (data as any)?.total ?? 0;

  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={16} color={COLORS.muted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, ref, or NIN…"
          placeholderTextColor={COLORS.muted}
          value={search}
          onChangeText={v => { setSearch(v); setPage(1); }}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")}>
            <Ionicons name="close-circle" size={16} color={COLORS.muted} />
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={investigations}
          keyExtractor={(item: any) => String(item.id)}
          renderItem={({ item }) => (
            <InvestigationCard
              item={item}
              onPress={() => router.push(`/investigation/${item.id}`)}
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={COLORS.primary} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={40} color={COLORS.muted} />
              <Text style={styles.emptyText}>No investigations found</Text>
            </View>
          }
          ListFooterComponent={
            total > investigations.length ? (
              <TouchableOpacity style={styles.loadMore} onPress={() => setPage(p => p + 1)}>
                <Text style={styles.loadMoreText}>Load more</Text>
              </TouchableOpacity>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.card,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, color: COLORS.text, fontSize: 14, paddingVertical: 4 },
  list: { padding: 12, gap: 8 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  cardRef: { fontSize: 11, fontFamily: "SpaceMono", color: COLORS.primary },
  riskBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  riskText: { fontSize: 12, fontWeight: "700" },
  cardName: { fontSize: 15, fontWeight: "600", color: COLORS.text, marginBottom: 6 },
  cardMeta: { flexDirection: "row", gap: 4 },
  metaText: { fontSize: 11, color: COLORS.muted },
  metaDot: { fontSize: 11, color: COLORS.muted },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 14, color: COLORS.muted },
  loadMore: { alignItems: "center", paddingVertical: 16 },
  loadMoreText: { color: COLORS.primary, fontSize: 13, fontWeight: "600" },
});
