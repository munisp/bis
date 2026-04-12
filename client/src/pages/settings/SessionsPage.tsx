import { useState } from "react";
import BISLayout from "@/components/BISLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Monitor, Smartphone, Globe, Trash2, ShieldOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";

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
  const { data: sessions, isLoading } = trpc.sessions.list.useQuery();

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

  return (
    <BISLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Active Sessions</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage all devices and browsers currently signed in to your account.</p>
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
                <AlertDialogDescription>This will sign out all devices including this one. You will need to sign in again.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => revokeAll.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
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
                        <span className="font-medium text-sm">{getDeviceLabel(session.userAgent, session.deviceName)}</span>
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
      </div>
    </BISLayout>
  );
}
