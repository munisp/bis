import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { pick, types, isCancel } from 'react-native-document-picker';
import RNFS from 'react-native-fs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { InvestigationsStackParamList } from '../../navigation/RootNavigator';
import {
  secureKycDocumentQueue,
  type KycDocumentType,
} from '../../offline/SecureKycDocumentQueue';

export type KYCDocumentType = KycDocumentType;

export interface CapturedDocument {
  uri: string;
  type: KYCDocumentType;
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png';
  fileSizeBytes: number;
  capturedAt: number;
}

export interface UploadState {
  status: 'ready' | 'encrypting' | 'verified' | 'queued' | 'error';
  errorMessage?: string;
}

const DOCUMENT_LABELS: Record<KYCDocumentType, string> = {
  nin_slip: 'NIN Slip',
  passport: 'International Passport',
  drivers_license: "Driver's Licence",
  voters_card: "Voter's Card",
  utility_bill: 'Utility Bill',
  bank_statement: 'Bank Statement',
  cac_certificate: 'CAC Certificate',
  other: 'Other Document',
};

const DOCUMENT_TYPES = Object.keys(DOCUMENT_LABELS) as KYCDocumentType[];

type Route = RouteProp<InvestigationsStackParamList, 'KYCDocumentCapture'>;

const MAX_KYC_DOCUMENT_BYTES = 5 * 1024 * 1024;

