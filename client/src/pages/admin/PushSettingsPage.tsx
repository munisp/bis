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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Bell, BellOff, CheckCircle2, XCircle, RefreshCw, Loader2,
  Copy, Check, Zap, Key, Smartphone, Globe, Send, History, ChevronLeft, ChevronRight,
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

  // Broadcast form state
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastBody, setBroadcastBody] = useState("");
  const [broadcastUrl, setBroadcastUrl] = useState("");
  const [broadcastTag, setBroadcastTag] = useState("");

  // Broadcast history pagination + tag filter
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyTagFilter, setHistoryTagFilter] = useState("");
  const HISTORY_PAGE_SIZE = 10;

  const BROADCAST_TAGS = ["maintenance", "compliance", "alert", "update", "security"];

  const utils = trpc.useUtils();

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: vapidStatus, isLoading: statusLoading } = trpc.push.getVapidStatus.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
  });

  const { data: myTokens, isLoading: tokensLoading } = trpc.push.listMyTokens.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const { data: broadcastHistory, isLoading: historyLoading } = trpc.push.listBroadcasts.useQuery(
    { limit: HISTORY_PAGE_SIZE, offset: historyOffset, tagFilter: historyTagFilter || undefined },
    { enabled: isAuthenticated && user?.role === "admin" }
  );

  const { data: subStats, isLoading: statsLoading } = trpc.push.getSubscriptionStats.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
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

  const broadcastMutation = trpc.push.broadcastToAll.useMutation({
    onSuccess: (result) => {
      toast.success(`Broadcast sent — ${result.sent} delivered, ${result.failed} failed`);
      setBroadcastTitle("");
      setBroadcastBody("");
      setBroadcastUrl("");
      setBroadcastTag("");
      utils.push.listBroadcasts.invalidate();
    },
    onError: (err) => toast.error(`Broadcast failed: ${err.message}`),
  });

  function handleBroadcast() {
    if (!broadcastTitle.trim() || !broadcastBody.trim()) {
      toast.error("Title and body are required");
      return;
    }
    broadcastMutation.mutate({
      title: broadcastTitle.trim(),
      body: broadcastBody.trim(),
      url: broadcastUrl.trim() || undefined,
      tag: broadcastTag.trim() || undefined,
    });
  }

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

        {/* Subscription Analytics */}
        {user?.role === "admin" && (
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono flex items-center gap-2">
                <Zap size={14} className="text-primary" />
                Subscription Analytics
              </CardTitle>
              <CardDescription className="text-xs">
                Active push subscriptions by platform and 30-day registration trend.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 size={12} className="animate-spin" /> Loading stats…
                </div>
              ) : !subStats ? (
                <p className="text-xs font-mono text-muted-foreground">No data available.</p>
              ) : (
                <div className="space-y-4">
                  {/* Total + platform breakdown */}
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex flex-col">
                      <span className="text-2xl font-mono font-bold text-foreground">{subStats.total}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">total active</span>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {subStats.byPlatform.map((p) => (
                        <div key={p.platform} className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/10 px-3 py-1.5">
                          {p.platform === "fcm"
                            ? <Smartphone size={12} className="text-primary" />
                            : <Globe size={12} className="text-blue-400" />}
                          <span className="text-[11px] font-mono text-foreground">{p.count}</span>
                          <span className="text-[10px] font-mono text-muted-foreground">{p.platform}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* 30-day registration sparkline (text-based bar chart) */}
                  {subStats.recentRegistrations.length > 0 && (
                    <div>
                      <p className="text-[10px] font-mono text-muted-foreground mb-1.5">Registrations — last 30 days</p>
                      <div className="flex items-end gap-0.5 h-12">
                        {(() => {
                          const max = Math.max(...subStats.recentRegistrations.map(r => r.count), 1);
                          return subStats.recentRegistrations.map((r) => (
                            <div
                              key={r.date}
                              title={`${r.date}: ${r.count}`}
                              className="flex-1 bg-primary/40 rounded-sm min-h-[2px] hover:bg-primary/70 transition-colors"
                              style={{ height: `${Math.max(4, (r.count / max) * 48)}px` }}
                            />
                          ));
                        })()}
                      </div>
                    </div>
                  )}
                  {/* Top browsers */}
                  {subStats.byBrowser.length > 0 && (
                    <div>
                      <p className="text-[10px] font-mono text-muted-foreground mb-1.5">Top devices/browsers</p>
                      <div className="space-y-1">
                        {subStats.byBrowser.slice(0, 5).map((b) => (
                          <div key={b.label} className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-foreground truncate flex-1" title={b.label}>
                              {b.label}
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground">{b.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Broadcast History */}
        {user?.role === "admin" && (
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono flex items-center gap-2">
                <History size={14} className="text-primary" />
                Broadcast History
              </CardTitle>
              <CardDescription className="text-xs">
                Audit log of all platform-wide push broadcasts sent from this page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Tag filter chips */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => { setHistoryTagFilter(""); setHistoryOffset(0); }}
                  className={cn(
                    "text-[10px] font-mono px-2 py-0.5 rounded-full border transition-colors",
                    !historyTagFilter
                      ? "bg-primary/20 text-primary border-primary/40"
                      : "border-border text-muted-foreground hover:border-primary/30"
                  )}
                >
                  All
                </button>
                {BROADCAST_TAGS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setHistoryTagFilter(historyTagFilter === t ? "" : t); setHistoryOffset(0); }}
                    className={cn(
                      "text-[10px] font-mono px-2 py-0.5 rounded-full border transition-colors",
                      historyTagFilter === t
                        ? "bg-primary/20 text-primary border-primary/40"
                        : "border-border text-muted-foreground hover:border-primary/30"
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {historyLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 size={12} className="animate-spin" /> Loading history…
                </div>
              ) : !broadcastHistory || broadcastHistory.items.length === 0 ? (
                <div className="text-center py-6">
                  <History size={24} className="text-muted-foreground mx-auto mb-2" />
                  <p className="text-xs font-mono text-muted-foreground">No broadcasts sent yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px] font-mono">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          <th className="text-left pb-2 pr-3">Title</th>
                          <th className="text-left pb-2 pr-3">Body</th>
                          <th className="text-left pb-2 pr-3">Tag</th>
                          <th className="text-right pb-2 pr-3">Sent</th>
                          <th className="text-right pb-2 pr-3">Failed</th>
                          <th className="text-right pb-2">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {broadcastHistory.items.map((bc) => (
                          <tr key={bc.id} className="border-b border-border/40 hover:bg-muted/10">
                            <td className="py-1.5 pr-3 max-w-[120px] truncate" title={bc.title}>{bc.title}</td>
                            <td className="py-1.5 pr-3 max-w-[160px] truncate text-muted-foreground" title={bc.body}>{bc.body}</td>
                            <td className="py-1.5 pr-3">
                              {bc.tag && (
                                <span className="inline-flex text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                                  {bc.tag}
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 pr-3 text-right text-emerald-400">{bc.sentCount}</td>
                            <td className="py-1.5 pr-3 text-right text-red-400">{bc.failedCount}</td>
                            <td className="py-1.5 text-right text-muted-foreground whitespace-nowrap">
                              {new Date(bc.sentAt).toLocaleDateString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Pagination */}
                  {broadcastHistory.total > HISTORY_PAGE_SIZE && (
                    <div className="flex items-center justify-between pt-2">
                      <span className="text-[9px] font-mono text-muted-foreground">
                        {historyOffset + 1}–{Math.min(historyOffset + HISTORY_PAGE_SIZE, broadcastHistory.total)} of {broadcastHistory.total}
                      </span>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2"
                          disabled={historyOffset === 0}
                          onClick={() => setHistoryOffset(Math.max(0, historyOffset - HISTORY_PAGE_SIZE))}
                        >
                          <ChevronLeft size={12} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2"
                          disabled={historyOffset + HISTORY_PAGE_SIZE >= broadcastHistory.total}
                          onClick={() => setHistoryOffset(historyOffset + HISTORY_PAGE_SIZE)}
                        >
                          <ChevronRight size={12} />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Send Broadcast */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <Send size={14} className="text-primary" />
              Send Platform Broadcast
            </CardTitle>
            <CardDescription className="text-xs">
              Push an ad-hoc notification to all active push subscriptions across the platform.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">Title *</Label>
              <Input
                value={broadcastTitle}
                onChange={(e) => setBroadcastTitle(e.target.value)}
                placeholder="e.g. Platform maintenance in 30 minutes"
                className="text-xs font-mono h-8"
                maxLength={80}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">Body *</Label>
              <Textarea
                value={broadcastBody}
                onChange={(e) => setBroadcastBody(e.target.value)}
                placeholder="Notification message body…"
                className="text-xs font-mono min-h-[70px] resize-none"
                maxLength={200}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">Action URL (optional)</Label>
              <Input
                value={broadcastUrl}
                onChange={(e) => setBroadcastUrl(e.target.value)}
                placeholder="https://… or /dashboard"
                className="text-xs font-mono h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">Tag (optional)</Label>
              <div className="flex flex-wrap gap-1.5">
                {BROADCAST_TAGS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setBroadcastTag(broadcastTag === t ? "" : t)}
                    className={cn(
                      "text-[10px] font-mono px-2 py-0.5 rounded-full border transition-colors",
                      broadcastTag === t
                        ? "bg-primary/20 text-primary border-primary/40"
                        : "border-border text-muted-foreground hover:border-primary/30"
                    )}
                  >
                    {t}
                  </button>
                ))}
                <Input
                  value={BROADCAST_TAGS.includes(broadcastTag) ? "" : broadcastTag}
                  onChange={(e) => setBroadcastTag(e.target.value)}
                  placeholder="custom tag…"
                  className="text-[10px] font-mono h-6 w-28 px-2"
                  maxLength={32}
                />
              </div>
            </div>
            <Button
              size="sm"
              className="gap-1.5 text-xs font-mono"
              onClick={handleBroadcast}
              disabled={broadcastMutation.isPending || !broadcastTitle.trim() || !broadcastBody.trim()}
            >
              {broadcastMutation.isPending
                ? <Loader2 size={12} className="animate-spin" />
                : <Send size={12} />}
              Send Broadcast
            </Button>
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
