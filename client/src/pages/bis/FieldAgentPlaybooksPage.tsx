import { useState } from "react";
import { trpc } from "@/lib/trpc";
import BISLayout from "@/components/BISLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { BookOpen, Clock, Shield, AlertTriangle, ChevronRight, CheckCircle2, Circle, Search, Plus, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";

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

type PlaybookFormData = {
  title: string;
  category: string;
  description: string;
  estimatedHours: number;
  requiredTier: string;
  steps: string;
  dataToCollect: string;
  safetyNotes: string;
  legalNotes: string;
  nigeriaContext: string;
};

const EMPTY_FORM: PlaybookFormData = {
  title: "",
  category: "kyc_physical",
  description: "",
  estimatedHours: 4,
  requiredTier: "junior",
  steps: JSON.stringify([{ order: 1, action: "Verify subject identity documents", required: true }], null, 2),
  dataToCollect: JSON.stringify(["Full name", "Date of birth", "Address"], null, 2),
  safetyNotes: "",
  legalNotes: "",
  nigeriaContext: "",
};

export default function FieldAgentPlaybooksPage() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<PlaybookFormData>(EMPTY_FORM);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();

  const { data: playbooks = [], isLoading } = trpc.playbooks.list.useQuery({ activeOnly: false });
  const { data: selected } = trpc.playbooks.get.useQuery(
    { id: selectedId! },
    { enabled: selectedId !== null }
  );

  const createMutation = trpc.playbooks.create.useMutation({
    onSuccess: () => {
      toast.success("Playbook created");
      setEditOpen(false);
      utils.playbooks.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.playbooks.update.useMutation({
    onSuccess: () => {
      toast.success("Playbook updated");
      setEditOpen(false);
      utils.playbooks.list.invalidate();
      if (selectedId) utils.playbooks.get.invalidate({ id: selectedId });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.playbooks.delete.useMutation({
    onSuccess: () => {
      toast.success("Playbook deleted");
      setDeleteConfirm(null);
      if (selectedId === deleteConfirm) setSelectedId(null);
      utils.playbooks.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const filtered = playbooks.filter(p =>
    p.title.toLowerCase().includes(search.toLowerCase()) ||
    CATEGORY_LABELS[p.category]?.toLowerCase().includes(search.toLowerCase())
  );

  const steps: PlaybookStep[] = selected?.steps ? (() => { try { return JSON.parse(selected.steps); } catch { return []; } })() : [];
  const dataFields: string[] = selected?.dataToCollect ? (() => { try { return JSON.parse(selected.dataToCollect); } catch { return []; } })() : [];
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

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setEditOpen(true);
  };

  const openEdit = (pb: typeof playbooks[0]) => {
    setEditingId(pb.id);
    setForm({
      title: pb.title,
      category: pb.category,
      description: pb.description ?? "",
      estimatedHours: pb.estimatedHours,
      requiredTier: pb.requiredTier,
      steps: pb.steps ?? JSON.stringify([]),
      dataToCollect: pb.dataToCollect ?? JSON.stringify([]),
      safetyNotes: pb.safetyNotes ?? "",
      legalNotes: pb.legalNotes ?? "",
      nigeriaContext: pb.nigeriaContext ?? "",
    });
    setEditOpen(true);
  };

  const handleSave = () => {
    const payload = {
      ...form,
      estimatedHours: Number(form.estimatedHours),
      category: form.category as any,
      requiredTier: form.requiredTier as any,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <BISLayout>
      <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
        {/* Sidebar — playbook list */}
        <div className="w-80 shrink-0 border-r border-border flex flex-col bg-card">
          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-orange-500" />
                <h2 className="font-bold text-foreground">Field Agent Playbooks</h2>
              </div>
              {isAdmin && (
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={openCreate}>
                  <Plus className="w-3 h-3 mr-1" /> New
                </Button>
              )}
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
              <div key={pb.id} className="relative group">
                <button
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
                        {!pb.isActive && <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Inactive</span>}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                  </div>
                </button>
                {isAdmin && (
                  <div className="absolute top-2 right-8 hidden group-hover:flex items-center gap-1 bg-card border border-border rounded-lg shadow-sm px-1 py-0.5">
                    <button onClick={(e) => { e.stopPropagation(); openEdit(pb); }} className="p-1 hover:text-primary transition-colors">
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(pb.id); }} className="p-1 hover:text-red-500 transition-colors">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
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
              {isAdmin && (
                <Button className="mt-4" onClick={openCreate}>
                  <Plus className="w-4 h-4 mr-2" /> Create New Playbook
                </Button>
              )}
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
                  <div className="text-right shrink-0 flex flex-col items-end gap-2">
                    <div>
                      <div className="text-3xl font-bold">{selected.estimatedHours}h</div>
                      <div className="text-orange-200 text-xs">estimated</div>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => openEdit(selected)}
                        className="flex items-center gap-1 text-xs bg-white/20 hover:bg-white/30 px-2 py-1 rounded-lg transition-colors"
                      >
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-4">
                  <span className="text-xs px-2 py-1 rounded-full font-medium bg-white/20 text-white">
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

      {/* Create / Edit Dialog (admin only) */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Playbook" : "Create New Playbook"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Title *</Label>
                <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. KYC Physical Verification — Individual" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Category *</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Required Tier *</Label>
                <Select value={form.requiredTier} onValueChange={v => setForm(f => ({ ...f, requiredTier: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["junior", "senior", "lead", "specialist"].map(t => (
                      <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Estimated Hours *</Label>
                <Input type="number" min={1} max={200} value={form.estimatedHours} onChange={e => setForm(f => ({ ...f, estimatedHours: Number(e.target.value) }))} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Description *</Label>
                <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="Brief description of this playbook's purpose" />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Steps (JSON array) *</Label>
                <Textarea value={form.steps} onChange={e => setForm(f => ({ ...f, steps: e.target.value }))} rows={5} className="font-mono text-xs" placeholder='[{"order":1,"action":"Verify ID","required":true}]' />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Data to Collect (JSON array) *</Label>
                <Textarea value={form.dataToCollect} onChange={e => setForm(f => ({ ...f, dataToCollect: e.target.value }))} rows={3} className="font-mono text-xs" placeholder='["Full name","Date of birth"]' />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Safety Notes</Label>
                <Textarea value={form.safetyNotes} onChange={e => setForm(f => ({ ...f, safetyNotes: e.target.value }))} rows={3} placeholder="Optional safety guidance" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Legal Notes</Label>
                <Textarea value={form.legalNotes} onChange={e => setForm(f => ({ ...f, legalNotes: e.target.value }))} rows={3} placeholder="Optional legal guidance" />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Nigeria Context</Label>
                <Textarea value={form.nigeriaContext} onChange={e => setForm(f => ({ ...f, nigeriaContext: e.target.value }))} rows={2} placeholder="Nigeria-specific context or regulations" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving || !form.title || !form.description}>
              {isSaving ? "Saving…" : editingId ? "Save Changes" : "Create Playbook"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirm !== null} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-500 flex items-center gap-2">
              <Trash2 className="w-4 h-4" /> Delete Playbook
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This will permanently delete the playbook. This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && deleteMutation.mutate({ id: deleteConfirm })} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BISLayout>
  );
}
