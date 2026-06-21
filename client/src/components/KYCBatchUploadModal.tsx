// KYCBatchUploadModal — Bulk CSV upload with per-row progress simulation
// Design: Forensic Intelligence theme, semantic CSS variables

import { useState, useRef, useCallback } from 'react';
import { X, Upload, FileText, CheckCircle2, AlertTriangle, Loader2, Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type RowStatus = 'queued' | 'processing' | 'passed' | 'failed' | 'review';

interface BatchRow {
  id: string;
  nin: string;
  name: string;
  dob: string;
  phone: string;
  status: RowStatus;
  riskScore?: number;
  message?: string;
}

// ─── Mock CSV parse ───────────────────────────────────────────────────────────

function parseCSV(text: string): BatchRow[] {
  const lines = text.trim().split('\n').filter(Boolean);
  const dataLines = lines[0].toLowerCase().includes('nin') ? lines.slice(1) : lines;
  return dataLines.slice(0, 50).map((line, i) => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    return {
      id: `row-${i}`,
      nin: cols[0] || `NIN${String(i + 1).padStart(11, '0')}`,
      name: cols[1] || `Subject ${i + 1}`,
      dob: cols[2] || '1990-01-01',
      phone: cols[3] || '+234800000000' + i,
      status: 'queued',
    };
  });
}

