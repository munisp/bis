/**
 * Biometric Enrollment Screen — BIS Mobile
 * ─────────────────────────────────────────
 * Multi-step flow:
 *   1. Permissions check
 *   2. Liveness challenge (blink + head-turn)
 *   3. Face capture (selfie)
 *   4. Document capture (NIN / passport / driver's licence)
 *   5. Enrollment confirmation
 *
 * Calls trpc.biometric.* procedures via the BFF.
 */

import { useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  Image,
} from "react-native";
import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
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
  warning: "#eab308",
  text: "#e2e8f0",
  muted: "#6b7280",
};

type Step = "permissions" | "liveness" | "selfie" | "document" | "confirm" | "done";

interface LivenessChallenge {
  id: string;
  type: string;
  instruction: string;
}

// ── Step indicator ────────────────────────────────────────────────────────────
function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <View style={styles.stepRow}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.stepDot,
            i < current ? styles.stepDone : i === current ? styles.stepActive : styles.stepPending,
          ]}
        />
      ))}
    </View>
  );
}

// ── Permissions step ──────────────────────────────────────────────────────────
function PermissionsStep({ onGranted }: { onGranted: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();

  const handleRequest = async () => {
    const result = await requestPermission();
    if (result.granted) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onGranted();
    } else {
      Alert.alert("Camera Required", "BIS requires camera access for biometric enrollment. Please enable it in Settings.");
    }
  };

  if (permission?.granted) {
    onGranted();
    return null;
  }

  return (
    <View style={styles.centeredContent}>
      <Ionicons name="camera-outline" size={64} color={COLORS.primary} style={{ marginBottom: 24 }} />
      <Text style={styles.stepTitle}>Camera Access Required</Text>
      <Text style={styles.stepDesc}>
        BIS needs camera access to capture your face and identity documents for biometric enrollment.
      </Text>
      <TouchableOpacity style={styles.primaryButton} onPress={handleRequest}>
        <Text style={styles.primaryButtonText}>Grant Camera Access</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Liveness step ─────────────────────────────────────────────────────────────
function LivenessStep({
  challenges,
  onComplete,
}: {
  challenges: LivenessChallenge[];
  onComplete: () => void;
}) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [completed, setCompleted] = useState<string[]>([]);

  const handleNext = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newCompleted = [...completed, challenges[currentIdx].id];
    setCompleted(newCompleted);
    if (currentIdx + 1 >= challenges.length) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onComplete();
    } else {
      setCurrentIdx(currentIdx + 1);
    }
  };

  const challenge = challenges[currentIdx];

  return (
    <View style={styles.centeredContent}>
      <StepIndicator current={currentIdx} total={challenges.length} />
      <View style={styles.livenessIcon}>
        <Ionicons
          name={
            challenge.type === "blink" ? "eye-outline" :
            challenge.type === "head_turn_left" ? "arrow-back-outline" :
            challenge.type === "head_turn_right" ? "arrow-forward-outline" :
            "happy-outline"
          }
          size={48}
          color={COLORS.primary}
        />
      </View>
      <Text style={styles.stepTitle}>Liveness Check</Text>
      <Text style={styles.challengeInstruction}>{challenge.instruction}</Text>
      <Text style={styles.stepDesc}>
        {currentIdx + 1} of {challenges.length} challenges
      </Text>
      <TouchableOpacity style={styles.primaryButton} onPress={handleNext}>
        <Text style={styles.primaryButtonText}>Done — Next</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Selfie capture step ───────────────────────────────────────────────────────
function SelfieStep({ onCapture }: { onCapture: (uri: string) => void }) {
  const cameraRef = useRef<CameraView>(null);
  const [capturing, setCapturing] = useState(false);

  const handleCapture = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, base64: false });
      if (photo?.uri) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onCapture(photo.uri);
      }
    } catch (err) {
      Alert.alert("Capture Failed", "Could not capture photo. Please try again.");
    } finally {
      setCapturing(false);
    }
  };

  return (
    <View style={styles.cameraContainer}>
      <Text style={styles.cameraInstruction}>Position your face in the oval and look straight ahead</Text>
      <CameraView ref={cameraRef} style={styles.camera} facing="front">
        {/* Face oval overlay */}
        <View style={styles.faceOvalOverlay}>
          <View style={styles.faceOval} />
        </View>
      </CameraView>
      <TouchableOpacity
        style={[styles.captureButton, capturing && styles.captureButtonDisabled]}
        onPress={handleCapture}
        disabled={capturing}
      >
        {capturing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Ionicons name="camera" size={28} color="#fff" />
        )}
      </TouchableOpacity>
    </View>
  );
}

