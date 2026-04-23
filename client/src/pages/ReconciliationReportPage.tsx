import { useState } from "react";
import { trpc } from "@/lib/trpc";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2, Clock, XCircle, RefreshCw, Download,
  AlertTriangle, TrendingUp, BarChart3, ArrowLeftRight
} from "lucide-react";

function fmt(n: number) {
  return `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ReconciliationReportPage() {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const [date, setDate] = useState(yesterday);
  const [queryDate, setQueryDate] = useState(yesterday);

  const { data, isLoading, refetch } = trpc.paymentRails.getReconciliationReport.useQuery(
    { date: queryDate },
    { retry: false }
  );

  const handleRun = () => setQueryDate(date);

  const handleExport = () => {
    if (!data) return;
      const rows = [
      ["Date", data.date],
      ["Total Transactions", data.summary.total],
      ["Posted/Settled", data.summary.posted],
      ["Pending", data.summary.pending],
      ["Failed", data.summary.failed],
      ["Reversed", data.summary.reversed],
      ["Settlement Rate", `${data.summary.settlementRate}%`],
      ["Total Settled (NGN)", data.volumes.settled],
      ["Total Pending (NGN)", data.volumes.pending],
      ["Total Failed (NGN)", data.volumes.failed],
      ["Total Reversed (NGN)", data.volumes.reversed],
      [],
      ["Stale Pending Transactions (>1h)"],
      ["Ref", "Amount", "Currency", "Created At"],
      ...(data.stalePending ?? []).map((t: any) => [t.txRef, t.amount / 100, t.currency, new Date(t.createdAt).toISOString()]),
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reconciliation-${data.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const settlementRate = data?.summary?.settlementRate ?? 0;
  const rateColor = settlementRate >= 95 ? "text-green-400" : settlementRate >= 80 ? "text-yellow-400" : "text-red-400";

  return (
    <BISLayout title="Payment Reconciliation Report" subtitle="Daily settlement reconciliation — compare expected vs actual settled transfers">
      <div className="space-y-6">
        {/* Controls */}
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <Label>Report Date</Label>
                <Input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                  className="w-44"
                />
              </div>
              <Button onClick={handleRun} disabled={isLoading} className="gap-2">
                <BarChart3 className="w-4 h-4" />
                {isLoading ? "Loading…" : "Run Report"}
              </Button>
              <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isLoading}>
                <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
              </Button>
              {data && (
                <Button variant="outline" onClick={handleExport} className="gap-2 ml-auto">
                  <Download className="w-4 h-4" />
                  Export CSV
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {data && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="bg-card border-border">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-8 h-8 text-green-400" />
                    <div>
                      <div className="text-2xl font-bold">{data.summary.posted}</div>
                      <div className="text-xs text-muted-foreground">Posted / Settled</div>
                      <div className="text-xs text-green-400 font-mono">{fmt(data.volumes.settled)}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-card border-border">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <Clock className="w-8 h-8 text-yellow-400" />
                    <div>
                      <div className="text-2xl font-bold">{data.summary.pending}</div>
                      <div className="text-xs text-muted-foreground">Pending</div>
                      <div className="text-xs text-yellow-400 font-mono">{fmt(data.volumes.pending)}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-card border-border">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <XCircle className="w-8 h-8 text-red-400" />
                    <div>
                      <div className="text-2xl font-bold">{data.summary.failed}</div>
                      <div className="text-xs text-muted-foreground">Failed</div>
                      <div className="text-xs text-red-400 font-mono">{fmt(data.volumes.failed)}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-card border-border">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <ArrowLeftRight className="w-8 h-8 text-purple-400" />
                    <div>
                      <div className="text-2xl font-bold">{data.summary.reversed}</div>
                      <div className="text-xs text-muted-foreground">Reversed</div>
                      <div className="text-xs text-purple-400 font-mono">{fmt(data.volumes.reversed)}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Settlement Rate */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-400" />
                  Settlement Rate — {data.date}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="flex items-center gap-4">
                  <div className={`text-5xl font-bold font-mono ${rateColor}`}>
                    {settlementRate}%
                  </div>
                  <div className="flex-1">
                    <div className="h-4 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${settlementRate >= 95 ? "bg-green-500" : settlementRate >= 80 ? "bg-yellow-500" : "bg-red-500"}`}
                        style={{ width: `${settlementRate}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                      <span>0%</span>
                      <span>Target: 95%</span>
                      <span>100%</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold">{data.summary.total}</div>
                    <div className="text-xs text-muted-foreground">Total Transactions</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Stale Pending Transactions */}
            {(data.stalePending?.length ?? 0) > 0 && (
              <Card className="bg-card border-border border-yellow-500/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-yellow-400" />
                    Stale Pending Transactions ({data.stalePending.length})
                    <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">Requires Action</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          <th className="text-left p-3 font-medium">Ref</th>
                          <th className="text-left p-3 font-medium">Originator</th>
                          <th className="text-left p-3 font-medium">Beneficiary</th>
                          <th className="text-right p-3 font-medium">Amount</th>
                          <th className="text-left p-3 font-medium">Created</th>
                          <th className="text-center p-3 font-medium">Age</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.stalePending.map((t: any) => {
                          const ageMs = Date.now() - new Date(t.createdAt).getTime();
                          const ageH = Math.floor(ageMs / 3600000);
                          const ageM = Math.floor((ageMs % 3600000) / 60000);
                          return (
                            <tr key={t.id} className="border-b border-border/50 hover:bg-muted/30">
                              <td className="p-3 font-mono text-xs text-blue-400">{t.txRef}</td>
                              <td className="p-3 text-xs">{t.originatorName}</td>
                              <td className="p-3 text-xs">{t.beneficiaryName}</td>
                              <td className="p-3 text-right font-mono text-xs">{fmt((t.amount ?? 0) / 100)}</td>
                              <td className="p-3 text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString()}</td>
                              <td className="p-3 text-center">
                                <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
                                  {ageH}h {ageM}m
                                </Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* All clear */}
            {(data.stalePending?.length ?? 0) === 0 && (
              <Card className="bg-card border-border border-green-500/30">
                <CardContent className="p-6 text-center">
                  <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
                  <div className="text-lg font-semibold text-green-400">All Clear</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    No stale pending transactions found for {data.date}. Settlement is on track.
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {!data && !isLoading && (
          <Card className="bg-card border-border">
            <CardContent className="p-12 text-center text-muted-foreground">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <div>Select a date and click <strong>Run Report</strong> to generate the reconciliation summary.</div>
            </CardContent>
          </Card>
        )}
      </div>
    </BISLayout>
  );
}
