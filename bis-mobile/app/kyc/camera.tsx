/**
 * Document Camera Screen — BIS Mobile
 * ─────────────────────────────────────
 * Captures identity document photos (NIN slip, passport, driver's licence)
 * and submits them to the BFF for OCR processing via trpc.biometric.ocrDocument.
 */

import { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  Image,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { trpc } from "@/lib/trpc";

const COLORS = {
  bg: "#0a0a0f",
  card: "#0f0f1a",
  border: "#1e1e2e",
  primary: "#818cf8",
  success: "#22c55e",
  error: "#ef4444",
  text: "#e2e8f0",
  muted: "#6b7280",
};

type DocType = "nin" | "passport" | "drivers_licence";

const DOC_TYPES: { value: DocType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "nin", label: "NIN Slip", icon: "card-outline" },
  { value: "passport", label: "Passport", icon: "book-outline" },
  { value: "drivers_licence", label: "Driver's Licence", icon: "car-outline" },
];

export default function DocumentCameraScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [docType, setDocType] = useState<DocType>("nin");
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [ocrResult, setOcrResult] = useState<Record<string, string> | null>(null);

  const ocrMutation = trpc.biometric.ocrDocument.useMutation({
    onSuccess: (data: any) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOcrResult(data?.fields ?? {});
    },
    onError: (err) => {
      Alert.alert("OCR Failed", err.message);
    },
  });

  if (!permission?.granted) {
    return (
      <View style={styles.centeredContent}>
        <Ionicons name="camera-outline" size={64} color={COLORS.primary} style={{ marginBottom: 24 }} />
        <Text style={styles.title}>Camera Access Required</Text>
        <Text style={styles.desc}>BIS needs camera access to capture identity documents.</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.primaryButtonText}>Grant Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleCapture = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) {
        setCapturedUri(photo.uri);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      Alert.alert("Capture Failed", "Could not capture document. Please try again.");
    } finally {
      setCapturing(false);
    }
  };

  const handlePickFromLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      setCapturedUri(result.assets[0].uri);
    }
  };

  const handleRunOCR = () => {
    if (!capturedUri) return;
    ocrMutation.mutate({
      imageBase64: capturedUri,
      documentType: docType,
    });
  };

  const handleRetake = () => {
    setCapturedUri(null);
    setOcrResult(null);
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Document Capture</Text>
      </View>

      {!capturedUri ? (
        <>
          {/* Document type selector */}
          <View style={styles.docTypeRow}>
            {DOC_TYPES.map(dt => (
              <TouchableOpacity
                key={dt.value}
                style={[styles.docTypeChip, docType === dt.value && styles.docTypeChipActive]}
                onPress={() => setDocType(dt.value)}
              >
                <Ionicons
                  name={dt.icon}
                  size={14}
                  color={docType === dt.value ? "#fff" : COLORS.muted}
                />
                <Text style={[styles.docTypeLabel, docType === dt.value && { color: "#fff" }]}>
                  {dt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Camera */}
          <CameraView ref={cameraRef} style={styles.camera} facing="back">
            <View style={styles.docFrameOverlay}>
              <View style={styles.docFrame} />
              <Text style={styles.frameHint}>Align document within the frame</Text>
            </View>
          </CameraView>

          {/* Controls */}
          <View style={styles.captureRow}>
            <TouchableOpacity style={styles.secondaryButton} onPress={handlePickFromLibrary}>
              <Ionicons name="image-outline" size={20} color={COLORS.primary} />
              <Text style={styles.secondaryButtonText}>Gallery</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.captureButton, capturing && styles.captureButtonDisabled]}
              onPress={handleCapture}
              disabled={capturing}
            >
              {capturing ? <ActivityIndicator color="#fff" /> : <Ionicons name="camera" size={28} color="#fff" />}
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.reviewContent}>
          {/* Preview */}
          <Image source={{ uri: capturedUri }} style={styles.previewImage} resizeMode="contain" />

          {/* OCR result */}
          {ocrResult && (
            <View style={styles.ocrCard}>
              <Text style={styles.ocrTitle}>Extracted Fields</Text>
              {Object.entries(ocrResult).map(([key, value]) => (
                <View key={key} style={styles.ocrRow}>
                  <Text style={styles.ocrKey}>{key.replace(/_/g, " ").toUpperCase()}</Text>
                  <Text style={styles.ocrValue}>{String(value)}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Actions */}
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.secondaryButton} onPress={handleRetake}>
              <Ionicons name="refresh-outline" size={18} color={COLORS.primary} />
              <Text style={styles.secondaryButtonText}>Retake</Text>
            </TouchableOpacity>
            {!ocrResult ? (
              <TouchableOpacity
                style={[styles.primaryButton, ocrMutation.isPending && styles.primaryButtonDisabled]}
                onPress={handleRunOCR}
                disabled={ocrMutation.isPending}
              >
                {ocrMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Run OCR</Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.primaryButton} onPress={() => router.back()}>
                <Text style={styles.primaryButtonText}>Done</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centeredContent: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 12,
  },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 16, fontWeight: "700", color: COLORS.text },
  title: { fontSize: 20, fontWeight: "700", color: COLORS.text, textAlign: "center", marginBottom: 10 },
  desc: { fontSize: 14, color: COLORS.muted, textAlign: "center", marginBottom: 24 },
  docTypeRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.card,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  docTypeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "transparent",
  },
  docTypeChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  docTypeLabel: { fontSize: 12, color: COLORS.muted, fontWeight: "500" },
  camera: { flex: 1 },
  docFrameOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  docFrame: {
    width: "88%",
    height: 220,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: "transparent",
  },
  frameHint: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  captureRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    paddingVertical: 20,
    paddingHorizontal: 24,
    backgroundColor: "#000",
  },
  captureButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  captureButtonDisabled: { opacity: 0.6 },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.card,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  secondaryButtonText: { color: COLORS.primary, fontWeight: "600", fontSize: 14 },
  primaryButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryButtonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  reviewContent: { padding: 16, paddingBottom: 40 },
  previewImage: { width: "100%", height: 240, borderRadius: 12, backgroundColor: COLORS.card, marginBottom: 16 },
  ocrCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 16,
  },
  ocrTitle: { fontSize: 13, fontWeight: "700", color: COLORS.text, marginBottom: 12 },
  ocrRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  ocrKey: { fontSize: 11, color: COLORS.muted, fontWeight: "600" },
  ocrValue: { fontSize: 12, color: COLORS.text, fontWeight: "500", maxWidth: "60%", textAlign: "right" },
  actionRow: { flexDirection: "row", gap: 12, justifyContent: "center" },
});
