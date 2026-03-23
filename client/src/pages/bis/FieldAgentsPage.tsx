// FieldAgentsPage — Field agent management and incentive ledger
// Design: Dark forensic intelligence theme, JetBrains Mono typography

import { useState, useRef } from 'react';
import BISLayout from '@/components/BISLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Users, MapPin, Star, Shield, CheckCircle2, Clock, AlertTriangle,
  Search, Plus, Award, X, Send, Navigation, ChevronDown, Map, List
} from 'lucide-react';
import { MapView } from '@/components/Map';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FieldAgent {
  id: string;
  name: string;
  agentId: string;
  state: string;
  lga: string;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  completedTasks: number;
  pendingTasks: number;
  trustScore: number;
  totalEarnings: number;
  lastActive: string;
  status: 'active' | 'inactive' | 'suspended';
  verificationLevel: number;
  phone: string;
}

interface DispatchTask {
  agentId: string;
  taskType: string;
  subjectName: string;
  subjectAddress: string;
  subjectState: string;
  subjectLGA: string;
  subjectPhone: string;
  gpsLat: string;
  gpsLng: string;
  linkedInvestigation: string;
  instructions: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  deadline: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const MOCK_AGENTS: FieldAgent[] = [
  { id: 'a1', name: 'Adebayo Ogundimu', agentId: 'FA-NG-0142', state: 'Lagos', lga: 'Ikeja', tier: 'gold', completedTasks: 234, pendingTasks: 3, trustScore: 94, totalEarnings: 487500, lastActive: '2026-03-23T10:30:00Z', status: 'active', verificationLevel: 5, phone: '+2348012345678' },
  { id: 'a2', name: 'Ngozi Okafor', agentId: 'FA-NG-0089', state: 'Anambra', lga: 'Onitsha', tier: 'silver', completedTasks: 112, pendingTasks: 1, trustScore: 87, totalEarnings: 224000, lastActive: '2026-03-23T08:15:00Z', status: 'active', verificationLevel: 4, phone: '+2347098765432' },
  { id: 'a3', name: 'Musa Aliyu', agentId: 'FA-NG-0203', state: 'Kano', lga: 'Kano Municipal', tier: 'platinum', completedTasks: 389, pendingTasks: 5, trustScore: 98, totalEarnings: 892000, lastActive: '2026-03-23T11:00:00Z', status: 'active', verificationLevel: 5, phone: '+2348033221100' },
  { id: 'a4', name: 'Chidinma Eze', agentId: 'FA-NG-0067', state: 'Enugu', lga: 'Enugu North', tier: 'bronze', completedTasks: 45, pendingTasks: 0, trustScore: 72, totalEarnings: 67500, lastActive: '2026-03-22T14:00:00Z', status: 'active', verificationLevel: 3, phone: '+2348055443322' },
  { id: 'a5', name: 'Emeka Nwosu', agentId: 'FA-NG-0178', state: 'Rivers', lga: 'Port Harcourt', tier: 'silver', completedTasks: 98, pendingTasks: 2, trustScore: 81, totalEarnings: 196000, lastActive: '2026-03-21T09:00:00Z', status: 'inactive', verificationLevel: 4, phone: '+2348099887766' },
  { id: 'a6', name: 'Fatima Bello', agentId: 'FA-NG-0312', state: 'Abuja', lga: 'Garki', tier: 'gold', completedTasks: 187, pendingTasks: 4, trustScore: 91, totalEarnings: 374000, lastActive: '2026-03-23T09:45:00Z', status: 'active', verificationLevel: 5, phone: '+2348023456789' },
];

const TIER_CONFIG = {
  bronze:   { color: 'text-amber-700', bg: 'bg-amber-700/10 border-amber-700/30' },
  silver:   { color: 'text-slate-400', bg: 'bg-slate-400/10 border-slate-400/30' },
  gold:     { color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/30' },
  platinum: { color: 'text-cyan-400',  bg: 'bg-cyan-400/10 border-cyan-400/30'   },
};

const TASK_TYPES = [
  'Address Verification',
  'Physical Presence Confirmation',
  'Employer Verification',
  'Reference Interview',
  'Document Collection',
  'Photograph Subject Property',
  'Neighbor/Community Interview',
  'Business Premises Inspection',
];

const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo',
  'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa',
  'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba',
  'Yobe', 'Zamfara',
];

const PRIORITY_CONFIG = {
  low:    { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', label: 'Low' },
  medium: { color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/30',   label: 'Medium' },
  high:   { color: 'text-orange-400',  bg: 'bg-orange-500/10 border-orange-500/30',  label: 'High' },
  urgent: { color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/30',        label: 'Urgent' },
};

// ─── Dispatch Task Sheet ──────────────────────────────────────────────────────

function DispatchTaskSheet({
  agent,
  onClose,
  onSubmit,
}: {
  agent: FieldAgent;
  onClose: () => void;
  onSubmit: (task: DispatchTask) => void;
}) {
  const [form, setForm] = useState<DispatchTask>({
    agentId: agent.agentId,
    taskType: TASK_TYPES[0],
    subjectName: '',
    subjectAddress: '',
    subjectState: agent.state,
    subjectLGA: agent.lga,
    subjectPhone: '',
    gpsLat: '',
    gpsLng: '',
    linkedInvestigation: '',
    instructions: '',
    priority: 'medium',
    deadline: '',
  });
  const [submitted, setSubmitted] = useState(false);

  const set = (k: keyof DispatchTask, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setTimeout(() => {
      onSubmit(form);
    }, 1500);
  };

  const inputCls = "h-8 text-xs font-mono bg-background border-border text-foreground placeholder:text-muted-foreground";
  const labelCls = "text-[9px] font-mono text-muted-foreground uppercase tracking-wider mb-1 block";

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md z-50 bg-[#0d1117] border-l border-border shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <p className="text-sm font-mono font-semibold text-foreground flex items-center gap-2">
              <Send size={13} className="text-primary" /> Dispatch Field Task
            </p>
            <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
              Assigned to: <span className="text-foreground">{agent.name}</span> · {agent.agentId}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
        </div>

        {submitted ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
            <div className="w-16 h-16 rounded-full border border-emerald-500/40 bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle2 size={32} className="text-emerald-400" />
            </div>
            <div className="text-center">
              <p className="text-sm font-mono font-semibold text-foreground mb-1">Task Dispatched</p>
              <p className="text-xs font-mono text-muted-foreground">
                {agent.name} has been notified via WhatsApp and the BIS Field App.
              </p>
              <p className="text-[10px] font-mono text-primary mt-2">
                Task ID: BIS-TASK-{Date.now().toString().slice(-6)}
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Task Type */}
            <div>
              <label className={labelCls}>Task Type</label>
              <select
                value={form.taskType}
                onChange={e => set('taskType', e.target.value)}
                className="w-full h-8 px-3 rounded-md border border-border bg-background text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* Priority */}
            <div>
              <label className={labelCls}>Priority</label>
              <div className="flex gap-2">
                {(Object.entries(PRIORITY_CONFIG) as [DispatchTask['priority'], typeof PRIORITY_CONFIG.low][]).map(([key, cfg]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => set('priority', key)}
                    className={cn(
                      "flex-1 py-1.5 rounded-md border text-[10px] font-mono font-semibold transition-all",
                      form.priority === key ? `${cfg.bg} ${cfg.color}` : "border-border text-muted-foreground hover:border-border/80"
                    )}
                  >
                    {cfg.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Subject */}
            <div className="border-t border-border/40 pt-3">
              <p className="text-[9px] font-mono text-primary uppercase tracking-wider mb-3">Subject Details</p>
              <div className="space-y-2">
                <div>
                  <label className={labelCls}>Full Name</label>
                  <Input className={inputCls} placeholder="e.g. Emeka Okafor" value={form.subjectName}
                    onChange={e => set('subjectName', e.target.value)} required />
                </div>
                <div>
                  <label className={labelCls}>Address</label>
                  <Input className={inputCls} placeholder="Street address" value={form.subjectAddress}
                    onChange={e => set('subjectAddress', e.target.value)} required />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>State</label>
                    <select
                      value={form.subjectState}
                      onChange={e => set('subjectState', e.target.value)}
                      className="w-full h-8 px-3 rounded-md border border-border bg-background text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>LGA</label>
                    <Input className={inputCls} placeholder="Local Govt Area" value={form.subjectLGA}
                      onChange={e => set('subjectLGA', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Phone (optional)</label>
                  <Input className={inputCls} placeholder="+234..." value={form.subjectPhone}
                    onChange={e => set('subjectPhone', e.target.value)} />
                </div>
              </div>
            </div>

            {/* GPS */}
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

            {/* Investigation link */}
            <div className="border-t border-border/40 pt-3">
              <label className={labelCls}>Link to Investigation (optional)</label>
              <Input className={inputCls} placeholder="e.g. BIS-2026-0042" value={form.linkedInvestigation}
                onChange={e => set('linkedInvestigation', e.target.value)} />
            </div>

            {/* Deadline */}
            <div>
              <label className={labelCls}>Deadline</label>
              <Input type="datetime-local" className={inputCls} value={form.deadline}
                onChange={e => set('deadline', e.target.value)} required />
            </div>

            {/* Instructions */}
            <div>
              <label className={labelCls}>Special Instructions</label>
              <textarea
                className="w-full h-20 px-3 py-2 rounded-md border border-border bg-background text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                placeholder="Additional instructions for the field agent..."
                value={form.instructions}
                onChange={e => set('instructions', e.target.value)}
              />
            </div>

            {/* Submit */}
            <div className="flex gap-2 pb-4">
              <Button type="button" variant="outline" className="flex-1 text-xs font-mono" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1 text-xs font-mono gap-1.5">
                <Send size={11} /> Dispatch Task
              </Button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}

// ─── Agent locations (approximate city centres) ──────────────────────────────
const AGENT_LOCATIONS: Record<string, { lat: number; lng: number }> = {
  'a1': { lat: 6.6018,  lng: 3.3515  }, // Ikeja, Lagos
  'a2': { lat: 6.1428,  lng: 6.7936  }, // Onitsha, Anambra
  'a3': { lat: 12.0022, lng: 8.5920  }, // Kano
  'a4': { lat: 6.4483,  lng: 7.5464  }, // Enugu
  'a5': { lat: 4.8156,  lng: 7.0498  }, // Port Harcourt
  'a6': { lat: 9.0765,  lng: 7.3986  }, // Abuja
};

const ACTIVE_TASK_PINS = [
  { id: 'tp1', agentId: 'a1', label: 'Address Verification', lat: 6.4541, lng: 3.3947, priority: 'high' as const, subject: 'Emeka Okafor' },
  { id: 'tp2', agentId: 'a3', label: 'Employer Verification', lat: 12.0422, lng: 8.5320, priority: 'medium' as const, subject: 'Fatima Al-Hassan' },
  { id: 'tp3', agentId: 'a6', label: 'Physical Presence', lat: 9.0565, lng: 7.4986, priority: 'urgent' as const, subject: 'Zenith Logistics Ltd' },
  { id: 'tp4', agentId: 'a2', label: 'Document Collection', lat: 6.1628, lng: 6.7736, priority: 'low' as const, subject: 'Ngozi Adeyemi' },
];

const TASK_PIN_COLORS: Record<string, string> = {
  urgent: '#f87171', high: '#fb923c', medium: '#fbbf24', low: '#34d399',
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FieldAgentsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dispatchAgent, setDispatchAgent] = useState<FieldAgent | null>(null);
  const [dispatchedTasks, setDispatchedTasks] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'table' | 'map'>('table');
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);

  const filtered = MOCK_AGENTS.filter(a => {
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.agentId.toLowerCase().includes(search.toLowerCase()) ||
      a.state.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || a.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalEarnings = MOCK_AGENTS.reduce((s, a) => s + a.totalEarnings, 0);
  const totalTasks = MOCK_AGENTS.reduce((s, a) => s + a.completedTasks, 0);
  const avgTrust = Math.round(MOCK_AGENTS.reduce((s, a) => s + a.trustScore, 0) / MOCK_AGENTS.length);

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  const handleDispatch = (task: DispatchTask) => {
    setDispatchedTasks(prev => [...prev, task.agentId]);
    setTimeout(() => setDispatchAgent(null), 2000);
  };

  const handleMapReady = (map: google.maps.Map) => {
    mapRef.current = map;
    // Place agent markers
    MOCK_AGENTS.forEach(agent => {
      const pos = AGENT_LOCATIONS[agent.id];
      if (!pos) return;
      const el = document.createElement('div');
      el.style.cssText = [
        'width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;',
        `background:${agent.status === 'active' ? '#22c55e' : '#6b7280'}22;`,
        `border:2px solid ${agent.status === 'active' ? '#22c55e' : '#6b7280'};`,
        "font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;",
        `color:${agent.status === 'active' ? '#22c55e' : '#9ca3af'};`,
      ].join('');
      el.textContent = agent.name.split(' ').map((n: string) => n[0]).join('');
      el.title = `${agent.name} (${agent.agentId}) — ${agent.state}`;
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map, position: pos, content: el, title: agent.name,
      });
      markersRef.current.push(marker);
    });
    // Place task pins
    ACTIVE_TASK_PINS.forEach(task => {
      const el = document.createElement('div');
      const c = TASK_PIN_COLORS[task.priority];
      el.style.cssText = [
        'padding:3px 7px;border-radius:4px;',
        "font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;white-space:nowrap;",
        `background:${c}22;border:1.5px solid ${c};color:${c};`,
      ].join('');
      el.textContent = `\u25CF ${task.label}`;
      el.title = `${task.label} — ${task.subject} [${task.priority.toUpperCase()}]`;
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map, position: { lat: task.lat, lng: task.lng }, content: el,
      });
      markersRef.current.push(marker);
    });
  };

  return (
    <BISLayout
      title="Field Agents"
      subtitle={`${MOCK_AGENTS.filter(a => a.status === 'active').length} active agents across Nigeria`}
      actions={
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setViewMode('table')}
              className={cn("px-3 py-1.5 text-[10px] font-mono flex items-center gap-1.5 transition-colors",
                viewMode === 'table' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <List size={11} /> Table
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={cn("px-3 py-1.5 text-[10px] font-mono flex items-center gap-1.5 transition-colors",
                viewMode === 'map' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Map size={11} /> Map
            </button>
          </div>
          <Button size="sm" className="h-7 text-xs gap-1.5 font-mono">
            <Plus size={12} /> Recruit Agent
          </Button>
        </div>
      }
    >
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total Agents', value: MOCK_AGENTS.length, icon: <Users size={14} />, color: 'text-blue-400' },
          { label: 'Tasks Completed', value: totalTasks.toLocaleString(), icon: <CheckCircle2 size={14} />, color: 'text-emerald-400' },
          { label: 'Avg Trust Score', value: `${avgTrust}%`, icon: <Shield size={14} />, color: 'text-amber-400' },
          { label: 'Total Paid Out', value: `₦${(totalEarnings / 1000000).toFixed(1)}M`, icon: <Award size={14} />, color: 'text-violet-400' },
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
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="h-8 px-3 rounded-md border border-border bg-background text-xs font-mono text-foreground"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>

      {/* ── Map View ── */}
      {viewMode === 'map' && (
        <div className="mb-4">
          <div className="bis-card overflow-hidden">
            {/* Map legend */}
            <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-muted/20 flex-wrap">
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Legend:</span>
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
          {/* Active tasks list under map */}
          <div className="bis-card p-4 mt-3">
            <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <Navigation size={11} /> Active Dispatch Tasks ({ACTIVE_TASK_PINS.length})
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {ACTIVE_TASK_PINS.map(task => {
                const agent = MOCK_AGENTS.find(a => a.id === task.agentId);
                const c = TASK_PIN_COLORS[task.priority];
                return (
                  <div key={task.id} className="p-3 rounded-lg border border-border/50 bg-muted/10">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-mono font-bold" style={{ color: c }}>
                        {task.priority.toUpperCase()}
                      </span>
                      <span className="text-[9px] font-mono text-muted-foreground">
                        {task.lat.toFixed(4)}, {task.lng.toFixed(4)}
                      </span>
                    </div>
                    <p className="text-xs font-mono font-semibold text-foreground">{task.label}</p>
                    <p className="text-[10px] font-mono text-muted-foreground mt-0.5">Subject: {task.subject}</p>
                    {agent && (
                      <p className="text-[10px] font-mono text-primary mt-0.5">{agent.name} · {agent.agentId}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Agent table */}
      <div className={cn("bis-card overflow-hidden", viewMode === 'map' && 'hidden')}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {['Agent', 'Location', 'Tier', 'Tasks', 'Trust Score', 'Earnings', 'Last Active', 'Status', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(agent => {
              const tier = TIER_CONFIG[agent.tier];
              const hasDispatch = dispatchedTasks.includes(agent.agentId);
              return (
                <tr key={agent.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-mono text-xs font-semibold text-foreground">{agent.name}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">{agent.agentId}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
                      <MapPin size={10} />
                      {agent.lga}, {agent.state}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("text-xs font-mono font-semibold px-2 py-0.5 rounded border capitalize", tier.bg, tier.color)}>
                      {agent.tier}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs font-mono">
                      <span className="text-emerald-400 font-semibold">{agent.completedTasks}</span>
                      {agent.pendingTasks > 0 && <span className="text-muted-foreground ml-1">+{agent.pendingTasks} pending</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-400" style={{ width: `${agent.trustScore}%` }} />
                      </div>
                      <span className="text-xs font-mono text-emerald-400 font-bold">{agent.trustScore}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-foreground">₦{agent.totalEarnings.toLocaleString()}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-mono text-muted-foreground">{timeAgo(agent.lastActive)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("text-[10px] font-mono rounded px-1.5 py-0.5", {
                      'bg-emerald-500/20 text-emerald-400': agent.status === 'active',
                      'bg-muted text-muted-foreground': agent.status === 'inactive',
                      'bg-red-500/20 text-red-400': agent.status === 'suspended',
                    })}>
                      {agent.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={agent.status !== 'active'}
                      onClick={() => setDispatchAgent(agent)}
                      className={cn(
                        "h-6 text-[10px] font-mono gap-1 whitespace-nowrap",
                        hasDispatch && "text-emerald-400 border-emerald-400/40"
                      )}
                    >
                      <Send size={9} />
                      {hasDispatch ? 'Dispatched' : 'Dispatch Task'}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
        <DispatchTaskSheet
          agent={dispatchAgent}
          onClose={() => setDispatchAgent(null)}
          onSubmit={handleDispatch}
        />
      )}
    </BISLayout>
  );
}
