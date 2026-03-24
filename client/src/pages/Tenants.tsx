// BIS Tenants & API Keys Management Page
// Design: Forensic Intelligence theme, semantic CSS variables

import { useState } from "react";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Building2, Plus, Key, Copy, Eye, EyeOff, Trash2,
  Search, Shield, Activity, CheckCircle2, RefreshCw,
  RotateCcw, AlertTriangle, Clock, ChevronDown, ChevronUp,
  Loader2, X, Webhook, Send, CheckSquare
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type TenantPlan   = "starter" | "growth" | "enterprise";
type TenantStatus = "active" | "suspended" | "trial";
type KeyStatus    = "active" | "revoked" | "rotated";

interface APIKey {
  id: string;
  label: string;
  key: string;
  status: KeyStatus;
  createdAt: string;
  lastUsed: string | null;
  callCount: number;
  environment: "live" | "test";
}

interface WebhookDelivery {
  id: string;
  timestamp: string;
  statusCode: number;
  durationMs: number;
  event: string;
  success: boolean;
  payloadPreview: string;
}

interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  status: 'active' | 'failing' | 'disabled';
  lastDelivery: string | null;
  successRate: number;
  deliveries?: WebhookDelivery[];
}

interface Tenant {
  id: string;
  name: string;
  plan: TenantPlan;
  status: TenantStatus;
  apiCalls: number;
  quota: number;
  country: string;
  createdAt: string;
  keys: APIKey[];
  webhooks: WebhookEndpoint[];
}

// ─── Mock data ────────────────────────────────────────────────────────────────

function makeKey(prefix: string, env: "live" | "test"): string {
  return `bis_${env}_${prefix}_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 26)}`;
}

const ALL_EVENTS = [
  'investigation.created', 'investigation.completed', 'investigation.flagged',
  'kyc.passed', 'kyc.failed', 'kyc.review',
  'alert.critical', 'alert.high', 'alert.medium',
  'field_task.dispatched', 'field_task.completed',
];

