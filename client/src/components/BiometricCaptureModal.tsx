/**
 * BiometricCaptureModal
 *
 * A full-screen modal that guides the user through a 3-stage biometric
 * verification pipeline:
 *
 *   Stage 1 — Passive Liveness  : single still frame → checkLiveness
 *   Stage 2 — Active Liveness   : 5–10 frame video clip → checkActiveLiveness
 *   Stage 3 — Anti-Spoofing     : still frame → checkAntispoofing (6 attack types)
 *
 * On success, calls onSuccess({ imageBase64, livenessScore, activeLivenessScore,
 *   antiSpoofScore, spoofType, sessionId }) so the parent can proceed with
 *   face enrollment or KYC submission.
 *
 * Usage:
 *   <BiometricCaptureModal
 *     open={showCapture}
 *     onClose={() => setShowCapture(false)}
 *     onSuccess={(result) => handleBiometricResult(result)}
 *     subjectRef="NIN-12345678901"
 *     challenge="blink"
 *   />
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Camera,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Eye,
  Activity,
  ShieldCheck,
  ChevronRight,
  RefreshCw,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BiometricChallengeType = "blink" | "turn_left" | "turn_right" | "smile" | "nod";

export interface BiometricCaptureResult {
  /** Base64-encoded JPEG of the best still frame (no data URI prefix) */
  imageBase64: string;
  /** Passive liveness confidence [0, 1] */
  livenessScore: number;
  /** Active liveness confidence [0, 1] */
  activeLivenessScore: number;
  /** Anti-spoofing genuine confidence [0, 1] */
  antiSpoofScore: number;
  /** Spoof type classification */
  spoofType: string;
  /** Session ID from the last biometric procedure call */
  sessionId?: string;
  /** True when running in sandbox mode (engine unavailable) */
  sandbox: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (result: BiometricCaptureResult) => void;
  subjectRef?: string;
  challenge?: BiometricChallengeType;
  /** Number of frames to capture for active liveness (default: 7) */
  frameCount?: number;
}

// ─── Stage definitions ────────────────────────────────────────────────────────

type Stage =
  | "idle"
  | "passive_capture"
  | "passive_checking"
  | "passive_done"
  | "active_capture"
  | "active_checking"
  | "active_done"
  | "spoof_checking"
  | "spoof_done"
  | "success"
  | "failed";

interface StageInfo {
  label: string;
  icon: React.ReactNode;
  description: string;
}

const STAGE_INFO: Record<string, StageInfo> = {
  passive_capture: {
    label: "Passive Liveness",
    icon: <Eye className="w-5 h-5" />,
    description: "Hold still and look directly at the camera.",
  },
  passive_checking: {
    label: "Analysing…",
    icon: <Loader2 className="w-5 h-5 animate-spin" />,
    description: "Checking passive liveness…",
  },
  active_capture: {
    label: "Active Liveness",
    icon: <Activity className="w-5 h-5" />,
    description: "Follow the on-screen instruction.",
  },
  active_checking: {
    label: "Analysing…",
    icon: <Loader2 className="w-5 h-5 animate-spin" />,
    description: "Checking active liveness…",
  },
  spoof_checking: {
    label: "Anti-Spoofing",
    icon: <ShieldCheck className="w-5 h-5" />,
    description: "Verifying image authenticity…",
  },
  success: {
    label: "Verified",
    icon: <CheckCircle2 className="w-5 h-5 text-green-500" />,
    description: "All biometric checks passed.",
  },
  failed: {
    label: "Failed",
    icon: <XCircle className="w-5 h-5 text-red-500" />,
    description: "Verification failed. Please try again.",
  },
};

