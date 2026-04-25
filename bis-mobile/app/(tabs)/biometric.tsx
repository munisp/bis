/**
 * Biometric Enrollment tab — BIS Mobile (Expo)
 * Face and fingerprint enrollment with liveness check and verification.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "@/lib/trpc";

const STATUS_COLORS: Record<string, string> = {
  enrolled: "#22c55e",
  pending: "#eab308",
  failed: "#ef4444",
  revoked: "#64748b",
};

const MODALITY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  face: "person-circle-outline",
  fingerprint: "finger-print-outline",
  iris: "eye-outline",
  voice: "mic-outline",
};

export default function BiometricScreen() {
  const [page, setPage] = useState(1);
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [form, setForm] = useState({
    subjectId: "",
    subjectName: "",
    modality: "face",
    imageData: "",
  });

  const utils = trpc.useUtils();

  const { data, isLoading, refetch, isFetching } = trpc.biometric.list.useQuery({
    page,
    limit: 20,
  });

  const enrollMutation = trpc.biometric.enroll.useMutation({
    onSuccess: () => {
      setShowEnrollModal(false);
      setForm({ subjectId: "", subjectName: "", modality: "face", imageData: "" });
      utils.biometric.list.invalidate();
      Alert.alert("Enrolled", "Biometric enrollment successful");
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const verifyMutation = trpc.biometric.verify.useMutation({
    onSuccess: (result) => {
      const r = result as Record<string, unknown>;
      Alert.alert(
        r.match ? "Match Found" : "No Match",
        r.match
          ? `Identity verified with ${Number(r.confidence ?? 0).toFixed(1)}% confidence`
          : "Biometric verification failed — no match found"
      );
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const deleteMutation = trpc.biometric.delete.useMutation({
    onSuccess: () => utils.biometric.list.invalidate(),
    onError: (err) => Alert.alert("Error", err.message),
  });

  const items = (data as { data?: unknown[] })?.data ?? [];
  const total = (data as { total?: number })?.total ?? 0;

  const MODALITIES = ["face", "fingerprint", "iris", "voice"];

  const renderItem = ({ item }: { item: unknown }) => {
    const rec = item as Record<string, unknown>;
    const status = (rec.status as string) ?? "pending";
    const modality = (rec.modality as string) ?? "face";
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.modalityIcon}>
            <Ionicons
              name={MODALITY_ICONS[modality] ?? "finger-print-outline"}
              size={24}
              color="#818cf8"
            />
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.subjectName}>{(rec.subjectName as string) ?? "—"}</Text>
            <Text style={styles.subjectId}>ID: {(rec.subjectId as string) ?? "—"}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: STATUS_COLORS[status] ?? "#64748b" }]}>
            <Text style={styles.badgeText}>{status.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.detail}>Modality: {modality.toUpperCase()}</Text>
        {rec.qualityScore !== undefined && (
          <Text style={styles.detail}>Quality Score: {Number(rec.qualityScore).toFixed(1)}%</Text>
        )}
        {rec.enrolledAt && (
          <Text style={styles.timestamp}>
            Enrolled: {new Date(rec.enrolledAt as string).toLocaleString()}
          </Text>
        )}
        <View style={styles.actions}>
          {status === "enrolled" && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: "#3b82f6" }]}
              onPress={() =>
                Alert.alert("Verify", "Run biometric verification for this subject?", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Verify",
                    onPress: () =>
                      verifyMutation.mutate({
                        subjectId: rec.subjectId as string,
                        modality,
                        imageData: "live_capture_placeholder",
                      }),
                  },
                ])
              }
            >
              <Text style={styles.actionBtnText}>Verify</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: "#ef4444" }]}
            onPress={() =>
              Alert.alert("Delete", "Delete this biometric record?", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () => deleteMutation.mutate({ id: rec.id as number }),
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
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Biometric Enrollment</Text>
          <Text style={styles.subtitle}>{total} enrolled subjects</Text>
        </View>
        <TouchableOpacity style={styles.enrollBtn} onPress={() => setShowEnrollModal(true)}>
          <Ionicons name="add-outline" size={18} color="#fff" />
          <Text style={styles.enrollBtnText}>Enroll</Text>
        </TouchableOpacity>
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        {["face", "fingerprint", "iris"].map((m) => {
          const count = items.filter((i) => (i as Record<string, unknown>).modality === m).length;
          return (
            <View key={m} style={styles.statCard}>
              <Ionicons name={MODALITY_ICONS[m] ?? "finger-print-outline"} size={20} color="#818cf8" />
              <Text style={styles.statValue}>{count}</Text>
              <Text style={styles.statLabel}>{m.toUpperCase()}</Text>
            </View>
          );
        })}
      </View>

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
          ListEmptyComponent={<Text style={styles.empty}>No biometric records found</Text>}
          onEndReached={() => {
            if (items.length < total) setPage((p) => p + 1);
          }}
          onEndReachedThreshold={0.5}
        />
      )}

      {/* Enroll Modal */}
      <Modal visible={showEnrollModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Biometric Enrollment</Text>

            <TextInput
              style={styles.input}
              placeholder="Subject ID (NIN/BVN) *"
              placeholderTextColor="#64748b"
              value={form.subjectId}
              onChangeText={(t) => setForm((f) => ({ ...f, subjectId: t }))}
            />
            <TextInput
              style={styles.input}
              placeholder="Subject full name *"
              placeholderTextColor="#64748b"
              value={form.subjectName}
              onChangeText={(t) => setForm((f) => ({ ...f, subjectName: t }))}
            />

            <Text style={styles.label}>Biometric Modality</Text>
            <View style={styles.modalityRow}>
              {MODALITIES.map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.modalityChip, form.modality === m && styles.modalityChipActive]}
                  onPress={() => setForm((f) => ({ ...f, modality: m }))}
                >
                  <Ionicons
                    name={MODALITY_ICONS[m] ?? "finger-print-outline"}
                    size={16}
                    color={form.modality === m ? "#fff" : "#94a3b8"}
                  />
                  <Text style={[styles.modalityChipText, form.modality === m && styles.modalityChipTextActive]}>
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.captureArea}>
              <Ionicons name="camera-outline" size={40} color="#475569" />
              <Text style={styles.captureText}>Camera capture would appear here</Text>
              <Text style={styles.captureSubtext}>In production, device camera is used for live capture</Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: "#334155" }]}
                onPress={() => setShowEnrollModal(false)}
              >
                <Text style={styles.modalBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: "#818cf8" }]}
                onPress={() => {
                  if (!form.subjectId.trim() || !form.subjectName.trim())
                    return Alert.alert("Error", "Subject ID and name are required");
                  enrollMutation.mutate({
                    subjectId: form.subjectId,
                    subjectName: form.subjectName,
                    modality: form.modality,
                    imageData: `mock_capture_${Date.now()}`,
                  });
                }}
              >
                <Text style={styles.modalBtnText}>
                  {enrollMutation.isPending ? "Enrolling…" : "Enroll"}
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
  enrollBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#818cf8", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  enrollBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: "#1e293b", borderRadius: 8, padding: 10, alignItems: "center", gap: 4 },
  statValue: { fontSize: 18, fontWeight: "700", color: "#f8fafc" },
  statLabel: { fontSize: 10, color: "#94a3b8" },
  card: { backgroundColor: "#1e293b", borderRadius: 10, padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 10 },
  modalityIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#818cf822", alignItems: "center", justifyContent: "center" },
  cardInfo: { flex: 1 },
  subjectName: { fontSize: 14, fontWeight: "600", color: "#f8fafc" },
  subjectId: { fontSize: 12, color: "#64748b", marginTop: 2 },
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
  input: { backgroundColor: "#0f172a", color: "#f8fafc", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, fontSize: 14 },
  label: { fontSize: 12, color: "#94a3b8", marginBottom: 8 },
  modalityRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  modalityChip: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#334155" },
  modalityChipActive: { backgroundColor: "#818cf8" },
  modalityChipText: { fontSize: 12, color: "#94a3b8", fontWeight: "600" },
  modalityChipTextActive: { color: "#fff" },
  captureArea: { backgroundColor: "#0f172a", borderRadius: 12, padding: 24, alignItems: "center", marginBottom: 16, borderWidth: 1, borderColor: "#334155", borderStyle: "dashed" },
  captureText: { fontSize: 14, color: "#64748b", marginTop: 8 },
  captureSubtext: { fontSize: 11, color: "#475569", marginTop: 4, textAlign: "center" },
  modalActions: { flexDirection: "row", gap: 12 },
  modalBtn: { flex: 1, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  modalBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
});
