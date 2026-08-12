/**
 * ReconciliationDashboard — Admin view for failed TigerBeetle transactions
 * =========================================================================
 * Displays billing top-ups and transfers where TigerBeetle recording failed
 * (tbTransferId is null or reconciledAt is null). Allows manual retry.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, CheckCircle2, RefreshCw, Database, DollarSign } from "lucide-react";
import { toast } from "sonner";

export default function ReconciliationDashboard() {
  const [retrying, setRetrying] = useState<string | null>(null);

  const { data, isLoading, refetch } = trpc.admin.reconciliation.listUnreconciled.useQuery(
    { limit: 50 },
    { refetchInterval: 30_000 }
  );

  const retryMutation = trpc.admin.reconciliation.retryCredit.useMutation({
    onSuccess: (result) => {
      if (result.recorded) {
        toast.success(`Transfer ${result.transferId} reconciled successfully`);
      } else {
        toast.error("Retry failed — TigerBeetle still unavailable");
      }
      refetch();
      setRetrying(null);
    },
    onError: (err) => {
      toast.error(err.message || "Retry failed");
      setRetrying(null);
    },
  });

  const handleRetry = (reference: string, tenantId: string, amountKobo: number) => {
    setRetrying(reference);
    retryMutation.mutate({ reference, tenantId, amountKobo });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const unreconciled = data?.items ?? [];
  const stats = data?.stats ?? { total: 0, totalAmountNGN: 0, oldestAge: "—" };

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Database className="h-6 w-6" />
          Payment Reconciliation
        </h1>
        <p className="text-muted-foreground mt-1">
          Transactions where TigerBeetle recording failed. These payments were verified by Paystack
          but not credited to the tenant's ledger account.
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="text-sm text-muted-foreground">Unreconciled</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-red-600" />
              <span className="text-sm text-muted-foreground">Total Outstanding</span>
            </div>
            <p className="text-2xl font-bold mt-1">
              ₦{stats.totalAmountNGN.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-blue-600" />
              <span className="text-sm text-muted-foreground">Oldest</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats.oldestAge}</p>
          </CardContent>
        </Card>
      </div>

      {/* Transaction List */}
      <Card>
        <CardHeader>
          <CardTitle>Failed Ledger Credits</CardTitle>
          <CardDescription>
            Each row represents a verified Paystack payment that was not recorded in TigerBeetle.
            Click "Retry" to attempt re-crediting the tenant's ledger account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {unreconciled.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
              <p className="font-medium text-green-800">All Reconciled</p>
              <p className="text-sm text-muted-foreground mt-1">
                No outstanding unreconciled transactions.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-6 gap-2 text-xs font-medium text-muted-foreground border-b pb-2">
                <span>Reference</span>
                <span>Tenant</span>
                <span>Amount</span>
                <span>Channel</span>
                <span>Date</span>
                <span>Action</span>
              </div>
              {unreconciled.map((item: any) => (
                <div key={item.reference} className="grid grid-cols-6 gap-2 items-center text-sm py-2 border-b border-dashed">
                  <span className="font-mono text-xs truncate" title={item.reference}>
                    {item.reference.slice(0, 20)}...
                  </span>
                  <span className="truncate">{item.tenantId}</span>
                  <span className="font-medium">₦{(item.amountKobo / 100).toLocaleString()}</span>
                  <Badge variant="outline" className="w-fit">{item.channel}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(item.verifiedAt).toLocaleDateString()}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={retrying === item.reference}
                    onClick={() => handleRetry(item.reference, item.tenantId, item.amountKobo)}
                  >
                    {retrying === item.reference ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    <span className="ml-1">Retry</span>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
