import { useRef, useState, useEffect, useCallback } from "react";
import { MapView } from "@/components/Map";
import { trpc } from "@/lib/trpc";
import BISLayout from "@/components/BISLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MapPin,
  Users,
  CheckCircle2,
  Clock,
  Layers,
  X,
  RefreshCw,
  Navigation,
  AlertTriangle,
  HelpCircle,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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
  return OUTCOME_CONFIG[outcome ?? ""] ?.hex ?? "#6366f1";
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ stats }: { stats: { total: number; confirmed: number; confirmedPct: number; avgDuration: number; activeAgents: number } }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Card className="bg-card/80 backdrop-blur-sm">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <MapPin className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Visits</p>
            <p className="text-xl font-bold">{stats.total}</p>
          </div>
        </CardContent>
      </Card>
      <Card className="bg-card/80 backdrop-blur-sm">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Confirmed</p>
            <p className="text-xl font-bold">{stats.confirmed} <span className="text-sm font-normal text-muted-foreground">({stats.confirmedPct}%)</span></p>
          </div>
        </CardContent>
      </Card>
      <Card className="bg-card/80 backdrop-blur-sm">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/10">
            <Clock className="w-4 h-4 text-blue-500" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Avg Duration</p>
            <p className="text-xl font-bold">{stats.avgDuration} <span className="text-sm font-normal text-muted-foreground">min</span></p>
          </div>
        </CardContent>
      </Card>
      <Card className="bg-card/80 backdrop-blur-sm">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-violet-500/10">
            <Users className="w-4 h-4 text-violet-500" />
          </div>
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