const SEED_TENANTS: Tenant[] = [
  {
    id: "t1", name: "TourismPay Platform", plan: "enterprise", status: "active",
    apiCalls: 8420, quota: 100000, country: "NG", createdAt: "2026-01-01",
    webhooks: [
      { id: 'wh1', url: 'https://api.tourismpay.ng/bis-webhook', events: ['investigation.flagged', 'alert.critical', 'kyc.failed'], status: 'active', lastDelivery: '2026-03-24T09:00:00Z', successRate: 99.2 },
    ],
    keys: [
      { id: "k1a", label: "Production",   key: "bis_live_tp_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6", status: "active",  createdAt: "2026-01-01", lastUsed: "2026-03-24T09:01:00Z", callCount: 8420, environment: "live" },
      { id: "k1b", label: "Staging",      key: "bis_test_tp_q1r2s3t4u5v6w7x8y9z0a1b2c3d4e5f6", status: "active",  createdAt: "2026-01-15", lastUsed: "2026-03-23T14:30:00Z", callCount: 312,  environment: "test" },
      { id: "k1c", label: "Old Key",      key: "bis_live_tp_old1old2old3old4old5old6old7old8", status: "rotated", createdAt: "2025-12-01", lastUsed: "2026-01-01T00:00:00Z", callCount: 1240, environment: "live" },
    ],
  },
  {
    id: "t2", name: "Konga Merchant Services", plan: "growth", status: "active",
    apiCalls: 1240, quota: 10000, country: "NG", createdAt: "2026-02-15",
    webhooks: [],
    keys: [
      { id: "k2a", label: "Production", key: "bis_live_km_g1h2i3j4k5l6m7n8o9p0q1r2s3t4u5v6", status: "active", createdAt: "2026-02-15", lastUsed: "2026-03-24T08:45:00Z", callCount: 1240, environment: "live" },
    ],
  },
  {
    id: "t3", name: "Flutterwave Compliance", plan: "enterprise", status: "active",
    apiCalls: 22100, quota: 100000, country: "NG", createdAt: "2026-01-20",
    webhooks: [
      { id: 'wh3', url: 'https://compliance.flutterwave.com/hooks/bis', events: ['investigation.flagged', 'investigation.completed', 'alert.critical', 'alert.high'], status: 'active', lastDelivery: '2026-03-24T08:55:00Z', successRate: 100,
        deliveries: [
          { id: 'd1', timestamp: '2026-03-24T08:55:00Z', statusCode: 200, durationMs: 142, event: 'investigation.flagged', success: true, payloadPreview: '{"ref":"BIS-2026-0004","risk":87,"subject":"Emeka Nwosu"}' },
          { id: 'd2', timestamp: '2026-03-24T07:12:00Z', statusCode: 200, durationMs: 98,  event: 'alert.critical',         success: true, payloadPreview: '{"alertId":"ALT-0012","type":"sanctions_match"}' },
          { id: 'd3', timestamp: '2026-03-23T18:30:00Z', statusCode: 200, durationMs: 211, event: 'investigation.completed', success: true, payloadPreview: '{"ref":"BIS-2026-0001","status":"completed"}' },
          { id: 'd4', timestamp: '2026-03-23T14:00:00Z', statusCode: 200, durationMs: 134, event: 'investigation.flagged',   success: true, payloadPreview: '{"ref":"BIS-2026-0007","risk":91}' },
          { id: 'd5', timestamp: '2026-03-22T09:45:00Z', statusCode: 200, durationMs: 178, event: 'alert.high',              success: true, payloadPreview: '{"alertId":"ALT-0009","type":"pep_match"}' },
        ]
      },
      { id: 'wh3b', url: 'https://dev.flutterwave.com/hooks/bis-test', events: ['kyc.passed', 'kyc.failed'], status: 'failing', lastDelivery: '2026-03-22T10:00:00Z', successRate: 62.5,
        deliveries: [
          { id: 'd6', timestamp: '2026-03-22T10:00:00Z', statusCode: 503, durationMs: 5000, event: 'kyc.failed', success: false, payloadPreview: '{"ref":"KYC-0088","result":"failed"}' },
          { id: 'd7', timestamp: '2026-03-21T15:30:00Z', statusCode: 200, durationMs: 88,   event: 'kyc.passed', success: true,  payloadPreview: '{"ref":"KYC-0085","result":"passed"}' },
          { id: 'd8', timestamp: '2026-03-21T09:00:00Z', statusCode: 503, durationMs: 5000, event: 'kyc.failed', success: false, payloadPreview: '{"ref":"KYC-0082","result":"failed"}' },
        ]
      },
    ],
    keys: [
      { id: "k3a", label: "Production",   key: "bis_live_fw_w1x2y3z4a5b6c7d8e9f0g1h2i3j4k5l6", status: "active",  createdAt: "2026-01-20", lastUsed: "2026-03-24T09:00:00Z", callCount: 22100, environment: "live" },
      { id: "k3b", label: "Dev / Test",   key: "bis_test_fw_m1n2o3p4q5r6s7t8u9v0w1x2y3z4a5b6", status: "active",  createdAt: "2026-02-01", lastUsed: "2026-03-22T11:00:00Z", callCount: 890,   environment: "test" },
    ],
  },
  {
    id: "t4", name: "Paystack Risk Team", plan: "growth", status: "trial",
    apiCalls: 340, quota: 10000, country: "NG", createdAt: "2026-03-10",
    webhooks: [],
    keys: [
      { id: "k4a", label: "Trial Key",    key: "bis_test_ps_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6", status: "active",  createdAt: "2026-03-10", lastUsed: "2026-03-23T16:00:00Z", callCount: 340,  environment: "test" },
    ],
  },
  {
    id: "t5", name: "GTBank Digital", plan: "starter", status: "suspended",
    apiCalls: 0, quota: 1000, country: "NG", createdAt: "2026-02-01",
    webhooks: [],
    keys: [
      { id: "k5a", label: "Production",   key: "bis_live_gt_z1y2x3w4v5u6t7s8r9q0p1o2n3m4l5k6", status: "revoked", createdAt: "2026-02-01", lastUsed: "2026-02-28T12:00:00Z", callCount: 0,    environment: "live" },
    ],
  },
];

