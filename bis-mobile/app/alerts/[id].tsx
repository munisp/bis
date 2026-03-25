/**
 * Alert Detail Screen — bis-mobile
 * Displays full alert information with severity, body, investigation link,
 * acknowledge and resolve (mark resolved) buttons.
 * Route: /alerts/[id]
 */
import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../lib/trpc";

// ─── Palette ─────────────────────────────────────────────────────────────────
const COLORS = {
  bg: "#0f1117",
  card: "#1a1d27",
  border: "#2a2d3a",
  primary: "#818cf8",
  text: "#e2e8f0",
  muted: "#6b7280",
  success: "#22c55e",
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
};

const SEV_COLOR: Record<string, string> = {
  critical: COLORS.critical,
  high: COLORS.high,
  medium: COLORS.medium,
  low: COLORS.low,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SectionLabel({ text }: { text: string }) {
  return (
    <Text style={styles.sectionLabel}>{text.toUpperCase()}</Text>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, mono && styles.mono]}>{value}</Text>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function AlertDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [resolving, setResolving] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);

  const alertId = parseInt(id ?? "0", 10);

  const { data: alert, isLoading, refetch } = trpc.alerts.getById.useQuery(
    { id: alertId },
    { enabled: alertId > 0, staleTime: 30_000 }
  );

  const acknowledgeMutation = trpc.alerts.acknowledge.useMutation({
    onSuccess: () => {
      utils.alerts.list.invalidate();
      refetch();
      setAcknowledging(false);
    },
    onError: (err) => {
      setAcknowledging(false);
      Alert.alert("Error", err.message ?? "Failed to acknowledge alert");
    },
  });

  const resolveMutation = trpc.alerts.resolve.useMutation({
    onSuccess: () => {
      utils.alerts.list.invalidate();
      setResolving(false);
      Alert.alert("Resolved", "Alert has been marked as resolved.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    },
    onError: (err) => {
      setResolving(false);
      Alert.alert("Error", err.message ?? "Failed to resolve alert");
    },
  });

  const handleAcknowledge = () => {
    if (alert?.acknowledged) return;
    Alert.alert(
      "Acknowledge Alert",
      "Mark this alert as acknowledged?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Acknowledge",
          onPress: () => {
            setAcknowledging(true);
            acknowledgeMutation.mutate({ id: alertId });
          },
        },
      ]
    );
  };

  const handleResolve = () => {
    if (alert?.resolved) return;
    Alert.alert(
      "Resolve Alert",
      "Mark this alert as fully resolved? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Resolve",
          style: "destructive",
          onPress: () => {
            setResolving(true);
            resolveMutation.mutate({ id: alertId });
          },
        },
      ]
    );
  };

  const handleViewInvestigation = () => {
    if (alert?.investigationRef) {
      // Navigate to investigation detail — find by ref
      router.push(`/investigations?ref=${alert.investigationRef}` as any);
    }
  };

  // ─── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={COLORS.primary} size="large" />
        <Text style={[styles.muted, { marginTop: 12 }]}>Loading alert…</Text>
      </View>
    );
  }

  if (!alert) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Ionicons name="alert-circle-outline" size={48} color={COLORS.muted} />
        <Text style={[styles.muted, { marginTop: 12 }]}>Alert not found</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const sevColor = SEV_COLOR[alert.severity ?? "medium"] ?? COLORS.muted;
  const isResolved = alert.resolved;
  const isAcknowledged = alert.acknowledged;

  return (
    <View style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>Alert Detail</Text>
          <Text style={styles.headerSub}>#{alertId}</Text>
        </View>
        {isResolved && (
          <View style={[styles.statusPill, { backgroundColor: COLORS.success + "20", borderColor: COLORS.success + "50" }]}>
            <Ionicons name="checkmark-circle" size={12} color={COLORS.success} />
            <Text style={[styles.statusPillText, { color: COLORS.success }]}>Resolved</Text>
          </View>
        )}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        {/* ── Severity Banner ── */}
        <View style={[styles.severityBanner, { backgroundColor: sevColor + "18", borderColor: sevColor + "40" }]}>
          <View style={styles.severityLeft}>
            <Ionicons
              name={alert.severity === "critical" ? "warning" : alert.severity === "high" ? "alert-circle" : "information-circle"}
              size={28}
              color={sevColor}
            />
            <View>
              <Text style={[styles.severityLabel, { color: sevColor }]}>
                {(alert.severity ?? "UNKNOWN").toUpperCase()}
              </Text>
              <Text style={styles.severityType}>{alert.alertType ?? "System Alert"}</Text>
            </View>
          </View>
          <View style={styles.severityRight}>
            {isAcknowledged && (
              <View style={[styles.miniPill, { backgroundColor: COLORS.primary + "20", borderColor: COLORS.primary + "40" }]}>
                <Text style={[styles.miniPillText, { color: COLORS.primary }]}>ACK</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Title & Body ── */}
        <View style={styles.card}>
          <Text style={styles.alertTitle}>{alert.title ?? "Untitled Alert"}</Text>
          {alert.body ? (
            <Text style={styles.alertBody}>{alert.body}</Text>
          ) : null}
        </View>

        {/* ── Metadata ── */}
        <View style={styles.card}>
          <SectionLabel text="Details" />
          <InfoRow label="Subject Ref" value={alert.subjectRef} mono />
          <InfoRow label="Source" value={alert.source} />
          <InfoRow label="Rule" value={(alert as any).ruleName} />
          <InfoRow label="Created" value={formatDateTime(alert.createdAt)} />
          {isAcknowledged && (
            <InfoRow label="Acknowledged" value={formatDateTime(alert.acknowledgedAt)} />
          )}
          {isResolved && (
            <InfoRow label="Resolved" value={formatDateTime(alert.resolvedAt)} />
          )}
        </View>

        {/* ── Investigation Link ── */}
        {alert.investigationRef && (
          <TouchableOpacity
            style={[styles.card, styles.linkCard]}
            onPress={handleViewInvestigation}
            activeOpacity={0.7}
          >
            <View style={styles.linkCardInner}>
              <Ionicons name="search-outline" size={18} color={COLORS.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.linkCardLabel}>Linked Investigation</Text>
                <Text style={[styles.linkCardRef, { color: COLORS.primary }]}>{alert.investigationRef}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.muted} />
            </View>
          </TouchableOpacity>
        )}

        {/* ── Actions ── */}
        {!isResolved && (
          <View style={styles.actionsSection}>
            <SectionLabel text="Actions" />

            {!isAcknowledged && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.ackBtn, acknowledging && styles.btnDisabled]}
                onPress={handleAcknowledge}
                disabled={acknowledging}
                activeOpacity={0.8}
              >
                {acknowledging ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : (
                  <Ionicons name="checkmark-outline" size={18} color={COLORS.primary} />
                )}
                <Text style={[styles.actionBtnText, { color: COLORS.primary }]}>
                  {acknowledging ? "Acknowledging…" : "Acknowledge"}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.actionBtn, styles.resolveBtn, resolving && styles.btnDisabled]}
              onPress={handleResolve}
              disabled={resolving}
              activeOpacity={0.8}
            >
              {resolving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
              )}
              <Text style={[styles.actionBtnText, { color: "#fff" }]}>
                {resolving ? "Resolving…" : "Mark Resolved"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {isResolved && (
          <View style={[styles.card, styles.resolvedCard]}>
            <Ionicons name="checkmark-circle" size={24} color={COLORS.success} />
            <Text style={[styles.resolvedText]}>This alert has been resolved.</Text>
          </View>
        )}

      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: { justifyContent: "center", alignItems: "center" },
  muted: { color: COLORS.muted, fontSize: 13 },
  mono: { fontFamily: "SpaceMono" },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 16, fontWeight: "700", color: COLORS.text },
  headerSub: { fontSize: 11, color: COLORS.muted, fontFamily: "SpaceMono" },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusPillText: { fontSize: 10, fontWeight: "700" },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 12, paddingBottom: 40 },

  // Severity banner
  severityBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  severityLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  severityLabel: { fontSize: 18, fontWeight: "800", letterSpacing: 1 },
  severityType: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  severityRight: { flexDirection: "row", gap: 6 },
  miniPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  miniPillText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },

  // Card
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 8,
  },
  alertTitle: { fontSize: 16, fontWeight: "700", color: COLORS.text, lineHeight: 22 },
  alertBody: { fontSize: 13, color: COLORS.muted, lineHeight: 20 },

  // Section label
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.muted,
    letterSpacing: 1,
    marginBottom: 4,
  },

  // Info rows
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border + "60",
  },
  infoLabel: { fontSize: 12, color: COLORS.muted, flex: 1 },
  infoValue: { fontSize: 12, color: COLORS.text, flex: 2, textAlign: "right" },

  // Link card
  linkCard: { gap: 0 },
  linkCardInner: { flexDirection: "row", alignItems: "center", gap: 12 },
  linkCardLabel: { fontSize: 11, color: COLORS.muted },
  linkCardRef: { fontSize: 14, fontWeight: "700", fontFamily: "SpaceMono" },

  // Actions
  actionsSection: { gap: 10 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  ackBtn: {
    backgroundColor: COLORS.primary + "15",
    borderColor: COLORS.primary + "40",
  },
  resolveBtn: {
    backgroundColor: COLORS.success,
    borderColor: COLORS.success,
  },
  btnDisabled: { opacity: 0.5 },
  actionBtnText: { fontSize: 15, fontWeight: "700" },

  // Resolved state
  resolvedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderColor: COLORS.success + "40",
    backgroundColor: COLORS.success + "10",
  },
  resolvedText: { fontSize: 14, color: COLORS.success, fontWeight: "600" },

  // Back button (not-found state)
  backButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  backButtonText: { color: COLORS.primary, fontSize: 14, fontWeight: "600" },
});
