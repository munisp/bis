/**
 * VerifyIdentityPage — NIN/BVN Verification Flow
 * ================================================
 * Full verification UI with loading states, error handling, and result display.
 * Calls the real YouVerify API via the BFF quickcheck procedure.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useVerificationNotifications } from "@/hooks/useVerificationNotifications";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, Loader2, ShieldAlert, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type VerificationStatus = "idle" | "loading" | "success" | "error" | "unavailable";

// ── Step Progress Indicator ───────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: "Select ID Type", description: "Choose NIN or BVN" },
  { id: 2, label: "Enter Details", description: "Provide ID number and name" },
  { id: 3, label: "Verification", description: "Real-time API check" },
  { id: 4, label: "Result", description: "View verification outcome" },
] as const;

function getActiveStep(status: VerificationStatus, idNumber: string, idType: string): number {
  if (status === "success" || status === "error" || status === "unavailable") return 4;
  if (status === "loading") return 3;
  if (idNumber.length > 0) return 2;
  return 1;
}

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center justify-between mb-6">
      {STEPS.map((step, idx) => {
        const isActive = step.id === currentStep;
        const isCompleted = step.id < currentStep;
        return (
          <div key={step.id} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-shrink-0">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  isCompleted
                    ? "bg-green-600 text-white"
                    : isActive
                    ? "bg-blue-600 text-white ring-2 ring-blue-300"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {isCompleted ? "✓" : step.id}
              </div>
              <span className={`text-[10px] mt-1 text-center max-w-[72px] leading-tight ${
                isActive ? "font-semibold text-blue-700" : "text-muted-foreground"
              }`}>
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 mt-[-12px] ${
                isCompleted ? "bg-green-500" : "bg-muted"
              }`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface VerificationResult {
  verified: boolean;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  dateOfBirth?: string;
  gender?: string;
  phone?: string;
  address?: string;
  photo?: string;
  provider?: string;
  verifiedAt?: string;
  matchScore?: number;
}

export default function VerifyIdentityPage() {
  const [idType, setIdType] = useState<"nin" | "bvn">("nin");

  // Real-time notification listener — shows toast when verification status changes
  useVerificationNotifications();

  const [idNumber, setIdNumber] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [status, setStatus] = useState<VerificationStatus>("idle");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const verifyMutation = trpc.quickcheck.run.useMutation({
    onMutate: () => {
      setStatus("loading");
      setResult(null);
      setErrorMessage("");
    },
    onSuccess: (data) => {
      setStatus("success");
      setResult({
        verified: data.verdict === "clear",
        firstName: data.subjectName?.split(" ")[0],
        lastName: data.subjectName?.split(" ").slice(1).join(" "),
        provider: "YouVerify",
        verifiedAt: new Date().toISOString(),
        matchScore: data.riskScore != null ? 100 - data.riskScore : undefined,
      });
      toast.success("Identity verification complete");
    },
    onError: (error) => {
      setStatus("error");
      const msg = error.message || "Verification failed";
      if (msg.includes("unavailable") || msg.includes("provider")) {
        setStatus("unavailable");
        setErrorMessage("The identity verification service is currently unavailable. This is not a rejection — please retry in a few minutes.");
      } else if (msg.includes("UNAUTHORIZED") || msg.includes("login")) {
        setErrorMessage("Your session has expired. Please log in again to continue.");
      } else {
        setErrorMessage(msg);
      }
      toast.error("Verification failed");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!idNumber.trim()) {
      toast.error("Please enter an ID number");
      return;
    }
    verifyMutation.mutate({
      fullName: [firstName.trim(), lastName.trim()].filter(Boolean).join(" ") || "Verification Subject",
      workerCategory: "other" as const,
      tier: "basic" as const,
      ...(idType === "nin" ? { nin: idNumber.trim() } : { bvn: idNumber.trim() }),
    });
  };

  const handleReset = () => {
    setStatus("idle");
    setResult(null);
    setErrorMessage("");
    setIdNumber("");
    setFirstName("");
    setLastName("");
  };

  return (
    <div className="container max-w-2xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Identity Verification</h1>
        <p className="text-muted-foreground mt-1">
          Verify Nigerian National Identification Number (NIN) or Bank Verification Number (BVN)
        </p>
      </div>

      {/* Step-by-Step Progress Indicator */}
      <StepIndicator currentStep={getActiveStep(status, idNumber, idType)} />

      {/* Verification Form */}
      <Card>
        <CardHeader>
          <CardTitle>Verify Identity</CardTitle>
          <CardDescription>
            Enter the subject's ID number to perform a real-time verification against the national database.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* ID Type Selection */}
            <div className="flex gap-2">
              <Button
                type="button"
                variant={idType === "nin" ? "default" : "outline"}
                onClick={() => setIdType("nin")}
                className="flex-1"
              >
                NIN (11 digits)
              </Button>
              <Button
                type="button"
                variant={idType === "bvn" ? "default" : "outline"}
                onClick={() => setIdType("bvn")}
                className="flex-1"
              >
                BVN (11 digits)
              </Button>
            </div>

            {/* ID Number */}
            <div className="space-y-2">
              <Label htmlFor="idNumber">{idType === "nin" ? "NIN" : "BVN"} Number</Label>
              <Input
                id="idNumber"
                placeholder={idType === "nin" ? "Enter 11-digit NIN" : "Enter 11-digit BVN"}
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value.replace(/\D/g, "").slice(0, 11))}
                maxLength={11}
                disabled={status === "loading"}
              />
            </div>

            {/* Optional name fields for match scoring */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name (optional)</Label>
                <Input
                  id="firstName"
                  placeholder="For match scoring"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={status === "loading"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name (optional)</Label>
                <Input
                  id="lastName"
                  placeholder="For match scoring"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={status === "loading"}
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={status === "loading" || idNumber.length !== 11}>
              {status === "loading" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Verify Identity"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Loading State */}
      {status === "loading" && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              <div>
                <p className="font-medium text-blue-900">Verifying identity...</p>
                <p className="text-sm text-blue-700">
                  Querying the national identity database. This typically takes 3-10 seconds.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error State */}
      {status === "error" && (
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-6 w-6 text-red-600 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-red-900">Verification Failed</p>
                <p className="text-sm text-red-700 mt-1">{errorMessage}</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={handleReset}>
                  <RefreshCw className="mr-2 h-3 w-3" /> Try Again
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Unavailable State */}
      {status === "unavailable" && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-6 w-6 text-amber-600 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-amber-900">Service Temporarily Unavailable</p>
                <p className="text-sm text-amber-700 mt-1">{errorMessage}</p>
                <p className="text-xs text-amber-600 mt-2">
                  This does NOT indicate a failed verification. The provider is temporarily unreachable.
                </p>
                <Button variant="outline" size="sm" className="mt-3" onClick={handleReset}>
                  <RefreshCw className="mr-2 h-3 w-3" /> Retry
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Success State */}
      {status === "success" && result && (
        <Card className={result.verified ? "border-green-200 bg-green-50/50" : "border-amber-200 bg-amber-50/50"}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {result.verified ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-amber-600" />
              )}
              {result.verified ? "Identity Verified" : "Verification Inconclusive"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              {result.firstName && (
                <div>
                  <span className="text-muted-foreground">First Name</span>
                  <p className="font-medium">{result.firstName}</p>
                </div>
              )}
              {result.lastName && (
                <div>
                  <span className="text-muted-foreground">Last Name</span>
                  <p className="font-medium">{result.lastName}</p>
                </div>
              )}
              {result.dateOfBirth && (
                <div>
                  <span className="text-muted-foreground">Date of Birth</span>
                  <p className="font-medium">{result.dateOfBirth}</p>
                </div>
              )}
              {result.gender && (
                <div>
                  <span className="text-muted-foreground">Gender</span>
                  <p className="font-medium">{result.gender}</p>
                </div>
              )}
              {result.phone && (
                <div>
                  <span className="text-muted-foreground">Phone</span>
                  <p className="font-medium">{result.phone}</p>
                </div>
              )}
              {result.matchScore !== undefined && (
                <div>
                  <span className="text-muted-foreground">Match Score</span>
                  <p className="font-medium">{result.matchScore}%</p>
                </div>
              )}
            </div>
            <div className="pt-3 border-t text-xs text-muted-foreground flex justify-between">
              <span>Provider: {result.provider}</span>
              <span>Verified: {result.verifiedAt ? new Date(result.verifiedAt).toLocaleString() : "—"}</span>
            </div>
            <Button variant="outline" size="sm" onClick={handleReset}>
              Verify Another
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
