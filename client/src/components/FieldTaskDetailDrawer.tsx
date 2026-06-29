// FieldTaskDetailDrawer.tsx
// Full return-leg field visit UI: check-in, check-out, findings submission, photo upload

import { useState, useRef, useCallback } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  X, MapPin, Clock, CheckCircle2, AlertTriangle, Camera, Upload,
  FileText, User, Navigation, Loader2, ChevronDown, ChevronUp,
  Shield, Image as ImageIcon, Send, RefreshCw, CheckSquare,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res((reader.result as string).split(',')[1]);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

// ─── Status Config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending:     { label: 'Pending',     color: 'text-muted-foreground', bg: 'bg-muted/30 border-border' },
  dispatched:  { label: 'Dispatched',  color: 'text-blue-400',         bg: 'bg-blue-500/10 border-blue-500/30' },
  in_progress: { label: 'In Progress', color: 'text-amber-400',        bg: 'bg-amber-500/10 border-amber-500/30' },
  completed:   { label: 'Completed',   color: 'text-emerald-400',      bg: 'bg-emerald-500/10 border-emerald-500/30' },
  failed:      { label: 'Failed',      color: 'text-red-400',          bg: 'bg-red-500/10 border-red-500/30' },
  cancelled:   { label: 'Cancelled',   color: 'text-muted-foreground', bg: 'bg-muted/30 border-border' },
};

const OUTCOME_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  confirmed:    { label: 'Confirmed',    color: 'text-emerald-400', icon: <CheckCircle2 size={13} /> },
  unconfirmed:  { label: 'Unconfirmed',  color: 'text-red-400',     icon: <AlertTriangle size={13} /> },
  inconclusive: { label: 'Inconclusive', color: 'text-amber-400',   icon: <Shield size={13} /> },
};

// ─── GPS Helper ───────────────────────────────────────────────────────────────

function useGps() {
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  const capture = useCallback((): Promise<{ lat: number; lng: number } | null> => {
    setLoading(true);
    return new Promise((res) => {
      if (!navigator.geolocation) { setLoading(false); res(null); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setCoords(c);
          setLoading(false);
          res(c);
        },
        () => { setLoading(false); res(null); },
        { timeout: 10000, maximumAge: 30000 }
      );
    });
  }, []);

  return { loading, coords, capture };
}

// ─── Photo Upload Strip ───────────────────────────────────────────────────────

function PhotoUploadStrip({ taskRef, existingUrls, onUrlAdded }: {
  taskRef: string;
  existingUrls: string[];
  onUrlAdded: (url: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadPhoto = trpc.fieldTasks.uploadPhoto.useMutation({
    onSuccess: (data) => {
      onUrlAdded(data.url);
      toast.success('Photo uploaded');
    },
    onError: () => toast.error('Photo upload failed'),
  });

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (file.size > 16 * 1024 * 1024) { toast.error(`${file.name} exceeds 16 MB`); continue; }
      const base64 = await fileToBase64(file);
      uploadPhoto.mutate({ taskRef, fileName: file.name, fileBase64: base64, mimeType: file.type });
    }
  };

  return (
    <div>
      <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-2">
        Photo Evidence ({existingUrls.length})
      </p>
      <div className="flex flex-wrap gap-2">
        {existingUrls.map((url, i) => (
          <a key={i} href={url} target="_blank" rel="noopener noreferrer"
            className="w-16 h-16 rounded-md border border-border overflow-hidden hover:border-primary transition-colors">
            <img src={url} alt={`Evidence ${i + 1}`} className="w-full h-full object-cover" />
          </a>
        ))}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploadPhoto.isPending}
          className="w-16 h-16 rounded-md border border-dashed border-border hover:border-primary flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
        >
          {uploadPhoto.isPending
            ? <Loader2 size={14} className="animate-spin" />
            : <><Camera size={14} /><span className="text-[9px] font-mono">Add</span></>
          }
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
          onChange={e => handleFiles(e.target.files)} />
      </div>
    </div>
  );
}

// ─── Check-In Panel ───────────────────────────────────────────────────────────

