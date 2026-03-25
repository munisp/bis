import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/hooks/useAuth";

const COLORS = {
  bg: "#0a0a0f", card: "#0f0f1a", border: "#1e1e2e",
  primary: "#818cf8", text: "#e2e8f0", muted: "#6b7280",
  error: "#ef4444",
};

function ProfileRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={16} color={COLORS.muted} style={styles.rowIcon} />
      <View style={styles.rowContent}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const { user, logout, isLoggingOut } = useAuth();

  const handleLogout = () => {
    Alert.alert(
      "Sign Out",
      "Are you sure you want to sign out of BIS Mobile?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Sign Out", style: "destructive", onPress: logout },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Avatar */}
      <View style={styles.avatarSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.name?.charAt(0)?.toUpperCase() ?? "?"}
          </Text>
        </View>
        <Text style={styles.userName}>{user?.name ?? "Unknown"}</Text>
        <View style={[styles.roleBadge, { backgroundColor: COLORS.primary + "20" }]}>
          <Text style={[styles.roleText, { color: COLORS.primary }]}>
            {user?.role?.toUpperCase() ?? "ANALYST"}
          </Text>
        </View>
      </View>

      {/* Profile details */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Account Details</Text>
        <ProfileRow icon="person-outline" label="Name" value={user?.name ?? "—"} />
        <ProfileRow icon="mail-outline" label="Email" value={(user as any)?.email ?? "—"} />
        <ProfileRow icon="shield-outline" label="Role" value={user?.role ?? "analyst"} />
        <ProfileRow icon="time-outline" label="Member since" value={
          (user as any)?.createdAt ? new Date((user as any).createdAt).toLocaleDateString() : "—"
        } />
      </View>

      {/* App info */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>App Info</Text>
        <ProfileRow icon="phone-portrait-outline" label="Version" value="1.0.0 (Expo)" />
        <ProfileRow icon="server-outline" label="BFF" value="localhost:3001" />
        <ProfileRow icon="globe-outline" label="Platform" value="React Native / Expo" />
      </View>

      {/* Sign out */}
      <TouchableOpacity
        style={[styles.signOutButton, isLoggingOut && styles.signOutButtonDisabled]}
        onPress={handleLogout}
        disabled={isLoggingOut}
      >
        <Ionicons name="log-out-outline" size={18} color={COLORS.error} />
        <Text style={styles.signOutText}>{isLoggingOut ? "Signing out…" : "Sign Out"}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 20, paddingBottom: 40 },
  avatarSection: { alignItems: "center", paddingVertical: 24 },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: COLORS.primary + "30",
    alignItems: "center", justifyContent: "center", marginBottom: 12,
    borderWidth: 2, borderColor: COLORS.primary + "60",
  },
  avatarText: { fontSize: 28, fontWeight: "700", color: COLORS.primary },
  userName: { fontSize: 20, fontWeight: "700", color: COLORS.text, marginBottom: 6 },
  roleBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  roleText: { fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  card: {
    backgroundColor: COLORS.card, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 12,
  },
  cardTitle: { fontSize: 12, fontWeight: "700", color: COLORS.muted, letterSpacing: 0.5, marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  rowIcon: { marginRight: 12 },
  rowContent: { flex: 1, flexDirection: "row", justifyContent: "space-between" },
  rowLabel: { fontSize: 13, color: COLORS.muted },
  rowValue: { fontSize: 13, color: COLORS.text, fontWeight: "500" },
  signOutButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: COLORS.error + "15", borderRadius: 12, paddingVertical: 14,
    borderWidth: 1, borderColor: COLORS.error + "30",
  },
  signOutButtonDisabled: { opacity: 0.6 },
  signOutText: { fontSize: 15, fontWeight: "600", color: COLORS.error },
});
