// UserManagementPage — Admin user management with role editor and deactivate
// Design: Forensic Intelligence theme, semantic CSS variables

import { useState } from "react";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Search, Plus, X, UserCheck, UserX, Edit2,
  CheckCircle2, Clock, AlertTriangle, Lock, Unlock, Users,
  RefreshCw, Loader2, Mail
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type UserRole = "admin" | "supervisor" | "analyst" | "auditor" | "readonly";

// ─── Config ───────────────────────────────────────────────────────────────────

const ROLE_CONFIG: Record<UserRole, { label: string; color: string; bg: string }> = {
  admin:     { label: "Admin",      color: "text-red-400",     bg: "bg-red-500/15 border-red-500/30" },
  supervisor:{ label: "Supervisor", color: "text-violet-400",  bg: "bg-violet-500/15 border-violet-500/30" },
  analyst:   { label: "Analyst",    color: "text-primary",     bg: "bg-primary/15 border-primary/30" },
  auditor:   { label: "Auditor",    color: "text-amber-400",   bg: "bg-amber-500/15 border-amber-500/30" },
  readonly:  { label: "Read Only",  color: "text-muted-foreground", bg: "bg-muted border-border" },
};

function relTime(date: Date | null | undefined): string {
  if (!date) return "—";
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Edit Role Modal ──────────────────────────────────────────────────────────

function EditRoleModal({
  user,
  onSave,
  onClose,
  isPending,
}: {
  user: { id: number; name: string | null; email: string | null; role: string };
  onSave: (id: number, role: UserRole) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const [role, setRole] = useState<UserRole>(user.role as UserRole);
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-popover border border-border rounded-xl shadow-2xl w-full max-w-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Edit Role — {user.name ?? "User"}</h3>
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
            <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button size="sm" className="flex-1 h-8 text-xs gap-1" disabled={isPending} onClick={() => onSave(user.id, role)}>
              {isPending ? <Loader2 size={11} className="animate-spin" /> : null}
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
  const handleInvite = () => {
    if (!email.trim()) { toast.error("Enter an email address"); return; }
    toast.info(`Invitation link for ${email} — user must sign in via Manus OAuth to be added to the platform.`);
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
          <p className="text-xs text-muted-foreground mb-4">
            Users are added to the platform when they sign in via Manus OAuth for the first time. Share the platform URL with the user and they will appear here after first login.
          </p>
          <div className="space-y-3 mb-5">
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Email Address (reference)</label>
              <div className="relative">
                <Mail size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8 h-8 text-sm" placeholder="analyst@bis.platform" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={onClose}>Cancel</Button>
            <Button size="sm" className="flex-1 h-8 text-xs gap-1" onClick={handleInvite}>
              <Mail size={11} /> Note Invite
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function UserManagementPage() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [editUser, setEditUser] = useState<{ id: number; name: string | null; email: string | null; role: string } | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const utils = trpc.useUtils();

  const { data: allUsers = [], isLoading, refetch } = trpc.users.list.useQuery({
    search: search || undefined,
    role: roleFilter !== "all" ? roleFilter : undefined,
    limit: 200,
  });

  const updateRoleMut = trpc.users.updateRole.useMutation({
    onSuccess: () => {
      toast.success("Role updated successfully");
      utils.users.list.invalidate();
      setEditUser(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const deactivateMut = trpc.users.deactivate.useMutation({
    onSuccess: () => {
      toast.success("User deactivated (set to read-only)");
      utils.users.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const stats = {
    total:    allUsers.length,
    admins:   allUsers.filter(u => u.role === "admin").length,
    analysts: allUsers.filter(u => u.role === "analyst").length,
    readonly: allUsers.filter(u => u.role === "readonly").length,
  };

  return (
    <BISLayout
      title="User Management"
      subtitle={`${allUsers.length} platform users`}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => refetch()}>
            <RefreshCw size={11} /> Refresh
          </Button>
          <Button size="sm" className="h-7 text-xs gap-1.5" onClick={() => setShowInvite(true)}>
            <Plus size={12} /> Invite User
          </Button>
        </div>
      }
    >
      {/* ── Stats ── */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: "Total Users",  value: stats.total,    color: "text-foreground" },
          { label: "Admins",       value: stats.admins,   color: "text-red-400" },
          { label: "Analysts",     value: stats.analysts, color: "text-primary" },
          { label: "Read Only",    value: stats.readonly, color: "text-muted-foreground" },
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
      </div>

      {/* ── Table ── */}
      <div className="bis-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {["User", "Role", "Last Signed In", "Member Since", "Actions"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Loader2 size={20} className="animate-spin opacity-50" />
                      <p className="text-xs">Loading users…</p>
                    </div>
                  </td>
                </tr>
              ) : allUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Users size={24} className="opacity-30" />
                      <p className="text-sm">No users found. Users appear here after their first login.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                allUsers.map(user => {
                  const role = (user.role ?? "readonly") as UserRole;
                  const rc = ROLE_CONFIG[role] ?? ROLE_CONFIG.readonly;
                  return (
                    <tr key={user.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                            rc.bg, rc.color
                          )}>
                            {(user.name ?? user.email ?? "?").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-foreground">{user.name ?? "—"}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">{user.email ?? "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("text-[10px] font-mono rounded px-2 py-0.5 border", rc.bg, rc.color)}>
                          {rc.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs font-mono text-foreground">{relTime(user.lastSignedIn)}</div>
                        {user.lastSignedIn && (
                          <div className="text-[10px] font-mono text-muted-foreground/60">
                            {new Date(user.lastSignedIn).toLocaleDateString("en-GB")}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs font-mono text-muted-foreground">
                          {user.createdAt ? new Date(user.createdAt).toLocaleDateString("en-GB") : "—"}
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
                          {role === "admin" || role === "analyst" || role === "supervisor" || role === "auditor" ? (
                            <button
                              onClick={() => deactivateMut.mutate({ id: user.id })}
                              disabled={deactivateMut.isPending}
                              className="p-1.5 rounded hover:bg-red-500/10 transition-colors text-muted-foreground hover:text-red-400"
                              title="Deactivate user (set read-only)"
                            >
                              <UserX size={12} />
                            </button>
                          ) : (
                            <span className="p-1.5 text-muted-foreground/40" title="Already read-only">
                              <Lock size={12} />
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 border-t border-border/50">
          <span className="text-[10px] font-mono text-muted-foreground">
            {allUsers.length} users · Role changes are logged to the Audit Log
          </span>
        </div>
      </div>

      {editUser && (
        <EditRoleModal
          user={editUser}
          onSave={(id, role) => updateRoleMut.mutate({ id, role })}
          onClose={() => setEditUser(null)}
          isPending={updateRoleMut.isPending}
        />
      )}
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
    </BISLayout>
  );
}