function supportedMime(type?: string | null): CapturedDocument['mimeType'] | null {
  if (type === 'image/jpeg' || type === 'image/png') {
    return type;
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {return `${bytes} B`;}
  if (bytes < 1024 * 1024) {return `${(bytes / 1024).toFixed(1)} KB`;}
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function validateDocument(document: CapturedDocument): string | null {
  if (document.mimeType !== 'image/jpeg' && document.mimeType !== 'image/png') {
    return `Unsupported document type ${document.mimeType}. Select a JPEG or PNG image.`;
  }
  if (!Number.isFinite(document.fileSizeBytes) || document.fileSizeBytes <= 0) {
    return 'The selected document is empty or its size could not be verified.';
  }
  if (document.fileSizeBytes > MAX_KYC_DOCUMENT_BYTES) {
    return `Document size is ${formatBytes(document.fileSizeBytes)}. Maximum is 5 MB.`;
  }
  return null;
}

export function generateFileName(kycRecordId: string, type: KYCDocumentType, extension: 'jpg' | 'png'): string {
  return `kyc-${kycRecordId}-${type}-${Date.now()}.${extension}`;
}

function StatusBadge({ state }: { state: UploadState }) {
  const config: Record<UploadState['status'], { label: string; color: string }> = {
    ready: { label: 'Ready', color: '#64748b' },
    encrypting: { label: 'Encrypting locally', color: '#3b82f6' },
    verified: { label: 'Verified', color: '#22c55e' },
    queued: { label: 'Encrypted and queued', color: '#f59e0b' },
    error: { label: 'Retry needed', color: '#ef4444' },
  };
  const current = config[state.status];
  return (
    <View style={[styles.badge, { borderColor: current.color, backgroundColor: `${current.color}22` }]}>
      <Text style={[styles.badgeText, { color: current.color }]}>{current.label}</Text>
    </View>
  );
}

export function KYCDocumentCaptureScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<InvestigationsStackParamList>>();
  const route = useRoute<Route>();
  const { kycRecordId } = route.params;
  const [selectedType, setSelectedType] = useState<KYCDocumentType>('nin_slip');
  const [documents, setDocuments] = useState<CapturedDocument[]>([]);
  const [states, setStates] = useState<Record<string, UploadState>>({});
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState(0);

  const refreshPending = useCallback(async () => {
    setPending(await secureKycDocumentQueue.pendingCount());
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    const startSecureKycSync = async () => {
      unsubscribe = await secureKycDocumentQueue.start();
      await refreshPending();
    };
    startSecureKycSync().catch(() => {
      Alert.alert('Secure synchronization unavailable', 'Encrypted KYC documents will remain protected on this device until synchronization can be initialized.');
    });
    return () => unsubscribe?.();
  }, [refreshPending]);

  const selectDocument = useCallback(async () => {
    try {
      const result = await pick({
        type: [types.images],
        allowMultiSelection: false,
        copyTo: 'documentDirectory',
        mode: 'import',
      });
      const file = result[0];
      const mimeType = supportedMime(file.type);
      const uri = file.fileCopyUri ?? file.uri;
      if (!mimeType || !uri) {
        Alert.alert('Unsupported document', 'Select a JPEG or PNG document image.');
        return;
      }
      const stat = await RNFS.stat(uri);
      const document: CapturedDocument = {
        uri,
        type: selectedType,
        fileName: file.name ?? `${selectedType}-document`,
        mimeType,
        fileSizeBytes: Number(stat.size),
        capturedAt: Date.now(),
      };
      const validationError = validateDocument(document);
      if (validationError) {
        Alert.alert('Invalid KYC document', validationError);
        return;
      }
      setDocuments((previous) => [...previous, document]);
      setStates((previous) => ({ ...previous, [document.uri]: { status: 'ready' } }));
    } catch (error) {
      if (!isCancel(error)) {
        Alert.alert('Document selection failed', error instanceof Error ? error.message : 'Could not select a KYC document.');
      }
    }
  }, [selectedType]);

  const synchronizeDocument = useCallback(async (document: CapturedDocument) => {
    setStates((previous) => ({ ...previous, [document.uri]: { status: 'encrypting' } }));
    try {
      await secureKycDocumentQueue.enqueue({
        kycRecordId: Number(kycRecordId),
        documentType: document.type,
        fileUri: document.uri,
        contentType: document.mimeType,
      });
      const result = await secureKycDocumentQueue.sync();
      setPending(result.pending);
      setStates((previous) => ({
        ...previous,
        [document.uri]: result.pending === 0 ? { status: 'verified' } : { status: 'queued' },
      }));
    } catch (error) {
      setStates((previous) => ({
        ...previous,
        [document.uri]: { status: 'error', errorMessage: error instanceof Error ? error.message : 'KYC document could not be encrypted and queued.' },
      }));
    }
  }, [kycRecordId]);

  const synchronizeAll = useCallback(async () => {
    if (documents.length === 0) {
      Alert.alert('No documents selected', 'Select a JPEG or PNG KYC document first.');
      return;
    }
    setSyncing(true);
    try {
      for (const document of documents) {
        if (states[document.uri]?.status !== 'verified') {
          await synchronizeDocument(document);
        }
      }
      const remaining = await secureKycDocumentQueue.pendingCount();
      setPending(remaining);
      if (remaining === 0) {
        Alert.alert('KYC documents verified', 'Each document was encrypted on the device, uploaded directly to SSE-KMS storage, and verified by the server custody record.', [
          { text: 'Done', onPress: () => navigation.goBack() },
        ]);
      } else {
        Alert.alert('KYC documents encrypted and queued', 'The device will retry synchronization only after a verified network connection is available.');
      }
    } catch (error) {
      Alert.alert('KYC synchronization protected', error instanceof Error ? error.message : 'KYC documents remain encrypted on this device and will not be uploaded until synchronization succeeds.');
    } finally {
      setSyncing(false);
    }
  }, [documents, navigation, states, synchronizeDocument]);

  const removeDocument = useCallback((uri: string) => {
    setDocuments((previous) => previous.filter((document) => document.uri !== uri));
    setStates((previous) => {
      const next = { ...previous };
      delete next[uri];
      return next;
    });
  }, []);

  return (
    <View style={styles.container} accessibilityLabel="Secure KYC document capture">
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Secure KYC Document Capture</Text>
        <Text style={styles.headerSub}>KYC record {kycRecordId}. Documents are encrypted locally before synchronization.</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionLabel}>Document Type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeScroll}>
          {DOCUMENT_TYPES.map((type) => (
            <TouchableOpacity
              key={type}
              style={[styles.typeChip, selectedType === type && styles.typeChipSelected]}
              onPress={() => setSelectedType(type)}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedType === type }}
            >
              <Text style={[styles.typeChipText, selectedType === type && styles.typeChipTextSelected]}>{DOCUMENT_LABELS[type]}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity
          style={styles.selectButton}
          onPress={selectDocument}
          accessibilityRole="button"
          accessibilityLabel="Select a KYC document image"
        >
          <Text style={styles.selectIcon}>📄</Text>
          <Text style={styles.selectText}>Select secure JPEG or PNG document</Text>
          <Text style={styles.selectHint}>Maximum 5 MB. No document bytes transit the application server.</Text>
        </TouchableOpacity>
        {pending > 0 && <Text style={styles.pendingNotice}>{pending} KYC document{pending === 1 ? '' : 's'} encrypted and awaiting synchronization.</Text>}
        {documents.map((document) => {
          const state = states[document.uri] ?? { status: 'ready' as const };
          return (
            <View key={document.uri} style={styles.card}>
              <Image source={{ uri: document.uri }} style={styles.thumbnail} resizeMode="cover" />
              <View style={styles.cardInfo}>
                <Text style={styles.cardTitle}>{DOCUMENT_LABELS[document.type]}</Text>
                <Text style={styles.cardMeta}>{document.fileName}</Text>
                <StatusBadge state={state} />
                {state.errorMessage && <Text style={styles.errorText}>{state.errorMessage}</Text>}
              </View>
              <View style={styles.cardActions}>
                {(state.status === 'error' || state.status === 'queued') && (
                  <TouchableOpacity onPress={async () => { await synchronizeDocument(document); }} style={styles.retryButton} accessibilityRole="button">
                    <Text style={styles.retryText}>Retry</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => removeDocument(document.uri)} style={styles.removeButton} accessibilityRole="button" accessibilityLabel="Remove KYC document">
                  <Text style={styles.removeText}>×</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.syncButton, (syncing || documents.length === 0) && styles.syncButtonDisabled]}
          onPress={synchronizeAll}
          disabled={syncing || documents.length === 0}
          accessibilityRole="button"
          accessibilityLabel="Encrypt and synchronize KYC documents"
        >
          {syncing ? <ActivityIndicator color="#fff" /> : <Text style={styles.syncText}>Encrypt and Synchronize {documents.length} Document{documents.length === 1 ? '' : 's'}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { padding: 16, paddingTop: Platform.OS === 'ios' ? 56 : 16, backgroundColor: '#1e293b' },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#f8fafc' },
  headerSub: { fontSize: 12, color: '#94a3b8', marginTop: 3 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 112 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#94a3b8', marginBottom: 8, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  typeScroll: { marginBottom: 12 },
  typeChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1e293b', marginRight: 8, borderWidth: 1, borderColor: '#334155' },
  typeChipSelected: { backgroundColor: '#1d4ed8', borderColor: '#3b82f6' },
  typeChipText: { fontSize: 13, color: '#94a3b8', fontWeight: '500' },
  typeChipTextSelected: { color: '#fff' },
  selectButton: { alignItems: 'center', justifyContent: 'center', minHeight: 150, padding: 20, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: '#3b82f6', backgroundColor: '#1e3a5f' },
  selectIcon: { fontSize: 30, marginBottom: 8 },
  selectText: { color: '#f8fafc', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  selectHint: { color: '#bfdbfe', fontSize: 12, marginTop: 6, textAlign: 'center' },
  pendingNotice: { color: '#fbbf24', fontSize: 13, marginTop: 16 },
  card: { flexDirection: 'row', backgroundColor: '#1e293b', borderRadius: 12, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#334155' },
  thumbnail: { width: 72, height: 72, borderRadius: 8, backgroundColor: '#0f172a' },
  cardInfo: { flex: 1, marginLeft: 12 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#f8fafc', marginBottom: 2 },
  cardMeta: { fontSize: 11, color: '#94a3b8', marginBottom: 6 },
  cardActions: { justifyContent: 'space-between', alignItems: 'flex-end' },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  errorText: { fontSize: 11, color: '#fca5a5', marginTop: 4 },
  retryButton: { backgroundColor: '#1d4ed8', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  retryText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  removeButton: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#334155', alignItems: 'center', justifyContent: 'center', marginTop: 5 },
  removeText: { color: '#f8fafc', fontSize: 20, lineHeight: 22 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: '#0f172a', borderTopWidth: 1, borderTopColor: '#1e293b' },
  syncButton: { backgroundColor: '#1d4ed8', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  syncButtonDisabled: { opacity: 0.5 },
  syncText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
