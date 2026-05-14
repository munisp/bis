// QuickCheck — simple staff vetting for individuals, households, and small businesses.
// No enterprise jargon. Just: who are you checking, how deep, and what's the result.

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  CheckCircle2, XCircle, AlertTriangle, Search, User, Car, Baby,
  Shield, Wrench, UtensilsCrossed, HardHat, Sparkles, ChevronRight,
  FileText, Clock, Zap, Star, RotateCcw, History, ChevronLeft
} from "lucide-react";

const WORKER_CATEGORIES = [
  { value: "house_help", label: "House Help / Cleaner", icon: Sparkles, description: "Domestic workers, cleaners, housekeepers" },
  { value: "driver", label: "Driver / Chauffeur", icon: Car, description: "Personal drivers, delivery riders, logistics" },
  { value: "nanny", label: "Nanny / Childminder", icon: Baby, description: "Babysitters, au pairs, childcare workers" },
  { value: "security_guard", label: "Security Guard", icon: Shield, description: "Guards, watchmen, bouncers" },
  { value: "artisan", label: "Artisan / Technician", icon: Wrench, description: "Plumbers, electricians, carpenters, mechanics" },
  { value: "restaurant_staff", label: "Restaurant / Catering Staff", icon: UtensilsCrossed, description: "Waiters, cooks, kitchen staff, bartenders" },
  { value: "contractor", label: "Contractor / Builder", icon: HardHat, description: "Construction workers, site supervisors" },
  { value: "other", label: "Other Worker", icon: User, description: "Any other category of worker" },
] as const;

const TIERS = [
  {
    value: "basic",
    label: "Basic Check",
    price: "₦500",
    color: "border-slate-300 dark:border-slate-600",
    badgeColor: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    checks: ["Identity confirmation (BVN/NIN/Phone)"],
    icon: "🔍",
    time: "~30 seconds",
  },
  {
    value: "standard",
    label: "Standard Check",
    price: "₦1,500",
    color: "border-blue-400 dark:border-blue-600",
    badgeColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
    checks: ["Identity confirmation", "Sanctions & watchlist screening", "Adverse media scan"],
    icon: "🛡️",
    time: "~60 seconds",
    recommended: true,
  },
  {
    value: "premium",
    label: "Premium Check",
    price: "₦3,000",
    color: "border-amber-400 dark:border-amber-600",
    badgeColor: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
    checks: ["Identity confirmation", "Sanctions & watchlist", "Adverse media", "Criminal record check", "Composite risk score"],
    icon: "⭐",
    time: "~2 minutes",
  },
] as const;

type CheckResult = {
  ref: string;
  verdict: "clear" | "flagged" | "fail";
  riskScore: number;
  identityConfirmed: boolean;
  sanctionsHit: boolean;
  adverseMediaHit: boolean;
  criminalRecordHit: boolean;
  summary: string;
  factors: Array<{ check: string; result: "pass" | "flag" | "fail"; detail: string }>;
  recommendation: string;
  tokensConsumed: number;
  tier: string;
  workerCategory: string;
  subjectName: string;
  completedAt: string;
};

