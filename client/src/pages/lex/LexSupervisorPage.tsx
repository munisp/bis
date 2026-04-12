import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { AlertTriangle, Building2, CheckCircle2, Flag, FlagOff, Shield, TrendingUp, Users } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts";

const NIGERIAN_STATES: Record<string, string> = {
  AB: "Abia", AD: "Adamawa", AK: "Akwa Ibom", AN: "Anambra", BA: "Bauchi",
  BY: "Bayelsa", BE: "Benue", BO: "Borno", CR: "Cross River", DE: "Delta",
  EB: "Ebonyi", ED: "Edo", EK: "Ekiti", EN: "Enugu", GO: "Gombe",
  IM: "Imo", JI: "Jigawa", KD: "Kaduna", KN: "Kano", KT: "Katsina",
  KE: "Kebbi", KO: "Kogi", KW: "Kwara", LA: "Lagos", NA: "Nasarawa",
  NI: "Niger", OG: "Ogun", ON: "Ondo", OS: "Osun", OY: "Oyo",
  PL: "Plateau", RI: "Rivers", SO: "Sokoto", TA: "Taraba", YO: "Yobe",
  ZA: "Zamfara", FC: "FCT Abuja",
};

type Agency = {
  id: number;
  agencyCode: string;
  name: string;
  type: string;
  state: string;
  lga: string | null;
  status: string;
  flagged: boolean;
  flagReason: string | null;
  stats: {
    total: number; pending: number; validated: number; rejected: number;
    escalated: number; linked: number; validationRate: number;
    rejectionRate: number; avgScore: number;
  };
};

