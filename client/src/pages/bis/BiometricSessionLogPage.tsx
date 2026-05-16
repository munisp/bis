/**
 * Biometric Session Log Dashboard
 * =================================
 * Paginated audit log of every biometric verification session.
 * Features:
 *   - Full-text search by subjectRef or KYC record ID
 *   - Filter by verification type, result, and spoof type
 *   - Per-session detail slide-over with component scores
 *   - Spoof-type breakdown bar chart (Recharts)
 *   - CSV export
 *
 * Field names match the biometric_session_logs DB schema exactly.
 */
import { useState, useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import BISLayout from '@/components/BISLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';
import {
  Shield,
  ShieldCheck,
  ShieldX,
  Download,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Eye,
  Settings2,
  FileJson,
  FileText,
  Loader2,
  Archive,
  Clock,
  CalendarClock,
  HardDrive,
} from 'lucide-react';

const SPOOF_COLORS: Record<string, string> = {
  printed_photo: '#ef4444',
  screen_replay: '#f97316',
  paper_mask: '#eab308',
  '3d_mask': '#a855f7',
  deepfake: '#6366f1',
  high_quality_photo: '#06b6d4',
  genuine: '#22c55e',
  unknown: '#6b7280',
};

const VERIFICATION_TYPES = [
  'all',
  'passive_liveness',
  'active_liveness',
  'antispoofing',
  'face_match',
  'face_detect',
  'landmarks',
  'feature_extract',
  'full_verify',
];

const PAGE_SIZE = 20;

/**
 * Matches the biometric_session_logs DB schema (BiometricSessionLog type).
 * All field names are the exact camelCase equivalents of the DB column names.
 */
type SessionLog = {
  id: number;
  sessionId: string;
  subjectRef: string | null;
  kycRecordId: number | null;
  // Passive liveness
  livenessScore: number | null;
  livenessLive: boolean | null;
  livenessReason: string | null;
  livenessLandmarksFound: boolean | null;
  livenessEar: number | null;
  livenessTextureScore: number | null;
  livenessFaceAreaRatio: number | null;
  livenessLandmarkVariance: number | null;
  // Active liveness
  activeLivenessScore: number | null;
  activeLivenessLive: boolean | null;
  activeLivenessChallenge: string | null;
  activeLivenessChallengeCompleted: boolean | null;
  activeLivenessFramesAnalysed: number | null;
  // Face detection
  faceDetected: boolean | null;
  faceCount: number | null;
  faceQualityScore: number | null;
  faceBboxX: number | null;
  faceBboxY: number | null;
  faceBboxW: number | null;
  faceBboxH: number | null;
  // Landmarks
  landmarks68: string | null;
  // Feature extraction
  embeddingDimension: number | null;
  embeddingModel: string | null;
  // Face matching
  matchScore: number | null;
  matchCosineSimilarity: number | null;
  matchDecision: boolean | null;
  matchThreshold: number | null;
  // Anti-spoofing
  antiSpoofScore: number | null;
  antiSpoofGenuine: boolean | null;
  antiSpoofType: string | null;
  antiSpoofModel: string | null;
  antiSpoofSharpness: number | null;
  antiSpoofColourDepth: number | null;
  antiSpoofHfScore: number | null;
  antiSpoofFreqAnomalyScore: number | null;
  antiSpoofReflectionScore: number | null;
  antiSpoofDepthScore: number | null;
  // Overall composite
  overallScore: number | null;
  overallVerified: boolean | null;
  failureReasons: string | null;
  // Metadata
  requestId: string | null;
  latencyMs: number | null;
  engineVersion: string | null;
  kafkaPublished: boolean | null;
  createdAt: Date;
};

/** Derive a human-readable verification type from the session fields */
function deriveVerificationType(log: SessionLog): string {
  if (log.overallVerified !== null && log.livenessLive !== null && log.antiSpoofGenuine !== null && log.matchDecision !== null) return 'full_verify';
  if (log.matchDecision !== null) return 'face_match';
  if (log.antiSpoofGenuine !== null) return 'antispoofing';
  if (log.activeLivenessLive !== null) return 'active_liveness';
  if (log.livenessLive !== null) return 'passive_liveness';
  if (log.embeddingDimension !== null) return 'feature_extract';
  if (log.landmarks68 !== null) return 'landmarks';
  if (log.faceDetected !== null) return 'face_detect';
  return 'unknown';
}

/** Derive overall pass/fail from the session fields */
function derivePassFail(log: SessionLog): boolean {
  if (log.overallVerified !== null) return log.overallVerified;
  if (log.matchDecision !== null) return log.matchDecision;
  if (log.antiSpoofGenuine !== null) return log.antiSpoofGenuine;
  if (log.activeLivenessLive !== null) return log.activeLivenessLive;
  if (log.livenessLive !== null) return log.livenessLive;
  return false;
}

export default function BiometricSessionLogPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [verType, setVerType] = useState('all');
  const [resultFilter, setResultFilter] = useState<'all' | 'passed' | 'failed'>('all');
  const [selected, setSelected] = useState<SessionLog | null>(null);
  const [statsDays, setStatsDays] = useState(30);
  const [showThresholdConfig, setShowThresholdConfig] = useState(false);
  const [localThreshold, setLocalThreshold] = useState(5);
  const [localNotifEnabled, setLocalNotifEnabled] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [isPdfExporting, setIsPdfExporting] = useState(false);
  const utils = trpc.useUtils();

  const archivalStatusQuery = trpc.biometric.archivalStatus.useQuery();

  const pdfExportMutation = trpc.biometric.exportSessionLogs.useMutation({
    onSuccess: (data: any) => {
      // Trigger browser download via a temporary anchor element
      const a = document.createElement('a');
      a.href = data.url;
      a.download = `biometric-audit-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success(`PDF report ready — ${data.rowCount} sessions exported.`);
      setIsPdfExporting(false);
    },
    onError: (err: any) => {
      toast.error(`PDF export failed: ${err.message}`);
      setIsPdfExporting(false);
    },
  });

  function handlePdfExport() {
    setIsPdfExporting(true);
    pdfExportMutation.mutate({
      days: statsDays,
      format: 'pdf',
      subjectRef: search.trim() || undefined,
    });
  }


  const thresholdQuery = trpc.biometric.getSpoofAlertThreshold.useQuery(undefined, {
    onSuccess: (data: any) => {
      setLocalThreshold(data.perTypeThreshold);
      setLocalNotifEnabled(data.notificationsEnabled);
    },
  } as any);

  const setThresholdMutation = trpc.biometric.setSpoofAlertThreshold.useMutation({
    onSuccess: () => {
      utils.biometric.getSpoofAlertThreshold.invalidate();
      setShowThresholdConfig(false);
      toast.success('Threshold saved — spoof alert threshold updated successfully.');
    },
    onError: (err: any) => {
      toast.error(`Save failed: ${err.message}`);
    },
  });

  const exportMutation = trpc.biometric.exportSessionLogs.useMutation({
    onSuccess: (data: any) => {
      window.open(data.url, '_blank');
      toast.success(`Export ready (${data.rowCount} rows) — file opened in a new tab.`);
      setIsExporting(false);
    },
    onError: (err: any) => {
      toast.error(`Export failed: ${err.message}`);
      setIsExporting(false);
    },
  });

  const statsQuery = trpc.biometric.sessionStats.useQuery(
    { days: statsDays },
    { keepPreviousData: true } as any
  );

  const query = trpc.biometric.sessionLogs.useQuery(
    {
      subjectRef: search.trim() || undefined,
      page,
      limit: PAGE_SIZE,
    },
    { keepPreviousData: true } as any
  );

  const logs: SessionLog[] = useMemo(() => {
    const raw = (query.data?.data ?? []) as SessionLog[];
    return raw.filter((l) => {
      const vt = deriveVerificationType(l);
      const passed = derivePassFail(l);
      if (verType !== 'all' && vt !== verType) return false;
      if (resultFilter === 'passed' && !passed) return false;
      if (resultFilter === 'failed' && passed) return false;
      return true;
    });
  }, [query.data, verType, resultFilter]);

  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Spoof-type breakdown chart data
  const spoofBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    ((query.data?.data ?? []) as SessionLog[]).forEach((l) => {
      const key = l.antiSpoofType ?? (l.antiSpoofGenuine === false ? 'unknown' : 'genuine');
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [query.data]);

  function exportCSV() {
    const rows = [
      ['ID', 'SubjectRef', 'KYCRecordId', 'Type', 'Passed', 'OverallScore', 'SpoofType', 'CreatedAt'],
      ...((query.data?.data ?? []) as SessionLog[]).map((l) => [
        l.id,
        l.subjectRef ?? '',
        l.kycRecordId ?? '',
        deriveVerificationType(l),
        derivePassFail(l) ? 'YES' : 'NO',
        l.overallScore?.toFixed(3) ?? '',
        l.antiSpoofType ?? 'genuine',
        new Date(l.createdAt).toISOString(),
      ]),
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `biometric-sessions-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <BISLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="text-primary" size={22} />
              Biometric Session Logs
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Audit trail of all biometric verification sessions — liveness, antispoofing, face match, and full verify.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => utils.biometric.sessionLogs.invalidate()}>
              <RefreshCw size={14} className="mr-1" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download size={14} className="mr-1" /> Export CSV (page)
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isExporting || exportMutation.isPending}
              onClick={() => {
                setIsExporting(true);
                exportMutation.mutate({ days: statsDays, format: 'csv', subjectRef: search.trim() || undefined });
              }}
            >
              <FileJson size={14} className="mr-1" />
              {exportMutation.isPending ? 'Exporting…' : 'Export Full (S3)'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isPdfExporting}
              onClick={handlePdfExport}
            >
              {isPdfExporting
                ? <Loader2 size={14} className="mr-1 animate-spin" />
                : <FileText size={14} className="mr-1" />}
              {isPdfExporting ? 'Generating PDF…' : 'Export PDF Report'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowThresholdConfig(v => !v)}
            >
              <Settings2 size={14} className="mr-1" /> Alert Threshold
            </Button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Sessions', value: total, icon: <Shield size={16} /> },
            {
              label: 'Passed',
              value: ((query.data?.data ?? []) as SessionLog[]).filter(derivePassFail).length,
              icon: <ShieldCheck size={16} className="text-green-500" />,
            },
            {
              label: 'Failed',
              value: ((query.data?.data ?? []) as SessionLog[]).filter(l => !derivePassFail(l)).length,
              icon: <ShieldX size={16} className="text-red-500" />,
            },
            {
              label: 'Spoof Attacks',
              value: ((query.data?.data ?? []) as SessionLog[]).filter(
                (l) => l.antiSpoofGenuine === false
              ).length,
              icon: <ShieldX size={16} className="text-orange-500" />,
            },
          ].map(stat => (
            <Card key={stat.label}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  {stat.icon}
                  {stat.label}
                </div>
                <div className="text-2xl font-bold">{stat.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Spoof Alert Threshold Config Card */}
        {showThresholdConfig && (
          <Card className="border-orange-200 dark:border-orange-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Settings2 size={14} className="text-orange-500" />
                Spoof Attack Alert Threshold
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Notify when any single spoof-attack type exceeds this count within a 24-hour window (ISO 30107-3 compliance).
                Current threshold: <strong>{thresholdQuery.data?.perTypeThreshold ?? localThreshold}</strong> attacks per type per day.
              </p>
              <div className="space-y-2">
                <Label className="text-xs">Per-type threshold: {localThreshold}</Label>
                <Slider
                  min={1}
                  max={50}
                  step={1}
                  value={[localThreshold]}
                  onValueChange={([v]: number[]) => setLocalThreshold(v)}
                  className="w-full max-w-sm"
                />
                <p className="text-[10px] text-muted-foreground">Alert fires when any attack type count ≥ {localThreshold} in 24 h</p>
              </div>
              <div className="flex items-center justify-between max-w-sm">
                <Label htmlFor="biometric-notif-toggle" className="text-xs text-muted-foreground">Enable owner notifications</Label>
                <Switch
                  id="biometric-notif-toggle"
                  checked={localNotifEnabled}
                  onCheckedChange={setLocalNotifEnabled}
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setShowThresholdConfig(false)}>Cancel</Button>
                <Button
                  size="sm"
                  disabled={setThresholdMutation.isPending}
                  onClick={() => setThresholdMutation.mutate({ perTypeThreshold: localThreshold, notificationsEnabled: localNotifEnabled })}
                >
                  {setThresholdMutation.isPending ? 'Saving…' : 'Save Threshold'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Archival Status Card */}
        <Card className="border-dashed border-muted-foreground/30">
          <CardHeader className="pb-2 flex flex-row items-center gap-2">
            <Archive size={15} className="text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Cold-Storage Archival Status</CardTitle>
          </CardHeader>
          <CardContent>
            {archivalStatusQuery.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 size={14} className="animate-spin" /> Loading archival status…
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <HardDrive size={11} /> Eligible Rows
                  </span>
                  <span className="text-lg font-semibold tabular-nums">
                    {archivalStatusQuery.data?.eligibleRows ?? 0}
                  </span>
                  <span className="text-[10px] text-muted-foreground">rows &gt; 90 days old</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock size={11} /> Last Archival Run
                  </span>
                  <span className="text-sm font-medium">
                    {archivalStatusQuery.data?.lastArchivalRun
                      ? new Date(archivalStatusQuery.data.lastArchivalRun).toLocaleString()
                      : <span className="text-muted-foreground italic">Never run</span>}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <CalendarClock size={11} /> Next Scheduled Run
                  </span>
                  <span className="text-sm font-medium">
                    {archivalStatusQuery.data?.nextArchivalRun
                      ? new Date(archivalStatusQuery.data.nextArchivalRun).toLocaleString()
                      : '—'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">Sunday 03:00 UTC</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Archive size={11} /> Cold Storage
                  </span>
                  <span className="text-sm font-mono">
                    {archivalStatusQuery.data?.coldStoragePrefix ?? 'biometric-archive/'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Retention: {archivalStatusQuery.data?.retentionDays ?? 90} days hot
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Time-series pass/fail chart + spoof-type breakdown — backed by sessionStats tRPC */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Daily pass/fail trend */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium">Daily Pass / Fail Trend</CardTitle>
              <select
                value={statsDays}
                onChange={e => setStatsDays(Number(e.target.value))}
                className="text-xs border rounded px-2 py-1 bg-background"
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
                <option value={365}>Last 365 days</option>
              </select>
            </CardHeader>
            <CardContent>
              {statsQuery.isLoading ? (
                <div className="h-[160px] flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
              ) : (statsQuery.data?.dailyStats?.length ?? 0) === 0 ? (
                <div className="h-[160px] flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={statsQuery.data?.dailyStats ?? []} margin={{ top: 4, right: 10, left: -20, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ fontSize: 11, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                    />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="passed" stroke="#22c55e" strokeWidth={2} dot={false} name="Passed" />
                    <Line type="monotone" dataKey="failed" stroke="#ef4444" strokeWidth={2} dot={false} name="Failed" />
                  </LineChart>
                </ResponsiveContainer>
              )}
              {statsQuery.data && (
                <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
                  <span>Total: <strong>{statsQuery.data.totalSessions}</strong></span>
                  <span>Pass rate: <strong className="text-green-600">{(statsQuery.data.overallPassRate * 100).toFixed(1)}%</strong></span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Spoof-type breakdown heatmap */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Attack-Type Breakdown (last {statsDays} days)</CardTitle>
            </CardHeader>
            <CardContent>
              {statsQuery.isLoading ? (
                <div className="h-[160px] flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
              ) : (statsQuery.data?.spoofTypeBreakdown?.length ?? 0) === 0 ? (
                <div className="h-[160px] flex items-center justify-center text-muted-foreground text-sm">No spoof attacks recorded</div>
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart
                    data={statsQuery.data?.spoofTypeBreakdown ?? []}
                    layout="vertical"
                    margin={{ top: 0, right: 10, left: 80, bottom: 0 }}
                  >
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="spoofType" tick={{ fontSize: 10 }} tickFormatter={v => v.replace(/_/g, ' ')} />
                    <Tooltip
                      contentStyle={{ fontSize: 11, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} name="Attacks">
                      {(statsQuery.data?.spoofTypeBreakdown ?? []).map(entry => (
                        <Cell
                          key={entry.spoofType}
                          fill={SPOOF_COLORS[entry.spoofType] ?? '#6b7280'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by subject ref…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="pl-8"
            />
          </div>
          <Select value={verType} onValueChange={v => { setVerType(v); setPage(1); }}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              {VERIFICATION_TYPES.map(t => (
                <SelectItem key={t} value={t}>{t === 'all' ? 'All types' : t.replace(/_/g, ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={resultFilter} onValueChange={v => { setResultFilter(v as typeof resultFilter); setPage(1); }}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Result" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All results</SelectItem>
              <SelectItem value="passed">Passed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject Ref</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Spoof Type</TableHead>
                  <TableHead>Kafka</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.isLoading && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                )}
                {!query.isLoading && logs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                      No sessions found.
                    </TableCell>
                  </TableRow>
                )}
                {logs.map((log) => {
                  const vt = deriveVerificationType(log);
                  const passed = derivePassFail(log);
                  return (
                    <TableRow key={log.id} className="cursor-pointer hover:bg-muted/40">
                      <TableCell className="font-mono text-xs">{log.subjectRef ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {vt.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {passed ? (
                          <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Passed</Badge>
                        ) : (
                          <Badge className="bg-red-500/10 text-red-600 border-red-500/20">Failed</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.overallScore != null ? (log.overallScore * 100).toFixed(1) + '%' : '—'}
                      </TableCell>
                      <TableCell>
                        {log.antiSpoofType && log.antiSpoofType !== 'genuine' && log.antiSpoofType !== 'unknown' ? (
                          <Badge
                            style={{ backgroundColor: (SPOOF_COLORS[log.antiSpoofType] ?? '#6b7280') + '20', color: SPOOF_COLORS[log.antiSpoofType] ?? '#6b7280', borderColor: (SPOOF_COLORS[log.antiSpoofType] ?? '#6b7280') + '40' }}
                            className="text-xs border"
                          >
                            {log.antiSpoofType.replace(/_/g, ' ')}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            {log.antiSpoofGenuine === false ? 'unknown spoof' : 'genuine'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {log.kafkaPublished ? (
                          <Badge variant="outline" className="text-xs text-green-600">published</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(log.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => setSelected(log)}>
                          <Eye size={14} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Pagination */}
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {page} of {totalPages} ({total} total)</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft size={14} />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      </div>

      {/* Detail slide-over */}
      <Sheet open={!!selected} onOpenChange={open => !open && setSelected(null)}>
        <SheetContent className="w-[420px] sm:w-[480px] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader className="mb-4">
                <SheetTitle className="flex items-center gap-2">
                  {derivePassFail(selected) ? (
                    <ShieldCheck className="text-green-500" size={18} />
                  ) : (
                    <ShieldX className="text-red-500" size={18} />
                  )}
                  Session #{selected.id}
                </SheetTitle>
              </SheetHeader>
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Subject Ref', value: selected.subjectRef ?? '—' },
                    { label: 'KYC Record ID', value: selected.kycRecordId ?? '—' },
                    { label: 'Session ID', value: selected.sessionId },
                    { label: 'Type', value: deriveVerificationType(selected).replace(/_/g, ' ') },
                    { label: 'Result', value: derivePassFail(selected) ? 'PASSED' : 'FAILED' },
                    { label: 'Overall Score', value: selected.overallScore != null ? (selected.overallScore * 100).toFixed(2) + '%' : '—' },
                    { label: 'Liveness Score', value: selected.livenessScore != null ? (selected.livenessScore * 100).toFixed(2) + '%' : '—' },
                    { label: 'Active Liveness', value: selected.activeLivenessScore != null ? (selected.activeLivenessScore * 100).toFixed(2) + '%' : '—' },
                    { label: 'Antispoofing Score', value: selected.antiSpoofScore != null ? (selected.antiSpoofScore * 100).toFixed(2) + '%' : '—' },
                    { label: 'Match Score', value: selected.matchScore != null ? (selected.matchScore * 100).toFixed(2) + '%' : '—' },
                    { label: 'Spoof Type', value: selected.antiSpoofType ?? 'genuine' },
                    { label: 'Landmarks (68pt)', value: selected.landmarks68 ? 'Extracted' : 'None' },
                    { label: 'Embedding Dim', value: selected.embeddingDimension ?? '—' },
                    { label: 'Embedding Model', value: selected.embeddingModel ?? '—' },
                    { label: 'Face Count', value: selected.faceCount ?? '—' },
                    { label: 'Face Quality', value: selected.faceQualityScore != null ? (selected.faceQualityScore * 100).toFixed(1) + '%' : '—' },
                    { label: 'Latency', value: selected.latencyMs != null ? selected.latencyMs.toFixed(0) + ' ms' : '—' },
                    { label: 'Engine Version', value: selected.engineVersion ?? '—' },
                    { label: 'Kafka Published', value: selected.kafkaPublished ? 'Yes' : 'No' },
                    { label: 'Created At', value: new Date(selected.createdAt).toLocaleString() },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-muted/40 rounded p-2">
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="font-medium mt-0.5 break-all">{String(value)}</div>
                    </div>
                  ))}
                </div>
                {selected.failureReasons && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded p-3">
                    <div className="text-xs font-medium text-red-600 mb-1">Failure Reasons</div>
                    <div className="text-sm">{selected.failureReasons}</div>
                  </div>
                )}
                {/* Active liveness challenge detail */}
                {selected.activeLivenessChallenge && (
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded p-3">
                    <div className="text-xs font-medium text-blue-600 mb-1">Active Liveness Challenge</div>
                    <div className="text-sm">
                      <span className="font-mono">{selected.activeLivenessChallenge}</span>
                      {selected.activeLivenessChallengeCompleted !== null && (
                        <Badge className={`ml-2 text-xs ${selected.activeLivenessChallengeCompleted ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}>
                          {selected.activeLivenessChallengeCompleted ? 'Completed' : 'Not completed'}
                        </Badge>
                      )}
                      {selected.activeLivenessFramesAnalysed != null && (
                        <span className="ml-2 text-muted-foreground text-xs">{selected.activeLivenessFramesAnalysed} frames</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </BISLayout>
  );
}
