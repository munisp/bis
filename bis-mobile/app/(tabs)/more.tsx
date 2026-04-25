/**
 * More tab — BIS Mobile (Expo)
 * Grid launcher for all secondary screens: Investigations, KYC, Screening,
 * goAML, SAR, Documents, Payments, Reports, Biometric.
 */
import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "@/lib/trpc";

interface MenuItem {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  color: string;
  description: string;
}

const MENU_ITEMS: MenuItem[] = [
  {
    label: "Investigations",
    icon: "search-outline",
    route: "/(tabs)/investigations",
    color: "#6366f1",
    description: "Active & closed investigations",
  },
  {
    label: "KYC",
    icon: "shield-checkmark-outline",
    route: "/(tabs)/kyc",
    color: "#0ea5e9",
    description: "Identity verification records",
  },
  {
    label: "Screening",
    icon: "scan-outline",
    route: "/(tabs)/screening",
    color: "#8b5cf6",
    description: "Background check results",
  },
  {
    label: "goAML",
    icon: "document-text-outline",
    route: "/(tabs)/goaml",
    color: "#f59e0b",
    description: "STR report submissions",
  },
  {
    label: "SAR Filings",
    icon: "alert-circle-outline",
    route: "/(tabs)/sar",
    color: "#ef4444",
    description: "Suspicious activity reports",
  },
  {
    label: "Documents",
    icon: "archive-outline",
    route: "/(tabs)/documents",
    color: "#10b981",
    description: "Secure document vault",
  },
  {
    label: "Payments",
    icon: "card-outline",
    route: "/(tabs)/payments",
    color: "#3b82f6",
    description: "Payment rails & transfers",
  },
  {
    label: "Reports",
    icon: "bar-chart-outline",
    route: "/(tabs)/reports",
    color: "#f97316",
    description: "Regulatory report filings",
  },
  {
    label: "Biometric",
    icon: "finger-print-outline",
    route: "/(tabs)/biometric",
    color: "#ec4899",
    description: "Face & fingerprint enrollment",
  },
];

export default function MoreScreen() {
  const router = useRouter();

  const { data: healthData } = trpc.system.allServicesHealth.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const services = (healthData as unknown[]) ?? [];
  const healthyCount = services.filter((s) => (s as Record<string, unknown>).status === "healthy").length;
  const totalCount = services.length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>More</Text>
      <Text style={styles.subtitle}>All BIS Platform features</Text>

      {/* System Health Banner */}
      {totalCount > 0 && (
        <View style={[styles.healthBanner, { borderColor: healthyCount === totalCount ? "#22c55e" : "#f97316" }]}>
          <Ionicons
            name={healthyCount === totalCount ? "checkmark-circle-outline" : "warning-outline"}
            size={16}
            color={healthyCount === totalCount ? "#22c55e" : "#f97316"}
          />
          <Text style={[styles.healthText, { color: healthyCount === totalCount ? "#22c55e" : "#f97316" }]}>
            {healthyCount}/{totalCount} services healthy
          </Text>
        </View>
      )}

      {/* Feature Grid */}
      <View style={styles.grid}>
        {MENU_ITEMS.map((item) => (
          <TouchableOpacity
            key={item.route}
            style={styles.card}
            onPress={() => router.push(item.route as `/${string}`)}
            activeOpacity={0.7}
          >
            <View style={[styles.iconContainer, { backgroundColor: item.color + "22" }]}>
              <Ionicons name={item.icon} size={28} color={item.color} />
            </View>
            <Text style={styles.cardLabel}>{item.label}</Text>
            <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Quick Actions */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.quickActions}>
        <TouchableOpacity
          style={styles.quickBtn}
          onPress={() => router.push("/(tabs)/aml")}
        >
          <Ionicons name="warning-outline" size={18} color="#f97316" />
          <Text style={styles.quickBtnText}>AML Alerts</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickBtn}
          onPress={() => router.push("/(tabs)/cases")}
        >
          <Ionicons name="folder-open-outline" size={18} color="#3b82f6" />
          <Text style={styles.quickBtnText}>Open Cases</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickBtn}
          onPress={() => Alert.alert("System Health", `${healthyCount}/${totalCount} services are healthy`)}
        >
          <Ionicons name="pulse-outline" size={18} color="#22c55e" />
          <Text style={styles.quickBtnText}>Health Check</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.version}>BIS Platform v71 • Nigerian Financial Crime Compliance</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  content: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: "700", color: "#f8fafc", marginBottom: 4 },
  subtitle: { fontSize: 13, color: "#94a3b8", marginBottom: 16 },
  healthBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
    backgroundColor: "#1e293b",
  },
  healthText: { fontSize: 13, fontWeight: "600" },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 24,
  },
  card: {
    width: "47%",
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 14,
    alignItems: "flex-start",
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  cardLabel: { fontSize: 14, fontWeight: "700", color: "#f8fafc", marginBottom: 4 },
  cardDesc: { fontSize: 11, color: "#64748b", lineHeight: 15 },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 },
  quickActions: { flexDirection: "row", gap: 10, marginBottom: 24 },
  quickBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#1e293b",
    borderRadius: 8,
    padding: 10,
    justifyContent: "center",
  },
  quickBtnText: { fontSize: 12, color: "#f8fafc", fontWeight: "600" },
  version: { textAlign: "center", fontSize: 11, color: "#334155", marginTop: 8 },
});
