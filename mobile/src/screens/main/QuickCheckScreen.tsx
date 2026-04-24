/**
 * QuickCheckScreen — run a quick KYC/AML vetting check on a subject.
 */
import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { QuickCheckStackParamList } from "../../navigation/RootNavigator";
import { quickCheckApi } from "../../services/api";
import { colors, typography, spacing } from "../../utils/theme";

type Nav = NativeStackNavigationProp<QuickCheckStackParamList, "QuickCheckForm">;

const ID_TYPES = ["NIN", "BVN", "Passport", "Drivers License", "CAC"];

export function QuickCheckScreen() {
  const navigation = useNavigation<Nav>();
  const [idType, setIdType] = useState("NIN");
  const [idNumber, setIdNumber] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCheck = async () => {
    setLoading(true);
    try {
      const result = await quickCheckApi.run({ idType, idNumber: idNumber.trim(), fullName: fullName.trim() });
      const requestId = String((result as Record<string, unknown>).requestId ?? (result as Record<string, unknown>).id ?? "demo");
      navigation.navigate("QuickCheckResult", { requestId });
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Check failed");
    } finally { setLoading(false); }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>QuickCheck</Text>
        <Text style={styles.cardSub}>Instant KYC/AML vetting via BIS gateway</Text>
        <View style={styles.field}>
          <Text style={styles.label}>ID Type</Text>
          <View style={styles.typeRow}>
            {ID_TYPES.map(t => (
              <TouchableOpacity key={t} style={[styles.typeChip, idType === t && styles.typeChipActive]} onPress={() => setIdType(t)}>
                <Text style={[styles.typeChipText, idType === t && styles.typeChipTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>ID Number</Text>
          <TextInput style={styles.input} placeholder="Enter ID number" placeholderTextColor={colors.textMuted}
            value={idNumber} onChangeText={setIdNumber} autoCapitalize="characters" />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Full Name (optional)</Text>
          <TextInput style={styles.input} placeholder="For name-matching verification"
            placeholderTextColor={colors.textMuted} value={fullName} onChangeText={setFullName} />
        </View>
          {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitText}>Run QuickCheck</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  cardTitle: { ...typography.h3, color: colors.text, marginBottom: 4 },
  cardSub: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.md },
  field: { marginBottom: spacing.md },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: colors.backgroundSecondary, borderWidth: 1, borderColor: colors.border },
  typeChipActive: { backgroundColor: colors.primary + "22", borderColor: colors.primary },
  typeChipText: { fontSize: 13, color: colors.textMuted },
  typeChipTextActive: { color: colors.primary, fontWeight: "600" },
  input: { backgroundColor: colors.backgroundSecondary, borderRadius: 8, padding: 12, color: colors.text, fontSize: 14, borderWidth: 1, borderColor: colors.border },
  submitBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  submitText: { color: "#fff", fontWeight: "600", fontSize: 15 },
});
