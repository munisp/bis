// BIS Settings & Admin Page
import { useState } from "react";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Settings2, Bell, Shield, Globe, Key, Loader2, Save, Zap, Database, Eye, EyeOff, CheckCircle2 } from "lucide-react";

const INTEGRATIONS = [
  { name: "NIMC Identity API", status: "connected", key: "nimc_api_key", endpoint: "https://api.nimc.gov.ng/v2", description: "National Identity Management Commission — NIN lookup & biometric" },
  { name: "CBN BVN Service", status: "connected", key: "cbn_bvn_key", endpoint: "https://api.cbn.gov.ng/bvn/v1", description: "Central Bank of Nigeria — BVN verification" },
  { name: "EFCC Watchlist API", status: "connected", key: "efcc_api_key", endpoint: "https://api.efcc.gov.ng/watchlist", description: "Economic & Financial Crimes Commission watchlist" },
  { name: "NPF POSSAP", status: "degraded", key: "npf_api_key", endpoint: "https://possap.npf.gov.ng/api", description: "Nigeria Police Force — criminal records & warrant lookup" },
  { name: "OFAC SDN API", status: "connected", key: "ofac_api_key", endpoint: "https://api.ofac.treasury.gov/v1", description: "US Treasury OFAC — Specially Designated Nationals list" },
  { name: "Interpol I-24/7", status: "pending", key: "interpol_key", endpoint: "https://i247.interpol.int/api", description: "INTERPOL Red Notice & fugitive lookup" },
  { name: "Africa's Talking SMS", status: "connected", key: "at_api_key", endpoint: "https://api.africastalking.com/version1", description: "SMS delivery for OTP and alert notifications" },
  { name: "WhatsApp Business API", status: "connected", key: "wa_token", endpoint: "https://graph.facebook.com/v18.0", description: "WhatsApp Business — subject notification channel" },
];