export default function LexSupervisorPage() {
  const [selectedState, setSelectedState] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [flagDialog, setFlagDialog] = useState<{ agency: Agency; action: "flag" | "unflag" } | null>(null);
  const [flagReason, setFlagReason] = useState("");
  const [trendDays, setTrendDays] = useState(30);

  const { data: overview, isLoading, refetch } = trpc.lex.supervisorStateOverview.useQuery({
    state: selectedState === "all" ? undefined : selectedState,
  });

  const { data: trendData } = trpc.lex.stateTrend.useQuery({
    state: selectedState === "all" ? undefined : selectedState,
    days: trendDays,
  });

  const flagMutation = trpc.lex.flagAgency.useMutation({
    onSuccess: (data) => {
      toast.success(`Agency ${data.agencyCode} ${data.flagged ? "flagged" : "unflagged"} successfully`);
      setFlagDialog(null);
      setFlagReason("");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const agencies: Agency[] = overview?.agencies ?? [];
  const stateSummary = overview?.stateSummary ?? [];

  const filtered = agencies.filter(a =>
    !search || a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.agencyCode.toLowerCase().includes(search.toLowerCase())
  );

  const flaggedCount = agencies.filter(a => a.flagged).length;
  const totalSubmissions = agencies.reduce((s, a) => s + a.stats.total, 0);
  const totalValidated = agencies.reduce((s, a) => s + a.stats.validated, 0);
  const overallRate = totalSubmissions > 0 ? Math.round((totalValidated / totalSubmissions) * 100) : 0;

  const topStatesByVolume = [...stateSummary]
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map(s => ({ name: NIGERIAN_STATES[s.state] ?? s.state, total: s.total, validated: s.validated, rate: s.validationRate }));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            LEX Supervisor Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            State-level oversight of law enforcement agency submissions and validation integrity
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedState} onValueChange={setSelectedState}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All States" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              {Object.entries(NIGERIAN_STATES).map(([code, name]) => (
                <SelectItem key={code} value={code}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <Building2 className="w-8 h-8 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{agencies.length}</p>
                <p className="text-xs text-muted-foreground">Registered Agencies</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <Users className="w-8 h-8 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{totalSubmissions.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Total Submissions</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              <div>
                <p className="text-2xl font-bold">{overallRate}%</p>
                <p className="text-xs text-muted-foreground">Validation Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-8 h-8 text-red-500" />
              <div>
                <p className="text-2xl font-bold">{flaggedCount}</p>
                <p className="text-xs text-muted-foreground">Flagged Agencies</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top States by Volume */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Top States by Submission Volume</CardTitle>
          </CardHeader>
          <CardContent>
            {topStatesByVolume.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={topStatesByVolume} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="total" fill="hsl(var(--primary))" name="Total" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="validated" fill="hsl(142 71% 45%)" name="Validated" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Submission Trend */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Submission Trend</CardTitle>
            <Select value={String(trendDays)} onValueChange={v => setTrendDays(Number(v))}>
              <SelectTrigger className="w-24 h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 days</SelectItem>
                <SelectItem value="14">14 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="60">60 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {!trendData?.trend?.length ? (
              <p className="text-sm text-muted-foreground text-center py-8">No trend data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trendData.trend} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" name="Total" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="validated" stroke="hsl(142 71% 45%)" name="Validated" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="rejected" stroke="hsl(0 84% 60%)" name="Rejected" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Agency Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium">Agency Overview</CardTitle>
          <Input
            placeholder="Search agencies..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-56 h-8 text-sm"
          />
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No agencies found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Agency</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">State</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">Total</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">Validated</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">Rejected</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">Val. Rate</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">Avg Score</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">Flag</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(agency => (
                    <tr key={agency.id} className={`border-b hover:bg-muted/20 transition-colors ${agency.flagged ? "bg-red-50/30 dark:bg-red-950/10" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium">{agency.name}</div>
                        <div className="text-xs text-muted-foreground">{agency.agencyCode} · {agency.type.toUpperCase()}</div>
                      </td>
                      <td className="px-4 py-3 text-sm">{NIGERIAN_STATES[agency.state] ?? agency.state}</td>
                      <td className="px-4 py-3 text-center font-mono">{agency.stats.total}</td>
                      <td className="px-4 py-3 text-center font-mono text-emerald-600">{agency.stats.validated}</td>
                      <td className="px-4 py-3 text-center font-mono text-red-500">{agency.stats.rejected}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-semibold ${agency.stats.validationRate >= 70 ? "text-emerald-600" : agency.stats.validationRate >= 40 ? "text-amber-600" : "text-red-500"}`}>
                          {agency.stats.validationRate}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-semibold ${agency.stats.avgScore >= 60 ? "text-emerald-600" : agency.stats.avgScore >= 40 ? "text-amber-600" : "text-red-500"}`}>
                          {agency.stats.total > 0 ? agency.stats.avgScore : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant={agency.status === "active" ? "default" : "destructive"} className="text-xs">
                          {agency.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {agency.flagged ? (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <AlertTriangle className="w-3 h-3" /> Flagged
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`h-7 text-xs gap-1 ${agency.flagged ? "text-green-600 hover:text-green-700" : "text-red-500 hover:text-red-600"}`}
                          onClick={() => {
                            setFlagDialog({ agency, action: agency.flagged ? "unflag" : "flag" });
                            setFlagReason(agency.flagReason ?? "");
                          }}
                          disabled={agency.stats.total === 0}
                        >
                          {agency.flagged ? <><FlagOff className="w-3 h-3" /> Unflag</> : <><Flag className="w-3 h-3" /> Flag</>}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* State Summary Cards */}
      {stateSummary.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> State Summary
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {[...stateSummary].sort((a, b) => b.total - a.total).map(s => (
              <Card
                key={s.state}
                className={`cursor-pointer transition-all hover:shadow-md ${selectedState === s.state ? "ring-2 ring-primary" : ""} ${s.flagged > 0 ? "border-red-300 dark:border-red-800" : ""}`}
                onClick={() => setSelectedState(selectedState === s.state ? "all" : s.state)}
              >
                <CardContent className="pt-3 pb-3 px-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-foreground">{NIGERIAN_STATES[s.state] ?? s.state}</span>
                    {s.flagged > 0 && <AlertTriangle className="w-3 h-3 text-red-500" />}
                  </div>
                  <p className="text-lg font-bold">{s.total}</p>
                  <p className="text-xs text-muted-foreground">{s.validationRate}% valid</p>
                  <p className="text-xs text-muted-foreground">{s.agencies} agencies</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Flag/Unflag Dialog */}
      {flagDialog && (
        <Dialog open onOpenChange={() => setFlagDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {flagDialog.action === "flag" ? (
                  <><AlertTriangle className="w-5 h-5 text-red-500" /> Flag Agency</>
                ) : (
                  <><FlagOff className="w-5 h-5 text-green-500" /> Unflag Agency</>
                )}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-muted/40 p-3 text-sm">
                <p className="font-medium">{flagDialog.agency.name}</p>
                <p className="text-muted-foreground text-xs">{flagDialog.agency.agencyCode} · {NIGERIAN_STATES[flagDialog.agency.state] ?? flagDialog.agency.state}</p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Total:</span> <strong>{flagDialog.agency.stats.total}</strong></div>
                  <div><span className="text-muted-foreground">Val. Rate:</span> <strong>{flagDialog.agency.stats.validationRate}%</strong></div>
                  <div><span className="text-muted-foreground">Avg Score:</span> <strong>{flagDialog.agency.stats.avgScore}</strong></div>
                </div>
              </div>
              {flagDialog.action === "flag" && (
                <div className="space-y-2">
                  <Label>Reason for flagging</Label>
                  <Textarea
                    value={flagReason}
                    onChange={e => setFlagReason(e.target.value)}
                    placeholder="Describe the concern (e.g. high rejection rate, suspected fabrication, duplicate submissions...)"
                    rows={3}
                  />
                </div>
              )}
              {flagDialog.action === "unflag" && (
                <p className="text-sm text-muted-foreground">
                  This will remove the flag from <strong>{flagDialog.agency.name}</strong> and clear the flag reason. Confirm only if the integrity concern has been resolved.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFlagDialog(null)}>Cancel</Button>
              <Button
                variant={flagDialog.action === "flag" ? "destructive" : "default"}
                onClick={() => flagMutation.mutate({
                  agencyId: flagDialog.agency.id,
                  flagged: flagDialog.action === "flag",
                  reason: flagDialog.action === "flag" ? flagReason : undefined,
                })}
                disabled={flagMutation.isPending}
              >
                {flagMutation.isPending ? "Saving..." : flagDialog.action === "flag" ? "Flag Agency" : "Unflag Agency"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
