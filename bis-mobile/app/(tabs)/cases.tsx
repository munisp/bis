/**
 * Cases tab — BIS Mobile (Expo)
 * Investigation case management with CRUD, escalation, and notes.
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
  ScrollView,
} from "react-native";
import { trpc } from "@/lib/trpc";

const STATUS_COLORS: Record<string, string> = {
  open: "#3b82f6",
  under_review: "#eab308",
  escalated: "#f97316",
  closed: "#22c55e",
  dismissed: "#64748b",
};

export default function CasesScreen() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [noteText, setNoteText] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  const { data, isLoading, refetch, isFetching } = trpc.cases.list.useQuery({
    search,
    page,
    limit: 20,
  });

  const createMutation = trpc.cases.create.useMutation({
    onSuccess: () => {
      setShowCreateModal(false);
      setNewTitle("");
      setNewDesc("");
      utils.cases.list.invalidate();
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const escalateMutation = trpc.cases.escalate.useMutation({
    onSuccess: () => {
      utils.cases.list.invalidate();
      Alert.alert("Escalated", "Case has been escalated");
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const addNoteMutation = trpc.cases.addNote.useMutation({
    onSuccess: () => {
      setNoteText("");
      setSelectedCaseId(null);
      Alert.alert("Note Added", "Note has been added to the case");
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const items = (data as { data?: unknown[] })?.data ?? [];
  const total = (data as { total?: number })?.total ?? 0;

  const renderItem = ({ item }: { item: unknown }) => {
    const c = item as Record<string, unknown>;
    const status = (c.status as string) ?? "open";
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.caseTitle} numberOfLines={1}>{(c.title as string) ?? "—"}</Text>
          <View style={[styles.badge, { backgroundColor: STATUS_COLORS[status] ?? "#64748b" }]}>
            <Text style={styles.badgeText}>{status.replace("_", " ").toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.detail}>Ref: {(c.caseRef as string) ?? "—"}</Text>
        <Text style={styles.detail}>Priority: {(c.priority as string) ?? "—"}</Text>
        {c.description && (
          <Text style={styles.desc} numberOfLines={2}>{c.description as string}</Text>
        )}
        <Text style={styles.timestamp}>
          {c.createdAt ? new Date(c.createdAt as string).toLocaleString() : "—"}
        </Text>
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => {
              setSelectedCaseId(c.id as number);
            }}
          >
            <Text style={styles.actionBtnText}>Add Note</Text>
          </TouchableOpacity>
          {status !== "escalated" && status !== "closed" && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: "#f97316" }]}
              onPress={() =>
                Alert.alert("Escalate", "Escalate this case?", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Escalate", onPress: () => escalateMutation.mutate({ id: c.id as number }) },
                ])
              }
            >
              <Text style={styles.actionBtnText}>Escalate</Text>
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
          <Text style={styles.title}>Cases</Text>
          <Text style={styles.subtitle}>{total} total cases</Text>
        </View>
        <TouchableOpacity style={styles.createBtn} onPress={() => setShowCreateModal(true)}>
          <Text style={styles.createBtnText}>+ New</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.search}
        placeholder="Search by title, ref..."
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
            <Text style={styles.empty}>No cases found</Text>
          }
          onEndReached={() => {
            if (items.length < total) setPage((p) => p + 1);
          }}
          onEndReachedThreshold={0.5}
        />
      )}

      {/* Create Case Modal */}
      <Modal visible={showCreateModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Case</Text>
            <TextInput
              style={styles.input}
              placeholder="Case title *"
              placeholderTextColor="#64748b"
              value={newTitle}
              onChangeText={setNewTitle}
            />
            <TextInput
              style={[styles.input, { height: 80 }]}
              placeholder="Description"
              placeholderTextColor="#64748b"
              value={newDesc}
              onChangeText={setNewDesc}
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
                  if (!newTitle.trim()) return Alert.alert("Error", "Title is required");
                  createMutation.mutate({ title: newTitle, description: newDesc });
                }}
              >
                <Text style={styles.modalBtnText}>
                  {createMutation.isPending ? "Creating…" : "Create"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Note Modal */}
      <Modal visible={selectedCaseId !== null} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Note</Text>
            <TextInput
              style={[styles.input, { height: 100 }]}
              placeholder="Enter note..."
              placeholderTextColor="#64748b"
              value={noteText}
              onChangeText={setNoteText}
              multiline
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: "#334155" }]}
                onPress={() => { setSelectedCaseId(null); setNoteText(""); }}
              >
                <Text style={styles.modalBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: "#3b82f6" }]}
                onPress={() => {
                  if (!noteText.trim()) return Alert.alert("Error", "Note cannot be empty");
                  addNoteMutation.mutate({ id: selectedCaseId!, note: noteText });
                }}
              >
                <Text style={styles.modalBtnText}>
                  {addNoteMutation.isPending ? "Saving…" : "Save Note"}
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
  caseTitle: { fontSize: 14, fontWeight: "600", color: "#f8fafc", flex: 1, marginRight: 8 },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  detail: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  desc: { fontSize: 12, color: "#64748b", marginTop: 4 },
  timestamp: { fontSize: 11, color: "#475569", marginTop: 6 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10 },
  actionBtn: { backgroundColor: "#334155", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  actionBtnText: { fontSize: 12, color: "#f8fafc", fontWeight: "600" },
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
