// BIS Tenants & API Keys Management Page
import { useState } from "react";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Building2, Plus, Key, Copy, Eye, EyeOff, Trash2,
  Search, Shield, Activity, Globe, Loader2, CheckCircle2
} from "lucide-react";

interface Tenant {
  id: string;
  name: string;
  plan: "starter" | "growth" | "enterprise";
  status: "active" | "suspended" | "trial";
  apiCalls: number;
  quota: number;
  country: string;
  createdAt: string;
  apiKey: string;
}

const mockTenants: Tenant[] = [
  { id: "t1", name: "TourismPay Platform", plan: "enterprise", status: "active", apiCalls: 8420, quota: 100000, country: "NG", createdAt: "2026-01-01T00:00:00Z", apiKey: "bis_live_tp_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6" },
  { id: "t2", name: "Konga Merchant Services", plan: "growth", status: "active", apiCalls: 1240, quota: 10000, country: "NG", createdAt: "2026-02-15T00:00:00Z", apiKey: "bis_live_km_q1r2s3t4u5v6w7x8y9z0a1b2c3d4e5f6" },
  { id: "t3", name: "Flutterwave Compliance", plan: "enterprise", status: "active", apiCalls: 22100, quota: 100000, country: "NG", createdAt: "2026-01-20T00:00:00Z", apiKey: "bis_live_fw_g1h2i3j4k5l6m7n8o9p0q1r2s3t4u5v6" },
  { id: "t4", name: "Paystack Risk Team", plan: "growth", status: "trial", apiCalls: 340, quota: 10000, country: "NG", createdAt: "2026-03-10T00:00:00Z", apiKey: "bis_test_ps_w1x2y3z4a5b6c7d8e9f0g1h2i3j4k5l6" },
  { id: "t5", name: "GTBank Digital", plan: "starter", status: "suspended", apiCalls: 0, quota: 1000, country: "NG", createdAt: "2026-02-01T00:00:00Z", apiKey: "bis_live_gt_m1n2o3p4q5r6s7t8u9v0w1x2y3z4a5b6" },
];

const planColor: Record<string, string> = {
  starter: "text-muted-foreground border-border",
  growth: "text-blue-400 border-blue-500/30",
  enterprise: "text-amber-400 border-amber-500/30",
};

const statusColor: Record<string, string> = {
  active: "bis-badge-success",
  suspended: "bis-badge-danger",
  trial: "bis-badge-warning",
};

