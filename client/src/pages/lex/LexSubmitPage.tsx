import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, CheckCircle2, AlertCircle, MapPin, Lock } from "lucide-react";

const INCIDENT_TYPES = [
  { value: "arrest", label: "Arrest" },
  { value: "seizure", label: "Seizure" },
  { value: "witness_statement", label: "Witness Statement" },
  { value: "court_order", label: "Court Order" },
  { value: "intel_tip", label: "Intelligence Tip" },
  { value: "missing_person", label: "Missing Person" },
  { value: "homicide", label: "Homicide" },
  { value: "fraud", label: "Fraud" },
  { value: "cybercrime", label: "Cybercrime" },
  { value: "other", label: "Other" },
];

type SubmitResult = { submissionRef: string; validationScore: number };

export default function LexSubmitPage() {
  const [step, setStep] = useState<"auth" | "form" | "success">("auth");
  const [submitterId, setSubmitterId] = useState("");
  const [pin, setPin] = useState("");
  const [authError, setAuthError] = useState("");
  const [result, setResult] = useState<SubmitResult | null>(null);

  const [form, setForm] = useState({
    incidentType: "" as any,
    incidentLga: "",
    incidentAddress: "",
    gpsLat: "",
    gpsLng: "",
    incidentDate: "",
    subjectName: "",
    subjectNin: "",
    subjectPhone: "",
    subjectAddress: "",
    narrative: "",
  });

  const submitMutation = trpc.lex.submitIncident.useMutation({
    onSuccess: (data) => {
      setResult(data);
      setStep("success");
    },
    onError: (e) => {
      if (e.message.includes("credentials") || e.message.includes("PIN")) {
        setAuthError(e.message);
        setStep("auth");
      }
    },
  });

  const handleAuthNext = () => {
    if (!submitterId.trim() || !pin.trim()) { setAuthError("Both Submitter ID and PIN are required."); return; }
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) { setAuthError("PIN must be exactly 6 digits."); return; }
    setAuthError("");
    setStep("form");
  };

  const handleSubmit = () => {
    submitMutation.mutate({
      submitterId,
      pin,
      incidentType: form.incidentType,
      incidentLga: form.incidentLga || undefined,
      incidentAddress: form.incidentAddress || undefined,
      gpsLat: form.gpsLat ? parseFloat(form.gpsLat) : undefined,
      gpsLng: form.gpsLng ? parseFloat(form.gpsLng) : undefined,
      incidentDate: form.incidentDate ? new Date(form.incidentDate) : undefined,
      subjectName: form.subjectName || undefined,
      subjectNin: form.subjectNin || undefined,
      subjectPhone: form.subjectPhone || undefined,
      subjectAddress: form.subjectAddress || undefined,
      narrative: form.narrative,
    });
  };

  const tryGps = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
      setForm(f => ({ ...f, gpsLat: String(pos.coords.latitude.toFixed(6)), gpsLng: String(pos.coords.longitude.toFixed(6)) }));
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-600 text-white mb-3">
            <Shield className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">LEX Incident Submission</h1>
          <p className="text-sm text-slate-500 mt-1">Background Intelligence System — Law Enforcement Portal</p>
        </div>

        {/* Step 1: Authentication */}
        {step === "auth" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Lock className="w-4 h-4" /> Officer Authentication
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Enter your Submitter ID and PIN issued by your BIS administrator. Your submission will be automatically tagged to your agency's registered state.
              </p>
              <div>
                <Label>Submitter ID</Label>
                <Input
                  value={submitterId}
                  onChange={e => setSubmitterId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="font-mono text-sm"
                />
              </div>
              <div>
                <Label>6-Digit PIN</Label>
                <Input
                  type="password"
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="••••••"
                  maxLength={6}
                  className="text-center text-xl tracking-widest font-mono"
                />
              </div>
              {authError && (
                <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded p-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {authError}
                </div>
              )}
              <Button className="w-full" onClick={handleAuthNext}>
                Continue to Incident Form
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                Do not have credentials? Contact your commanding officer or BIS administrator.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Incident Form */}
        {step === "form" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Incident Report</CardTitle>
              <p className="text-xs text-muted-foreground">Fields marked * are required. Your submission is automatically scoped to your agency's state.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Incident Type *</Label>
                <Select value={form.incidentType} onValueChange={v => setForm(f => ({ ...f, incidentType: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>{INCIDENT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              <div>
                <Label>Incident Date</Label>
                <Input type="date" value={form.incidentDate} onChange={e => setForm(f => ({ ...f, incidentDate: e.target.value }))} max={new Date().toISOString().split("T")[0]} />
              </div>

              <div>
                <Label>LGA</Label>
                <Input value={form.incidentLga} onChange={e => setForm(f => ({ ...f, incidentLga: e.target.value }))} placeholder="Local Government Area" />
              </div>

              <div>
                <Label>Incident Address</Label>
                <Input value={form.incidentAddress} onChange={e => setForm(f => ({ ...f, incidentAddress: e.target.value }))} placeholder="Street address or landmark" />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>GPS Coordinates (optional)</Label>
                  <Button type="button" size="sm" variant="ghost" className="h-6 text-xs" onClick={tryGps}>
                    <MapPin className="w-3 h-3 mr-1" /> Use my location
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input value={form.gpsLat} onChange={e => setForm(f => ({ ...f, gpsLat: e.target.value }))} placeholder="Latitude" />
                  <Input value={form.gpsLng} onChange={e => setForm(f => ({ ...f, gpsLng: e.target.value }))} placeholder="Longitude" />
                </div>
              </div>

              <hr />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject Information</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Subject Name</Label>
                  <Input value={form.subjectName} onChange={e => setForm(f => ({ ...f, subjectName: e.target.value }))} />
                </div>
                <div>
                  <Label>NIN</Label>
                  <Input value={form.subjectNin} onChange={e => setForm(f => ({ ...f, subjectNin: e.target.value.replace(/\D/g, "").slice(0, 11) }))} placeholder="11 digits" maxLength={11} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Phone</Label>
                  <Input value={form.subjectPhone} onChange={e => setForm(f => ({ ...f, subjectPhone: e.target.value }))} />
                </div>
                <div>
                  <Label>Address</Label>
                  <Input value={form.subjectAddress} onChange={e => setForm(f => ({ ...f, subjectAddress: e.target.value }))} />
                </div>
              </div>

              <hr />
              <div>
                <Label>Incident Narrative * <span className="text-muted-foreground font-normal">(min. 50 characters)</span></Label>
                <Textarea
                  value={form.narrative}
                  onChange={e => setForm(f => ({ ...f, narrative: e.target.value }))}
                  rows={5}
                  placeholder="Describe the incident in detail — what happened, when, who was involved, what evidence was collected..."
                />
                <p className="text-xs text-muted-foreground mt-1">{form.narrative.length} / 50 minimum</p>
              </div>

              {submitMutation.error && (
                <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded p-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {submitMutation.error.message}
                </div>
              )}

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep("auth")}>Back</Button>
                <Button
                  className="flex-1"
                  disabled={!form.incidentType || form.narrative.length < 50 || submitMutation.isPending}
                  onClick={handleSubmit}
                >
                  {submitMutation.isPending ? "Submitting..." : "Submit Incident Report"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Success */}
        {step === "success" && result && (
          <Card>
            <CardContent className="py-10 text-center space-y-4">
              <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto" />
              <div>
                <h2 className="text-lg font-bold">Submission Received</h2>
                <p className="text-muted-foreground text-sm mt-1">Your incident report has been submitted for review.</p>
              </div>
              <div className="bg-muted rounded-lg p-4 text-left space-y-2">
                <div>
                  <p className="text-xs text-muted-foreground">Reference Number</p>
                  <p className="font-mono font-bold text-lg">{result.submissionRef}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Initial Validation Score</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${result.validationScore >= 70 ? "bg-green-500" : result.validationScore >= 40 ? "bg-yellow-500" : "bg-red-500"}`}
                        style={{ width: `${result.validationScore}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium">{result.validationScore}/100</span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Keep your reference number. A BIS analyst will review your submission. You may be contacted for clarification.
              </p>
              <Button onClick={() => { setStep("auth"); setForm({ incidentType: "" as any, incidentLga: "", incidentAddress: "", gpsLat: "", gpsLng: "", incidentDate: "", subjectName: "", subjectNin: "", subjectPhone: "", subjectAddress: "", narrative: "" }); setResult(null); }}>
                Submit Another Report
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
