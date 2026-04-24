/**
 * ProfileScreen — user profile, TOTP setup, biometric toggle, and logout.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../../store';
import { logout, setBiometricEnabled } from '../../store';
import { authApi, clearStoredToken } from '../../services/api';
import { colors, typography, spacing } from '../../utils/theme';

export function ProfileScreen() {
  const dispatch = useDispatch();
  const user = useSelector((state: RootState) => state.auth.user);
  const biometricEnabled = useSelector((state: RootState) => state.auth.biometricEnabled);

  const handleLogout = async () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout", style: "destructive", onPress: async () => {
          try { await authApi.logout(); } catch { }
          clearStoredToken();
          dispatch(logout());
        },
      },
    ]);
  };

  const handleToggleBiometric = () => {
    const next = !biometricEnabled;
    dispatch(setBiometricEnabled(next));
    Alert.alert("Biometric Auth", next ? "Biometric authentication enabled" : "Biometric authentication disabled");
  };

  const ROLE_LABELS: Record<string, string> = {
    admin: "Administrator",
    analyst: "Compliance Analyst",
    field_agent: "Field Agent",
    compliance_officer: "Compliance Officer",
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.avatarSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user?.name?.charAt(0)?.toUpperCase() ?? "?"}</Text>
        </View>
        <Text style={styles.name}>{user?.name ?? "Unknown User"}</Text>
        <Text style={styles.email}>{user?.email ?? ""}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>{ROLE_LABELS[user?.role ?? ""] ?? user?.role ?? "User"}</Text>
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Security</Text>
        <TouchableOpacity style={styles.row} onPress={handleToggleBiometric}>
          <View>
            <Text style={styles.rowLabel}>Biometric Authentication</Text>
            <Text style={styles.rowSub}>Use fingerprint or Face ID to login</Text>
          </View>
          <View style={[styles.toggle, biometricEnabled && styles.toggleOn]}>
            <View style={[styles.toggleThumb, biometricEnabled && styles.toggleThumbOn]} />
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.row} onPress={() => Alert.alert("TOTP", "TOTP setup is available in the web portal under Settings.")}>
          <View>
            <Text style={styles.rowLabel}>Two-Factor Authentication</Text>
            <Text style={styles.rowSub}>Set up TOTP via the web portal</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        {user?.agencyCode ? (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Agency Code</Text>
            <Text style={styles.rowValue}>{user.agencyCode}</Text>
          </View>
        ) : null}
        <View style={styles.row}>
          <Text style={styles.rowLabel}>User ID</Text>
          <Text style={styles.rowValue}>{user?.id ?? "—"}</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  avatarSection: { alignItems: "center", paddingVertical: spacing.xl },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  avatarText: { fontSize: 32, fontWeight: "700", color: "#fff" },
  name: { ...typography.h3, color: colors.text, marginBottom: 4 },
  email: { fontSize: 13, color: colors.textSecondary, marginBottom: 8 },
  roleBadge: { backgroundColor: colors.primary + "22", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4 },
  roleText: { color: colors.primary, fontSize: 12, fontWeight: "600" },
  section: { backgroundColor: colors.card, borderRadius: 12, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  sectionTitle: { fontSize: 11, color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, padding: spacing.md, paddingBottom: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  rowLabel: { fontSize: 14, color: colors.text, fontWeight: "500" },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  rowValue: { fontSize: 13, color: colors.textMuted, fontFamily: "Courier" },
  chevron: { fontSize: 20, color: colors.textMuted },
  toggle: { width: 44, height: 24, borderRadius: 12, backgroundColor: colors.border, justifyContent: "center", padding: 2 },
  toggleOn: { backgroundColor: colors.primary },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },
  toggleThumbOn: { alignSelf: "flex-end" },
  logoutBtn: { backgroundColor: "#ef444422", borderRadius: 12, paddingVertical: 16, alignItems: "center", borderWidth: 1, borderColor: "#ef4444" },
  logoutText: { color: "#ef4444", fontWeight: "600", fontSize: 15 },
});