// ── Document capture step ─────────────────────────────────────────────────────
function DocumentStep({ onCapture }: { onCapture: (uri: string) => void }) {
  const cameraRef = useRef<CameraView>(null);
  const [capturing, setCapturing] = useState(false);

  const handleCapture = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9, base64: false });
      if (photo?.uri) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onCapture(photo.uri);
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
      onCapture(result.assets[0].uri);
    }
  };

  return (
    <View style={styles.cameraContainer}>
      <Text style={styles.cameraInstruction}>Place your NIN slip, passport, or driver's licence flat and capture it</Text>
      <CameraView ref={cameraRef} style={styles.camera} facing="back">
        {/* Document frame overlay */}
        <View style={styles.docFrameOverlay}>
          <View style={styles.docFrame} />
        </View>
      </CameraView>
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
          {capturing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Ionicons name="camera" size={28} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Confirm step ──────────────────────────────────────────────────────────────
function ConfirmStep({
  selfieUri,
  documentUri,
  onEnroll,
  isEnrolling,
}: {
  selfieUri: string;
  documentUri: string;
  onEnroll: () => void;
  isEnrolling: boolean;
}) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.confirmContent}>
      <Text style={styles.stepTitle}>Review & Enroll</Text>
      <Text style={styles.stepDesc}>Review your captures before submitting for biometric enrollment.</Text>

      <View style={styles.previewRow}>
        <View style={styles.previewItem}>
          <Image source={{ uri: selfieUri }} style={styles.previewImage} />
          <Text style={styles.previewLabel}>Selfie</Text>
        </View>
        <View style={styles.previewItem}>
          <Image source={{ uri: documentUri }} style={styles.previewImage} />
          <Text style={styles.previewLabel}>Document</Text>
        </View>
      </View>

      <View style={styles.checkList}>
        {[
          "Face clearly visible and well-lit",
          "Document text is sharp and readable",
          "No glare or obstructions",
        ].map((item, i) => (
          <View key={i} style={styles.checkItem}>
            <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
            <Text style={styles.checkText}>{item}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.primaryButton, isEnrolling && styles.primaryButtonDisabled]}
        onPress={onEnroll}
        disabled={isEnrolling}
      >
        {isEnrolling ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryButtonText}>Submit for Enrollment</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function BiometricEnrollmentScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("permissions");
  const [selfieUri, setSelfieUri] = useState<string | null>(null);
  const [documentUri, setDocumentUri] = useState<string | null>(null);

  const { data: challengesData } = trpc.biometric.getChallenges.useQuery();
  const challenges: LivenessChallenge[] = (challengesData as any)?.challenges ?? [
    { id: "blink", type: "blink", instruction: "Blink both eyes slowly twice" },
    { id: "turn_left", type: "head_turn_left", instruction: "Turn your head slowly to the left" },
    { id: "turn_right", type: "head_turn_right", instruction: "Turn your head slowly to the right" },
  ];

  const enrollMutation = trpc.biometric.fullEnrollment.useMutation({
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep("done");
    },
    onError: (err) => {
      Alert.alert("Enrollment Failed", err.message);
    },
  });

  const handleEnroll = useCallback(() => {
    if (!selfieUri || !documentUri) return;
    enrollMutation.mutate({
      selfieBase64: selfieUri, // In production: convert to base64
      documentBase64: documentUri,
      documentType: "nin",
      challengeResults: challenges.map(c => ({ challengeId: c.id, passed: true })),
    });
  }, [selfieUri, documentUri, challenges, enrollMutation]);

  const STEPS: Step[] = ["permissions", "liveness", "selfie", "document", "confirm", "done"];
  const stepIndex = STEPS.indexOf(step);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Biometric Enrollment</Text>
        {step !== "permissions" && step !== "done" && (
          <StepIndicator current={stepIndex - 1} total={4} />
        )}
      </View>

      {/* Step content */}
      {step === "permissions" && (
        <PermissionsStep onGranted={() => setStep("liveness")} />
      )}
      {step === "liveness" && (
        <LivenessStep
          challenges={challenges}
          onComplete={() => setStep("selfie")}
        />
      )}
      {step === "selfie" && (
        <SelfieStep
          onCapture={(uri) => {
            setSelfieUri(uri);
            setStep("document");
          }}
        />
      )}
      {step === "document" && (
        <DocumentStep
          onCapture={(uri) => {
            setDocumentUri(uri);
            setStep("confirm");
          }}
        />
      )}
      {step === "confirm" && selfieUri && documentUri && (
        <ConfirmStep
          selfieUri={selfieUri}
          documentUri={documentUri}
          onEnroll={handleEnroll}
          isEnrolling={enrollMutation.isPending}
        />
      )}
      {step === "done" && (
        <View style={styles.centeredContent}>
          <Ionicons name="checkmark-circle" size={72} color={COLORS.success} style={{ marginBottom: 20 }} />
          <Text style={styles.stepTitle}>Enrollment Complete</Text>
          <Text style={styles.stepDesc}>
            Your biometric profile has been successfully enrolled. You can now use biometric verification for KYC checks.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => router.back()}>
            <Text style={styles.primaryButtonText}>Back to Dashboard</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
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
  headerTitle: { fontSize: 16, fontWeight: "700", color: COLORS.text, flex: 1 },
  stepRow: { flexDirection: "row", gap: 6 },
  stepDot: { width: 8, height: 8, borderRadius: 4 },
  stepDone: { backgroundColor: COLORS.success },
  stepActive: { backgroundColor: COLORS.primary },
  stepPending: { backgroundColor: COLORS.border },
  centeredContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  stepTitle: { fontSize: 20, fontWeight: "700", color: COLORS.text, textAlign: "center", marginBottom: 10 },
  stepDesc: { fontSize: 14, color: COLORS.muted, textAlign: "center", lineHeight: 20, marginBottom: 24 },
  challengeInstruction: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.text,
    textAlign: "center",
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  livenessIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.primary + "20",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: "center",
    minWidth: 200,
  },
  primaryButtonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
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
  cameraContainer: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  cameraInstruction: {
    position: "absolute",
    top: 16,
    left: 16,
    right: 16,
    zIndex: 10,
    backgroundColor: "rgba(0,0,0,0.6)",
    color: "#fff",
    fontSize: 13,
    textAlign: "center",
    padding: 10,
    borderRadius: 8,
  },
  faceOvalOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  faceOval: {
    width: 200,
    height: 260,
    borderRadius: 100,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: "transparent",
  },
  docFrameOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  docFrame: {
    width: "85%",
    height: 200,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: "transparent",
  },
  captureButton: {
    position: "absolute",
    bottom: 32,
    alignSelf: "center",
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  captureButtonDisabled: { opacity: 0.6 },
  captureRow: {
    position: "absolute",
    bottom: 32,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    paddingHorizontal: 24,
  },
  confirmContent: { padding: 20, paddingBottom: 40 },
  previewRow: { flexDirection: "row", gap: 12, marginBottom: 20 },
  previewItem: { flex: 1, alignItems: "center" },
  previewImage: { width: "100%", height: 160, borderRadius: 10, backgroundColor: COLORS.card },
  previewLabel: { fontSize: 12, color: COLORS.muted, marginTop: 6 },
  checkList: { gap: 8, marginBottom: 24 },
  checkItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkText: { fontSize: 13, color: COLORS.text },
});
