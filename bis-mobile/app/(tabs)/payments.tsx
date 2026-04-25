/**
 * Payment Rails tab — BIS Mobile (Expo)
 * TigerBeetle-backed payment transfers with ledger view and account balances.
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
  Modal,
} from "react-native";
import { trpc } from "@/lib/trpc";

const STATUS_COLORS: Record<string, string> = {
  pending: "#eab308",
  processing: "#3b82f6",
  completed: "#22c55e",
  failed: "#ef4444",
  reversed: "#f97316",
};

export default function PaymentsScreen() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState({
    originatorAccount: "",
    beneficiaryAccount: "",
    amount: "",
    currency: "NGN",
    narration: "",
    purposeCode: "TRANSFER",
  });

  const utils = trpc.useUtils();

  const { data, isLoading, refetch, isFetching } = trpc.paymentRails.listTransfers.useQuery({
    search,
    page,
    limit: 20,
  });

  const { data: queueData } = trpc.paymentRails.getQueueStats.useQuery();

  const createMutation = trpc.paymentRails.initiateTransfer.useMutation({
    onSuccess: () => {
      setShowCreateModal(false);
      setForm({ originatorAccount: "", beneficiaryAccount: "", amount: "", currency: "NGN", narration: "", purposeCode: "TRANSFER" });
      utils.paymentRails.listTransfers.invalidate();
      Alert.alert("Transfer Initiated", "Payment transfer has been queued");
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const items = (data as { data?: unknown[] })?.data ?? [];
  const total = (data as { total?: number })?.total ?? 0;
  const queueStats = queueData as Record<string, unknown> | undefined;

  const renderItem = ({ item }: { item: unknown }) => {
    const tx = item as Record<string, unknown>;
    const status = (tx.status as string) ?? "pending";
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.txRef}>{(tx.txRef as string) ?? "—"}</Text>
          <View style={[styles.badge, { backgroundColor: STATUS_COLORS[status] ?? "#64748b" }]}>
            <Text style={styles.badgeText}>{status.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.amount}>
          {(tx.currency as string) ?? "NGN"} {Number(tx.amount ?? 0).toLocaleString()}
        </Text>
        <Text style={styles.detail}>From: {(tx.originatorName as string) ?? (tx.originatorAccount as string) ?? "—"}</Text>
        <Text style={styles.detail}>To: {(tx.beneficiaryName as string) ?? (tx.beneficiaryAccount as string) ?? "—"}</Text>
        {tx.narration && <Text style={styles.detail}>Narration: {tx.narration as string}</Text>}
        {tx.purposeCode && <Text style={styles.detail}>Purpose: {tx.purposeCode as string}</Text>}
        <Text style={styles.timestamp}>
          {tx.createdAt ? new Date(tx.createdAt as string).toLocaleString() : "—"}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Payment Rails</Text>
          <Text style={styles.subtitle}>{total} total transfers</Text>
        </View>
        <TouchableOpacity style={styles.createBtn} onPress={() => setShowCreateModal(true)}>
          <Text style={styles.createBtnText}>+ Transfer</Text>
        </TouchableOpacity>
      </View>

      {/* Queue Stats */}
      {queueStats && (
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{String(queueStats.pending ?? 0)}</Text>
            <Text style={styles.statLabel}>Pending</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{String(queueStats.processing ?? 0)}</Text>
            <Text style={styles.statLabel}>Processing</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: "#22c55e" }]}>{String(queueStats.completed ?? 0)}</Text>
            <Text style={styles.statLabel}>Completed</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: "#ef4444" }]}>{String(queueStats.failed ?? 0)}</Text>
            <Text style={styles.statLabel}>Failed</Text>
          </View>
        </View>
      )}

      <TextInput
        style={styles.search}
        placeholder="Search by ref, originator, beneficiary..."
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
          ListEmptyComponent={<Text style={styles.empty}>No payment transfers found</Text>}
          onEndReached={() => {
            if (items.length < total) setPage((p) => p + 1);
          }}
          onEndReachedThreshold={0.5}
        />
      )}

      {/* Initiate Transfer Modal */}
      <Modal visible={showCreateModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Initiate Transfer</Text>
            <TextInput
              style={styles.input}
              placeholder="Originator account number *"
              placeholderTextColor="#64748b"
              value={form.originatorAccount}
              onChangeText={(t) => setForm((f) => ({ ...f, originatorAccount: t }))}
              keyboardType="numeric"
            />
            <TextInput
              style={styles.input}
              placeholder="Beneficiary account number *"
              placeholderTextColor="#64748b"
              value={form.beneficiaryAccount}
              onChangeText={(t) => setForm((f) => ({ ...f, beneficiaryAccount: t }))}
              keyboardType="numeric"
            />
            <TextInput
              style={styles.input}
              placeholder="Amount (NGN) *"
              placeholderTextColor="#64748b"
              value={form.amount}
              onChangeText={(t) => setForm((f) => ({ ...f, amount: t }))}
              keyboardType="numeric"
            />
            <TextInput
              style={styles.input}
              placeholder="Narration"
              placeholderTextColor="#64748b"
              value={form.narration}
              onChangeText={(t) => setForm((f) => ({ ...f, narration: t }))}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: "#334155" }]}
                onPress={() => setShowCreateModal(false)}
              >
                <Text style={styles.modalBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: "#3b82f6" }]}
                onPress={() => {
                  if (!form.originatorAccount || !form.beneficiaryAccount || !form.amount)
                    return Alert.alert("Error", "Account numbers and amount are required");
                  createMutation.mutate({
                    originatorAccount: form.originatorAccount,
                    beneficiaryAccount: form.beneficiaryAccount,
                    amount: Number(form.amount),
                    currency: form.currency,
                    narration: form.narration,
                    purposeCode: form.purposeCode,
                  });
                }}
              >
                <Text style={styles.modalBtnText}>
                  {createMutation.isPending ? "Initiating…" : "Initiate"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", padding: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  title: { fontSize: 22, fontWeight: "700", color: "#f8fafc" },
  subtitle: { fontSize: 13, color: "#94a3b8" },
  createBtn: { backgroundColor: "#3b82f6", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  createBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  statCard: { flex: 1, backgroundColor: "#1e293b", borderRadius: 8, padding: 10, alignItems: "center" },
  statValue: { fontSize: 18, fontWeight: "700", color: "#f8fafc" },
  statLabel: { fontSize: 10, color: "#94a3b8", marginTop: 2 },
  search: {
    backgroundColor: "#1e293b",
    color: "#f8fafc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    fontSize: 14,
  },
  card: { backgroundColor: "#1e293b", borderRadius: 10, padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  txRef: { fontSize: 13, fontWeight: "600", color: "#f8fafc" },
  amount: { fontSize: 16, fontWeight: "700", color: "#f8fafc", marginBottom: 4 },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  detail: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  timestamp: { fontSize: 11, color: "#475569", marginTop: 6 },
  empty: { textAlign: "center", color: "#64748b", marginTop: 48 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modalContent: { backgroundColor: "#1e293b", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#f8fafc", marginBottom: 16 },
  input: {
    backgroundColor: "#0f172a",
    color: "#f8fafc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    fontSize: 14,
  },
  modalActions: { flexDirection: "row", gap: 12, marginTop: 4 },
  modalBtn: { flex: 1, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  modalBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
});
