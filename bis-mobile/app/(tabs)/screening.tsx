/**
 * Screening Records tab — BIS Mobile (Expo)
 * Background checks: drug, MVR, criminal, employment, education.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from "react-native";
import { trpc } from "@/lib/trpc";

const STATUS_COLORS: Record<string, string> = {
  completed: "#22c55e",
  pending: "#eab308",
  failed: "#ef4444",
  processing: "#3b82f6",
};

export default function ScreeningScreen() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch, isFetching } = trpc.screening.list.useQuery({
    search,
    page,
    limit: 20,
  });

  const deleteMutation = trpc.screening.delete.useMutation({
    onSuccess: () => refetch(),
    onError: (err) => Alert.alert("Error", err.message),
  });

  const items = (data as { data?: unknown[] })?.data ?? [];
  const total = (data as { total?: number })?.total ?? 0;

  const renderItem = ({ item }: { item: unknown }) => {
    const rec = item as Record<string, unknown>;
    const status = (rec.status as string) ?? "pending";
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.name}>{(rec.subjectName as string) ?? "—"}</Text>
          <View style={[styles.badge, { backgroundColor: STATUS_COLORS[status] ?? "#64748b" }]}>
            <Text style={styles.badgeText}>{status.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.detail}>Type: {(rec.screeningType as string) ?? "—"}</Text>
        <Text style={styles.detail}>Ref: {(rec.requestRef as string) ?? "—"}</Text>
        {rec.result && (
          <Text style={styles.detail}>
            Result: {(rec.result as string).substring(0, 80)}
            {(rec.result as string).length > 80 ? "…" : ""}
          </Text>
        )}
        <Text style={styles.timestamp}>
          {rec.createdAt ? new Date(rec.createdAt as string).toLocaleString() : "—"}
        </Text>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() =>
            Alert.alert("Delete", "Delete this screening record?", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => deleteMutation.mutate({ id: rec.id as number }),
              },
            ])
          }
        >
          <Text style={styles.deleteBtnText}>Delete</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Screening Records</Text>
      <Text style={styles.subtitle}>{total} total records</Text>

      <TextInput
        style={styles.search}
        placeholder="Search by name, ref, type..."
        placeholderTextColor="#64748b"
        value={search}
        onChangeText={(t) => { setSearch(t); setPage(1); }}
      />

      {isLoading ? (
        <ActivityIndicator color="#3b82f6" style={{ marginTop: 32 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(_, i) => String(i)}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor="#3b82f6" />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>No screening records found</Text>
          }
          onEndReached={() => {
            if (items.length < total) setPage((p) => p + 1);
          }}
          onEndReachedThreshold={0.5}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", padding: 16 },
  title: { fontSize: 22, fontWeight: "700", color: "#f8fafc", marginBottom: 4 },
  subtitle: { fontSize: 13, color: "#94a3b8", marginBottom: 12 },
  search: {
    backgroundColor: "#1e293b",
    color: "#f8fafc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    fontSize: 14,
  },
  card: {
    backgroundColor: "#1e293b",
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  name: { fontSize: 14, fontWeight: "600", color: "#f8fafc", flex: 1 },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  detail: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  timestamp: { fontSize: 11, color: "#475569", marginTop: 6 },
  deleteBtn: { marginTop: 8, alignSelf: "flex-end" },
  deleteBtnText: { fontSize: 12, color: "#ef4444" },
  empty: { textAlign: "center", color: "#64748b", marginTop: 48 },
});
