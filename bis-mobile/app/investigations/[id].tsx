/**
 * Investigation Detail Screen — bis-mobile
 * Shows subject card, risk score, SLA countdown, status update, and evidence timeline.
 * Uses the same tRPC API as the PWA.
 */
import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { trpc } from "../../lib/trpc";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getSlaLabel(dueAt: Date | string | null | undefined): {
  label: string;
  color: string;
} {
  if (!dueAt) return { label: "No SLA", color: "#6b7280" };
  const due = new Date(dueAt);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  if (diffMs < 0) {
    const overH = Math.floor(Math.abs(diffMs) / 3600000);
    const overD = Math.floor(overH / 24);
    return {
      label: overD > 0 ? `${overD}d overdue` : `${overH}h overdue`,
      color: "#ef4444",
    };
  }
  const hoursLeft = Math.floor(diffMs / 3600000);
  const daysLeft = Math.floor(hoursLeft / 24);
  if (hoursLeft < 24) return { label: `${hoursLeft}h left`, color: "#ef4444" };
  if (daysLeft < 3) return { label: `${daysLeft}d left`, color: "#f59e0b" };
  return { label: `${daysLeft}d left`, color: "#22c55e" };
}

function getRiskColor(score: number | null | undefined): string {
  if (!score) return "#6b7280";
  if (score >= 80) return "#ef4444";
  if (score >= 60) return "#f97316";
  if (score >= 30) return "#f59e0b";
  return "#22c55e";
}

const STATUS_OPTIONS = [
  "pending",
  "in_progress",
  "flagged",
  "completed",
  "closed",
] as const;

// ─── Component ───────────────────────────────────────────────────────────────

