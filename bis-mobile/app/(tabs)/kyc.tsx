import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "@/lib/trpc";

const COLORS = {
  bg: "#0a0a0f", card: "#0f0f1a", border: "#1e1e2e",
  primary: "#818cf8", text: "#e2e8f0", muted: "#6b7280",
  success: "#22c55e", warning: "#eab308", error: "#ef4444",
};

const STATUS_COLOR: Record<string, string> = {
  verified: COLORS.success, pending: COLORS.warning, failed: COLORS.error, in_progress: COLORS.primary,
};

export default function KYCScreen() {
  const router = useRouter();
  const { data, isLoading, refetch, isRefetching } = trpc.kyc.list.useQuery(
    { page: 1, limit: 20 },
    { staleTime: 30_000 }
  );

  const records = (data as any)?.records ?? [];

  return (
    <View style={styles.container}>
      {/* Quick action bar */}
      <View style={styles.actionBar}>
        <TouchableOpacity style={styles.actionChip} onPress={() => router.push("/kyc/biometric")}>
          <Ionicons name="finger-print-outline" size={14} color={COLORS.primary} />
          <Text style={styles.actionChipText}>Biometric Enrollment</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionChip} onPress={() => router.push("/kyc/camera")}>
          <Ionicons name="camera-outline" size={14} color={COLORS.primary} />
          <Text style={styles.actionChipText}>Document Capture</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={records}
          keyExtractor={(item: any) => String(item.id)}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={COLORS.primary} />}
          contentContainerStyle={styles.list}
          renderItem={({ item }: { item: any }) => {
            const sc = STATUS_COLOR[item.status] ?? COLORS.muted;
            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardName}>{item.subjectName}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: sc + "20", borderColor: sc + "40" }]}>
                    <Text style={[styles.statusText, { color: sc }]}>{item.status}</Text>
                  </View>
                </View>
                <View style={styles.cardMeta}>
                  {item.nin && <Text style={styles.metaText}>NIN: {item.nin}</Text>}
                  {item.bvn && <Text style={styles.metaText}>BVN: {item.bvn}</Text>}
                </View>
                <Text style={styles.cardDate}>{new Date(item.createdAt).toLocaleDateString()}</Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="shield-checkmark-outline" size={40} color={COLORS.muted} />
              <Text style={styles.emptyText}>No KYC records</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  actionBar: { flexDirection: "row", gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.card },
  actionChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border },
  actionChipText: { fontSize: 12, color: COLORS.primary, fontWeight: "500" },
  list: { padding: 12, gap: 8 },
  card: { backgroundColor: COLORS.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  cardName: { fontSize: 15, fontWeight: "600", color: COLORS.text, flex: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  statusText: { fontSize: 11, fontWeight: "600" },
  cardMeta: { flexDirection: "row", gap: 12, marginBottom: 4 },
  metaText: { fontSize: 12, color: COLORS.muted },
  cardDate: { fontSize: 11, color: COLORS.muted },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 14, color: COLORS.muted },
});
