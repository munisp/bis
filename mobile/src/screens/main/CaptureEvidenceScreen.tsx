import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView, Image } from 'react-native';
import { useRoute, useNavigation, type RouteProp } from '@react-navigation/native';
import { pick, types, isCancel } from 'react-native-document-picker';
import type { InvestigationsStackParamList } from '../../navigation/RootNavigator';
import { secureEvidenceQueue } from '../../offline/SecureEvidenceQueue';
import { colors, typography, spacing } from '../../utils/theme';

type Route = RouteProp<InvestigationsStackParamList, 'CaptureEvidence'>;
type SelectedEvidence = { uri: string; name: string; contentType: 'image/jpeg' | 'image/png' | 'application/pdf' };

function supportedMime(type?: string | null): SelectedEvidence['contentType'] | null {
  if (type === 'image/jpeg' || type === 'image/png' || type === 'application/pdf') {return type;}
  return null;
}

export function CaptureEvidenceScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation();
  const { investigationId } = route.params;
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<SelectedEvidence | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    secureEvidenceQueue.pendingCount().then(setPending).catch(() => setPending(0));
  }, []);

  const handlePickEvidence = async () => {
    try {
      const files = await pick({ type: [types.images, types.pdf], allowMultiSelection: false, copyTo: 'cachesDirectory', mode: 'import' });
      const file = files[0];
      const contentType = supportedMime(file.type);
      const uri = file.fileCopyUri ?? file.uri;
      if (!contentType || !uri) {
        Alert.alert('Unsupported evidence', 'Select a JPEG, PNG, or PDF document.');
        return;
      }
      setSelected({ uri, name: file.name ?? 'evidence', contentType });
    } catch (error) {
      if (!isCancel(error)) {Alert.alert('Selection failed', error instanceof Error ? error.message : 'Could not select evidence');}
    }
  };

  const handleQueueAndSync = async () => {
    if (!selected) { Alert.alert('No file', 'Select a JPEG, PNG, or PDF document first.'); return; }
    if (description.trim().length < 3) { Alert.alert('Description required', 'Enter at least three characters describing the evidence.'); return; }
    setLoading(true);
    try {
      await secureEvidenceQueue.enqueue({ investigationId: Number(investigationId), fileUri: selected.uri, contentType: selected.contentType, description: description.trim() });
      const result = await secureEvidenceQueue.sync();
      setPending(result.pending);
      if (result.pending === 0) {
        Alert.alert('Evidence verified', 'Evidence was encrypted locally, uploaded directly to protected storage, and verified by its server-side custody record.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
      } else {
        Alert.alert('Evidence queued securely', 'The encrypted evidence will synchronize automatically when a verified network connection is available.');
      }
    } catch (error) {
      Alert.alert('Evidence protected', error instanceof Error ? error.message : 'Evidence could not be encrypted and queued. No upload was attempted.');
    } finally { setLoading(false); }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} accessibilityLabel="Secure evidence capture">
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Secure Evidence Capture</Text>
        <Text style={styles.cardSubtitle}>Investigation: {investigationId}. Files are AES-256-GCM encrypted on this device before sync.</Text>
        <TouchableOpacity style={styles.photoArea} onPress={handlePickEvidence} accessibilityRole="button" accessibilityLabel="Select evidence file">
          {selected?.contentType.startsWith('image/') ? <Image source={{ uri: selected.uri }} style={styles.preview} resizeMode="cover" /> : <View style={styles.photoPlaceholder}><Text style={styles.fileName}>{selected?.name ?? 'Select JPEG, PNG, or PDF'}</Text><Text style={styles.photoHint}>Maximum file size: 25 MB</Text></View>}
        </TouchableOpacity>
        <View style={styles.field}>
          <Text style={styles.label}>Chain-of-custody description</Text>
          <TextInput style={[styles.input, styles.multiline]} placeholder="Describe the evidence, source, and collection context" placeholderTextColor={colors.textMuted} value={description} onChangeText={setDescription} multiline numberOfLines={3} maxLength={2000} />
        </View>
        {pending > 0 && <Text style={styles.pendingNotice}>{pending} encrypted evidence item{pending === 1 ? '' : 's'} waiting to synchronize.</Text>}
        <TouchableOpacity style={[styles.submitBtn, (!selected || loading) && styles.submitBtnDisabled]} onPress={handleQueueAndSync} disabled={loading || !selected} accessibilityRole="button" accessibilityLabel="Encrypt and synchronize evidence">
          {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitText}>Encrypt and Synchronize</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, content: { padding: spacing.md },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  cardTitle: { ...typography.h3, color: colors.text, marginBottom: 4 }, cardSubtitle: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 18 },
  photoArea: { borderRadius: 10, overflow: 'hidden', marginBottom: spacing.md, borderWidth: 2, borderColor: colors.border, borderStyle: 'dashed', minHeight: 180 },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, minHeight: 180 },
  fileName: { color: colors.text, fontWeight: '600', textAlign: 'center', marginBottom: 8 }, photoHint: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  preview: { width: '100%', height: 220 }, field: { marginBottom: spacing.md }, label: { fontSize: 12, color: colors.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: colors.backgroundSecondary, borderRadius: 8, padding: 12, color: colors.text, fontSize: 14, borderWidth: 1, borderColor: colors.border }, multiline: { minHeight: 80, textAlignVertical: 'top' },
  pendingNotice: { color: colors.warning ?? '#d97706', marginBottom: spacing.md, fontSize: 13 }, submitBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 }, submitBtnDisabled: { opacity: 0.5 }, submitText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
