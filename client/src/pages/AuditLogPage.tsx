// AuditLogPage — Chronological record of all analyst actions
// Design: Forensic Intelligence theme, semantic CSS variables

import { useState, useMemo } from "react";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Search, Download, Filter, X, Shield, FileText, Bell,
  UserCheck, Bookmark, LogIn, LogOut, Settings, Eye,
  AlertTriangle, ChevronDown, ChevronUp, RefreshCw
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ActionCategory =
  | "auth"
  | "investigation"
  | "report"
  | "alert"
  | "kyc"
  | "preset"
  | "settings"
  | "data_access";

interface AuditEntry {
  id: string;
  timestamp: string;
  user: string;
  userId: string;
  role: string;
  action: string;
  category: ActionCategory;
  target?: string;
  targetRef?: string;
  ip: string;
  result: "success" | "failure" | "warning";
  details?: string;
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const USERS = [
  { id: "u1", name: "Operator Admin", role: "Admin" },
  { id: "u2", name: "Amaka Obi", role: "Analyst" },
  { id: "u3", name: "Chidi Nwosu", role: "Analyst" },
  { id: "u4", name: "Fatima Bello", role: "Supervisor" },
];

const IPS = ["197.210.54.12", "41.58.22.100", "102.89.47.3", "197.211.60.44", "41.76.108.55"];

function rnd<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

const SEED_ENTRIES: AuditEntry[] = [
  { id: "a001", timestamp: ago(2),    user: "Operator Admin", userId: "u1", role: "Admin",      action: "User login",                  category: "auth",          ip: IPS[0], result: "success" },
  { id: "a002", timestamp: ago(4),    user: "Operator Admin", userId: "u1", role: "Admin",      action: "Investigation created",       category: "investigation", target: "Emeka Nwosu",     targetRef: "BIS-2026-0143", ip: IPS[0], result: "success" },
  { id: "a003", timestamp: ago(7),    user: "Amaka Obi",      userId: "u2", role: "Analyst",    action: "Report generated",            category: "report",        target: "KYC Summary — Adaeze Okonkwo", targetRef: "BIS-2026-0091", ip: IPS[1], result: "success" },
  { id: "a004", timestamp: ago(11),   user: "Chidi Nwosu",    userId: "u3", role: "Analyst",    action: "Alert marked as read",        category: "alert",         target: "OFAC SDN match — Emeka Nwosu", ip: IPS[2], result: "success" },
  { id: "a005", timestamp: ago(15),   user: "Fatima Bello",   userId: "u4", role: "Supervisor", action: "KYC batch upload initiated",  category: "kyc",           target: "5 subjects",      ip: IPS[3], result: "success" },
  { id: "a006", timestamp: ago(22),   user: "Amaka Obi",      userId: "u2", role: "Analyst",    action: "Filter preset saved",         category: "preset",        target: "Flagged · Nigeria", ip: IPS[1], result: "success" },
  { id: "a007", timestamp: ago(30),   user: "Operator Admin", userId: "u1", role: "Admin",      action: "Investigation viewed",        category: "data_access",   target: "Bola Tinubu Corp", targetRef: "BIS-2026-0004", ip: IPS[0], result: "success" },
  { id: "a008", timestamp: ago(38),   user: "Chidi Nwosu",    userId: "u3", role: "Analyst",    action: "Report preview opened",       category: "report",        target: "Full Due Diligence — Kemi Adeola", ip: IPS[2], result: "success" },
  { id: "a009", timestamp: ago(45),   user: "Fatima Bello",   userId: "u4", role: "Supervisor", action: "Field agent dispatched",      category: "investigation", target: "Agent: Tunde Alabi", targetRef: "TASK-2026-0012", ip: IPS[3], result: "success" },
  { id: "a010", timestamp: ago(52),   user: "Amaka Obi",      userId: "u2", role: "Analyst",    action: "Login failed — wrong password", category: "auth",        ip: IPS[4], result: "failure", details: "3rd consecutive failure" },
  { id: "a011", timestamp: ago(60),   user: "Amaka Obi",      userId: "u2", role: "Analyst",    action: "User login",                  category: "auth",          ip: IPS[1], result: "success" },
  { id: "a012", timestamp: ago(75),   user: "Operator Admin", userId: "u1", role: "Admin",      action: "Data source toggled",         category: "settings",      target: "EFCC Watchlist — enabled", ip: IPS[0], result: "success" },
  { id: "a013", timestamp: ago(90),   user: "Chidi Nwosu",    userId: "u3", role: "Analyst",    action: "Investigation created",       category: "investigation", target: "Ngozi Adeyemi",   targetRef: "BIS-2026-0142", ip: IPS[2], result: "success" },
  { id: "a014", timestamp: ago(105),  user: "Fatima Bello",   userId: "u4", role: "Supervisor", action: "Report exported",             category: "report",        target: "Compliance Summary — March 2026", ip: IPS[3], result: "success" },
  { id: "a015", timestamp: ago(120),  user: "Operator Admin", userId: "u1", role: "Admin",      action: "Alert escalated",             category: "alert",         target: "EFCC partial match — Musa Danjuma", ip: IPS[0], result: "warning", details: "Escalated to Supervisor" },
  { id: "a016", timestamp: ago(140),  user: "Amaka Obi",      userId: "u2", role: "Analyst",    action: "KYC verification run",        category: "kyc",           target: "Yusuf Musa", ip: IPS[1], result: "success" },
  { id: "a017", timestamp: ago(160),  user: "Chidi Nwosu",    userId: "u3", role: "Analyst",    action: "Investigation viewed",        category: "data_access",   target: "Ngozi Adeyemi", targetRef: "BIS-2026-0142", ip: IPS[2], result: "success" },
  { id: "a018", timestamp: ago(180),  user: "Fatima Bello",   userId: "u4", role: "Supervisor", action: "User session expired",        category: "auth",          ip: IPS[3], result: "warning" },
  { id: "a019", timestamp: ago(200),  user: "Operator Admin", userId: "u1", role: "Admin",      action: "Theme preference changed",    category: "settings",      target: "Dark → Light", ip: IPS[0], result: "success" },
  { id: "a020", timestamp: ago(220),  user: "Amaka Obi",      userId: "u2", role: "Analyst",    action: "Social mention linked",       category: "investigation", target: "BIS-2026-0091", ip: IPS[1], result: "success" },
  { id: "a021", timestamp: ago(250),  user: "Chidi Nwosu",    userId: "u3", role: "Analyst",    action: "Report generated",            category: "report",        target: "Sanctions Screening — Emeka Nwosu", targetRef: "BIS-2026-0143", ip: IPS[2], result: "success" },
  { id: "a022", timestamp: ago(280),  user: "Fatima Bello",   userId: "u4", role: "Supervisor", action: "Investigation created",       category: "investigation", target: "Abubakar Shekau Ltd", targetRef: "BIS-2026-0141", ip: IPS[3], result: "success" },
  { id: "a023", timestamp: ago(310),  user: "Operator Admin", userId: "u1", role: "Admin",      action: "Bulk export downloaded",      category: "data_access",   target: "2,847 records — CSV", ip: IPS[0], result: "success" },
  { id: "a024", timestamp: ago(360),  user: "Amaka Obi",      userId: "u2", role: "Analyst",    action: "User logout",                 category: "auth",          ip: IPS[1], result: "success" },
  { id: "a025", timestamp: ago(420),  user: "Chidi Nwosu",    userId: "u3", role: "Analyst",    action: "User login",                  category: "auth",          ip: IPS[2], result: "success" },
];

// ─── Config ───────────────────────────────────────────────────────────────────

const CATEGORY_ICON: Record<ActionCategory, React.ReactNode> = {
  auth:          <LogIn size={12} />,
  investigation: <Shield size={12} />,
  report:        <FileText size={12} />,
  alert:         <Bell size={12} />,
  kyc:           <UserCheck size={12} />,
  preset:        <Bookmark size={12} />,
  settings:      <Settings size={12} />,
  data_access:   <Eye size={12} />,
};

const CATEGORY_COLOR: Record<ActionCategory, string> = {
  auth:          "text-blue-400",
  investigation: "text-primary",
  report:        "text-violet-400",
  alert:         "text-red-400",
  kyc:           "text-emerald-400",
  preset:        "text-amber-400",
  settings:      "text-muted-foreground",
  data_access:   "text-cyan-400",
};

const RESULT_CLASS: Record<AuditEntry["result"], string> = {
  success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30",
  failure: "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30",
  warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30",
};

function formatTs(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuditLogPage() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [entries] = useState<AuditEntry[]>(SEED_ENTRIES);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return entries.filter(e => {
      const matchSearch = !q ||
        e.action.toLowerCase().includes(q) ||
        e.user.toLowerCase().includes(q) ||
        (e.target && e.target.toLowerCase().includes(q)) ||
        (e.targetRef && e.targetRef.toLowerCase().includes(q)) ||
        e.ip.includes(q);
      const matchCat    = categoryFilter === "all" || e.category === categoryFilter;
      const matchUser   = userFilter     === "all" || e.userId   === userFilter;
      const matchResult = resultFilter   === "all" || e.result   === resultFilter;
      return matchSearch && matchCat && matchUser && matchResult;
    });
  }, [entries, search, categoryFilter, userFilter, resultFilter]);

  const activeFilters = [categoryFilter !== "all", userFilter !== "all", resultFilter !== "all"].filter(Boolean).length;

  const clearAll = () => {
    setSearch(""); setCategoryFilter("all"); setUserFilter("all"); setResultFilter("all");
  };

  const handleExport = () => {
    const csv = [
      "Timestamp,User,Role,Action,Category,Target,Ref,IP,Result",
      ...filtered.map(e =>
        [formatTs(e.timestamp), e.user, e.role, e.action, e.category,
          e.target || "", e.targetRef || "", e.ip, e.result].map(v => `"${v}"`).join(",")
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `bis-audit-log-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} audit entries`);
  };

  return (
    <BISLayout
      title="Audit Log"
      subtitle={`${filtered.length} of ${entries.length} entries`}
      actions={
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handleExport}>
          <Download size={11} /> Export CSV
        </Button>
      }
    >
      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-52">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Search action, user, target, IP…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <Filter size={11} className="mr-1 shrink-0" /><SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="auth">Authentication</SelectItem>
            <SelectItem value="investigation">Investigation</SelectItem>
            <SelectItem value="report">Report</SelectItem>
            <SelectItem value="alert">Alert</SelectItem>
            <SelectItem value="kyc">KYC</SelectItem>
            <SelectItem value="preset">Preset</SelectItem>
            <SelectItem value="settings">Settings</SelectItem>
            <SelectItem value="data_access">Data Access</SelectItem>
          </SelectContent>
        </Select>

        <Select value={userFilter} onValueChange={setUserFilter}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="User" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Users</SelectItem>
            {USERS.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={resultFilter} onValueChange={setResultFilter}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Result" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Results</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="failure">Failure</SelectItem>
          </SelectContent>
        </Select>

        {activeFilters > 0 && (
          <button onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <X size={11} /> Clear ({activeFilters})
          </button>
        )}
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: "Total Events",   value: entries.length,                                    color: "text-foreground" },
          { label: "Successes",      value: entries.filter(e => e.result === "success").length, color: "text-emerald-500" },
          { label: "Warnings",       value: entries.filter(e => e.result === "warning").length, color: "text-amber-500" },
          { label: "Failures",       value: entries.filter(e => e.result === "failure").length, color: "text-red-500" },
        ].map(s => (
          <div key={s.label} className="bis-card p-3">
            <p className={cn("text-xl font-bold font-mono", s.color)}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Timeline table ── */}
      <div className="bis-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {["Timestamp", "User", "Category", "Action", "Target / Ref", "IP Address", "Result"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
                <th className="px-4 py-3 w-8" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(entry => (
                <>
                  <tr
                    key={entry.id}
                    className={cn(
                      "border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer",
                      entry.result === "failure" && "bg-red-500/5",
                      entry.result === "warning" && "bg-amber-500/5",
                    )}
                    onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-xs font-mono text-foreground">{formatTs(entry.timestamp)}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">{relativeTime(entry.timestamp)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-medium text-foreground">{entry.user}</div>
                      <div className="text-[10px] text-muted-foreground">{entry.role}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className={cn("flex items-center gap-1.5 text-xs font-mono capitalize", CATEGORY_COLOR[entry.category])}>
                        {CATEGORY_ICON[entry.category]}
                        {entry.category.replace("_", " ")}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-foreground">{entry.action}</span>
                    </td>
                    <td className="px-4 py-3">
                      {entry.target && (
                        <div>
                          <div className="text-xs text-foreground truncate max-w-48">{entry.target}</div>
                          {entry.targetRef && (
                            <div className="text-[10px] font-mono text-primary">{entry.targetRef}</div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono text-muted-foreground">{entry.ip}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("text-[10px] font-mono rounded px-2 py-0.5 capitalize", RESULT_CLASS[entry.result])}>
                        {entry.result}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {entry.details && (
                        expandedId === entry.id
                          ? <ChevronUp size={12} className="text-muted-foreground" />
                          : <ChevronDown size={12} className="text-muted-foreground" />
                      )}
                    </td>
                  </tr>
                  {expandedId === entry.id && entry.details && (
                    <tr key={`${entry.id}-detail`} className="border-b border-border/50 bg-muted/20">
                      <td colSpan={8} className="px-4 py-2">
                        <div className="flex items-center gap-2 text-xs font-mono">
                          <AlertTriangle size={11} className="text-amber-400 shrink-0" />
                          <span className="text-muted-foreground">{entry.details}</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Shield size={24} className="opacity-30" />
                      <p className="text-sm">No audit entries match your filters.</p>
                      <button onClick={clearAll} className="text-xs text-primary hover:underline">Clear filters</button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 border-t border-border/50 flex items-center justify-between">
          <span className="text-[10px] font-mono text-muted-foreground">
            Showing {filtered.length} of {entries.length} audit entries
          </span>
          <span className="text-[10px] font-mono text-muted-foreground/50">
            Retention: 90 days · Tamper-evident log
          </span>
        </div>
      </div>
    </BISLayout>
  );
}
