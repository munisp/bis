/**
 * CaptureEvidenceScreen — capture and upload photo/document evidence for an investigation.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView, Image } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native-stack';
import type { InvestigationsStackParamList } from '../../navigation/RootNavigator';
import { evidenceApi } from '../../services/api';
import { colors, typography, spacing } from '../../utils/theme';

type Route = RouteProp<InvestigationsStackParamList, 'CaptureEvidence'>;

export function CaptureEvidenceScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation();
  const { investigationId } = route.params;
  const [description, setDescription] = useState('');
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState('image/jpeg');
  const [loading, setLoading] = useState(false);

  // In a real app, this would use react-native-image-picker or expo-image-picker
  const handlePickImage = () => {
    Alert.alert('Camera / Gallery', 'In production, this opens the camera or gallery.\nFor demo, a placeholder URI is used.', [
      { text: 'Use Placeholder', onPress: () => { setFileUri('file:///placeholder/evidence.jpg'); setMimeType('image/jpeg'); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleUpload = async () => {
    if (!fileUri) { Alert.alert('No file', 'Please select a photo or document first'); return; }
    if (!description.trim()) { Alert.alert('Validation', 'Please add a description'); return; }
    setLoading(true);
    try {
      await evidenceApi.upload(investigationId, fileUri, mimeType, description.trim());
      Alert.alert('Uploaded', 'Evidence uploaded successfully', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Upload failed');
    } finally { setLoading(false); }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Capture Evidence</Text>
        <Text style={styles.cardSubtitle}>Investigation: {investigationId}</Text>
        <TouchableOpacity style={styles.photoArea} onPress={handlePickImage}>
          {fileUri ? (
            <Image source={{ uri: fileUri }} style={styles.preview} resizeMode="cover" />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Text style={styles.photoIcon}>📷</Text>
              <Text style={styles.photoHint}>Tap to capture photo or select document</Text>
            </View>
          )}
        </TouchableOpacity>
        <View style={styles.field}>
          <Text style={styles.label}>Description</Text>
          <TextInput style={[styles.input, styles.multiline]} placeholder="Describe the evidence…"
            placeholderTextColor={colors.textMuted} value={description} onChangeText={setDescription} multiline numberOfLines={3} />
        </View>
        <TouchableOpacity style={[styles.submitBtn, !fileUri && styles.submitBtnDisabled]} onPress={handleUpload} disabled={loading || !fileUri}>
          {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitText}>Upload Evidence</Text>}
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
  photoArea: { borderRadius: 10, overflow: 'hidden', marginBottom: spacing.md, borderWidth: 2, borderColor: colors.border, borderStyle: 'dashed', minHeight: 180 },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, minHeight: 180 },
  photoIcon: { fontSize: 40, marginBottom: 8 },
  photoHint: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  preview: { width: '100%', height: 200 },
  field: { marginBottom: spacing.md },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: colors.backgroundSecondary, borderRadius: 8, padding: 12, color: colors.text, fontSize: 14, borderWidth: 1, borderColor: colors.border },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  submitBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
