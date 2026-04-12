import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";
import { MapView } from "@/components/Map";
import { BarChart3, MapPin, Building2, TrendingUp, FileText, CheckCircle2, XCircle, Clock } from "lucide-react";

const NIGERIAN_STATES = [
  { code: "AB", name: "Abia" }, { code: "AD", name: "Adamawa" }, { code: "AK", name: "Akwa Ibom" },
  { code: "AN", name: "Anambra" }, { code: "BA", name: "Bauchi" }, { code: "BY", name: "Bayelsa" },
  { code: "BE", name: "Benue" }, { code: "BO", name: "Borno" }, { code: "CR", name: "Cross River" },
  { code: "DE", name: "Delta" }, { code: "EB", name: "Ebonyi" }, { code: "ED", name: "Edo" },
  { code: "EK", name: "Ekiti" }, { code: "EN", name: "Enugu" }, { code: "GO", name: "Gombe" },
  { code: "IM", name: "Imo" }, { code: "JI", name: "Jigawa" }, { code: "KD", name: "Kaduna" },
  { code: "KN", name: "Kano" }, { code: "KT", name: "Katsina" }, { code: "KE", name: "Kebbi" },
  { code: "KO", name: "Kogi" }, { code: "KW", name: "Kwara" }, { code: "LA", name: "Lagos" },
  { code: "NA", name: "Nasarawa" }, { code: "NI", name: "Niger" }, { code: "OG", name: "Ogun" },
  { code: "ON", name: "Ondo" }, { code: "OS", name: "Osun" }, { code: "OY", name: "Oyo" },
  { code: "PL", name: "Plateau" }, { code: "RI", name: "Rivers" }, { code: "SO", name: "Sokoto" },
  { code: "TA", name: "Taraba" }, { code: "YO", name: "Yobe" }, { code: "ZA", name: "Zamfara" },
  { code: "FC", name: "FCT Abuja" },
];

// Approximate centroids for Nigerian states (lat, lng)
const STATE_CENTROIDS: Record<string, [number, number]> = {
  AB: [5.4527, 7.5248], AD: [9.3265, 12.3984], AK: [5.0377, 7.9128],
  AN: [6.2209, 7.0670], BA: [10.3158, 9.8442], BY: [4.7719, 6.0699],
  BE: [7.1906, 8.1299], BO: [11.8333, 13.1500], CR: [5.8702, 8.5988],
  DE: [5.8904, 5.6800], EB: [6.3249, 8.1137], ED: [6.5244, 5.8987],
  EK: [7.7190, 5.3110], EN: [6.4584, 7.5464], GO: [10.2791, 11.1670],
  IM: [5.4920, 7.0260], JI: [12.1820, 9.3647], KD: [10.5264, 7.4382],
  KN: [12.0022, 8.5920], KT: [12.9816, 7.6183], KE: [12.4539, 4.1975],
  KO: [7.7337, 6.6906], KW: [8.9669, 4.3873], LA: [6.5244, 3.3792],
  NA: [8.4966, 8.5320], NI: [9.6139, 5.9631], OG: [6.9980, 3.4737],
  ON: [7.2500, 5.2000], OS: [7.5629, 4.5624], OY: [7.8500, 3.9300],
  PL: [9.2182, 9.5179], RI: [4.8396, 6.9112], SO: [13.0622, 5.2339],
  TA: [8.8937, 11.3600], YO: [12.1220, 11.4390], ZA: [12.1700, 6.6600],
  FC: [9.0765, 7.3986],
};

const INCIDENT_COLORS: Record<string, string> = {
  arrest: "#3b82f6", seizure: "#8b5cf6", witness_statement: "#10b981",
  court_order: "#f59e0b", intel_tip: "#ef4444", missing_person: "#ec4899",
  homicide: "#dc2626", fraud: "#f97316", cybercrime: "#06b6d4", other: "#6b7280",
};

