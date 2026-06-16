/**
 * VerifyKYC.tsx — Public self-service KYC verification portal
 * Accessible at /verify/:token without authentication.
 * Subjects fill in their NIN/BVN/phone/DOB and submit their identity data
 * through a hosted verification link created by a BIS operator.
 */
import { useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, Clock, ShieldCheck, AlertTriangle, Loader2, User, CreditCard, Phone, Calendar } from "lucide-react";

const CHECK_LABELS: Record<string, { label: string; icon: React.ReactNode; description: string }> = {
  nin: { label: "National ID (NIN)", icon: <CreditCard className="w-4 h-4" />, description: "Your 11-digit National Identification Number" },
  bvn: { label: "Bank Verification Number (BVN)", icon: <CreditCard className="w-4 h-4" />, description: "Your 11-digit Bank Verification Number" },
  selfie: { label: "Selfie / Liveness Check", icon: <User className="w-4 h-4" />, description: "A live photo to verify your identity" },
  document: { label: "Identity Document", icon: <ShieldCheck className="w-4 h-4" />, description: "A scan of your passport, driver's licence, or national ID" },
  address: { label: "Address Verification", icon: <ShieldCheck className="w-4 h-4" />, description: "Proof of your current residential address" },
  phone: { label: "Phone Number", icon: <Phone className="w-4 h-4" />, description: "Your active phone number for OTP verification" },
};

