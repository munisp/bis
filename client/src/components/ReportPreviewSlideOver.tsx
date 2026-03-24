// ReportPreviewSlideOver — Structured preview of a report before download
// Design: Forensic Intelligence theme, semantic CSS variables

import { X, Download, FileText, Shield, BookOpen, AlertTriangle,
         CheckCircle2, Activity, Layers, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportType = 'investigation' | 'bulk' | 'analytics' | 'compliance' | 'sanctions' | 'due_diligence';

interface Report {
  id: string;
  title: string;
  type: ReportType;
  format: string;
  status: string;
  size: string;
  createdAt: string;
  investigationRef?: string;
  sections: string[];
}

interface ReportPreviewSlideOverProps {
  report: Report | null;
  onClose: () => void;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const TYPE_ICON: Record<ReportType, React.ReactNode> = {
  investigation: <Shield size={16} />,
  due_diligence: <BookOpen size={16} />,
  sanctions:     <AlertTriangle size={16} />,
  compliance:    <CheckCircle2 size={16} />,
  analytics:     <Activity size={16} />,
  bulk:          <Layers size={16} />,
};

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
  due_diligence: 'Full Due Diligence',
  sanctions:     'Sanctions Screening',
  compliance:    'Compliance Summary',
  analytics:     'Investigation Analytics',
  bulk:          'Bulk Data Export',
};

// ─── Mock preview data per type ───────────────────────────────────────────────

function getMockPreviewContent(report: Report) {
  const t = report.type;

  if (t === 'investigation' || t === 'due_diligence') {
    return {
      headline: 'Subject Overview',
      fields: [
        { label: 'Full Name',        value: report.title.split('—')[0].trim() },
        { label: 'Investigation Ref', value: report.investigationRef || 'N/A' },
        { label: 'Subject Type',     value: 'Individual' },
        { label: 'Nationality',      value: 'Nigerian' },
        { label: 'Risk Score',       value: '42 / 100 — MEDIUM', highlight: 'amber' },
        { label: 'KYC Decision',     value: 'PASSED', highlight: 'green' },
        { label: 'Biometric Match',  value: '97.3% confidence', highlight: 'green' },
        { label: 'NIN Verified',     value: 'Yes — NIMC confirmed' },
        { label: 'BVN Verified',     value: 'Yes — CBN confirmed' },
        { label: 'Sanctions Match',  value: 'No matches found', highlight: 'green' },
      ],
      note: 'This preview shows the Executive Summary section. The full report includes all selected sections.',
    };
  }

  if (t === 'sanctions') {
    return {
      headline: 'Screening Summary',
      fields: [
        { label: 'Subject',         value: report.title.split('—')[0].trim() },
        { label: 'Ref',             value: report.investigationRef || 'N/A' },
        { label: 'OFAC SDN',        value: 'No match', highlight: 'green' },
        { label: 'UN Sanctions',    value: 'No match', highlight: 'green' },
        { label: 'EU Sanctions',    value: 'No match', highlight: 'green' },
        { label: 'EFCC Watchlist',  value: '1 partial match — review required', highlight: 'amber' },
        { label: 'INTERPOL',        value: 'No match', highlight: 'green' },
        { label: 'Overall Result',  value: 'REVIEW REQUIRED', highlight: 'amber' },
      ],
      note: 'Partial match on EFCC watchlist. Manual review recommended before approval.',
    };
  }

  if (t === 'compliance') {
    return {
      headline: 'Period Overview',
      fields: [
        { label: 'Period',              value: 'March 2026' },
        { label: 'Total KYC Checks',    value: '1,203' },
        { label: 'Pass Rate',           value: '94.2%', highlight: 'green' },
        { label: 'Flagged Subjects',    value: '7', highlight: 'amber' },
        { label: 'Sanctions Hits',      value: '2', highlight: 'red' },
        { label: 'Avg Processing Time', value: '4.7 minutes' },
        { label: 'Compliance Score',    value: '98.1 / 100', highlight: 'green' },
      ],
      note: 'Compliance score above 95 — no regulatory escalations required this period.',
    };
  }

  if (t === 'analytics') {
    return {
      headline: 'Risk Distribution',
      fields: [
        { label: 'Period',          value: 'Q1 2026' },
        { label: 'Low Risk (0–30)', value: '1,847 subjects (64.9%)' },
        { label: 'Med Risk (31–69)', value: '812 subjects (28.5%)' },
        { label: 'High Risk (70+)', value: '188 subjects (6.6%)', highlight: 'red' },
        { label: 'Avg Risk Score',  value: '34.2' },
        { label: 'Top Country',     value: 'Nigeria (78%)' },
        { label: 'Top Tier',        value: 'Basic (43%)' },
      ],
      note: 'High-risk subjects increased 2.1% vs Q4 2025. Recommend enhanced monitoring.',
    };
  }

  // bulk
  return {
    headline: 'Export Summary',
    fields: [
      { label: 'Records',      value: `${mockInvestigations.length} investigations` },
      { label: 'Date Range',   value: 'Jan 2026 – Mar 2026' },
      { label: 'Format',       value: report.format.toUpperCase() },
      { label: 'File Size',    value: report.size },
      { label: 'Fields',       value: report.sections.join(', ') },
    ],
    note: 'Raw export — no PII masking applied. Handle in accordance with data protection policy.',
  };
}

// ─── Dummy import for mockInvestigations length ───────────────────────────────
import { mockInvestigations } from '@/lib/mockData';

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReportPreviewSlideOver({ report, onClose }: ReportPreviewSlideOverProps) {
  if (!report) return null;

  const preview = getMockPreviewContent(report);
  const icon = TYPE_ICON[report.type];
  const color = TYPE_COLOR[report.type];
  const typeLabel = TYPE_LABEL[report.type];

  const highlightCls = (h?: string) => {
    if (!h) return 'text-foreground';
    if (h === 'green') return 'text-emerald-400';
    if (h === 'amber') return 'text-amber-400';
    if (h === 'red')   return 'text-red-400';
    return 'text-foreground';
  };

  const handleDownload = () => {
    toast.success(`Downloading ${report.title} (${report.format.toUpperCase()})…`);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md z-50 bg-popover border-l border-border shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className={cn("mt-0.5", color)}>{icon}</div>
            <div>
              <p className={cn("text-[9px] font-mono uppercase tracking-wider mb-0.5", color)}>{typeLabel}</p>
              <h2 className="text-sm font-mono font-bold text-foreground leading-snug">{report.title}</h2>
              <div className="flex items-center gap-2 mt-1">
                {report.investigationRef && (
                  <span className="text-[10px] font-mono text-primary">{report.investigationRef}</span>
                )}
                <span className="text-[10px] font-mono text-muted-foreground uppercase">{report.format}</span>
                <span className="text-[10px] font-mono text-muted-foreground">{report.size}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground mt-0.5">
            <X size={16} />
          </button>
        </div>

        {/* Preview body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Section list */}
          <div>
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Included Sections</p>
            <div className="space-y-1">
              {report.sections.map((s, i) => (
                <div key={s} className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                  <ChevronRight size={10} className="text-primary shrink-0" />
                  <span>{s}</span>
                  {i === 0 && <span className="text-[9px] text-primary/60 ml-auto">preview below</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Mock first page */}
          <div className="bis-card p-4">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border/50">
              <FileText size={12} className={color} />
              <p className="text-xs font-mono font-semibold text-foreground">{preview.headline}</p>
              <span className="ml-auto text-[9px] font-mono text-muted-foreground/50">Page 1</span>
            </div>

            <div className="space-y-2">
              {preview.fields.map(f => (
                <div key={f.label} className="flex items-start justify-between gap-4">
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0 w-36">{f.label}</span>
                  <span className={cn("text-[10px] font-mono text-right", highlightCls(f.highlight))}>
                    {f.value}
                  </span>
                </div>
              ))}
            </div>

            {preview.note && (
              <div className="mt-3 pt-2 border-t border-border/50">
                <p className="text-[10px] font-mono text-muted-foreground italic">{preview.note}</p>
              </div>
            )}
          </div>

          {/* Placeholder pages */}
          <div className="space-y-2">
            {report.sections.slice(1, 3).map(s => (
              <div key={s} className="bis-card p-3 opacity-40">
                <div className="flex items-center gap-2 mb-2">
                  <FileText size={10} className="text-muted-foreground" />
                  <p className="text-[10px] font-mono text-muted-foreground">{s}</p>
                </div>
                <div className="space-y-1.5">
                  {[80, 60, 90, 50].map((w, i) => (
                    <div key={i} className="h-1.5 bg-muted rounded-full" style={{ width: `${w}%` }} />
                  ))}
                </div>
              </div>
            ))}
            {report.sections.length > 3 && (
              <p className="text-[10px] font-mono text-muted-foreground/50 text-center">
                + {report.sections.length - 3} more section{report.sections.length - 3 > 1 ? 's' : ''} in full report
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between flex-shrink-0">
          <div>
            <p className="text-[10px] font-mono text-muted-foreground">{report.sections.length} sections · {report.size}</p>
            <p className="text-[9px] font-mono text-muted-foreground/50">{new Date(report.createdAt).toLocaleString()}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onClose}>Close</Button>
            <Button size="sm" className="h-7 text-xs gap-1.5" onClick={handleDownload}>
              <Download size={11} /> Download {report.format.toUpperCase()}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
