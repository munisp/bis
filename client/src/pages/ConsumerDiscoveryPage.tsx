import { useMemo, useState } from "react";
import BISLayout from "@/components/BISLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, FileSearch, MapPin, Search, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";

type SearchKind = "name" | "phone" | "email" | "address";
type Purpose = "self" | "personal_safety" | "fraud_prevention" | "account_security" | "compliance_investigation" | "legal_authority";
type Mode = "consumer" | "institutional";

const PURPOSES: Array<{ value: Purpose; label: string; consumer: boolean }> = [
  { value: "self", label: "Find my own record", consumer: true },
  { value: "personal_safety", label: "Personal safety", consumer: true },
  { value: "fraud_prevention", label: "Fraud prevention", consumer: true },
  { value: "account_security", label: "Account security", consumer: false },
  { value: "compliance_investigation", label: "Compliance investigation", consumer: false },
  { value: "legal_authority", label: "Legal authority", consumer: false },
];

function formatPurpose(purpose: Purpose): string {
  return PURPOSES.find(item => item.value === purpose)?.label ?? purpose;
}

export default function ConsumerDiscoveryPage() {
  const [mode, setMode] = useState<Mode>("consumer");
  const [kind, setKind] = useState<SearchKind>("name");
  const [term, setTerm] = useState("");
  const [purpose, setPurpose] = useState<Purpose>("personal_safety");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [submitted, setSubmitted] = useState<{ mode: Mode; kind: SearchKind; term: string; purpose: Purpose } | null>(null);

  const input = useMemo<{
    mode: Mode;
    purpose: Purpose;
    consentConfirmed: true;
    countryCode: "NG";
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
  }>(() => {
    if (!submitted) return { mode, purpose, consentConfirmed: true, countryCode: "NG", name: "not-submitted" };
    const key = submitted.kind;
    return {
      mode: submitted.mode,
      purpose: submitted.purpose,
      consentConfirmed: true,
      countryCode: "NG",
      [key]: submitted.term,
    };
  }, [submitted, mode, purpose]);

  const query = trpc.consumerIntelligence.search.useQuery(input, {
    enabled: submitted !== null,
    retry: false,
  });
  const grantConsent = trpc.consumerGovernance.consent.grant.useMutation();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (term.trim().length < 2) {
      toast.error("Enter at least two characters to search the synthetic Nigeria dataset.");
      return;
    }
    if (!consentConfirmed) {
      toast.error("Confirm a permitted purpose and your consent acknowledgement before searching.");
      return;
    }
    if (mode === "consumer" && !PURPOSES.find(item => item.value === purpose)?.consumer) {
      toast.error("This purpose is available only to authorized institutional accounts.");
      return;
    }
    try {
      await grantConsent.mutateAsync({
        purpose,
        legalBasis: mode === "consumer" ? "consent" : "legitimate_interest",
        policyVersion: "NG-CONSUMER-2026-01",
        scopes: ["consumer_discovery", "profile_detail", "provenance", "relationship_linkage"],
      });
      setSubmitted({ mode, kind, term: term.trim(), purpose });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record consent for this search.");
    }
  };

  return (
    <BISLayout>
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-5 sm:px-6 lg:px-8">
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-sm" aria-label="Synthetic data notice">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <h1 className="font-semibold">Nigeria Consumer Discovery — Demonstration Environment</h1>
              <p className="mt-1 text-sm leading-6">Every result is synthetic, non-real data for local validation. It is not provider-derived data and must not be used to make a real-world decision.</p>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
            <div className="mb-6 flex items-start gap-3">
              <div className="rounded-xl bg-emerald-600 p-2.5 text-white"><Search className="h-5 w-5" aria-hidden="true" /></div>
              <div>
                <h2 className="text-xl font-bold tracking-tight">People and Contact Discovery</h2>
                <p className="mt-1 text-sm text-muted-foreground">Search Nigeria-first profiles by name, phone, email, or address with purpose-bound access logging.</p>
              </div>
            </div>

            <form className="space-y-5" onSubmit={submit}>
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Access mode</legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(["consumer", "institutional"] as const).map(value => (
                    <label key={value} className={`cursor-pointer rounded-xl border p-3 transition-colors ${mode === value ? "border-emerald-600 bg-emerald-50" : "border-border"}`}>
                      <input className="sr-only" type="radio" name="mode" value={value} checked={mode === value} onChange={() => {
                        setMode(value);
                        if (value === "consumer" && !PURPOSES.find(item => item.value === purpose)?.consumer) setPurpose("personal_safety");
                      }} />
                      <span className="block font-medium capitalize">{value}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{value === "consumer" ? "Personal, safety, or fraud-prevention lookup" : "Authorized investigation and compliance workflow"}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium">Search type
                  <select className="mt-1 w-full rounded-md border bg-background px-3 py-2" value={kind} onChange={event => setKind(event.target.value as SearchKind)}>
                    <option value="name">Name</option>
                    <option value="phone">Phone number</option>
                    <option value="email">Email address</option>
                    <option value="address">Address</option>
                  </select>
                </label>
                <label className="block text-sm font-medium">Declared purpose
                  <select className="mt-1 w-full rounded-md border bg-background px-3 py-2" value={purpose} onChange={event => setPurpose(event.target.value as Purpose)}>
                    {PURPOSES.filter(item => mode === "institutional" || item.consumer).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
              </div>

              <label className="block text-sm font-medium">Search term
                <Input className="mt-1" value={term} onChange={event => setTerm(event.target.value)} placeholder={kind === "name" ? "e.g., Amara Demo-Okafor" : kind === "phone" ? "+2340000000001" : kind === "email" ? "name@example.test" : "Example Road, Lagos"} autoComplete="off" />
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 text-sm">
                <input className="mt-1 h-4 w-4" type="checkbox" checked={consentConfirmed} onChange={event => setConsentConfirmed(event.target.checked)} />
                <span>I confirm that this lookup serves the declared permitted purpose and that I will not use synthetic results for an employment, credit, housing, insurance, or other real-world eligibility decision.</span>
              </label>

              <Button className="w-full sm:w-auto" type="submit" disabled={query.isFetching || grantConsent.isPending}>
                <FileSearch className="mr-2 h-4 w-4" /> {grantConsent.isPending ? "Recording consent…" : query.isFetching ? "Searching…" : "Search synthetic Nigeria records"}
              </Button>
            </form>
          </div>

          <aside className="rounded-2xl border bg-card p-5 shadow-sm">
            <ShieldCheck className="h-6 w-6 text-emerald-600" aria-hidden="true" />
            <h2 className="mt-3 font-semibold">Safety and provenance</h2>
            <ul className="mt-3 space-y-3 text-sm leading-5 text-muted-foreground">
              <li>Search terms are stored only as a one-way fingerprint in the access audit record.</li>
              <li>Each result is explicitly labeled synthetic and carries field-level provenance.</li>
              <li>Institutional purposes require an authorized account role at the API boundary.</li>
              <li>Production provider data is deliberately excluded from this demonstration dataset.</li>
            </ul>
          </aside>
        </section>

        {query.error && <section className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">Search unavailable: {query.error.message}</section>}

        {query.data && <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-semibold">Synthetic results</h2><p className="text-sm text-muted-foreground">Purpose: {formatPurpose(query.data.declaredPurpose)} · Nigeria dataset</p></div>
            <Badge variant="outline" className="border-amber-500 text-amber-700">Synthetic only</Badge>
          </div>
          {query.data.results.length === 0 ? <div className="rounded-xl border bg-card p-7 text-center text-sm text-muted-foreground">No synthetic Nigeria profile matches this query.</div> : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {query.data.results.map(profile => (
                <article key={profile.profileRef} className="rounded-2xl border bg-card p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{profile.name}</h3><p className="text-xs text-muted-foreground">{profile.profileRef}</p></div><Users className="h-5 w-5 text-emerald-600" aria-hidden="true" /></div>
                  <div className="mt-4 space-y-2 text-sm"><p>{profile.contact.phone ?? "No phone"}</p><p className="break-all">{profile.contact.email ?? "No email"}</p><p className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span>{[profile.location.addressLine, profile.location.cityOrLocality, profile.location.stateOrRegion].filter(Boolean).join(", ") || "No address"}</span></p></div>
                  <p className="mt-4 border-t pt-3 text-xs font-medium text-amber-700">{profile.provenance.notice}</p>
                </article>
              ))}
            </div>
          )}
        </section>}
      </main>
    </BISLayout>
  );
}
