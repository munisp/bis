import React, { useEffect, useMemo, useState } from "react";
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
  Linking,
  Modal,
  Pressable,
} from "react-native";
import { trpc } from "@/lib/trpc";

const PAGE_SIZE = 20;
const TYPE_COLORS: Record<string, string> = {
  pdf: "#ef4444",
  docx: "#3b82f6",
  xlsx: "#22c55e",
  image: "#8b5cf6",
  other: "#64748b",
};

type VaultDocument = {
  id: number;
  filename: string;
  category: string | null;
  description: string | null;
  sizeBytes: number | null;
  createdAt: string | Date | null;
  url: string | null;
};

type VaultListResponse = {
  documents: VaultDocument[];
  total: number;
  limit: number;
  offset: number;
};

function documentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "other";
  if (ext === "pdf") return "pdf";
  if (["doc", "docx"].includes(ext)) return "docx";
  if (["xls", "xlsx", "csv"].includes(ext)) return "xlsx";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  return "other";
}

function formatBytes(sizeBytes: number | null): string {
  if (!sizeBytes || sizeBytes <= 0) return "Size unavailable";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsScreen() {
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<VaultDocument | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const utils = trpc.useUtils();

  useEffect(() => {
    const timer = setTimeout(() => {
      const nextSearch = searchDraft.trim();
      setSearch(nextSearch);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const listInput = useMemo(() => ({
    search: search || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [page, search]);

  const query = trpc.documentVault.list.useQuery(listInput, {
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const data = query.data as VaultListResponse | undefined;
  const items = data?.documents ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const deleteMutation = trpc.documentVault.delete.useMutation({
    onSuccess: async () => {
      setPendingDelete(null);
      setDeleteReason("");
      await utils.documentVault.list.invalidate();
      Alert.alert("Document deleted", "The document has been removed and its custody event was recorded.");
    },
    onError: () => Alert.alert("Unable to delete document", "The document was not changed. Check your permission and try again."),
  });

  const openDocument = async (document: VaultDocument) => {
    if (!document.url) return;
    try {
      const url = new URL(document.url);
      if (url.protocol !== "https:") throw new Error("unsafe document URL");
      const supported = await Linking.canOpenURL(url.toString());
      if (!supported) throw new Error("device cannot open document URL");
      await Linking.openURL(url.toString());
    } catch {
      Alert.alert("Unable to open document", "The secure document link is unavailable. Refresh the vault and try again.");
    }
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const reason = deleteReason.trim();
    if (reason.length < 1 || reason.length > 500) {
      Alert.alert("A deletion reason is required", "Enter a concise reason of up to 500 characters for the custody record.");
      return;
    }
    deleteMutation.mutate({ id: pendingDelete.id, reason });
  };

  const renderItem = ({ item }: { item: VaultDocument }) => {
    const type = documentType(item.filename);
    return (
      <View style={styles.card} accessibilityLabel={`Document ${item.filename}`}>
        <View style={styles.cardHeader}>
          <View style={[styles.typeTag, { backgroundColor: TYPE_COLORS[type] ?? TYPE_COLORS.other }]} accessibilityLabel={`${type} document`}>
            <Text style={styles.typeTagText}>{type.toUpperCase()}</Text>
          </View>
          <Text style={styles.filename} numberOfLines={2}>{item.filename}</Text>
        </View>
        <Text style={styles.detail}>Category: {item.category ?? "Uncategorised"}</Text>
        {item.description ? <Text style={styles.detail} numberOfLines={2}>{item.description}</Text> : null}
        <Text style={styles.detail}>{formatBytes(item.sizeBytes)}</Text>
        <Text style={styles.timestamp}>{item.createdAt ? new Date(item.createdAt).toLocaleString() : "Date unavailable"}</Text>
        <View style={styles.actions}>
          <TouchableOpacity
            disabled={!item.url}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.filename}`}
            accessibilityHint="Opens the authorized secure document link"
            style={[styles.actionBtn, styles.openButton, !item.url && styles.disabledButton]}
            onPress={() => void openDocument(item)}
          >
            <Text style={styles.actionBtnText}>{item.url ? "Open securely" : "Link unavailable"}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Delete ${item.filename}`}
            accessibilityHint="Requires a reason and records custody history"
            style={[styles.actionBtn, styles.deleteButton]}
            onPress={() => { setPendingDelete(item); setDeleteReason(""); }}
          >
            <Text style={styles.actionBtnText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (query.error && !query.isFetching) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Document Vault</Text>
        <View style={styles.statePanel}>
          <Text style={styles.stateTitle}>Unable to load documents</Text>
          <Text style={styles.stateText}>Your documents were not displayed. No changes were made.</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry loading documents" style={[styles.actionBtn, styles.openButton]} onPress={() => void query.refetch()}>
            <Text style={styles.actionBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Document Vault</Text>
      <Text style={styles.subtitle}>{total} document{total === 1 ? "" : "s"} · Page {page + 1} of {pageCount}</Text>
      <TextInput
        style={styles.search}
        placeholder="Search filename or description"
        placeholderTextColor="#94a3b8"
        value={searchDraft}
        onChangeText={setSearchDraft}
        returnKeyType="search"
        accessibilityLabel="Search documents"
        accessibilityHint="Filters authorized document metadata"
      />
      {query.isLoading ? <ActivityIndicator color="#60a5fa" style={styles.loader} accessibilityLabel="Loading documents" /> : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={items.length === 0 ? styles.emptyList : undefined}
          refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} tintColor="#60a5fa" />}
          ListEmptyComponent={<View style={styles.statePanel}><Text style={styles.stateTitle}>No documents found</Text><Text style={styles.stateText}>Try a different search or add a document from the linked case workflow.</Text></View>}
          ListFooterComponent={
            <View style={styles.pagination}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous document page" disabled={page === 0 || query.isFetching} style={[styles.pageButton, (page === 0 || query.isFetching) && styles.disabledButton]} onPress={() => setPage((current) => Math.max(0, current - 1))}><Text style={styles.actionBtnText}>Previous</Text></TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next document page" disabled={page + 1 >= pageCount || query.isFetching} style={[styles.pageButton, (page + 1 >= pageCount || query.isFetching) && styles.disabledButton]} onPress={() => setPage((current) => current + 1)}><Text style={styles.actionBtnText}>Next</Text></TouchableOpacity>
            </View>
          }
        />
      )}
      <Modal visible={pendingDelete !== null} transparent animationType="fade" onRequestClose={() => setPendingDelete(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPendingDelete(null)}>
          <Pressable style={styles.modalCard} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.modalTitle}>Delete document</Text>
            <Text style={styles.stateText}>This action records a custody event. Explain why {pendingDelete?.filename ?? "this document"} should be removed.</Text>
            <TextInput style={styles.reasonInput} value={deleteReason} onChangeText={setDeleteReason} placeholder="Required deletion reason" placeholderTextColor="#94a3b8" multiline maxLength={500} accessibilityLabel="Deletion reason" />
            <View style={styles.actions}>
              <TouchableOpacity accessibilityRole="button" style={[styles.actionBtn, styles.cancelButton]} onPress={() => setPendingDelete(null)}><Text style={styles.actionBtnText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" disabled={deleteMutation.isPending} style={[styles.actionBtn, styles.deleteButton, deleteMutation.isPending && styles.disabledButton]} onPress={confirmDelete}><Text style={styles.actionBtnText}>{deleteMutation.isPending ? "Deleting…" : "Confirm delete"}</Text></TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b1220", padding: 16 },
  title: { fontSize: 24, fontWeight: "700", color: "#f8fafc", marginBottom: 4 },
  subtitle: { fontSize: 13, color: "#94a3b8", marginBottom: 12 },
  search: { backgroundColor: "#172033", borderColor: "#334155", borderWidth: 1, color: "#f8fafc", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, fontSize: 15 },
  loader: { marginTop: 32 },
  card: { backgroundColor: "#172033", borderRadius: 12, borderWidth: 1, borderColor: "#26334a", padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 8 },
  typeTag: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3 },
  typeTagText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  filename: { fontSize: 14, fontWeight: "600", color: "#f8fafc", flex: 1 },
  detail: { fontSize: 12, color: "#cbd5e1", marginTop: 3 },
  timestamp: { fontSize: 11, color: "#94a3b8", marginTop: 7 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  actionBtn: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, minHeight: 40, justifyContent: "center" },
  openButton: { backgroundColor: "#2563eb" },
  deleteButton: { backgroundColor: "#b91c1c" },
  cancelButton: { backgroundColor: "#475569" },
  disabledButton: { opacity: 0.45 },
  actionBtnText: { fontSize: 13, color: "#fff", fontWeight: "700" },
  statePanel: { alignItems: "center", backgroundColor: "#172033", borderRadius: 12, borderWidth: 1, borderColor: "#334155", padding: 22, marginTop: 24 },
  stateTitle: { color: "#f8fafc", fontSize: 16, fontWeight: "700", marginBottom: 6 },
  stateText: { color: "#cbd5e1", fontSize: 13, lineHeight: 19, textAlign: "center" },
  emptyList: { flexGrow: 1 },
  pagination: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 16 },
  pageButton: { flex: 1, alignItems: "center", backgroundColor: "#334155", borderRadius: 8, paddingVertical: 10, minHeight: 42 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(2, 6, 23, 0.78)", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: "#172033", borderColor: "#334155", borderWidth: 1, borderRadius: 14, padding: 18 },
  modalTitle: { color: "#f8fafc", fontSize: 18, fontWeight: "700", marginBottom: 8 },
  reasonInput: { minHeight: 86, marginTop: 14, backgroundColor: "#0b1220", borderColor: "#475569", borderWidth: 1, borderRadius: 8, color: "#f8fafc", padding: 10, textAlignVertical: "top" },
});
