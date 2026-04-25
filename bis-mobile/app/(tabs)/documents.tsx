/**
 * Documents tab — BIS Mobile (Expo)
 * Document vault with search, upload, and download.
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

const TYPE_COLORS: Record<string, string> = {
  pdf: "#ef4444",
  docx: "#3b82f6",
  xlsx: "#22c55e",
  image: "#8b5cf6",
  other: "#64748b",
};

export default function DocumentsScreen() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const utils = trpc.useUtils();

  const { data, isLoading, refetch, isFetching } = trpc.documentVault.list.useQuery({
    search,
    page,
    limit: 20,
  });

  const deleteMutation = trpc.documentVault.delete.useMutation({
    onSuccess: () => utils.documentVault.list.invalidate(),
    onError: (err) => Alert.alert("Error", err.message),
  });

  const items = (data as { data?: unknown[] })?.data ?? [];
  const total = (data as { total?: number })?.total ?? 0;

  const getDocType = (filename: string): string => {
    const ext = filename?.split(".").pop()?.toLowerCase() ?? "other";
    if (["pdf"].includes(ext)) return "pdf";
    if (["doc", "docx"].includes(ext)) return "docx";
    if (["xls", "xlsx", "csv"].includes(ext)) return "xlsx";
    if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
    return "other";
  };

  const renderItem = ({ item }: { item: unknown }) => {
    const doc = item as Record<string, unknown>;
    const docType = getDocType((doc.filename as string) ?? "");
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={[styles.typeTag, { backgroundColor: TYPE_COLORS[docType] ?? "#64748b" }]}>
            <Text style={styles.typeTagText}>{docType.toUpperCase()}</Text>
          </View>
          <Text style={styles.filename} numberOfLines={1}>{(doc.filename as string) ?? "—"}</Text>
        </View>
        <Text style={styles.detail}>Category: {(doc.category as string) ?? "—"}</Text>
        {doc.description && (
          <Text style={styles.detail} numberOfLines={2}>{doc.description as string}</Text>
        )}
        <Text style={styles.detail}>
          Size: {doc.fileSize ? `${Math.round(Number(doc.fileSize) / 1024)} KB` : "—"}
        </Text>
        <Text style={styles.timestamp}>
          {doc.createdAt ? new Date(doc.createdAt as string).toLocaleString() : "—"}
        </Text>
        <View style={styles.actions}>
          {doc.fileUrl && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: "#3b82f6" }]}
              onPress={() => Alert.alert("Download", `Opening: ${doc.filename}`)}
            >
              <Text style={styles.actionBtnText}>Download</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: "#ef4444" }]}
            onPress={() =>
              Alert.alert("Delete", "Delete this document?", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () => deleteMutation.mutate({ id: doc.id as number }),
                },
              ])
            }
          >
            <Text style={styles.actionBtnText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Document Vault</Text>
      <Text style={styles.subtitle}>{total} total documents</Text>

      <TextInput
        style={styles.search}
        placeholder="Search by filename, category..."
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
          ListEmptyComponent={<Text style={styles.empty}>No documents found</Text>}
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
  card: { backgroundColor: "#1e293b", borderRadius: 10, padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 8 },
  typeTag: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  typeTagText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  filename: { fontSize: 13, fontWeight: "600", color: "#f8fafc", flex: 1 },
  detail: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  timestamp: { fontSize: 11, color: "#475569", marginTop: 6 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10 },
  actionBtn: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  actionBtnText: { fontSize: 12, color: "#fff", fontWeight: "600" },
  empty: { textAlign: "center", color: "#64748b", marginTop: 48 },
});
