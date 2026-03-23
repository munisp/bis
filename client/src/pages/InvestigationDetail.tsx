// BIS Investigation Detail Page — Full view with timeline, risk breakdown, notes
import { useState } from "react";
import { useLocation, useParams } from "wouter";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ArrowLeft, User, Building2, AlertTriangle, CheckCircle2,
  Clock, Loader2, FileText, Download, RefreshCw, Trash2,
  Shield, Activity, Globe, CreditCard, Fingerprint, Search
} from "lucide-react";
import {
  mockInvestigations, mockAlerts, getStatusBadgeClass, formatDateTime, formatDate
} from "@/lib/mockData";

const moduleIcons: Record<string, React.ReactNode> = {
  identity: <Fingerprint size={13} />,
  criminal: <Shield size={13} />,
  financial: <CreditCard size={13} />,
  employment: <User size={13} />,
  sanctions: <AlertTriangle size={13} />,
  social_media: <Globe size={13} />,
  directors: <Building2 size={13} />,
};

const moduleLabels: Record<string, string> = {
  identity: "Identity Verification",
  criminal: "Criminal Records",
  financial: "Financial Health",
  employment: "Employment History",
  sanctions: "Sanctions & PEP",
  social_media: "Social Media Analysis",
  directors: "Director Bundle",
};

const moduleResults: Record<string, { status: "pass" | "fail" | "warn" | "pending"; detail: string; source: string }> = {
  identity: { status: "pass", detail: "NIN verified via NIMC. BVN cross-referenced. Photo match 97.8%.", source: "NIMC / CBN" },
  criminal: { status: "warn", detail: "NPF POSSAP: 1 record found (2019 fraud charge, acquitted). EFCC: No active watchlist entry.", source: "NPF / EFCC" },
  financial: { status: "warn", detail: "CRC credit score: 512/850. 2 delinquent accounts (2021). FIRS: Tax compliance verified.", source: "CRC / FIRS" },
  employment: { status: "pass", detail: "NYSC certificate verified. Last employer confirmed via phone. 3-year gap unexplained.", source: "NYSC / Manual" },
  sanctions: { status: "fail", detail: "OFAC SDN list match detected — 94% confidence. UN Consolidated list: No match.", source: "OFAC / UN" },
  social_media: { status: "warn", detail: "3 adverse media mentions in Punch (2024). LinkedIn profile consistent. No extremist associations.", source: "Social Monitor" },
  directors: { status: "pass", detail: "2 directors investigated. Both cleared. No cross-directorship with sanctioned entities.", source: "CAC / BIS" },
};

const timeline = [
  { time: "2026-03-10T08:00:00Z", event: "Investigation created", actor: "API", type: "info" },
  { time: "2026-03-10T08:01:00Z", event: "Identity module started — NIMC NIN lookup", actor: "AI Engine", type: "info" },
  { time: "2026-03-10T08:01:45Z", event: "Identity verified — NIN match confirmed", actor: "AI Engine", type: "success" },
  { time: "2026-03-10T08:02:00Z", event: "Criminal records module started — NPF POSSAP query", actor: "AI Engine", type: "info" },
  { time: "2026-03-10T08:03:12Z", event: "Criminal record found — 2019 fraud charge (acquitted)", actor: "AI Engine", type: "warning" },
  { time: "2026-03-10T08:04:00Z", event: "Sanctions module started — OFAC SDN list query", actor: "AI Engine", type: "info" },
  { time: "2026-03-10T08:04:08Z", event: "SANCTIONS HIT — OFAC SDN match at 94% confidence", actor: "AI Engine", type: "error" },
  { time: "2026-03-10T08:04:09Z", event: "Kill switch activated for subject", actor: "System", type: "error" },
  { time: "2026-03-10T08:04:10Z", event: "Alert dispatched to tenant webhook", actor: "System", type: "info" },
  { time: "2026-03-12T14:30:00Z", event: "Analyst note added: Confirmed sanctions match, escalated to compliance team", actor: "analyst@bis.io", type: "note" },
];

