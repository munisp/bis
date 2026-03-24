import { useState, useRef } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import BISLayout from "@/components/BISLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { ArrowLeft, Building2, Palette, FileText, Upload, Save, Eye } from "lucide-react";
import { Link } from "wouter";

export default function TenantBrandingPage() {
  const params = useParams<{ id: string }>();
  const tenantId = Number(params.id);

  const utils = trpc.useUtils();
  const { data: tenant, isLoading } = trpc.tenants.get.useQuery({ id: tenantId });

  const [primaryColor, setPrimaryColor] = useState<string>("");
  const [reportFooter, setReportFooter] = useState<string>("");
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoDataUri, setLogoDataUri] = useState<string | null>(null);
  const [logoMime, setLogoMime] = useState<"image/png" | "image/jpeg" | "image/webp" | "image/svg+xml">("image/png");
  const [previewMode, setPreviewMode] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Initialise local state from fetched tenant once
  const [initialised, setInitialised] = useState(false);
  if (tenant && !initialised) {
    setPrimaryColor(tenant.primaryColor ?? "#1a56db");
    setReportFooter(tenant.reportFooter ?? "");
    setLogoPreview(tenant.logoUrl ?? null);
    setInitialised(true);
  }

  const updateBrandingMutation = trpc.tenants.updateBranding.useMutation({
    onSuccess: () => {
      utils.tenants.get.invalidate({ id: tenantId });
      utils.tenants.list.invalidate();
      toast.success("Branding settings saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateLogoMutation = trpc.tenants.updateLogo.useMutation({
    onSuccess: (data) => {
      setLogoPreview(data.logoUrl);
      utils.tenants.get.invalidate({ id: tenantId });
      utils.tenants.list.invalidate();
      toast.success("Logo uploaded successfully");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUri = ev.target?.result as string;
      setLogoDataUri(dataUri);
      setLogoPreview(dataUri);
      setLogoMime(file.type as any);
    };
    reader.readAsDataURL(file);
  };

  const handleUploadLogo = () => {
    if (!logoDataUri) return;
    updateLogoMutation.mutate({ id: tenantId, dataUri: logoDataUri, mimeType: logoMime });
  };

  const handleSaveBranding = () => {
    updateBrandingMutation.mutate({
      id: tenantId,
      primaryColor: primaryColor || undefined,
      reportFooter: reportFooter || undefined,
    });
  };

  if (isLoading) {
    return (
      <BISLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-sm text-muted-foreground animate-pulse">Loading tenant…</div>
        </div>
      </BISLayout>
    );
  }

  if (!tenant) {
    return (
      <BISLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-sm text-muted-foreground">Tenant not found.</div>
        </div>
      </BISLayout>
    );
  }

  return (
    <BISLayout>
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/tenants">
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground">
              <ArrowLeft size={14} /> Tenants
            </Button>
          </Link>
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-2">
            {logoPreview ? (
              <img src={logoPreview} alt="logo" className="w-7 h-7 rounded object-contain bg-muted" />
            ) : (
              <Building2 size={18} className="text-muted-foreground" />
            )}
            <div>
              <h1 className="text-base font-semibold text-foreground leading-tight">{tenant.name}</h1>
              <p className="text-xs text-muted-foreground">Branding Settings</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setPreviewMode(!previewMode)}
            >
              <Eye size={13} /> {previewMode ? "Edit" : "Preview"}
            </Button>
          </div>
        </div>

        {previewMode ? (
          /* ── PDF Preview Mock ── */
          <Card className="border-2 border-dashed border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">PDF Report Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="rounded-lg border border-border bg-white text-gray-900 p-6 space-y-4 font-mono text-xs shadow-sm"
                style={{ fontFamily: "Georgia, serif" }}
              >
                {/* Classification banner */}
                <div
                  className="text-center font-bold text-white py-1 rounded text-[11px] tracking-widest uppercase"
                  style={{ backgroundColor: primaryColor || "#1a56db" }}
                >
                  CONFIDENTIAL — RESTRICTED
                </div>
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-200 pb-3">
                  <div className="flex items-center gap-3">
                    {logoPreview ? (
                      <img src={logoPreview} alt="logo" className="w-10 h-10 rounded object-contain" />
                    ) : (
                      <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center text-gray-400 text-xs">LOGO</div>
                    )}
                    <div>
                      <div className="font-bold text-sm text-gray-900">{tenant.name}</div>
                      <div className="text-[10px] text-gray-500">Background Intelligence System</div>
                    </div>
                  </div>
                  <div className="text-right text-[10px] text-gray-500">
                    <div>Investigation Report</div>
                    <div>Generated: {new Date().toLocaleDateString()}</div>
                  </div>
                </div>
                {/* Body placeholder */}
                <div className="space-y-2">
                  <div className="h-3 bg-gray-100 rounded w-3/4" />
                  <div className="h-3 bg-gray-100 rounded w-full" />
                  <div className="h-3 bg-gray-100 rounded w-2/3" />
                  <div className="h-3 bg-gray-100 rounded w-full" />
                  <div className="h-3 bg-gray-100 rounded w-5/6" />
                </div>
                {/* Footer */}
                <div
                  className="border-t border-gray-200 pt-2 text-[10px] text-center text-gray-500"
                >
                  {reportFooter || `${tenant.name} · Confidential · Do not distribute without authorization`}
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-5">
            {/* Logo Section */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Upload size={14} className="text-blue-400" /> Organisation Logo
                </CardTitle>
                <CardDescription className="text-xs">
                  Appears in PDF report headers. Recommended: 200×200 px PNG or SVG.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-lg border border-border bg-muted flex items-center justify-center overflow-hidden shrink-0">
                    {logoPreview ? (
                      <img src={logoPreview} alt="logo preview" className="w-full h-full object-contain" />
                    ) : (
                      <Building2 size={24} className="text-muted-foreground" />
                    )}
                  </div>
                  <div className="space-y-2 flex-1">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={() => fileRef.current?.click()}
                    >
                      <Upload size={12} /> Choose file
                    </Button>
                    {logoDataUri && (
                      <Button
                        size="sm"
                        className="gap-1.5 text-xs ml-2"
                        onClick={handleUploadLogo}
                        disabled={updateLogoMutation.isPending}
                      >
                        {updateLogoMutation.isPending ? "Uploading…" : "Upload Logo"}
                      </Button>
                    )}
                    <p className="text-[10px] text-muted-foreground">PNG, JPEG, WebP, or SVG · Max 5 MB</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Colour Section */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Palette size={14} className="text-violet-400" /> Brand Colour
                </CardTitle>
                <CardDescription className="text-xs">
                  Used for the classification banner and accent elements in PDF reports.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={primaryColor || "#1a56db"}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-10 h-10 rounded border border-border cursor-pointer bg-transparent p-0.5"
                  />
                  <Input
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    placeholder="#1a56db"
                    className="font-mono text-sm w-36"
                    maxLength={7}
                  />
                  <div
                    className="flex-1 h-8 rounded border border-border text-center text-[10px] font-bold text-white flex items-center justify-center tracking-widest uppercase"
                    style={{ backgroundColor: primaryColor || "#1a56db" }}
                  >
                    CONFIDENTIAL
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Report Footer Section */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText size={14} className="text-emerald-400" /> Report Footer Text
                </CardTitle>
                <CardDescription className="text-xs">
                  Appears at the bottom of every generated PDF report. Max 500 characters.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={reportFooter}
                  onChange={(e) => setReportFooter(e.target.value)}
                  placeholder={`${tenant.name} · Confidential · Do not distribute without authorization`}
                  className="text-sm resize-none"
                  rows={3}
                  maxLength={500}
                />
                <p className="text-[10px] text-muted-foreground mt-1">{reportFooter.length}/500 characters</p>
              </CardContent>
            </Card>

            {/* Save Button */}
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => {
                  setPrimaryColor(tenant.primaryColor ?? "#1a56db");
                  setReportFooter(tenant.reportFooter ?? "");
                  setLogoPreview(tenant.logoUrl ?? null);
                  setLogoDataUri(null);
                  toast.info("Changes discarded");
                }}
              >
                Discard
              </Button>
              <Button
                size="sm"
                className="gap-1.5 text-xs"
                onClick={handleSaveBranding}
                disabled={updateBrandingMutation.isPending}
              >
                <Save size={12} />
                {updateBrandingMutation.isPending ? "Saving…" : "Save Branding"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </BISLayout>
  );
}