const PIE_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#dc2626", "#f97316", "#06b6d4", "#6b7280"];

const INCIDENT_LABELS: Record<string, string> = {
  arrest: "Arrest", seizure: "Seizure", witness_statement: "Witness Statement",
  court_order: "Court Order", intel_tip: "Intel Tip", missing_person: "Missing Person",
  homicide: "Homicide", fraud: "Fraud", cybercrime: "Cybercrime", other: "Other",
};

function StatCard({ icon: Icon, label, value, sub, color }: { icon: any; label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <Card>
      <CardContent className="py-4 px-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${color ?? ""}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="p-2 rounded-lg bg-muted/50">
            <Icon className="w-5 h-5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function LexAnalyticsPage() {
  const [stateFilter, setStateFilter] = useState<string>("");
  const [mapReady, setMapReady] = useState(false);
  const [mapRef, setMapRef] = useState<google.maps.Map | null>(null);

  const { data: stateStats } = trpc.lex.stateStats.useQuery();
  const { data: agencyStats } = trpc.lex.agencyStats.useQuery();
  const { data: incidentStats } = trpc.lex.incidentTypeStats.useQuery(
    stateFilter ? { state: stateFilter } : undefined
  );
  const { data: monthlyTrend } = trpc.lex.monthlyTrend.useQuery(
    stateFilter ? { state: stateFilter } : undefined
  );

  // Aggregate totals
  const totals = useMemo(() => {
    if (!stateStats) return { total: 0, validated: 0, rejected: 0, pending: 0 };
    return stateStats.reduce((acc, s) => ({
      total: acc.total + s.total,
      validated: acc.validated + s.validated,
      rejected: acc.rejected + s.rejected,
      pending: acc.pending + s.pending,
    }), { total: 0, validated: 0, rejected: 0, pending: 0 });
  }, [stateStats]);

  const validationRate = totals.total > 0 ? Math.round((totals.validated / totals.total) * 100) : 0;

  // Draw heatmap circles on the map
  const handleMapReady = (map: google.maps.Map) => {
    setMapRef(map);
    setMapReady(true);
    if (!stateStats || stateStats.length === 0) return;

    const maxTotal = Math.max(...stateStats.map(s => s.total), 1);

    stateStats.forEach(s => {
      const centroid = STATE_CENTROIDS[s.state];
      if (!centroid) return;
      const radius = 20000 + (s.total / maxTotal) * 80000; // 20–100km radius
      const opacity = 0.15 + (s.total / maxTotal) * 0.55;

      new google.maps.Circle({
        map,
        center: { lat: centroid[0], lng: centroid[1] },
        radius,
        fillColor: s.pending > 0 ? "#ef4444" : "#3b82f6",
        fillOpacity: opacity,
        strokeColor: "#1e40af",
        strokeOpacity: 0.4,
        strokeWeight: 1,
      });

      new google.maps.Marker({
        map,
        position: { lat: centroid[0], lng: centroid[1] },
        label: {
          text: String(s.total),
          color: "#fff",
          fontSize: "11px",
          fontWeight: "bold",
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 0,
        },
        title: `${s.stateName}: ${s.total} submissions`,
      });
    });

    // Fit to Nigeria
    map.setCenter({ lat: 9.0820, lng: 8.6753 });
    map.setZoom(6);
  };

  const stateBarData = (stateStats ?? []).slice(0, 15).map(s => ({
    state: s.state,
    name: s.stateName,
    total: s.total,
    validated: s.validated,
    rejected: s.rejected,
    pending: s.pending,
  }));

  const pieData = (incidentStats ?? []).map(s => ({
    name: INCIDENT_LABELS[s.incidentType] ?? s.incidentType,
    value: s.total,
    type: s.incidentType,
  }));

  const trendData = (monthlyTrend ?? []).map(m => ({
    month: m.month,
    Total: m.total,
    Validated: m.validated,
    Rejected: m.rejected,
  }));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-blue-600" />
            LEX Analytics
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Submission intelligence across all 37 Nigerian states. Filter by state for drill-down analysis.
          </p>
        </div>
        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All states" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All states</SelectItem>
            {NIGERIAN_STATES.map(s => <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={FileText} label="Total Submissions" value={totals.total} />
        <StatCard icon={CheckCircle2} label="Validated" value={totals.validated} sub={`${validationRate}% rate`} color="text-green-600" />
        <StatCard icon={XCircle} label="Rejected" value={totals.rejected} color="text-red-600" />
        <StatCard icon={Clock} label="Pending Review" value={totals.pending} color="text-yellow-600" />
      </div>

      {/* Map + State Bar Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Nigeria Heatmap */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="w-4 h-4" /> Submission Heatmap — Nigeria
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 rounded-b-lg overflow-hidden">
            <div className="h-80">
                <MapView
                  onMapReady={handleMapReady}
                  initialCenter={{ lat: 9.0820, lng: 8.6753 }}
                  initialZoom={6}
                />
            </div>
            <div className="px-4 py-2 text-xs text-muted-foreground flex items-center gap-4">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block opacity-70" /> Active submissions</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500 inline-block opacity-70" /> Pending review</span>
              <span className="text-muted-foreground">Circle size = volume</span>
            </div>
          </CardContent>
        </Card>

        {/* State Bar Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top States by Volume</CardTitle>
          </CardHeader>
          <CardContent>
            {stateBarData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={stateBarData} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="state" tick={{ fontSize: 11 }} width={28} />
                  <Tooltip
                    formatter={(v, name) => [v, name]}
                    labelFormatter={(label) => NIGERIAN_STATES.find(s => s.code === label)?.name ?? label}
                  />
                  <Bar dataKey="validated" stackId="a" fill="#10b981" name="Validated" />
                  <Bar dataKey="pending" stackId="a" fill="#f59e0b" name="Pending" />
                  <Bar dataKey="rejected" stackId="a" fill="#ef4444" name="Rejected" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Incident Type Pie + Monthly Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Incident Type Breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Incident Type Breakdown
              {stateFilter && <Badge variant="outline" className="ml-2 text-xs">{NIGERIAN_STATES.find(s => s.code === stateFilter)?.name}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
            ) : (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="55%" height={220}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2} dataKey="value">
                      {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v, name) => [v, name]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1.5">
                  {pieData.slice(0, 8).map((d, i) => (
                    <div key={d.type} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="flex-1 truncate text-muted-foreground">{d.name}</span>
                      <span className="font-medium">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Monthly Trend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Monthly Trend (12 months)
              {stateFilter && <Badge variant="outline" className="ml-2 text-xs">{NIGERIAN_STATES.find(s => s.code === stateFilter)?.name}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {trendData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="Total" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Validated" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Rejected" stroke="#ef4444" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Agencies Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="w-4 h-4" /> Top Agencies by Submission Volume
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(agencyStats ?? []).length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">No agency data yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left py-2 pr-4">Agency</th>
                    <th className="text-left py-2 pr-4">State</th>
                    <th className="text-right py-2 pr-4">Total</th>
                    <th className="text-right py-2 pr-4">Validated</th>
                    <th className="text-right py-2 pr-4">Pending</th>
                    <th className="text-right py-2">Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {(agencyStats ?? []).map((a, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 pr-4">
                        <div className="font-medium">{a.agencyName ?? "—"}</div>
                        <div className="text-xs text-muted-foreground font-mono">{a.agencyCode}</div>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{a.stateName}</td>
                      <td className="py-2 pr-4 text-right font-bold">{a.total}</td>
                      <td className="py-2 pr-4 text-right text-green-600">{a.validated}</td>
                      <td className="py-2 pr-4 text-right text-yellow-600">{a.pending}</td>
                      <td className="py-2 text-right text-red-600">{a.rejected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
