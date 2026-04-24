/**
 * QuickCheckResultScreen — display the result of a QuickCheck vetting.
 */
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native-stack";
import type { QuickCheckStackParamList } from "../../navigation/RootNavigator";
import { quickCheckApi } from "../../services/api";
import { colors, typography, spacing } from "../../utils/theme";

type Route = RouteProp<QuickCheckStackParamList, "QuickCheckResult">;

const RISK_COLORS: Record<string, string> = {
  high: "#ef4444", medium: "#eab308", low: "#22c55e", clear: "#22c55e", unknown: "#64748b",
};

export function QuickCheckResultScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation();
  const { requestId } = route.params;
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    quickCheckApi.getResult(requestId)
      .then(r => setResult(r as Record<string, unknown>))
      .catch(() => setResult({ error: true, riskLevel: "unknown", message: "Failed to load result" }))
      .finally(() => setLoading(false));
  }, [requestId]);

  if (loading) return <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>;

  const riskLevel = String(result?.riskLevel ?? result?.risk ?? "unknown");
  const riskColor = RISK_COLORS[riskLevel] ?? "#64748b";
  const checks = (result?.checks as unknown[]) ?? [];
  const watchlistHits = (result?.watchlistHits as unknown[]) ?? [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={[styles.riskCard, { borderColor: riskColor }]}>
        <Text style={styles.riskLabel}>Risk Level</Text>
        <Text style={[styles.riskValue, { color: riskColor }]}>{riskLevel.toUpperCase()}</Text>
        <Text style={styles.riskId}>Request ID: {requestId}</Text>
      </View>
      {checks.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Verification Checks</Text>
          {checks.map((c: unknown, i: number) => {
            const check = c as Record<string, unknown>;
            return (
              <View key={i} style={styles.checkRow}>
                <Text style={styles.checkName}>{String(check.name ?? check.type ?? "Check " + (i + 1))}</Text>
                <View style={[styles.checkBadge, { backgroundColor: check.passed ? "#22c55e22" : "#ef444422" }]}>
                  <Text style={[styles.checkBadgeText, { color: check.passed ? "#22c55e" : "#ef4444" }]}>
                    {check.passed ? "PASS" : "FAIL"}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
      {watchlistHits.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Watchlist Hits ({watchlistHits.length})</Text>
          {watchlistHits.map((h: unknown, i: number) => {
            const hit = h as Record<string, unknown>;
            return (
              <View key={i} style={styles.hitCard}>
                <Text style={styles.hitName}>{String(hit.name ?? hit.subject ?? "Hit " + (i + 1))}</Text>
                <Text style={styles.hitDetail}>{String(hit.list ?? hit.source ?? "")}</Text>
              </View>
            );
          })}
        </View>
      )}
      {result?.summary ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Summary</Text>
          <Text style={styles.bodyText}>{String(result.summary)}</Text>
        </View>
      ) : null}
      <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.backBtnText}>Run Another Check</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  riskCard: { backgroundColor: colors.card, borderRadius: 12, padding: spacing.lg, marginBottom: spacing.md, borderWidth: 2, alignItems: "center" },
  riskLabel: { fontSize: 12, color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  riskValue: { fontSize: 36, fontWeight: "700", marginBottom: 8 },
  riskId: { fontSize: 11, color: colors.textMuted, fontFamily: "Courier" },
  section: { backgroundColor: colors.card, borderRadius: 12, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  sectionTitle: { fontSize: 11, color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.sm },
  checkRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  checkName: { fontSize: 13, color: colors.text },
  checkBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  checkBadgeText: { fontSize: 10, fontWeight: "700" },
  hitCard: { backgroundColor: colors.backgroundSecondary, borderRadius: 8, padding: 10, marginBottom: 8 },
  hitName: { fontSize: 13, color: colors.text, fontWeight: "500" },
  hitDetail: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  bodyText: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  backBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  backBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
});
