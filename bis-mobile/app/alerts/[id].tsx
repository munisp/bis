import { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Modal, TextInput, FlatList, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { trpc } from "@/lib/trpc";

const COLORS = {
  bg: "#0a0a0f", card: "#0f0f1a", border: "#1e1e2e",
  primary: "#818cf8", text: "#e2e8f0", muted: "#6b7280",
  critical: "#ef4444", high: "#f97316", medium: "#eab308", low: "#22c55e",
  success: "#22c55e", amber: "#f59e0b",
};

const SEV_COLOR: Record<string, string> = {
  critical: COLORS.critical, high: COLORS.high, medium: COLORS.medium, low: COLORS.low,
};

export default function AlertDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const alertId = Number(id);

  // Escalation sheet state
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedAgentName, setSelectedAgentName] = useState<string>("");
  const [instructions, setInstructions] = useState("");

  const { data: alert, isLoading } = trpc.alerts.getById.useQuery(
    { id: alertId },
    { enabled: !isNaN(alertId) }
  );

  const { data: agentsData } = trpc.fieldAgents.list.useQuery(
    { status: "active", limit: 50 },
    { enabled: escalateOpen }
  );
  const agents: any[] = Array.isArray(agentsData) ? agentsData : (agentsData as any)?.agents ?? [];

  const acknowledgeMutation = trpc.alerts.acknowledge.useMutation({
    onSuccess: () => utils.alerts.getById.invalidate({ id: alertId }),
  });

  const resolveMutation = trpc.alerts.resolve.useMutation({
    onSuccess: () => {
      utils.alerts.getById.invalidate({ id: alertId });
      utils.alerts.list.invalidate();
    },
  });

  const escalateMutation = trpc.alerts.escalate.useMutation({
    onSuccess: () => {
      setEscalateOpen(false);
      setSelectedAgentId(null);
      setSelectedAgentName("");
      setInstructions("");
      utils.alerts.getById.invalidate({ id: alertId });
    },
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  if (!alert) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={40} color={COLORS.muted} />
        <Text style={styles.emptyText}>Alert not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const sc = SEV_COLOR[(alert as any).severity] ?? COLORS.muted;
  const isResolved = (alert as any).resolved;
  const isAcknowledged = (alert as any).acknowledged;

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Severity banner */}
        <View style={[styles.severityBanner, { backgroundColor: sc + "20", borderColor: sc + "50" }]}>
          <View style={[styles.sevDot, { backgroundColor: sc }]} />
          <Text style={[styles.sevLabel, { color: sc }]}>
            {(alert as any).severity?.toUpperCase()} ALERT
          </Text>
          {isResolved && (
            <View style={styles.resolvedBadge}>
              <Ionicons name="checkmark-circle" size={12} color={COLORS.success} />
              <Text style={styles.resolvedText}>Resolved</Text>
            </View>
          )}
        </View>

        {/* Title */}
        <Text style={styles.title}>{(alert as any).title}</Text>

        {/* Body */}
        {(alert as any).body && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Details</Text>
            <Text style={styles.bodyText}>{(alert as any).body}</Text>
          </View>
        )}

        {/* Metadata */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Metadata</Text>
          <View style={styles.metaCard}>
            <MetaRow label="Alert ID" value={`#${(alert as any).id}`} />
            <MetaRow label="Category" value={(alert as any).category ?? "—"} />
            <MetaRow label="Subject Ref" value={(alert as any).subjectRef ?? "—"} />
            <MetaRow label="Created" value={new Date((alert as any).createdAt).toLocaleString()} />
            <MetaRow label="Acknowledged" value={isAcknowledged ? "Yes" : "No"} valueColor={isAcknowledged ? COLORS.success : COLORS.muted} />
          </View>
        </View>

        {/* Linked investigation */}
        {(alert as any).subjectRef && (
          <TouchableOpacity
            style={styles.linkCard}
            onPress={() => router.push(`/investigation/${(alert as any).subjectRef}` as any)}
          >
            <Ionicons name="search" size={16} color={COLORS.primary} />
            <Text style={styles.linkText}>View Investigation {(alert as any).subjectRef}</Text>
            <Ionicons name="chevron-forward" size={14} color={COLORS.muted} />
          </TouchableOpacity>
        )}

        {/* Actions */}
        {!isResolved && (
          <View style={styles.actions}>
            {!isAcknowledged && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.ackBtn]}
                onPress={() => acknowledgeMutation.mutate({ id: alertId })}
                disabled={acknowledgeMutation.isPending}
              >
                {acknowledgeMutation.isPending
                  ? <ActivityIndicator size="small" color={COLORS.primary} />
                  : <Ionicons name="checkmark-outline" size={16} color={COLORS.primary} />
                }
                <Text style={[styles.actionBtnText, { color: COLORS.primary }]}>Acknowledge</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.actionBtn, styles.escalateBtn]}
              onPress={() => setEscalateOpen(true)}
            >
              <Ionicons name="person-add-outline" size={16} color={COLORS.amber} />
              <Text style={[styles.actionBtnText, { color: COLORS.amber }]}>Escalate to Agent</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.resolveBtn]}
              onPress={() => resolveMutation.mutate({ id: alertId })}
              disabled={resolveMutation.isPending}
            >
              {resolveMutation.isPending
                ? <ActivityIndicator size="small" color={COLORS.success} />
                : <Ionicons name="shield-checkmark-outline" size={16} color={COLORS.success} />
              }
              <Text style={[styles.actionBtnText, { color: COLORS.success }]}>Mark Resolved</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* ── Escalation bottom sheet ── */}
      <Modal
        visible={escalateOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setEscalateOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <View style={styles.sheet}>
            {/* Handle */}
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Escalate to Field Agent</Text>
              <TouchableOpacity onPress={() => setEscalateOpen(false)}>
                <Ionicons name="close" size={20} color={COLORS.muted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.sheetSubtitle}>
              Select an active agent to dispatch for alert #{alertId}
            </Text>

            {/* Agent list */}
            <FlatList
              data={agents}
              keyExtractor={(a: any) => String(a.id)}
              style={styles.agentList}
              renderItem={({ item }: { item: any }) => {
                const isChosen = selectedAgentId === String(item.id);
                return (
                  <TouchableOpacity
                    style={[styles.agentRow, isChosen && styles.agentRowSelected]}
                    onPress={() => { setSelectedAgentId(String(item.id)); setSelectedAgentName(item.name); }}
                  >
                    <View style={styles.agentAvatar}>
                      <Text style={styles.agentAvatarText}>{item.name?.charAt(0)?.toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.agentName}>{item.name}</Text>
                      <Text style={styles.agentMeta}>{item.agentCode} · {item.state ?? "—"} · {item.tier}</Text>
                    </View>
                    {isChosen && <Ionicons name="checkmark-circle" size={18} color={COLORS.primary} />}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={[styles.agentMeta, { textAlign: "center", marginVertical: 16 }]}>
                  No active agents found
                </Text>
              }
            />

            {/* Instructions */}
            <Text style={styles.inputLabel}>Instructions (optional)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Add context for the agent…"
              placeholderTextColor={COLORS.muted}
              value={instructions}
              onChangeText={setInstructions}
              multiline
              numberOfLines={3}
            />

            {/* Submit */}
            <TouchableOpacity
              style={[styles.submitBtn, (!selectedAgentId || escalateMutation.isPending) && styles.submitBtnDisabled]}
              disabled={!selectedAgentId || escalateMutation.isPending}
              onPress={() => escalateMutation.mutate({
                id: alertId,
                agentId: selectedAgentId!,
                agentName: selectedAgentName,
                instructions: instructions || undefined,
              })}
            >
              {escalateMutation.isPending
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="send-outline" size={16} color="#fff" />
              }
              <Text style={styles.submitBtnText}>
                {selectedAgentId ? `Escalate to ${selectedAgentName}` : "Select an agent"}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function MetaRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={[styles.metaValue, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: COLORS.bg, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyText: { fontSize: 14, color: COLORS.muted },
  backBtn: { marginTop: 8, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border },
  backBtnText: { fontSize: 13, color: COLORS.primary },
  severityBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 16,
  },
  sevDot: { width: 8, height: 8, borderRadius: 4 },
  sevLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 1, flex: 1 },
  resolvedBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  resolvedText: { fontSize: 11, color: COLORS.success, fontWeight: "600" },
  title: { fontSize: 18, fontWeight: "700", color: COLORS.text, marginBottom: 16, lineHeight: 26 },
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 10, fontWeight: "700", color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  bodyText: { fontSize: 14, color: COLORS.text, lineHeight: 22 },
  metaCard: { backgroundColor: COLORS.card, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  metaRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  metaLabel: { fontSize: 12, color: COLORS.muted },
  metaValue: { fontSize: 12, color: COLORS.text, fontWeight: "600", fontFamily: "SpaceMono" },
  linkCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: COLORS.card, borderRadius: 10, borderWidth: 1, borderColor: COLORS.primary + "40",
    padding: 14, marginBottom: 16,
  },
  linkText: { flex: 1, fontSize: 13, color: COLORS.primary, fontWeight: "600" },
  actions: { gap: 10 },
  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 14, borderRadius: 12, borderWidth: 1,
  },
  ackBtn: { borderColor: COLORS.primary + "40", backgroundColor: COLORS.primary + "10" },
  escalateBtn: { borderColor: COLORS.amber + "40", backgroundColor: COLORS.amber + "10" },
  resolveBtn: { borderColor: COLORS.success + "40", backgroundColor: COLORS.success + "10" },
  actionBtnText: { fontSize: 14, fontWeight: "600" },
  // Modal / Sheet
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: COLORS.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: "80%",
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border, alignSelf: "center", marginBottom: 16 },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  sheetTitle: { fontSize: 16, fontWeight: "700", color: COLORS.text },
  sheetSubtitle: { fontSize: 13, color: COLORS.muted, marginBottom: 16 },
  agentList: { maxHeight: 200, marginBottom: 16 },
  agentRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 10, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, marginBottom: 6,
  },
  agentRowSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + "15" },
  agentAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.primary + "20", alignItems: "center", justifyContent: "center",
  },
  agentAvatarText: { fontSize: 14, fontWeight: "700", color: COLORS.primary },
  agentName: { fontSize: 13, fontWeight: "600", color: COLORS.text },
  agentMeta: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  inputLabel: { fontSize: 10, fontWeight: "700", color: COLORS.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 },
  textInput: {
    backgroundColor: COLORS.bg, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border,
    padding: 12, fontSize: 13, color: COLORS.text, marginBottom: 16, minHeight: 72, textAlignVertical: "top",
  },
  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: COLORS.primary, borderRadius: 12, padding: 14,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },
});
