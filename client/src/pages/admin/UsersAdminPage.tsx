/**
 * Admin Users Management Page
 * ============================
 * Lists all platform users, allows admins to change roles and deactivate accounts.
 * Role-gated: only admins can access this page.
 */

import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Search, RefreshCw, ShieldAlert, Users, UserCheck,
  UserX, Loader2, Crown, Eye, Shield, BarChart2, ClipboardCheck
} from "lucide-react";

type UserRole = "admin" | "analyst" | "supervisor" | "auditor" | "readonly" | "user";

const ROLE_CONFIG: Record<UserRole, { label: string; color: string; icon: React.ReactNode }> = {
  admin:      { label: "Admin",      color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",       icon: <Crown className="w-3 h-3" /> },
  analyst:    { label: "Analyst",    color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",   icon: <BarChart2 className="w-3 h-3" /> },
  supervisor: { label: "Supervisor", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300", icon: <Shield className="w-3 h-3" /> },
  auditor:    { label: "Auditor",    color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300", icon: <ClipboardCheck className="w-3 h-3" /> },
  readonly:   { label: "Read-only",  color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",      icon: <Eye className="w-3 h-3" /> },
  user:       { label: "User",       color: "bg-muted text-muted-foreground",                                      icon: <UserCheck className="w-3 h-3" /> },
};

const ASSIGNABLE_ROLES: UserRole[] = ["admin", "analyst", "supervisor", "auditor", "readonly"];

type UserRow = {
  id: number;
  name: string | null;
  email: string | null;
  role: UserRole;
  createdAt: Date;
  lastSignedIn: Date | null;
};

function RoleBadge({ role }: { role: UserRole }) {
  const cfg = ROLE_CONFIG[role] ?? ROLE_CONFIG.readonly;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

export default function UsersAdminPage() {
  const { user: currentUser } = useAuth();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [newRole, setNewRole] = useState<UserRole>("analyst");
  const [deactivateTarget, setDeactivateTarget] = useState<UserRow | null>(null);
  const [, navigate] = useLocation();

  // Role guard
  if (currentUser && currentUser.role !== "admin") {
    return (
      <BISLayout title="Users" subtitle="User management">
        <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
          <ShieldAlert className="w-12 h-12 text-destructive opacity-60" />
          <h2 className="text-xl font-semibold">Restricted Area</h2>
          <p className="text-muted-foreground max-w-sm">
            You need <strong>Admin</strong> privileges to manage users.
            Contact your system administrator to request access.
          </p>
        </div>
      </BISLayout>
    );
  }

  const { data: allUsers = [], isLoading, refetch } = trpc.users.list.useQuery({
    search: search.length >= 2 ? search : undefined,
    limit: 500,
  });

  const updateRoleMutation = trpc.users.updateRole.useMutation({
    onSuccess: (_, vars) => {
      toast.success(`Role updated to ${vars.role}`);
      setEditTarget(null);
      refetch();
    },
    onError: (e) => toast.error(`Failed to update role: ${e.message}`),
  });

  const deactivateMutation = trpc.users.deactivate.useMutation({
    onSuccess: () => {
      toast.success("User deactivated (set to read-only)");
      setDeactivateTarget(null);
      refetch();
    },
    onError: (e) => toast.error(`Failed to deactivate: ${e.message}`),
  });

  const filtered = useMemo(() => {
    return (allUsers as UserRow[]).filter(u => {
      const matchRole = roleFilter === "all" || u.role === roleFilter;
      const q = search.toLowerCase();
      const matchSearch = !q ||
        (u.name ?? "").toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q);
      return matchRole && matchSearch;
    });
  }, [allUsers, roleFilter, search]);

  const roleCounts = useMemo(() => {
    const c: Record<string, number> = {};
    (allUsers as UserRow[]).forEach(u => { c[u.role] = (c[u.role] ?? 0) + 1; });
    return c;
  }, [allUsers]);

  const handleEditRole = (u: UserRow) => {
    setNewRole(u.role as UserRole);
    setEditTarget(u);
  };

  return (
    <BISLayout title="User Management" subtitle="Manage platform users and their access roles">
      {/* ── Toolbar ── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={roleFilter} onValueChange={v => setRoleFilter(v as UserRole | "all")}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles ({allUsers.length})</SelectItem>
            {ASSIGNABLE_ROLES.map(r => (
              <SelectItem key={r} value={r}>
                {ROLE_CONFIG[r].label} ({roleCounts[r] ?? 0})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* ── Role Summary Tiles ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {ASSIGNABLE_ROLES.map(r => (
          <div
            key={r}
            className={`bg-card border rounded-lg p-3 text-center cursor-pointer transition-all
              ${roleFilter === r ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/40"}`}
            onClick={() => setRoleFilter(roleFilter === r ? "all" : r)}
          >
            <div className="text-2xl font-bold text-foreground">{roleCounts[r] ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{ROLE_CONFIG[r].label}</div>
          </div>
        ))}
      </div>

      {/* ── Users Table ── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading users…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
            <Users className="w-8 h-8 opacity-40" />
            <p className="text-sm">No users match the current filter</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">User</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Joined</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Last Active</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u, i) => (
                  <tr
                    key={u.id}
                    className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{u.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{u.email ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={u.role as UserRole} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {u.lastSignedIn ? new Date(u.lastSignedIn).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* Don't allow editing your own role */}
                        {u.id !== currentUser?.id && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs"
                              onClick={() => handleEditRole(u)}
                            >
                              <Shield className="w-3 h-3 mr-1" /> Change Role
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-muted-foreground"
                              onClick={() => navigate(`/audit-log?userId=${u.id}`)}
                            >
                              <ClipboardCheck className="w-3 h-3 mr-1" /> Audit Log
                            </Button>
                            {u.role !== "readonly" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs text-destructive hover:text-destructive"
                                onClick={() => setDeactivateTarget(u)}
                              >
                                <UserX className="w-3 h-3 mr-1" /> Deactivate
                              </Button>
                            )}
                          </>
                        )}
                        {u.id === currentUser?.id && (
                          <span className="text-xs text-muted-foreground italic">You</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-border/50 bg-muted/10 text-xs text-muted-foreground">
              Showing {filtered.length} of {allUsers.length} users
            </div>
          </div>
        )}
      </div>

      {/* ── Change Role Dialog ── */}
      <Dialog open={!!editTarget} onOpenChange={open => { if (!open) setEditTarget(null); }}>
        <DialogContent className="max-w-sm">
          {editTarget && (
            <>
              <DialogHeader>
                <DialogTitle>Change Role</DialogTitle>
                <DialogDescription>
                  Update the platform role for <strong>{editTarget.name ?? editTarget.email}</strong>.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-2">
                <Select value={newRole} onValueChange={v => setNewRole(v as UserRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE_ROLES.map(r => (
                      <SelectItem key={r} value={r}>
                        <div className="flex items-center gap-2">
                          {ROLE_CONFIG[r].icon}
                          {ROLE_CONFIG[r].label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="mt-3 text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
                  <strong>Role permissions:</strong>
                  <ul className="mt-1 space-y-0.5">
                    <li><strong>Admin</strong> — full access, user management, settings</li>
                    <li><strong>Supervisor</strong> — approve/reject investigations and KYC</li>
                    <li><strong>Analyst</strong> — create and work investigations</li>
                    <li><strong>Auditor</strong> — read-only access + audit log</li>
                    <li><strong>Read-only</strong> — view only, no mutations</li>
                  </ul>
                </div>
              </div>
              <DialogFooter className="mt-4 gap-2">
                <Button variant="ghost" onClick={() => setEditTarget(null)}>Cancel</Button>
                <Button
                  disabled={newRole === editTarget.role || updateRoleMutation.isPending}
                  onClick={() => updateRoleMutation.mutate({ id: editTarget.id, role: newRole as "admin" | "analyst" | "supervisor" | "auditor" | "readonly" })}
                >
                  {updateRoleMutation.isPending
                    ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Saving…</>
                    : "Save Role"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Deactivate Confirm Dialog ── */}
      <Dialog open={!!deactivateTarget} onOpenChange={open => { if (!open) setDeactivateTarget(null); }}>
        <DialogContent className="max-w-sm">
          {deactivateTarget && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-destructive">
                  <UserX className="w-5 h-5" /> Deactivate User
                </DialogTitle>
                <DialogDescription>
                  This will set <strong>{deactivateTarget.name ?? deactivateTarget.email}</strong>'s role
                  to <strong>Read-only</strong>, preventing any mutations. This can be reversed by changing
                  their role again.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-4 gap-2">
                <Button variant="ghost" onClick={() => setDeactivateTarget(null)}>Cancel</Button>
                <Button
                  variant="destructive"
                  disabled={deactivateMutation.isPending}
                  onClick={() => deactivateMutation.mutate({ id: deactivateTarget.id })}
                >
                  {deactivateMutation.isPending
                    ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Deactivating…</>
                    : "Deactivate"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </BISLayout>
  );
}
