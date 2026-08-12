/**
 * UserProfileDashboard — User Profile & Session Status
 * =====================================================
 * Displays the authenticated user's profile, verified identity details,
 * current session status, and session refresh controls.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Shield, Clock, User, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function UserProfileDashboard() {
  const { user, loading } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  // Fetch the user's KYC verification history
  const { data: kycHistory, isLoading: kycLoading } = trpc.quickcheck.history.useQuery(
    { limit: 5 },
    { enabled: !!user }
  );

  const handleRefreshSession = async () => {
    setRefreshing(true);
    try {
      // The refresh token is stored in the client's memory from the initial exchange
      // In production, this would call POST /api/auth/refresh with the stored refresh token
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: localStorage.getItem("bis_refresh_token") || "" }),
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.newRefreshToken) {
          localStorage.setItem("bis_refresh_token", data.newRefreshToken);
        }
        toast.success("Session refreshed successfully");
      } else {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        toast.error(err.error || "Session refresh failed — please log in again");
      }
    } catch {
      toast.error("Network error — could not refresh session");
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container max-w-2xl py-8">
        <Card>
          <CardContent className="pt-6 text-center">
            <XCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">Not Authenticated</p>
            <p className="text-muted-foreground mt-1">Please log in to view your profile.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-3xl py-8 space-y-6">
      <h1 className="text-2xl font-bold">User Profile</h1>

      {/* Profile Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {user.name || "Unknown User"}
          </CardTitle>
          <CardDescription>{user.email || "No email on file"}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Role</span>
              <p className="font-medium capitalize">{user.role}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Login Method</span>
              <p className="font-medium capitalize">{(user as any).loginMethod || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">User ID</span>
              <p className="font-mono text-xs">{(user as any).openId || user.id}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Last Sign-In</span>
              <p className="font-medium">
                {(user as any).lastSignedIn
                  ? new Date((user as any).lastSignedIn).toLocaleString()
                  : "—"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Session Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Session Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm font-medium">Active Session</span>
            </div>
            <Badge variant="outline" className="text-green-700 border-green-300">
              Authenticated
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Sessions expire after 24 hours. Use the refresh button below to extend your session
            without logging in again.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshSession}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-3 w-3" />
            )}
            Refresh Session
          </Button>
        </CardContent>
      </Card>

      {/* Verified Identity Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Identity Verification History
          </CardTitle>
          <CardDescription>
            Results from NIN/BVN verifications performed on your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {kycLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Loading verification history...</span>
            </div>
          ) : kycHistory?.items && kycHistory.items.length > 0 ? (
            <div className="space-y-3">
              {kycHistory.items.map((record: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="flex items-center gap-3">
                    {record.overallResult === "clear" ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-600" />
                    )}
                    <div>
                      <p className="text-sm font-medium">{record.type?.toUpperCase() || "Identity Check"}</p>
                      <p className="text-xs text-muted-foreground">
                        {record.createdAt ? new Date(record.createdAt).toLocaleDateString() : "—"}
                      </p>
                    </div>
                  </div>
                  <Badge variant={record.overallResult === "clear" ? "default" : "destructive"}>
                    {record.overallResult || "pending"}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <Shield className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No verification records found.</p>
              <p className="text-xs mt-1">Complete a NIN or BVN verification to see results here.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

