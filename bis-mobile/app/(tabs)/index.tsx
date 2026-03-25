import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/useAuth";

const COLORS = {
  bg: "#0a0a0f",
  card: "#0f0f1a",
  border: "#1e1e2e",
  primary: "#818cf8",
  text: "#e2e8f0",
  muted: "#6b7280",
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
};

function StatCard({
  label,
  value,
  icon,
  color,
  onPress,
}: {
  label: string;
  value: string | number;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity style={[styles.statCard, { borderLeftColor: color }]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.statCardHeader}>
        <Ionicons name={icon} size={18} color={color} />
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </TouchableOpacity>
  );
}

function AlertItem({ alert }: { alert: { id: number; title: string; severity: string; createdAt: Date } }) {
  const severityColor =
    alert.severity === "critical" ? COLORS.critical :
    alert.severity === "high" ? COLORS.high :
    alert.severity === "medium" ? COLORS.medium : COLORS.low;

  return (
    <View style={styles.alertItem}>
      <View style={[styles.alertDot, { backgroundColor: severityColor }]} />
      <View style={styles.alertContent}>
        <Text style={styles.alertTitle} numberOfLines={1}>{alert.title}</Text>
        <Text style={styles.alertMeta}>
          {alert.severity.toUpperCase()} · {new Date(alert.createdAt).toLocaleDateString()}
        </Text>
      </View>
    </View>
  );
}

export default function DashboardScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const { data: summary, isLoading, refetch, isRefetching } = trpc.dashboard.summary.useQuery(undefined, {
    staleTime: 30_000,
  });

  const { data: recentAlerts } = trpc.alerts.list.useQuery(
    { page: 1, limit: 5, resolved: false },
    { staleTime: 30_000 }
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor={COLORS.primary}
        />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>
            Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"},
          </Text>
          <Text style={styles.userName}>{user?.name ?? "Analyst"}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: COLORS.primary + "20" }]}>
          <Text style={[styles.badgeText, { color: COLORS.primary }]}>BIS v3</Text>
        </View>
      </View>

      {/* Stats grid */}
      {isLoading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 24 }} />
      ) : (
        <View style={styles.statsGrid}>
          <StatCard
            label="Active Investigations"
            value={summary?.activeInvestigations ?? 0}
            icon="search-outline"
            color={COLORS.primary}
            onPress={() => router.push("/(tabs)/investigations")}
          />
          <StatCard
            label="Open Alerts"
            value={summary?.openAlerts ?? 0}
            icon="notifications-outline"
            color={COLORS.critical}
            onPress={() => router.push("/(tabs)/alerts")}
          />
          <StatCard
            label="KYC Pending"
            value={summary?.pendingKyc ?? 0}
            icon="shield-checkmark-outline"
            color={COLORS.medium}
            onPress={() => router.push("/(tabs)/kyc")}
          />
          <StatCard
            label="Avg Risk Score"
            value={summary?.avgRiskScore ? `${summary.avgRiskScore.toFixed(1)}%` : "—"}
            icon="analytics-outline"
            color={COLORS.high}
          />
        </View>
      )}

      {/* Recent alerts */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Alerts</Text>
          <TouchableOpacity onPress={() => router.push("/(tabs)/alerts")}>
            <Text style={styles.sectionLink}>View all</Text>
          </TouchableOpacity>
        </View>
        {recentAlerts?.alerts?.length === 0 && (
          <Text style={styles.emptyText}>No open alerts</Text>
        )}
        {(recentAlerts?.alerts ?? []).map((alert: any) => (
          <AlertItem key={alert.id} alert={alert} />
        ))}
      </View>

      {/* Quick actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => router.push("/kyc/biometric")}
            activeOpacity={0.7}
          >
            <Ionicons name="finger-print-outline" size={22} color={COLORS.primary} />
            <Text style={styles.actionLabel}>Biometric{"\n"}Enrollment</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => router.push("/kyc/camera")}
            activeOpacity={0.7}
          >
            <Ionicons name="camera-outline" size={22} color={COLORS.primary} />
            <Text style={styles.actionLabel}>Document{"\n"}Capture</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => router.push("/(tabs)/investigations")}
            activeOpacity={0.7}
          >
            <Ionicons name="add-circle-outline" size={22} color={COLORS.primary} />
            <Text style={styles.actionLabel}>New{"\n"}Investigation</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => router.push("/(tabs)/kyc")}
            activeOpacity={0.7}
          >
            <Ionicons name="shield-outline" size={22} color={COLORS.primary} />
            <Text style={styles.actionLabel}>KYC{"\n"}Verification</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, paddingBottom: 32 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    paddingTop: 8,
  },
  greeting: { fontSize: 13, color: COLORS.muted },
  userName: { fontSize: 20, fontWeight: "700", color: COLORS.text, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
  statCard: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderColor: COLORS.border,
  },
  statCardHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  statLabel: { fontSize: 11, color: COLORS.muted, fontWeight: "500" },
  statValue: { fontSize: 28, fontWeight: "800" },
  section: { marginBottom: 20 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: COLORS.text, letterSpacing: 0.3 },
  sectionLink: { fontSize: 12, color: COLORS.primary },
  alertItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  alertDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  alertContent: { flex: 1 },
  alertTitle: { fontSize: 13, fontWeight: "600", color: COLORS.text },
  alertMeta: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  emptyText: { fontSize: 13, color: COLORS.muted, textAlign: "center", paddingVertical: 16 },
  actionsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  actionButton: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionLabel: { fontSize: 12, color: COLORS.text, textAlign: "center", fontWeight: "500" },
});
