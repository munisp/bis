// Developer Portal — manage API tokens, view usage stats, API Playground, and SDK downloads.
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Copy, Key, Plus, Trash2, BarChart3, AlertTriangle, Code2, RefreshCw, Shield, Zap, Globe, Play, Download, BookOpen, Terminal, ChevronRight } from "lucide-react";

const SCOPE_GROUPS = [
  { label: "Investigations", scopes: ["investigations:read", "investigations:write"] },
  { label: "KYC", scopes: ["kyc:read", "kyc:write"] },
  { label: "Alerts", scopes: ["alerts:read", "alerts:write"] },
  { label: "Reports", scopes: ["reports:read", "reports:write"] },
  { label: "Screening", scopes: ["screening:read", "screening:write"] },
  { label: "Field Agents", scopes: ["field_agents:read", "field_agents:write"] },
  { label: "Data Sources", scopes: ["data_sources:read"] },
  { label: "Audit", scopes: ["audit:read"] },
  { label: "Admin", scopes: ["admin:read", "admin:write"] },
];

const PLAYGROUND_ACTIONS = [
  { value: "risk_score", label: "Risk Score", tokens: 8, description: "Composite risk score with contributing factors" },
  { value: "kyc_verify", label: "KYC Verify", tokens: 6, description: "Identity, sanctions, adverse media, PEP check" },
  { value: "sanctions_screen", label: "Sanctions Screen", tokens: 4, description: "Screen against 42+ global sanctions lists" },
  { value: "adverse_media", label: "Adverse Media", tokens: 5, description: "Scan 10,000+ news sources for adverse coverage" },
  { value: "create_investigation", label: "Create Investigation", tokens: 3, description: "Open a new investigation case" },
  { value: "dispatch_field_agent", label: "Dispatch Field Agent", tokens: 160, description: "Dispatch an agent for physical verification" },
  { value: "get_investigation", label: "Get Investigation", tokens: 1, description: "Retrieve investigation details by reference" },
  { value: "list_alerts", label: "List Alerts", tokens: 1, description: "List recent compliance alerts" },
  { value: "full_due_diligence", label: "Full Due Diligence", tokens: 30, description: "Complete KYC + sanctions + media + risk workflow" },
];

const EXAMPLE_PROMPTS: Record<string, string> = {
  risk_score: "What is the risk score for Amaka Okonkwo?",
  kyc_verify: "Verify the identity of Emeka Adeyemi with BVN 22345678901",
  sanctions_screen: "Screen Ngozi Eze against all available sanctions lists",
  adverse_media: "Scan for adverse media about Chukwuemeka Industries Ltd",
  create_investigation: "Open a due diligence investigation on Tunde Bakare",
  dispatch_field_agent: "Dispatch an agent to verify the address of Fatima Musa at 14 Victoria Island, Lagos",
  get_investigation: "Get the details of investigation BIS-2026-00001",
  list_alerts: "List the most recent high-severity compliance alerts",
  full_due_diligence: "Run full due diligence on Adaeze Obi, BVN 22987654321",
};

