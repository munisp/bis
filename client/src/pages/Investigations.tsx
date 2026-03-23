// BIS Investigations Page — Full CRUD with search, filter, create
import { useState } from "react";
import { useLocation } from "wouter";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import NewInvestigationSlideOver from "@/components/NewInvestigationSlideOver";
import {
  Search, Plus, Filter, ChevronRight, User, Building2,
  Clock, CheckCircle2, AlertTriangle, Loader2, FileText
} from "lucide-react";
import {
  mockInvestigations, Investigation, InvestigationStatus,
  InvestigationTier, getStatusBadgeClass, formatDateTime
} from "@/lib/mockData";

const tierPrice: Record<InvestigationTier, string> = {
  basic: "$25", standard: "$75", comprehensive: "$150"
};

const statusIcon: Record<InvestigationStatus, React.ReactNode> = {
  pending: <Clock size={12} className="text-amber-400" />,
  processing: <Loader2 size={12} className="text-blue-400 animate-spin" />,
  completed: <CheckCircle2 size={12} className="text-emerald-400" />,
  flagged: <AlertTriangle size={12} className="text-red-400" />,
  draft: <FileText size={12} className="text-muted-foreground" />,
};

export default function Investigations() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = mockInvestigations.filter(inv => {
    const matchSearch = inv.subjectName.toLowerCase().includes(search.toLowerCase()) ||
      inv.ref.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || inv.status === statusFilter;
    const matchTier = tierFilter === "all" || inv.tier === tierFilter;
    const matchType = typeFilter === "all" || inv.subjectType === typeFilter;
    return matchSearch && matchStatus && matchTier && matchType;
  });

  const riskBar = (score: number) => {
    const color = score >= 80 ? "#f87171" : score >= 60 ? "#fb923c" : score >= 30 ? "#fbbf24" : "#34d399";
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
        </div>
        <span className="text-xs font-mono w-6 text-right" style={{ color }}>{score}</span>
      </div>
    );
  };

  return (
    <BISLayout
      title="Investigations"
      subtitle={`${filtered.length} of ${mockInvestigations.length} records`}
      actions={
        <Button size="sm" className="h-7 text-xs gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus size={12} /> New Investigation
        </Button>
      }
    >
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8 h-8 text-sm" placeholder="Search by name or reference..." value={search}
            onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-32 text-xs"><Filter size={11} className="mr-1" /><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="flagged">Flagged</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Tier" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            <SelectItem value="basic">Basic</SelectItem>
            <SelectItem value="standard">Standard</SelectItem>
            <SelectItem value="comprehensive">Comprehensive</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="individual">Individual</SelectItem>
            <SelectItem value="corporate">Corporate</SelectItem>
            <SelectItem value="government">Government</SelectItem>
            <SelectItem value="ngo">NGO</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="bis-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Reference</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Subject</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tier</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-32">Risk Score</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv, i) => (
                <tr key={inv.id}
                  className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => navigate(`/investigations/${inv.id}`)}
                >
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-primary">{inv.ref}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        {inv.subjectType === "individual" ? <User size={10} className="text-primary" /> : <Building2 size={10} className="text-primary" />}
                      </div>
                      <div>
                        <div className="font-medium text-foreground text-sm">{inv.subjectName}</div>
                        <div className="text-[10px] text-muted-foreground capitalize">{inv.subjectType} · {inv.country}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {statusIcon[inv.status]}
                      <span className={`bis-badge ${getStatusBadgeClass(inv.status)}`}>{inv.status}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs capitalize text-muted-foreground">{inv.tier}</span>
                      <span className="text-[10px] font-mono text-muted-foreground/60">{tierPrice[inv.tier]}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 w-32">{riskBar(inv.riskScore)}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-muted-foreground">{formatDateTime(inv.updatedAt)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <ChevronRight size={14} className="text-muted-foreground" />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground text-sm">
                    No investigations match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <NewInvestigationSlideOver
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </BISLayout>
  );
}
