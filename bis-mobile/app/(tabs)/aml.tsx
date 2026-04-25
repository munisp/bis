/**
 * AML Transactions tab — BIS Mobile (Expo)
 * Lists AML-screened transactions with risk scores and sanctions hits.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  Alert,
} from "react-native";
import { trpc } from "@/lib/trpc";

const RISK_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
};

export default function AMLScreen() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch, isFetching } = trpc.aml.list.useQuery({
    search,
    page,
    limit: 20,
  });

  const screenMutation = trpc.aml.screenWithEngine.useMutation({
    onSuccess: () => {
      refetch();
      Alert.alert("Success", "Transaction screened successfully");
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const items = (data as { data?: unknown[] })?.data ?? [];
  const total = (data as { total?: number })?.total ?? 0;

  const renderItem = ({ item }: { item: unknown }) => {
    const tx = item as Record<string, unknown>;
    const riskLevel = (tx.riskLevel as string) ?? "low";
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.ref}>{(tx.transactionRef as string) ?? "—"}</Text>
          <View style={[styles.badge, { backgroundColor: RISK_COLORS[riskLevel] ?? "#64748b" }]}>
            <Text style={styles.badgeText}>{riskLevel.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.detail}>
          Amount: {tx.currency as string} {Number(tx.amount ?? 0).toLocaleString()}
        </Text>
        <Text style={styles.detail}>
          Sender: {(tx.senderName as string) ?? "—"} → Receiver: {(tx.receiverName as string) ?? "—"}
        </Text>
        {(tx.sanctionsHit as boolean) && (
          <Text style={styles.sanctionsHit}>⚠ SANCTIONS HIT</Text>
        )}
        <Text style={styles.timestamp}>
          {tx.createdAt ? new Date(tx.createdAt as string).toLocaleString() : "—"}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>AML Transactions</Text>
      <Text style={styles.subtitle}>{total} total records</Text>

      <TextInput
        style={styles.search}
        placeholder="Search by ref, sender, receiver..."
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
            <Text style={styles.empty}>No AML transactions found</Text>
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
  ref: { fontSize: 14, fontWeight: "600", color: "#f8fafc" },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  detail: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  sanctionsHit: { fontSize: 12, fontWeight: "700", color: "#ef4444", marginTop: 4 },
  timestamp: { fontSize: 11, color: "#475569", marginTop: 6 },
  empty: { textAlign: "center", color: "#64748b", marginTop: 48 },
});
