import { useState } from "react";
import { trpc } from "@/lib/trpc";
import BISLayout from "@/components/BISLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookOpen, Clock, Shield, AlertTriangle, ChevronRight, CheckCircle2, Circle, Search } from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  kyc_physical: "KYC Physical",
  kyb_premises: "KYB Premises",
  asset_verification: "Asset Verification",
  surveillance: "Surveillance",
  address_verification: "Address Verification",
  interview: "Interview",
  evidence_collection: "Evidence Collection",
  emergency: "Emergency",
};

const TIER_COLORS: Record<string, string> = {
  junior: "bg-green-100 text-green-800",
  senior: "bg-blue-100 text-blue-800",
  lead: "bg-purple-100 text-purple-800",
  specialist: "bg-red-100 text-red-800",
};

interface PlaybookStep {
  order: number;
  action: string;
  required: boolean;
}

export default function FieldAgentPlaybooksPage() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const { data: playbooks = [], isLoading } = trpc.playbooks.list.useQuery({ activeOnly: true });
  const { data: selected } = trpc.playbooks.get.useQuery(
    { id: selectedId! },
    { enabled: selectedId !== null }
  );

  const filtered = playbooks.filter(p =>
    p.title.toLowerCase().includes(search.toLowerCase()) ||
    CATEGORY_LABELS[p.category]?.toLowerCase().includes(search.toLowerCase())
  );

  const steps: PlaybookStep[] = selected?.steps ? JSON.parse(selected.steps) : [];
  const dataFields: string[] = selected?.dataToCollect ? JSON.parse(selected.dataToCollect) : [];
  const requiredCount = steps.filter(s => s.required).length;
  const completedRequired = steps.filter(s => s.required && completedSteps.has(s.order)).length;
  const progress = requiredCount > 0 ? Math.round((completedRequired / requiredCount) * 100) : 0;

  const toggleStep = (order: number) => {
    setCompletedSteps(prev => {
      const next = new Set(prev);
      if (next.has(order)) next.delete(order); else next.add(order);
      return next;
    });
  };

  return (
    <BISLayout>
      <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
        {/* Sidebar — playbook list */}
        <div className="w-80 shrink-0 border-r border-border flex flex-col bg-card">
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="w-5 h-5 text-orange-500" />
              <h2 className="font-bold text-foreground">Field Agent Playbooks</h2>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search playbooks…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading && (
              <div className="p-4 space-y-3">
                {[1,2,3,4].map(i => (
                  <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />
                ))}
              </div>
            )}
            {!isLoading && filtered.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">No playbooks found</div>
            )}
            {filtered.map(pb => (
              <button
                key={pb.id}
                onClick={() => { setSelectedId(pb.id); setCompletedSteps(new Set()); }}
                className={`w-full text-left p-4 border-b border-border hover:bg-muted/50 transition-colors ${selectedId === pb.id ? "bg-orange-50 border-l-4 border-l-orange-500" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-foreground truncate">{pb.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{pb.description}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
                        {CATEGORY_LABELS[pb.category] ?? pb.category}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIER_COLORS[pb.requiredTier]}`}>
                        {pb.requiredTier}
                      </span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />{pb.estimatedHours}h
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Main content — playbook detail */}
        <div className="flex-1 overflow-y-auto bg-muted/30">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <BookOpen className="w-16 h-16 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-semibold text-muted-foreground">Select a Playbook</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                Choose a playbook from the list to view its steps, data collection requirements, and safety notes.
              </p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto p-6 space-y-6">
              {/* Header */}
              <div className="bg-gradient-to-br from-orange-600 to-amber-500 rounded-2xl p-6 text-white">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Badge className="bg-white/20 text-white border-0 mb-2">
                      {CATEGORY_LABELS[selected.category] ?? selected.category}
                    </Badge>
                    <h1 className="text-2xl font-bold">{selected.title}</h1>
                    <p className="text-orange-100 text-sm mt-1">{selected.description}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-3xl font-bold">{selected.estimatedHours}h</div>
                    <div className="text-orange-200 text-xs">estimated</div>
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-4">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium bg-white/20 text-white`}>
                    Required tier: {selected.requiredTier}
                  </span>
                  <span className="text-xs text-orange-200">v{selected.version}</span>
                </div>
              </div>

              {/* Progress tracker */}
              {steps.length > 0 && (
                <div className="bg-card rounded-xl p-4 border border-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-foreground">Execution Progress</span>
                    <span className="text-sm font-bold text-orange-600">{progress}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-orange-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {completedRequired}/{requiredCount} required steps completed
                  </p>
                </div>
              )}

              {/* Steps */}
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-muted/50">
                  <h3 className="font-semibold text-sm text-foreground">Execution Steps</h3>
                </div>
                <div className="divide-y divide-border">
                  {steps.map((step) => (
                    <div
                      key={step.order}
                      className={`flex items-start gap-3 p-4 cursor-pointer hover:bg-muted/30 transition-colors ${completedSteps.has(step.order) ? "bg-green-50/50" : ""}`}
                      onClick={() => toggleStep(step.order)}
                    >
                      <div className="shrink-0 mt-0.5">
                        {completedSteps.has(step.order)
                          ? <CheckCircle2 className="w-5 h-5 text-green-500" />
                          : <Circle className="w-5 h-5 text-muted-foreground" />
                        }
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-muted-foreground w-6">{step.order}.</span>
                          <p className={`text-sm ${completedSteps.has(step.order) ? "line-through text-muted-foreground" : "text-foreground"}`}>
                            {step.action}
                          </p>
                        </div>
                        {step.required && (
                          <span className="ml-8 text-xs text-red-500 font-medium">Required</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Data to collect */}
              {dataFields.length > 0 && (
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="px-4 py-3 border-b border-border bg-muted/50">
                    <h3 className="font-semibold text-sm text-foreground">Data to Collect</h3>
                  </div>
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-2">
                    {dataFields.map((field, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-foreground">
                        <div className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
                        {field}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Safety & Legal notes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {selected.safetyNotes && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      <h4 className="font-semibold text-sm text-amber-800">Safety Notes</h4>
                    </div>
                    <p className="text-xs text-amber-700 leading-relaxed">{selected.safetyNotes}</p>
                  </div>
                )}
                {selected.legalNotes && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Shield className="w-4 h-4 text-blue-600" />
                      <h4 className="font-semibold text-sm text-blue-800">Legal Notes</h4>
                    </div>
                    <p className="text-xs text-blue-700 leading-relaxed">{selected.legalNotes}</p>
                  </div>
                )}
              </div>

              {/* Nigeria context */}
              {selected.nigeriaContext && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">🇳🇬</span>
                    <h4 className="font-semibold text-sm text-green-800">Nigeria Context</h4>
                  </div>
                  <p className="text-xs text-green-700 leading-relaxed">{selected.nigeriaContext}</p>
                </div>
              )}

              {/* Reset button */}
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCompletedSteps(new Set())}
                  disabled={completedSteps.size === 0}
                >
                  Reset Progress
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </BISLayout>
  );
}
