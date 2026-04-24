/**
 * FieldAgentScreen — dispatch a field agent to an investigation site.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native-stack';
import type { InvestigationsStackParamList } from '../../navigation/RootNavigator';
import { investigationsApi } from '../../services/api';
import { colors, typography, spacing } from '../../utils/theme';

type Route = RouteProp<InvestigationsStackParamList, 'FieldAgent'>;

export function FieldAgentScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation();
  const { investigationId } = route.params;
  const [agentId, setAgentId] = useState('');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(false);

  const handleDispatch = async () => {
    if (!agentId.trim() || !location.trim()) {
      Alert.alert('Validation', 'Agent ID and location are required');
      return;
    }
    setLoading(true);
    try {
      await investigationsApi.dispatchFieldAgent(investigationId, agentId.trim(), location.trim());
      Alert.alert('Success', 'Field agent dispatched successfully', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Dispatch failed');
    } finally { setLoading(false); }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Dispatch Field Agent</Text>
        <Text style={styles.cardSubtitle}>Investigation ID: {investigationId}</Text>
        <View style={styles.field}>
          <Text style={styles.label}>Agent ID</Text>
          <TextInput style={styles.input} placeholder="e.g. AGT-001" placeholderTextColor={colors.textMuted}
            value={agentId} onChangeText={setAgentId} autoCapitalize="none" />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Location / Address</Text>
          <TextInput style={[styles.input, styles.multiline]} placeholder="Enter site address or coordinates…"
            placeholderTextColor={colors.textMuted} value={location} onChangeText={setLocation} multiline numberOfLines={3} />
        </View>
        <TouchableOpacity style={styles.submitBtn} onPress={handleDispatch} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitText}>Dispatch Agent</Text>}
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
  cardSubtitle: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.md },
  field: { marginBottom: spacing.md },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: colors.backgroundSecondary, borderRadius: 8, padding: 12, color: colors.text, fontSize: 14, borderWidth: 1, borderColor: colors.border },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  submitBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  submitText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
