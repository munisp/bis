import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Clock, FileText, AlertTriangle, CheckCircle2, Users } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  open: "bg-blue-100 text-blue-700",
  under_review: "bg-amber-100 text-amber-700",
  pending_decision: "bg-orange-100 text-orange-700",
  closed: "bg-green-100 text-green-700",
  archived: "bg-slate-100 text-slate-500",
};

export default function StakeholderPortalPage() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token"));
  }, []);

  const { data, isLoading, error } = trpc.cases.portalAccess.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 pb-8 text-center">
            <AlertTriangle className="w-12 h-12 text-orange-500 mx-auto mb-3" />
            <h2 className="text-xl font-bold">Invalid Access Link</h2>
            <p className="text-muted-foreground mt-2">This portal link is missing a required access token. Please use the link provided in your invitation email.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-muted-foreground">Verifying access...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 pb-8 text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-3" />
            <h2 className="text-xl font-bold">Access Denied</h2>
            <p className="text-muted-foreground mt-2">
              {error?.message === "Access token expired"
                ? "Your access link has expired. Please contact the case lead to request a new link."
                : "This access link is invalid or has been revoked."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { case: c, stakeholder, timeline, documents } = data;

  return (
    <div className="min-h-screen bg-muted/20">
      {/* Header */}
      <div className="bg-background border-b">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Secure Stakeholder Portal</p>
              <p className="font-semibold text-sm">BIS Compliance Platform</p>
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>Viewing as: <span className="font-medium text-foreground">{stakeholder.name}</span></p>
            <p className="capitalize">{stakeholder.role?.replace(/_/g, " ")}</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Case Summary */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-mono text-muted-foreground">{c.ref}</p>
                <CardTitle className="text-xl mt-1">{c.title}</CardTitle>
              </div>
              <Badge className={`text-xs ${STATUS_COLORS[c.status] ?? ""}`}>
                {c.status?.replace("_", " ")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {c.summary && <p className="text-muted-foreground text-sm mb-4">{c.summary}</p>}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              {[
                { label: "Type", value: c.type?.replace("_", " ") },
                { label: "Priority", value: c.priority },
                { label: "Jurisdiction", value: c.jurisdiction || "—" },
                { label: "Legal Basis", value: c.legalBasis || "—" },
                { label: "Created", value: new Date(c.createdAt).toLocaleDateString() },
                { label: "Due", value: c.dueAt ? new Date(c.dueAt).toLocaleDateString() : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="bg-muted/40 rounded p-2">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="font-medium capitalize">{value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Timeline */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" /> Case Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative border-l-2 border-border ml-3 space-y-4">
              {timeline.map((event: any) => (
                <div key={event.id} className="relative pl-5">
                  <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-background border-2 border-primary" />
                  <div className="bg-muted/40 rounded p-3">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-sm">{event.title}</p>
                      <span className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</span>
                    </div>
                    {event.actorName && (
                      <p className="text-xs text-muted-foreground mt-0.5">by {event.actorName}</p>
                    )}
                  </div>
                </div>
              ))}
              {timeline.length === 0 && (
                <p className="pl-5 text-sm text-muted-foreground">No timeline events yet.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Documents */}
        {stakeholder.canViewDocuments && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4" /> Shared Documents
              </CardTitle>
            </CardHeader>
            <CardContent>
              {documents.length > 0 ? (
                <div className="space-y-2">
                  {documents.map((doc: any) => (
                    <div key={doc.id} className="flex items-center justify-between p-3 bg-muted/40 rounded">
                      <div>
                        <p className="font-medium text-sm">{doc.filename}</p>
                        <p className="text-xs text-muted-foreground">{doc.category} · {new Date(doc.createdAt).toLocaleDateString()}</p>
                      </div>
                      <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                        View
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No documents shared yet.</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground pb-4">
          This is a secure, read-only view of case {c.ref}. Your access expires on {stakeholder.accessExpiresAt ? new Date(stakeholder.accessExpiresAt).toLocaleDateString() : "—"}.
          All access is logged and audited.
        </p>
      </div>
    </div>
  );
}
