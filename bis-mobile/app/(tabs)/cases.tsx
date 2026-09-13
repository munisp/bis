import React, { useState } from "react";
import { View, Text, FlatList, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, RefreshControl, Alert, Modal } from "react-native";
import { trpc } from "@/lib/trpc";

const STATUS_COLORS: Record<string, string> = { open: "#3b82f6", under_review: "#eab308", escalated: "#f97316", closed: "#22c55e", dismissed: "#64748b" };
const PAGE_SIZE = 20;

export default function CasesScreen() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSummary, setNewSummary] = useState("");
  const [noteText, setNoteText] = useState("");
  const [selectedCaseRef, setSelectedCaseRef] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const { data, isLoading, refetch, isFetching } = trpc.cases.list.useQuery({ search: search.trim() || undefined, page, pageSize: PAGE_SIZE });
  const createMutation = trpc.cases.create.useMutation({
    onSuccess: () => { setShowCreateModal(false); setNewTitle(""); setNewSummary(""); void utils.cases.list.invalidate(); },
    onError: () => Alert.alert("Unable to create case", "No case was created. Check the information and try again."),
  });
  const reviewMutation = trpc.cases.update.useMutation({
    onSuccess: () => { void utils.cases.list.invalidate(); Alert.alert("Case moved to review", "The case is now under review."); },
    onError: () => Alert.alert("Unable to update case", "The case status was not changed."),
  });
  const addCommentMutation = trpc.cases.addComment.useMutation({
    onSuccess: () => { setNoteText(""); setSelectedCaseRef(null); Alert.alert("Note added", "The case comment was saved."); },
    onError: () => Alert.alert("Unable to add note", "The comment was not saved."),
  });

  const cases = data?.cases ?? [];
  const total = data?.total ?? 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}><View><Text style={styles.title}>Cases</Text><Text style={styles.subtitle}>{total} authorised case{total === 1 ? "" : "s"}</Text></View><TouchableOpacity accessibilityRole="button" style={styles.createBtn} onPress={() => setShowCreateModal(true)}><Text style={styles.createBtnText}>+ New</Text></TouchableOpacity></View>
      <TextInput style={styles.search} placeholder="Search title or reference" placeholderTextColor="#64748b" value={search} onChangeText={(value) => { setSearch(value); setPage(1); }} accessibilityLabel="Search cases" />
      {isLoading ? <ActivityIndicator color="#3b82f6" style={{ marginTop: 32 }} /> : (
        <FlatList
          data={cases}
          keyExtractor={(item) => item.ref}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => void refetch()} tintColor="#3b82f6" />}
          renderItem={({ item: caseItem }) => {
            const status = caseItem.status ?? "open";
            return <View style={styles.card} accessibilityLabel={`Case ${caseItem.ref}`}>
              <View style={styles.cardHeader}><Text style={styles.caseTitle} numberOfLines={1}>{caseItem.title}</Text><View style={[styles.badge, { backgroundColor: STATUS_COLORS[status] ?? "#64748b" }]}><Text style={styles.badgeText}>{status.replace("_", " ").toUpperCase()}</Text></View></View>
              <Text style={styles.detail}>Ref: {caseItem.ref}</Text><Text style={styles.detail}>Priority: {caseItem.priority ?? "—"}</Text>
              {caseItem.summary ? <Text style={styles.desc} numberOfLines={2}>{caseItem.summary}</Text> : null}
              <Text style={styles.timestamp}>{caseItem.createdAt ? new Date(caseItem.createdAt).toLocaleString() : "—"}</Text>
              <View style={styles.actions}>
                <TouchableOpacity accessibilityRole="button" style={styles.actionBtn} onPress={() => setSelectedCaseRef(caseItem.ref)}><Text style={styles.actionBtnText}>Add note</Text></TouchableOpacity>
                {status !== "under_review" && status !== "closed" ? <TouchableOpacity accessibilityRole="button" style={[styles.actionBtn, styles.reviewBtn]} onPress={() => Alert.alert("Move to review", "Move this case to under review?", [{ text: "Cancel", style: "cancel" }, { text: "Confirm", onPress: () => reviewMutation.mutate({ ref: caseItem.ref, status: "under_review" }) }])}><Text style={styles.actionBtnText}>Review</Text></TouchableOpacity> : null}
              </View>
            </View>;
          }}
          ListEmptyComponent={<Text style={styles.empty}>No cases found</Text>}
          onEndReached={() => { if (cases.length >= PAGE_SIZE && page * PAGE_SIZE < total) setPage((value) => value + 1); }}
          onEndReachedThreshold={0.5}
        />
      )}
      <Modal visible={showCreateModal} animationType="slide" transparent onRequestClose={() => setShowCreateModal(false)}><View style={styles.modalOverlay}><View style={styles.modalContent}><Text style={styles.modalTitle}>New case</Text><TextInput style={styles.input} placeholder="Case title *" placeholderTextColor="#64748b" value={newTitle} onChangeText={setNewTitle} /><TextInput style={[styles.input, { height: 80 }]} placeholder="Summary" placeholderTextColor="#64748b" value={newSummary} onChangeText={setNewSummary} multiline /><View style={styles.modalActions}><TouchableOpacity style={[styles.modalBtn, styles.cancelBtn]} onPress={() => setShowCreateModal(false)}><Text style={styles.modalBtnText}>Cancel</Text></TouchableOpacity><TouchableOpacity style={[styles.modalBtn, styles.submitBtn]} disabled={createMutation.isPending} onPress={() => { if (!newTitle.trim()) { Alert.alert("Title required", "Enter a title before creating the case."); return; } createMutation.mutate({ title: newTitle.trim(), type: "other", summary: newSummary.trim() || undefined }); }}><Text style={styles.modalBtnText}>{createMutation.isPending ? "Creating…" : "Create"}</Text></TouchableOpacity></View></View></View></Modal>
      <Modal visible={selectedCaseRef !== null} animationType="slide" transparent onRequestClose={() => setSelectedCaseRef(null)}><View style={styles.modalOverlay}><View style={styles.modalContent}><Text style={styles.modalTitle}>Add note</Text><TextInput style={[styles.input, { height: 100 }]} placeholder="Enter note" placeholderTextColor="#64748b" value={noteText} onChangeText={setNoteText} multiline /><View style={styles.modalActions}><TouchableOpacity style={[styles.modalBtn, styles.cancelBtn]} onPress={() => { setSelectedCaseRef(null); setNoteText(""); }}><Text style={styles.modalBtnText}>Cancel</Text></TouchableOpacity><TouchableOpacity style={[styles.modalBtn, styles.submitBtn]} disabled={addCommentMutation.isPending} onPress={() => { if (!selectedCaseRef || !noteText.trim()) { Alert.alert("Note required", "Enter a note before saving."); return; } addCommentMutation.mutate({ caseRef: selectedCaseRef, content: noteText.trim() }); }}><Text style={styles.modalBtnText}>{addCommentMutation.isPending ? "Saving…" : "Save note"}</Text></TouchableOpacity></View></View></View></Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", padding: 16 }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }, title: { fontSize: 22, fontWeight: "700", color: "#f8fafc" }, subtitle: { fontSize: 13, color: "#94a3b8" }, createBtn: { backgroundColor: "#3b82f6", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 }, createBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 }, search: { backgroundColor: "#1e293b", color: "#f8fafc", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12, fontSize: 14 }, card: { backgroundColor: "#1e293b", borderRadius: 10, padding: 14, marginBottom: 10 }, cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }, caseTitle: { fontSize: 14, fontWeight: "600", color: "#f8fafc", flex: 1, marginRight: 8 }, badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }, badgeText: { fontSize: 10, fontWeight: "700", color: "#fff" }, detail: { fontSize: 12, color: "#94a3b8", marginTop: 2 }, desc: { fontSize: 12, color: "#64748b", marginTop: 4 }, timestamp: { fontSize: 11, color: "#475569", marginTop: 6 }, actions: { flexDirection: "row", gap: 8, marginTop: 10 }, actionBtn: { backgroundColor: "#334155", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 }, reviewBtn: { backgroundColor: "#b45309" }, actionBtnText: { fontSize: 12, color: "#f8fafc", fontWeight: "600" }, empty: { textAlign: "center", color: "#64748b", marginTop: 48 }, modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" }, modalContent: { backgroundColor: "#1e293b", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20 }, modalTitle: { fontSize: 18, fontWeight: "700", color: "#f8fafc", marginBottom: 16 }, input: { backgroundColor: "#0f172a", color: "#f8fafc", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, fontSize: 14 }, modalActions: { flexDirection: "row", gap: 12, marginTop: 4 }, modalBtn: { flex: 1, borderRadius: 8, paddingVertical: 12, alignItems: "center" }, cancelBtn: { backgroundColor: "#334155" }, submitBtn: { backgroundColor: "#3b82f6" }, modalBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
});
