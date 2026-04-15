// KeycloakPage.tsx — Keycloak Identity Provider management
// Admin-only: user directory, role assignment, token stats, health status

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import BISLayout from "@/components/BISLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Users, Shield, Key, RefreshCw, Plus, Trash2, UserCheck,
  AlertTriangle, CheckCircle2, Search, Lock, Unlock, MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ─── Status Banner ────────────────────────────────────────────────────────────
function StatusBanner() {
  const { data: status } = trpc.keycloak.status.useQuery();
  if (!status) return null;
  return (
    <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm border ${
      status.configured
        ? "bg-emerald-950/30 border-emerald-700/40 text-emerald-300"
        : "bg-amber-950/30 border-amber-700/40 text-amber-300"
    }`}>
      {status.configured
        ? <CheckCircle2 className="h-4 w-4 shrink-0" />
        : <AlertTriangle className="h-4 w-4 shrink-0" />}
      <span>
        {status.configured
          ? `Keycloak connected — realm: ${status.realm} · issuer: ${status.issuer}`
          : "Keycloak not configured — set KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET"}
      </span>
    </div>
  );
}

// ─── Create User Dialog ───────────────────────────────────────────────────────
function CreateUserDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ username: "", email: "", firstName: "", lastName: "", password: "" });
  const create = trpc.keycloak.createUser.useMutation({
    onSuccess: () => { toast.success("User created in Keycloak"); onCreated(); onClose(); },
    onError: (e) => toast.error("Create failed: " + e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Keycloak User</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {[
            { key: "username", label: "Username", placeholder: "john.doe" },
            { key: "email", label: "Email", placeholder: "john@example.com" },
            { key: "firstName", label: "First Name", placeholder: "John" },
            { key: "lastName", label: "Last Name", placeholder: "Doe" },
            { key: "password", label: "Temporary Password", placeholder: "••••••••" },
          ].map(f => (
            <div key={f.key}>
              <Label className="text-xs">{f.label}</Label>
              <Input
                type={f.key === "password" ? "password" : "text"}
                placeholder={f.placeholder}
                value={(form as Record<string, string>)[f.key]}
                onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => create.mutate({
              username: form.username,
              email: form.email,
              firstName: form.firstName || undefined,
              lastName: form.lastName || undefined,
              password: form.password || undefined,
            })}
            disabled={create.isPending || !form.username || !form.email}
          >
            {create.isPending ? "Creating…" : "Create User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Reset Password Dialog ────────────────────────────────────────────────────
function ResetPasswordDialog({ userId, username, open, onClose }: { userId: string; username: string; open: boolean; onClose: () => void }) {
  const [newPassword, setNewPassword] = useState("");
  const reset = trpc.keycloak.resetPassword.useMutation({
    onSuccess: () => { toast.success(`Password reset for ${username}`); onClose(); },
    onError: (e) => toast.error("Reset failed: " + e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Reset Password — {username}</DialogTitle></DialogHeader>
        <div>
          <Label className="text-xs">New Password</Label>
          <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min 8 characters" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => reset.mutate({ userId, newPassword })} disabled={reset.isPending || newPassword.length < 8}>
            {reset.isPending ? "Resetting…" : "Reset Password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Assign Role Dialog ───────────────────────────────────────────────────────
function AssignRoleDialog({ userId, username, open, onClose }: { userId: string; username: string; open: boolean; onClose: () => void }) {
  const [roleName, setRoleName] = useState("");
  const { data: rolesData } = trpc.keycloak.listRoles.useQuery();
  const roles: any[] = rolesData && "roles" in rolesData ? (rolesData.roles as any[]) : [];
  const assign = trpc.keycloak.assignRole.useMutation({
    onSuccess: () => { toast.success(`Role assigned to ${username}`); onClose(); },
    onError: (e) => toast.error("Assign failed: " + e.message),
  });
  const remove = trpc.keycloak.removeRole.useMutation({
    onSuccess: () => { toast.success(`Role removed from ${username}`); onClose(); },
    onError: (e) => toast.error("Remove failed: " + e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Manage Roles — {username}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Select Role</Label>
            <select
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
              value={roleName}
              onChange={e => setRoleName(e.target.value)}
            >
              <option value="">— choose role —</option>
              {roles.map((r: any) => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive" size="sm"
            disabled={!roleName || remove.isPending}
            onClick={() => remove.mutate({ userId, roleName })}
          >Remove</Button>
          <Button
            size="sm"
            disabled={!roleName || assign.isPending}
            onClick={() => assign.mutate({ userId, roleName })}
          >Assign</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
function KeycloakPageInner() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [roleDialog, setRoleDialog] = useState<{ userId: string; username: string } | null>(null);
  const [resetDialog, setResetDialog] = useState<{ userId: string; username: string } | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  const { data: usersData, refetch, isLoading } = trpc.keycloak.listUsers.useQuery({
    first: page * PAGE_SIZE,
    max: PAGE_SIZE,
    search: search || undefined,
  });

  const { data: rolesData } = trpc.keycloak.listRoles.useQuery();

  const users: any[] = usersData && "users" in usersData ? (usersData.users as any[]) : [];
  const roles: any[] = rolesData && "roles" in rolesData ? (rolesData.roles as any[]) : [];

  const deleteUser = trpc.keycloak.deleteUser.useMutation({
    onSuccess: () => { toast.success("User deleted"); refetch(); },
    onError: (e) => toast.error("Delete failed: " + e.message),
  });

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-blue-400" />
            Keycloak Identity Provider
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage users, roles, and authentication in the BIS Keycloak realm.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New User
        </Button>
      </div>

      <StatusBanner />

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[
          { label: "Users Loaded", value: users.length, icon: Users, color: "text-blue-400" },
          { label: "Roles Defined", value: roles.length, icon: Shield, color: "text-purple-400" },
          { label: "Client ID", value: usersData && "configured" in usersData ? "bis-platform" : "—", icon: Key, color: "text-emerald-400" },
        ].map(stat => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <Icon className={`h-5 w-5 ${stat.color}`} />
                  <div>
                    <div className="text-xl font-bold">{stat.value}</div>
                    <div className="text-xs text-muted-foreground">{stat.label}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* User table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Users</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search users…"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(0); }}
                  className="pl-8 h-8 w-56 text-sm"
                />
              </div>
              <Button variant="ghost" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading users…</TableCell></TableRow>
              ) : users.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No users found — Keycloak may not be configured</TableCell></TableRow>
              ) : users.map((u: any) => (
                <TableRow key={u.id}>
                  <TableCell className="font-mono text-sm">{u.username}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{u.email ?? "—"}</TableCell>
                  <TableCell className="text-sm">{[u.firstName, u.lastName].filter(Boolean).join(" ") || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={u.enabled ? "default" : "secondary"} className="text-xs">
                      {u.enabled ? <><Unlock className="h-2.5 w-2.5 mr-1" />Active</> : <><Lock className="h-2.5 w-2.5 mr-1" />Disabled</>}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setRoleDialog({ userId: u.id, username: u.username })}>
                          <UserCheck className="h-3.5 w-3.5 mr-2" />Manage Roles
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setResetDialog({ userId: u.id, username: u.username })}>
                          <Key className="h-3.5 w-3.5 mr-2" />Reset Password
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => { if (confirm(`Delete user ${u.username}?`)) deleteUser.mutate({ userId: u.id }); }}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" />Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className="text-xs text-muted-foreground">
              Showing {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + users.length}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
              <Button variant="outline" size="sm" disabled={users.length < PAGE_SIZE} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Roles overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Realm Roles</CardTitle>
          <CardDescription>All roles defined in the BIS Keycloak realm</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {roles.map((r: any) => (
              <Badge key={r.id} variant="outline" className="font-mono text-xs">
                <Shield className="h-2.5 w-2.5 mr-1" />{r.name}
              </Badge>
            ))}
            {roles.length === 0 && (
              <span className="text-sm text-muted-foreground">No roles returned (Keycloak may not be configured)</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <CreateUserDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => refetch()} />
      {roleDialog && (
        <AssignRoleDialog
          userId={roleDialog.userId}
          username={roleDialog.username}
          open={true}
          onClose={() => setRoleDialog(null)}
        />
      )}
      {resetDialog && (
        <ResetPasswordDialog
          userId={resetDialog.userId}
          username={resetDialog.username}
          open={true}
          onClose={() => setResetDialog(null)}
        />
      )}
    </div>
  );
}

export default function KeycloakPage() {
  return <BISLayout title="Keycloak IDP" subtitle="Identity & Access Management"><KeycloakPageInner /></BISLayout>;
}
