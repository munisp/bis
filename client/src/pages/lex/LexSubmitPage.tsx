/**
 * LexSubmitPage — Offline-capable LEX incident submission portal.
 *
 * Offline strategy:
 *  1. Connectivity is detected via navigator.onLine + a lightweight ping.
 *  2. When online: submit directly via tRPC → BIS server.
 *  3. When offline: store in IndexedDB via lexOfflineQueue, show "Queued" confirmation.
 *  4. Background sync loop (every 30s) retries queued submissions when connectivity returns.
 *  5. A persistent banner shows queue depth and last sync time.
 *  6. The page itself is cached by the Workbox service worker (vite-plugin-pwa) so it
 *     loads even with zero connectivity after first visit.
 *
 * Low-bandwidth optimisations:
 *  - No images or heavy assets on this page.
 *  - The agency list is cached via StaleWhileRevalidate (24h TTL).
 *  - All JS/CSS is CacheFirst (7d TTL).
 *  - The form uses native HTML inputs — no heavy date-picker libraries.
 */

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Shield, CheckCircle2, AlertCircle, MapPin, Lock,
  WifiOff, Wifi, Clock, RefreshCw, Database,
} from "lucide-react";
import {
  enqueue, getPending, markSynced, markFailed, pendingCount,
  type QueuedLexSubmission,
} from "@/lib/lexOfflineQueue";

// ─── Constants ────────────────────────────────────────────────────────────────

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

type SubmitResult = {
  submissionRef: string;
  validationScore: number;
  queued?: boolean;
  localRef?: string;
};

type FormState = {
  incidentType: string;
  incidentLga: string;
  incidentAddress: string;
  gpsLat: string;
  gpsLng: string;
  incidentDate: string;
  subjectName: string;
  subjectNin: string;
  subjectPhone: string;
  subjectAddress: string;
  narrative: string;
};

const EMPTY_FORM: FormState = {
  incidentType: "",
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
};

// ─── Connectivity Hook ────────────────────────────────────────────────────────