function VerdictCard({ result }: { result: CheckResult }) {
  const isCategory = WORKER_CATEGORIES.find(c => c.value === result.workerCategory);

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Verdict banner */}
      <Card className={`border-2 ${
        result.verdict === "clear" ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30" :
        result.verdict === "flagged" ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30" :
        "border-red-400 bg-red-50 dark:bg-red-950/30"
      }`}>
        <CardContent className="pt-6 pb-5">
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-full ${
              result.verdict === "clear" ? "bg-emerald-100 dark:bg-emerald-900/50" :
              result.verdict === "flagged" ? "bg-amber-100 dark:bg-amber-900/50" :
              "bg-red-100 dark:bg-red-900/50"
            }`}>
              {result.verdict === "clear" ? <CheckCircle2 className="h-8 w-8 text-emerald-600" /> :
               result.verdict === "flagged" ? <AlertTriangle className="h-8 w-8 text-amber-600" /> :
               <XCircle className="h-8 w-8 text-red-600" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold">
                  {result.verdict === "clear" ? "✓ Clear to Hire" :
                   result.verdict === "flagged" ? "⚠ Review Required" :
                   "✗ Not Recommended"}
                </h2>
                <Badge variant="outline" className="font-mono text-xs">
                  Ref: {result.ref}
                </Badge>
              </div>
              <p className="text-sm mt-1 text-muted-foreground">{result.subjectName} · {isCategory?.label ?? result.workerCategory}</p>
              <p className="text-sm mt-2 leading-relaxed">{result.summary}</p>
            </div>
            {result.tier !== "basic" && (
              <div className="text-center shrink-0">
                <div className={`text-3xl font-bold ${
                  result.riskScore < 30 ? "text-emerald-600" :
                  result.riskScore < 60 ? "text-amber-600" : "text-red-600"
                }`}>{result.riskScore}</div>
                <div className="text-xs text-muted-foreground">Risk Score</div>
                <div className="text-xs font-medium">/100</div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Check results */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Check Results</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {result.factors.map((factor, i) => (
              <div key={i} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
                <div className={`mt-0.5 shrink-0 ${
                  factor.result === "pass" ? "text-emerald-500" :
                  factor.result === "flag" ? "text-amber-500" : "text-red-500"
                }`}>
                  {factor.result === "pass" ? <CheckCircle2 className="h-4 w-4" /> :
                   factor.result === "flag" ? <AlertTriangle className="h-4 w-4" /> :
                   <XCircle className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{factor.check}</span>
                    <Badge variant="outline" className={`text-xs ${
                      factor.result === "pass" ? "text-emerald-600 border-emerald-300" :
                      factor.result === "flag" ? "text-amber-600 border-amber-300" :
                      "text-red-600 border-red-300"
                    }`}>
                      {factor.result === "pass" ? "Pass" : factor.result === "flag" ? "Flagged" : "Fail"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{factor.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recommendation */}
      <Card className="bg-muted/30">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-2">
            <FileText className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-medium mb-0.5">Recommendation</div>
              <p className="text-sm text-muted-foreground">{result.recommendation}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>Completed {new Date(result.completedAt).toLocaleString()}</span>
        <span className="flex items-center gap-1"><Zap className="h-3 w-3 text-amber-500" />{result.tokensConsumed} tokens used</span>
      </div>
    </div>
  );
}

export default function QuickCheck() {
  const [step, setStep] = useState<"form" | "result">("form");
  const [result, setResult] = useState<CheckResult | null>(null);

  // Form state
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [bvn, setBvn] = useState("");
  const [nin, setNin] = useState("");
  const [workerCategory, setWorkerCategory] = useState<string>("house_help");
  const [tier, setTier] = useState<"basic" | "standard" | "premium">("standard");
  const [employerNote, setEmployerNote] = useState("");

  const { data: historyData, refetch: refetchHistory } = trpc.quickcheck.history.useQuery({ limit: 20 });
  const [historyPage, setHistoryPage] = useState(0);
  const HISTORY_PAGE_SIZE = 5;
  const historyItems = historyData?.items ?? [];
  const historyTotalPages = Math.ceil(historyItems.length / HISTORY_PAGE_SIZE);
  const historySlice = historyItems.slice(historyPage * HISTORY_PAGE_SIZE, (historyPage + 1) * HISTORY_PAGE_SIZE);

  const run = trpc.quickcheck.run.useMutation({
    onSuccess: (data) => {
      setResult(data as CheckResult);
      setStep("result");
      refetchHistory();
    },
    onError: (err) => toast.error("Check failed: " + err.message),
  });

  const handleSubmit = () => {
    if (!fullName.trim()) { toast.error("Please enter the person's full name"); return; }
    if (!phone && !bvn && !nin) { toast.error("Please provide at least one identifier: phone, BVN, or NIN"); return; }
    run.mutate({
      fullName: fullName.trim(),
      phone: phone || undefined,
      bvn: bvn || undefined,
      nin: nin || undefined,
      workerCategory: workerCategory as any,
      tier,
      employerNote: employerNote || undefined,
    });
  };

  const reset = () => {
    setStep("form");
    setResult(null);
    setFullName("");
    setPhone("");
    setBvn("");
    setNin("");
    setEmployerNote("");
  };

  const selectedCategory = WORKER_CATEGORIES.find(c => c.value === workerCategory);
  const CategoryIcon = selectedCategory?.icon ?? User;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Search className="h-5 w-5 text-blue-500" />
          <h1 className="text-2xl font-bold">QuickCheck</h1>
          <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 border-0 text-xs">Consumer</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Vet domestic staff, drivers, artisans, and other workers in minutes. No forms, no waiting — just a name and a phone number.
        </p>
      </div>

      {step === "form" ? (
        <div className="space-y-5">
          {/* Who are you checking */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CategoryIcon className="h-4 w-4 text-blue-500" />
                Who are you checking?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs mb-1.5 block">Worker Category</Label>
                <Select value={workerCategory} onValueChange={setWorkerCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WORKER_CATEGORIES.map(cat => {
                      const Icon = cat.icon;
                      return (
                        <SelectItem key={cat.value} value={cat.value}>
                          <div className="flex items-center gap-2">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>{cat.label}</span>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {selectedCategory && (
                  <p className="text-xs text-muted-foreground mt-1">{selectedCategory.description}</p>
                )}
              </div>

              <div>
                <Label className="text-xs mb-1.5 block">Full Name <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="e.g. Amaka Okonkwo"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs mb-1.5 block">Phone Number</Label>
                  <Input placeholder="08012345678" value={phone} onChange={e => setPhone(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block">BVN</Label>
                  <Input placeholder="22345678901" value={bvn} onChange={e => setBvn(e.target.value)} maxLength={11} />
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block">NIN</Label>
                  <Input placeholder="12345678901" value={nin} onChange={e => setNin(e.target.value)} maxLength={11} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Provide at least one identifier. BVN or NIN gives the most accurate results.</p>

              <div>
                <Label className="text-xs mb-1.5 block">Your Note (optional)</Label>
                <Textarea
                  placeholder="e.g. Applying for live-in house help. Referred by a neighbour."
                  value={employerNote}
                  onChange={e => setEmployerNote(e.target.value)}
                  rows={2}
                  className="resize-none text-sm"
                />
              </div>
            </CardContent>
          </Card>

          {/* Check depth */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">How thorough should the check be?</CardTitle>
              <CardDescription>More thorough checks cost a little more but give you greater confidence.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {TIERS.map(t => (
                  <button
                    key={t.value}
                    onClick={() => setTier(t.value as any)}
                    className={`relative text-left p-4 rounded-xl border-2 transition-all ${
                      tier === t.value ? t.color + " ring-2 ring-offset-1 ring-blue-400/50" : "border-border hover:border-muted-foreground/40"
                    }`}
                  >
                    {('recommended' in t) && (t as any).recommended && (
                      <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                        <Badge className="bg-blue-500 text-white text-xs px-2 py-0 border-0">
                          <Star className="h-2.5 w-2.5 mr-0.5" />Recommended
                        </Badge>
                      </div>
                    )}
                    <div className="text-2xl mb-1">{t.icon}</div>
                    <div className="font-semibold text-sm">{t.label}</div>
                    <div className="text-lg font-bold mt-0.5">{t.price}</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                      <Clock className="h-3 w-3" />{t.time}
                    </div>
                    <ul className="mt-2 space-y-0.5">
                      {t.checks.map((check, i) => (
                        <li key={i} className="flex items-center gap-1 text-xs text-muted-foreground">
                          <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                          {check}
                        </li>
                      ))}
                    </ul>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Submit */}
          <Button
            onClick={handleSubmit}
            disabled={run.isPending || !fullName.trim() || (!phone && !bvn && !nin)}
            className="w-full h-12 text-base gap-2"
            size="lg"
          >
            {run.isPending ? (
              <>
                <Search className="h-5 w-5 animate-pulse" />
                Running check...
              </>
            ) : (
              <>
                <Search className="h-5 w-5" />
                Run QuickCheck — {TIERS.find(t => t.value === tier)?.price}
                <ChevronRight className="h-4 w-4 ml-auto" />
              </>
            )}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            Results are generated using BVN/NIN registries, EFCC watchlists, INTERPOL notices, and 10,000+ news sources.
            All checks are logged for your records.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {result && <VerdictCard result={result} />}
          <Button variant="outline" onClick={reset} className="w-full gap-2">
            <RotateCcw className="h-4 w-4" />
            Check Another Person
          </Button>
        </div>
      )}

      {/* Recent Checks History */}
      {historyItems.length > 0 && (
        <Card className="mt-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              Recent Checks
              <Badge variant="outline" className="text-xs ml-auto">{historyItems.length} total</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {historySlice.map((item) => {
                const rd = item.requestData as any;
                const verdict = rd?.verdict as string | undefined;
                const verdictColor = verdict === "clear" ? "text-emerald-500" : verdict === "flagged" ? "text-amber-500" : verdict === "fail" ? "text-red-500" : "text-muted-foreground";
                const verdictLabel = verdict === "clear" ? "Clear" : verdict === "flagged" ? "Flagged" : verdict === "fail" ? "Fail" : item.status;
                return (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                    <div className={`shrink-0 ${verdictColor}`}>
                      {verdict === "clear" ? <CheckCircle2 className="h-4 w-4" /> : verdict === "flagged" ? <AlertTriangle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{item.subjectName}</span>
                        <Badge variant="outline" className={`text-xs shrink-0 ${verdictColor} border-current`}>{verdictLabel}</Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <span className="capitalize">{(rd?.tier ?? item.type ?? "").replace(/_/g, " ")}</span>
                        <span>&middot;</span>
                        <span className="font-mono">{item.requestRef}</span>
                        <span>&middot;</span>
                        <span>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "—"}</span>
                      </div>
                    </div>
                    {item.riskScore !== null && item.riskScore !== undefined && (
                      <div className={`text-sm font-bold font-mono shrink-0 ${
                        item.riskScore < 30 ? "text-emerald-500" : item.riskScore < 60 ? "text-amber-500" : "text-red-500"
                      }`}>{item.riskScore}</div>
                    )}
                  </div>
                );
              })}
            </div>
            {historyTotalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2 border-t border-border">
                <span className="text-xs text-muted-foreground">Page {historyPage + 1} of {historyTotalPages}</span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" className="h-6 w-6 p-0" disabled={historyPage === 0} onClick={() => setHistoryPage(p => p - 1)}>
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <Button variant="outline" size="sm" className="h-6 w-6 p-0" disabled={historyPage >= historyTotalPages - 1} onClick={() => setHistoryPage(p => p + 1)}>
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
