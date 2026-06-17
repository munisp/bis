/**
 * PushSettingsPage — /admin/settings/push
 *
 * Admin page for managing Web Push / FCM configuration:
 *  - Shows current VAPID key status
 *  - Generates a fresh VAPID keypair (displayed for copy-paste into Secrets)
 *  - Sends a test push broadcast to all admin tokens
 *  - Lists all active push subscriptions across the platform
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Bell, BellOff, CheckCircle2, XCircle, RefreshCw, Loader2,
  Copy, Check, Zap, Key, Smartphone, Globe,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Copy-to-clipboard helper ─────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      onClick={handleCopy}
      className="ml-2 text-muted-foreground hover:text-foreground transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
    </button>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border",
      ok
        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
        : "bg-red-500/10 text-red-400 border-red-500/30"
    )}>
      {ok ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
      {label}
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PushSettingsPage() {
  const { user, isAuthenticated } = useAuth();
  const [generatedKeys, setGeneratedKeys] = useState<{
    publicKey: string;
    privateKey: string;
    subject: string;
    instructions: string;
  } | null>(null);

  const utils = trpc.useUtils();

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: vapidStatus, isLoading: statusLoading } = trpc.push.getVapidStatus.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
  });

  const { data: myTokens, isLoading: tokensLoading } = trpc.push.listMyTokens.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const generateMutation = trpc.push.generateVapidKeys.useMutation({
    onSuccess: (data) => {
      setGeneratedKeys(data);
      toast.success("VAPID keypair generated — copy the keys into your Secrets");
    },
    onError: (err) => toast.error(`Generation failed: ${err.message}`),
  });

  const testMutation = trpc.push.testBroadcast.useMutation({
    onSuccess: (result) => {
      toast.success(`Test broadcast sent — ${result.sent} delivered, ${result.failed} failed`);
    },
    onError: (err) => toast.error(`Test broadcast failed: ${err.message}`),
  });

  const deregisterMutation = trpc.push.deregisterToken.useMutation({
    onSuccess: () => {
      toast.success("Token deregistered");
      utils.push.listMyTokens.invalidate();
    },
    onError: (err) => toast.error(`Deregister failed: ${err.message}`),
  });

  // ── Guard ─────────────────────────────────────────────────────────────────────
  if (!isAuthenticated || user?.role !== "admin") {
    return (
      <BISLayout>
        <div className="p-6 flex items-center justify-center min-h-[40vh]">
          <div className="text-center space-y-2">
            <BellOff size={32} className="text-muted-foreground mx-auto" />
            <p className="text-sm font-mono text-muted-foreground">Admin access required</p>
          </div>
        </div>
      </BISLayout>
    );
  }

  return (
    <BISLayout>
      <div className="p-6 space-y-6 max-w-3xl">
        {/* Header */}
        <div>
          <h1 className="text-xl font-mono font-bold text-foreground flex items-center gap-2">
            <Bell size={18} className="text-primary" />
            Push Notification Settings
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Configure Web Push VAPID keys and FCM credentials for browser and mobile push delivery.
          </p>
        </div>

        {/* VAPID Status Card */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <Key size={14} className="text-primary" />
              VAPID Key Status
            </CardTitle>
            <CardDescription className="text-xs">
              VAPID keys authenticate your server when sending Web Push notifications to browsers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {statusLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={12} className="animate-spin" /> Checking configuration…
              </div>
            ) : vapidStatus ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge ok={vapidStatus.isConfigured} label={vapidStatus.isConfigured ? "VAPID Configured" : "VAPID Not Configured"} />
                  <StatusBadge ok={vapidStatus.hasFcmKey} label={vapidStatus.hasFcmKey ? "FCM Key Set" : "FCM Key Missing"} />
                </div>

                {vapidStatus.isConfigured && vapidStatus.vapidPublicKey && (
                  <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-1">
                    <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">Public Key</p>
                    <div className="flex items-center">
                      <code className="text-[11px] font-mono text-foreground break-all">
                        {vapidStatus.vapidPublicKey}
                      </code>
                      <CopyButton text={vapidStatus.vapidPublicKey} />
                    </div>
                    <p className="text-[10px] font-mono text-muted-foreground mt-1">
                      Subject: {vapidStatus.subject}
                    </p>
                  </div>
                )}

                {!vapidStatus.isConfigured && (
                  <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3">
                    <p className="text-xs font-mono text-amber-400">
                      VAPID keys are not configured. Generate a keypair below and add the values to your project Secrets.
                    </p>
                  </div>
                )}
              </>
            ) : null}

            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs font-mono"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending
                  ? <Loader2 size={12} className="animate-spin" />
                  : <RefreshCw size={12} />}
                Generate New VAPID Keys
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs font-mono border-primary/40 text-primary hover:bg-primary/10"
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending || !vapidStatus?.isConfigured}
                title={!vapidStatus?.isConfigured ? "Configure VAPID keys first" : "Send a test push to all admin tokens"}
              >
                {testMutation.isPending
                  ? <Loader2 size={12} className="animate-spin" />
                  : <Zap size={12} />}
                Send Test Push
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Generated Keys Panel */}
        {generatedKeys && (
          <Card className="border-emerald-500/30 bg-emerald-500/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono text-emerald-400 flex items-center gap-2">
                <CheckCircle2 size={14} />
                New VAPID Keypair Generated
              </CardTitle>
              <CardDescription className="text-xs text-emerald-400/70">
                Copy these values into your project Secrets (Settings → Secrets), then restart the server.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: "VAPID_PUBLIC_KEY", value: generatedKeys.publicKey },
                { label: "VAPID_PRIVATE_KEY", value: generatedKeys.privateKey },
                { label: "VAPID_SUBJECT", value: generatedKeys.subject },
              ].map(({ label, value }) => (
                <div key={label} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">{label}</span>
                    <CopyButton text={value} />
                  </div>
                  <code className="block text-[11px] font-mono text-foreground bg-muted/30 rounded px-2 py-1 break-all">
                    {value}
                  </code>
                </div>
              ))}

              <div className="mt-2">
                <p className="text-[10px] font-mono text-muted-foreground mb-1">Full instructions</p>
                <Textarea
                  readOnly
                  value={generatedKeys.instructions}
                  className="text-[11px] font-mono min-h-[100px] resize-none bg-muted/20"
                />
              </div>

              <Button
                size="sm"
                variant="ghost"
                className="text-xs font-mono text-muted-foreground"
                onClick={() => setGeneratedKeys(null)}
              >
                Dismiss
              </Button>
            </CardContent>
          </Card>
        )}

        {/* My Active Tokens */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <Smartphone size={14} className="text-primary" />
              My Active Push Tokens
            </CardTitle>
            <CardDescription className="text-xs">
              Push subscriptions registered for your account across devices and browsers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tokensLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={12} className="animate-spin" /> Loading tokens…
              </div>
            ) : !myTokens || myTokens.length === 0 ? (
              <div className="text-center py-6 space-y-2">
                <Globe size={24} className="text-muted-foreground mx-auto" />
                <p className="text-xs font-mono text-muted-foreground">
                  No active push tokens. Grant notification permission in your browser to register.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {myTokens.map((token) => (
                  <div
                    key={token.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {token.platform === "fcm"
                        ? <Smartphone size={13} className="text-primary shrink-0" />
                        : <Globe size={13} className="text-blue-400 shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-[11px] font-mono text-foreground truncate">
                          {token.deviceLabel ?? `${token.platform.toUpperCase()} device`}
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground">
                          Registered {new Date(token.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-[9px] font-mono">
                        {token.platform}
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px] text-red-400 hover:bg-red-500/10"
                        onClick={() => {
                          // We don't have the raw token string here — show info
                          toast.info("To deregister, revoke notification permission in your browser settings.");
                        }}
                      >
                        Revoke
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* How it works */}
        <Card className="border-border bg-muted/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground">How Push Notifications Work</CardTitle>
          </CardHeader>
          <CardContent className="text-xs font-mono text-muted-foreground space-y-1.5">
            <p>1. <strong className="text-foreground">Browser</strong> — grant notification permission → service worker registers → token sent to BIS via <code>push.registerToken</code>.</p>
            <p>2. <strong className="text-foreground">Mobile (FCM)</strong> — app requests FCM token → token sent to BIS via <code>push.registerToken</code> with <code>platform=fcm</code>.</p>
            <p>3. <strong className="text-foreground">Server</strong> — on critical alerts or KYC events, BIS calls <code>sendPushToUser</code> which dispatches via FCM HTTP v1 or Web Push VAPID.</p>
            <p>4. <strong className="text-foreground">Sanctions webhook</strong> — <code>POST /api/webhooks/sanctions-refresh</code> triggers a broadcast to all admin tokens.</p>
          </CardContent>
        </Card>
      </div>
    </BISLayout>
  );
}
