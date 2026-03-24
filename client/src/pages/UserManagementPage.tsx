// UserManagementPage — Admin user management with role editor and deactivate
// Design: Forensic Intelligence theme, semantic CSS variables

import { useState } from "react";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Search, Plus, X, Shield, UserCheck, UserX, Edit2,
  CheckCircle2, Clock, AlertTriangle, Key, Eye, EyeOff,
  Mail, Globe, Lock, Unlock, MoreHorizontal, Users
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type UserRole = "admin" | "supervisor" | "analyst" | "viewer" | "api_only";
type UserStatus = "active" | "inactive" | "suspended" | "pending";

interface BISUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  lastLogin: string;
  lastIp: string;
  createdAt: string;
  mfaEnabled: boolean;
  investigationsCount: number;
  reportsCount: number;
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const SEED_USERS: BISUser[] = [
  { id: "u1", name: "Operator Admin",  email: "admin@bis.platform",       role: "admin",      status: "active",    lastLogin: "2026-03-24T09:02:00Z", lastIp: "197.210.54.12", createdAt: "2025-01-10", mfaEnabled: true,  investigationsCount: 847, reportsCount: 203 },
  { id: "u2", name: "Amaka Obi",       email: "amaka.obi@bis.platform",   role: "analyst",    status: "active",    lastLogin: "2026-03-24T08:47:00Z", lastIp: "41.58.22.100",  createdAt: "2025-03-15", mfaEnabled: true,  investigationsCount: 312, reportsCount: 88  },
  { id: "u3", name: "Chidi Nwosu",     email: "chidi.nwosu@bis.platform", role: "analyst",    status: "active",    lastLogin: "2026-03-24T08:30:00Z", lastIp: "102.89.47.3",   createdAt: "2025-03-20", mfaEnabled: false, investigationsCount: 289, reportsCount: 71  },
  { id: "u4", name: "Fatima Bello",    email: "fatima.bello@bis.platform",role: "supervisor", status: "active",    lastLogin: "2026-03-24T07:55:00Z", lastIp: "197.211.60.44", createdAt: "2025-02-01", mfaEnabled: true,  investigationsCount: 521, reportsCount: 142 },
  { id: "u5", name: "Emeka Okafor",    email: "emeka.okafor@bis.platform",role: "analyst",    status: "inactive",  lastLogin: "2026-02-14T14:22:00Z", lastIp: "41.76.108.55",  createdAt: "2025-04-10", mfaEnabled: false, investigationsCount: 47,  reportsCount: 12  },
  { id: "u6", name: "Ngozi Adeyemi",   email: "ngozi.a@bis.platform",     role: "viewer",     status: "active",    lastLogin: "2026-03-23T16:10:00Z", lastIp: "197.210.54.99", createdAt: "2025-06-01", mfaEnabled: false, investigationsCount: 0,   reportsCount: 5   },
  { id: "u7", name: "API Integration", email: "api@bis.platform",         role: "api_only",   status: "active",    lastLogin: "2026-03-24T09:01:00Z", lastIp: "10.0.0.1",      createdAt: "2025-01-10", mfaEnabled: false, investigationsCount: 0,   reportsCount: 0   },
  { id: "u8", name: "Bola Adeleke",    email: "bola.a@bis.platform",      role: "analyst",    status: "suspended", lastLogin: "2026-03-10T11:00:00Z", lastIp: "41.58.22.200",  createdAt: "2025-05-20", mfaEnabled: false, investigationsCount: 83,  reportsCount: 22  },
  { id: "u9", name: "Yusuf Musa",      email: "yusuf.m@bis.platform",     role: "analyst",    status: "pending",   lastLogin: "—",                    lastIp: "—",             createdAt: "2026-03-20", mfaEnabled: false, investigationsCount: 0,   reportsCount: 0   },
];

// ─── Config ───────────────────────────────────────────────────────────────────