export default function InvestigationDetail() {
  const [, navigate] = useLocation();
  const params = useParams<{ id: string }>();
  const inv = mockInvestigations.find(i => i.id === params.id) ?? mockInvestigations[0];
  const relatedAlerts = mockAlerts.filter(a => a.subjectRef === inv.ref);
  const [note, setNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  const riskColor = inv.riskScore >= 80 ? "#f87171" : inv.riskScore >= 60 ? "#fb923c" : inv.riskScore >= 30 ? "#fbbf24" : "#34d399";

  const handleAddNote = async () => {
    if (!note.trim()) return;
    setAddingNote(true);
    await new Promise(r => setTimeout(r, 800));
    setAddingNote(false);
    setNote("");
    toast.success("Note added to investigation");
  };

  const handleDownloadReport = () => {
    toast.success("Report download started — PDF generating...");
  };

  const handleRerun = () => {
    toast.info("Investigation re-queued for processing");
  };

  return (
    <BISLayout
      title={inv.ref}
      subtitle={inv.subjectName}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleRerun}>
            <RefreshCw size={11} /> Re-run
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleDownloadReport}>
            <Download size={11} /> Report
          </Button>
        </div>
      }
    >
      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 mb-4 -ml-1" onClick={() => navigate("/investigations")}>
        <ArrowLeft size={12} /> Back to Investigations
      </Button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column — subject info + modules */}
        <div className="lg:col-span-2 space-y-4">
          {/* Subject card */}
          <div className="bis-card p-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                {inv.subjectType === "individual" ? <User size={20} className="text-primary" /> : <Building2 size={20} className="text-primary" />}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-bold text-foreground">{inv.subjectName}</h2>
                  <span className={`bis-badge ${getStatusBadgeClass(inv.status)}`}>{inv.status}</span>
                  {inv.tags.map(tag => (
                    <Badge key={tag} variant="outline" className="text-[10px] h-4 px-1.5 border-red-500/30 text-red-400">{tag}</Badge>
                  ))}
                </div>
                <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
                  <span className="capitalize">{inv.subjectType}</span>
                  <span>·</span>
                  <span className="font-mono">{inv.ref}</span>
                  <span>·</span>
                  <span className="capitalize">{inv.tier} tier</span>
                  <span>·</span>
                  <span>{inv.country}</span>
                </div>
                <div className="flex flex-wrap gap-4 mt-1 text-xs text-muted-foreground">
                  <span>Created: {formatDate(inv.createdAt)}</span>
                  <span>Updated: {formatDateTime(inv.updatedAt)}</span>
                  <span>Assigned: {inv.assignedTo}</span>
                </div>
              </div>
              {/* Risk score */}
              <div className="text-center shrink-0">
                <div className="text-3xl font-bold font-mono" style={{ color: riskColor }}>{inv.riskScore}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Risk Score</div>
                <div className="text-xs capitalize font-medium mt-0.5" style={{ color: riskColor }}>{inv.riskLevel}</div>
              </div>
            </div>
          </div>

          {/* Module results */}
          <div className="bis-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Activity size={14} className="text-primary" /> Investigation Modules
            </h3>
            <div className="space-y-2">
              {inv.dataSources.length === 0 ? (
                <p className="text-sm text-muted-foreground">No modules run yet — investigation is pending.</p>
              ) : (
                inv.dataSources.map((mod: string) => {
                  const result = moduleResults[mod] ?? { status: "pass", detail: "Module completed.", source: "BIS" };
                  const statusColor = result.status === "pass" ? "text-emerald-400" : result.status === "fail" ? "text-red-400" : result.status === "warn" ? "text-amber-400" : "text-muted-foreground";
                  const statusIcon = result.status === "pass" ? <CheckCircle2 size={12} /> : result.status === "fail" ? <AlertTriangle size={12} /> : result.status === "warn" ? <AlertTriangle size={12} /> : <Clock size={12} />;
                  return (
                    <div key={mod} className="flex items-start gap-3 p-3 rounded-lg bg-muted/20 border border-border/50">
                      <div className={`mt-0.5 ${statusColor}`}>{moduleIcons[mod] ?? <Search size={13} />}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{moduleLabels[mod] ?? mod}</span>
                          <span className={`text-[10px] font-mono ${statusColor}`}>{result.source}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{result.detail}</p>
                      </div>
                      <div className={`shrink-0 ${statusColor}`}>{statusIcon}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Alerts */}
          {relatedAlerts.length > 0 && (
            <div className="bis-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <AlertTriangle size={14} className="text-red-400" /> Active Alerts ({relatedAlerts.length})
              </h3>
              <div className="space-y-2">
                {relatedAlerts.map(alert => (
                  <div key={alert.id} className="flex items-start gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                    <AlertTriangle size={13} className="text-red-400 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-red-400 uppercase">{alert.alertType.replace("_", " ")}</span>
                        <span className="text-[10px] text-muted-foreground">{alert.source}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{alert.summary}</p>
                    </div>
                    <span className={`bis-badge ${getStatusBadgeClass(alert.status)} shrink-0`}>{alert.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add note */}
          <div className="bis-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <FileText size={14} className="text-primary" /> Add Note
            </h3>
            <Textarea
              placeholder="Add analyst notes, context, or follow-up actions..."
              rows={3} value={note} onChange={e => setNote(e.target.value)}
              className="text-sm resize-none"
            />
            <div className="flex justify-end mt-2">
              <Button size="sm" className="h-7 text-xs" onClick={handleAddNote} disabled={addingNote || !note.trim()}>
                {addingNote ? <><Loader2 size={11} className="animate-spin mr-1" />Saving...</> : "Add Note"}
              </Button>
            </div>
          </div>
        </div>

        {/* Right column — timeline */}
        <div className="space-y-4">
          <div className="bis-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Clock size={14} className="text-primary" /> Timeline
            </h3>
            <div className="space-y-3">
              {timeline.map((event, i) => {
                const color = event.type === "error" ? "text-red-400 bg-red-500/10 border-red-500/20"
                  : event.type === "warning" ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
                  : event.type === "success" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                  : event.type === "note" ? "text-blue-400 bg-blue-500/10 border-blue-500/20"
                  : "text-muted-foreground bg-muted/20 border-border/50";
                return (
                  <div key={i} className={`p-2.5 rounded-lg border text-xs ${color}`}>
                    <div className="font-medium">{event.event}</div>
                    <div className="flex items-center gap-2 mt-1 opacity-70">
                      <span>{event.actor}</span>
                      <span>·</span>
                      <span className="font-mono">{formatDateTime(event.time)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Data sources used */}
          <div className="bis-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Globe size={14} className="text-primary" /> Data Sources
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {inv.dataSources.length > 0 ? inv.dataSources.map(src => (
                <Badge key={src} variant="outline" className="text-[10px] h-5 px-2 font-mono">{src}</Badge>
              )) : <span className="text-xs text-muted-foreground">None yet</span>}
            </div>
          </div>
        </div>
      </div>
    </BISLayout>
  );
}
