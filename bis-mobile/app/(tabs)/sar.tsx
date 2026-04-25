/**
 * SAR Filings tab — BIS Mobile (Expo)
 * Suspicious Activity Reports with full CRUD and submission workflow.
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
  draft: "#64748b",
  pending: "#eab308",
  submitted: "#3b82f6",
  accepted: "#22c55e",
  rejected: "#ef4444",
};

export default function SARScreen() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState({ subject: "", description: "", amount: "", currency: "NGN" });

  const utils = trpc.useUtils();

  const { data, isLoading, refetch, isFetching } = trpc.sar.list.useQuery({
    search,
    page,
    limit: 20,
  });

  const createMutation = trpc.sar.create.useMutation({
    onSuccess: () => {
      setShowCreateModal(false);
      setForm({ subject: "", description: "", amount: "", currency: "NGN" });
      utils.sar.list.invalidate();
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const submitMutation = trpc.sar.submit.useMutation({
    onSuccess: () => {
      utils.sar.list.invalidate();
      Alert.alert("Submitted", "SAR submitted successfully");
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const deleteMutation = trpc.sar.delete.useMutation({
    onSuccess: () => utils.sar.list.invalidate(),
    onError: (err) => Alert.alert("Error", err.message),
  });

  const items = (data as { data?: unknown[] })?.data ?? [];
  const total = (data as { total?: number })?.total ?? 0;

  const renderItem = ({ item }: { item: unknown }) => {
    const r = item as Record<string, unknown>;
    const status = (r.status as string) ?? "draft";
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.sarRef}>{(r.sarRef as string) ?? "—"}</Text>
          <View style={[styles.badge, { backgroundColor: STATUS_COLORS[status] ?? "#64748b" }]}>
            <Text style={styles.badgeText}>{status.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.detail}>Subject: {(r.subject as string) ?? "—"}</Text>
        {r.amount && (
          <Text style={styles.detail}>
            Amount: {(r.currency as string) ?? "NGN"} {Number(r.amount).toLocaleString()}
          </Text>
        )}
        <Text style={styles.timestamp}>
          {r.createdAt ? new Date(r.createdAt as string).toLocaleString() : "—"}
        </Text>
        <View style={styles.actions}>
          {status === "draft" && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: "#3b82f6" }]}
              onPress={() =>
                Alert.alert("Submit SAR", "Submit this SAR?", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Submit", onPress: () => submitMutation.mutate({ id: r.id as number }) },
                ])
              }
            >
              <Text style={styles.actionBtnText}>Submit</Text>
            </TouchableOpacity>
          )}
          {status === "draft" && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: "#ef4444" }]}
              onPress={() =>
                Alert.alert("Delete", "Delete this SAR?", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => deleteMutation.mutate({ id: r.id as number }),
                  },
                ])
              }
            >
              <Text style={styles.actionBtnText}>Delete</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>SAR Filings</Text>
          <Text style={styles.subtitle}>{total} total SARs</Text>
        </View>
        <TouchableOpacity style={styles.createBtn} onPress={() => setShowCreateModal(true)}>
          <Text style={styles.createBtnText}>+ New SAR</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.search}
        placeholder="Search by ref, subject..."
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
          ListEmptyComponent={<Text style={styles.empty}>No SAR filings found</Text>}
          onEndReached={() => {
            if (items.length < total) setPage((p) => p + 1);
          }}
          onEndReachedThreshold={0.5}
        />
      )}

      <Modal visible={showCreateModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New SAR Filing</Text>
            <TextInput
              style={styles.input}
              placeholder="Subject / suspect name *"
              placeholderTextColor="#64748b"
              value={form.subject}
              onChangeText={(t) => setForm((f) => ({ ...f, subject: t }))}
            />
            <TextInput
              style={styles.input}
              placeholder="Suspicious amount"
              placeholderTextColor="#64748b"
              value={form.amount}
              onChangeText={(t) => setForm((f) => ({ ...f, amount: t }))}
              keyboardType="numeric"
            />
            <TextInput
              style={[styles.input, { height: 80 }]}
              placeholder="Description of suspicious activity *"
              placeholderTextColor="#64748b"
              value={form.description}
              onChangeText={(t) => setForm((f) => ({ ...f, description: t }))}
              multiline
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
                  if (!form.subject.trim() || !form.description.trim())
                    return Alert.alert("Error", "Subject and description are required");
                  createMutation.mutate({
                    subject: form.subject,
                    description: form.description,
                    amount: form.amount ? Number(form.amount) : undefined,
                    currency: form.currency,
                  });
                }}
              >
                <Text style={styles.modalBtnText}>
                  {createMutation.isPending ? "Creating…" : "Create Draft"}
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
  sarRef: { fontSize: 14, fontWeight: "600", color: "#f8fafc" },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  detail: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  timestamp: { fontSize: 11, color: "#475569", marginTop: 6 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10 },
  actionBtn: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  actionBtnText: { fontSize: 12, color: "#fff", fontWeight: "600" },
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
