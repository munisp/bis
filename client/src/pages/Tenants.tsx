// Tenants.tsx — Tenant & API Key management backed by live tRPC
// Design: Forensic Intelligence theme, semantic CSS variables

import { useState, useMemo } from "react";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import {
  Building2, Plus, Key, Copy, Eye, EyeOff, Trash2, Palette,
  Search, Shield, Activity, CheckCircle2, RefreshCw,
  RotateCcw, AlertTriangle, Clock, ChevronDown, ChevronUp,
  Loader2, X, Webhook, Send, CheckSquare
} from "lucide-react";
import { relTime } from "@/lib/bisUtils";

// ─── Config ───────────────────────────────────────────────────────────────────

const ALL_EVENTS = [
  'investigation.created', 'investigation.completed', 'investigation.flagged',
  'kyc.passed', 'kyc.failed', 'kyc.review',
  'alert.critical', 'alert.high', 'alert.medium',
  'field_task.dispatched', 'field_task.completed',
];

const PLAN_CONFIG: Record<string, { label: string; quota: number; color: string }> = {
  starter:      { label: "Starter",      quota: 1_000,   color: "text-muted-foreground border-border" },
  professional: { label: "Professional", quota: 10_000,  color: "text-primary border-primary/30" },
  enterprise:   { label: "Enterprise",   quota: 100_000, color: "text-amber-400 border-amber-500/30" },
  government:   { label: "Government",   quota: 500_000, color: "text-violet-400 border-violet-500/30" },
};

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  active:    { label: "Active",    cls: "bis-badge-verified" },
  suspended: { label: "Suspended", cls: "bis-badge-flagged" },
  trial:     { label: "Trial",     cls: "bis-badge-processing" },
  churned:   { label: "Churned",   cls: "bis-badge-draft" },
};

const KEY_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active:  { label: "Active",  color: "text-emerald-500" },
  revoked: { label: "Revoked", color: "text-red-500" },
  expired: { label: "Expired", color: "text-muted-foreground" },
};