const SDK_EXAMPLES: Record<string, Record<string, string>> = {
  python: {
    risk_score: `from bis_sdk import BISClient

client = BISClient(api_token="bis_live_xxxxxxxxxxxxxxxx")

result = client.risk.score(
    "Amaka Okonkwo",
    bvn="22345678901",
    include_factors=True
)
print(f"Score: {result.score}/100 — {result.level}")
print(f"Recommendation: {result.recommendation}")`,
    full_due_diligence: `from bis_sdk import BISClient

client = BISClient(api_token="bis_live_xxxxxxxxxxxxxxxx")

report = client.full_due_diligence(
    "Amaka Okonkwo",
    bvn="22345678901",
    priority="high"
)
print(report.summary())
# Risk Score: 28/100 (LOW)
# Sanctions: Clear
# Adverse Media: Clear
# Recommendation: PROCEED`,
    kyc_verify: `from bis_sdk import BISClient

client = BISClient(api_token="bis_live_xxxxxxxxxxxxxxxx")

record = client.kyc.verify(
    subject_type="individual",
    full_name="Emeka Adeyemi",
    bvn="22345678901",
    checks=["identity", "sanctions", "adverse_media", "pep"]
)
print(f"Status: {record.status}")
print(f"Risk Score: {record.risk_score}")`,
  },
  nodejs: {
    risk_score: `import { BISClient } from '@bis/sdk';

const client = new BISClient({
  apiToken: 'bis_live_xxxxxxxxxxxxxxxx'
});

const result = await client.risk.score('Amaka Okonkwo', {
  bvn: '22345678901',
  includeFactors: true
});
console.log(\`Score: \${result.score}/100 — \${result.level}\`);`,
    full_due_diligence: `import { BISClient } from '@bis/sdk';

const client = new BISClient({
  apiToken: 'bis_live_xxxxxxxxxxxxxxxx'
});

const report = await client.fullDueDiligence('Amaka Okonkwo', {
  bvn: '22345678901',
  priority: 'high'
});
console.log(\`Risk: \${report.riskScore}/100 — \${report.riskLevel}\`);
console.log(\`Clear: \${report.isClear}\`);
console.log(\`Investigation: \${report.investigationRef}\`);`,
    kyc_verify: `import { BISClient } from '@bis/sdk';

const client = new BISClient({
  apiToken: 'bis_live_xxxxxxxxxxxxxxxx'
});

const record = await client.kyc.verify({
  subjectType: 'individual',
  fullName: 'Emeka Adeyemi',
  bvn: '22345678901'
});
console.log(\`Status: \${record.status}\`);`,
  },
  go: {
    risk_score: `package main

import (
    "context"
    "fmt"
    bis "github.com/bis-platform/bis-go/bis"
)

func main() {
    client := bis.NewClient("bis_live_xxxxxxxxxxxxxxxx", nil)
    result, err := client.Risk.Score(
        context.Background(),
        "Amaka Okonkwo", "22345678901", true,
    )
    if err != nil { panic(err) }
    fmt.Printf("Score: %d/100 — %s\\n", result.Score, result.Level)
}`,
    full_due_diligence: `package main

import (
    "context"
    "fmt"
    bis "github.com/bis-platform/bis-go/bis"
)

func main() {
    client := bis.NewClient("bis_live_xxxxxxxxxxxxxxxx", nil)
    report, err := client.FullDueDiligence(
        context.Background(),
        "Amaka Okonkwo",
        &bis.DueDiligenceOptions{BVN: "22345678901"},
    )
    if err != nil { panic(err) }
    fmt.Printf("Score: %d/100 — %s\\n", report.RiskScore, report.RiskLevel)
    fmt.Printf("Clear: %v\\n", report.IsClear)
}`,
    kyc_verify: `package main

import (
    "context"
    "fmt"
    bis "github.com/bis-platform/bis-go/bis"
)

func main() {
    client := bis.NewClient("bis_live_xxxxxxxxxxxxxxxx", nil)
    record, err := client.KYC.Verify(
        context.Background(),
        &bis.VerifyRequest{
            SubjectType: "individual",
            FullName:    "Emeka Adeyemi",
            BVN:         "22345678901",
        },
    )
    if err != nil { panic(err) }
    fmt.Printf("Status: %s\\n", record.Status)
}`,
  },
  curl: {
    risk_score: `curl -X POST https://your-domain.com/api/v1/openclaw/execute \\
  -H "Authorization: Bearer bis_live_xxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "action": "risk_score",
    "prompt": "What is the risk score for Amaka Okonkwo?"
  }'`,
    full_due_diligence: `curl -X POST https://your-domain.com/api/v1/openclaw/execute \\
  -H "Authorization: Bearer bis_live_xxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "action": "full_due_diligence",
    "prompt": "Run full due diligence on Amaka Okonkwo, BVN 22345678901"
  }'`,
    kyc_verify: `curl -X POST https://your-domain.com/api/v1/openclaw/execute \\
  -H "Authorization: Bearer bis_live_xxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "action": "kyc_verify",
    "prompt": "Verify the identity of Emeka Adeyemi with BVN 22345678901"
  }'`,
  },
};

function ScopeTag({ scope }: { scope: string }) {
  const isWrite = scope.endsWith(":write");
  return (
    <Badge variant={isWrite ? "destructive" : "secondary"} className="text-xs font-mono">
      {scope}
    </Badge>
  );
}

