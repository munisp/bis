import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { MapView } from "@/components/Map";
import { trpc } from "@/lib/trpc";
import BISLayout from "@/components/BISLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MapPin, Users, CheckCircle2, Clock, Layers, X, RefreshCw,
  Navigation, AlertTriangle, HelpCircle, XCircle, Route, Download, FileJson,
  Play, Pause, SkipBack, BarChart2, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { MarkerClusterer } from "@googlemaps/markerclusterer";

// ─── Types ────────────────────────────────────────────────────────────────────

type OutcomeFilter = "all" | "confirmed" | "unconfirmed" | "inconclusive" | "failed";
type DateRange = "7d" | "30d" | "90d" | "all";

type VisitPoint = {
  visitRef: string;
  taskRef: string;
  agentId: string;
  agentName: string;
  investigationId: number | null;
  checkInLat: number | null;
  checkInLng: number | null;
  checkOutLat: number | null;
  checkOutLng: number | null;
  outcome: string | null;
  subjectPresent: boolean | null;
  addressConfirmed: boolean | null;
  findings: string | null;
  durationMinutes: number | null;
  submittedAt: Date | null;
  createdAt: Date;
};

// ─── Outcome config ───────────────────────────────────────────────────────────

const OUTCOME_CONFIG: Record<string, { label: string; color: string; hex: string; icon: React.ElementType }> = {
  confirmed:    { label: "Confirmed",    color: "bg-emerald-500", hex: "#10b981", icon: CheckCircle2 },
  unconfirmed:  { label: "Unconfirmed",  color: "bg-amber-500",   hex: "#f59e0b", icon: AlertTriangle },
  inconclusive: { label: "Inconclusive", color: "bg-slate-400",   hex: "#94a3b8", icon: HelpCircle },
  failed:       { label: "Failed",       color: "bg-red-500",     hex: "#ef4444", icon: XCircle },
};

function getOutcomeHex(outcome: string | null): string {
  return OUTCOME_CONFIG[outcome ?? ""]?.hex ?? "#6366f1";
}

// ─── Agent summary helpers (exported for testing) ─────────────────────────────

export type AgentSummary = {
  agentId: string;
  agentName: string;
  total: number;
  confirmed: number;
  confirmedPct: number;
  avgDuration: number;
  weeklyFrequency: number[]; // visits per week for last 8 weeks
};

export function buildAgentSummaries(points: VisitPoint[]): AgentSummary[] {
  const now = Date.now();
  const agentMap = new Map<string, VisitPoint[]>();
  for (const p of points) {
    const arr = agentMap.get(p.agentId) ?? [];
    arr.push(p);
    agentMap.set(p.agentId, arr);
  }

  return Array.from(agentMap.entries())
    .map(([agentId, visits]) => {
      const total = visits.length;
      const confirmed = visits.filter(v => v.outcome === "confirmed").length;
      const confirmedPct = total > 0 ? Math.round((confirmed / total) * 100) : 0;
      const durRows = visits.filter(v => v.durationMinutes != null);
      const avgDuration = durRows.length > 0
        ? Math.round(durRows.reduce((s, v) => s + (v.durationMinutes ?? 0), 0) / durRows.length)
        : 0;

      // 8-week sparkline
      const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
      const weeklyFrequency = Array.from({ length: 8 }, (_, i) => {
        const weekStart = now - (8 - i) * WEEK_MS;
        const weekEnd = weekStart + WEEK_MS;
        return visits.filter(v => {
          const t = new Date(v.createdAt).getTime();
          return t >= weekStart && t < weekEnd;
        }).length;
      });

      return { agentId, agentName: visits[0].agentName, total, confirmed, confirmedPct, avgDuration, weeklyFrequency };
    })
    .sort((a, b) => b.total - a.total);
}

// ─── Time-lapse helpers (exported for testing) ────────────────────────────────

