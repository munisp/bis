// client/src/pages/DeveloperPortal.tsx
// Developer Portal — manage API tokens, view usage stats, and access API docs.
// Accessible to all authenticated users; admin users see platform-wide stats.

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { Copy, Key, Plus, Trash2, BarChart3, AlertTriangle, Code2, RefreshCw, Shield, Zap, Globe } from "lucide-react";

const SCOPE_GROUPS = [
  {
    label: "Investigations",
    scopes: ["investigations:read", "investigations:write"],
  },
  {
    label: "KYC",
    scopes: ["kyc:read", "kyc:write"],
  },
  {
    label: "Alerts",
    scopes: ["alerts:read", "alerts:write"],
  },
  {
    label: "Reports",
    scopes: ["reports:read", "reports:write"],
  },
  {
    label: "Screening",
    scopes: ["screening:read", "screening:write"],
  },
  {
    label: "Field Agents",
    scopes: ["field_agents:read", "field_agents:write"],
  },
  {
    label: "Data Sources",
    scopes: ["data_sources:read"],
  },
  {
    label: "Audit",
    scopes: ["audit:read"],
  },
  {
    label: "Admin",
    scopes: ["admin:read", "admin:write"],
  },
];

function ScopeTag({ scope }: { scope: string }) {
  const isWrite = scope.endsWith(":write");
  return (
    <Badge
      variant={isWrite ? "destructive" : "secondary"}
      className="text-xs font-mono"
    >
      {scope}
    </Badge>
  );
}

