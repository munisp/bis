import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
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
    if (idNumber.trim().length < 4) {
      Alert.alert("Identifier required", "Enter a valid identifier before running QuickCheck.");
      return;
    }
    setLoading(true);
    try {
      const result = await quickCheckApi.run({ idType, idNumber: idNumber.trim(), fullName: fullName.trim() || undefined });
      const requestId = String((result as Record<string, unknown>).requestId ?? (result as Record<string, unknown>).id ?? "");
      if (!requestId) throw new Error("The verification service did not return a request reference.");
      navigation.navigate("QuickCheckResult", { requestId });
    } catch (error) {
      Alert.alert("QuickCheck unavailable", error instanceof Error ? error.message : "The verification request could not be completed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.cardTitle}>QuickCheck</Text>
        <Text style={styles.cardSub}>Nigeria-first identity and compliance pre-check through the BIS gateway.</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Identifier type</Text>
          <View style={styles.typeRow}>
            {ID_TYPES.map(type => (
              <TouchableOpacity key={type} accessibilityRole="button" style={[styles.typeChip, idType === type && styles.typeChipActive]} onPress={() => setIdType(type)}>
                <Text style={[styles.typeChipText, idType === type && styles.typeChipTextActive]}>{type}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Identifier</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter identifier"
            placeholderTextColor={colors.textMuted}
            value={idNumber}
            onChangeText={setIdNumber}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Full name (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="For name-matching verification"
            placeholderTextColor={colors.textMuted}
            value={fullName}
            onChangeText={setFullName}
            autoCorrect={false}
          />
        </View>

        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Run QuickCheck" style={[styles.submitBtn, loading && styles.submitBtnDisabled]} onPress={handleCheck} disabled={loading}>
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
  cardSub: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 18 },
  field: { marginBottom: spacing.md },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: colors.backgroundSecondary, borderWidth: 1, borderColor: colors.border },
  typeChipActive: { backgroundColor: colors.primary + "22", borderColor: colors.primary },
  typeChipText: { fontSize: 13, color: colors.textMuted },
  typeChipTextActive: { color: colors.primary, fontWeight: "600" },
  input: { backgroundColor: colors.backgroundSecondary, borderRadius: 8, padding: 12, color: colors.text, fontSize: 14, borderWidth: 1, borderColor: colors.border },
  submitBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  submitBtnDisabled: { opacity: 0.65 },
  submitText: { color: "#fff", fontWeight: "600", fontSize: 15 },
});
