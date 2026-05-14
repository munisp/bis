/**
 * Onboarding Admin Page
 * =====================
 * Lists all stakeholder onboarding applications with status filters,
 * detail drawer, and approve/reject actions wired to trpc.onboarding.updateStatus.
 */

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import BISLayout from "@/components/BISLayout";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  CheckCircle2, XCircle, Clock, Eye, Search, RefreshCw,
  Building2, User, Globe, Phone, Mail, FileText, Loader2, Download, Maximize2, X as XIcon,
  StickyNote, Save, MessageSquare, Send,
} from "lucide-react";

type OnboardingStatus = "draft" | "submitted" | "awaiting_documents" | "under_review" | "approved" | "rejected";

const STATUS_CONFIG: Record<OnboardingStatus, { label: string; color: string; icon: React.ReactNode }> = {
  draft:               { label: "Draft",              color: "bg-muted text-muted-foreground",        icon: <FileText className="w-3 h-3" /> },
  submitted:           { label: "Submitted",           color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",   icon: <Clock className="w-3 h-3" /> },
  awaiting_documents:  { label: "Awaiting Docs",       color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300", icon: <Clock className="w-3 h-3" /> },
  under_review:        { label: "Under Review",        color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300", icon: <Eye className="w-3 h-3" /> },
  approved:            { label: "Approved",            color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",  icon: <CheckCircle2 className="w-3 h-3" /> },
  rejected:            { label: "Rejected",            color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",          icon: <XCircle className="w-3 h-3" /> },
};

function StatusBadge({ status }: { status: OnboardingStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

type DocPreview = { name: string; url: string; isPdf: boolean };

type Application = {
  id: number;
  referenceId: string;
  entityType: string;
  legalName: string;
  tradingName?: string | null;
  countryCode?: string | null;
  stateProvince?: string | null;
  city?: string | null;
  address?: string | null;
  website?: string | null;
  businessCategory?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactTitle?: string | null;
  useCase?: string | null;
  pepDeclaration?: boolean | null;
  agreedToTerms?: boolean | null;
  status: OnboardingStatus;
  stakeholders?: unknown;
  documentUrls?: Array<{ name: string; url: string; key: string; uploadedAt: string }> | null;
  createdBy?: string | null;
  adminNotes?: string | null;
  reviewerLog?: Array<{ authorId: number; authorName: string; note: string; createdAt: string }> | null;
  createdAt: Date;
  updatedAt: Date;
};

export default function OnboardingAdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [docPreview, setDocPreview] = useState<DocPreview | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  // selectedId drives the onboarding.get query; selected is the resolved record
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [notesDraft, setNotesDraft] = useState<string>('');
  const [logDraft, setLogDraft] = useState<string>('');  // for append-only reviewer log

  const isAdmin = user?.role === "admin";

  const { data, isLoading, refetch } = trpc.onboarding.list.useQuery(
    { limit: 200, offset: 0 },
    { enabled: isAdmin },
  );

  // Fetch full application detail via onboarding.get when a row is clicked
  const { data: selectedRecord, isLoading: detailLoading } = trpc.onboarding.get.useQuery(
    { id: selectedId! },
    { enabled: !!selectedId && isAdmin },
  );

  // Sync notesDraft whenever the selected record changes
  useEffect(() => {
    if (selectedRecord) {
      setNotesDraft((selectedRecord as any).adminNotes ?? '');
    } else if (!selectedId) {
      setNotesDraft('');
    }
  }, [selectedId, (selectedRecord as any)?.adminNotes]);

  // Merge list row (for instant open) with fresh server data when available
  const listItems = (data?.items ?? []) as Application[];
  const selected: Application | null = selectedId
    ? ((selectedRecord as Application | undefined) ?? listItems.find(a => a.id === selectedId) ?? null)
    : null;

  const updateStatus = trpc.onboarding.updateStatus.useMutation({
    onSuccess: (_, vars) => {
      toast.success(`Application status updated to "${vars.status}"`);
      setActionLoading(false);
      setSelectedId(null);
      refetch();
    },
    onError: (e) => {
      toast.error(`Update failed: ${e.message}`);
      setActionLoading(false);
    },
  });

  const utils = trpc.useUtils();

  const addNoteMutation = trpc.onboarding.addNote.useMutation({
    onSuccess: () => {
      toast.success('Admin notes saved');
      utils.onboarding.get.invalidate({ id: selectedId! });
      utils.onboarding.list.invalidate();
    },
    onError: (e) => toast.error(`Failed to save notes: ${e.message}`),
  });

  const appendNoteMutation = trpc.onboarding.appendNote.useMutation({
    onSuccess: () => {
      toast.success('Log entry added');
      setLogDraft('');
      utils.onboarding.get.invalidate({ id: selectedId! });
    },
    onError: (e) => toast.error(`Failed to add log entry: ${e.message}`),
  });

  const handleSaveNotes = () => {
    if (!selectedId) return;
    addNoteMutation.mutate({ id: selectedId, notes: notesDraft });
  };

  const handleAppendLog = () => {
    if (!selectedId || !logDraft.trim()) return;
    appendNoteMutation.mutate({ id: selectedId, note: logDraft.trim() });
  };

  const handleAction = (id: number, status: OnboardingStatus) => {
    setActionLoading(true);
    updateStatus.mutate({ id, status });
  };

  const filtered = listItems.filter(app => {
    const matchesStatus = statusFilter === "all" || app.status === statusFilter;
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      app.legalName.toLowerCase().includes(q) ||
      app.referenceId.toLowerCase().includes(q) ||
      (app.contactEmail ?? "").toLowerCase().includes(q) ||
      (app.businessCategory ?? "").toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  const counts = listItems.reduce((acc, app) => {
    acc[app.status] = (acc[app.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Show loading state while auth resolves
  if (authLoading) {
    return (
      <BISLayout title="Onboarding Applications" subtitle="">
        <div className="flex items-center justify-center h-40 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Checking permissions…
        </div>
      </BISLayout>
    );
  }

  // Block non-admins with a clear 403 message
  if (!isAdmin) {
    return (
      <BISLayout title="Access Denied" subtitle="">
        <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
          <ShieldX className="w-14 h-14 text-destructive opacity-70" />
          <h2 className="text-xl font-semibold text-foreground">Restricted Area</h2>
          <p className="text-muted-foreground max-w-sm">
            The Onboarding Admin panel requires the <strong>admin</strong> role. Contact your platform administrator to request access.
          </p>
        </div>
      </BISLayout>
    );
  }

  return (
    <BISLayout title="Onboarding Applications" subtitle="Review and manage stakeholder onboarding submissions">
      {/* ── Toolbar ── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name, reference, email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses ({listItems.length})</SelectItem>
            {(Object.keys(STATUS_CONFIG) as OnboardingStatus[]).map(s => (
              <SelectItem key={s} value={s}>
                {STATUS_CONFIG[s].label} {counts[s] ? `(${counts[s]})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={() => refetch()} title="Refresh" aria-label="Refresh applications">
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {/* ── Stats Row ── */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
        {(Object.keys(STATUS_CONFIG) as OnboardingStatus[]).map(s => (
          <div key={s} className="bg-card border border-border rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-foreground">{counts[s] ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{STATUS_CONFIG[s].label}</div>
          </div>
        ))}
      </div>

      {/* ── Table ── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading applications…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
            <FileText className="w-8 h-8 opacity-40" />
            <p className="text-sm">No applications found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Reference</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Entity</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Contact</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Submitted</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((app, i) => (
                  <tr
                    key={app.id}
                    className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{app.referenceId}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{app.legalName}</div>
                      {app.tradingName && <div className="text-xs text-muted-foreground">t/a {app.tradingName}</div>}
                      <div className="text-xs text-muted-foreground capitalize">{app.entityType.replace(/_/g, " ")}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-foreground">{app.contactName ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{app.contactEmail ?? ""}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground capitalize">
                      {app.businessCategory?.replace(/_/g, " ") ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={app.status} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {new Date(app.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedId(app.id)}
                        className="text-xs"
                      >
                        <Eye className="w-3 h-3 mr-1" /> Review
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Detail / Action Dialog ── */}
      <Dialog open={!!selectedId} onOpenChange={open => { if (!open) setSelectedId(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-primary" />
                  {selected.legalName}
                  <StatusBadge status={selected.status} />
                </DialogTitle>
                <p className="text-sm text-muted-foreground font-mono">{selected.referenceId}</p>
              </DialogHeader>

              <div className="space-y-4 mt-2">
                {/* Entity Info */}
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                    <Building2 className="w-4 h-4" /> Entity Information
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-muted-foreground">Type:</span> <span className="capitalize">{selected.entityType.replace(/_/g, " ")}</span></div>
                    <div><span className="text-muted-foreground">Category:</span> <span className="capitalize">{selected.businessCategory?.replace(/_/g, " ") ?? "—"}</span></div>
                    <div><span className="text-muted-foreground">Country:</span> {selected.countryCode ?? "—"}</div>
                    <div><span className="text-muted-foreground">State:</span> {selected.stateProvince ?? "—"}</div>
                    <div className="col-span-2"><span className="text-muted-foreground">Address:</span> {[selected.address, selected.city].filter(Boolean).join(", ") || "—"}</div>
                    {selected.website && (
                      <div className="col-span-2 flex items-center gap-1">
                        <Globe className="w-3 h-3 text-muted-foreground" />
                        <a href={selected.website} target="_blank" rel="noreferrer" className="text-primary hover:underline text-xs">{selected.website}</a>
                      </div>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Contact */}
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                    <User className="w-4 h-4" /> Primary Contact
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-muted-foreground">Name:</span> {selected.contactName ?? "—"}</div>
                    <div><span className="text-muted-foreground">Title:</span> {selected.contactTitle ?? "—"}</div>
                    {selected.contactEmail && (
                      <div className="flex items-center gap-1">
                        <Mail className="w-3 h-3 text-muted-foreground" />
                        <span>{selected.contactEmail}</span>
                      </div>
                    )}
                    {selected.contactPhone && (
                      <div className="flex items-center gap-1">
                        <Phone className="w-3 h-3 text-muted-foreground" />
                        <span>{selected.contactPhone}</span>
                      </div>
                    )}
                  </div>
                </div>

                {selected.useCase && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-1">Use Case</h4>
                      <p className="text-sm text-muted-foreground">{selected.useCase}</p>
                    </div>
                  </>
                )}

                {/* Declarations */}
                <Separator />
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">PEP Declaration:</span>{" "}
                    <span className={selected.pepDeclaration ? "text-red-500 font-medium" : "text-green-600"}>
                      {selected.pepDeclaration ? "Yes — PEP" : "No PEP"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Terms Agreed:</span>{" "}
                    <span className={selected.agreedToTerms ? "text-green-600" : "text-red-500"}>
                      {selected.agreedToTerms ? "Yes" : "No"}
                    </span>
                  </div>
                </div>

                {/* Uploaded Documents */}
                {Array.isArray(selected.documentUrls) && selected.documentUrls.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                        <FileText className="w-4 h-4" /> Uploaded Documents ({selected.documentUrls.length})
                      </h4>
                      <div className="space-y-1.5">
                        {selected.documentUrls.map((doc, i) => (
                          <div key={i} className="flex items-center justify-between bg-muted/30 rounded px-3 py-2 text-sm">
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              <span className="truncate font-medium">{doc.name}</span>
                              <span className="text-xs text-muted-foreground shrink-0">
                                {new Date(doc.uploadedAt).toLocaleDateString()}
                              </span>
                            </div>
                            <a
                              href={doc.url}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-2 shrink-0 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <Download className="w-3 h-3" /> Download
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Stakeholders */}
                {Array.isArray(selected.stakeholders) && (selected.stakeholders as unknown[]).length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-semibold text-foreground mb-2">Stakeholders</h4>
                      <div className="space-y-1">
                        {(selected.stakeholders as Array<{ role: string; fullName: string; email?: string; ownershipPercentage?: number }>).map((s, i) => (
                          <div key={i} className="text-sm flex items-center justify-between bg-muted/30 rounded px-3 py-1.5">
                            <span>{s.fullName} <span className="text-muted-foreground capitalize">({s.role})</span></span>
                            {s.ownershipPercentage != null && <span className="text-muted-foreground">{s.ownershipPercentage}%</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

                {/* Admin Notes */}
                <Separator />
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                    <StickyNote className="w-4 h-4" /> Reviewer Notes
                  </h4>
                  <Textarea
                    value={notesDraft}
                    onChange={e => setNotesDraft(e.target.value)}
                    placeholder="Add internal reviewer notes visible only to admins…"
                    className="text-sm resize-none min-h-[80px]"
                    maxLength={4000}
                  />
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs text-muted-foreground">{notesDraft.length}/4000</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleSaveNotes}
                      disabled={addNoteMutation.isPending}
                      className="gap-1.5 text-xs"
                    >
                      {addNoteMutation.isPending
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Save className="w-3.5 h-3.5" />}
                      Save Notes
                    </Button>
                  </div>
                </div>

                {/* Reviewer Log — append-only audit trail */}
                <Separator />
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4" /> Reviewer Log
                    <span className="text-xs text-muted-foreground font-normal">(append-only)</span>
                  </h4>
                  {/* Existing entries */}
                  {Array.isArray(selected.reviewerLog) && selected.reviewerLog.length > 0 ? (
                    <div className="space-y-2 mb-3 max-h-40 overflow-y-auto pr-1">
                      {[...(selected.reviewerLog ?? [])].reverse().map((entry, i) => (
                        <div key={i} className="bg-muted/30 rounded-lg px-3 py-2 text-sm">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="font-medium text-foreground text-xs">{entry.authorName}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(entry.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-muted-foreground text-xs leading-relaxed">{entry.note}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground mb-3">No log entries yet.</p>
                  )}
                  {/* New entry input */}
                  <div className="flex gap-2">
                    <Textarea
                      value={logDraft}
                      onChange={e => setLogDraft(e.target.value)}
                      placeholder="Add a log entry…"
                      className="text-sm resize-none min-h-[60px] flex-1"
                      maxLength={2000}
                      onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAppendLog(); }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleAppendLog}
                      disabled={appendNoteMutation.isPending || !logDraft.trim()}
                      className="self-end gap-1.5 text-xs"
                      title="Add log entry (Ctrl+Enter)"
                    >
                      {appendNoteMutation.isPending
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Send className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </div>

                {/* Loading overlay while fetching fresh data */}
              {detailLoading && !selectedRecord && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Fetching latest data…
                </div>
              )}

              <DialogFooter className="mt-4 flex flex-wrap gap-2">
                {selected.status !== "approved" && (
                  <Button
                    variant="default"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    disabled={actionLoading}
                    onClick={() => handleAction(selected.id, "approved")}
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
                    Approve
                  </Button>
                )}
                {selected.status !== "under_review" && selected.status !== "approved" && (
                  <Button
                    variant="outline"
                    disabled={actionLoading}
                    onClick={() => handleAction(selected.id, "under_review")}
                  >
                    <Eye className="w-4 h-4 mr-1" /> Mark Under Review
                  </Button>
                )}
                {selected.status !== "awaiting_documents" && selected.status !== "approved" && (
                  <Button
                    variant="outline"
                    disabled={actionLoading}
                    onClick={() => handleAction(selected.id, "awaiting_documents")}
                  >
                    <FileText className="w-4 h-4 mr-1" /> Request Documents
                  </Button>
                )}
                {selected.status !== "rejected" && (
                  <Button
                    variant="outline"
                    className="text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-900/20"
                    disabled={actionLoading}
                    onClick={() => handleAction(selected.id, "rejected")}
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <XCircle className="w-4 h-4 mr-1" />}
                    Reject
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setSelectedId(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Document Preview Modal ── */}
      {docPreview && (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-black/90"
          onClick={() => setDocPreview(null)}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 bg-black/60 border-b border-white/10"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 text-white">
              <FileText className="w-4 h-4 text-white/60" />
              <span className="text-sm font-medium truncate max-w-[60vw]">{docPreview.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={docPreview.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-white/70 hover:text-white px-3 py-1.5 rounded border border-white/20 hover:border-white/40 transition-colors"
              >
                <Download className="w-3 h-3" /> Download
              </a>
              <button
                onClick={() => setDocPreview(null)}
                className="p-1.5 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div
            className="flex-1 overflow-hidden flex items-center justify-center p-4"
            onClick={e => e.stopPropagation()}
          >
            {docPreview.isPdf ? (
              <iframe
                src={docPreview.url}
                title={docPreview.name}
                className="w-full h-full rounded border border-white/10"
                style={{ minHeight: "70vh" }}
              />
            ) : (
              <img
                src={docPreview.url}
                alt={docPreview.name}
                className="max-w-full max-h-full object-contain rounded shadow-2xl"
                style={{ maxHeight: "80vh" }}
              />
            )}
          </div>

          {/* Click-outside hint */}
          <p className="text-center text-xs text-white/30 pb-3">Click outside to close</p>
        </div>
      )}
    </BISLayout>
  );
}
