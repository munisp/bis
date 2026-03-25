import { useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "@/lib/trpc";
import { sendLocalNotification } from "@/hooks/usePushNotifications";

const COLORS = {
  bg: "#0a0a0f", card: "#0f0f1a", border: "#1e1e2e",
  primary: "#818cf8", text: "#e2e8f0", muted: "#6b7280",
  critical: "#ef4444", high: "#f97316", medium: "#eab308", low: "#22c55e",
};

const SEV_COLOR: Record<string, string> = {
  critical: COLORS.critical, high: COLORS.high, medium: COLORS.medium, low: COLORS.low,
};

export default function AlertsScreen() {
  const utils = trpc.useUtils();
  const { data, isLoading, refetch, isRefetching } = trpc.alerts.list.useQuery(
    { page: 1, limit: 30, resolved: false },
    {
      staleTime: 30_000,
      // Poll every 60 seconds to detect new alerts in the background
      refetchInterval: 60_000,
    }
  );

  const acknowledgeMutation = trpc.alerts.acknowledge.useMutation({
    onSuccess: () => utils.alerts.list.invalidate(),
  });

  const alerts = (data as any)?.alerts ?? [];

  // Track previously seen alert IDs to detect truly new arrivals
  const seenIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!alerts.length) return;

    const newAlerts = alerts.filter(
      (a: any) => !seenIdsRef.current.has(a.id) && !a.acknowledged
    );

    // Fire a local push notification for each new critical or high alert
    newAlerts.forEach((a: any) => {
      seenIdsRef.current.add(a.id);
      if (a.severity === "critical" || a.severity === "high") {
        sendLocalNotification(
          `🚨 ${a.severity.toUpperCase()} Alert`,
          a.title ?? "New BIS alert requires attention",
          { type: "alert", id: a.id },
          a.severity === "critical" ? "bis-alerts" : "bis-investigations"
        ).catch(() => {/* ignore if notifications not permitted */});
      }
    });
  }, [alerts]);

  return (
    <View style={styles.container}>
      {isLoading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={(item: any) => String(item.id)}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={COLORS.primary}
            />
          }
          contentContainerStyle={styles.list}
          renderItem={({ item }: { item: any }) => {
            const sc = SEV_COLOR[item.severity] ?? COLORS.muted;
            return (
              <View style={[styles.card, { borderLeftColor: sc, borderLeftWidth: 3 }]}>
                <View style={styles.cardHeader}>
                  <View style={[styles.sevBadge, { backgroundColor: sc + "20" }]}>
                    <Text style={[styles.sevText, { color: sc }]}>
                      {item.severity?.toUpperCase()}
                    </Text>
                  </View>
                  {!item.acknowledged && (
                    <TouchableOpacity
                      onPress={() => acknowledgeMutation.mutate({ alertId: item.id })}
                      style={styles.ackButton}
                    >
                      <Ionicons name="checkmark-outline" size={14} color={COLORS.primary} />
                      <Text style={styles.ackText}>Ack</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={styles.cardTitle}>{item.title}</Text>
                {item.body && (
                  <Text style={styles.cardBody} numberOfLines={2}>
                    {item.body}
                  </Text>
                )}
                <Text style={styles.cardDate}>
                  {new Date(item.createdAt).toLocaleString()}
                </Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="notifications-off-outline" size={40} color={COLORS.muted} />
              <Text style={styles.emptyText}>No open alerts</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  list: { padding: 12, gap: 8 },
  card: {
    backgroundColor: COLORS.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: COLORS.border,
  },
  cardHeader: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", marginBottom: 8,
  },
  sevBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  sevText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  ackButton: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 8, borderWidth: 1, borderColor: COLORS.border,
  },
  ackText: { fontSize: 11, color: COLORS.primary, fontWeight: "600" },
  cardTitle: { fontSize: 14, fontWeight: "600", color: COLORS.text, marginBottom: 4 },
  cardBody: { fontSize: 12, color: COLORS.muted, lineHeight: 18, marginBottom: 6 },
  cardDate: { fontSize: 11, color: COLORS.muted },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 14, color: COLORS.muted },
});