const ROLE_CONFIG: Record<UserRole, { label: string; color: string; bg: string }> = {
  admin:     { label: "Admin",      color: "text-red-400",     bg: "bg-red-500/15 border-red-500/30" },
  supervisor:{ label: "Supervisor", color: "text-violet-400",  bg: "bg-violet-500/15 border-violet-500/30" },
  analyst:   { label: "Analyst",    color: "text-primary",     bg: "bg-primary/15 border-primary/30" },
  viewer:    { label: "Viewer",     color: "text-muted-foreground", bg: "bg-muted border-border" },
  api_only:  { label: "API Only",   color: "text-amber-400",   bg: "bg-amber-500/15 border-amber-500/30" },
};

const STATUS_CONFIG: Record<UserStatus, { label: string; color: string; icon: React.ReactNode }> = {
  active:    { label: "Active",    color: "text-emerald-500", icon: <CheckCircle2 size={11} /> },
  inactive:  { label: "Inactive",  color: "text-muted-foreground", icon: <Clock size={11} /> },
  suspended: { label: "Suspended", color: "text-red-500",     icon: <AlertTriangle size={11} /> },
  pending:   { label: "Pending",   color: "text-amber-500",   icon: <Clock size={11} /> },
};

function relTime(iso: string): string {
  if (iso === "—") return "—";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Edit Role Modal ──────────────────────────────────────────────────────────

function EditRoleModal({
  user, onSave, onClose
}: { user: BISUser; onSave: (id: string, role: UserRole) => void; onClose: () => void }) {
  const [role, setRole] = useState<UserRole>(user.role);
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-popover border border-border rounded-xl shadow-2xl w-full max-w-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Edit Role — {user.name}</h3>
            <button onClick={onClose}><X size={14} className="text-muted-foreground" /></button>
          </div>
          <p className="text-xs text-muted-foreground mb-4">{user.email}</p>
          <div className="space-y-2 mb-5">
            {(Object.keys(ROLE_CONFIG) as UserRole[]).map(r => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-all",
                  role === r
                    ? `${ROLE_CONFIG[r].bg} ${ROLE_CONFIG[r].color} border-current/40`
                    : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                )}
              >
                <span className="font-mono text-xs">{ROLE_CONFIG[r].label}</span>
                {role === r && <CheckCircle2 size={12} />}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={onClose}>Cancel</Button>
            <Button size="sm" className="flex-1 h-8 text-xs" onClick={() => { onSave(user.id, role); onClose(); }}>
              Save Role
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Invite Modal ─────────────────────────────────────────────────────────────

function InviteModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("analyst");
  const handleInvite = () => {
    if (!email.trim()) { toast.error("Enter an email address"); return; }
    toast.success(`Invitation sent to ${email}`);
    onClose();
  };
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-popover border border-border rounded-xl shadow-2xl w-full max-w-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Invite User</h3>
            <button onClick={onClose}><X size={14} className="text-muted-foreground" /></button>
          </div>
          <div className="space-y-3 mb-5">
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Email Address</label>
              <div className="relative">
                <Mail size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8 h-8 text-sm" placeholder="analyst@bis.platform" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Role</label>
              <Select value={role} onValueChange={v => setRole(v as UserRole)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_CONFIG) as UserRole[]).map(r => (
                    <SelectItem key={r} value={r}>{ROLE_CONFIG[r].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={onClose}>Cancel</Button>
            <Button size="sm" className="flex-1 h-8 text-xs gap-1" onClick={handleInvite}>
              <Mail size={11} /> Send Invite
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function UserManagementPage() {
  const [users, setUsers] = useState<BISUser[]>(SEED_USERS);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editUser, setEditUser] = useState<BISUser | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    const matchRole   = roleFilter   === "all" || u.role   === roleFilter;
    const matchStatus = statusFilter === "all" || u.status === statusFilter;
    return matchSearch && matchRole && matchStatus;
  });

  const handleRoleSave = (id: string, role: UserRole) => {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, role } : u));
    toast.success("Role updated successfully");
  };

  const toggleStatus = (id: string, current: UserStatus) => {
    const next: UserStatus = current === "active" ? "suspended" : "active";
    setUsers(prev => prev.map(u => u.id === id ? { ...u, status: next } : u));
    toast.success(`User ${next === "active" ? "reactivated" : "suspended"}`);
  };

  const activateUser = (id: string) => {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, status: "active" } : u));
    toast.success("User activated — invitation email sent");
  };

  const stats = {
    total:  users.length,
    active: users.filter(u => u.status === "active").length,
    mfa:    users.filter(u => u.mfaEnabled).length,
    suspended: users.filter(u => u.status === "suspended").length,
  };

  return (
    <BISLayout
      title="User Management"
      subtitle={`${filtered.length} of ${users.length} users`}
      actions={
        <Button size="sm" className="h-7 text-xs gap-1.5" onClick={() => setShowInvite(true)}>
          <Plus size={12} /> Invite User
        </Button>
      }
    >
      {/* ── Stats ── */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: "Total Users",  value: stats.total,     color: "text-foreground" },
          { label: "Active",       value: stats.active,    color: "text-emerald-500" },
          { label: "MFA Enabled",  value: stats.mfa,       color: "text-primary" },
          { label: "Suspended",    value: stats.suspended, color: "text-red-500" },
        ].map(s => (
          <div key={s.label} className="bis-card p-3">
            <p className={cn("text-xl font-bold font-mono", s.color)}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-52">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8 h-8 text-sm" placeholder="Search name or email…" value={search} onChange={e => setSearch(e.target.value)} />
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X size={12} /></button>}
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Role" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {(Object.keys(ROLE_CONFIG) as UserRole[]).map(r => (
              <SelectItem key={r} value={r}>{ROLE_CONFIG[r].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── Table ── */}
      <div className="bis-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {["User", "Role", "Status", "Last Login", "IP Address", "MFA", "Activity", "Actions"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(user => {
                const rc = ROLE_CONFIG[user.role];
                const sc = STATUS_CONFIG[user.status];
                return (
                  <tr key={user.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                          rc.bg, rc.color
                        )}>
                          {user.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-foreground">{user.name}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("text-[10px] font-mono rounded px-2 py-0.5 border", rc.bg, rc.color)}>
                        {rc.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className={cn("flex items-center gap-1 text-xs font-mono", sc.color)}>
                        {sc.icon}
                        {sc.label}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-mono text-foreground">{relTime(user.lastLogin)}</div>
                      <div className="text-[10px] font-mono text-muted-foreground/60">{user.lastLogin === "—" ? "" : new Date(user.lastLogin).toLocaleDateString("en-GB")}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono text-muted-foreground">{user.lastIp}</span>
                    </td>
                    <td className="px-4 py-3">
                      {user.mfaEnabled
                        ? <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-500"><Lock size={10} /> Enabled</span>
                        : <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground"><Unlock size={10} /> Disabled</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-[10px] font-mono text-muted-foreground">
                        <span className="text-foreground">{user.investigationsCount}</span> inv ·{" "}
                        <span className="text-foreground">{user.reportsCount}</span> rep
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEditUser(user)}
                          className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                          title="Edit role"
                        >
                          <Edit2 size={12} />
                        </button>
                        {user.status === "pending" ? (
                          <button
                            onClick={() => activateUser(user.id)}
                            className="p-1.5 rounded hover:bg-emerald-500/10 transition-colors text-emerald-500"
                            title="Activate user"
                          >
                            <UserCheck size={12} />
                          </button>
                        ) : (
                          <button
                            onClick={() => toggleStatus(user.id, user.status)}
                            className={cn(
                              "p-1.5 rounded transition-colors",
                              user.status === "active"
                                ? "text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                                : "text-emerald-400 hover:bg-emerald-500/10"
                            )}
                            title={user.status === "active" ? "Suspend user" : "Reactivate user"}
                          >
                            {user.status === "active" ? <UserX size={12} /> : <UserCheck size={12} />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Users size={24} className="opacity-30" />
                      <p className="text-sm">No users match your filters.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 border-t border-border/50">
          <span className="text-[10px] font-mono text-muted-foreground">
            {filtered.length} of {users.length} users · Role changes are logged to the Audit Log
          </span>
        </div>
      </div>

      {editUser && (
        <EditRoleModal user={editUser} onSave={handleRoleSave} onClose={() => setEditUser(null)} />
      )}
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
    </BISLayout>
  );
}
