import React, { useState } from "react";
import { View, Text, FlatList, TextInput, ActivityIndicator, StyleSheet, RefreshControl } from "react-native";
import { trpc } from "@/lib/trpc";

const RISK_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
};

const PAGE_SIZE = 20;

export default function AMLScreen() {
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const { data, isLoading, refetch, isFetching } = trpc.aml.transactions.list.useQuery({
    search: search.trim() || undefined,
    offset,
    limit: PAGE_SIZE,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>AML Transactions</Text>
      <Text style={styles.subtitle}>{total} authorised record{total === 1 ? "" : "s"}</Text>
      <TextInput
        style={styles.search}
        placeholder="Search transaction reference"
        placeholderTextColor="#64748b"
        value={search}
        onChangeText={(value) => { setSearch(value); setOffset(0); }}
        accessibilityLabel="Search AML transactions"
      />
      {isLoading ? <ActivityIndicator color="#3b82f6" style={{ marginTop: 32 }} /> : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item: tx }) => {
            const riskLevel = tx.amlRiskLevel ?? "low";
            return (
              <View style={styles.card} accessibilityLabel={`Transaction ${tx.txRef}`}>
                <View style={styles.cardHeader}>
                  <Text style={styles.ref}>{tx.txRef}</Text>
                  <View style={[styles.badge, { backgroundColor: RISK_COLORS[riskLevel] ?? "#64748b" }]}>
                    <Text style={styles.badgeText}>{riskLevel.toUpperCase()}</Text>
                  </View>
                </View>
                <Text style={styles.detail}>Amount: {tx.currency} {Number(tx.amount ?? 0).toLocaleString()}</Text>
                <Text style={styles.detail}>Originator: {tx.originatorName ?? "—"}</Text>
                <Text style={styles.detail}>Beneficiary: {tx.beneficiaryName ?? "—"}</Text>
                <Text style={styles.timestamp}>{tx.createdAt ? new Date(tx.createdAt).toLocaleString() : "—"}</Text>
              </View>
            );
          }}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => void refetch()} tintColor="#3b82f6" />}
          ListEmptyComponent={<Text style={styles.empty}>No authorised AML transactions found</Text>}
          onEndReached={() => { if (offset + items.length < total) setOffset((value) => value + PAGE_SIZE); }}
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
  search: { backgroundColor: "#1e293b", color: "#f8fafc", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12, fontSize: 14 },
  card: { backgroundColor: "#1e293b", borderRadius: 10, padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  ref: { fontSize: 14, fontWeight: "600", color: "#f8fafc" },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  detail: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  timestamp: { fontSize: 11, color: "#475569", marginTop: 6 },
  empty: { textAlign: "center", color: "#64748b", marginTop: 48 },
});