export default function Tenants() {
  const [search, setSearch] = useState("");
  const [tenants, setTenants] = useState<Tenant[]>(mockTenants);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTenant, setNewTenant] = useState({ name: "", plan: "growth", country: "NG" });

  const filtered = tenants.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.country.toLowerCase().includes(search.toLowerCase())
  );

  const toggleKey = (id: string) => {
    setVisibleKeys(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    toast.success("API key copied to clipboard");
  };

  const handleCreate = async () => {
    if (!newTenant.name.trim()) { toast.error("Tenant name is required"); return; }
    setCreating(true);
    await new Promise(r => setTimeout(r, 1000));
    const newT: Tenant = {
      id: `t${Date.now()}`,
      name: newTenant.name,
      plan: newTenant.plan as Tenant["plan"],
      status: "trial",
      apiCalls: 0,
      quota: newTenant.plan === "starter" ? 1000 : newTenant.plan === "growth" ? 10000 : 100000,
      country: newTenant.country,
      createdAt: new Date().toISOString(),
      apiKey: `bis_live_${Math.random().toString(36).slice(2, 6)}_${Math.random().toString(36).slice(2, 34)}`,
    };
    setTenants(prev => [newT, ...prev]);
    setCreating(false);
    setCreateOpen(false);
    toast.success(`Tenant "${newT.name}" created`);
    setNewTenant({ name: "", plan: "growth", country: "NG" });
  };

  const handleSuspend = (id: string, name: string) => {
    setTenants(prev => prev.map(t => t.id === id ? { ...t, status: t.status === "suspended" ? "active" : "suspended" } : t));
    toast.info(`Tenant "${name}" status updated`);
  };

  const maskKey = (key: string) => key.slice(0, 12) + "••••••••••••••••••••" + key.slice(-4);

  return (
    <BISLayout
      title="Tenants"
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
                  <Select value={newTenant.plan} onValueChange={v => setNewTenant(p => ({ ...p, plan: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starter">Starter (1K calls/mo)</SelectItem>
                      <SelectItem value="growth">Growth (10K calls/mo)</SelectItem>
                      <SelectItem value="enterprise">Enterprise (100K calls/mo)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Country</Label>
                  <Select value={newTenant.country} onValueChange={v => setNewTenant(p => ({ ...p, country: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NG">Nigeria</SelectItem>
                      <SelectItem value="GH">Ghana</SelectItem>
                      <SelectItem value="KE">Kenya</SelectItem>
                      <SelectItem value="ZA">South Africa</SelectItem>
                      <SelectItem value="GB">United Kingdom</SelectItem>
                      <SelectItem value="US">United States</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={handleCreate} disabled={creating}>
                  {creating ? <><Loader2 size={12} className="animate-spin mr-1" />Creating...</> : "Create Tenant"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      }
    >
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: "Total Tenants", value: tenants.length, icon: <Building2 size={14} /> },
          { label: "Active", value: tenants.filter(t => t.status === "active").length, icon: <CheckCircle2 size={14} className="text-emerald-400" /> },
          { label: "Enterprise", value: tenants.filter(t => t.plan === "enterprise").length, icon: <Shield size={14} className="text-amber-400" /> },
          { label: "API Calls (30d)", value: tenants.reduce((s, t) => s + t.apiCalls, 0).toLocaleString(), icon: <Activity size={14} className="text-blue-400" /> },
        ].map(stat => (
          <div key={stat.label} className="bis-card p-3 flex items-center gap-3">
            <div className="text-muted-foreground">{stat.icon}</div>
            <div>
              <div className="text-lg font-bold font-mono text-foreground">{stat.value}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm mb-4">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8 h-8 text-sm" placeholder="Search tenants..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Tenant cards */}
      <div className="space-y-3">
        {filtered.map(tenant => (
          <div key={tenant.id} className="bis-card p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <Building2 size={15} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-foreground">{tenant.name}</span>
                  <Badge variant="outline" className={`text-[10px] h-4 px-1.5 capitalize ${planColor[tenant.plan]}`}>{tenant.plan}</Badge>
                  <span className={`bis-badge ${statusColor[tenant.status]}`}>{tenant.status}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{tenant.country}</span>
                </div>

                {/* API Key */}
                <div className="flex items-center gap-2 mt-2 p-2 rounded-md bg-muted/30 border border-border/50">
                  <Key size={11} className="text-muted-foreground shrink-0" />
                  <code className="text-[10px] font-mono text-muted-foreground flex-1 truncate">
                    {visibleKeys.has(tenant.id) ? tenant.apiKey : maskKey(tenant.apiKey)}
                  </code>
                  <button onClick={() => toggleKey(tenant.id)} className="text-muted-foreground hover:text-foreground transition-colors">
                    {visibleKeys.has(tenant.id) ? <EyeOff size={11} /> : <Eye size={11} />}
                  </button>
                  <button onClick={() => copyKey(tenant.apiKey)} className="text-muted-foreground hover:text-foreground transition-colors">
                    <Copy size={11} />
                  </button>
                </div>

                {/* Usage bar */}
                <div className="mt-2">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                    <span>API Usage (30d)</span>
                    <span className="font-mono">{tenant.apiCalls.toLocaleString()} / {tenant.quota.toLocaleString()}</span>
                  </div>
                  <div className="h-1 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${Math.min(100, (tenant.apiCalls / tenant.quota) * 100)}%` }} />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Button variant="outline" size="sm" className="h-6 text-[10px] px-2"
                  onClick={() => handleSuspend(tenant.id, tenant.name)}>
                  {tenant.status === "suspended" ? "Activate" : "Suspend"}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </BISLayout>
  );
}