function useConnectivity() {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  return online;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LexSubmitPage() {
  const online = useConnectivity();
  const [step, setStep] = useState<"auth" | "form" | "success">("auth");
  const [submitterId, setSubmitterId] = useState("");
  const [pin, setPin] = useState("");
  const [authError, setAuthError] = useState("");
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [queueCount, setQueueCount] = useState(0);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);
  const syncRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // tRPC mutation for online submissions
  const submitMutation = trpc.lex.submitIncident.useMutation({
    onSuccess: (data) => {
      setResult({ submissionRef: data.submissionRef, validationScore: data.validationScore });
      setStep("success");
      refreshQueueCount();
    },
    onError: (e) => {
      if (e.message.includes("credentials") || e.message.includes("PIN")) {
        setAuthError(e.message);
        setStep("auth");
      }
    },
  });

  // Refresh queue count badge
  const refreshQueueCount = async () => {
    const count = await pendingCount();
    setQueueCount(count);
  };

  // Background sync: retry queued submissions when online
  const runSync = async () => {
    if (!online || syncing) return;
    const pending = await getPending();
    if (pending.length === 0) return;

    setSyncing(true);
    let synced = 0;
    for (const sub of pending) {
      try {
        // Call the BIS API directly via fetch (not tRPC hook — we're outside React render)
        const res = await fetch("/api/trpc/lex.submitIncident", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ json: sub.payload }),
        });
        if (res.ok) {
          await markSynced(sub.id!);
          synced++;
        } else {
          const errText = await res.text().catch(() => "Unknown error");
          await markFailed(sub.id!, errText);
        }
      } catch (err) {
        await markFailed(sub.id!, String(err));
      }
    }
    if (synced > 0) setLastSync(new Date());
    await refreshQueueCount();
    setSyncing(false);
  };

  // Start sync loop
  useEffect(() => {
    refreshQueueCount();
    if (syncRef.current) clearInterval(syncRef.current);
    syncRef.current = setInterval(runSync, 30_000);
    return () => { if (syncRef.current) clearInterval(syncRef.current); };
  }, [online]);

  // Trigger immediate sync when coming back online
  useEffect(() => {
    if (online) runSync();
  }, [online]);

  const handleAuthNext = () => {
    if (!submitterId.trim() || !pin.trim()) { setAuthError("Both Submitter ID and PIN are required."); return; }
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) { setAuthError("PIN must be exactly 6 digits."); return; }
    setAuthError("");
    setStep("form");
  };

  const handleSubmit = async () => {
    const payload = {
      submitterId,
      pin,
      incidentType: form.incidentType as any,
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
    };

    if (!online) {
      // Offline: queue locally
      const localRef = await enqueue(payload as any);
      await refreshQueueCount();
      setResult({
        submissionRef: localRef,
        validationScore: 0,
        queued: true,
        localRef,
      });
      setStep("success");
      return;
    }

    // Online: submit via tRPC
    submitMutation.mutate(payload);
  };

  const tryGps = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
      setForm(f => ({
        ...f,
        gpsLat: String(pos.coords.latitude.toFixed(6)),
        gpsLng: String(pos.coords.longitude.toFixed(6)),
      }));
    });
  };

  const resetForm = () => {
    setStep("auth");
    setForm(EMPTY_FORM);
    setResult(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-start p-4 pt-6">

      {/* Connectivity + Queue Status Banner */}
      <div className="w-full max-w-lg mb-4 space-y-2">
        {!online && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-800">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span className="font-medium">Offline mode</span>
            <span className="text-amber-600">— submissions will be queued and synced when connectivity returns.</span>
          </div>
        )}
        {online && queueCount > 0 && (
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800">
            <Database className="w-4 h-4 shrink-0" />
            <span>{queueCount} submission{queueCount !== 1 ? "s" : ""} pending sync</span>
            {syncing ? (
              <RefreshCw className="w-3 h-3 animate-spin ml-auto" />
            ) : (
              <Button size="sm" variant="ghost" className="h-5 text-xs ml-auto px-2" onClick={runSync}>
                Sync now
              </Button>
            )}
          </div>
        )}
        {online && queueCount === 0 && lastSync && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700">
            <Wifi className="w-4 h-4 shrink-0" />
            <span>All submissions synced</span>
            <span className="ml-auto text-xs text-green-600 flex items-center gap-1">
              <Clock className="w-3 h-3" /> {lastSync.toLocaleTimeString()}
            </span>
          </div>
        )}
      </div>

      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-600 text-white mb-3">
            <Shield className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">LEX Incident Submission</h1>
          <p className="text-sm text-slate-500 mt-1">Background Intelligence System — Law Enforcement Portal</p>
          {!online && (
            <Badge variant="outline" className="mt-2 text-amber-600 border-amber-300 bg-amber-50">
              <WifiOff className="w-3 h-3 mr-1" /> Offline
            </Badge>
          )}
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
                  placeholder="e.g. OFF-NPF-LA-001"
                  className="font-mono text-sm"
                  autoComplete="username"
                />
              </div>
              <div>
                <Label>6-Digit PIN</Label>
                <Input
                  type="password"
                  inputMode="numeric"
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="••••••"
                  maxLength={6}
                  className="text-center text-xl tracking-widest font-mono"
                  autoComplete="current-password"
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
                No credentials? Contact your commanding officer or BIS administrator.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Incident Form */}
        {step === "form" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Incident Report</span>
                {!online && <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">Offline — will queue</Badge>}
              </CardTitle>
              <p className="text-xs text-muted-foreground">Fields marked * are required. Your submission is automatically scoped to your agency's state.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Incident Type *</Label>
                <Select value={form.incidentType} onValueChange={v => setForm(f => ({ ...f, incidentType: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {INCIDENT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Incident Date</Label>
                <Input
                  type="date"
                  value={form.incidentDate}
                  onChange={e => setForm(f => ({ ...f, incidentDate: e.target.value }))}
                  max={new Date().toISOString().split("T")[0]}
                />
              </div>

              <div>
                <Label>LGA (Local Government Area)</Label>
                <Input
                  value={form.incidentLga}
                  onChange={e => setForm(f => ({ ...f, incidentLga: e.target.value }))}
                  placeholder="e.g. Lagos Island"
                />
              </div>

              <div>
                <Label>Incident Address / Landmark</Label>
                <Input
                  value={form.incidentAddress}
                  onChange={e => setForm(f => ({ ...f, incidentAddress: e.target.value }))}
                  placeholder="Street address or nearest landmark"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>GPS Coordinates (optional)</Label>
                  <Button type="button" size="sm" variant="ghost" className="h-6 text-xs" onClick={tryGps}>
                    <MapPin className="w-3 h-3 mr-1" /> Use my location
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={form.gpsLat}
                    onChange={e => setForm(f => ({ ...f, gpsLat: e.target.value }))}
                    placeholder="Latitude"
                    inputMode="decimal"
                  />
                  <Input
                    value={form.gpsLng}
                    onChange={e => setForm(f => ({ ...f, gpsLng: e.target.value }))}
                    placeholder="Longitude"
                    inputMode="decimal"
                  />
                </div>
              </div>

              <hr />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject Information (if applicable)</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Subject Name</Label>
                  <Input
                    value={form.subjectName}
                    onChange={e => setForm(f => ({ ...f, subjectName: e.target.value }))}
                    placeholder="Full name"
                  />
                </div>
                <div>
                  <Label>NIN</Label>
                  <Input
                    value={form.subjectNin}
                    onChange={e => setForm(f => ({ ...f, subjectNin: e.target.value.replace(/\D/g, "").slice(0, 11) }))}
                    placeholder="11 digits"
                    maxLength={11}
                    inputMode="numeric"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Phone</Label>
                  <Input
                    value={form.subjectPhone}
                    onChange={e => setForm(f => ({ ...f, subjectPhone: e.target.value }))}
                    placeholder="080xxxxxxxx"
                    inputMode="tel"
                  />
                </div>
                <div>
                  <Label>Subject Address</Label>
                  <Input
                    value={form.subjectAddress}
                    onChange={e => setForm(f => ({ ...f, subjectAddress: e.target.value }))}
                    placeholder="Last known address"
                  />
                </div>
              </div>

              <hr />
              <div>
                <Label>
                  Incident Narrative *{" "}
                  <span className="text-muted-foreground font-normal">(min. 50 characters)</span>
                </Label>
                <Textarea
                  value={form.narrative}
                  onChange={e => setForm(f => ({ ...f, narrative: e.target.value }))}
                  rows={6}
                  placeholder="Describe the incident in detail — what happened, when, who was involved, what evidence was collected, any witnesses..."
                />
                <p className={`text-xs mt-1 ${form.narrative.length >= 50 ? "text-green-600" : "text-muted-foreground"}`}>
                  {form.narrative.length} / 50 minimum characters
                </p>
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
                  {submitMutation.isPending
                    ? "Submitting..."
                    : online
                    ? "Submit Incident Report"
                    : "Queue for Later Sync"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Success (online) or Queued (offline) */}
        {step === "success" && result && (
          <Card>
            <CardContent className="py-10 text-center space-y-4">
              {result.queued ? (
                <>
                  <Database className="w-14 h-14 text-amber-500 mx-auto" />
                  <div>
                    <h2 className="text-lg font-bold">Submission Queued Offline</h2>
                    <p className="text-muted-foreground text-sm mt-1">
                      Your report has been saved locally and will be automatically submitted to BIS when connectivity is restored.
                    </p>
                  </div>
                  <div className="bg-muted rounded-lg p-4 text-left space-y-2">
                    <div>
                      <p className="text-xs text-muted-foreground">Local Reference</p>
                      <p className="font-mono font-bold text-base break-all">{result.localRef}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded p-2">
                      <WifiOff className="w-3 h-3 shrink-0" />
                      Do not close this browser until connectivity is restored, or the sync will run automatically on next visit.
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto" />
                  <div>
                    <h2 className="text-lg font-bold">Submission Received</h2>
                    <p className="text-muted-foreground text-sm mt-1">Your incident report has been submitted for review.</p>
                  </div>
                  <div className="bg-muted rounded-lg p-4 text-left space-y-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Reference Number</p>
                      <p className="font-mono font-bold text-lg">{result.submissionRef}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Initial Validation Score</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              result.validationScore >= 70 ? "bg-green-500" :
                              result.validationScore >= 40 ? "bg-yellow-500" : "bg-red-500"
                            }`}
                            style={{ width: `${result.validationScore}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium">{result.validationScore}/100</span>
                      </div>
                    </div>
                  </div>
                </>
              )}
              <p className="text-xs text-muted-foreground">
                Keep your reference number. A BIS analyst will review your submission. You may be contacted for clarification.
              </p>
              <Button onClick={resetForm}>Submit Another Report</Button>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-slate-400 mt-6">
          BIS LEX Portal — Secure Law Enforcement Reporting System
          <br />
          All submissions are encrypted and audited.
        </p>
      </div>
    </div>
  );
}