function CheckInPanel({ task, report, onDone }: { task: any; report: any; onDone: () => void }) {
  const gps = useGps();
  const utils = trpc.useUtils();
  const checkIn = trpc.fieldTasks.checkIn.useMutation({
    onSuccess: () => {
      toast.success('Checked in successfully');
      utils.fieldTasks.get.invalidate({ taskRef: task.taskRef });
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleCheckIn = async () => {
    const coords = await gps.capture();
    checkIn.mutate({
      taskRef: task.taskRef,
      gpsLat: coords?.lat,
      gpsLng: coords?.lng,
    });
  };

  if (report?.checkInAt) {
    return (
      <div className="p-3 rounded-md border border-emerald-500/30 bg-emerald-500/5">
        <div className="flex items-center gap-2 text-emerald-400 text-xs font-mono font-semibold">
          <CheckCircle2 size={13} /> Checked In
        </div>
        <p className="text-[10px] font-mono text-muted-foreground mt-1">
          {fmt(report.checkInAt)}
          {report.checkInLat && (
            <span className="ml-2 text-muted-foreground/60">
              @ {report.checkInLat.toFixed(5)}, {report.checkInLng?.toFixed(5)}
            </span>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="p-3 rounded-md border border-border bg-muted/10">
      <p className="text-xs font-mono text-muted-foreground mb-3">
        GPS check-in stamps your arrival at the target address.
      </p>
      <Button
        size="sm"
        className="w-full text-xs font-mono gap-2"
        onClick={handleCheckIn}
        disabled={checkIn.isPending || gps.loading}
      >
        {(checkIn.isPending || gps.loading)
          ? <><Loader2 size={11} className="animate-spin" /> Getting GPS…</>
          : <><Navigation size={11} /> Check In Now</>
        }
      </Button>
      {gps.coords && (
        <p className="text-[9px] font-mono text-muted-foreground mt-1.5 text-center">
          GPS: {gps.coords.lat.toFixed(5)}, {gps.coords.lng.toFixed(5)}
        </p>
      )}
    </div>
  );
}

// ─── Findings Form ────────────────────────────────────────────────────────────

function FindingsForm({ task, report, onDone }: { task: any; report: any; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    findings: report?.findings ?? '',
    subjectPresent: report?.subjectPresent ?? null as boolean | null,
    addressConfirmed: report?.addressConfirmed ?? null as boolean | null,
    outcome: report?.outcome ?? '' as string,
    recommendedNextSteps: (report?.recommendedNextSteps ?? []) as string[],
    newStep: '',
    status: 'completed' as 'completed' | 'failed',
  });
  const [photoUrls, setPhotoUrls] = useState<string[]>(report?.photoUrls ?? []);

  const gps = useGps();

  const checkOut = trpc.fieldTasks.checkOut.useMutation({
    onSuccess: () => utils.fieldTasks.get.invalidate({ taskRef: task.taskRef }),
    onError: (e) => toast.error(e.message),
  });

  const submitResult = trpc.fieldTasks.submitResult.useMutation({
    onSuccess: () => {
      toast.success('Visit report submitted successfully');
      utils.fieldTasks.get.invalidate({ taskRef: task.taskRef });
      utils.fieldTasks.list.invalidate();
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.outcome) { toast.error('Please select an outcome'); return; }
    if (!form.findings.trim()) { toast.error('Please enter findings'); return; }

    // GPS check-out if not already done
    if (report?.checkInAt && !report?.checkOutAt) {
      const coords = await gps.capture();
      await checkOut.mutateAsync({
        taskRef: task.taskRef,
        gpsLat: coords?.lat,
        gpsLng: coords?.lng,
        outcome: form.outcome as any,
        findings: form.findings,
        subjectPresent: form.subjectPresent ?? undefined,
        addressConfirmed: form.addressConfirmed ?? undefined,
        photoUrls,
        recommendedNextSteps: form.recommendedNextSteps,
      });
    }

    submitResult.mutate({
      taskRef: task.taskRef,
      findings: form.findings,
      subjectPresent: form.subjectPresent ?? undefined,
      addressConfirmed: form.addressConfirmed ?? undefined,
      outcome: form.outcome as any,
      photoUrls,
      recommendedNextSteps: form.recommendedNextSteps,
      status: form.status,
    });
  };

  const addStep = () => {
    if (!form.newStep.trim()) return;
    setForm(f => ({ ...f, recommendedNextSteps: [...f.recommendedNextSteps, f.newStep.trim()], newStep: '' }));
  };

  const isSubmitting = submitResult.isPending || checkOut.isPending;
  const isCompleted = task.status === 'completed' || task.status === 'failed';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Outcome */}
      <div>
        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Visit Outcome *</p>
        <div className="grid grid-cols-3 gap-2">
          {(['confirmed', 'unconfirmed', 'inconclusive'] as const).map(o => {
            const cfg = OUTCOME_CONFIG[o];
            return (
              <button
                key={o}
                type="button"
                disabled={isCompleted}
                onClick={() => setForm(f => ({ ...f, outcome: o }))}
                className={cn(
                  'py-2 px-3 rounded-md border text-[10px] font-mono font-semibold flex items-center justify-center gap-1.5 transition-all',
                  form.outcome === o
                    ? `border-current ${cfg.color} bg-current/10`
                    : 'border-border text-muted-foreground hover:border-border/80 disabled:opacity-50'
                )}
              >
                <span className={form.outcome === o ? cfg.color : ''}>{cfg.icon}</span>
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Boolean flags */}
      <div className="grid grid-cols-2 gap-3">
        {([
          { key: 'subjectPresent', label: 'Subject Present?' },
          { key: 'addressConfirmed', label: 'Address Confirmed?' },
        ] as const).map(({ key, label }) => (
          <div key={key}>
            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">{label}</p>
            <div className="flex gap-2">
              {([true, false] as const).map(v => (
                <button
                  key={String(v)}
                  type="button"
                  disabled={isCompleted}
                  onClick={() => setForm(f => ({ ...f, [key]: v }))}
                  className={cn(
                    'flex-1 py-1.5 rounded-md border text-[10px] font-mono font-semibold transition-all',
                    form[key] === v
                      ? v ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10' : 'border-red-500 text-red-400 bg-red-500/10'
                      : 'border-border text-muted-foreground hover:border-border/80 disabled:opacity-50'
                  )}
                >
                  {v ? 'Yes' : 'No'}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Findings text */}
      <div>
        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">
          Detailed Findings *
        </p>
        <textarea
          className="w-full h-28 px-3 py-2 rounded-md border border-border bg-background text-xs font-mono text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground disabled:opacity-60"
          placeholder="Describe what was observed at the location — physical condition of premises, persons encountered, documents sighted, discrepancies noted…"
          value={form.findings}
          disabled={isCompleted}
          onChange={e => setForm(f => ({ ...f, findings: e.target.value }))}
        />
      </div>

      {/* Photo upload */}
      <PhotoUploadStrip
        taskRef={task.taskRef}
        existingUrls={photoUrls}
        onUrlAdded={url => setPhotoUrls(prev => [...prev, url])}
      />

      {/* Recommended next steps */}
      <div>
        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">
          Recommended Next Steps
        </p>
        {form.recommendedNextSteps.length > 0 && (
          <ul className="space-y-1 mb-2">
            {form.recommendedNextSteps.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-[10px] font-mono text-foreground">
                <CheckSquare size={10} className="text-primary mt-0.5 flex-shrink-0" />
                <span className="flex-1">{step}</span>
                {!isCompleted && (
                  <button type="button" onClick={() => setForm(f => ({ ...f, recommendedNextSteps: f.recommendedNextSteps.filter((_, j) => j !== i) }))}
                    className="text-muted-foreground hover:text-red-400 transition-colors">
                    <X size={10} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!isCompleted && (
          <div className="flex gap-2">
            <input
              className="flex-1 h-7 px-2 rounded-md border border-border bg-background text-[10px] font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
              placeholder="Add a recommended next step…"
              value={form.newStep}
              onChange={e => setForm(f => ({ ...f, newStep: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addStep(); } }}
            />
            <Button type="button" size="sm" variant="outline" className="h-7 text-[10px] font-mono" onClick={addStep}>
              Add
            </Button>
          </div>
        )}
      </div>

      {/* Task status */}
      {!isCompleted && (
        <div>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Mark Task As</p>
          <div className="flex gap-2">
            {(['completed', 'failed'] as const).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setForm(f => ({ ...f, status: s }))}
                className={cn(
                  'flex-1 py-1.5 rounded-md border text-[10px] font-mono font-semibold capitalize transition-all',
                  form.status === s
                    ? s === 'completed'
                      ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                      : 'border-red-500 text-red-400 bg-red-500/10'
                    : 'border-border text-muted-foreground hover:border-border/80'
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Submit */}
      {!isCompleted && (
        <Button
          type="submit"
          className="w-full text-xs font-mono gap-2"
          disabled={isSubmitting}
        >
          {isSubmitting
            ? <><Loader2 size={11} className="animate-spin" /> Submitting…</>
            : <><Send size={11} /> Submit Visit Report</>
          }
        </Button>
      )}

      {isCompleted && (
        <div className="p-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 text-center">
          <CheckCircle2 size={16} className="text-emerald-400 mx-auto mb-1" />
          <p className="text-xs font-mono text-emerald-400 font-semibold">
            Visit report {task.status === 'failed' ? 'marked as failed' : 'submitted successfully'}
          </p>
          <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
            Completed {timeAgo(task.completedAt)}
          </p>
        </div>
      )}
    </form>
  );
}

// ─── Main Drawer ──────────────────────────────────────────────────────────────

export function FieldTaskDetailDrawer({
  taskRef,
  onClose,
}: {
  taskRef: string;
  onClose: () => void;
}) {
  const [section, setSection] = useState<'overview' | 'checkin' | 'findings' | 'report'>('overview');

  const { data, isLoading, refetch } = trpc.fieldTasks.get.useQuery(
    { taskRef },
    { refetchInterval: 30000 }
  );

  const task = data as any;
  const report = task?.visitReport;

  const statusCfg = STATUS_CONFIG[task?.status ?? 'pending'] ?? STATUS_CONFIG.pending;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-lg z-50 bg-popover border-l border-border shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={cn('text-[10px] font-mono font-semibold px-2 py-0.5 rounded border', statusCfg.bg, statusCfg.color)}>
                {statusCfg.label}
              </span>
              {task && (
                <span className="text-[10px] font-mono text-muted-foreground">{task.taskRef}</span>
              )}
            </div>
            <p className="text-sm font-mono font-semibold text-foreground truncate">
              {isLoading ? 'Loading…' : task ? task.taskType?.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : 'Task Not Found'}
            </p>
            {task && (
              <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                {task.agentName} · {task.subjectName ?? 'No subject'}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 ml-2">
            <button onClick={() => refetch()} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors" title="Refresh">
              <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tab nav */}
        <div className="flex border-b border-border flex-shrink-0">
          {([
            { id: 'overview', label: 'Overview', icon: <FileText size={11} /> },
            { id: 'checkin',  label: 'Check-In',  icon: <Navigation size={11} /> },
            { id: 'findings', label: 'Findings',  icon: <CheckSquare size={11} /> },
            { id: 'report',   label: 'Report',    icon: <ImageIcon size={11} /> },
          ] as const).map(tab => (
            <button
              key={tab.id}
              onClick={() => setSection(tab.id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-mono font-semibold transition-colors border-b-2',
                section === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 size={18} className="animate-spin mr-2" /> Loading task…
            </div>
          )}

          {!isLoading && !task && (
            <div className="text-center py-16 text-muted-foreground">
              <AlertTriangle size={24} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm font-mono">Task not found</p>
            </div>
          )}

          {!isLoading && task && (
            <>
              {/* Overview Tab */}
              {section === 'overview' && (
                <div className="space-y-4">
                  {/* Key details grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Task Type',   value: task.taskType?.replace(/_/g, ' ') },
                      { label: 'Priority',    value: task.priority?.toUpperCase() },
                      { label: 'Agent',       value: task.agentName },
                      { label: 'Subject',     value: task.subjectName ?? '—' },
                      { label: 'State',       value: task.state ?? '—' },
                      { label: 'LGA',         value: task.lga ?? '—' },
                    ].map(({ label, value }) => (
                      <div key={label} className="p-3 rounded-md border border-border bg-muted/10">
                        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
                        <p className="text-xs font-mono text-foreground font-semibold capitalize">{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Address */}
                  {task.address && (
                    <div className="p-3 rounded-md border border-border bg-muted/10">
                      <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                        <MapPin size={9} /> Target Address
                      </p>
                      <p className="text-xs font-mono text-foreground">{task.address}</p>
                      {task.gpsLat && (
                        <p className="text-[9px] font-mono text-muted-foreground mt-1">
                          GPS: {task.gpsLat.toFixed(5)}, {task.gpsLng?.toFixed(5)}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Instructions */}
                  {task.instructions && (
                    <div className="p-3 rounded-md border border-amber-500/20 bg-amber-500/5">
                      <p className="text-[9px] font-mono text-amber-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <FileText size={9} /> Instructions
                      </p>
                      <p className="text-xs font-mono text-foreground">{task.instructions}</p>
                    </div>
                  )}

                  {/* Timeline */}
                  <div>
                    <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Timeline</p>
                    <div className="space-y-2">
                      {[
                        { label: 'Dispatched',  time: task.createdAt,         icon: <Send size={10} />,          color: 'text-blue-400' },
                        { label: 'Deadline',    time: task.deadline,           icon: <Clock size={10} />,         color: 'text-amber-400' },
                        { label: 'Checked In',  time: report?.checkInAt,       icon: <Navigation size={10} />,    color: 'text-emerald-400' },
                        { label: 'Checked Out', time: report?.checkOutAt,      icon: <CheckCircle2 size={10} />,  color: 'text-emerald-400' },
                        { label: 'Completed',   time: task.completedAt,        icon: <Shield size={10} />,        color: 'text-violet-400' },
                      ].filter(e => e.time).map(({ label, time, icon, color }) => (
                        <div key={label} className="flex items-center gap-3">
                          <span className={cn('flex-shrink-0', color)}>{icon}</span>
                          <div className="flex-1 flex items-center justify-between">
                            <span className="text-[10px] font-mono text-muted-foreground">{label}</span>
                            <span className="text-[10px] font-mono text-foreground">{fmt(time)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Duration */}
                  {report?.durationMinutes != null && (
                    <div className="p-3 rounded-md border border-border bg-muted/10 flex items-center justify-between">
                      <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                        <Clock size={9} /> Time on Site
                      </p>
                      <p className="text-sm font-mono font-bold text-foreground">
                        {report.durationMinutes >= 60
                          ? `${Math.floor(report.durationMinutes / 60)}h ${report.durationMinutes % 60}m`
                          : `${report.durationMinutes}m`}
                      </p>
                    </div>
                  )}

                  {/* Outcome badge */}
                  {report?.outcome && (
                    <div className={cn(
                      'p-3 rounded-md border flex items-center gap-2',
                      report.outcome === 'confirmed'    ? 'border-emerald-500/30 bg-emerald-500/5' :
                      report.outcome === 'unconfirmed'  ? 'border-red-500/30 bg-red-500/5' :
                                                          'border-amber-500/30 bg-amber-500/5'
                    )}>
                      <span className={OUTCOME_CONFIG[report.outcome]?.color ?? ''}>
                        {OUTCOME_CONFIG[report.outcome]?.icon}
                      </span>
                      <div>
                        <p className={cn('text-xs font-mono font-semibold', OUTCOME_CONFIG[report.outcome]?.color ?? '')}>
                          {OUTCOME_CONFIG[report.outcome]?.label ?? report.outcome}
                        </p>
                        <div className="flex gap-3 mt-0.5">
                          {report.subjectPresent != null && (
                            <span className="text-[9px] font-mono text-muted-foreground">
                              Subject: {report.subjectPresent ? '✓ Present' : '✗ Absent'}
                            </span>
                          )}
                          {report.addressConfirmed != null && (
                            <span className="text-[9px] font-mono text-muted-foreground">
                              Address: {report.addressConfirmed ? '✓ Confirmed' : '✗ Unconfirmed'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Check-In Tab */}
              {section === 'checkin' && (
                <div className="space-y-4">
                  <CheckInPanel task={task} report={report} onDone={() => setSection('findings')} />

                  {/* Check-out status */}
                  {report?.checkOutAt && (
                    <div className="p-3 rounded-md border border-emerald-500/30 bg-emerald-500/5">
                      <div className="flex items-center gap-2 text-emerald-400 text-xs font-mono font-semibold">
                        <CheckCircle2 size={13} /> Checked Out
                      </div>
                      <p className="text-[10px] font-mono text-muted-foreground mt-1">
                        {fmt(report.checkOutAt)}
                        {report.checkOutLat && (
                          <span className="ml-2 text-muted-foreground/60">
                            @ {report.checkOutLat.toFixed(5)}, {report.checkOutLng?.toFixed(5)}
                          </span>
                        )}
                      </p>
                    </div>
                  )}

                  {/* GPS trail map hint */}
                  {report?.checkInLat && (
                    <div className="p-3 rounded-md border border-border bg-muted/10">
                      <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-2">GPS Trail</p>
                      <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                        <div>
                          <p className="text-muted-foreground mb-0.5">Check-In</p>
                          <p className="text-foreground">{report.checkInLat.toFixed(5)}</p>
                          <p className="text-foreground">{report.checkInLng?.toFixed(5)}</p>
                        </div>
                        {report.checkOutLat && (
                          <div>
                            <p className="text-muted-foreground mb-0.5">Check-Out</p>
                            <p className="text-foreground">{report.checkOutLat.toFixed(5)}</p>
                            <p className="text-foreground">{report.checkOutLng?.toFixed(5)}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Findings Tab */}
              {section === 'findings' && (
                <FindingsForm task={task} report={report} onDone={() => setSection('report')} />
              )}

              {/* Report Tab */}
              {section === 'report' && (
                <div className="space-y-4">
                  {!report?.submittedAt ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <FileText size={24} className="mx-auto mb-3 opacity-30" />
                      <p className="text-sm font-mono">No report submitted yet</p>
                      <p className="text-[10px] font-mono mt-1">Complete the Findings tab to generate a report</p>
                    </div>
                  ) : (
                    <>
                      {/* Summary */}
                      <div className="p-3 rounded-md border border-border bg-muted/10">
                        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Visit Summary</p>
                        <p className="text-xs font-mono text-foreground leading-relaxed whitespace-pre-wrap">{report.findings}</p>
                      </div>

                      {/* Photo gallery */}
                      {(report.photoUrls ?? []).length > 0 && (
                        <div>
                          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-2">
                            Photo Evidence ({report.photoUrls.length})
                          </p>
                          <div className="grid grid-cols-3 gap-2">
                            {report.photoUrls.map((url: string, i: number) => (
                              <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                                className="aspect-square rounded-md border border-border overflow-hidden hover:border-primary transition-colors">
                                <img src={url} alt={`Evidence ${i + 1}`} className="w-full h-full object-cover" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Recommended next steps */}
                      {(report.recommendedNextSteps ?? []).length > 0 && (
                        <div>
                          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-2">
                            Recommended Next Steps
                          </p>
                          <ul className="space-y-1.5">
                            {report.recommendedNextSteps.map((step: string, i: number) => (
                              <li key={i} className="flex items-start gap-2 text-xs font-mono text-foreground">
                                <CheckSquare size={11} className="text-primary mt-0.5 flex-shrink-0" />
                                {step}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Metadata */}
                      <div className="p-3 rounded-md border border-border bg-muted/10">
                        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Report Metadata</p>
                        <div className="space-y-1 text-[10px] font-mono">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Submitted</span>
                            <span className="text-foreground">{fmt(report.submittedAt)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Visit Ref</span>
                            <span className="text-foreground">{report.visitRef}</span>
                          </div>
                          {report.durationMinutes != null && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Duration</span>
                              <span className="text-foreground">
                                {report.durationMinutes >= 60
                                  ? `${Math.floor(report.durationMinutes / 60)}h ${report.durationMinutes % 60}m`
                                  : `${report.durationMinutes}m`}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default FieldTaskDetailDrawer;
