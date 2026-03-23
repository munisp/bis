// BIS Reports Page — Generate, view, and download investigation reports
import { useState } from "react";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  FileText, Download, Search, Plus, Eye, Loader2,
  CheckCircle2, Clock, AlertTriangle, BarChart3, Filter
} from "lucide-react";
import { mockInvestigations, formatDate, formatDateTime } from "@/lib/mockData";

type ReportFormat = "pdf" | "json" | "csv";
type ReportStatus = "ready" | "generating" | "failed";

interface Report {
  id: string;
  title: string;
  type: "investigation" | "bulk" | "analytics" | "compliance";
  format: ReportFormat;
  status: ReportStatus;
  size: string;
  createdAt: string;
  investigationRef?: string;
}

const mockReports: Report[] = [
  { id: "r1", title: "Adebayo Okafor — Comprehensive Report", type: "investigation", format: "pdf", status: "ready", size: "2.4 MB", createdAt: "2026-03-12T14:30:00Z", investigationRef: "BIS-2026-0001" },
  { id: "r2", title: "Emeka Nwosu — Flagged Subject Report", type: "investigation", format: "pdf", status: "ready", size: "3.1 MB", createdAt: "2026-03-20T09:00:00Z", investigationRef: "BIS-2026-0004" },
  { id: "r3", title: "Greenfield Agro Ltd — Corporate Due Diligence", type: "investigation", format: "pdf", status: "ready", size: "4.7 MB", createdAt: "2026-03-16T17:00:00Z", investigationRef: "BIS-2026-0007" },
  { id: "r4", title: "March 2026 — Compliance Summary", type: "compliance", format: "pdf", status: "ready", size: "1.2 MB", createdAt: "2026-03-22T08:00:00Z" },
  { id: "r5", title: "Q1 2026 — Investigation Analytics", type: "analytics", format: "pdf", status: "ready", size: "5.8 MB", createdAt: "2026-03-01T00:00:00Z" },
  { id: "r6", title: "Bulk Export — All March Investigations", type: "bulk", format: "csv", status: "ready", size: "128 KB", createdAt: "2026-03-23T10:00:00Z" },
];

const typeIcon: Record<string, React.ReactNode> = {
  investigation: <FileText size={12} />,
  bulk: <BarChart3 size={12} />,
  analytics: <BarChart3 size={12} />,
  compliance: <CheckCircle2 size={12} />,
};

const typeColor: Record<string, string> = {
  investigation: "text-blue-400",
  bulk: "text-purple-400",
  analytics: "text-emerald-400",
  compliance: "text-amber-400",
};

export default function Reports() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [reports, setReports] = useState<Report[]>(mockReports);
  const [generating, setGenerating] = useState(false);
  const [genInv, setGenInv] = useState("");
  const [genFormat, setGenFormat] = useState<ReportFormat>("pdf");

  const filtered = reports.filter(r => {
    const matchSearch = r.title.toLowerCase().includes(search.toLowerCase()) ||
      (r.investigationRef ?? "").toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === "all" || r.type === typeFilter;
    return matchSearch && matchType;
  });

  const handleGenerate = async () => {
    if (!genInv) { toast.error("Select an investigation first"); return; }
    setGenerating(true);
    const inv = mockInvestigations.find(i => i.id === genInv);
    const newReport: Report = {
      id: `r${Date.now()}`,
      title: `${inv?.subjectName ?? "Unknown"} — Generated Report`,
      type: "investigation",
      format: genFormat,
      status: "generating",
      size: "—",
      createdAt: new Date().toISOString(),
      investigationRef: inv?.ref,
    };
    setReports(prev => [newReport, ...prev]);
    await new Promise(r => setTimeout(r, 2000));
    setReports(prev => prev.map(r => r.id === newReport.id ? { ...r, status: "ready", size: "2.1 MB" } : r));
    setGenerating(false);
    toast.success("Report generated successfully");
  };

  return (
    <BISLayout
      title="Reports"
      subtitle={`${filtered.length} reports`}
      actions={
        <div className="flex items-center gap-2">
          <Select value={genInv} onValueChange={setGenInv}>
            <SelectTrigger className="h-7 w-48 text-xs"><SelectValue placeholder="Select investigation..." /></SelectTrigger>
            <SelectContent>
              {mockInvestigations.filter(i => i.status === "completed" || i.status === "flagged").map(inv => (
                <SelectItem key={inv.id} value={inv.id}>{inv.ref} — {inv.subjectName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={genFormat} onValueChange={v => setGenFormat(v as ReportFormat)}>
            <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pdf">PDF</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
              <SelectItem value="csv">CSV</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" className="h-7 text-xs gap-1" onClick={handleGenerate} disabled={generating}>
            {generating ? <><Loader2 size={11} className="animate-spin" />Generating...</> : <><Plus size={11} />Generate</>}
          </Button>
        </div>
      }
    >
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: "Total Reports", value: reports.length, icon: <FileText size={14} /> },
          { label: "Ready", value: reports.filter(r => r.status === "ready").length, icon: <CheckCircle2 size={14} className="text-emerald-400" /> },
          { label: "Investigation", value: reports.filter(r => r.type === "investigation").length, icon: <FileText size={14} className="text-blue-400" /> },
          { label: "Analytics", value: reports.filter(r => r.type === "analytics").length, icon: <BarChart3 size={14} className="text-purple-400" /> },
        ].map(stat => (
          <div key={stat.label} className="bis-card p-3 flex items-center gap-3">
            <div className="text-muted-foreground">{stat.icon}</div>
            <div>
              <div className="text-lg font-bold font-mono text-foreground">{stat.value}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8 h-8 text-sm" placeholder="Search reports..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-36 text-xs"><Filter size={11} className="mr-1" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="investigation">Investigation</SelectItem>
            <SelectItem value="bulk">Bulk Export</SelectItem>
            <SelectItem value="analytics">Analytics</SelectItem>
            <SelectItem value="compliance">Compliance</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Reports list */}
      <div className="bis-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Report</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Format</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Size</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Created</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(report => (
                <tr key={report.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div>
                      <div className="font-medium text-foreground text-sm">{report.title}</div>
                      {report.investigationRef && (
                        <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{report.investigationRef}</div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className={`flex items-center gap-1.5 text-xs capitalize ${typeColor[report.type]}`}>
                      {typeIcon[report.type]} {report.type}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-mono uppercase">{report.format}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-muted-foreground">{report.size}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-muted-foreground">{formatDateTime(report.createdAt)}</span>
                  </td>
                  <td className="px-4 py-3">
                    {report.status === "ready" ? (
                      <span className="bis-badge bis-badge-success">Ready</span>
                    ) : report.status === "generating" ? (
                      <span className="flex items-center gap-1 text-[10px] text-blue-400"><Loader2 size={10} className="animate-spin" />Generating</span>
                    ) : (
                      <span className="bis-badge bis-badge-danger">Failed</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toast.info("Opening report preview...")}>
                        <Eye size={12} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" disabled={report.status !== "ready"}
                        onClick={() => toast.success(`Downloading ${report.title}...`)}>
                        <Download size={12} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground text-sm">No reports found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </BISLayout>
  );
}
