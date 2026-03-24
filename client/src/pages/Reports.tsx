// Reports — Report Builder with template picker + generated reports list
// Design: Forensic Intelligence theme, semantic CSS variables

import { useState } from "react";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  FileText, Download, Search, Plus, Eye, Loader2,
  CheckCircle2, Clock, AlertTriangle, BarChart3, Filter,
  ChevronDown, ChevronUp, Shield, Users, Activity,
  Layers, X, Sparkles, BookOpen
} from "lucide-react";
import { mockInvestigations, formatDate, formatDateTime } from "@/lib/mockData";
import ReportPreviewSlideOver from "@/components/ReportPreviewSlideOver";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportFormat = "pdf" | "json" | "csv" | "xlsx";
type ReportStatus = "ready" | "generating" | "failed";
type ReportType = "investigation" | "bulk" | "analytics" | "compliance" | "sanctions" | "due_diligence";

interface Report {
  id: string;
  title: string;
  type: ReportType;
  format: ReportFormat;
  status: ReportStatus;
  size: string;
  createdAt: string;
  investigationRef?: string;
  sections: string[];
}

// ─── Templates ────────────────────────────────────────────────────────────────

interface ReportTemplate {
  id: ReportType;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  sections: string[];
  formats: ReportFormat[];
  estimatedPages: string;
}

const TEMPLATES: ReportTemplate[] = [
  {
    id: 'investigation',
    label: 'KYC Summary',
    description: 'Subject identity, document verification results, biometric match, and data source findings.',
    icon: <Shield size={18} />,
    color: 'text-blue-400',
    sections: ['Subject Profile', 'Document Verification', 'Biometric Match', 'Data Source Results', 'Risk Score'],
    formats: ['pdf', 'json'],
    estimatedPages: '4–6 pages',
  },
  {
    id: 'due_diligence',
    label: 'Full Due Diligence',
    description: 'Comprehensive background check including adverse media, PEP/sanctions, corporate structure, and field verification.',
    icon: <BookOpen size={18} />,
    color: 'text-violet-400',
    sections: ['Executive Summary', 'Subject Profile', 'Corporate Structure', 'Sanctions & PEP', 'Adverse Media', 'Field Verification', 'Risk Assessment'],
    formats: ['pdf'],
    estimatedPages: '12–20 pages',
  },
  {
    id: 'sanctions',
    label: 'Sanctions Screening',
    description: 'OFAC SDN, UN, EU, EFCC, and INTERPOL list checks with match confidence scores.',
    icon: <AlertTriangle size={18} />,
    color: 'text-red-400',
    sections: ['Screening Summary', 'OFAC SDN Results', 'UN Sanctions', 'EU Sanctions', 'EFCC Watchlist', 'INTERPOL Notices'],
    formats: ['pdf', 'json', 'csv'],
    estimatedPages: '2–4 pages',
  },
  {
    id: 'compliance',
    label: 'Compliance Summary',
    description: 'Monthly or quarterly compliance report covering KYC pass rates, flagged subjects, and regulatory metrics.',
    icon: <CheckCircle2 size={18} />,
    color: 'text-emerald-400',
    sections: ['Period Overview', 'KYC Metrics', 'Flagged Subjects', 'Regulatory Compliance', 'Recommendations'],
    formats: ['pdf', 'xlsx'],
    estimatedPages: '6–10 pages',
  },
  {
    id: 'analytics',
    label: 'Investigation Analytics',
    description: 'Risk score distributions, tier breakdown, country heatmap, and processing time analysis.',
    icon: <Activity size={18} />,
    color: 'text-amber-400',
    sections: ['Risk Distribution', 'Tier Analysis', 'Country Breakdown', 'Processing Metrics', 'Trend Analysis'],
    formats: ['pdf', 'xlsx'],
    estimatedPages: '8–12 pages',
  },
  {
    id: 'bulk',
    label: 'Bulk Data Export',
    description: 'Raw export of all investigation records with configurable fields for data analysis.',
    icon: <Layers size={18} />,
    color: 'text-cyan-400',
    sections: ['All Investigation Records', 'Subject Data', 'Risk Scores', 'Status History'],
    formats: ['csv', 'json', 'xlsx'],
    estimatedPages: 'N/A',
  },
];

// ─── Mock data ────────────────────────────────────────────────────────────────

