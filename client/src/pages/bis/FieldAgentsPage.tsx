// FieldAgentsPage — live tRPC-backed field agent management
// Design: Dark forensic intelligence theme, JetBrains Mono typography

import { useState, useRef, useMemo } from 'react';
import BISLayout from '@/components/BISLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Users, MapPin, Star, Shield, CheckCircle2, Clock, AlertTriangle,
  Search, Plus, Award, X, Send, Navigation, ChevronDown, Map, List, Loader2, RefreshCw
} from 'lucide-react';
import { MapView } from '@/components/Map';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

// ─── Config ───────────────────────────────────────────────────────────────────

const TIER_CONFIG: Record<string, { color: string; bg: string }> = {
  junior:     { color: 'text-amber-700', bg: 'bg-amber-700/10 border-amber-700/30' },
  senior:     { color: 'text-slate-400', bg: 'bg-slate-400/10 border-slate-400/30' },
  lead:       { color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/30' },
  specialist: { color: 'text-cyan-400',  bg: 'bg-cyan-400/10 border-cyan-400/30'   },
};

const TASK_TYPES = [
  { value: 'address_verification',  label: 'Address Verification' },
  { value: 'biometric_capture',     label: 'Biometric Capture' },
  { value: 'document_collection',   label: 'Document Collection' },
  { value: 'surveillance',          label: 'Surveillance' },
  { value: 'interview',             label: 'Interview' },
];

const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo',
  'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa',
  'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba',
  'Yobe', 'Zamfara',
];