function maskKey(prefix: string): string {
  return `${prefix}••••••••••••••••••••••••••••••`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Tenants() {
  const utils = trpc.useUtils();

  // ── Queries ──
  const { data, isLoading, refetch } = trpc.tenants.list.useQuery(undefined, { refetchOnWindowFocus: false });
  const tenantRows = data?.rows ?? [];

  // ── UI state ──
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<number>>(new Set());
  const [expandedTab, setExpandedTab] = useState<Record<number, 'keys' | 'webhooks'>>({});
  const [newWebhookUrl, setNewWebhookUrl] = useState<Record<number, string>>({});
  const [newWebhookEvents, setNewWebhookEvents] = useState<Record<number, Set<string>>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [newTenant, setNewTenant] = useState({ name: "", plan: "starter" as const, country: "NG", contactEmail: "" });
  const [newKeyName, setNewKeyName] = useState<Record<number, string>>({});
  const [revealedKey, setRevealedKey] = useState<{ id: number; raw: string } | null>(null);

  // ── Tenant mutations ──
  const createTenantMut = trpc.tenants.create.useMutation({
    onSuccess: (t) => {
      toast.success(`Tenant "${t.name}" created`);
      setCreateOpen(false);
      setNewTenant({ name: "", plan: "starter", country: "NG", contactEmail: "" });
      utils.tenants.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const suspendMut = trpc.tenants.suspend.useMutation({
    onSuccess: () => { toast.info("Tenant suspended"); utils.tenants.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const reactivateMut = trpc.tenants.reactivate.useMutation({
    onSuccess: () => { toast.success("Tenant reactivated"); utils.tenants.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  // ── API Key mutations ──
  const createKeyMut = trpc.tenants.createKey.useMutation({
    onSuccess: (k) => {
      setRevealedKey({ id: k.id, raw: (k as any).rawKey });
      toast.success("API key created — copy it now, it won't be shown again");
      utils.tenants.listKeys.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeKeyMut = trpc.tenants.revokeKey.useMutation({
    onSuccess: () => { toast.warning("API key revoked"); utils.tenants.listKeys.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const rotateKeyMut = trpc.tenants.rotateKey.useMutation({
    onSuccess: (k) => {
      setRevealedKey({ id: k.id, raw: (k as any).rawKey });
      toast.success("Key rotated — copy the new key now");
      utils.tenants.listKeys.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Webhook mutations ──
  const createWebhookMut = trpc.tenants.createWebhook.useMutation({
    onSuccess: () => { toast.success("Webhook registered"); utils.tenants.listWebhooks.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteWebhookMut = trpc.tenants.deleteWebhook.useMutation({
    onSuccess: () => { toast.warning("Webhook removed"); utils.tenants.listWebhooks.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const testWebhookMut = trpc.tenants.testWebhook.useMutation({
    onSuccess: (r) => r.success ? toast.success(`Test delivered — ${r.status} OK`) : toast.error(`Test failed — ${r.status}`),
    onError: (e) => toast.error(e.message),
  });

  // ── Filtered list ──
  const filtered = useMemo(() =>
    tenantRows.filter(t =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      (t.country ?? "").toLowerCase().includes(search.toLowerCase())
    ),
    [tenantRows, search]
  );

  const getTab = (id: number) => expandedTab[id] ?? 'keys';

  const toggleKeyVisible = (id: number) =>
    setVisibleKeys(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleWebhookEvent = (tenantId: number, event: string) =>
    setNewWebhookEvents(prev => {
      const cur = new Set(prev[tenantId] ?? []);
      cur.has(event) ? cur.delete(event) : cur.add(event);
      return { ...prev, [tenantId]: cur };
    });

  const handleAddWebhook = (tenantId: number) => {
    const url = newWebhookUrl[tenantId]?.trim();
    if (!url || !url.startsWith('http')) { toast.error('Enter a valid HTTPS URL'); return; }
    const events = Array.from(newWebhookEvents[tenantId] ?? new Set<string>());
    if (events.length === 0) { toast.error('Select at least one event type'); return; }
    createWebhookMut.mutate({ tenantId, url, events });
    setNewWebhookUrl(p => ({ ...p, [tenantId]: '' }));
    setNewWebhookEvents(p => ({ ...p, [tenantId]: new Set<string>() }));
  };

  const handleGenerateKey = (tenantId: number) => {
    const name = (newKeyName[tenantId] ?? '').trim() || 'New Key';
    createKeyMut.mutate({ tenantId, name, permissions: [] });
    setNewKeyName(p => ({ ...p, [tenantId]: '' }));
  };

  // ── Stats ──
  const stats = useMemo(() => ({
    total:      tenantRows.length,
    active:     tenantRows.filter(t => t.status === 'active').length,
    enterprise: tenantRows.filter(t => t.plan === 'enterprise' || t.plan === 'government').length,
    apiCalls:   tenantRows.reduce((s, t) => s + (t.usedThisMonth ?? 0), 0),
  }), [tenantRows]);

  return (
    <BISLayout
      title="Tenants & API Keys"
      subtitle={`${stats.active} active tenant${stats.active !== 1 ? 's' : ''}`}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => refetch()}>
            <RefreshCw size={11} /> Refresh
          </Button>
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
                <div className="space-y-1.5">
                  <Label>Contact Email</Label>
                  <Input type="email" placeholder="admin@company.com" value={newTenant.contactEmail}
                    onChange={e => setNewTenant(p => ({ ...p, contactEmail: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Plan</Label>
                    <Select value={newTenant.plan} onValueChange={v => setNewTenant(p => ({ ...p, plan: v as any }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="starter">Starter (1K/mo)</SelectItem>
                        <SelectItem value="professional">Professional (10K/mo)</SelectItem>
                        <SelectItem value="enterprise">Enterprise (100K/mo)</SelectItem>
                        <SelectItem value="government">Government (500K/mo)</SelectItem>
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
                  <Button size="sm" onClick={() => {
                    if (!newTenant.name.trim()) { toast.error("Name required"); return; }
                    const slug = newTenant.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                    createTenantMut.mutate({ ...newTenant, slug, contactEmail: newTenant.contactEmail || undefined });
                  }} disabled={createTenantMut.isPending}>
                    {createTenantMut.isPending ? <><Loader2 size={12} className="animate-spin mr-1" />Creating…</> : "Create Tenant"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      }
    >
      {/* ── Revealed key modal ── */}
      {revealedKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bis-card p-5 max-w-lg w-full mx-4 space-y-3">
            <div className="flex items-center gap-2">
              <Key size={14} className="text-amber-400" />
              <span className="text-sm font-semibold text-foreground">Copy your API key now</span>
            </div>
            <p className="text-xs text-muted-foreground">This key will not be shown again. Store it securely.</p>
            <div className="flex items-center gap-2 p-2 rounded bg-muted/40 border border-border">
              <code className="text-xs font-mono text-foreground flex-1 break-all">{revealedKey.raw}</code>
              <button onClick={() => { navigator.clipboard.writeText(revealedKey.raw); toast.success("Copied!"); }}
                className="text-muted-foreground hover:text-foreground shrink-0"><Copy size={13} /></button>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setRevealedKey(null)}>Done</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: "Total Tenants",   value: stats.total,                  icon: <Building2 size={14} />,                                  color: "text-foreground" },
          { label: "Active",          value: stats.active,                 icon: <CheckCircle2 size={14} className="text-emerald-400" />,  color: "text-emerald-500" },
          { label: "Enterprise/Gov",  value: stats.enterprise,             icon: <Shield size={14} className="text-amber-400" />,          color: "text-amber-500" },
          { label: "API Calls (MTD)", value: stats.apiCalls.toLocaleString(), icon: <Activity size={14} className="text-primary" />,       color: "text-primary" },
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

      {/* ── Loading / empty ── */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 size={16} className="animate-spin" /><span className="text-sm">Loading tenants…</span>
        </div>
      )}
      {!isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <Building2 size={28} className="opacity-30" />
          <p className="text-sm">{search ? "No tenants match your search." : "No tenants yet. Create the first one."}</p>
        </div>
      )}

      {/* ── Tenant cards ── */}
      <div className="space-y-3">
        {filtered.map(tenant => {
          const pc = PLAN_CONFIG[tenant.plan] ?? PLAN_CONFIG.starter;
          const sc = STATUS_CONFIG[tenant.status] ?? STATUS_CONFIG.trial;
          const isExpanded = expandedId === tenant.id;
          const usagePct = Math.min(100, Math.round(((tenant.usedThisMonth ?? 0) / (tenant.monthlyQuota ?? 100)) * 100));

          return (
            <TenantCard
              key={tenant.id}
              tenant={tenant}
              pc={pc}
              sc={sc}
              usagePct={usagePct}
              isExpanded={isExpanded}
              onToggle={() => setExpandedId(isExpanded ? null : tenant.id)}
              onSuspend={() => suspendMut.mutate({ id: tenant.id })}
              onReactivate={() => reactivateMut.mutate({ id: tenant.id })}
              getTab={getTab}
              setExpandedTab={setExpandedTab}
              // Keys
              visibleKeys={visibleKeys}
              toggleKeyVisible={toggleKeyVisible}
              newKeyName={newKeyName[tenant.id] ?? ''}
              onNewKeyNameChange={(v: string) => setNewKeyName(p => ({ ...p, [tenant.id]: v }))}
              onGenerateKey={() => handleGenerateKey(tenant.id)}
              onRevokeKey={(id: number) => revokeKeyMut.mutate({ id })}
              onRotateKey={(id: number) => rotateKeyMut.mutate({ id })}
              rotatingKeyId={rotateKeyMut.isPending ? (rotateKeyMut.variables as any)?.id : null}
              // Webhooks
              newWebhookUrl={newWebhookUrl[tenant.id] ?? ''}
              onWebhookUrlChange={(v: string) => setNewWebhookUrl(p => ({ ...p, [tenant.id]: v }))}
              newWebhookEvents={newWebhookEvents[tenant.id] ?? new Set()}
              onToggleWebhookEvent={(ev: string) => toggleWebhookEvent(tenant.id, ev)}
              onAddWebhook={() => handleAddWebhook(tenant.id)}
              onDeleteWebhook={(id: number) => deleteWebhookMut.mutate({ id })}
              onTestWebhook={(id: number) => testWebhookMut.mutate({ id })}
              testingWebhookId={testWebhookMut.isPending ? (testWebhookMut.variables as any)?.id : null}
            />
          );
        })}
      </div>
    </BISLayout>
  );
}

// ─── TenantCard sub-component ─────────────────────────────────────────────────

function TenantCard({ tenant, pc, sc, usagePct, isExpanded, onToggle, onSuspend, onReactivate, getTab, setExpandedTab, visibleKeys, toggleKeyVisible, newKeyName, onNewKeyNameChange, onGenerateKey, onRevokeKey, onRotateKey, rotatingKeyId, newWebhookUrl, onWebhookUrlChange, newWebhookEvents, onToggleWebhookEvent, onAddWebhook, onDeleteWebhook, onTestWebhook, testingWebhookId }: any) {
  const utils = trpc.useUtils();
  const { data: keys = [], isLoading: keysLoading } = trpc.tenants.listKeys.useQuery(
    { tenantId: tenant.id }, { enabled: isExpanded && getTab(tenant.id) === 'keys' }
  );
  const { data: whooks = [], isLoading: whLoading } = trpc.tenants.listWebhooks.useQuery(
    { tenantId: tenant.id }, { enabled: isExpanded && getTab(tenant.id) === 'webhooks' }
  );

  // ── Logo upload ──
  const [logoPreview, setLogoPreview] = useState<string | null>(tenant.logoUrl ?? null);
  const [logoUploading, setLogoUploading] = useState(false);
  const updateLogoMut = trpc.tenants.updateLogo.useMutation({
    onSuccess: (r) => {
      setLogoPreview(r.logoUrl);
      toast.success('Logo updated');
      utils.tenants.list.invalidate();
    },
    onError: (e: any) => toast.error('Logo upload failed', { description: e.message }),
    onSettled: () => setLogoUploading(false),
  });

  const handleLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('Logo must be under 2 MB'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUri = ev.target?.result as string;
      setLogoPreview(dataUri);
      setLogoUploading(true);
      updateLogoMut.mutate({
        id: tenant.id,
        dataUri,
        mimeType: file.type as any,
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="bis-card overflow-hidden">
      {/* ── Header row ── */}
      <div className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/20 transition-colors" onClick={onToggle}>
        <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 overflow-hidden">
          {logoPreview
            ? <img src={logoPreview} alt={tenant.name} className="w-full h-full object-cover" />
            : <Building2 size={15} className="text-primary" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground text-sm">{tenant.name}</span>
            <Badge variant="outline" className={cn("text-[10px] h-4 px-1.5 capitalize", pc.color)}>{pc.label}</Badge>
            <span className={cn("bis-badge", sc.cls)}>{sc.label}</span>
            {tenant.country && <span className="text-[10px] text-muted-foreground font-mono">{tenant.country}</span>}
          </div>
          <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground font-mono">
            <span>{(tenant.usedThisMonth ?? 0).toLocaleString()} / {(tenant.monthlyQuota ?? 0).toLocaleString()} calls</span>
            <span>·</span>
            <span>Since {new Date(tenant.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
          </div>
        </div>

        {/* Usage bar */}
        <div className="w-28 shrink-0 hidden sm:block">
          <div className="flex justify-between text-[9px] text-muted-foreground mb-1">
            <span>Usage</span><span>{usagePct}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full transition-all",
              usagePct > 90 ? "bg-red-500" : usagePct > 70 ? "bg-amber-500" : "bg-primary"
            )} style={{ width: `${usagePct}%` }} />
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {tenant.status === "suspended"
            ? <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={e => { e.stopPropagation(); onReactivate(); }}>Activate</Button>
            : <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={e => { e.stopPropagation(); onSuspend(); }}>Suspend</Button>
          }
          {isExpanded ? <ChevronUp size={14} className="text-muted-foreground ml-1" /> : <ChevronDown size={14} className="text-muted-foreground ml-1" />}
        </div>
      </div>

      {/* ── Expanded panel ── */}
      {isExpanded && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          {/* Logo upload strip */}
          <div className="flex items-center gap-3 mb-3 p-2.5 rounded-lg bg-muted/20 border border-border/50">
            <div className="w-10 h-10 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center overflow-hidden shrink-0">
              {logoPreview
                ? <img src={logoPreview} alt="logo" className="w-full h-full object-cover" />
                : <Building2 size={14} className="text-primary" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-foreground">Organization Logo</p>
              <p className="text-[9px] text-muted-foreground">PNG, JPG, WebP or SVG — max 2 MB. Used in PDF report headers.</p>
            </div>
            <label className={cn(
              "flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1.5 rounded border cursor-pointer transition-colors",
              logoUploading
                ? "border-border text-muted-foreground cursor-not-allowed"
                : "border-primary/30 text-primary bg-primary/5 hover:bg-primary/15"
            )}>
              {logoUploading
                ? <><Loader2 size={10} className="animate-spin" /> Uploading…</>
                : <><RefreshCw size={10} /> {logoPreview ? 'Replace' : 'Upload'}</>
              }
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="sr-only" disabled={logoUploading} onChange={handleLogoFile} />
            </label>
          </div>

          {/* Tab bar */}
          <div className="flex items-center gap-1 mb-3 border-b border-border pb-2">
            {(['keys', 'webhooks'] as const).map(tab => (
              <button key={tab}
                onClick={() => setExpandedTab((p: any) => ({ ...p, [tenant.id]: tab }))}
                className={cn(
                  "flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1 rounded-md transition-colors",
                  getTab(tenant.id) === tab
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab === 'keys' ? <Key size={10} /> : <Webhook size={10} />}
                {tab === 'keys' ? `API Keys (${keys.filter((k: any) => k.status === 'active').length})` : `Webhooks (${whooks.length})`}
              </button>
            ))}
            <div className="ml-auto">
              <a
                href={`/tenants/${tenant.id}/settings`}
                onClick={e => e.stopPropagation()}
                className="flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1 rounded-md transition-colors text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 border border-transparent hover:border-violet-500/20"
              >
                <Palette size={10} /> Branding Settings
              </a>
            </div>
          </div>

          {/* ── Keys tab ── */}
          {getTab(tenant.id) === 'keys' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Key size={12} className="text-primary" /> API Keys
                </h4>
                <div className="flex items-center gap-1.5">
                  <Input className="h-6 text-[10px] w-28" placeholder="Key name…"
                    value={newKeyName} onChange={e => onNewKeyNameChange(e.target.value)} />
                  <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1" onClick={onGenerateKey}>
                    <Plus size={10} /> Generate
                  </Button>
                </div>
              </div>

              {keysLoading && <div className="flex items-center gap-2 py-4 text-muted-foreground text-xs"><Loader2 size={12} className="animate-spin" /> Loading keys…</div>}
              <div className="space-y-2">
                {keys.map((apiKey: any) => {
                  const ksc = KEY_STATUS_CONFIG[apiKey.status] ?? KEY_STATUS_CONFIG.expired;
                  const isVisible = visibleKeys.has(apiKey.id);
                  const isRotating = rotatingKeyId === apiKey.id;
                  return (
                    <div key={apiKey.id} className={cn(
                      "rounded-lg border p-3 transition-colors",
                      apiKey.status === "active"  ? "border-border bg-muted/20" :
                      apiKey.status === "revoked" ? "border-red-500/20 bg-red-500/5 opacity-60" :
                      "border-border/50 bg-muted/10 opacity-50"
                    )}>
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-xs font-medium text-foreground">{apiKey.name}</span>
                            <span className={cn("text-[9px] font-mono", ksc.color)}>{ksc.label}</span>
                          </div>
                          <div className="flex items-center gap-1.5 p-1.5 rounded bg-muted/40 border border-border/50">
                            <code className="text-[10px] font-mono text-muted-foreground flex-1 truncate">
                              {isVisible ? `${apiKey.keyPrefix}…` : maskKey(apiKey.keyPrefix)}
                            </code>
                            <button onClick={() => toggleKeyVisible(apiKey.id)}
                              className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                              {isVisible ? <EyeOff size={11} /> : <Eye size={11} />}
                            </button>
                          </div>
                          <div className="flex items-center gap-3 mt-1.5 text-[9px] font-mono text-muted-foreground">
                            <span className="flex items-center gap-1"><Clock size={9} /> Created {relTime(apiKey.createdAt)}</span>
                            {apiKey.lastUsedAt && <><span>·</span><span>Last used: {relTime(apiKey.lastUsedAt)}</span></>}
                          </div>
                        </div>
                        {apiKey.status === "active" && (
                          <div className="flex items-center gap-1 shrink-0 ml-2">
                            <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1"
                              disabled={isRotating} onClick={() => onRotateKey(apiKey.id)}>
                              {isRotating ? <Loader2 size={9} className="animate-spin" /> : <RotateCcw size={9} />}
                              {isRotating ? "Rotating…" : "Rotate"}
                            </Button>
                            <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1 text-red-400 hover:text-red-400 hover:border-red-500/30"
                              onClick={() => onRevokeKey(apiKey.id)}>
                              <Trash2 size={9} /> Revoke
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {!keysLoading && keys.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">No API keys yet. Generate one above.</p>
                )}
              </div>
              <p className="text-[9px] font-mono text-muted-foreground/50 mt-3">
                Revoked keys are shown for audit purposes only. Key changes are logged to the Audit Log.
              </p>
            </div>
          )}

          {/* ── Webhooks tab ── */}
          {getTab(tenant.id) === 'webhooks' && (
            <div className="space-y-3">
              {whLoading && <div className="flex items-center gap-2 py-4 text-muted-foreground text-xs"><Loader2 size={12} className="animate-spin" /> Loading webhooks…</div>}
              {!whLoading && whooks.length === 0 && (
                <p className="text-xs text-muted-foreground py-2">No webhook endpoints registered yet.</p>
              )}
              {whooks.map((wh: any) => (
                <div key={wh.id} className={cn(
                  "rounded-lg border p-3 space-y-2",
                  wh.status === 'failed' ? 'border-red-500/30 bg-red-500/5' : 'border-border bg-muted/20'
                )}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <code className="text-[10px] font-mono text-foreground truncate">{wh.url}</code>
                        <span className={cn(
                          "text-[9px] font-mono rounded px-1.5 py-0.5 border shrink-0",
                          wh.status === 'active' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' :
                          wh.status === 'failed' ? 'text-red-400 bg-red-500/10 border-red-500/30' :
                          'text-muted-foreground bg-muted/30 border-border'
                        )}>{wh.status.toUpperCase()}</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mb-1">
                        {(wh.events ?? []).map((ev: string) => (
                          <span key={ev} className="text-[9px] font-mono bg-primary/10 text-primary border border-primary/20 rounded px-1.5 py-0.5">{ev}</span>
                        ))}
                      </div>
                      <div className="flex items-center gap-3 text-[9px] font-mono text-muted-foreground">
                        <span>Last delivery: {wh.lastDeliveredAt ? relTime(wh.lastDeliveredAt) : 'Never'}</span>
                        {(wh.failureCount ?? 0) > 0 && <><span>·</span><span className="text-red-400">{wh.failureCount} failures</span></>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1"
                        disabled={testingWebhookId === wh.id} onClick={() => onTestWebhook(wh.id)}>
                        {testingWebhookId === wh.id ? <Loader2 size={9} className="animate-spin" /> : <Send size={9} />}
                        {testingWebhookId === wh.id ? 'Sending…' : 'Test'}
                      </Button>
                      <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 gap-1 text-red-400 hover:text-red-400 hover:border-red-500/30"
                        onClick={() => onDeleteWebhook(wh.id)}>
                        <Trash2 size={9} /> Remove
                      </Button>
                    </div>
                  </div>
                </div>
              ))}

              {/* Add new webhook form */}
              <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
                <p className="text-[10px] font-semibold text-foreground">Register new endpoint</p>
                <Input className="h-7 text-xs font-mono" placeholder="https://your-server.com/bis-webhook"
                  value={newWebhookUrl} onChange={e => onWebhookUrlChange(e.target.value)} />
                <div className="flex flex-wrap gap-1">
                  {ALL_EVENTS.map(ev => {
                    const selected = newWebhookEvents.has(ev);
                    return (
                      <button key={ev} onClick={() => onToggleWebhookEvent(ev)}
                        className={cn(
                          "text-[9px] font-mono rounded px-1.5 py-0.5 border transition-colors",
                          selected
                            ? 'bg-primary/10 text-primary border-primary/30'
                            : 'text-muted-foreground border-border hover:border-primary/30 hover:text-foreground'
                        )}>
                        {selected && <CheckSquare size={8} className="inline mr-0.5" />}{ev}
                      </button>
                    );
                  })}
                </div>
                <Button size="sm" className="h-6 text-[10px] gap-1" onClick={onAddWebhook}>
                  <Plus size={9} /> Register Endpoint
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