export default function VerifyKYC() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";

  const [form, setForm] = useState({
    subjectName: "",
    nin: "",
    bvn: "",
    dob: "",
    phone: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve the link metadata
  const { data: link, isLoading, error: resolveError } = trpc.hostedLinks.resolve.useQuery(
    { token },
    { enabled: !!token, retry: false }
  );

  const submitMutation = trpc.hostedLinks.submit.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: (err) => setError(err.message),
  });

  const requiredChecks: string[] = link?.requiredChecks ?? [];

  function handleChange(field: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.subjectName.trim()) {
      setError("Please enter your full legal name.");
      return;
    }
    if (requiredChecks.includes("nin") && form.nin.length !== 11) {
      setError("NIN must be exactly 11 digits.");
      return;
    }
    if (requiredChecks.includes("bvn") && form.bvn.length !== 11) {
      setError("BVN must be exactly 11 digits.");
      return;
    }
    submitMutation.mutate({
      token,
      subjectName: form.subjectName.trim(),
      nin: requiredChecks.includes("nin") ? form.nin : undefined,
      bvn: requiredChecks.includes("bvn") ? form.bvn : undefined,
      dob: requiredChecks.includes("document") && form.dob ? form.dob : undefined,
      phone: requiredChecks.includes("phone") ? form.phone : undefined,
    });
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-slate-800 border-slate-700">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="w-10 h-10 animate-spin text-blue-400" />
            <p className="text-slate-300">Loading verification link…</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Error state (link not found / expired / revoked) ──────────────────────
  if (resolveError || !link) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-slate-800 border-slate-700">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-3">
              <AlertTriangle className="w-12 h-12 text-red-400" />
            </div>
            <CardTitle className="text-white">Link Unavailable</CardTitle>
            <CardDescription className="text-slate-400">
              {resolveError?.message ?? "This verification link is invalid, expired, or has already been used."}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center text-slate-500 text-sm">
            If you believe this is an error, please contact the organisation that sent you this link.
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-slate-800 border-slate-700">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-3">
              <CheckCircle className="w-14 h-14 text-emerald-400" />
            </div>
            <CardTitle className="text-white text-xl">Verification Submitted</CardTitle>
            <CardDescription className="text-slate-300 text-base mt-2">
              Thank you, <strong>{form.subjectName}</strong>. Your identity information has been received and will be verified shortly.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center text-slate-400 text-sm">
            You will be notified by the requesting organisation once the verification is complete. You may now close this page.
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Main form ──────────────────────────────────────────────────────────────
  const expiresAt = new Date(link.expiresAt);
  const hoursLeft = Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 3_600_000));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-4">
        {/* Header */}
        <div className="text-center space-y-1">
          <div className="flex justify-center mb-3">
            <ShieldCheck className="w-10 h-10 text-blue-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">Identity Verification</h1>
          <p className="text-slate-400 text-sm">
            Secure verification powered by BIS Platform
          </p>
        </div>

        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="pb-3">
            {link.subjectName && (
              <div className="flex items-center gap-2 mb-2">
                <User className="w-4 h-4 text-slate-400" />
                <span className="text-slate-300 text-sm">Verification for: <strong className="text-white">{link.subjectName}</strong></span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              <span className="text-amber-300 text-sm">
                Expires in {hoursLeft > 0 ? `${hoursLeft} hour${hoursLeft !== 1 ? "s" : ""}` : "less than 1 hour"}
              </span>
            </div>
            <CardTitle className="text-white text-lg mt-3">Required Checks</CardTitle>
            <div className="flex flex-wrap gap-2 mt-2">
              {requiredChecks.map(check => (
                <Badge key={check} variant="secondary" className="bg-blue-900/50 text-blue-200 border-blue-700">
                  {CHECK_LABELS[check]?.label ?? check}
                </Badge>
              ))}
            </div>
          </CardHeader>

          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {/* Full Name — always required */}
              <div className="space-y-1.5">
                <Label htmlFor="subjectName" className="text-slate-200">
                  Full Legal Name <span className="text-red-400">*</span>
                </Label>
                <Input
                  id="subjectName"
                  placeholder="e.g. Adaeze Okonkwo"
                  value={form.subjectName}
                  onChange={e => handleChange("subjectName", e.target.value)}
                  className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                  required
                />
              </div>

              {/* NIN */}
              {requiredChecks.includes("nin") && (
                <div className="space-y-1.5">
                  <Label htmlFor="nin" className="text-slate-200 flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5" />
                    National Identification Number (NIN) <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    id="nin"
                    placeholder="11-digit NIN"
                    value={form.nin}
                    onChange={e => handleChange("nin", e.target.value.replace(/\D/g, "").slice(0, 11))}
                    className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 font-mono"
                    maxLength={11}
                    pattern="\d{11}"
                    required
                  />
                  <p className="text-xs text-slate-500">{CHECK_LABELS.nin.description}</p>
                </div>
              )}

              {/* BVN */}
              {requiredChecks.includes("bvn") && (
                <div className="space-y-1.5">
                  <Label htmlFor="bvn" className="text-slate-200 flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5" />
                    Bank Verification Number (BVN) <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    id="bvn"
                    placeholder="11-digit BVN"
                    value={form.bvn}
                    onChange={e => handleChange("bvn", e.target.value.replace(/\D/g, "").slice(0, 11))}
                    className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 font-mono"
                    maxLength={11}
                    pattern="\d{11}"
                    required
                  />
                  <p className="text-xs text-slate-500">{CHECK_LABELS.bvn.description}</p>
                </div>
              )}

              {/* Date of Birth (for document check) */}
              {requiredChecks.includes("document") && (
                <div className="space-y-1.5">
                  <Label htmlFor="dob" className="text-slate-200 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    Date of Birth
                  </Label>
                  <Input
                    id="dob"
                    type="date"
                    value={form.dob}
                    onChange={e => handleChange("dob", e.target.value)}
                    className="bg-slate-700 border-slate-600 text-white"
                    max={new Date().toISOString().slice(0, 10)}
                  />
                </div>
              )}

              {/* Phone */}
              {requiredChecks.includes("phone") && (
                <div className="space-y-1.5">
                  <Label htmlFor="phone" className="text-slate-200 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5" />
                    Phone Number <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="+234 800 000 0000"
                    value={form.phone}
                    onChange={e => handleChange("phone", e.target.value)}
                    className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                    required
                  />
                </div>
              )}

              {/* Selfie / Document / Address — informational only (full capture handled by biometric module) */}
              {(requiredChecks.includes("selfie") || requiredChecks.includes("address")) && (
                <Alert className="bg-amber-900/30 border-amber-700">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <AlertDescription className="text-amber-200 text-sm">
                    {requiredChecks.includes("selfie") && "A liveness selfie check will be initiated after form submission. "}
                    {requiredChecks.includes("address") && "Address verification documents will be requested separately. "}
                    Please ensure you are in a well-lit environment.
                  </AlertDescription>
                </Alert>
              )}

              {error && (
                <Alert className="bg-red-900/30 border-red-700">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <AlertDescription className="text-red-200 text-sm">{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>

            <CardFooter className="flex flex-col gap-3">
              <Button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                disabled={submitMutation.isPending}
              >
                {submitMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting…</>
                ) : (
                  <><ShieldCheck className="w-4 h-4 mr-2" /> Submit Verification</>
                )}
              </Button>
              <p className="text-xs text-slate-500 text-center">
                Your data is encrypted in transit and processed in accordance with the NDPR and GDPR.
                By submitting, you consent to identity verification.
              </p>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