// ─── Config ───────────────────────────────────────────────────────────────────

const PLAN_CONFIG: Record<TenantPlan, { label: string; quota: number; color: string }> = {
  starter:    { label: "Starter",    quota: 1000,   color: "text-muted-foreground border-border" },
  growth:     { label: "Growth",     quota: 10000,  color: "text-primary border-primary/30" },
  enterprise: { label: "Enterprise", quota: 100000, color: "text-amber-400 border-amber-500/30" },
};

const STATUS_CONFIG: Record<TenantStatus, { label: string; cls: string }> = {
  active:    { label: "Active",    cls: "bis-badge-success" },
  suspended: { label: "Suspended", cls: "bis-badge-danger" },
  trial:     { label: "Trial",     cls: "bis-badge-warning" },
};

const KEY_STATUS_CONFIG: Record<KeyStatus, { label: string; color: string }> = {
  active:  { label: "Active",  color: "text-emerald-500" },
  revoked: { label: "Revoked", color: "text-red-500" },
  rotated: { label: "Rotated", color: "text-muted-foreground" },
};

function relTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function maskKey(key: string): string {
  return key.slice(0, 14) + "••••••••••••••••••••" + key.slice(-4);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Tenants() {
  const [tenants, setTenants] = useState<Tenant[]>(SEED_TENANTS);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>("t1");
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [rotatingKey, setRotatingKey] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTenant, setNewTenant] = useState({ name: "", plan: "growth" as TenantPlan, country: "NG" });
  const [expandedTab, setExpandedTab] = useState<Record<string, 'keys' | 'webhooks'>>({});
  const [newWebhookUrl, setNewWebhookUrl] = useState<Record<string, string>>({});
  const [newWebhookEvents, setNewWebhookEvents] = useState<Record<string, Set<string>>>({});
  const [testingWebhook, setTestingWebhook] = useState<string | null>(null);
  const [expandedDeliveries, setExpandedDeliveries] = useState<Set<string>>(new Set());

  const toggleDeliveries = (whId: string) => {
    setExpandedDeliveries(prev => {
      const next = new Set(prev);
      next.has(whId) ? next.delete(whId) : next.add(whId);
      return next;
    });
  };

  const getTab = (tenantId: string) => expandedTab[tenantId] ?? 'keys';

  const handleAddWebhook = (tenantId: string) => {
    const url = newWebhookUrl[tenantId]?.trim();
    if (!url || !url.startsWith('http')) { toast.error('Enter a valid HTTPS URL'); return; }
    const events = Array.from(newWebhookEvents[tenantId] ?? new Set<string>());
    if (events.length === 0) { toast.error('Select at least one event type'); return; }
    const wh: WebhookEndpoint = {
      id: `wh_${Date.now()}`,
      url,
      events,
      status: 'active',
      lastDelivery: null,
      successRate: 100,
    };
    setTenants(prev => prev.map(t => t.id !== tenantId ? t : { ...t, webhooks: [...t.webhooks, wh] }));
    setNewWebhookUrl(p => ({ ...p, [tenantId]: '' }));
    setNewWebhookEvents(p => ({ ...p, [tenantId]: new Set<string>() }));
    toast.success('Webhook endpoint registered');
  };

  const handleDeleteWebhook = (tenantId: string, whId: string) => {
    setTenants(prev => prev.map(t => t.id !== tenantId ? t : { ...t, webhooks: t.webhooks.filter(w => w.id !== whId) }));
    toast.warning('Webhook endpoint removed');
  };

  const handleTestWebhook = async (whId: string) => {
    setTestingWebhook(whId);
    await new Promise(r => setTimeout(r, 1400));
    setTestingWebhook(null);
    toast.success('Test payload delivered — 200 OK received');
  };

  const toggleWebhookEvent = (tenantId: string, event: string) => {
    setNewWebhookEvents(prev => {
      const cur = new Set(prev[tenantId] ?? []);
      cur.has(event) ? cur.delete(event) : cur.add(event);
      return { ...prev, [tenantId]: cur };
    });
  };

  const filtered = tenants.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.country.toLowerCase().includes(search.toLowerCase())
  );

  const toggleKeyVisible = (keyId: string) => {
    setVisibleKeys(prev => {
      const next = new Set(prev);
      next.has(keyId) ? next.delete(keyId) : next.add(keyId);
      return next;
    });
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key).then(() => toast.success("API key copied to clipboard"));
  };

  const handleRotate = async (tenantId: string, keyId: string, env: "live" | "test") => {
    setRotatingKey(keyId);
    await new Promise(r => setTimeout(r, 1200));
    const newKey: APIKey = {
      id: `k_${Date.now()}`,
      label: "Production (rotated)",
      key: makeKey(tenantId.slice(0, 2), env),
      status: "active",
      createdAt: new Date().toISOString().split("T")[0],
      lastUsed: null,
      callCount: 0,
      environment: env,
    };
    setTenants(prev => prev.map(t => {
      if (t.id !== tenantId) return t;
      return {
        ...t,
        keys: t.keys.map(k => k.id === keyId ? { ...k, status: "rotated" as KeyStatus } : k).concat(newKey),
      };
    }));
    setRotatingKey(null);
    toast.success("API key rotated — old key marked as rotated");
  };

  const handleRevoke = (tenantId: string, keyId: string) => {
    setTenants(prev => prev.map(t => {
      if (t.id !== tenantId) return t;
      return { ...t, keys: t.keys.map(k => k.id === keyId ? { ...k, status: "revoked" as KeyStatus } : k) };
    }));
    toast.warning("API key revoked — all calls using this key will be rejected");
  };

  const handleGenerateKey = (tenantId: string, env: "live" | "test") => {
    const prefix = tenantId.slice(0, 2);
    const newKey: APIKey = {
      id: `k_${Date.now()}`,
      label: env === "live" ? "New Live Key" : "New Test Key",
      key: makeKey(prefix, env),
      status: "active",
      createdAt: new Date().toISOString().split("T")[0],
      lastUsed: null,
      callCount: 0,
      environment: env,
    };
    setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, keys: [...t.keys, newKey] } : t));
    toast.success(`New ${env} API key generated`);
  };

  const handleSuspend = (id: string) => {
    setTenants(prev => prev.map(t =>
      t.id === id ? { ...t, status: t.status === "suspended" ? "active" : "suspended" } : t
    ));
    toast.info("Tenant status updated");
  };

  const handleCreate = async () => {
    if (!newTenant.name.trim()) { toast.error("Tenant name is required"); return; }
    setCreating(true);
    await new Promise(r => setTimeout(r, 1000));
    const prefix = newTenant.name.slice(0, 2).toLowerCase();
    const newT: Tenant = {
      id: `t${Date.now()}`,
      name: newTenant.name,
      plan: newTenant.plan,
      status: "trial",
      apiCalls: 0,
      quota: PLAN_CONFIG[newTenant.plan].quota,
      country: newTenant.country,
      createdAt: new Date().toISOString().split("T")[0],
      webhooks: [],
      keys: [
        {
          id: `k_${Date.now()}`,
          label: "Trial Key",
          key: makeKey(prefix, "test"),
          status: "active",
          createdAt: new Date().toISOString().split("T")[0],
          lastUsed: null,
          callCount: 0,
          environment: "test",
        },
      ],
    };
    setTenants(prev => [newT, ...prev]);
    setExpandedId(newT.id);
    setCreating(false);
    setCreateOpen(false);
    toast.success(`Tenant "${newT.name}" created with a trial test key`);
    setNewTenant({ name: "", plan: "growth", country: "NG" });
  };

  const totalCalls = tenants.reduce((s, t) => s + t.apiCalls, 0);

  return (
    <BISLayout
      title="Tenants & API Keys"
      subtitle={`${tenants.filter(t => t.status === "active").length} active tenants`}
      actions={
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-7 text-xs gap-1.5"><Plus size={12} /> New Tenant</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Create Tenant</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label>Organization Name *</Label>
                <Input placeholder="e.g. Acme Bank Compliance" value={newTenant.name}
                  onChange={e => setNewTenant(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Plan</Label>
                  <Select value={newTenant.plan} onValueChange={v => setNewTenant(p => ({ ...p, plan: v as TenantPlan }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starter">Starter (1K/mo)</SelectItem>
                      <SelectItem value="growth">Growth (10K/mo)</SelectItem>
                      <SelectItem value="enterprise">Enterprise (100K/mo)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Country</Label>
                  <Select value={newTenant.country} onValueChange={v => setNewTenant(p => ({ ...p, country: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["NG","GH","KE","ZA","GB","US"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={handleCreate} disabled={creating}>
                  {creating ? <><Loader2 size={12} className="animate-spin mr-1" />Creating…</> : "Create Tenant"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      }
    >
      {/* ── Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: "Total Tenants",   value: tenants.length,                                         icon: <Building2 size={14} />,                                  color: "text-foreground" },
          { label: "Active",          value: tenants.filter(t => t.status === "active").length,       icon: <CheckCircle2 size={14} className="text-emerald-400" />,  color: "text-emerald-500" },
          { label: "Enterprise",      value: tenants.filter(t => t.plan === "enterprise").length,     icon: <Shield size={14} className="text-amber-400" />,          color: "text-amber-500" },
          { label: "API Calls (30d)", value: totalCalls.toLocaleString(),                             icon: <Activity size={14} className="text-primary" />,          color: "text-primary" },
        ].map(s => (
          <div key={s.label} className="bis-card p-3 flex items-center gap-3">
            <div className="text-muted-foreground">{s.icon}</div>
            <div>
              <div className={cn("text-lg font-bold font-mono", s.color)}>{s.value}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Search ── */}
      <div className="relative max-w-sm mb-4">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8 h-8 text-sm" placeholder="Search tenants…" value={search} onChange={e => setSearch(e.target.value)} />
        {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X size={12} /></button>}
      </div>

      {/* ── Tenant cards ── */}
      <div className="space-y-3">
        {filtered.map(tenant => {
          const pc = PLAN_CONFIG[tenant.plan];
          const sc = STATUS_CONFIG[tenant.status];
          const isExpanded = expandedId === tenant.id;
          const activeKeys = tenant.keys.filter(k => k.status === "active");

          return (
            <div key={tenant.id} className="bis-card overflow-hidden">
              {/* ── Header row ── */}
              <div
                className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/20 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : tenant.id)}
              >
                <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <Building2 size={15} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-foreground text-sm">{tenant.name}</span>
                    <Badge variant="outline" className={cn("text-[10px] h-4 px-1.5 capitalize", pc.color)}>{pc.label}</Badge>
                    <span className={cn("bis-badge", sc.cls)}>{sc.label}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{tenant.country}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground font-mono">
                    <span>{tenant.apiCalls.toLocaleString()} / {pc.quota.toLocaleString()} calls</span>
                    <span>·</span>
                    <span>{activeKeys.length} active key{activeKeys.length !== 1 ? "s" : ""}</span>
                    <span>·</span>
                    <span>Since {tenant.createdAt}</span>
                  </div>
                </div>

                {/* Usage bar */}
                <div className="w-28 shrink-0 hidden sm:block">
                  <div className="flex justify-between text-[9px] text-muted-foreground mb-1">
                    <span>Usage</span>
                    <span>{Math.round((tenant.apiCalls / pc.quota) * 100)}%</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all",
                        (tenant.apiCalls / pc.quota) > 0.9 ? "bg-red-500" :
                        (tenant.apiCalls / pc.quota) > 0.7 ? "bg-amber-500" : "bg-primary"
                      )}
                      style={{ width: `${Math.min(100, (tenant.apiCalls / pc.quota) * 100)}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="outline" size="sm" className="h-6 text-[10px] px-2"
                    onClick={e => { e.stopPropagation(); handleSuspend(tenant.id); }}
                  >
                    {tenant.status === "suspended" ? "Activate" : "Suspend"}
                  </Button>
                  {isExpanded ? <ChevronUp size={14} className="text-muted-foreground ml-1" /> : <ChevronDown size={14} className="text-muted-foreground ml-1" />}
                </div>
              </div>

              {/* ── Expanded: Tabbed panel ── */}
              {isExpanded && (
                <div className="border-t border-border px-4 pb-4 pt-3">
                  {/* Tab bar */}
                  <div className="flex items-center gap-1 mb-3 border-b border-border pb-2">
                    {(['keys', 'webhooks'] as const).map(tab => (
                      <button
                        key={tab}
                        onClick={() => setExpandedTab(p => ({ ...p, [tenant.id]: tab }))}
                        className={cn(
                          "flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1 rounded-md transition-colors",
                          getTab(tenant.id) === tab
                            ? "bg-primary/10 text-primary border border-primary/20"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {tab === 'keys' ? <Key size={10} /> : <Webhook size={10} />}
                        {tab === 'keys' ? `API Keys (${tenant.keys.filter(k => k.status === 'active').length})` : `Webhooks (${tenant.webhooks.length})`}
                      </button>
                    ))}
                  </div>

                  {/* ── Keys tab ── */}
                  {getTab(tenant.id) === 'keys' && (
                  <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <Key size={12} className="text-primary" /> API Keys
                    </h4>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1"
                        onClick={() => handleGenerateKey(tenant.id, "test")}
                      >
                        <Plus size={10} /> Test Key
                      </Button>
                      <Button
                        variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1"
                        onClick={() => handleGenerateKey(tenant.id, "live")}
                      >
                        <Plus size={10} /> Live Key
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {tenant.keys.map(apiKey => {
                      const ksc = KEY_STATUS_CONFIG[apiKey.status];
                      const isVisible = visibleKeys.has(apiKey.id);
                      const isRotating = rotatingKey === apiKey.id;
                      return (
                        <div
                          key={apiKey.id}
                          className={cn(
                            "rounded-lg border p-3 transition-colors",
                            apiKey.status === "active"   ? "border-border bg-muted/20" :
                            apiKey.status === "revoked"  ? "border-red-500/20 bg-red-500/5 opacity-60" :
                            "border-border/50 bg-muted/10 opacity-50"
                          )}
                        >
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              {/* Label row */}
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className="text-xs font-medium text-foreground">{apiKey.label}</span>
                                <span className={cn(
                                  "text-[9px] font-mono rounded px-1.5 py-0.5 border",
                                  apiKey.environment === "live"
                                    ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
                                    : "text-amber-400 bg-amber-500/10 border-amber-500/30"
                                )}>
                                  {apiKey.environment.toUpperCase()}
                                </span>
                                <span className={cn("text-[9px] font-mono", ksc.color)}>{ksc.label}</span>
                              </div>

                              {/* Key value */}
                              <div className="flex items-center gap-1.5 p-1.5 rounded bg-muted/40 border border-border/50">
                                <code className="text-[10px] font-mono text-muted-foreground flex-1 truncate">
                                  {isVisible ? apiKey.key : maskKey(apiKey.key)}
                                </code>
                                <button
                                  onClick={() => toggleKeyVisible(apiKey.id)}
                                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                                  title={isVisible ? "Hide key" : "Show key"}
                                >
                                  {isVisible ? <EyeOff size={11} /> : <Eye size={11} />}
                                </button>
                                {apiKey.status === "active" && (
                                  <button
                                    onClick={() => copyKey(apiKey.key)}
                                    className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                                    title="Copy to clipboard"
                                  >
                                    <Copy size={11} />
                                  </button>
                                )}
                              </div>

                              {/* Metadata */}
                              <div className="flex items-center gap-3 mt-1.5 text-[9px] font-mono text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Clock size={9} /> Created {apiKey.createdAt}
                                </span>
                                <span>·</span>
                                <span className="flex items-center gap-1">
                                  <Activity size={9} /> Last used: {relTime(apiKey.lastUsed)}
                                </span>
                                <span>·</span>
                                <span>{apiKey.callCount.toLocaleString()} calls</span>
                              </div>
                            </div>

                            {/* Actions */}
                            {apiKey.status === "active" && (
                              <div className="flex items-center gap-1 shrink-0 ml-2">
                                <Button
                                  variant="outline" size="sm"
                                  className="h-6 text-[10px] px-2 gap-1"
                                  disabled={isRotating}
                                  onClick={() => handleRotate(tenant.id, apiKey.id, apiKey.environment)}
                                  title="Rotate key — generates a new key and marks this one as rotated"
                                >
                                  {isRotating
                                    ? <Loader2 size={9} className="animate-spin" />
                                    : <RotateCcw size={9} />}
                                  {isRotating ? "Rotating…" : "Rotate"}
                                </Button>
                                <Button
                                  variant="outline" size="sm"
                                  className="h-6 text-[10px] px-2 gap-1 text-red-400 hover:text-red-400 hover:border-red-500/30"
                                  onClick={() => handleRevoke(tenant.id, apiKey.id)}
                                  title="Permanently revoke this key"
                                >
                                  <Trash2 size={9} /> Revoke
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer note */}
                  <p className="text-[9px] font-mono text-muted-foreground/50 mt-3">
                    Rotated and revoked keys are shown for audit purposes only. Key changes are logged to the Audit Log.
                  </p>
                  </div>
                  )}

                  {/* ── Webhooks tab ── */}
                  {getTab(tenant.id) === 'webhooks' && (
                  <div className="space-y-3">
                    {/* Existing webhooks */}
                    {tenant.webhooks.length === 0 && (
                      <p className="text-xs text-muted-foreground py-2">No webhook endpoints registered yet.</p>
                    )}
                    {tenant.webhooks.map(wh => (
                      <div key={wh.id} className={cn(
                        "rounded-lg border p-3 space-y-2",
                        wh.status === 'failing' ? 'border-red-500/30 bg-red-500/5' : 'border-border bg-muted/20'
                      )}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <code className="text-[10px] font-mono text-foreground truncate">{wh.url}</code>
                              <span className={cn(
                                "text-[9px] font-mono rounded px-1.5 py-0.5 border shrink-0",
                                wh.status === 'active'   ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' :
                                wh.status === 'failing'  ? 'text-red-400 bg-red-500/10 border-red-500/30' :
                                'text-muted-foreground bg-muted/30 border-border'
                              )}>{wh.status.toUpperCase()}</span>
                            </div>
                            <div className="flex flex-wrap gap-1 mb-1">
                              {wh.events.map(ev => (
                                <span key={ev} className="text-[9px] font-mono bg-primary/10 text-primary border border-primary/20 rounded px-1.5 py-0.5">{ev}</span>
                              ))}
                            </div>
                            <div className="flex items-center gap-3 text-[9px] font-mono text-muted-foreground">
                              <span>Last delivery: {wh.lastDelivery ? relTime(wh.lastDelivery) : 'Never'}</span>
                              <span>·</span>
                              <span>Success rate: {wh.successRate}%</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1"
                              disabled={testingWebhook === wh.id}
                              onClick={() => handleTestWebhook(wh.id)}
                            >
                              {testingWebhook === wh.id ? <Loader2 size={9} className="animate-spin" /> : <Send size={9} />}
                              {testingWebhook === wh.id ? 'Sending…' : 'Test'}
                            </Button>
                            <Button
                              variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1"
                              onClick={() => toggleDeliveries(wh.id)}
                            >
                              <Activity size={9} />
                              {expandedDeliveries.has(wh.id) ? 'Hide log' : `Log (${wh.deliveries?.length ?? 0})`}
                            </Button>
                            <Button
                              variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1 text-red-400 hover:text-red-400 hover:border-red-500/30"
                              onClick={() => handleDeleteWebhook(tenant.id, wh.id)}
                            >
                              <Trash2 size={9} /> Remove
                            </Button>
                          </div>
                        </div>
                        {/* Delivery log */}
                        {expandedDeliveries.has(wh.id) && wh.deliveries && wh.deliveries.length > 0 && (
                          <div className="mt-2 border-t border-border/30 pt-2 space-y-1">
                            <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Last {wh.deliveries.length} deliveries</div>
                            {wh.deliveries.map(d => (
                              <div key={d.id} className={cn(
                                "flex items-start gap-2 rounded px-2 py-1 text-[9px] font-mono",
                                d.success ? 'bg-emerald-500/5 border border-emerald-500/10' : 'bg-red-500/5 border border-red-500/10'
                              )}>
                                <span className={cn('font-bold shrink-0', d.success ? 'text-emerald-400' : 'text-red-400')}>{d.statusCode}</span>
                                <span className="text-muted-foreground shrink-0">{d.durationMs}ms</span>
                                <span className="text-primary shrink-0">{d.event}</span>
                                <code className="text-foreground/70 truncate flex-1">{d.payloadPreview}</code>
                                <span className="text-muted-foreground shrink-0">{new Date(d.timestamp).toLocaleTimeString()}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Add new webhook form */}
                    <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
                      <p className="text-[10px] font-semibold text-foreground">Register new endpoint</p>
                      <Input
                        className="h-7 text-xs font-mono"
                        placeholder="https://your-server.com/bis-webhook"
                        value={newWebhookUrl[tenant.id] ?? ''}
                        onChange={e => setNewWebhookUrl(p => ({ ...p, [tenant.id]: e.target.value }))}
                      />
                      <div className="flex flex-wrap gap-1">
                        {ALL_EVENTS.map(ev => {
                          const selected = (newWebhookEvents[tenant.id] ?? new Set()).has(ev);
                          return (
                            <button
                              key={ev}
                              onClick={() => toggleWebhookEvent(tenant.id, ev)}
                              className={cn(
                                "text-[9px] font-mono rounded px-1.5 py-0.5 border transition-colors",
                                selected
                                  ? 'bg-primary/10 text-primary border-primary/30'
                                  : 'text-muted-foreground border-border hover:border-primary/30 hover:text-foreground'
                              )}
                            >
                              {selected && <CheckSquare size={8} className="inline mr-0.5" />}{ev}
                            </button>
                          );
                        })}
                      </div>
                      <Button size="sm" className="h-6 text-[10px] gap-1" onClick={() => handleAddWebhook(tenant.id)}>
                        <Plus size={9} /> Register Endpoint
                      </Button>
                    </div>
                  </div>
                  )}

                </div>
              )}
            </div>
          );
        })}
      </div>
    </BISLayout>
  );
}