const SAMPLE_CSV = `NIN,Full Name,Date of Birth,Phone
12345678901,Emeka Okafor,1985-03-12,+2348012345678
98765432100,Ngozi Adeyemi,1992-07-24,+2347098765432
11223344556,Musa Aliyu,1978-11-05,+2348033221100
99887766554,Chidinma Eze,1995-02-18,+2348055443322
44332211009,Fatima Bello,1988-09-30,+2348023456789`;

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CFG: Record<RowStatus, { label: string; color: string; icon: React.ReactNode }> = {
  queued:     { label: 'Queued',     color: 'text-muted-foreground', icon: <FileText size={11} /> },
  processing: { label: 'Processing', color: 'text-blue-400',         icon: <Loader2 size={11} className="animate-spin" /> },
  passed:     { label: 'Passed',     color: 'text-emerald-400',      icon: <CheckCircle2 size={11} /> },
  failed:     { label: 'Failed',     color: 'text-red-400',          icon: <AlertTriangle size={11} /> },
  review:     { label: 'Review',     color: 'text-amber-400',        icon: <AlertTriangle size={11} /> },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface KYCBatchUploadModalProps {
  open: boolean;
  onClose: () => void;
}

export default function KYCBatchUploadModal({ open, onClose }: KYCBatchUploadModalProps) {
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      setRows(parseCSV(text));
      setDone(false);
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
  };

  const loadSample = () => {
    setRows(parseCSV(SAMPLE_CSV));
    setDone(false);
  };

  const startProcessing = () => {
    if (rows.length === 0) return;
    setRunning(true);
    setDone(false);

    // Set all to queued
    setRows(prev => prev.map(r => ({ ...r, status: 'queued' })));

    let idx = 0;
    intervalRef.current = setInterval(() => {
      if (idx >= rows.length) {
        clearInterval(intervalRef.current!);
        setRunning(false);
        setDone(true);
        return;
      }

      const rowId = rows[idx].id;

      // Mark current as processing
      setRows(prev => prev.map(r => r.id === rowId ? { ...r, status: 'processing' } : r));

      // After 600ms, mark result
      setTimeout(() => {
        const rand = Math.random();
        const status: RowStatus = rand > 0.75 ? 'passed' : rand > 0.55 ? 'review' : rand > 0.4 ? 'failed' : 'passed';
        const riskScore = status === 'passed' ? Math.floor(Math.random() * 35) + 5
          : status === 'review' ? Math.floor(Math.random() * 30) + 45
          : Math.floor(Math.random() * 25) + 70;
        const messages: Record<RowStatus, string> = {
          passed:  'All checks passed',
          review:  'Manual review required',
          failed:  'NIN mismatch detected',
          queued:  '',
          processing: '',
        };
        setRows(prev => prev.map(r => r.id === rowId
          ? { ...r, status, riskScore, message: messages[status] }
          : r
        ));
      }, 600);

      idx++;
    }, 800);
  };

  const reset = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setRows([]);
    setRunning(false);
    setDone(false);
  };

  const passed  = rows.filter(r => r.status === 'passed').length;
  const failed  = rows.filter(r => r.status === 'failed').length;
  const review  = rows.filter(r => r.status === 'review').length;
  const processed = rows.filter(r => ['passed', 'failed', 'review'].includes(r.status)).length;
  const progress = rows.length > 0 ? Math.round((processed / rows.length) * 100) : 0;

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 max-w-2xl mx-auto z-50 bg-popover border border-border rounded-xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="text-sm font-mono font-bold text-foreground">KYC Bulk Upload</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">Upload a CSV of subjects for batch verification</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* Drop zone */}
          {rows.length === 0 && (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={cn(
                "border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer",
                dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
              )}
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={28} className="mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-mono font-semibold text-foreground mb-1">Drop CSV file here</p>
              <p className="text-xs text-muted-foreground mb-3">or click to browse — max 50 rows</p>
              <p className="text-[10px] font-mono text-muted-foreground/60">
                Required columns: NIN, Full Name, Date of Birth, Phone
              </p>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileChange} />
            </div>
          )}

          {rows.length === 0 && (
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] font-mono text-muted-foreground">OR</span>
              <div className="flex-1 h-px bg-border" />
            </div>
          )}

          {rows.length === 0 && (
            <button
              onClick={loadSample}
              className="w-full flex items-center justify-center gap-2 text-xs font-mono text-primary border border-primary/30 rounded-lg py-2.5 hover:bg-primary/5 transition-colors"
            >
              <Download size={12} /> Load sample data (5 subjects)
            </button>
          )}

          {/* Progress bar */}
          {rows.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  {done ? 'Batch complete' : running ? 'Processing…' : 'Ready to process'}
                </span>
                <span className="text-[10px] font-mono text-foreground">{progress}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>

              {/* Summary chips */}
              {processed > 0 && (
                <div className="flex gap-3 mt-2">
                  <span className="text-[10px] font-mono text-emerald-400">{passed} passed</span>
                  <span className="text-[10px] font-mono text-amber-400">{review} review</span>
                  <span className="text-[10px] font-mono text-red-400">{failed} failed</span>
                  <span className="text-[10px] font-mono text-muted-foreground">{rows.length - processed} remaining</span>
                </div>
              )}
            </div>
          )}

          {/* Row table */}
          {rows.length > 0 && (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {['NIN', 'Name', 'DOB', 'Status', 'Risk', 'Note'].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-[9px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const cfg = STATUS_CFG[row.status];
                    return (
                      <tr key={row.id} className="border-b border-border/50 hover:bg-muted/10">
                        <td className="px-3 py-2 font-mono text-[10px] text-foreground">{row.nin}</td>
                        <td className="px-3 py-2 font-mono text-[10px] text-foreground">{row.name}</td>
                        <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{row.dob}</td>
                        <td className="px-3 py-2">
                          <span className={cn("flex items-center gap-1 font-mono text-[10px]", cfg.color)}>
                            {cfg.icon} {cfg.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-[10px]">
                          {row.riskScore !== undefined ? (
                            <span style={{ color: row.riskScore >= 70 ? 'var(--risk-critical)' : row.riskScore >= 45 ? 'var(--risk-medium)' : 'var(--risk-low)' }}>
                              {row.riskScore}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2 text-[10px] text-muted-foreground">{row.message || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            {rows.length > 0 && (
              <button onClick={reset} className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground">
                <RefreshCw size={11} /> Reset
              </button>
            )}
            {rows.length > 0 && (
              <span className="text-[10px] font-mono text-muted-foreground">{rows.length} subjects loaded</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5"
              disabled={rows.length === 0 || running}
              onClick={startProcessing}
            >
              {running ? <><Loader2 size={11} className="animate-spin" /> Processing…</> : <><Upload size={11} /> Start Batch KYC</>}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
