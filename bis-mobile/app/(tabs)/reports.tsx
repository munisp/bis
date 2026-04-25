/**
 * Regulatory Reports tab — BIS Mobile (Expo)
 * CBN/NFIU regulatory report submissions with CRUD and filing workflow.
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
  pending_review: "#eab308",
  approved: "#22c55e",
  submitted: "#3b82f6",
  rejected: "#ef4444",
};

const REPORT_TYPES = ["CTR", "STR", "ANNUAL", "QUARTERLY", "MONTHLY", "ADHOC"];

export default function ReportsScreen() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState({
    reportType: "CTR",
    title: "",
    description: "",
    periodStart: "",
    periodEnd: "",
  });

  const utils = trpc.useUtils();

  const { data, isLoading, refetch, isFetching } = trpc.regulatoryReports.list.useQuery({
    search,
    page,
    limit: 20,
  });

  const createMutation = trpc.regulatoryReports.create.useMutation({
    onSuccess: () => {
      setShowCreateModal(false);
      setForm({ reportType: "CTR", title: "", description: "", periodStart: "", periodEnd: "" });
      utils.regulatoryReports.list.invalidate();
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const submitMutation = trpc.regulatoryReports.submit.useMutation({
    onSuccess: () => {
      utils.regulatoryReports.list.invalidate();
      Alert.alert("Submitted", "Report submitted to regulator");
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const deleteMutation = trpc.regulatoryReports.delete.useMutation({
    onSuccess: () => utils.regulatoryReports.list.invalidate(),
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
          <View>
            <Text style={styles.reportTitle}>{(r.title as string) ?? "—"}</Text>
            <Text style={styles.reportType}>{(r.reportType as string) ?? "—"}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: STATUS_COLORS[status] ?? "#64748b" }]}>
            <Text style={styles.badgeText}>{status.replace("_", " ").toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.detail}>Ref: {(r.reportRef as string) ?? "—"}</Text>
        {r.periodStart && r.periodEnd && (
          <Text style={styles.detail}>
            Period: {new Date(r.periodStart as string).toLocaleDateString()} — {new Date(r.periodEnd as string).toLocaleDateString()}
          </Text>
        )}
        {r.description && (
          <Text style={styles.detail} numberOfLines={2}>{r.description as string}</Text>
        )}
        <Text style={styles.timestamp}>
          {r.createdAt ? new Date(r.createdAt as string).toLocaleString() : "—"}
        </Text>
        <View style={styles.actions}>
          {(status === "draft" || status === "approved") && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: "#3b82f6" }]}
              onPress={() =>
                Alert.alert("Submit Report", "Submit this regulatory report?", [
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
                Alert.alert("Delete", "Delete this report?", [
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
          <Text style={styles.title}>Regulatory Reports</Text>
          <Text style={styles.subtitle}>{total} total reports</Text>
        </View>
        <TouchableOpacity style={styles.createBtn} onPress={() => setShowCreateModal(true)}>
          <Text style={styles.createBtnText}>+ New Report</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.search}
        placeholder="Search by title, ref, type..."
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
          ListEmptyComponent={<Text style={styles.empty}>No regulatory reports found</Text>}
          onEndReached={() => {
            if (items.length < total) setPage((p) => p + 1);
          }}
          onEndReachedThreshold={0.5}
        />
      )}

      {/* Create Report Modal */}
      <Modal visible={showCreateModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Regulatory Report</Text>

            {/* Report Type Selector */}
            <Text style={styles.label}>Report Type</Text>
            <View style={styles.typeRow}>
              {REPORT_TYPES.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typeChip, form.reportType === t && styles.typeChipActive]}
                  onPress={() => setForm((f) => ({ ...f, reportType: t }))}
                >
                  <Text style={[styles.typeChipText, form.reportType === t && styles.typeChipTextActive]}>
                    {t}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.input}
              placeholder="Report title *"
              placeholderTextColor="#64748b"
              value={form.title}
              onChangeText={(t) => setForm((f) => ({ ...f, title: t }))}
            />
            <TextInput
              style={styles.input}
              placeholder="Period start (YYYY-MM-DD)"
              placeholderTextColor="#64748b"
              value={form.periodStart}
              onChangeText={(t) => setForm((f) => ({ ...f, periodStart: t }))}
            />
            <TextInput
              style={styles.input}
              placeholder="Period end (YYYY-MM-DD)"
              placeholderTextColor="#64748b"
              value={form.periodEnd}
              onChangeText={(t) => setForm((f) => ({ ...f, periodEnd: t }))}
            />
            <TextInput
              style={[styles.input, { height: 70 }]}
              placeholder="Description"
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
                  if (!form.title.trim()) return Alert.alert("Error", "Title is required");
                  createMutation.mutate({
                    reportType: form.reportType,
                    title: form.title,
                    description: form.description,
                    periodStart: form.periodStart || undefined,
                    periodEnd: form.periodEnd || undefined,
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
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
  reportTitle: { fontSize: 14, fontWeight: "600", color: "#f8fafc" },
  reportType: { fontSize: 11, color: "#3b82f6", marginTop: 2 },
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
  label: { fontSize: 12, color: "#94a3b8", marginBottom: 8 },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  typeChip: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#334155" },
  typeChipActive: { backgroundColor: "#3b82f6" },
  typeChipText: { fontSize: 12, color: "#94a3b8", fontWeight: "600" },
  typeChipTextActive: { color: "#fff" },
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
