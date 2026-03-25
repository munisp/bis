import { useState } from "react";
import { trpc } from "@/lib/trpc";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Search, AlertTriangle, CheckCircle2, AlertCircle, Clock, User } from "lucide-react";

const STATUS_CONFIG = {
  pending:             { label: "Pending",             color: "bg-yellow-100 text-yellow-800", icon: Clock },
  no_match:            { label: "No Match",            color: "bg-green-100 text-green-800",  icon: CheckCircle2 },
  possible_match:      { label: "Possible Match",      color: "bg-amber-100 text-amber-800",  icon: AlertCircle },
  confirmed_duplicate: { label: "Confirmed Duplicate", color: "bg-red-100 text-red-800",      icon: AlertTriangle },
};

export default function DuplicateIdentityCheckPage() {
  const [form, setForm] = useState({ subjectName: "", nin: "", bvn: "", phone: "", investigationRef: "" });
  const [result, setResult] = useState<any>(null);

  const { data: history = [], refetch } = trpc.duplicateCheck.history.useQuery({ limit: 20 });

  const check = trpc.duplicateCheck.check.useMutation({
    onSuccess: (data) => {
      setResult(data);
      refetch();
      const cfg = STATUS_CONFIG[data.status as keyof typeof STATUS_CONFIG];
      if (data.status === "no_match") toast.success("No duplicate identity found.");
      else if (data.status === "possible_match") toast.warning(`Possible duplicate detected — ${data.matchCount} match(es) found.`);
      else toast.error(`Confirmed duplicate — ${data.matchCount} match(es) found.`);
    },
    onError: (e) => toast.error(`Check failed: ${e.message}`),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.subjectName) { toast.error("Subject name is required"); return; }
    if (!form.nin && !form.bvn && !form.phone) { toast.error("Provide at least one identifier (NIN, BVN, or phone)"); return; }
    setResult(null);
    check.mutate(form);
  };

  return (
    <BISLayout>
      <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center">
            <Search className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Duplicate Identity Check</h1>
            <p className="text-sm text-muted-foreground">Detect if a subject has previously been onboarded under a different name or record</p>
          </div>
        </div>

        {/* Check form */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="font-semibold text-foreground mb-4">Run Duplicate Check</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-muted-foreground mb-1 block">
                  Subject Name <span className="text-red-500">*</span>
                </label>
                <Input
                  value={form.subjectName}
                  onChange={e => setForm(f => ({ ...f, subjectName: e.target.value }))}
                  placeholder="Full legal name"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">NIN</label>
                <Input
                  value={form.nin}
                  onChange={e => setForm(f => ({ ...f, nin: e.target.value }))}
                  placeholder="11-digit NIN"
                  maxLength={11}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">BVN</label>
                <Input
                  value={form.bvn}
                  onChange={e => setForm(f => ({ ...f, bvn: e.target.value }))}
                  placeholder="11-digit BVN"
                  maxLength={11}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Phone Number</label>
                <Input
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="+234 8XX XXX XXXX"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Investigation Ref (optional)</label>
                <Input
                  value={form.investigationRef}
                  onChange={e => setForm(f => ({ ...f, investigationRef: e.target.value }))}
                  placeholder="e.g. BIS-2024-0042"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">At least one of NIN, BVN, or phone is required to perform the check.</p>
            <Button type="submit" disabled={check.isPending} className="bg-red-600 hover:bg-red-700 text-white">
              {check.isPending ? "Checking…" : "Run Duplicate Check"}
            </Button>
          </form>
        </div>

        {/* Result */}
        {result && (() => {
          const cfg = STATUS_CONFIG[result.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
          const Icon = cfg.icon;
          return (
            <div className={`rounded-xl border p-5 ${result.status === "no_match" ? "border-green-200 bg-green-50" : result.status === "confirmed_duplicate" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
              <div className="flex items-start gap-3">
                <Icon className={`w-6 h-6 shrink-0 mt-0.5 ${result.status === "no_match" ? "text-green-600" : result.status === "confirmed_duplicate" ? "text-red-600" : "text-amber-600"}`} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${cfg.color}`}>{cfg.label}</span>
                    <span className="text-sm text-muted-foreground">Confidence: {result.confidenceScore}%</span>
                  </div>
                  <p className="text-sm text-foreground">
                    {result.status === "no_match"
                      ? "No existing records match the provided identifiers. This subject appears to be unique in the system."
                      : `${result.matchCount} existing investigation(s) share one or more identifiers with this subject.`
                    }
                  </p>
                  {result.matches && result.matches.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-semibold text-foreground">Matching investigations:</p>
                      {result.matches.map((m: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-xs bg-white/60 rounded-lg px-3 py-2">
                          <User className="w-3 h-3 text-muted-foreground" />
                          <span className="font-medium">{m.ref}</span>
                          <span className="text-muted-foreground">—</span>
                          <span>{m.subjectName}</span>
                          <Badge variant="outline" className="ml-auto text-xs">{m.status}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* History */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/50">
            <h3 className="font-semibold text-sm text-foreground">Recent Checks</h3>
          </div>
          {history.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No checks performed yet</div>
          ) : (
            <div className="divide-y divide-border">
              {history.map(h => {
                const cfg = STATUS_CONFIG[h.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
                return (
                  <div key={h.id} className="flex items-center gap-4 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{h.subjectName}</p>
                      <p className="text-xs text-muted-foreground">
                        {[h.nin && `NIN: ${h.nin}`, h.bvn && `BVN: ${h.bvn}`, h.phone && `📞 ${h.phone}`].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${cfg.color}`}>{cfg.label}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{h.confidenceScore}%</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(h.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </BISLayout>
  );
}