function VisitDetailPanel({ visit, onClose }: { visit: VisitPoint; onClose: () => void }) {
  const cfg = OUTCOME_CONFIG[visit.outcome ?? ""] ?? { label: visit.outcome ?? "Unknown", color: "bg-slate-400", hex: "#94a3b8", icon: HelpCircle };
  const Icon = cfg.icon;

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
        {/* Outcome badge */}
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" style={{ color: cfg.hex }} />
          <Badge className={cn("text-white text-xs", cfg.color)}>{cfg.label}</Badge>
          {visit.durationMinutes != null && (
            <span className="text-xs text-muted-foreground ml-auto">{visit.durationMinutes} min</span>
          )}
        </div>

        <Separator />

        {/* Agent */}
        <div className="flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">Agent:</span>
          <span className="font-medium truncate">{visit.agentName}</span>
        </div>

        {/* GPS check-in */}
        {visit.checkInLat != null && visit.checkInLng != null && (
          <div className="flex items-start gap-2">
            <Navigation className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <span className="text-muted-foreground">Check-in GPS:</span>
              <p className="font-mono text-xs mt-0.5">
                {visit.checkInLat.toFixed(6)}, {visit.checkInLng.toFixed(6)}
              </p>
            </div>
          </div>
        )}

        {/* Subject present / Address confirmed */}
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

        {/* Findings */}
        {visit.findings && (
          <>
            <Separator />
            <div>
              <p className="text-xs text-muted-foreground mb-1">Findings</p>
              <p className="text-xs leading-relaxed line-clamp-4">{visit.findings}</p>
            </div>
          </>
        )}

        {/* Date */}
        <Separator />
        <p className="text-xs text-muted-foreground">
          Submitted: {visit.submittedAt
            ? new Date(visit.submittedAt).toLocaleString()
            : new Date(visit.createdAt).toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FieldVisitMapPage() {
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const heatmapRef = useRef<google.maps.visualization.HeatmapLayer | null>(null);
  const clustererRef = useRef<any>(null);

  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState<VisitPoint | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const { data, isLoading, refetch } = trpc.fieldTasks.getVisitGeoData.useQuery(
    { outcome: outcomeFilter, dateRange, limit: 200 },
    { refetchOnWindowFocus: false }
  );

  const points: VisitPoint[] = data?.points ?? [];
  const stats = data?.stats ?? { total: 0, confirmed: 0, confirmedPct: 0, avgDuration: 0, activeAgents: 0 };

  // ── Build custom SVG pin for a given outcome colour ──────────────────────
  const buildPin = useCallback((hex: string) => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
        <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 24 16 24S32 26 32 16C32 7.163 24.837 0 16 0z"
              fill="${hex}" stroke="white" stroke-width="2"/>
        <circle cx="16" cy="16" r="6" fill="white" opacity="0.9"/>
      </svg>`;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = document.createElement("img");
    img.src = url;
    img.width = 32;
    img.height = 40;
    return img;
  }, []);

  // ── Place markers on the map ─────────────────────────────────────────────
  const placeMarkers = useCallback(() => {
    if (!mapRef.current || !window.google) return;

    // Clear existing markers
    markersRef.current.forEach(m => { m.map = null; });
    markersRef.current = [];

    // Clear heatmap
    if (heatmapRef.current) {
      heatmapRef.current.setMap(null);
      heatmapRef.current = null;
    }

    const validPoints = points.filter(p => p.checkInLat != null && p.checkInLng != null);

    if (showHeatmap) {
      // Heatmap layer — requires visualization library
      const heatData = validPoints.map(p => ({
        location: new window.google.maps.LatLng(p.checkInLat!, p.checkInLng!),
        weight: p.outcome === "confirmed" ? 3 : p.outcome === "failed" ? 1 : 2,
      }));
      try {
        heatmapRef.current = new (window.google.maps as any).visualization.HeatmapLayer({
          data: heatData,
          map: mapRef.current,
          radius: 40,
          opacity: 0.7,
        });
      } catch {
        // visualization library not loaded — fall through to markers
      }
    }

    // Always place markers (even with heatmap for click targets)
    validPoints.forEach(point => {
      const hex = getOutcomeHex(point.outcome);
      const marker = new window.google.maps.marker.AdvancedMarkerElement({
        map: mapRef.current!,
        position: { lat: point.checkInLat!, lng: point.checkInLng! },
        title: `${point.visitRef} — ${point.outcome ?? "unknown"}`,
        content: buildPin(hex),
      });

      marker.addListener("click", () => {
        setSelectedVisit(point);
      });

      markersRef.current.push(marker);
    });

    // Auto-fit bounds if we have points
    if (validPoints.length > 0) {
      const bounds = new window.google.maps.LatLngBounds();
      validPoints.forEach(p => bounds.extend({ lat: p.checkInLat!, lng: p.checkInLng! }));
      mapRef.current.fitBounds(bounds, { top: 60, right: 340, bottom: 60, left: 60 });
    }
  }, [points, showHeatmap, buildPin]);

  // Re-place markers whenever data or heatmap toggle changes
  useEffect(() => {
    if (mapReady) placeMarkers();
  }, [mapReady, placeMarkers]);

  const handleMapReady = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    setMapReady(true);
  }, []);

  const handleRefresh = () => {
    refetch();
    toast.success("Map data refreshed");
  };

  return (
    <BISLayout>
      <div className="flex flex-col gap-4 p-4 md:p-6 h-full">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Field Visit Map</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              GPS-tagged visit locations and outcomes across Nigeria
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Date range */}
            <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
              <SelectTrigger className="w-32 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>

            {/* Heatmap toggle */}
            <Button
              variant={showHeatmap ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setShowHeatmap(h => !h)}
            >
              <Layers className="w-3.5 h-3.5" />
              Heatmap
            </Button>

            {/* Refresh */}
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleRefresh} disabled={isLoading}>
              <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats bar */}
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
                  isActive
                    ? "border-transparent text-white shadow-sm"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                )}
                style={isActive && cfg ? { backgroundColor: cfg.hex } : undefined}
              >
                {cfg && <cfg.icon className="w-3 h-3" />}
                {o === "all" ? "All outcomes" : cfg?.label}
                {isActive && o !== "all" && (
                  <span className="ml-0.5 bg-white/20 rounded-full px-1 text-[10px]">
                    {points.filter(p => p.outcome === o).length}
                  </span>
                )}
              </button>
            );
          })}
          {outcomeFilter !== "all" && (
            <span className="text-xs text-muted-foreground ml-1">
              {points.length} point{points.length !== 1 ? "s" : ""} shown
            </span>
          )}
        </div>

        {/* Map container */}
        <div className="relative flex-1 min-h-[480px] rounded-xl overflow-hidden border border-border/50 shadow-sm">
          <MapView
            className="w-full h-full min-h-[480px]"
            // Nigeria centroid
            initialCenter={{ lat: 9.082, lng: 8.6753 }}
            initialZoom={6}
            onMapReady={handleMapReady}
          />

          {/* Loading overlay */}
          {isLoading && (
            <div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center z-20">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Loading visit data…
              </div>
            </div>
          )}

          {/* Empty state overlay */}
          {!isLoading && points.length === 0 && mapReady && (
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
            </div>
          </div>

          {/* Visit detail panel */}
          {selectedVisit && (
            <VisitDetailPanel
              visit={selectedVisit}
              onClose={() => setSelectedVisit(null)}
            />
          )}
        </div>
      </div>
    </BISLayout>
  );
}