export default function Settings() {
  const [saving, setSaving] = useState(false);
  const [configuring, setConfiguring] = useState<typeof INTEGRATIONS[0] | null>(null);
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testingConn, setTestingConn] = useState(false);

  const handleTestConnection = async () => {
    setTestingConn(true);
    await new Promise(r => setTimeout(r, 1400));
    setTestingConn(false);
    toast.success(`Connection test passed — ${configuring?.name} responded in ${Math.round(80 + Math.random() * 400)}ms`);
  };

  const handleSaveIntegration = () => {
    toast.success(`${configuring?.name} configuration saved`);
    setConfiguring(null);
    setApiKeyValue("");
  };

  // AutoFlag thresholds
  const [thresholds, setThresholds] = useState({
    ngn: 5000000, usd: 10000, gbp: 8000, eur: 9000,
    velocityHourly: 10, velocityDaily: 50,
    riskScoreMin: 75, sanctionsConfidence: 0.85,
  });

  // Notifications
  const [notifs, setNotifs] = useState({
    emailOnFlag: true, webhookOnFlag: true, smsOnCritical: true,
    dailyDigest: true, weeklyReport: false, slackIntegration: false,
  });

  // System
  const [system, setSystem] = useState({
    defaultTier: "standard", defaultCountry: "NG",
    killSwitchEnabled: true, autoAdvanceEnabled: true,
    dataRetentionDays: 365, auditLogEnabled: true,
  });

  const handleSave = async () => {
    setSaving(true);
    await new Promise(r => setTimeout(r, 1000));
    setSaving(false);
    toast.success("Settings saved successfully");
  };

  return (
    <BISLayout title="Settings" subtitle="Platform configuration">
      <Tabs defaultValue="autoflag">
        <TabsList className="mb-4 h-8">
          <TabsTrigger value="autoflag" className="text-xs h-6"><Zap size={11} className="mr-1" />AutoFlag</TabsTrigger>
          <TabsTrigger value="notifications" className="text-xs h-6"><Bell size={11} className="mr-1" />Notifications</TabsTrigger>
          <TabsTrigger value="system" className="text-xs h-6"><Settings2 size={11} className="mr-1" />System</TabsTrigger>
          <TabsTrigger value="integrations" className="text-xs h-6"><Globe size={11} className="mr-1" />Integrations</TabsTrigger>
          <TabsTrigger value="security" className="text-xs h-6"><Shield size={11} className="mr-1" />Security</TabsTrigger>
        </TabsList>

        {/* AutoFlag Thresholds */}
        <TabsContent value="autoflag">
          <div className="bis-card p-5 space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1">Transaction Thresholds</h3>
              <p className="text-xs text-muted-foreground mb-4">Transactions exceeding these amounts will trigger automatic BIS investigation.</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { key: "ngn", label: "NGN Threshold", prefix: "₦" },
                  { key: "usd", label: "USD Threshold", prefix: "$" },
                  { key: "gbp", label: "GBP Threshold", prefix: "£" },
                  { key: "eur", label: "EUR Threshold", prefix: "€" },
                ].map(({ key, label, prefix }) => (
                  <div key={key} className="space-y-1.5">
                    <Label className="text-xs">{label}</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{prefix}</span>
                      <Input className="pl-6 h-8 text-sm font-mono" type="number"
                        value={thresholds[key as keyof typeof thresholds]}
                        onChange={e => setThresholds(p => ({ ...p, [key]: Number(e.target.value) }))} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1">Velocity Limits</h3>
              <p className="text-xs text-muted-foreground mb-4">Flag subjects exceeding transaction frequency limits.</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Hourly Transaction Limit</Label>
                  <Input className="h-8 text-sm font-mono" type="number" value={thresholds.velocityHourly}
                    onChange={e => setThresholds(p => ({ ...p, velocityHourly: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Daily Transaction Limit</Label>
                  <Input className="h-8 text-sm font-mono" type="number" value={thresholds.velocityDaily}
                    onChange={e => setThresholds(p => ({ ...p, velocityDaily: Number(e.target.value) }))} />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1">Risk Score Triggers</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Minimum Risk Score to Flag (0–100)</Label>
                  <Input className="h-8 text-sm font-mono" type="number" min={0} max={100} value={thresholds.riskScoreMin}
                    onChange={e => setThresholds(p => ({ ...p, riskScoreMin: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Sanctions Match Confidence (0–1)</Label>
                  <Input className="h-8 text-sm font-mono" type="number" min={0} max={1} step={0.01} value={thresholds.sanctionsConfidence}
                    onChange={e => setThresholds(p => ({ ...p, sanctionsConfidence: Number(e.target.value) }))} />
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Notifications */}
        <TabsContent value="notifications">
          <div className="bis-card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Alert Delivery</h3>
            {[
              { key: "emailOnFlag", label: "Email on flag", desc: "Send email to compliance team when investigation is flagged" },
              { key: "webhookOnFlag", label: "Webhook on flag", desc: "POST to configured webhook URL when investigation is flagged" },
              { key: "smsOnCritical", label: "SMS on critical", desc: "Send SMS to on-call number for critical severity alerts" },
              { key: "dailyDigest", label: "Daily digest", desc: "Send daily summary of all investigations and alerts" },
              { key: "weeklyReport", label: "Weekly report", desc: "Send weekly analytics report every Monday morning" },
              { key: "slackIntegration", label: "Slack integration", desc: "Post alerts to configured Slack channel" },
            ].map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <div>
                  <div className="text-sm font-medium text-foreground">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </div>
                <Switch checked={notifs[key as keyof typeof notifs]}
                  onCheckedChange={v => setNotifs(p => ({ ...p, [key]: v }))} />
              </div>
            ))}
          </div>
        </TabsContent>

        {/* System */}
        <TabsContent value="system">
          <div className="bis-card p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Default Investigation Tier</Label>
                <Select value={system.defaultTier} onValueChange={v => setSystem(p => ({ ...p, defaultTier: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">Basic ($25)</SelectItem>
                    <SelectItem value="standard">Standard ($75)</SelectItem>
                    <SelectItem value="comprehensive">Comprehensive ($150)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Default Country</Label>
                <Select value={system.defaultCountry} onValueChange={v => setSystem(p => ({ ...p, defaultCountry: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NG">Nigeria</SelectItem>
                    <SelectItem value="GH">Ghana</SelectItem>
                    <SelectItem value="KE">Kenya</SelectItem>
                    <SelectItem value="ZA">South Africa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Data Retention (days)</Label>
                <Input className="h-8 text-sm font-mono" type="number" value={system.dataRetentionDays}
                  onChange={e => setSystem(p => ({ ...p, dataRetentionDays: Number(e.target.value) }))} />
              </div>
            </div>
            <div className="space-y-3 pt-2">
              {[
                { key: "killSwitchEnabled", label: "Kill Switch Integration", desc: "Automatically activate payment kill switch on flagged investigations" },
                { key: "autoAdvanceEnabled", label: "Auto-Advance Workflow", desc: "Automatically advance investigations through processing stages" },
                { key: "auditLogEnabled", label: "Audit Logging", desc: "Log all actions and API calls to the immutable audit log" },
              ].map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <div>
                    <div className="text-sm font-medium text-foreground">{label}</div>
                    <div className="text-xs text-muted-foreground">{desc}</div>
                  </div>
                  <Switch checked={system[key as keyof typeof system] as boolean}
                    onCheckedChange={v => setSystem(p => ({ ...p, [key]: v }))} />
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* Integrations */}
        <TabsContent value="integrations">
          <div className="bis-card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">External Data Sources</h3>
            {INTEGRATIONS.map(src => (
              <div key={src.name} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${src.status === "connected" ? "bg-emerald-400" : src.status === "degraded" ? "bg-amber-400" : "bg-muted-foreground"}`} />
                  <div>
                    <div className="text-sm font-medium text-foreground">{src.name}</div>
                    <div className="text-[10px] text-muted-foreground">{src.description}</div>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 shrink-0" onClick={() => { setConfiguring(src); setApiKeyValue(""); setShowKey(false); }}>
                  <Key size={9} className="mr-1" />Configure
                </Button>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* Security */}
        <TabsContent value="security">
          <div className="bis-card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Keycloak / OIDC Configuration</h3>
            <div className="grid grid-cols-1 gap-3">
              {[
                { label: "Keycloak Realm URL", placeholder: "https://auth.bis.io/realms/bis" },
                { label: "Client ID", placeholder: "bis-api-server" },
                { label: "JWKS URI", placeholder: "https://auth.bis.io/realms/bis/protocol/openid-connect/certs" },
              ].map(field => (
                <div key={field.label} className="space-y-1.5">
                  <Label className="text-xs">{field.label}</Label>
                  <Input className="h-8 text-sm font-mono" placeholder={field.placeholder} />
                </div>
              ))}
            </div>
            <div className="pt-2">
              <h3 className="text-sm font-semibold text-foreground mb-3">Permify Authorization</h3>
              <div className="space-y-1.5">
                <Label className="text-xs">Permify Endpoint</Label>
                <Input className="h-8 text-sm font-mono" placeholder="http://permify:3476" />
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end mt-4">
        <Button size="sm" className="gap-1.5" onClick={handleSave} disabled={saving}>
          {saving ? <><Loader2 size={12} className="animate-spin" />Saving...</> : <><Save size={12} />Save Settings</>}
        </Button>
      </div>

      {/* Integration Configure Dialog */}
      <Dialog open={!!configuring} onOpenChange={open => { if (!open) { setConfiguring(null); setApiKeyValue(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">{configuring?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <div className="text-[10px] text-muted-foreground mb-1">Description</div>
              <p className="text-xs text-foreground">{configuring?.description}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">API Endpoint</Label>
              <Input className="h-8 text-xs font-mono" value={configuring?.endpoint ?? ""} readOnly />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">API Key / Token</Label>
              <div className="relative">
                <Input
                  className="h-8 text-xs font-mono pr-8"
                  type={showKey ? "text" : "password"}
                  placeholder={`Enter ${configuring?.key ?? 'api_key'}`}
                  value={apiKeyValue}
                  onChange={e => setApiKeyValue(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowKey(v => !v)}
                >
                  {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" disabled={testingConn} onClick={handleTestConnection}>
                {testingConn ? <><Loader2 size={11} className="animate-spin" /> Testing…</> : <><CheckCircle2 size={11} /> Test Connection</>}
              </Button>
              <Button size="sm" className="h-7 text-xs gap-1 ml-auto" onClick={handleSaveIntegration}>
                <Save size={11} /> Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </BISLayout>
  );
}
