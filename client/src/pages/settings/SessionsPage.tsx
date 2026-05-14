import { useState } from "react";
import BISLayout from "@/components/BISLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Monitor, Smartphone, Globe, Trash2, ShieldOff, RefreshCw, Users, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

const ADMIN_PAGE_SIZE = 25;

function getDeviceIcon(userAgent: string | null) {
  if (!userAgent) return <Globe className="h-4 w-4" />;
  if (/mobile|android|iphone|ipad/i.test(userAgent)) return <Smartphone className="h-4 w-4" />;
  return <Monitor className="h-4 w-4" />;
}

function getDeviceLabel(userAgent: string | null, deviceName: string | null): string {
  if (deviceName) return deviceName;
  if (!userAgent) return "Unknown device";
  if (/chrome/i.test(userAgent)) return "Chrome";
  if (/firefox/i.test(userAgent)) return "Firefox";
  if (/safari/i.test(userAgent)) return "Safari";
  if (/edge/i.test(userAgent)) return "Edge";
  return "Browser";
}

export default function SessionsPage() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  // Own sessions
  const { data: sessions, isLoading } = trpc.sessions.list.useQuery();

  // Admin: all sessions
  const [adminPage, setAdminPage] = useState(0);
  const [userIdFilter, setUserIdFilter] = useState("");

  const { data: adminData, isLoading: adminLoading } = trpc.sessions.adminList.useQuery(
    {
      userId: userIdFilter ? Number(userIdFilter) : undefined,
      limit: ADMIN_PAGE_SIZE,
      offset: adminPage * ADMIN_PAGE_SIZE,
    },
    { enabled: isAdmin }
  );

  const revoke = trpc.sessions.revoke.useMutation({
    onSuccess: () => {
      toast.success("Session revoked");
      utils.sessions.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeAll = trpc.sessions.revokeAll.useMutation({
    onSuccess: (d) => {
      toast.success(`Revoked ${d.revoked} session(s)`);
      utils.sessions.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const adminTotalPages = Math.max(1, Math.ceil((adminData?.total ?? 0) / ADMIN_PAGE_SIZE));

  return (
    <BISLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-8">
        {/* ── My Sessions ── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Active Sessions</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Manage all devices and browsers currently signed in to your account.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={!sessions?.length}>
                  <ShieldOff className="h-4 w-4 mr-2" />
                  Revoke All
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Revoke all sessions?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will sign out all devices including this one. You will need to sign in again.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => revokeAll.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Revoke All
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />)}
            </div>
          ) : !sessions?.length ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <RefreshCw className="h-8 w-8 mx-auto mb-3 opacity-40" />
                <p>No active sessions found.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {sessions.map((session) => (
                <Card key={session.id}>
                  <CardContent className="flex items-center justify-between py-4 px-5">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-muted">
                        {getDeviceIcon(session.userAgent)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">
                            {getDeviceLabel(session.userAgent, session.deviceName)}
                          </span>
                          <Badge variant="secondary" className="text-xs">Active</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {session.ipAddress && <span className="mr-3">IP: {session.ipAddress}</span>}
                          <span>Last active: {new Date(session.lastActiveAt).toLocaleString()}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Expires: {new Date(session.expiresAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => revoke.mutate({ sessionId: session.id })}
                      disabled={revoke.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* ── Admin: All Sessions ── */}
        {isAdmin && (
          <section className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="h-4 w-4 text-primary" />
                    All User Sessions
                    {adminData && (
                      <Badge variant="secondary" className="ml-1">{adminData.total} total</Badge>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        type="number"
                        placeholder="Filter by user ID"
                        value={userIdFilter}
                        onChange={e => { setUserIdFilter(e.target.value); setAdminPage(0); }}
                        className="pl-8 h-8 w-40 text-xs"
                      />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {adminLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-14 rounded bg-muted animate-pulse" />)}
                  </div>
                ) : !adminData?.sessions.length ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">
                    No sessions found{userIdFilter ? ` for user #${userIdFilter}` : ""}.
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      {adminData.sessions.map((session) => (
                        <div
                          key={session.id}
                          className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className="p-1.5 rounded-full bg-muted">
                              {getDeviceIcon(session.userAgent)}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">
                                  {getDeviceLabel(session.userAgent, session.deviceName)}
                                </span>
                                <Badge variant="outline" className="text-xs h-4 px-1">
                                  User #{session.userId}
                                </Badge>
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {session.ipAddress && <span className="mr-3">IP: {session.ipAddress}</span>}
                                Last active: {new Date(session.lastActiveAt).toLocaleString()}
                                {" · "}Expires: {new Date(session.expiresAt).toLocaleString()}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {adminTotalPages > 1 && (
                      <div className="flex items-center justify-between pt-3 border-t border-border mt-3">
                        <p className="text-xs text-muted-foreground">
                          Page {adminPage + 1} of {adminTotalPages} · {adminData.total} sessions
                        </p>
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => setAdminPage(p => Math.max(0, p - 1))}
                            disabled={adminPage === 0}
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => setAdminPage(p => Math.min(adminTotalPages - 1, p + 1))}
                            disabled={adminPage >= adminTotalPages - 1}
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </section>
        )}
      </div>
    </BISLayout>
  );
}