export default function InvestigationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);

  const { data: inv, isLoading, refetch } = trpc.investigations.getByRef.useQuery(
    { ref: id! },
    { enabled: !!id }
  );

  const updateStatus = trpc.investigations.updateStatus.useMutation({
    onSuccess: () => {
      refetch();
    },
    onError: (err) => {
      Alert.alert("Error", err.message);
    },
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleStatusChange = (newStatus: string) => {
    if (!inv) return;
    Alert.alert(
      "Update Status",
      `Change status to "${newStatus}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: () => {
            updateStatus.mutate({ ref: inv.ref, status: newStatus as any });
            setShowStatusPicker(false);
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.loadingText}>Loading investigation…</Text>
      </View>
    );
  }

  if (!inv) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Investigation not found</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>← Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const riskColor = getRiskColor((inv as any).riskScore);
  const sla = getSlaLabel((inv as any).dueAt);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.refText}>{inv.ref}</Text>
      </View>

      {/* Subject Card */}
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(inv as any).subjectName?.charAt(0)?.toUpperCase() ?? "?"}
            </Text>
          </View>
          <View style={styles.subjectInfo}>
            <Text style={styles.subjectName}>{(inv as any).subjectName}</Text>
            <Text style={styles.subjectMeta}>
              {(inv as any).subjectType} · {(inv as any).country} · {(inv as any).tier} tier
            </Text>
          </View>
          <View style={[styles.riskBadge, { borderColor: riskColor }]}>
            <Text style={[styles.riskScore, { color: riskColor }]}>
              {(inv as any).riskScore ?? "—"}
            </Text>
            <Text style={styles.riskLabel}>Risk</Text>
          </View>
        </View>

        {/* Status row */}
        <View style={styles.statusRow}>
          <View style={[styles.statusBadge, { backgroundColor: getStatusBg((inv as any).status) }]}>
            <Text style={styles.statusText}>{(inv as any).status?.toUpperCase()}</Text>
          </View>
          {(inv as any).dueAt && (
            <View style={[styles.slaBadge, { borderColor: sla.color }]}>
              <Text style={[styles.slaText, { color: sla.color }]}>⏰ {sla.label}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Metadata Card */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Details</Text>
        <MetaRow label="Created" value={formatDate((inv as any).createdAt)} />
        <MetaRow label="Updated" value={formatDateTime((inv as any).updatedAt)} />
        {(inv as any).assignedTo && (
          <MetaRow label="Assigned To" value={(inv as any).assignedTo} />
        )}
        {(inv as any).ninNumber && (
          <MetaRow label="NIN" value={(inv as any).ninNumber} mono />
        )}
        {(inv as any).bvnNumber && (
          <MetaRow label="BVN" value={(inv as any).bvnNumber} mono />
        )}
        {(inv as any).dueAt && (
          <MetaRow label="SLA Due" value={formatDateTime((inv as any).dueAt)} />
        )}
      </View>

      {/* Risk Factors */}
      {(inv as any).riskFactors && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Risk Factors</Text>
          {Object.entries((inv as any).riskFactors as Record<string, unknown>).map(([k, v]) => (
            <MetaRow key={k} label={k.replace(/_/g, " ")} value={String(v)} />
          ))}
        </View>
      )}

      {/* Actions */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Actions</Text>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => setShowStatusPicker(!showStatusPicker)}
        >
          <Text style={styles.actionBtnText}>Update Status</Text>
        </TouchableOpacity>

        {showStatusPicker && (
          <View style={styles.statusPicker}>
            {STATUS_OPTIONS.map((s) => (
              <TouchableOpacity
                key={s}
                style={[
                  styles.statusOption,
                  (inv as any).status === s && styles.statusOptionActive,
                ]}
                onPress={() => handleStatusChange(s)}
              >
                <Text
                  style={[
                    styles.statusOptionText,
                    (inv as any).status === s && styles.statusOptionTextActive,
                  ]}
                >
                  {s.replace(/_/g, " ").toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnSecondary]}
          onPress={() => router.push(`/kyc/biometric?ref=${inv.ref}`)}
        >
          <Text style={styles.actionBtnText}>Biometric Verification</Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={[styles.metaValue, mono && styles.monoText]}>{value}</Text>
    </View>
  );
}

function getStatusBg(status: string): string {
  switch (status) {
    case "flagged": return "#7f1d1d";
    case "completed": return "#14532d";
    case "in_progress": return "#1e3a5f";
    case "closed": return "#1f2937";
    default: return "#374151";
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f1117" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0f1117", padding: 24 },
  loadingText: { color: "#9ca3af", marginTop: 12, fontSize: 14 },
  errorText: { color: "#f87171", fontSize: 16, marginBottom: 16 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  backBtn: { paddingVertical: 6, paddingHorizontal: 4 },
  backBtnText: { color: "#6366f1", fontSize: 14, fontWeight: "600" },
  refText: { color: "#9ca3af", fontSize: 12, fontFamily: "monospace" },
  card: {
    margin: 12,
    marginBottom: 0,
    backgroundColor: "#161b27",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
    padding: 16,
  },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#1e3a5f",
    borderWidth: 1,
    borderColor: "#3b82f6",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { color: "#60a5fa", fontSize: 18, fontWeight: "700" },
  subjectInfo: { flex: 1 },
  subjectName: { color: "#f3f4f6", fontSize: 16, fontWeight: "700" },
  subjectMeta: { color: "#6b7280", fontSize: 12, marginTop: 2, textTransform: "capitalize" },
  riskBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: "center",
  },
  riskScore: { fontSize: 22, fontWeight: "800", fontFamily: "monospace" },
  riskLabel: { color: "#6b7280", fontSize: 9, textTransform: "uppercase", letterSpacing: 1 },
  statusRow: { flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" },
  statusBadge: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: { color: "#e5e7eb", fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  slaBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  slaText: { fontSize: 10, fontWeight: "600" },
  sectionTitle: { color: "#9ca3af", fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#1f2937" },
  metaLabel: { color: "#6b7280", fontSize: 12 },
  metaValue: { color: "#d1d5db", fontSize: 12, maxWidth: "60%", textAlign: "right" },
  monoText: { fontFamily: "monospace", color: "#a5b4fc" },
  actionBtn: {
    backgroundColor: "#4f46e5",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 8,
  },
  actionBtnSecondary: { backgroundColor: "#1e3a5f" },
  actionBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  statusPicker: {
    backgroundColor: "#0f1117",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#374151",
    marginBottom: 8,
    overflow: "hidden",
  },
  statusOption: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  statusOptionActive: { backgroundColor: "#1e3a5f" },
  statusOptionText: { color: "#9ca3af", fontSize: 12, fontWeight: "600" },
  statusOptionTextActive: { color: "#6366f1" },
});