const CHALLENGE_LABELS: Record<BiometricChallengeType, string> = {
  blink: "Blink twice",
  turn_left: "Turn your head left",
  turn_right: "Turn your head right",
  smile: "Smile naturally",
  nod: "Nod your head",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function BiometricCaptureModal({
  open,
  onClose,
  onSuccess,
  subjectRef = "unknown",
  challenge = "blink",
  frameCount = 7,
}: Props) {
  // ── Refs ──────────────────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── State ─────────────────────────────────────────────────────────────────
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [capturedFrame, setCapturedFrame] = useState<string | null>(null);
  const [capturedFrames, setCapturedFrames] = useState<string[]>([]);
  const [frameProgress, setFrameProgress] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [isCountingDown, setIsCountingDown] = useState(false);

  // ── Scores ────────────────────────────────────────────────────────────────
  const [livenessScore, setLivenessScore] = useState(0);
  const [activeLivenessScore, setActiveLivenessScore] = useState(0);
  const [antiSpoofScore, setAntiSpoofScore] = useState(0);
  const [spoofType, setSpoofType] = useState("genuine");
  const [lastSessionId, setLastSessionId] = useState<string | undefined>();
  const [isSandbox, setIsSandbox] = useState(false);

  // ── tRPC mutations ────────────────────────────────────────────────────────
  const checkLiveness = trpc.biometric.checkLiveness.useMutation();
  const checkActiveLiveness = trpc.biometric.checkActiveLiveness.useMutation();
  const checkAntispoofing = trpc.biometric.checkAntispoofing.useMutation();

  // ── Camera helpers ────────────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Camera access denied. Please allow camera access in your browser settings."
          : "Could not access camera. Please check your device.";
      setError(msg);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  const captureStillFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // Return base64 without data URI prefix
    return canvas.toDataURL("image/jpeg", 0.85).replace(/^data:image\/jpeg;base64,/, "");
  }, []);

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (open) {
      setStage("idle");
      setError(null);
      setCapturedFrame(null);
      setCapturedFrames([]);
      setFrameProgress(0);
      setLivenessScore(0);
      setActiveLivenessScore(0);
      setAntiSpoofScore(0);
      setSpoofType("genuine");
      setLastSessionId(undefined);
      setIsSandbox(false);
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [open, startCamera, stopCamera]);

  // ── Stage: Passive Liveness ───────────────────────────────────────────────

  const startPassiveLiveness = useCallback(() => {
    setStage("passive_capture");
    setIsCountingDown(true);
    setCountdown(3);
    let c = 3;
    const timer = setInterval(() => {
      c -= 1;
      setCountdown(c);
      if (c <= 0) {
        clearInterval(timer);
        setIsCountingDown(false);
        // Capture still frame
        const frame = captureStillFrame();
        if (!frame) {
          setError("Failed to capture frame. Please try again.");
          setStage("passive_capture");
          return;
        }
        setCapturedFrame(frame);
        setStage("passive_checking");
        checkLiveness.mutate(
          { imageBase64: frame, subjectRef },
          {
            onSuccess: (result) => {
              setLivenessScore(result.score ?? 0);
              setIsSandbox(result.sandbox ?? false);
              if (result.sandbox) {
                // Sandbox fallback — treat as passed
                setStage("passive_done");
                setTimeout(() => startActiveCapture(frame), 800);
              } else if (!result.passed) {
                setError(
                  `Passive liveness failed (score: ${((result.score ?? 0) * 100).toFixed(0)}%). Please ensure your face is clearly visible and try again.`
                );
                setStage("failed");
              } else {
                setStage("passive_done");
                setTimeout(() => startActiveCapture(frame), 800);
              }
            },
            onError: (err) => {
              setError(`Liveness check error: ${err.message}`);
              setStage("failed");
            },
          }
        );
      }
    }, 1000);
  }, [captureStillFrame, checkLiveness, subjectRef]);

  // ── Stage: Active Liveness ────────────────────────────────────────────────

  const startActiveCapture = useCallback(
    (stillFrame: string) => {
      setStage("active_capture");
      setFrameProgress(0);
      const frames: string[] = [stillFrame]; // include the passive still as frame 0
      const interval = setInterval(() => {
        const f = captureStillFrame();
        if (f) frames.push(f);
        setFrameProgress(Math.min(100, Math.round((frames.length / frameCount) * 100)));
        if (frames.length >= frameCount) {
          clearInterval(interval);
          frameIntervalRef.current = null;
          setCapturedFrames(frames);
          setStage("active_checking");
          checkActiveLiveness.mutate(
            { frames, challenge, subjectRef },
            {
              onSuccess: (result) => {
                setActiveLivenessScore(result.score ?? 0);
                if (!result.sandbox && !result.passed) {
                  setError(
                    `Active liveness failed. Challenge: "${CHALLENGE_LABELS[challenge]}". Please try again.`
                  );
                  setStage("failed");
                } else {
                  setStage("active_done");
                  // Use the still frame for antispoofing
                  setTimeout(() => runAntispoofing(stillFrame), 600);
                }
              },
              onError: (err) => {
                setError(`Active liveness error: ${err.message}`);
                setStage("failed");
              },
            }
          );
        }
      }, 250); // capture at ~4 fps
      frameIntervalRef.current = interval;
    },
    [captureStillFrame, checkActiveLiveness, challenge, subjectRef, frameCount]
  );

  // ── Stage: Anti-Spoofing ──────────────────────────────────────────────────

  const runAntispoofing = useCallback(
    (imageB64: string) => {
      setStage("spoof_checking");
      checkAntispoofing.mutate(
        { imageBase64: imageB64, subjectRef },
        {
          onSuccess: (result) => {
            setAntiSpoofScore(result.score ?? 0);
            setSpoofType(result.spoof_type ?? "genuine");
            setLastSessionId((result as any).sessionId);
            if (!result.sandbox && !result.genuine) {
              const spoofLabel =
                ({
                  printed_photo: "Printed Photo",
                  screen_replay: "Screen Replay",
                  paper_mask: "Paper Mask",
                  "3d_mask": "3D Mask",
                  deepfake: "Deepfake",
                  high_quality_photo: "High-Quality Photo",
                } as Record<string, string>)[result.spoof_type ?? ""] ?? result.spoof_type;
              setError(
                `Anti-spoofing check failed: detected ${spoofLabel} attack (confidence: ${((result.score ?? 0) * 100).toFixed(0)}%).`
              );
              setStage("failed");
            } else {
              setStage("spoof_done");
              setTimeout(() => setStage("success"), 600);
            }
          },
          onError: (err) => {
            setError(`Anti-spoofing error: ${err.message}`);
            setStage("failed");
          },
        }
      );
    },
    [checkAntispoofing, subjectRef]
  );

  // ── Handle success ────────────────────────────────────────────────────────

  useEffect(() => {
    if (stage === "success" && capturedFrame) {
      onSuccess({
        imageBase64: capturedFrame,
        livenessScore,
        activeLivenessScore,
        antiSpoofScore,
        spoofType,
        sessionId: lastSessionId,
        sandbox: isSandbox,
      });
    }
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reset ─────────────────────────────────────────────────────────────────

  const handleRetry = useCallback(() => {
    setError(null);
    setCapturedFrame(null);
    setCapturedFrames([]);
    setFrameProgress(0);
    setStage("idle");
  }, []);

  // ── Render helpers ────────────────────────────────────────────────────────

  const isChecking =
    stage === "passive_checking" ||
    stage === "active_checking" ||
    stage === "spoof_checking";

  const stageProgress =
    stage === "idle" || stage === "passive_capture" || stage === "passive_checking"
      ? 0
      : stage === "passive_done" || stage === "active_capture" || stage === "active_checking"
      ? 33
      : stage === "active_done" || stage === "spoof_checking" || stage === "spoof_done"
      ? 66
      : stage === "success"
      ? 100
      : stage === "failed"
      ? 0
      : 0;

  const stageLabel =
    STAGE_INFO[stage]?.label ?? (stage === "idle" ? "Ready" : stage);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg p-0 overflow-hidden bg-slate-900 border-slate-700 text-slate-100">
        <DialogHeader className="px-6 pt-6 pb-3 border-b border-slate-700">
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <Camera className="w-5 h-5 text-blue-400" />
            Biometric Verification
          </DialogTitle>
        </DialogHeader>

        {/* Progress bar */}
        <div className="px-6 pt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">
              {stageLabel}
            </span>
            {stage !== "failed" && (
              <span className="text-xs text-slate-400">{stageProgress}%</span>
            )}
          </div>
          <Progress
            value={stageProgress}
            className={`h-1.5 ${stage === "failed" ? "bg-red-900" : "bg-slate-700"}`}
          />
          {/* Step indicators */}
          <div className="flex items-center gap-2 mt-3">
            {[
              { key: "passive", label: "Passive", icon: <Eye className="w-3 h-3" /> },
              { key: "active", label: "Active", icon: <Activity className="w-3 h-3" /> },
              { key: "spoof", label: "Anti-Spoof", icon: <ShieldCheck className="w-3 h-3" /> },
            ].map((s, i) => {
              const done =
                (s.key === "passive" && ["passive_done", "active_capture", "active_checking", "active_done", "spoof_checking", "spoof_done", "success"].includes(stage)) ||
                (s.key === "active" && ["active_done", "spoof_checking", "spoof_done", "success"].includes(stage)) ||
                (s.key === "spoof" && ["spoof_done", "success"].includes(stage));
              const active =
                (s.key === "passive" && ["passive_capture", "passive_checking"].includes(stage)) ||
                (s.key === "active" && ["active_capture", "active_checking"].includes(stage)) ||
                (s.key === "spoof" && ["spoof_checking"].includes(stage));
              return (
                <div key={s.key} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="w-3 h-3 text-slate-600" />}
                  <Badge
                    variant="outline"
                    className={`text-xs gap-1 px-2 py-0.5 border ${
                      done
                        ? "border-green-500 text-green-400 bg-green-500/10"
                        : active
                        ? "border-blue-500 text-blue-400 bg-blue-500/10 animate-pulse"
                        : "border-slate-600 text-slate-500"
                    }`}
                  >
                    {done ? <CheckCircle2 className="w-3 h-3" /> : s.icon}
                    {s.label}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>

        {/* Camera view */}
        <div className="relative mx-6 mt-4 rounded-xl overflow-hidden bg-black aspect-[4/3]">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${isChecking || stage === "success" ? "opacity-40" : "opacity-100"} transition-opacity`}
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Overlay: face guide oval */}
          {(stage === "idle" || stage === "passive_capture" || stage === "active_capture") && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className={`border-2 rounded-full ${
                  stage === "active_capture" ? "border-blue-400" : "border-white/40"
                }`}
                style={{ width: "52%", height: "72%", boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)" }}
              />
            </div>
          )}

          {/* Countdown overlay */}
          {isCountingDown && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <span className="text-7xl font-bold text-white tabular-nums">{countdown}</span>
            </div>
          )}

          {/* Checking overlay */}
          {isChecking && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 gap-3">
              <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
              <span className="text-sm text-slate-300">{STAGE_INFO[stage]?.description}</span>
            </div>
          )}

          {/* Active liveness frame capture progress */}
          {stage === "active_capture" && (
            <div className="absolute bottom-3 left-3 right-3">
              <div className="bg-black/70 rounded-lg px-3 py-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-blue-300 font-medium">
                    {CHALLENGE_LABELS[challenge]}
                  </span>
                  <span className="text-xs text-slate-400">{Math.round(frameProgress)}%</span>
                </div>
                <Progress value={frameProgress} className="h-1 bg-slate-700" />
              </div>
            </div>
          )}

          {/* Success overlay */}
          {stage === "success" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 gap-3">
              <CheckCircle2 className="w-14 h-14 text-green-400" />
              <span className="text-base font-semibold text-green-300">Verified</span>
            </div>
          )}

          {/* Failed overlay */}
          {stage === "failed" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 gap-3">
              <XCircle className="w-14 h-14 text-red-400" />
              <span className="text-base font-semibold text-red-300">Verification Failed</span>
            </div>
          )}
        </div>

        {/* Instruction / error */}
        <div className="px-6 mt-3 min-h-[48px]">
          {error ? (
            <Alert variant="destructive" className="py-2 bg-red-950 border-red-800">
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          ) : (
            <p className="text-sm text-slate-400 text-center">
              {stage === "idle" && "Position your face within the oval and press Start."}
              {stage === "passive_capture" && (isCountingDown ? `Capturing in ${countdown}…` : "Hold still and look directly at the camera.")}
              {stage === "passive_done" && "Passive liveness passed ✓ — starting active check…"}
              {stage === "active_capture" && `${CHALLENGE_LABELS[challenge]} — hold steady.`}
              {stage === "active_done" && "Active liveness passed ✓ — running anti-spoofing…"}
              {stage === "spoof_done" && "Anti-spoofing passed ✓ — all checks complete!"}
              {stage === "success" && "All biometric checks passed successfully."}
            </p>
          )}
        </div>

        {/* Score badges (shown after each stage completes) */}
        {(livenessScore > 0 || activeLivenessScore > 0 || antiSpoofScore > 0) && (
          <div className="px-6 mt-2 flex gap-2 flex-wrap">
            {livenessScore > 0 && (
              <Badge variant="outline" className="text-xs border-slate-600 text-slate-300">
                <Eye className="w-3 h-3 mr-1" />
                Passive: {(livenessScore * 100).toFixed(0)}%
              </Badge>
            )}
            {activeLivenessScore > 0 && (
              <Badge variant="outline" className="text-xs border-slate-600 text-slate-300">
                <Activity className="w-3 h-3 mr-1" />
                Active: {(activeLivenessScore * 100).toFixed(0)}%
              </Badge>
            )}
            {antiSpoofScore > 0 && (
              <Badge
                variant="outline"
                className={`text-xs border-slate-600 ${spoofType === "genuine" ? "text-green-400" : "text-red-400"}`}
              >
                <ShieldCheck className="w-3 h-3 mr-1" />
                {spoofType === "genuine" ? `Genuine: ${(antiSpoofScore * 100).toFixed(0)}%` : `⚠ ${spoofType}`}
              </Badge>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="px-6 py-5 flex gap-3 justify-end border-t border-slate-700 mt-4">
          <Button
            variant="outline"
            onClick={onClose}
            className="border-slate-600 text-slate-300 hover:bg-slate-800"
            disabled={isChecking}
          >
            Cancel
          </Button>

          {stage === "failed" && (
            <Button
              onClick={handleRetry}
              variant="outline"
              className="border-blue-600 text-blue-400 hover:bg-blue-900/30 gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </Button>
          )}

          {(stage === "idle") && cameraReady && (
            <Button
              onClick={startPassiveLiveness}
              className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
            >
              <Camera className="w-4 h-4" />
              Start Verification
            </Button>
          )}

          {stage === "idle" && !cameraReady && !error && (
            <Button disabled className="gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Starting camera…
            </Button>
          )}

          {stage === "idle" && error && (
            <Button onClick={startCamera} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              Retry Camera
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