function TokenCard({ token, onRevoke }: { token: any; onRevoke: (id: number) => void }) {
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
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive shrink-0" onClick={() => onRevoke(token.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <code className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded font-mono">{token.prefix}...</code>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={copyPrefix}>
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {(token.scopes as string[]).slice(0, 6).map((s: string) => <ScopeTag key={s} scope={s} />)}
          {token.scopes.length > 6 && <Badge variant="outline" className="text-xs">+{token.scopes.length - 6} more</Badge>}
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
          <div><div className="font-medium text-foreground">{token.usageCount.toLocaleString()}</div><div>Total calls</div></div>
          <div><div className="font-medium text-foreground">{token.rateLimit}/min</div><div>Rate limit</div></div>
          <div><div className="font-medium text-foreground">{token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : "Never"}</div><div>Last used</div></div>
        </div>
        <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => setShowStats(!showStats)}>
          <BarChart3 className="h-3.5 w-3.5" />
          {showStats ? "Hide" : "View"} Usage Stats (30d)
        </Button>
        {showStats && stats && (
          <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div><div className="text-muted-foreground">Total requests</div><div className="font-semibold">{(stats as any).total_requests?.toLocaleString() ?? 0}</div></div>
              <div><div className="text-muted-foreground">Avg latency</div><div className="font-semibold">{Math.round((stats as any).avg_latency_ms ?? 0)}ms</div></div>
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

function CreateTokenDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["investigations:read", "kyc:read"]);
  const [rateLimit, setRateLimit] = useState(60);
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const create = trpc.apiTokens.create.useMutation({
    onSuccess: (data) => { setCreatedToken(data.plaintextToken); utils.apiTokens.list.invalidate(); },
    onError: (err) => toast.error("Failed to create token: " + err.message),
  });

  const toggleScope = (scope: string) => setScopes(prev => prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]);

  const handleCreate = () => {
    if (!name.trim()) { toast.error("Token name is required"); return; }
    create.mutate({ name: name.trim(), scopes, rateLimit });
  };

  const handleClose = () => { setName(""); setScopes(["investigations:read", "kyc:read"]); setRateLimit(60); setCreatedToken(null); onClose(); };
  const copyToken = () => { if (createdToken) { navigator.clipboard.writeText(createdToken); toast.success("Token copied to clipboard"); } };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {!createdToken ? (
          <>
            <DialogHeader>
              <DialogTitle>Create API Token</DialogTitle>
              <DialogDescription>Tokens authenticate requests to the BIS REST API. The token will be shown only once — save it securely.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Token Name</Label>
                <Input placeholder="e.g. Production Integration, CI Pipeline" value={name} onChange={e => setName(e.target.value)} className="mt-1" />
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
                            <Checkbox checked={scopes.includes(scope)} onCheckedChange={() => toggleScope(scope)} />
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
                <Slider min={10} max={1000} step={10} value={[rateLimit]} onValueChange={([v]) => setRateLimit(v)} className="mt-2" />
                <div className="flex justify-between text-xs text-muted-foreground mt-1"><span>10/min</span><span>1000/min</span></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleCreate} disabled={create.isPending}>{create.isPending ? "Creating..." : "Create Token"}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-emerald-600"><Shield className="h-5 w-5" />Token Created Successfully</DialogTitle>
              <DialogDescription>Copy this token now — it will not be shown again.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 dark:text-amber-200">Store this token in a secure secrets manager. It cannot be recovered after this dialog is closed.</p>
              </div>
              <div className="bg-muted rounded-lg p-3 font-mono text-sm break-all">{createdToken}</div>
              <Button onClick={copyToken} className="w-full gap-2"><Copy className="h-4 w-4" />Copy Token</Button>
              <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-1">
                <div className="font-medium">Usage example:</div>
                <code className="block text-muted-foreground whitespace-pre-wrap">{`curl https://your-bis-domain.com/api/v1/investigations \\\n  -H "Authorization: Bearer ${createdToken.slice(0, 30)}..."`}</code>
              </div>
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

// ── API Playground ────────────────────────────────────────────────────────────
function APIPlayground() {
  const [action, setAction] = useState("risk_score");
  const [prompt, setPrompt] = useState(EXAMPLE_PROMPTS["risk_score"]);
  const [sdkLang, setSdkLang] = useState("python");
  const [result, setResult] = useState<{ result: string; tokens_consumed: number; action: string } | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<"playground" | "sdk">("playground");

  const selectedAction = PLAYGROUND_ACTIONS.find(a => a.value === action);

  const handleActionChange = (val: string) => {
    setAction(val);
    setPrompt(EXAMPLE_PROMPTS[val] ?? "");
    setResult(null);
  };

  const runAction = async () => {
    setIsRunning(true);
    setResult(null);
    try {
      const resp = await fetch("/api/v1/openclaw/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer bis_demo_playground" },
        body: JSON.stringify({ action, prompt }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        toast.error(data.message ?? "Request failed");
      } else {
        setResult(data);
      }
    } catch (err) {
      toast.error("Network error — is the server running?");
    } finally {
      setIsRunning(false);
    }
  };

  const sdkCode = SDK_EXAMPLES[sdkLang]?.[action] ?? SDK_EXAMPLES[sdkLang]?.["risk_score"] ?? "";

  return (
    <div className="space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab("playground")}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors font-medium ${activeTab === "playground" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          <span className="flex items-center gap-1.5"><Terminal className="h-3.5 w-3.5" />Live Playground</span>
        </button>
        <button
          onClick={() => setActiveTab("sdk")}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors font-medium ${activeTab === "sdk" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          <span className="flex items-center gap-1.5"><Code2 className="h-3.5 w-3.5" />SDK Examples</span>
        </button>
      </div>

      {activeTab === "playground" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Input panel */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Play className="h-4 w-4 text-emerald-500" />
                Execute Action
              </CardTitle>
              <CardDescription>Test any BIS API action with a natural language prompt</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs mb-1.5 block">Action</Label>
                <Select value={action} onValueChange={handleActionChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLAYGROUND_ACTIONS.map(a => (
                      <SelectItem key={a.value} value={a.value}>
                        <div className="flex items-center justify-between gap-4 w-full">
                          <span>{a.label}</span>
                          <Badge variant="outline" className="text-xs font-mono ml-2">{a.tokens}T</Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedAction && (
                  <p className="text-xs text-muted-foreground mt-1.5">{selectedAction.description}</p>
                )}
              </div>

              <div>
                <Label className="text-xs mb-1.5 block">Prompt</Label>
                <Textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="Describe what you want to do..."
                  rows={3}
                  className="font-mono text-sm resize-none"
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Zap className="h-3 w-3 text-amber-500" />
                  <span>Costs <strong>{selectedAction?.tokens ?? 1} tokens</strong> per call</span>
                </div>
                <Button onClick={runAction} disabled={isRunning || !prompt.trim()} className="gap-2">
                  {isRunning ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  {isRunning ? "Running..." : "Run"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Result panel */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Terminal className="h-4 w-4 text-blue-500" />
                Result
              </CardTitle>
              {result && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-emerald-600 border-emerald-600 text-xs">200 OK</Badge>
                  <Badge variant="outline" className="text-xs font-mono">{result.tokens_consumed}T consumed</Badge>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {!result && !isRunning && (
                <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                  <Terminal className="h-8 w-8 mb-3 opacity-40" />
                  <p className="text-sm">Select an action and click Run to see the result</p>
                </div>
              )}
              {isRunning && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <RefreshCw className="h-8 w-8 mb-3 animate-spin text-blue-500" />
                  <p className="text-sm text-muted-foreground">Executing action...</p>
                </div>
              )}
              {result && !isRunning && (
                <div className="bg-muted/50 rounded-lg p-4 text-sm font-mono whitespace-pre-wrap max-h-80 overflow-y-auto leading-relaxed">
                  {result.result}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "sdk" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Code2 className="h-4 w-4 text-purple-500" />
              SDK Code Examples
            </CardTitle>
            <CardDescription>Copy-paste ready examples for Python, Node.js, and Go</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              {/* Language selector */}
              <div className="flex gap-1 bg-muted p-1 rounded-lg">
                {(["python", "nodejs", "go", "curl"] as const).map(lang => (
                  <button
                    key={lang}
                    onClick={() => setSdkLang(lang)}
                    className={`px-3 py-1 text-xs rounded-md font-mono transition-colors ${sdkLang === lang ? "bg-background shadow-sm font-semibold" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {lang === "nodejs" ? "Node.js" : lang.charAt(0).toUpperCase() + lang.slice(1)}
                  </button>
                ))}
              </div>
              {/* Action selector */}
              <Select value={action} onValueChange={handleActionChange}>
                <SelectTrigger className="w-48 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLAYGROUND_ACTIONS.map(a => (
                    <SelectItem key={a.value} value={a.value} className="text-xs">{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="relative">
              <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed max-h-72 overflow-y-auto">
                <code>{sdkCode}</code>
              </pre>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 h-7 w-7 bg-slate-800 hover:bg-slate-700 text-slate-300"
                onClick={() => { navigator.clipboard.writeText(sdkCode); toast.success("Code copied"); }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* SDK download links */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <a
                href="/api/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors text-sm group"
              >
                <BookOpen className="h-4 w-4 text-blue-500 shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium">API Reference</div>
                  <div className="text-xs text-muted-foreground">Interactive Swagger UI</div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto group-hover:translate-x-0.5 transition-transform" />
              </a>
              <div className="flex items-center gap-2 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors text-sm cursor-pointer group"
                onClick={() => { navigator.clipboard.writeText('pip install bis-sdk'); toast.success('Copied: pip install bis-sdk'); }}>
                <Download className="h-4 w-4 text-emerald-500 shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium">Python SDK</div>
                  <div className="text-xs text-muted-foreground font-mono">pip install bis-sdk</div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto group-hover:translate-x-0.5 transition-transform" />
              </div>
              <div className="flex items-center gap-2 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors text-sm cursor-pointer group"
                onClick={() => { navigator.clipboard.writeText('go get github.com/bis-platform/bis-go'); toast.success('Copied: go get github.com/bis-platform/bis-go'); }}>
                <Download className="h-4 w-4 text-cyan-500 shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium">Go SDK</div>
                  <div className="text-xs text-muted-foreground font-mono">go get bis-platform/bis-go</div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto group-hover:translate-x-0.5 transition-transform" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DeveloperPortal() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [createOpen, setCreateOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<"tokens" | "playground" | "docs">("tokens");

  const { data: tokensData, isLoading } = trpc.apiTokens.list.useQuery({ limit: 50, offset: 0 });
  void user;

  const revoke = trpc.apiTokens.revoke.useMutation({
    onSuccess: () => { utils.apiTokens.list.invalidate(); toast.success("Token revoked"); },
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
            API tokens, live playground, SDK examples, and interactive documentation.
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
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg"><Key className="h-4 w-4 text-blue-600" /></div>
              <div><div className="text-2xl font-bold">{activeTokens.length}</div><div className="text-xs text-muted-foreground">Active Tokens</div></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg"><Zap className="h-4 w-4 text-emerald-600" /></div>
              <div><div className="text-2xl font-bold">{tokens.reduce((sum, t) => sum + (t.usageCount ?? 0), 0).toLocaleString()}</div><div className="text-xs text-muted-foreground">Total API Calls</div></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg"><Globe className="h-4 w-4 text-purple-600" /></div>
              <div>
                <div className="text-2xl font-bold">{tokens.reduce((sum, t) => sum + (t.rateLimit ?? 0), 0).toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Total Rate Limit/min</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Section navigation */}
      <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
        {([
          { key: "tokens", label: "API Tokens", icon: Key },
          { key: "playground", label: "Playground", icon: Play },
          { key: "docs", label: "API Docs", icon: BookOpen },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveSection(key)}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors font-medium flex items-center gap-1.5 ${activeSection === key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tokens section */}
      {activeSection === "tokens" && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Your API Tokens</h2>
            <Button variant="ghost" size="sm" onClick={() => utils.apiTokens.list.invalidate()} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />Refresh
            </Button>
          </div>
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2].map(i => <Card key={i} className="animate-pulse"><CardContent className="h-40" /></Card>)}
            </div>
          ) : tokens.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Key className="h-10 w-10 text-muted-foreground mb-3" />
                <div className="font-medium">No API tokens yet</div>
                <div className="text-sm text-muted-foreground mt-1 mb-4">Create a token to start integrating with the BIS API.</div>
                <Button onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="h-4 w-4" />Create First Token</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {tokens.map(token => <TokenCard key={token.id} token={token} onRevoke={(id) => revoke.mutate({ id })} />)}
            </div>
          )}
        </div>
      )}

      {/* Playground section */}
      {activeSection === "playground" && <APIPlayground />}

      {/* API Docs section */}
      {activeSection === "docs" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-blue-500" />Interactive API Documentation</CardTitle>
            <CardDescription>Full OpenAPI 3.0 reference with try-it-out support for all BIS endpoints</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <a href="/api/docs" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 p-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors group">
                <BookOpen className="h-6 w-6 text-blue-600 shrink-0" />
                <div><div className="font-semibold text-blue-900 dark:text-blue-100">Swagger UI</div><div className="text-xs text-blue-700 dark:text-blue-300">Interactive browser — try any endpoint</div></div>
                <ChevronRight className="h-4 w-4 text-blue-500 ml-auto group-hover:translate-x-0.5 transition-transform" />
              </a>
              <a href="/api/docs.json" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 p-4 rounded-lg border border-border hover:bg-muted/50 transition-colors group">
                <Code2 className="h-6 w-6 text-slate-500 shrink-0" />
                <div><div className="font-semibold">OpenAPI JSON</div><div className="text-xs text-muted-foreground">Machine-readable spec for code generation</div></div>
                <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto group-hover:translate-x-0.5 transition-transform" />
              </a>
            </div>
            <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
              <div className="font-medium">Covered Endpoints</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs text-muted-foreground font-mono">
                {["/investigations", "/kyc", "/alerts", "/field-agents", "/screening/sanctions", "/screening/adverse-media", "/screening/risk-score", "/reports", "/data-sources", "/monitors", "/audit-log", "/tenants", "/users", "/alert-rules", "/openclaw/execute"].map(ep => (
                  <div key={ep} className="flex items-center gap-1"><ChevronRight className="h-3 w-3 shrink-0" />{ep}</div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <CreateTokenDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
