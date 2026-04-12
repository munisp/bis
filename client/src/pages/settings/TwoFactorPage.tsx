import { useState } from "react";
import BISLayout from "@/components/BISLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, ShieldCheck, ShieldOff, Copy, CheckCircle2, KeyRound } from "lucide-react";
import { toast } from "sonner";

export default function TwoFactorPage() {
  const utils = trpc.useUtils();
  const [step, setStep] = useState<"idle" | "setup" | "verify" | "done">("idle");
  const [code, setCode] = useState("");
  const [setupData, setSetupData] = useState<{ secret: string; otpauthUri: string; backupCodes: string[] } | null>(null);
  const [copiedBackup, setCopiedBackup] = useState(false);

  const { data: status, isLoading } = trpc.totp.status.useQuery();

  const setup = trpc.totp.setup.useMutation({
    onSuccess: (d) => {
      setSetupData(d);
      setStep("setup");
    },
    onError: (e) => toast.error(e.message),
  });

  const verify = trpc.totp.verify.useMutation({
    onSuccess: () => {
      toast.success("Two-factor authentication enabled");
      utils.totp.status.invalidate();
      setStep("done");
    },
    onError: (e) => toast.error(e.message),
  });

  const disable = trpc.totp.disable.useMutation({
    onSuccess: () => {
      toast.success("Two-factor authentication disabled");
      utils.totp.status.invalidate();
      setStep("idle");
      setSetupData(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const copyBackupCodes = () => {
    if (!setupData) return;
    navigator.clipboard.writeText(setupData.backupCodes.join("\n"));
    setCopiedBackup(true);
    setTimeout(() => setCopiedBackup(false), 2000);
  };

  return (
    <BISLayout>
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Two-Factor Authentication</h1>
          <p className="text-muted-foreground text-sm mt-1">Add an extra layer of security to your BIS account using an authenticator app.</p>
        </div>

        {isLoading ? (
          <div className="h-32 rounded-lg bg-muted animate-pulse" />
        ) : status?.enabled ? (
          <Card className="border-green-500/30 bg-green-500/5">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-green-500" />
                  <CardTitle className="text-base">2FA is enabled</CardTitle>
                </div>
                <Badge className="bg-green-500/20 text-green-600 border-green-500/30">Active</Badge>
              </div>
              <CardDescription>
                Enabled on {status.enabledAt ? new Date(status.enabledAt).toLocaleDateString() : "unknown date"}. Your account is protected with TOTP authentication.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => disable.mutate()}
                disabled={disable.isPending}
              >
                <ShieldOff className="h-4 w-4 mr-2" />
                Disable 2FA
              </Button>
            </CardContent>
          </Card>
        ) : step === "idle" || step === "done" ? (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">2FA is not enabled</CardTitle>
              </div>
              <CardDescription>
                Use an authenticator app (Google Authenticator, Authy, 1Password) to generate time-based one-time codes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => setup.mutate()} disabled={setup.isPending}>
                <Shield className="h-4 w-4 mr-2" />
                Enable Two-Factor Authentication
              </Button>
            </CardContent>
          </Card>
        ) : step === "setup" && setupData ? (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Step 1: Scan QR Code</CardTitle>
                <CardDescription>Open your authenticator app and scan the QR code, or enter the secret key manually.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* QR Code via Google Charts API */}
                <div className="flex justify-center">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(setupData.otpauthUri)}`}
                    alt="TOTP QR Code"
                    className="rounded-lg border p-2 bg-white"
                    width={200}
                    height={200}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Manual entry key</Label>
                  <div className="flex gap-2 mt-1">
                    <Input value={setupData.secret} readOnly className="font-mono text-sm" />
                    <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(setupData.secret); toast.success("Copied"); }}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Step 2: Save Backup Codes</CardTitle>
                <CardDescription>Store these codes somewhere safe. Each can be used once if you lose access to your authenticator.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {setupData.backupCodes.map((code, i) => (
                    <code key={i} className="text-xs font-mono bg-muted px-3 py-1.5 rounded text-center">{code}</code>
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={copyBackupCodes}>
                  {copiedBackup ? <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" /> : <Copy className="h-4 w-4 mr-2" />}
                  {copiedBackup ? "Copied!" : "Copy all backup codes"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Step 3: Verify</CardTitle>
                <CardDescription>Enter the 6-digit code from your authenticator app to confirm setup.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-3">
                  <Input
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="font-mono text-lg text-center w-36"
                    maxLength={6}
                  />
                  <Button
                    onClick={() => verify.mutate({ code })}
                    disabled={code.length !== 6 || verify.isPending}
                  >
                    <KeyRound className="h-4 w-4 mr-2" />
                    Verify & Enable
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}

        <Alert>
          <Shield className="h-4 w-4" />
          <AlertDescription className="text-xs">
            BIS uses TOTP (RFC 6238) with SHA-1, 6-digit codes, and a 30-second window. Compatible with Google Authenticator, Authy, Microsoft Authenticator, and 1Password.
          </AlertDescription>
        </Alert>
      </div>
    </BISLayout>
  );
}