const SEED_REPORTS: Report[] = [
  { id: "r1", title: "Adebayo Okafor — KYC Summary", type: "investigation", format: "pdf", status: "ready", size: "2.4 MB", createdAt: "2026-03-12T14:30:00Z", investigationRef: "BIS-2026-0001", sections: ['Subject Profile', 'Document Verification', 'Biometric Match', 'Data Source Results', 'Risk Score'] },
  { id: "r2", title: "Emeka Nwosu — Full Due Diligence", type: "due_diligence", format: "pdf", status: "ready", size: "3.1 MB", createdAt: "2026-03-20T09:00:00Z", investigationRef: "BIS-2026-0004", sections: ['Executive Summary', 'Subject Profile', 'Sanctions & PEP', 'Adverse Media', 'Risk Assessment'] },
  { id: "r3", title: "Greenfield Agro Ltd — Sanctions Screening", type: "sanctions", format: "pdf", status: "ready", size: "1.8 MB", createdAt: "2026-03-16T17:00:00Z", investigationRef: "BIS-2026-0007", sections: ['Screening Summary', 'OFAC SDN Results', 'EFCC Watchlist'] },
  { id: "r4", title: "March 2026 — Compliance Summary", type: "compliance", format: "pdf", status: "ready", size: "1.2 MB", createdAt: "2026-03-22T08:00:00Z", sections: ['Period Overview', 'KYC Metrics', 'Flagged Subjects', 'Regulatory Compliance'] },
  { id: "r5", title: "Q1 2026 — Investigation Analytics", type: "analytics", format: "xlsx", status: "ready", size: "5.8 MB", createdAt: "2026-03-01T00:00:00Z", sections: ['Risk Distribution', 'Tier Analysis', 'Country Breakdown'] },
  { id: "r6", title: "Bulk Export — All March Investigations", type: "bulk", format: "csv", status: "ready", size: "128 KB", createdAt: "2026-03-23T10:00:00Z", sections: ['All Investigation Records'] },
];

const TYPE_COLOR: Record<ReportType, string> = {
  investigation: 'text-blue-400',
  due_diligence: 'text-violet-400',
  sanctions:     'text-red-400',
  compliance:    'text-emerald-400',
  analytics:     'text-amber-400',
  bulk:          'text-cyan-400',
};