function TokenCard({
  token,
  onRevoke,
}: {
  token: any;
  onRevoke: (id: number) => void;
}) {
  const [showStats, setShowStats] = useState(false);
  const { data: stats } = trpc.apiTokens.usageStats.useQuery(
    { tokenId: token.id, days: 30 },
    { enabled: showStats }
  );

  const copyPrefix = () => {
    navigator.clipboard.writeText(token.prefix + "_...");
      toast.success("Copied token prefix");
  };

  const isExpired = token.expiresAt && new Date(token.expiresAt) < new Date();

  return (
    <Card className={`border ${!token.active || isExpired ? "opacity-60 border-dashed" : "border-border"}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Key className="h-4 w-4 text-amber-500 shrink-0" />
            <span className="font-semibold truncate">{token.name}</span>
            {!token.active && <Badge variant="destructive">Revoked</Badge>}
            {isExpired && token.active && <Badge variant="outline" className="text-orange-500 border-orange-500">Expired</Badge>}
            {token.active && !isExpired && <Badge variant="outline" className="text-emerald-500 border-emerald-500">Active</Badge>}
          </div>
          {token.active && !isExpired && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
              onClick={() => onRevoke(token.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <code className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded font-mono">
            {token.prefix}...
          </code>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={copyPrefix}>
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {(token.scopes as string[]).slice(0, 6).map((s: string) => (
            <ScopeTag key={s} scope={s} />
          ))}
          {token.scopes.length > 6 && (
            <Badge variant="outline" className="text-xs">+{token.scopes.length - 6} more</Badge>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
          <div>
            <div className="font-medium text-foreground">{token.usageCount.toLocaleString()}</div>
            <div>Total calls</div>
          </div>
          <div>
            <div className="font-medium text-foreground">{token.rateLimit}/min</div>
            <div>Rate limit</div>
          </div>
          <div>
            <div className="font-medium text-foreground">
              {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : "Never"}
            </div>
            <div>Last used</div>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={() => setShowStats(!showStats)}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          {showStats ? "Hide" : "View"} Usage Stats (30d)
        </Button>

        {showStats && stats && (
          <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-muted-foreground">Total requests</div>
                <div className="font-semibold">{(stats as any).total_requests?.toLocaleString() ?? 0}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Avg latency</div>
                <div className="font-semibold">{Math.round((stats as any).avg_latency_ms ?? 0)}ms</div>
              </div>
            </div>
            {(stats as any).top_endpoints?.slice(0, 3).map((ep: any, i: number) => (
              <div key={i} className="flex justify-between items-center">
                <code className="text-muted-foreground truncate max-w-[60%]">{ep.endpoint}</code>
                <span className="font-medium">{ep.count?.toLocaleString?.() ?? ep.cnt?.toLocaleString?.() ?? 0}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CreateTokenDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["investigations:read", "kyc:read"]);
  const [rateLimit, setRateLimit] = useState(60);
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const create = trpc.apiTokens.create.useMutation({
    onSuccess: (data) => {
      setCreatedToken(data.plaintextToken);
      utils.apiTokens.list.invalidate();
    },
    onError: (err) => toast.error("Failed to create token: " + err.message),
  });

  const toggleScope = (scope: string) => {
    setScopes(prev =>
      prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]
    );
  };

  const handleCreate = () => {
    if (!name.trim()) {
      toast.error("Token name is required");
      return;
    }
    create.mutate({ name: name.trim(), scopes, rateLimit });
  };

  const handleClose = () => {
    setName("");
    setScopes(["investigations:read", "kyc:read"]);
    setRateLimit(60);
    setCreatedToken(null);
    onClose();
  };

  const copyToken = () => {
    if (createdToken) {
      navigator.clipboard.writeText(createdToken);
      toast.success("Token copied to clipboard");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {!createdToken ? (
          <>
            <DialogHeader>
              <DialogTitle>Create API Token</DialogTitle>
              <DialogDescription>
                Tokens are used to authenticate requests to the BIS REST API.
                The token will be shown only once — save it securely.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label>Token Name</Label>
                <Input
                  placeholder="e.g. Production Integration, CI Pipeline"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="mt-1"
                />
              </div>

              <div>
                <Label className="mb-2 block">Scopes</Label>
                <div className="space-y-3">
                  {SCOPE_GROUPS.map(group => (
                    <div key={group.label}>
                      <div className="text-xs font-medium text-muted-foreground mb-1">{group.label}</div>
                      <div className="flex flex-wrap gap-2">
                        {group.scopes.map(scope => (
                          <label key={scope} className="flex items-center gap-1.5 cursor-pointer">
                            <Checkbox
                              checked={scopes.includes(scope)}
                              onCheckedChange={() => toggleScope(scope)}
                            />
                            <span className="text-xs font-mono">{scope}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Label>Rate Limit: {rateLimit} requests/minute</Label>
                <Slider
                  min={10}
                  max={1000}
                  step={10}
                  value={[rateLimit]}
                  onValueChange={([v]) => setRateLimit(v)}
                  className="mt-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>10/min</span>
                  <span>1,000/min</span>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleCreate} disabled={create.isPending}>
                {create.isPending ? "Creating..." : "Create Token"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-emerald-600">
                <Shield className="h-5 w-5" />
                Token Created Successfully
              </DialogTitle>
              <DialogDescription>
                Copy and store this token securely. It will <strong>not</strong> be shown again.
              </DialogDescription>
            </DialogHeader>

            <div className="bg-muted rounded-lg p-3 space-y-2">
              <div className="text-xs text-muted-foreground font-medium">Your API Token</div>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono break-all flex-1 text-foreground">
                  {createdToken}
                </code>
                <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={copyToken}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-200">
              <AlertTriangle className="h-3.5 w-3.5 inline mr-1" />
              Store this token in your environment variables or secrets manager.
              Never commit it to source control.
            </div>

            <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-1">
              <div className="font-medium">Usage example:</div>
              <code className="block text-muted-foreground whitespace-pre-wrap">
                {`curl https://your-bis-domain.com/api/v1/investigations \\
  -H "Authorization: Bearer ${createdToken.slice(0, 30)}..."`}
              </code>
            </div>

            <DialogFooter>
              <Button onClick={handleClose} className="w-full">Done — I've saved my token</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function DeveloperPortal() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: tokensData, isLoading } = trpc.apiTokens.list.useQuery({ limit: 50, offset: 0 });
  void user; // accessed via useAuth for future role-gating

  const revoke = trpc.apiTokens.revoke.useMutation({
    onSuccess: () => {
      utils.apiTokens.list.invalidate();
      toast.success("Token revoked");
    },
    onError: (err) => toast.error("Failed to revoke token: " + err.message),
  });

  const tokens = tokensData?.items ?? [];
  const activeTokens = tokens.filter(t => t.active);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Developer Portal</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Manage API tokens for third-party integrations and developer access.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New Token
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <Key className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">{activeTokens.length}</div>
                <div className="text-xs text-muted-foreground">Active Tokens</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                <Zap className="h-4 w-4 text-emerald-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {tokens.reduce((sum, t) => sum + (t.usageCount ?? 0), 0).toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground">Total API Calls</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                <Globe className="h-4 w-4 text-purple-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {tokens.reduce((sum, t) => sum + (t.rateLimit ?? 0), 0).toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground">Total Rate Limit/min</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* API Reference quick links */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Code2 className="h-4 w-4" />
            Quick Start
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="bg-muted/50 rounded-lg p-3 font-mono text-xs space-y-1">
              <div className="text-muted-foreground"># Authentication</div>
              <div>Authorization: Bearer &lt;token&gt;</div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 font-mono text-xs space-y-1">
              <div className="text-muted-foreground"># Base URL</div>
              <div>https://your-domain.com/api/v1</div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 font-mono text-xs space-y-1">
              <div className="text-muted-foreground"># List investigations</div>
              <div>GET /api/v1/investigations</div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 font-mono text-xs space-y-1">
              <div className="text-muted-foreground"># Run KYC check</div>
              <div>POST /api/v1/kyc</div>
            </div>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            Rate limit headers: <code className="bg-muted px-1 rounded">X-RateLimit-Limit</code>,{" "}
            <code className="bg-muted px-1 rounded">Retry-After</code>.
            HTTP 429 is returned when the limit is exceeded.
          </div>
        </CardContent>
      </Card>

      {/* Token list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Your API Tokens</h2>
          <Button variant="ghost" size="sm" onClick={() => utils.apiTokens.list.invalidate()} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2].map(i => (
              <Card key={i} className="animate-pulse">
                <CardContent className="h-40" />
              </Card>
            ))}
          </div>
        ) : tokens.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Key className="h-10 w-10 text-muted-foreground mb-3" />
              <div className="font-medium">No API tokens yet</div>
              <div className="text-sm text-muted-foreground mt-1 mb-4">
                Create a token to start integrating with the BIS API.
              </div>
              <Button onClick={() => setCreateOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Create First Token
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tokens.map(token => (
              <TokenCard
                key={token.id}
                token={token}
                onRevoke={(id) => revoke.mutate({ id })}
              />
            ))}
          </div>
        )}
      </div>

      <CreateTokenDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
