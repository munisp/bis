/**
 * StakeholderPortalLandingPage.tsx
 *
 * Public-facing landing page for the BIS Stakeholder Portal.
 * Presents the platform's value proposition and a "Request Access" form
 * that submits to trpc.onboarding.create (requires auth — redirects to login
 * if the user is not authenticated, then returns here after login).
 *
 * Route: /stakeholder-portal  (public, no auth required to view)
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Shield,
  Search,
  FileText,
  Globe,
  Lock,
  Zap,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Building2,
  Users,
  BarChart3,
  ChevronRight,
  Star,
} from "lucide-react";
import { toast } from "sonner";

// ─── Feature highlights ───────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: Shield,
    title: "Financial Crime Detection",
    description:
      "AI-powered transaction monitoring and suspicious activity detection aligned with FATF standards and NFIU reporting requirements.",
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  {
    icon: Search,
    title: "KYC / KYB Verification",
    description:
      "Instant identity and business verification using Nigerian CAC data, BVN, NIN, and pan-African data sources through Smile ID integration.",
    color: "text-emerald-600",
    bg: "bg-emerald-50",
  },
  {
    icon: FileText,
    title: "goAML STR Reporting",
    description:
      "Guided Suspicious Transaction Report wizard with auto-population from investigation data and direct submission to the NFIU goAML portal.",
    color: "text-purple-600",
    bg: "bg-purple-50",
  },
  {
    icon: Globe,
    title: "Pan-Africa Coverage",
    description:
      "Compliance and intelligence coverage across 54 African countries with localised data sources, regulatory frameworks, and multi-currency support.",
    color: "text-orange-600",
    bg: "bg-orange-50",
  },
  {
    icon: Lock,
    title: "Zero-Footprint Mode",
    description:
      "Ephemeral investigation sessions with no persistent data storage — ideal for sensitive enquiries requiring full deniability and audit isolation.",
    color: "text-red-600",
    bg: "bg-red-50",
  },
  {
    icon: Zap,
    title: "Field Agent Dispatch",
    description:
      "Real-time field agent management with GPS tracking, encrypted playbooks, and offline-capable mobile app for low-connectivity environments.",
    color: "text-amber-600",
    bg: "bg-amber-50",
  },
];

// ─── Pricing tiers ────────────────────────────────────────────────────────────

const TIERS = [
  {
    name: "Starter",
    price: "₦150,000",
    period: "/month",
    description: "For compliance teams and boutique investigation firms.",
    features: [
      "Up to 3 analysts",
      "500 KYC checks/month",
      "Basic case management",
      "goAML STR wizard",
      "Email support",
    ],
    cta: "Request Starter Access",
    highlight: false,
  },
  {
    name: "Professional",
    price: "₦450,000",
    period: "/month",
    description: "For banks, fintechs, and mid-size compliance departments.",
    features: [
      "Up to 15 analysts",
      "5,000 KYC checks/month",
      "Full case management + LEX",
      "AI risk scoring & adverse media",
      "Field agent dispatch",
      "Priority support + SLA",
    ],
    cta: "Request Professional Access",
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "For central banks, regulators, and large financial groups.",
    features: [
      "Unlimited analysts",
      "Unlimited KYC checks",
      "Multi-tenant management",
      "Custom integrations & APIs",
      "Dedicated account manager",
      "On-premise deployment option",
    ],
    cta: "Contact Sales",
    highlight: false,
  },
];

// ─── Testimonials ─────────────────────────────────────────────────────────────

const TESTIMONIALS = [
  {
    quote:
      "BIS cut our STR preparation time from 3 days to 4 hours. The goAML wizard alone justifies the subscription.",
    author: "Head of Compliance",
    org: "Tier-1 Nigerian Commercial Bank",
  },
  {
    quote:
      "The offline LEX intake for our field officers in rural areas has been a game-changer. Submissions sync automatically when connectivity returns.",
    author: "Director of Intelligence",
    org: "State Security Service",
  },
  {
    quote:
      "Pan-Africa KYC coverage with a single API call. We've reduced onboarding fraud by 67% since deploying BIS.",
    author: "Chief Risk Officer",
    org: "Pan-African Fintech",
  },
];

// ─── Request Access Form ──────────────────────────────────────────────────────

interface RequestAccessFormProps {
  onSuccess: (referenceId: string) => void;
}

function RequestAccessForm({ onSuccess }: RequestAccessFormProps) {
  const { isAuthenticated } = useAuth();

  const [form, setForm] = useState({
    entityType: "",
    legalName: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    contactTitle: "",
    businessCategory: "",
    useCase: "",
    countryCode: "NG",
    agreedToTerms: false,
    pepDeclaration: false,
  });

  const createMutation = trpc.onboarding.create.useMutation({
    onSuccess: (data) => {
      onSuccess(data.referenceId);
    },
    onError: (err) => {
      toast.error(`Submission failed: ${err.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!isAuthenticated) {
      // Redirect to login; after auth the user returns to this page
      window.location.href = getLoginUrl();
      return;
    }

    if (!form.entityType || !form.legalName || !form.contactName || !form.contactEmail) {
      toast.error("Please fill in all required fields.");
      return;
    }

    if (!form.agreedToTerms) {
      toast.error("You must agree to the Terms of Service to proceed.");
      return;
    }

    createMutation.mutate({
      entityType: form.entityType,
      legalName: form.legalName,
      contactName: form.contactName,
      contactEmail: form.contactEmail,
      contactPhone: form.contactPhone || undefined,
      contactTitle: form.contactTitle || undefined,
      businessCategory: form.businessCategory || undefined,
      useCase: form.useCase || undefined,
      countryCode: form.countryCode,
      agreedToTerms: form.agreedToTerms,
      pepDeclaration: form.pepDeclaration,
    });
  };

  const set = (field: string, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Entity type */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="entityType">
            Organisation Type <span className="text-red-500">*</span>
          </Label>
          <Select value={form.entityType} onValueChange={(v) => set("entityType", v)}>
            <SelectTrigger id="entityType">
              <SelectValue placeholder="Select type…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bank">Commercial Bank</SelectItem>
              <SelectItem value="fintech">Fintech / Payment Service Provider</SelectItem>
              <SelectItem value="insurance">Insurance Company</SelectItem>
              <SelectItem value="microfinance">Microfinance Institution</SelectItem>
              <SelectItem value="regulator">Regulatory Authority</SelectItem>
              <SelectItem value="law_enforcement">Law Enforcement Agency</SelectItem>
              <SelectItem value="investment_firm">Investment Firm / Asset Manager</SelectItem>
              <SelectItem value="ngo">NGO / Non-Profit</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="businessCategory">Industry / Sector</Label>
          <Input
            id="businessCategory"
            placeholder="e.g. Financial Services"
            value={form.businessCategory}
            onChange={(e) => set("businessCategory", e.target.value)}
          />
        </div>
      </div>

      {/* Legal name */}
      <div className="space-y-1.5">
        <Label htmlFor="legalName">
          Legal Name of Organisation <span className="text-red-500">*</span>
        </Label>
        <Input
          id="legalName"
          placeholder="Registered legal name"
          value={form.legalName}
          onChange={(e) => set("legalName", e.target.value)}
        />
      </div>

      {/* Contact details */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="contactName">
            Contact Name <span className="text-red-500">*</span>
          </Label>
          <Input
            id="contactName"
            placeholder="Full name"
            value={form.contactName}
            onChange={(e) => set("contactName", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contactTitle">Job Title</Label>
          <Input
            id="contactTitle"
            placeholder="e.g. Chief Compliance Officer"
            value={form.contactTitle}
            onChange={(e) => set("contactTitle", e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="contactEmail">
            Work Email <span className="text-red-500">*</span>
          </Label>
          <Input
            id="contactEmail"
            type="email"
            placeholder="you@organisation.com"
            value={form.contactEmail}
            onChange={(e) => set("contactEmail", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contactPhone">Phone Number</Label>
          <Input
            id="contactPhone"
            placeholder="+234 800 000 0000"
            value={form.contactPhone}
            onChange={(e) => set("contactPhone", e.target.value)}
          />
        </div>
      </div>

      {/* Use case */}
      <div className="space-y-1.5">
        <Label htmlFor="useCase">Primary Use Case</Label>
        <Textarea
          id="useCase"
          placeholder="Describe how you intend to use the BIS platform (e.g. AML transaction monitoring, KYC onboarding, STR filing, field investigations)…"
          rows={3}
          value={form.useCase}
          onChange={(e) => set("useCase", e.target.value)}
        />
      </div>

      {/* Declarations */}
      <div className="space-y-3 rounded-lg border border-border p-4 bg-muted/30">
        <div className="flex items-start gap-3">
          <Checkbox
            id="pepDeclaration"
            checked={form.pepDeclaration}
            onCheckedChange={(v) => set("pepDeclaration", Boolean(v))}
            className="mt-0.5"
          />
          <Label htmlFor="pepDeclaration" className="text-sm font-normal leading-relaxed cursor-pointer">
            I confirm that neither I nor any beneficial owner of this organisation is a Politically Exposed Person (PEP) or is subject to sanctions, or I will disclose this during the onboarding review.
          </Label>
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            id="agreedToTerms"
            checked={form.agreedToTerms}
            onCheckedChange={(v) => set("agreedToTerms", Boolean(v))}
            className="mt-0.5"
          />
          <Label htmlFor="agreedToTerms" className="text-sm font-normal leading-relaxed cursor-pointer">
            I agree to the{" "}
            <a href="/terms" className="text-primary underline underline-offset-2">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="/privacy" className="text-primary underline underline-offset-2">
              Privacy Policy
            </a>
            . I understand that access is subject to compliance review. <span className="text-red-500">*</span>
          </Label>
        </div>
      </div>

      {!isAuthenticated && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            You will be redirected to log in before your application is submitted. Your form data will be preserved.
          </span>
        </div>
      )}

      <Button
        type="submit"
        className="w-full"
        size="lg"
        disabled={createMutation.isPending}
      >
        {createMutation.isPending ? (
          <>
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
            Submitting…
          </>
        ) : (
          <>
            {isAuthenticated ? "Submit Access Request" : "Continue to Login & Submit"}
            <ArrowRight className="w-4 h-4 ml-2" />
          </>
        )}
      </Button>
    </form>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function StakeholderPortalLandingPage() {
  const [submitted, setSubmitted] = useState(false);
  const [referenceId, setReferenceId] = useState("");

  const handleSuccess = (ref: string) => {
    setReferenceId(ref);
    setSubmitted(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ── Success state ──────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center p-6">
        <Card className="max-w-lg w-full text-center shadow-2xl">
          <CardContent className="pt-10 pb-10">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-5">
              <CheckCircle2 className="w-8 h-8 text-emerald-600" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Application Received</h2>
            <p className="text-muted-foreground mb-4">
              Your access request has been submitted successfully. Our compliance team will review your application and respond within 2 business days.
            </p>
            <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-4 py-2 text-sm font-mono mb-6">
              <span className="text-muted-foreground">Reference:</span>
              <span className="font-semibold text-foreground">{referenceId}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Please save this reference number. You will receive a confirmation email at the address provided.
            </p>
            <Button
              variant="outline"
              className="mt-6"
              onClick={() => (window.location.href = "/")}
            >
              Return to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Landing page ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 text-white">
        {/* Background grid pattern */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative max-w-6xl mx-auto px-6 py-24 lg:py-32">
          <div className="flex flex-col lg:flex-row items-center gap-12">
            <div className="flex-1 text-center lg:text-left">
              <Badge className="mb-4 bg-blue-600/20 text-blue-300 border-blue-500/30 hover:bg-blue-600/20">
                <Shield className="w-3 h-3 mr-1" />
                FATF-Aligned · NFIU-Compliant · ISO 27001 Ready
              </Badge>
              <h1 className="text-4xl lg:text-5xl xl:text-6xl font-extrabold leading-tight mb-5">
                Africa's Leading{" "}
                <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                  Financial Crime
                </span>{" "}
                Intelligence Platform
              </h1>
              <p className="text-lg lg:text-xl text-slate-300 mb-8 max-w-2xl">
                BIS provides banks, fintechs, regulators, and law enforcement agencies with end-to-end tools for AML compliance, KYC verification, suspicious activity reporting, and field investigations — purpose-built for the Nigerian and pan-African market.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                <Button
                  size="lg"
                  className="bg-blue-600 hover:bg-blue-500 text-white"
                  onClick={() => {
                    document.getElementById("request-access")?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  Request Access
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="border-slate-600 text-slate-200 hover:bg-slate-800 bg-transparent"
                  onClick={() => (window.location.href = "/cases/portal")}
                >
                  Existing Stakeholder Login
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>

            {/* Stats panel */}
            <div className="flex-shrink-0 grid grid-cols-2 gap-4 w-full max-w-sm">
              {[
                { value: "54", label: "African Countries", icon: Globe },
                { value: "99.9%", label: "Platform Uptime", icon: Zap },
                { value: "2M+", label: "KYC Checks/Year", icon: Users },
                { value: "ISO 27001", label: "Security Standard", icon: Lock },
              ].map(({ value, label, icon: Icon }) => (
                <div
                  key={label}
                  className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 text-center"
                >
                  <Icon className="w-5 h-5 text-blue-400 mx-auto mb-2" />
                  <div className="text-2xl font-bold text-white">{value}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section className="py-20 bg-slate-50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <Badge className="mb-3 bg-blue-100 text-blue-700 border-blue-200">Platform Capabilities</Badge>
            <h2 className="text-3xl lg:text-4xl font-bold mb-3">
              Everything your compliance team needs
            </h2>
            <p className="text-slate-600 max-w-2xl mx-auto">
              A single, integrated platform replacing fragmented spreadsheets, legacy systems, and manual processes across your entire compliance and intelligence workflow.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(({ icon: Icon, title, description, color, bg }) => (
              <div
                key={title}
                className="rounded-xl border border-slate-200 bg-white p-6 hover:shadow-md transition-shadow"
              >
                <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center mb-4`}>
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <h3 className="font-semibold text-slate-900 mb-2">{title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────────────────── */}
      <section className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <Badge className="mb-3 bg-emerald-100 text-emerald-700 border-emerald-200">Pricing</Badge>
            <h2 className="text-3xl lg:text-4xl font-bold mb-3">
              Transparent, scalable pricing
            </h2>
            <p className="text-slate-600 max-w-xl mx-auto">
              All plans include a 14-day free trial. No credit card required. Volume discounts available for regulators and government agencies.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TIERS.map((tier) => (
              <div
                key={tier.name}
                className={`rounded-2xl border p-6 flex flex-col ${
                  tier.highlight
                    ? "border-blue-500 bg-blue-600 text-white shadow-xl shadow-blue-200 scale-[1.02]"
                    : "border-slate-200 bg-white"
                }`}
              >
                {tier.highlight && (
                  <div className="flex items-center gap-1 mb-3">
                    <Star className="w-4 h-4 text-yellow-300 fill-yellow-300" />
                    <span className="text-xs font-semibold text-blue-100">Most Popular</span>
                  </div>
                )}
                <div className="mb-4">
                  <h3 className={`text-xl font-bold mb-1 ${tier.highlight ? "text-white" : "text-slate-900"}`}>
                    {tier.name}
                  </h3>
                  <p className={`text-sm ${tier.highlight ? "text-blue-100" : "text-slate-500"}`}>
                    {tier.description}
                  </p>
                </div>
                <div className="mb-5">
                  <span className={`text-3xl font-extrabold ${tier.highlight ? "text-white" : "text-slate-900"}`}>
                    {tier.price}
                  </span>
                  {tier.period && (
                    <span className={`text-sm ml-1 ${tier.highlight ? "text-blue-200" : "text-slate-500"}`}>
                      {tier.period}
                    </span>
                  )}
                </div>
                <ul className="space-y-2 mb-6 flex-1">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <CheckCircle2
                        className={`w-4 h-4 flex-shrink-0 ${tier.highlight ? "text-blue-200" : "text-emerald-500"}`}
                      />
                      <span className={tier.highlight ? "text-blue-50" : "text-slate-700"}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className={
                    tier.highlight
                      ? "bg-white text-blue-700 hover:bg-blue-50"
                      : "bg-slate-900 text-white hover:bg-slate-800"
                  }
                  onClick={() => {
                    document.getElementById("request-access")?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  {tier.cta}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ──────────────────────────────────────────────────── */}
      <section className="py-20 bg-slate-950 text-white">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <Badge className="mb-3 bg-slate-800 text-slate-300 border-slate-700">Client Testimonials</Badge>
            <h2 className="text-3xl lg:text-4xl font-bold mb-3">
              Trusted by compliance professionals
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TESTIMONIALS.map(({ quote, author, org }) => (
              <div
                key={author}
                className="rounded-xl border border-slate-800 bg-slate-900 p-6"
              >
                <div className="flex gap-0.5 mb-4">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                  ))}
                </div>
                <blockquote className="text-slate-300 text-sm leading-relaxed mb-4">
                  "{quote}"
                </blockquote>
                <div>
                  <div className="font-semibold text-white text-sm">{author}</div>
                  <div className="text-slate-500 text-xs">{org}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Trust badges ──────────────────────────────────────────────────── */}
      <section className="py-12 bg-white border-y border-slate-100">
        <div className="max-w-6xl mx-auto px-6">
          <p className="text-center text-xs text-slate-400 uppercase tracking-widest mb-6 font-medium">
            Compliance & Security Standards
          </p>
          <div className="flex flex-wrap justify-center gap-6">
            {[
              { icon: Shield, label: "FATF Recommendations" },
              { icon: FileText, label: "NFIU goAML" },
              { icon: Lock, label: "ISO 27001 Ready" },
              { icon: Globe, label: "NDPR Compliant" },
              { icon: BarChart3, label: "CBN AML Guidelines" },
              { icon: Building2, label: "EFCC Integration" },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-600"
              >
                <Icon className="w-4 h-4 text-slate-400" />
                {label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Request Access Form ────────────────────────────────────────────── */}
      <section id="request-access" className="py-20 bg-slate-50">
        <div className="max-w-2xl mx-auto px-6">
          <div className="text-center mb-10">
            <Badge className="mb-3 bg-blue-100 text-blue-700 border-blue-200">Get Started</Badge>
            <h2 className="text-3xl lg:text-4xl font-bold mb-3">Request Platform Access</h2>
            <p className="text-slate-600">
              Complete the form below to apply for access. Our team reviews all applications within 2 business days and will contact you to schedule an onboarding call.
            </p>
          </div>

          <Card className="shadow-lg">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-600" />
                Organisation Access Request
              </CardTitle>
              <CardDescription>
                Fields marked with <span className="text-red-500">*</span> are required.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RequestAccessForm onSuccess={handleSuccess} />
            </CardContent>
          </Card>

          <p className="text-center text-xs text-slate-400 mt-6">
            By submitting this form you agree to our{" "}
            <a href="/terms" className="underline underline-offset-2 hover:text-slate-600">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="/privacy" className="underline underline-offset-2 hover:text-slate-600">
              Privacy Policy
            </a>
            . Your data is processed in accordance with the Nigeria Data Protection Regulation (NDPR).
          </p>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="bg-slate-950 text-slate-400 py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-400" />
            <span className="font-semibold text-white">BIS Platform</span>
            <span className="text-slate-600">|</span>
            <span className="text-sm">Background Intelligence System</span>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <a href="/terms" className="hover:text-white transition-colors">Terms</a>
            <a href="/privacy" className="hover:text-white transition-colors">Privacy</a>
            <a href="/.well-known/security.txt" className="hover:text-white transition-colors">Security</a>
            <a href="/api/docs" className="hover:text-white transition-colors">API Docs</a>
          </div>
          <p className="text-xs text-slate-600">
            © {new Date().getFullYear()} BIS Platform. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
