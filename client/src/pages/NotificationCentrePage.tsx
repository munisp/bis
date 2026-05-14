import { useState } from "react";
import BISLayout from "@/components/BISLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Bell, BellOff, CheckCheck, ExternalLink, ChevronLeft, ChevronRight, Plus, Megaphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";

const PAGE_SIZE = 20;

export default function NotificationCentrePage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  // Create notification dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ title: "", body: "", link: "", broadcast: false, type: "admin" });
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // User list for targeted notifications
  const { data: allUsers = [] } = trpc.users.list.useQuery({ limit: 200 }, { enabled: isAdmin });
  const [targetUserId, setTargetUserId] = useState<number | null>(null);

  const { data, isLoading } = trpc.notifications.list.useQuery({
    unreadOnly,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: (d) => {
      toast.success(`Marked ${d.marked} notification(s) as read`);
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const createMutation = trpc.notifications.create.useMutation({
    onSuccess: () => {
      toast.success("Notification created");
      setCreateOpen(false);
      setCreateForm({ title: "", body: "", link: "", broadcast: false, type: "admin" });
      setTargetUserId(null);
      utils.notifications.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const broadcastMutation = trpc.notifications.broadcast.useMutation({
    onSuccess: (d) => {
      toast.success(`Broadcast sent to ${d.sent} user(s)`);
      setCreateOpen(false);
      setCreateForm({ title: "", body: "", link: "", broadcast: false, type: "admin" });
      setTargetUserId(null);
      utils.notifications.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.notifications.delete.useMutation({
    onSuccess: () => {
      toast.success("Notification deleted");
      setDeleteConfirm(null);
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const notifications = data?.notifications ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleSend = () => {
    if (!createForm.title.trim()) return;
    if (createForm.broadcast) {
      broadcastMutation.mutate({ type: createForm.type, title: createForm.title, body: createForm.body || undefined, link: createForm.link || undefined });
    } else {
      const userId = targetUserId ?? (user as any)?.id;
      if (!userId) { toast.error("Select a target user"); return; }
      createMutation.mutate({ userId, type: createForm.type, title: createForm.title, body: createForm.body || undefined, link: createForm.link || undefined });
    }
  };

  const isSending = createMutation.isPending || broadcastMutation.isPending;

  return (
    <BISLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Notifications</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {total} total · {data?.unread ?? 0} unread on this page
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="unread-only"
                checked={unreadOnly}
                onCheckedChange={(v) => { setUnreadOnly(v); setPage(1); }}
              />
              <Label htmlFor="unread-only" className="text-sm cursor-pointer">Unread only</Label>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              <CheckCheck className="h-4 w-4 mr-2" />
              Mark all read
            </Button>
            {isAdmin && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                New
              </Button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <BellOff className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No notifications</p>
              <p className="text-sm mt-1">
                {unreadOnly ? "No unread notifications." : "You're all caught up."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {notifications.map((notif) => (
              <Card
                key={notif.id}
                className={`transition-colors ${!notif.read ? "border-primary/30 bg-primary/5" : ""}`}
              >
                <CardContent className="flex items-start justify-between py-3 px-4 gap-3">
                  <div
                    className="flex items-start gap-3 flex-1 cursor-pointer"
                    onClick={() => {
                      if (!notif.read) markRead.mutate({ id: notif.id });
                      if (notif.link) navigate(notif.link);
                    }}
                  >
                    <div className={`mt-0.5 p-1.5 rounded-full ${!notif.read ? "bg-primary/20" : "bg-muted"}`}>
                      <Bell className={`h-3.5 w-3.5 ${!notif.read ? "text-primary" : "text-muted-foreground"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${!notif.read ? "text-foreground" : "text-muted-foreground"}`}>
                          {notif.title}
                        </span>
                        {!notif.read && (
                          <Badge className="text-xs h-4 px-1.5 bg-primary/20 text-primary border-primary/30">
                            New
                          </Badge>
                        )}
                      </div>
                      {notif.body && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.body}</p>
                      )}
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        {new Date(notif.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {notif.link && (
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {!notif.read && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground"
                        onClick={() => markRead.mutate({ id: notif.id })}
                      >
                        Dismiss
                      </Button>
                    )}
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                        onClick={() => setDeleteConfirm(notif.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <p className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Admin: Create / Broadcast Notification Dialog */}
      {isAdmin && (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {createForm.broadcast ? <Megaphone className="w-4 h-4 text-orange-500" /> : <Bell className="w-4 h-4 text-primary" />}
                {createForm.broadcast ? "Broadcast Notification" : "Create Notification"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border">
                <Switch
                  id="broadcast-toggle"
                  checked={createForm.broadcast}
                  onCheckedChange={v => setCreateForm(f => ({ ...f, broadcast: v }))}
                />
                <div>
                  <Label htmlFor="broadcast-toggle" className="text-sm font-medium cursor-pointer">
                    Broadcast to all users
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {createForm.broadcast ? "Will be sent to every active user" : "Will be sent to you only"}
                  </p>
                </div>
              </div>
              {!createForm.broadcast && (
                <div className="space-y-1">
                  <Label className="text-xs">Target User *</Label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={targetUserId ?? ""}
                    onChange={e => setTargetUserId(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Select user…</option>
                    {allUsers.map((u: any) => (
                      <option key={u.id} value={u.id}>{u.name ?? u.email ?? `User #${u.id}`}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">Title *</Label>
                <Input
                  value={createForm.title}
                  onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Notification title"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Body</Label>
                <Textarea
                  value={createForm.body}
                  onChange={e => setCreateForm(f => ({ ...f, body: e.target.value }))}
                  rows={3}
                  placeholder="Optional message body"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Link (optional)</Label>
                <Input
                  value={createForm.link}
                  onChange={e => setCreateForm(f => ({ ...f, link: e.target.value }))}
                  placeholder="/dashboard or /investigations/INV-001"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleSend} disabled={isSending || !createForm.title.trim()}>
                {isSending ? "Sending…" : createForm.broadcast ? "Broadcast" : "Send"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete Confirmation */}
      {isAdmin && (
        <Dialog open={deleteConfirm !== null} onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-red-500 flex items-center gap-2">
                <Trash2 className="w-4 h-4" /> Delete Notification
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">This will permanently delete this notification for all recipients.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => deleteConfirm !== null && deleteMutation.mutate({ id: deleteConfirm })}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </BISLayout>
  );
}