const TYPE_LABEL: Record<ReportType, string> = {
  investigation: 'KYC Summary',
  due_diligence: 'Due Diligence',
  sanctions:     'Sanctions',
  compliance:    'Compliance',
  analytics:     'Analytics',
  bulk:          'Bulk Export',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function Reports() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [reports, setReports] = useState<Report[]>(SEED_REPORTS);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [previewReport, setPreviewReport] = useState<Report | null>(null);

  // Builder state
  const [selectedTemplate, setSelectedTemplate] = useState<ReportTemplate | null>(null);
  const [selectedInv, setSelectedInv] = useState<string>("");
  const [selectedFormat, setSelectedFormat] = useState<ReportFormat>("pdf");
  const [includeSections, setIncludeSections] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);

  const filtered = reports.filter(r => {
    const matchSearch = r.title.toLowerCase().includes(search.toLowerCase()) ||
      (r.investigationRef || '').toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === "all" || r.type === typeFilter;
    return matchSearch && matchType;
  });

  const selectTemplate = (t: ReportTemplate) => {
    setSelectedTemplate(t);
    setIncludeSections([...t.sections]);
    setSelectedFormat(t.formats[0]);
    setSelectedInv('');
  };

  const toggleSection = (s: string) => {
    setIncludeSections(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    );
  };

  const needsInvestigation = selectedTemplate && ['investigation', 'due_diligence', 'sanctions'].includes(selectedTemplate.id);

  const handleGenerate = () => {
    if (!selectedTemplate) return;
    if (needsInvestigation && !selectedInv) {
      toast.error('Please select an investigation reference.');
      return;
    }
    if (includeSections.length === 0) {
      toast.error('Please include at least one section.');
      return;
    }

    setGenerating(true);
    const inv = mockInvestigations.find(i => i.ref === selectedInv);
    const title = needsInvestigation && inv
      ? `${inv.subjectName} — ${selectedTemplate.label}`
      : selectedTemplate.label + ` — ${new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`;

    setTimeout(() => {
      const newReport: Report = {
        id: `r${Date.now()}`,
        title,
        type: selectedTemplate.id,
        format: selectedFormat,
        status: 'ready',
        size: `${(Math.random() * 4 + 0.5).toFixed(1)} MB`,
        createdAt: new Date().toISOString(),
        investigationRef: selectedInv || undefined,
        sections: includeSections,
      };
      setReports(prev => [newReport, ...prev]);
      setGenerating(false);
      setBuilderOpen(false);
      setSelectedTemplate(null);
      toast.success(`Report "${title}" generated successfully.`);
    }, 2200);
  };

  const handleDownload = (r: Report) => {
    toast.success(`Downloading ${r.title} (${r.format.toUpperCase()})…`);
  };

  const inputCls = "h-8 text-xs font-mono bg-background border-border";

  return (
    <BISLayout
      title="Reports"
      subtitle={`${reports.length} reports available`}
      actions={
        <Button size="sm" className="h-7 text-xs gap-1.5" onClick={() => setBuilderOpen(v => !v)}>
          <Sparkles size={12} /> Report Builder
        </Button>
      }
    >
      {/* ── Report Builder ── */}
      {builderOpen && (
        <div className="bis-card p-5 mb-5 animate-fade-up">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-mono font-bold text-foreground">Report Builder</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">Choose a template, configure sections, then generate</p>
            </div>
            <button onClick={() => setBuilderOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          </div>

          {/* Step 1 — Template picker */}
          <div className="mb-5">
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-3">1. Choose Template</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => selectTemplate(t)}
                  className={cn(
                    "text-left p-3 rounded-lg border transition-all",
                    selectedTemplate?.id === t.id
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/40 hover:bg-muted/30"
                  )}
                >
                  <div className={cn("mb-1.5", t.color)}>{t.icon}</div>
                  <p className="text-xs font-mono font-semibold text-foreground">{t.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">{t.description}</p>
                  <p className="text-[9px] font-mono text-muted-foreground/60 mt-1.5">{t.estimatedPages}</p>
                </button>
              ))}
            </div>
          </div>

          {selectedTemplate && (
            <>
              {/* Step 2 — Sections */}
              <div className="mb-5">
                <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-3">2. Select Sections</p>
                <div className="flex flex-wrap gap-2">
                  {selectedTemplate.sections.map(s => (
                    <button
                      key={s}
                      onClick={() => toggleSection(s)}
                      className={cn(
                        "text-[10px] font-mono px-2.5 py-1 rounded-md border transition-all",
                        includeSections.includes(s)
                          ? "bg-primary/15 border-primary/40 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/30"
                      )}
                    >
                      {includeSections.includes(s) ? '✓ ' : ''}{s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Step 3 — Options */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
                {/* Investigation picker (only for subject-specific templates) */}
                {needsInvestigation && (
                  <div>
                    <label className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">
                      Investigation Reference *
                    </label>
                    <select
                      value={selectedInv}
                      onChange={e => setSelectedInv(e.target.value)}
                      className="w-full h-8 px-2 rounded-md border border-border bg-background text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="">Select investigation…</option>
                      {mockInvestigations.map(inv => (
                        <option key={inv.id} value={inv.ref}>{inv.ref} — {inv.subjectName}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Format */}
                <div>
                  <label className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">Output Format</label>
                  <select
                    value={selectedFormat}
                    onChange={e => setSelectedFormat(e.target.value as ReportFormat)}
                    className="w-full h-8 px-2 rounded-md border border-border bg-background text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {selectedTemplate.formats.map(f => (
                      <option key={f} value={f}>{f.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Generate button */}
              <div className="flex items-center justify-between pt-3 border-t border-border/50">
                <p className="text-[10px] font-mono text-muted-foreground">
                  {includeSections.length} section{includeSections.length !== 1 ? 's' : ''} selected · {selectedFormat.toUpperCase()}
                </p>
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  disabled={generating || (!!needsInvestigation && !selectedInv) || includeSections.length === 0}
                  onClick={handleGenerate}
                >
                  {generating
                    ? <><Loader2 size={11} className="animate-spin" /> Generating…</>
                    : <><Sparkles size={11} /> Generate Report</>}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Search reports or reference…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <Filter size={11} className="mr-1 shrink-0" /><SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {TEMPLATES.map(t => (
              <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Reports table ── */}
      <div className="bis-card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {['Report', 'Type', 'Sections', 'Format', 'Size', 'Created', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3">
                  <div>
                    <p className="text-xs font-mono font-semibold text-foreground">{r.title}</p>
                    {r.investigationRef && (
                      <p className="text-[10px] font-mono text-primary mt-0.5">{r.investigationRef}</p>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={cn("text-[10px] font-mono font-semibold", TYPE_COLOR[r.type])}>
                    {TYPE_LABEL[r.type]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {r.sections.length} section{r.sections.length !== 1 ? 's' : ''}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-[10px] font-mono text-muted-foreground uppercase">{r.format}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs font-mono text-muted-foreground">{r.size}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs gap-1"
                      onClick={(e) => { e.stopPropagation(); setPreviewReport(r); }}
                    >
                      <Eye size={11} /> Preview
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs gap-1"
                      onClick={() => handleDownload(r)}
                    >
                      <Download size={11} /> Download
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground text-sm">
                  No reports match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>

        <div className="px-4 py-2.5 border-t border-border/50">
          <span className="text-[10px] font-mono text-muted-foreground">
            {filtered.length} of {reports.length} reports
          </span>
        </div>
      </div>
      <ReportPreviewSlideOver
        report={previewReport}
        onClose={() => setPreviewReport(null)}
      />
    </BISLayout>
  );
}