const PRIORITY_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  low:      { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', label: 'Low' },
  medium:   { color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/30',     label: 'Medium' },
  high:     { color: 'text-orange-400',  bg: 'bg-orange-500/10 border-orange-500/30',   label: 'High' },
  critical: { color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/30',         label: 'Critical' },
};

const TASK_PIN_COLORS: Record<string, string> = {
  critical: '#f87171', high: '#fb923c', medium: '#fbbf24', low: '#34d399',
};

function timeAgo(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Dispatch Task Sheet ──────────────────────────────────────────────────────

function DispatchTaskSheet({
  agent,
  onClose,
}: {
  agent: any;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    taskType: 'address_verification' as string,
    subjectName: '',
    address: '',
    state: agent.state ?? '',
    lga: agent.lga ?? '',
    gpsLat: '',
    gpsLng: '',
    instructions: '',
    priority: 'medium' as string,
    deadline: '',
  });
  const [dispatched, setDispatched] = useState(false);
  const [taskRef, setTaskRef] = useState('');

  const utils = trpc.useUtils();
  const dispatchMutation = trpc.fieldTasks.dispatch.useMutation({
    onSuccess: (data) => {
      setTaskRef(data.taskRef);
      setDispatched(true);
      utils.fieldAgents.list.invalidate();
      utils.fieldTasks.list.invalidate();
    },
    onError: (e) => toast.error('Dispatch failed', { description: e.message }),
  });

  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    dispatchMutation.mutate({
      agentId: agent.agentCode,
      agentName: agent.name,
      taskType: form.taskType as any,
      priority: form.priority as any,
      subjectName: form.subjectName || undefined,
      address: form.address || undefined,
      state: form.state || undefined,
      lga: form.lga || undefined,
      gpsLat: form.gpsLat ? parseFloat(form.gpsLat) : undefined,
      gpsLng: form.gpsLng ? parseFloat(form.gpsLng) : undefined,
      deadline: form.deadline || undefined,
      instructions: form.instructions || undefined,
    });
  };

  const inputCls = "h-8 text-xs font-mono bg-background border-border text-foreground placeholder:text-muted-foreground";
  const labelCls = "text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1 block";

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md z-50 bg-popover border-l border-border shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <p className="text-sm font-mono font-semibold text-foreground flex items-center gap-2">
              <Send size={13} className="text-primary" /> Dispatch Field Task
            </p>
            <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
              Assigned to: <span className="text-foreground">{agent.name}</span> · {agent.agentCode}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
        </div>

        {dispatched ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
            <div className="w-16 h-16 rounded-full border border-emerald-500/40 bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle2 size={32} className="text-emerald-400" />
            </div>
            <div className="text-center">
              <p className="text-sm font-mono font-semibold text-foreground mb-1">Task Dispatched</p>
              <p className="text-xs font-mono text-muted-foreground">
                {agent.name} has been notified via the BIS Field App.
              </p>
              <p className="text-[10px] font-mono text-primary mt-2">Task Ref: {taskRef}</p>
            </div>
            <Button size="sm" className="text-xs" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div>
              <label className={labelCls}>Task Type</label>
              <select value={form.taskType} onChange={e => set('taskType', e.target.value)}
                className="w-full h-8 px-3 rounded-md border border-border bg-background text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
                {TASK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            <div>
              <label className={labelCls}>Priority</label>
              <div className="flex gap-2">
                {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                  <button key={key} type="button" onClick={() => set('priority', key)}
                    className={cn("flex-1 py-1.5 rounded-md border text-[10px] font-mono font-semibold transition-all",
                      form.priority === key ? `${cfg.bg} ${cfg.color}` : "border-border text-muted-foreground hover:border-border/80")}>
                    {cfg.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-border/40 pt-3">
              <p className="text-[9px] font-mono text-primary uppercase tracking-wider mb-3">Subject Details</p>
              <div className="space-y-2">
                <div>
                  <label className={labelCls}>Full Name</label>
                  <Input className={inputCls} placeholder="e.g. Emeka Okafor" value={form.subjectName}
                    onChange={e => set('subjectName', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Address</label>
                  <Input className={inputCls} placeholder="Street address" value={form.address}
                    onChange={e => set('address', e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>State</label>
                    <select value={form.state} onChange={e => set('state', e.target.value)}
                      className="w-full h-8 px-3 rounded-md border border-border bg-background text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
                      <option value="">Select…</option>
                      {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>LGA</label>
                    <Input className={inputCls} placeholder="Local Govt Area" value={form.lga}
                      onChange={e => set('lga', e.target.value)} />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-border/40 pt-3">
              <p className="text-[9px] font-mono text-primary uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Navigation size={9} /> GPS Coordinates (optional)
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Latitude</label>
                  <Input className={inputCls} placeholder="e.g. 6.5244" value={form.gpsLat}
                    onChange={e => set('gpsLat', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Longitude</label>
                  <Input className={inputCls} placeholder="e.g. 3.3792" value={form.gpsLng}
                    onChange={e => set('gpsLng', e.target.value)} />
                </div>
              </div>
            </div>

            <div>
              <label className={labelCls}>Deadline</label>
              <Input type="datetime-local" className={inputCls} value={form.deadline}
                onChange={e => set('deadline', e.target.value)} />
            </div>

            <div>
              <label className={labelCls}>Special Instructions</label>
              <textarea
                className="w-full h-20 px-3 py-2 rounded-md border border-border bg-background text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                placeholder="Additional instructions for the field agent..."
                value={form.instructions}
                onChange={e => set('instructions', e.target.value)}
              />
            </div>

            <div className="flex gap-2 pb-4">
              <Button type="button" variant="outline" className="flex-1 text-xs font-mono" onClick={onClose}>Cancel</Button>
              <Button type="submit" className="flex-1 text-xs font-mono gap-1.5" disabled={dispatchMutation.isPending}>
                {dispatchMutation.isPending ? <><Loader2 size={11} className="animate-spin" /> Dispatching…</> : <><Send size={11} /> Dispatch Task</>}
              </Button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FieldAgentsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dispatchAgent, setDispatchAgent] = useState<any | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'map'>('table');
  const [recruitOpen, setRecruitOpen] = useState(false);
  const [recruitForm, setRecruitForm] = useState({
    agentCode: '', name: '', email: '', phone: '',
    state: '', lga: '', tier: 'junior' as string, notes: '',
  });

  const [locatingAgentId, setLocatingAgentId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const updateLocationMutation = trpc.fieldAgents.updateLocation.useMutation({
    onSuccess: (result, variables) => {
      toast.success(`Location updated for agent #${variables.id}`, {
        description: `${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}`,
      });
      setLocatingAgentId(null);
      utils.fieldAgents.list.invalidate();
    },
    onError: (e: any) => {
      toast.error('Location update failed', { description: e.message });
      setLocatingAgentId(null);
    },
  });

  const handleUpdateLocation = (agentId: number) => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported by this browser');
      return;
    }
    setLocatingAgentId(agentId);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        updateLocationMutation.mutate({
          id: agentId,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => {
        toast.error('Could not get location', { description: err.message });
        setLocatingAgentId(null);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const [bulkLocating, setBulkLocating] = useState(false);

  const handleLocateAll = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported by this browser');
      return;
    }
    const activeAgents = (agentList as any[]).filter((a: any) => a.status === 'active');
    if (activeAgents.length === 0) {
      toast.info('No active agents to locate');
      return;
    }
    setBulkLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const mutations = activeAgents.map((a: any) =>
          updateLocationMutation.mutateAsync({ id: a.id, lat, lng }).catch(() => null)
        );
        await Promise.allSettled(mutations);
        setBulkLocating(false);
        utils.fieldAgents.list.invalidate();
        toast.success(`Locations updated for ${activeAgents.length} active agent${activeAgents.length !== 1 ? 's' : ''}`);
      },
      (err) => {
        toast.error('Could not get location', { description: err.message });
        setBulkLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const recruitMutation = trpc.fieldAgents.create.useMutation({
    onSuccess: () => {
      toast.success('Agent recruited', { description: `${recruitForm.name} has been added to the network.` });
      setRecruitOpen(false);
      setRecruitForm({ agentCode: '', name: '', email: '', phone: '', state: '', lga: '', tier: 'junior', notes: '' });
      utils.fieldAgents.list.invalidate();
    },
    onError: (e: any) => toast.error('Recruitment failed', { description: e.message }),
  });
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);

  const { data: agentList = [], isLoading, refetch } = trpc.fieldAgents.list.useQuery({
    status: statusFilter !== 'all' ? statusFilter : undefined,
    limit: 200,
  });

  const { data: activeTasks = [] } = trpc.fieldTasks.list.useQuery({ status: 'dispatched', limit: 50 });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (agentList as any[]).filter((a: any) =>
      !q ||
      a.name.toLowerCase().includes(q) ||
      (a.agentCode ?? '').toLowerCase().includes(q) ||
      (a.state ?? '').toLowerCase().includes(q)
    );
  }, [agentList, search]);

  const stats = useMemo(() => {
    const agents = agentList as any[];
    return {
      total: agents.length,
      active: agents.filter(a => a.status === 'active').length,
      tasksCompleted: agents.reduce((s: number, a: any) => s + (a.tasksCompleted ?? 0), 0),
      avgRating: agents.length
        ? Math.round(agents.reduce((s: number, a: any) => s + (a.rating ?? 0), 0) / agents.length * 10) / 10
        : 0,
    };
  }, [agentList]);

  const handleMapReady = (map: google.maps.Map) => {
    mapRef.current = map;
    (agentList as any[]).forEach((agent: any) => {
      if (!agent.gpsLat || !agent.gpsLng) return;
      const el = document.createElement('div');
      el.style.cssText = [
        'width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;',
        `background:${agent.status === 'active' ? '#22c55e' : '#6b7280'}22;`,
        `border:2px solid ${agent.status === 'active' ? '#22c55e' : '#6b7280'};`,
        "font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;",
        `color:${agent.status === 'active' ? '#22c55e' : '#9ca3af'};`,
      ].join('');
      el.textContent = agent.name.split(' ').map((n: string) => n[0]).join('');
      el.title = `${agent.name} (${agent.agentCode}) — ${agent.state ?? ''}`;
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map, position: { lat: agent.gpsLat, lng: agent.gpsLng }, content: el, title: agent.name,
      });
      markersRef.current.push(marker);
    });
    (activeTasks as any[]).forEach((task: any) => {
      if (!task.gpsLat || !task.gpsLng) return;
      const c = TASK_PIN_COLORS[task.priority] ?? '#fbbf24';
      const el = document.createElement('div');
      el.style.cssText = [
        'padding:3px 7px;border-radius:4px;',
        "font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;white-space:nowrap;",
        `background:${c}22;border:1.5px solid ${c};color:${c};`,
      ].join('');
      el.textContent = `\u25CF ${task.taskType.replace(/_/g, ' ')}`;
      el.title = `${task.taskType} — ${task.subjectName ?? ''} [${task.priority?.toUpperCase()}]`;
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map, position: { lat: task.gpsLat, lng: task.gpsLng }, content: el,
      });
      markersRef.current.push(marker);
    });
  };

  return (
    <BISLayout
      title="Field Agents"
      subtitle={`${stats.active} active agents across Nigeria`}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => refetch()}>
            <RefreshCw size={11} className={isLoading ? 'animate-spin' : ''} /> Refresh
          </Button>
          <div className="flex rounded-md border border-border overflow-hidden">
            <button onClick={() => setViewMode('table')}
              className={cn("px-3 py-1.5 text-[10px] font-mono flex items-center gap-1.5 transition-colors",
                viewMode === 'table' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              <List size={11} /> Table
            </button>
            <button onClick={() => setViewMode('map')}
              className={cn("px-3 py-1.5 text-[10px] font-mono flex items-center gap-1.5 transition-colors",
                viewMode === 'map' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              <Map size={11} /> Map
            </button>
          </div>
          <Button size="sm" className="h-7 text-xs gap-1.5 font-mono" onClick={() => setRecruitOpen(true)}>
            <Plus size={12} /> Recruit Agent
          </Button>
        </div>
      }
    >
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total Agents',     value: stats.total,                              icon: <Users size={14} />,        color: 'text-blue-400' },
          { label: 'Active Agents',    value: stats.active,                             icon: <CheckCircle2 size={14} />, color: 'text-emerald-400' },
          { label: 'Tasks Completed',  value: stats.tasksCompleted.toLocaleString(),    icon: <Shield size={14} />,       color: 'text-amber-400' },
          { label: 'Avg Rating',       value: `${stats.avgRating}/5`,                   icon: <Award size={14} />,        color: 'text-violet-400' },
        ].map(stat => (
          <div key={stat.label} className="bis-card p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{stat.label}</span>
              <span className={cn("opacity-60", stat.color)}>{stat.icon}</span>
            </div>
            <p className={cn("text-2xl font-mono font-bold", stat.color)}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1 max-w-64">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8 h-8 text-sm font-mono" placeholder="Search agents..." value={search}
            onChange={e => setSearch(e.target.value)} />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="h-8 px-3 rounded-md border border-border bg-background text-xs font-mono text-foreground">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="suspended">Suspended</option>
          <option value="training">Training</option>
        </select>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 size={20} className="animate-spin mr-2" /> Loading agents…
        </div>
      )}

      {/* Map View */}
      {!isLoading && viewMode === 'map' && (
        <div className="mb-4">
          <div className="bis-card overflow-hidden">
            <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-muted/20 flex-wrap">
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Legend:</span>
              <button
                onClick={handleLocateAll}
                disabled={bulkLocating}
                className="ml-auto flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded border border-emerald-500/40 text-emerald-400 bg-emerald-500/5 hover:bg-emerald-500/15 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {bulkLocating ? (
                  <><Loader2 size={10} className="animate-spin" /> Locating…</>
                ) : (
                  <><Navigation size={10} /> Locate All Active Agents</>
                )}
              </button>
              <span className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400">
                <span className="w-3 h-3 rounded-full border-2 border-emerald-400 bg-emerald-400/20" /> Active Agent
              </span>
              <span className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
                <span className="w-3 h-3 rounded-full border-2 border-muted-foreground bg-muted/20" /> Inactive Agent
              </span>
              {Object.entries(TASK_PIN_COLORS).map(([p, c]) => (
                <span key={p} className="flex items-center gap-1.5 text-[10px] font-mono capitalize" style={{ color: c }}>
                  <span className="w-2 h-2 rounded-sm" style={{ background: c + '33', border: `1.5px solid ${c}` }} /> {p} task
                </span>
              ))}
            </div>
            <MapView
              className="h-[480px]"
              initialCenter={{ lat: 9.0820, lng: 8.6753 }}
              initialZoom={6}
              onMapReady={handleMapReady}
            />
          </div>
          {(activeTasks as any[]).length > 0 && (
            <div className="bis-card p-4 mt-3">
              <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <Navigation size={11} /> Active Dispatch Tasks ({(activeTasks as any[]).length})
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {(activeTasks as any[]).map((task: any) => {
                  const c = TASK_PIN_COLORS[task.priority] ?? '#fbbf24';
                  return (
                    <div key={task.id} className="p-3 rounded-lg border border-border/50 bg-muted/10">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-mono font-bold" style={{ color: c }}>
                          {task.priority?.toUpperCase()}
                        </span>
                        <span className="text-[9px] font-mono text-muted-foreground">{task.taskRef}</span>
                      </div>
                      <p className="text-xs font-mono font-semibold text-foreground">{task.taskType?.replace(/_/g, ' ')}</p>
                      {task.subjectName && <p className="text-[10px] font-mono text-muted-foreground mt-0.5">Subject: {task.subjectName}</p>}
                      <p className="text-[10px] font-mono text-primary mt-0.5">{task.agentName}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Agent table */}
      {!isLoading && viewMode === 'table' && (
        <div className="bis-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Agent', 'Location', 'Tier', 'Tasks', 'Rating', 'Last Seen', 'Status', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((agent: any) => {
                  const tier = TIER_CONFIG[agent.tier] ?? TIER_CONFIG.junior;
                  return (
                    <tr key={agent.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-mono text-xs font-semibold text-foreground">{agent.name}</p>
                          <p className="font-mono text-[10px] text-muted-foreground">{agent.agentCode}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
                          <MapPin size={10} />
                          {agent.lga ? `${agent.lga}, ` : ''}{agent.state ?? '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("text-xs font-mono font-semibold px-2 py-0.5 rounded border capitalize", tier.bg, tier.color)}>
                          {agent.tier}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs font-mono">
                          <span className="text-emerald-400 font-semibold">{agent.tasksCompleted ?? 0}</span>
                          {(agent.tasksActive ?? 0) > 0 && <span className="text-muted-foreground ml-1">+{agent.tasksActive} active</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-emerald-400" style={{ width: `${((agent.rating ?? 0) / 5) * 100}%` }} />
                          </div>
                          <span className="text-xs font-mono text-emerald-400 font-bold">{(agent.rating ?? 0).toFixed(1)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-mono text-muted-foreground">{timeAgo(agent.lastSeen)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("text-[10px] font-mono rounded px-1.5 py-0.5", {
                          'bg-emerald-500/20 text-emerald-400': agent.status === 'active',
                          'bg-muted text-muted-foreground': agent.status === 'inactive',
                          'bg-red-500/20 text-red-400': agent.status === 'suspended',
                          'bg-amber-500/20 text-amber-400': agent.status === 'training',
                        })}>
                          {agent.status?.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Button size="sm" variant="outline" disabled={agent.status !== 'active'}
                            onClick={() => setDispatchAgent(agent)}
                            className="h-6 text-[10px] font-mono gap-1 whitespace-nowrap">
                            <Send size={9} /> Dispatch
                          </Button>
                          <Button size="sm" variant="ghost"
                            disabled={locatingAgentId === agent.id}
                            onClick={() => handleUpdateLocation(agent.id)}
                            className="h-6 text-[10px] font-mono gap-1 whitespace-nowrap text-muted-foreground hover:text-primary"
                            title="Update GPS location from browser">
                            {locatingAgentId === agent.id
                              ? <Loader2 size={9} className="animate-spin" />
                              : <Navigation size={9} />}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground text-sm">
                      <Users size={24} className="mx-auto mb-3 opacity-30" />
                      No agents found. Recruit your first field agent to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Anti-fraud info */}
      <div className="bis-card p-4 mt-4 border border-amber-500/20 bg-amber-500/5">
        <p className="text-xs font-mono text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-2">
          <Shield size={12} /> 5-Layer Anti-Fraud Protection
        </p>
        <div className="grid grid-cols-5 gap-3 text-[10px] font-mono text-muted-foreground">
          {[
            { layer: '1', label: 'Cryptographic GPS', desc: 'Signed location proofs' },
            { layer: '2', label: 'Consensus Voting', desc: 'Multi-agent agreement' },
            { layer: '3', label: 'Ray ML Anomaly', desc: 'Pattern detection' },
            { layer: '4', label: 'Photo Metadata', desc: 'EXIF verification' },
            { layer: '5', label: 'Biometric Bind', desc: 'Agent fingerprint' },
          ].map(l => (
            <div key={l.layer} className="text-center">
              <div className="w-8 h-8 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 flex items-center justify-center text-xs font-bold mx-auto mb-1">{l.layer}</div>
              <p className="text-amber-400/80 font-semibold">{l.label}</p>
              <p className="text-muted-foreground/60">{l.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Dispatch Task Sheet */}
      {dispatchAgent && (
        <DispatchTaskSheet agent={dispatchAgent} onClose={() => setDispatchAgent(null)} />
      )}

      {/* Recruit Agent Sheet */}
      {recruitOpen && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={() => setRecruitOpen(false)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-md z-50 bg-popover border-l border-border shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
              <div>
                <p className="text-sm font-mono font-semibold text-foreground flex items-center gap-2">
                  <Plus size={13} className="text-primary" /> Recruit Field Agent
                </p>
                <p className="text-[10px] font-mono text-muted-foreground mt-0.5">Add a new agent to the BIS network</p>
              </div>
              <button onClick={() => setRecruitOpen(false)} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
            </div>
            <form
              className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
              onSubmit={e => {
                e.preventDefault();
                recruitMutation.mutate({
                  agentCode: recruitForm.agentCode,
                  name: recruitForm.name,
                  email: recruitForm.email,
                  phone: recruitForm.phone || undefined,
                  state: recruitForm.state || undefined,
                  lga: recruitForm.lga || undefined,
                  tier: recruitForm.tier as any,
                  notes: recruitForm.notes || undefined,
                });
              }}
            >
              {([
                { k: 'agentCode', label: 'Agent Code', placeholder: 'e.g. BIS-LOS-042', required: true },
                { k: 'name',      label: 'Full Name',  placeholder: 'e.g. Chukwuemeka Obi', required: true },
                { k: 'email',     label: 'Email',      placeholder: 'agent@example.com', required: true },
                { k: 'phone',     label: 'Phone',      placeholder: '+234 801 234 5678' },
                { k: 'lga',       label: 'LGA',        placeholder: 'Local Government Area' },
              ] as any[]).map(f => (
                <div key={f.k}>
                  <label className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1 block">
                    {f.label}{f.required && <span className="text-red-400 ml-0.5">*</span>}
                  </label>
                  <Input
                    className="h-8 text-xs font-mono bg-background border-border"
                    placeholder={f.placeholder}
                    required={f.required}
                    value={(recruitForm as any)[f.k]}
                    onChange={e => setRecruitForm(prev => ({ ...prev, [f.k]: e.target.value }))}
                  />
                </div>
              ))}
              <div>
                <label className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1 block">State</label>
                <select
                  value={recruitForm.state}
                  onChange={e => setRecruitForm(prev => ({ ...prev, state: e.target.value }))}
                  className="w-full h-8 px-3 rounded-md border border-border bg-background text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Select state…</option>
                  {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1 block">Tier</label>
                <div className="flex gap-2">
                  {(['junior','senior','lead','specialist'] as const).map(t => (
                    <button key={t} type="button"
                      onClick={() => setRecruitForm(prev => ({ ...prev, tier: t }))}
                      className={cn(
                        'flex-1 py-1.5 rounded-md border text-[10px] font-mono font-semibold transition-all capitalize',
                        recruitForm.tier === t
                          ? `${TIER_CONFIG[t].bg} ${TIER_CONFIG[t].color}`
                          : 'border-border text-muted-foreground hover:border-border/80'
                      )}
                    >{t}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1 block">Notes</label>
                <textarea
                  className="w-full h-20 px-3 py-2 rounded-md border border-border bg-background text-xs font-mono text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
                  placeholder="Optional notes about this agent…"
                  value={recruitForm.notes}
                  onChange={e => setRecruitForm(prev => ({ ...prev, notes: e.target.value }))}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="outline" className="flex-1 text-xs font-mono" onClick={() => setRecruitOpen(false)}>Cancel</Button>
                <Button type="submit" className="flex-1 text-xs font-mono gap-1.5" disabled={recruitMutation.isPending}>
                  {recruitMutation.isPending ? <><Loader2 size={11} className="animate-spin" /> Recruiting…</> : <><Plus size={11} /> Add Agent</>}
                </Button>
              </div>
            </form>
          </div>
        </>
      )}
    </BISLayout>
  );
}