export function sortByCreatedAt(points: VisitPoint[]): VisitPoint[] {
  return [...points].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export function sliceUpTo(sorted: VisitPoint[], index: number): VisitPoint[] {
  return sorted.slice(0, index + 1);
}

// ─── Export helpers (exported for testing) ────────────────────────────────────

export function toGeoJSON(points: VisitPoint[]): string {
  const features = points
    .filter(p => p.checkInLat != null && p.checkInLng != null)
    .map(p => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.checkInLng!, p.checkInLat!] },
      properties: {
        visitRef: p.visitRef,
        taskRef: p.taskRef,
        agentId: p.agentId,
        agentName: p.agentName,
        outcome: p.outcome,
        subjectPresent: p.subjectPresent,
        addressConfirmed: p.addressConfirmed,
        durationMinutes: p.durationMinutes,
        findings: p.findings,
        submittedAt: p.submittedAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      },
    }));
  return JSON.stringify({ type: "FeatureCollection", features }, null, 2);
}

export function toCSV(points: VisitPoint[]): string {
  const header = [
    "visitRef","taskRef","agentId","agentName",
    "checkInLat","checkInLng","checkOutLat","checkOutLng",
    "outcome","subjectPresent","addressConfirmed",
    "durationMinutes","findings","submittedAt","createdAt",
  ].join(",");
  const rows = points.map(p => [
    p.visitRef,
    p.taskRef,
    p.agentId,
    `"${p.agentName.replace(/"/g, '""')}"`,
    p.checkInLat ?? "",
    p.checkInLng ?? "",
    p.checkOutLat ?? "",
    p.checkOutLng ?? "",
    p.outcome ?? "",
    p.subjectPresent == null ? "" : p.subjectPresent ? "true" : "false",
    p.addressConfirmed == null ? "" : p.addressConfirmed ? "true" : "false",
    p.durationMinutes ?? "",
    `"${(p.findings ?? "").replace(/"/g, '""')}"`,
    p.submittedAt?.toISOString() ?? "",
    p.createdAt.toISOString(),
  ].join(","));
  return [header, ...rows].join("\n");
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Inline Sparkline ─────────────────────────────────────────────────────────

function Sparkline({ data, color = "#10b981" }: { data: number[]; color?: string }) {
  if (data.length === 0) return null;
  const max = Math.max(...data, 1);
  const w = 64;
  const h = 24;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${i * step},${h - (v / max) * (h - 2) - 1}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ stats }: { stats: { total: number; confirmed: number; confirmedPct: number; avgDuration: number; activeAgents: number } }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Card className="bg-card/80 backdrop-blur-sm">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10"><MapPin className="w-4 h-4 text-primary" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Total Visits</p>
            <p className="text-xl font-bold">{stats.total}</p>
          </div>
        </CardContent>
      </Card>
      <Card className="bg-card/80 backdrop-blur-sm">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10"><CheckCircle2 className="w-4 h-4 text-emerald-500" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Confirmed</p>
            <p className="text-xl font-bold">{stats.confirmed} <span className="text-sm font-normal text-muted-foreground">({stats.confirmedPct}%)</span></p>
          </div>
        </CardContent>
      </Card>
      <Card className="bg-card/80 backdrop-blur-sm">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/10"><Clock className="w-4 h-4 text-blue-500" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Avg Duration</p>
            <p className="text-xl font-bold">{stats.avgDuration} <span className="text-sm font-normal text-muted-foreground">min</span></p>
          </div>
        </CardContent>
      </Card>
      <Card className="bg-card/80 backdrop-blur-sm">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-violet-500/10"><Users className="w-4 h-4 text-violet-500" /></div>
          <div>
            <p className="text-xs text-muted-foreground">Active Agents</p>
            <p className="text-xl font-bold">{stats.activeAgents}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Visit Detail Panel ───────────────────────────────────────────────────────

function VisitDetailPanel({
  visit, onClose, onShowRoute, routeVisible, geocodedAddress, geocoding,
}: {
  visit: VisitPoint;
  onClose: () => void;
  onShowRoute: () => void;
  routeVisible: boolean;
  geocodedAddress: string | null;
  geocoding: boolean;
}) {
  const cfg = OUTCOME_CONFIG[visit.outcome ?? ""] ?? { label: visit.outcome ?? "Unknown", color: "bg-slate-400", hex: "#94a3b8", icon: HelpCircle };
  const Icon = cfg.icon;
  const hasRoute = visit.checkInLat != null && visit.checkOutLat != null &&
    visit.checkInLng != null && visit.checkOutLng != null;

  return (
    <Card className="absolute top-4 right-4 w-80 z-10 shadow-xl border-border/60 bg-card/95 backdrop-blur-sm">
      <CardHeader className="pb-2 flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-sm font-semibold">{visit.visitRef}</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Task: {visit.taskRef}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6 -mt-1 -mr-1" onClick={onClose}>
          <X className="w-3 h-3" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" style={{ color: cfg.hex }} />
          <Badge className={cn("text-white text-xs", cfg.color)}>{cfg.label}</Badge>
          {visit.durationMinutes != null && (
            <span className="text-xs text-muted-foreground ml-auto">{visit.durationMinutes} min</span>
          )}
        </div>
        <Separator />
        <div className="flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">Agent:</span>
          <span className="font-medium truncate">{visit.agentName}</span>
        </div>
        {visit.checkInLat != null && visit.checkInLng != null && (
          <div className="flex items-start gap-2">
            <Navigation className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="min-w-0">
              <span className="text-muted-foreground">Check-in GPS:</span>
              <p className="font-mono text-xs mt-0.5">{visit.checkInLat.toFixed(6)}, {visit.checkInLng.toFixed(6)}</p>
              {/* Reverse-geocoded address */}
              {geocoding ? (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />Resolving address…
                </p>
              ) : geocodedAddress ? (
                <p className="text-xs text-muted-foreground mt-1 leading-snug">{geocodedAddress}</p>
              ) : null}
            </div>
          </div>
        )}
        {visit.checkOutLat != null && visit.checkOutLng != null && (
          <div className="flex items-start gap-2">
            <Navigation className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              <span className="text-muted-foreground">Check-out GPS:</span>
              <p className="font-mono text-xs mt-0.5">{visit.checkOutLat.toFixed(6)}, {visit.checkOutLng.toFixed(6)}</p>
            </div>
          </div>
        )}
        {hasRoute && (
          <Button
            variant={routeVisible ? "default" : "outline"}
            size="sm"
            className="w-full h-8 text-xs gap-1.5"
            onClick={onShowRoute}
          >
            <Route className="w-3.5 h-3.5" />
            {routeVisible ? "Hide Route" : "Show Route"}
          </Button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md bg-muted/50 p-2 text-center">
            <p className="text-xs text-muted-foreground">Subject Present</p>
            <p className={cn("text-sm font-semibold mt-0.5", visit.subjectPresent ? "text-emerald-500" : "text-red-500")}>
              {visit.subjectPresent == null ? "—" : visit.subjectPresent ? "Yes" : "No"}
            </p>
          </div>
          <div className="rounded-md bg-muted/50 p-2 text-center">
            <p className="text-xs text-muted-foreground">Address Confirmed</p>
            <p className={cn("text-sm font-semibold mt-0.5", visit.addressConfirmed ? "text-emerald-500" : "text-red-500")}>
              {visit.addressConfirmed == null ? "—" : visit.addressConfirmed ? "Yes" : "No"}
            </p>
          </div>
        </div>
        {visit.findings && (
          <>
            <Separator />
            <div>
              <p className="text-xs text-muted-foreground mb-1">Findings</p>
              <p className="text-xs leading-relaxed line-clamp-4">{visit.findings}</p>
            </div>
          </>
        )}
        <Separator />
        <p className="text-xs text-muted-foreground">
          Submitted: {visit.submittedAt ? new Date(visit.submittedAt).toLocaleString() : new Date(visit.createdAt).toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Agent Summary Panel ──────────────────────────────────────────────────────

function AgentSummaryPanel({ summaries }: { summaries: AgentSummary[] }) {
  if (summaries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-center text-muted-foreground">
        <Users className="w-8 h-8 mb-2 opacity-30" />
        <p className="text-sm">No agent data available</p>
      </div>
    );
  }
  return (
    <ScrollArea className="h-full max-h-[420px]">
      <div className="space-y-2 pr-2">
        {summaries.map(a => (
          <div key={a.agentId} className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-primary">{a.agentName.charAt(0).toUpperCase()}</span>
                </div>
                <span className="text-sm font-medium truncate">{a.agentName}</span>
              </div>
              <Badge variant="outline" className="text-xs shrink-0">{a.total} visit{a.total !== 1 ? "s" : ""}</Badge>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[10px] text-muted-foreground">Confirmed</p>
                <p className="text-sm font-semibold text-emerald-500">{a.confirmedPct}%</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Avg Duration</p>
                <p className="text-sm font-semibold">{a.avgDuration}m</p>
              </div>
              <div className="flex flex-col items-center">
                <p className="text-[10px] text-muted-foreground mb-1">Frequency</p>
                <Sparkline data={a.weeklyFrequency} color={a.confirmedPct >= 70 ? "#10b981" : a.confirmedPct >= 40 ? "#f59e0b" : "#ef4444"} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

// ─── Time-lapse Controls ──────────────────────────────────────────────────────

function TimeLapseControls({
  total,
  currentIndex,
  isPlaying,
  speed,
  onPlay,
  onPause,
  onReset,
  onSeek,
  onSpeedChange,
  currentDate,
}: {
  total: number;
  currentIndex: number;
  isPlaying: boolean;
  speed: number;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  onSeek: (i: number) => void;
  onSpeedChange: (s: number) => void;
  currentDate: string;
}) {
  if (total === 0) return null;
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-card/95 backdrop-blur-sm rounded-xl shadow-lg border border-border/50 px-4 py-3 w-[min(520px,90vw)]">
      <div className="flex items-center gap-2 mb-2">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onReset} title="Reset">
          <SkipBack className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={isPlaying ? onPause : onPlay} title={isPlaying ? "Pause" : "Play"}>
          {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </Button>
        <div className="flex-1 flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={Math.max(total - 1, 0)}
            value={currentIndex}
            onChange={e => onSeek(Number(e.target.value))}
            className="flex-1 h-1.5 accent-primary cursor-pointer"
          />
        </div>
        <Select value={String(speed)} onValueChange={v => onSpeedChange(Number(v))}>
          <SelectTrigger className="w-16 h-7 text-xs px-2"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0.5">0.5×</SelectItem>
            <SelectItem value="1">1×</SelectItem>
            <SelectItem value="2">2×</SelectItem>
            <SelectItem value="4">4×</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{currentIndex + 1} / {total} visits</span>
        <span className="font-mono">{currentDate}</span>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FieldVisitMapPage() {
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const heatmapRef = useRef<google.maps.visualization.HeatmapLayer | null>(null);
  const routePolylineRef = useRef<google.maps.Polyline | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState<VisitPoint | null>(null);
  const [routeVisible, setRouteVisible] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [activeTab, setActiveTab] = useState<"map" | "agents">("map");

  // Reverse-geocode state
  const [geocodedAddress, setGeocodedAddress] = useState<string | null>(null);
  const [geocoding, setGeocoding] = useState(false);

  // Time-lapse state
  const [timelapse, setTimelapse] = useState(false);
  const [tlIndex, setTlIndex] = useState(0);
  const [tlPlaying, setTlPlaying] = useState(false);
  const [tlSpeed, setTlSpeed] = useState(1);

  const { data, isLoading, refetch } = trpc.fieldTasks.getVisitGeoData.useQuery(
    { outcome: outcomeFilter, dateRange, limit: 200 },
    { refetchOnWindowFocus: false }
  );

  const allPoints: VisitPoint[] = data?.points ?? [];
  const stats = data?.stats ?? { total: 0, confirmed: 0, confirmedPct: 0, avgDuration: 0, activeAgents: 0 };

  // Sorted points for time-lapse
  const sortedPoints = useMemo(() => sortByCreatedAt(allPoints), [allPoints]);

  // Visible points: either time-lapse slice or all
  const points = useMemo(() => {
    if (!timelapse || sortedPoints.length === 0) return allPoints;
    return sliceUpTo(sortedPoints, tlIndex);
  }, [timelapse, sortedPoints, tlIndex, allPoints]);

  // Agent summaries
  const agentSummaries = useMemo(() => buildAgentSummaries(allPoints), [allPoints]);

  // ── Reverse geocode when selected visit changes ──────────────────────────
  useEffect(() => {
    setGeocodedAddress(null);
    if (!selectedVisit || selectedVisit.checkInLat == null || selectedVisit.checkInLng == null) return;
    if (!mapReady || !window.google?.maps?.Geocoder) return;

    setGeocoding(true);
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode(
      { location: { lat: selectedVisit.checkInLat, lng: selectedVisit.checkInLng } },
      (results, status) => {
        setGeocoding(false);
        if (status === "OK" && results && results[0]) {
          setGeocodedAddress(results[0].formatted_address);
        }
      }
    );
  }, [selectedVisit?.visitRef, mapReady]);

  // ── Time-lapse playback timer ────────────────────────────────────────────
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!tlPlaying || !timelapse) return;
    const intervalMs = Math.round(800 / tlSpeed);
    timerRef.current = setInterval(() => {
      setTlIndex(i => {
        if (i >= sortedPoints.length - 1) {
          setTlPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, intervalMs);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [tlPlaying, timelapse, tlSpeed, sortedPoints.length]);

  // Reset time-lapse when data changes
  useEffect(() => {
    setTlIndex(0);
    setTlPlaying(false);
  }, [sortedPoints.length]);

  const buildPin = useCallback((hex: string) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
      <path d="M14 0C6.268 0 0 6.268 0 14c0 8.75 14 22 14 22S28 22.75 28 14C28 6.268 21.732 0 14 0z"
            fill="${hex}" stroke="white" stroke-width="1.5"/>
      <circle cx="14" cy="14" r="5" fill="white" opacity="0.9"/>
    </svg>`;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = document.createElement("img");
    img.src = url;
    img.width = 28;
    img.height = 36;
    return img;
  }, []);

  const clearRoute = useCallback(() => {
    if (routePolylineRef.current) {
      routePolylineRef.current.setMap(null);
      routePolylineRef.current = null;
    }
    setRouteVisible(false);
  }, []);

  const handleShowRoute = useCallback(() => {
    if (!mapRef.current || !selectedVisit) return;
    if (routeVisible) { clearRoute(); return; }
    const { checkInLat, checkInLng, checkOutLat, checkOutLng } = selectedVisit;
    if (checkInLat == null || checkInLng == null || checkOutLat == null || checkOutLng == null) return;

    const polyline = new window.google.maps.Polyline({
      path: [
        { lat: checkInLat, lng: checkInLng },
        { lat: checkOutLat, lng: checkOutLng },
      ],
      geodesic: true,
      strokeColor: getOutcomeHex(selectedVisit.outcome),
      strokeOpacity: 0.9,
      strokeWeight: 3,
      icons: [{
        icon: { path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, strokeColor: "#ffffff" },
        offset: "50%",
      }],
      map: mapRef.current,
    });
    routePolylineRef.current = polyline;
    setRouteVisible(true);

    const bounds = new window.google.maps.LatLngBounds();
    bounds.extend({ lat: checkInLat, lng: checkInLng });
    bounds.extend({ lat: checkOutLat, lng: checkOutLng });
    mapRef.current.fitBounds(bounds, 120);
  }, [selectedVisit, routeVisible, clearRoute]);

  const placeMarkers = useCallback(() => {
    if (!mapRef.current || !window.google) return;

    if (clustererRef.current) { clustererRef.current.clearMarkers(); clustererRef.current = null; }
    markersRef.current.forEach(m => { m.map = null; });
    markersRef.current = [];
    if (heatmapRef.current) { heatmapRef.current.setMap(null); heatmapRef.current = null; }

    const validPoints = points.filter(p => p.checkInLat != null && p.checkInLng != null);

    if (showHeatmap) {
      const heatData = validPoints.map(p => ({
        location: new window.google.maps.LatLng(p.checkInLat!, p.checkInLng!),
        weight: p.outcome === "confirmed" ? 3 : p.outcome === "failed" ? 1 : 2,
      }));
      try {
        heatmapRef.current = new (window.google.maps as any).visualization.HeatmapLayer({
          data: heatData, map: mapRef.current, radius: 40, opacity: 0.7,
        });
      } catch { /* visualization library not loaded */ }
    }

    const newMarkers: google.maps.marker.AdvancedMarkerElement[] = validPoints.map(point => {
      const marker = new window.google.maps.marker.AdvancedMarkerElement({
        position: { lat: point.checkInLat!, lng: point.checkInLng! },
        title: `${point.visitRef} — ${point.outcome ?? "unknown"}`,
        content: buildPin(getOutcomeHex(point.outcome)),
      });
      marker.addListener("click", () => { clearRoute(); setSelectedVisit(point); });
      return marker;
    });

    markersRef.current = newMarkers;
    clustererRef.current = new MarkerClusterer({ map: mapRef.current, markers: newMarkers });

    // Only auto-fit when not in time-lapse (avoid jarring pans during playback)
    if (validPoints.length > 0 && !timelapse) {
      const bounds = new window.google.maps.LatLngBounds();
      validPoints.forEach(p => bounds.extend({ lat: p.checkInLat!, lng: p.checkInLng! }));
      mapRef.current.fitBounds(bounds, { top: 60, right: 340, bottom: 60, left: 60 });
    }
  }, [points, showHeatmap, buildPin, clearRoute, timelapse]);

  useEffect(() => { if (mapReady) placeMarkers(); }, [mapReady, placeMarkers]);
  useEffect(() => { clearRoute(); setGeocodedAddress(null); }, [selectedVisit?.visitRef, clearRoute]);

  const handleMapReady = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    setMapReady(true);
  }, []);

  const handleRefresh = () => { refetch(); toast.success("Map data refreshed"); };

  const handleExportGeoJSON = () => {
    if (allPoints.length === 0) { toast.error("No visit points to export"); return; }
    const content = toGeoJSON(allPoints);
    const ts = new Date().toISOString().slice(0, 10);
    downloadBlob(content, `field-visits-${ts}.geojson`, "application/geo+json");
    toast.success(`Exported ${allPoints.filter(p => p.checkInLat != null).length} points as GeoJSON`);
  };

  const handleExportCSV = () => {
    if (allPoints.length === 0) { toast.error("No visit points to export"); return; }
    const content = toCSV(allPoints);
    const ts = new Date().toISOString().slice(0, 10);
    downloadBlob(content, `field-visits-${ts}.csv`, "text/csv");
    toast.success(`Exported ${allPoints.length} rows as CSV`);
  };

  const handleToggleTimelapse = () => {
    if (timelapse) {
      setTimelapse(false);
      setTlPlaying(false);
      setTlIndex(0);
    } else {
      setTimelapse(true);
      setTlIndex(0);
    }
  };

  const tlCurrentDate = sortedPoints[tlIndex]
    ? new Date(sortedPoints[tlIndex].createdAt).toLocaleDateString()
    : "—";

  return (
    <BISLayout>
      <div className="flex flex-col gap-4 p-4 md:p-6 h-full">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Field Visit Map</h1>
            <p className="text-sm text-muted-foreground mt-0.5">GPS-tagged visit locations and outcomes across Nigeria</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
              <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
            <Button variant={showHeatmap ? "default" : "outline"} size="sm" className="h-8 text-xs gap-1.5" onClick={() => setShowHeatmap(h => !h)}>
              <Layers className="w-3.5 h-3.5" />Heatmap
            </Button>
            <Button variant={timelapse ? "default" : "outline"} size="sm" className="h-8 text-xs gap-1.5" onClick={handleToggleTimelapse} disabled={allPoints.length === 0}>
              <Play className="w-3.5 h-3.5" />Time-lapse
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleExportGeoJSON} disabled={allPoints.length === 0}>
              <FileJson className="w-3.5 h-3.5" />GeoJSON
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleExportCSV} disabled={allPoints.length === 0}>
              <Download className="w-3.5 h-3.5" />CSV
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleRefresh} disabled={isLoading}>
              <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />Refresh
            </Button>
          </div>
        </div>

        <StatsBar stats={stats} />

        {/* Outcome filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Filter:</span>
          {(["all", "confirmed", "unconfirmed", "inconclusive", "failed"] as OutcomeFilter[]).map(o => {
            const cfg = o === "all" ? null : OUTCOME_CONFIG[o];
            const isActive = outcomeFilter === o;
            return (
              <button
                key={o}
                onClick={() => setOutcomeFilter(o)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all",
                  isActive ? "border-transparent text-white shadow-sm" : "border-border bg-background text-muted-foreground hover:bg-muted"
                )}
                style={isActive && cfg ? { backgroundColor: cfg.hex } : undefined}
              >
                {cfg && <cfg.icon className="w-3 h-3" />}
                {o === "all" ? "All outcomes" : cfg?.label}
                {isActive && o !== "all" && (
                  <span className="ml-0.5 bg-white/20 rounded-full px-1 text-[10px]">
                    {allPoints.filter(p => p.outcome === o).length}
                  </span>
                )}
              </button>
            );
          })}
          {outcomeFilter !== "all" && (
            <span className="text-xs text-muted-foreground ml-1">{allPoints.length} point{allPoints.length !== 1 ? "s" : ""} shown</span>
          )}
        </div>

        {/* Main content: map + agent panel side-by-side on large screens */}
        <Tabs value={activeTab} onValueChange={v => setActiveTab(v as "map" | "agents")} className="flex-1 flex flex-col min-h-0">
          <TabsList className="w-fit h-8">
            <TabsTrigger value="map" className="text-xs gap-1.5 h-7 px-3">
              <MapPin className="w-3 h-3" />Map
            </TabsTrigger>
            <TabsTrigger value="agents" className="text-xs gap-1.5 h-7 px-3">
              <BarChart2 className="w-3 h-3" />Agents ({agentSummaries.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="map" className="flex-1 mt-2 min-h-0">
            {/* Map container */}
            <div className="relative h-full min-h-[480px] rounded-xl overflow-hidden border border-border/50 shadow-sm">
              <MapView
                className="w-full h-full min-h-[480px]"
                initialCenter={{ lat: 9.082, lng: 8.6753 }}
                initialZoom={6}
                onMapReady={handleMapReady}
              />

              {isLoading && (
                <div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center z-20">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <RefreshCw className="w-4 h-4 animate-spin" />Loading visit data…
                  </div>
                </div>
              )}

              {!isLoading && allPoints.length === 0 && mapReady && (
                <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                  <div className="bg-card/90 backdrop-blur-sm rounded-xl p-6 text-center shadow-lg max-w-xs">
                    <MapPin className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
                    <p className="font-medium text-sm">No GPS-tagged visits</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Visits with GPS check-in data will appear here.
                      {outcomeFilter !== "all" && " Try changing the outcome filter."}
                    </p>
                  </div>
                </div>
              )}

              {/* Legend */}
              <div className="absolute bottom-4 left-4 bg-card/90 backdrop-blur-sm rounded-lg p-3 shadow-md border border-border/50 z-10">
                <p className="text-xs font-semibold text-muted-foreground mb-2">Legend</p>
                <div className="space-y-1.5">
                  {Object.entries(OUTCOME_CONFIG).map(([key, cfg]) => (
                    <div key={key} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cfg.hex }} />
                      <span className="text-xs">{cfg.label}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/40">
                    <div className="w-4 h-4 rounded-full shrink-0 bg-slate-600 border-2 border-white flex items-center justify-center">
                      <span className="text-[7px] text-white font-bold leading-none">N</span>
                    </div>
                    <span className="text-xs text-muted-foreground">Cluster</span>
                  </div>
                </div>
              </div>

              {/* Time-lapse controls */}
              {timelapse && (
                <TimeLapseControls
                  total={sortedPoints.length}
                  currentIndex={tlIndex}
                  isPlaying={tlPlaying}
                  speed={tlSpeed}
                  onPlay={() => setTlPlaying(true)}
                  onPause={() => setTlPlaying(false)}
                  onReset={() => { setTlIndex(0); setTlPlaying(false); }}
                  onSeek={setTlIndex}
                  onSpeedChange={setTlSpeed}
                  currentDate={tlCurrentDate}
                />
              )}

              {selectedVisit && (
                <VisitDetailPanel
                  visit={selectedVisit}
                  onClose={() => { setSelectedVisit(null); clearRoute(); }}
                  onShowRoute={handleShowRoute}
                  routeVisible={routeVisible}
                  geocodedAddress={geocodedAddress}
                  geocoding={geocoding}
                />
              )}
            </div>
          </TabsContent>

          <TabsContent value="agents" className="flex-1 mt-2 min-h-0">
            <Card className="h-full">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Agent Performance Summary</CardTitle>
                <p className="text-xs text-muted-foreground">Confirmed rate, average duration, and 8-week visit frequency per agent</p>
              </CardHeader>
              <CardContent className="pt-0">
                <AgentSummaryPanel summaries={agentSummaries} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </BISLayout>
  );
}
