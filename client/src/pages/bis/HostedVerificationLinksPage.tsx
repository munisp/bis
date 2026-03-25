import { useState } from "react";
import { trpc } from "@/lib/trpc";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Link2, Copy, ExternalLink, XCircle, Clock, CheckCircle2, AlertCircle } from "lucide-react";

const CHECK_OPTIONS = [
  { id: "nin",      label: "NIN Verification" },
  { id: "bvn",      label: "BVN Verification" },
  { id: "selfie",   label: "Selfie / Liveness" },
  { id: "document", label: "Document OCR" },
  { id: "address",  label: "Address Confirmation" },
  { id: "phone",    label: "Phone Verification" },
];

const STATUS_CONFIG = {
  active:    { label: "Active",    color: "bg-green-100 text-green-800",  icon: CheckCircle2 },
  completed: { label: "Completed", color: "bg-blue-100 text-blue-800",    icon: CheckCircle2 },
  expired:   { label: "Expired",   color: "bg-gray-100 text-gray-600",    icon: Clock },
  revoked:   { label: "Revoked",   color: "bg-red-100 text-red-800",      icon: XCircle },
};

export default function HostedVerificationLinksPage() {
  const [form, setForm] = useState({
    subjectName: "",
    investigationRef: "",
    requiredChecks: ["nin", "selfie"] as string[],
    expiryHours: 48,
  });
  const [generatedLink, setGeneratedLink] = useState<{ url: string; token: string } | null>(null);

  const { data: links = [], refetch } = trpc.hostedLinks.list.useQuery();

  const create = trpc.hostedLinks.create.useMutation({
    onSuccess: (data) => {
      setGeneratedLink({ url: data.url, token: data.token });
      refetch();
      toast.success("Verification link created successfully.");
    },
    onError: (e) => toast.error(`Failed: ${e.message}`),
  });

  const revoke = trpc.hostedLinks.revoke.useMutation({
    onSuccess: () => { refetch(); toast.success("Link revoked."); },
    onError: (e) => toast.error(`Failed: ${e.message}`),
  });

  const toggleCheck = (id: string) => {
    setForm(f => ({
      ...f,
      requiredChecks: f.requiredChecks.includes(id)
        ? f.requiredChecks.filter(c => c !== id)
        : [...f.requiredChecks, id],
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.requiredChecks.length === 0) { toast.error("Select at least one check"); return; }
    create.mutate({
      subjectName: form.subjectName || undefined,
      investigationRef: form.investigationRef || undefined,
      requiredChecks: form.requiredChecks as any,
      expiryHours: form.expiryHours,
    });
  };

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  };

  return (
    <BISLayout>
      <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
            <Link2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Hosted Verification Links</h1>
            <p className="text-sm text-muted-foreground">Generate no-code links for subjects to self-complete KYC verification</p>
          </div>
        </div>

        {/* Generator */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="font-semibold text-foreground mb-4">Generate New Link</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Subject Name (optional)</label>
                <Input
                  value={form.subjectName}
                  onChange={e => setForm(f => ({ ...f, subjectName: e.target.value }))}
                  placeholder="Pre-fill subject name"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Investigation Ref (optional)</label>
                <Input
                  value={form.investigationRef}
                  onChange={e => setForm(f => ({ ...f, investigationRef: e.target.value }))}
                  placeholder="e.g. BIS-2024-0042"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Link Expiry</label>
                <select
                  value={form.expiryHours}
                  onChange={e => setForm(f => ({ ...f, expiryHours: Number(e.target.value) }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value={24}>24 hours</option>
                  <option value={48}>48 hours</option>
                  <option value={72}>72 hours</option>
                  <option value={168}>7 days</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 block">Required Checks</label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {CHECK_OPTIONS.map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => toggleCheck(opt.id)}
                    className={`text-left px-3 py-2 rounded-lg border-2 text-sm transition-all ${
                      form.requiredChecks.includes(opt.id)
                        ? "border-indigo-500 bg-indigo-50 text-indigo-700 font-medium"
                        : "border-border text-muted-foreground hover:border-border/80"
                    }`}
                  >
                    {form.requiredChecks.includes(opt.id) && <span className="mr-1">✓</span>}
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <Button type="submit" disabled={create.isPending} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              {create.isPending ? "Generating…" : "Generate Verification Link"}
            </Button>
          </form>
        </div>

        {/* Generated link result */}
        {generatedLink && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-indigo-600" />
              <h3 className="font-semibold text-indigo-800">Verification Link Ready</h3>
            </div>
            <p className="text-xs text-indigo-600 mb-3">
              Share this link with the subject. It will guide them through the selected verification steps without requiring any technical knowledge.
            </p>
            <div className="flex items-center gap-2 bg-white rounded-lg border border-indigo-200 px-3 py-2">
              <span className="text-xs text-indigo-700 flex-1 truncate font-mono">{generatedLink.url}</span>
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0 h-7 text-indigo-600 hover:text-indigo-800"
                onClick={() => copyLink(generatedLink.url)}
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0 h-7 text-indigo-600 hover:text-indigo-800"
                onClick={() => window.open(generatedLink.url, "_blank")}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Links table */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/50">
            <h3 className="font-semibold text-sm text-foreground">Your Verification Links</h3>
          </div>
          {links.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No links generated yet</div>
          ) : (
            <div className="divide-y divide-border">
              {links.map(link => {
                const cfg = STATUS_CONFIG[link.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.active;
                const isExpired = new Date(link.expiresAt) < new Date();
                const checks: string[] = link.requiredChecks ? JSON.parse(link.requiredChecks) : [];
                return (
                  <div key={link.id} className="flex items-center gap-4 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {link.subjectName ?? "Unnamed subject"}
                        {link.investigationRef && (
                          <span className="ml-2 text-xs text-muted-foreground font-normal">({link.investigationRef})</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {checks.join(", ")} · Expires {new Date(link.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${isExpired && link.status === "active" ? "bg-gray-100 text-gray-600" : cfg.color}`}>
                      {isExpired && link.status === "active" ? "Expired" : cfg.label}
                    </span>
                    {link.status === "active" && !isExpired && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => copyLink(`${window.location.origin}/verify/${link.token}`)}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                          onClick={() => revoke.mutate({ id: link.id })}
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </BISLayout>
  );
}
