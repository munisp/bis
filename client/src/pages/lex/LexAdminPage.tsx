import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Building2, Plus, UserPlus, Shield, MapPin, Phone, Mail, Copy, Eye, EyeOff, AlertTriangle } from "lucide-react";

const NIGERIAN_STATES = [
  { code: "AB", name: "Abia" }, { code: "AD", name: "Adamawa" }, { code: "AK", name: "Akwa Ibom" },
  { code: "AN", name: "Anambra" }, { code: "BA", name: "Bauchi" }, { code: "BY", name: "Bayelsa" },
  { code: "BE", name: "Benue" }, { code: "BO", name: "Borno" }, { code: "CR", name: "Cross River" },
  { code: "DE", name: "Delta" }, { code: "EB", name: "Ebonyi" }, { code: "ED", name: "Edo" },
  { code: "EK", name: "Ekiti" }, { code: "EN", name: "Enugu" }, { code: "GO", name: "Gombe" },
  { code: "IM", name: "Imo" }, { code: "JI", name: "Jigawa" }, { code: "KD", name: "Kaduna" },
  { code: "KN", name: "Kano" }, { code: "KT", name: "Katsina" }, { code: "KE", name: "Kebbi" },
  { code: "KO", name: "Kogi" }, { code: "KW", name: "Kwara" }, { code: "LA", name: "Lagos" },
  { code: "NA", name: "Nasarawa" }, { code: "NI", name: "Niger" }, { code: "OG", name: "Ogun" },
  { code: "ON", name: "Ondo" }, { code: "OS", name: "Osun" }, { code: "OY", name: "Oyo" },
  { code: "PL", name: "Plateau" }, { code: "RI", name: "Rivers" }, { code: "SO", name: "Sokoto" },
  { code: "TA", name: "Taraba" }, { code: "YO", name: "Yobe" }, { code: "ZA", name: "Zamfara" },
  { code: "FC", name: "FCT Abuja" },
];

const AGENCY_TYPES = [
  { value: "npf", label: "Nigeria Police Force (NPF)" },
  { value: "efcc", label: "EFCC" },
  { value: "icpc", label: "ICPC" },
  { value: "dss", label: "DSS" },
  { value: "nscdc", label: "NSCDC" },
  { value: "customs", label: "Nigeria Customs" },
  { value: "immigration", label: "Immigration Service" },
  { value: "other", label: "Other" },
];

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  suspended: "bg-yellow-100 text-yellow-800",
  retired: "bg-gray-100 text-gray-700",
  revoked: "bg-red-100 text-red-800",
};

export default function LexAdminPage() {
  const { user } = useAuth();
  
  const utils = trpc.useUtils();

  const [stateFilter, setStateFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selectedAgencyId, setSelectedAgencyId] = useState<number | null>(null);
  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  const [showSubmitterDialog, setShowSubmitterDialog] = useState(false);
  const [newPin, setNewPin] = useState<{ pin: string; submitterId: string; name: string } | null>(null);
  const [showPin, setShowPin] = useState(false);

  const { data: agenciesData, isLoading } = trpc.lex.listAgencies.useQuery({
    state: stateFilter || undefined,
    type: typeFilter || undefined,
    search: search || undefined,
  });

  const { data: agencyDetail } = trpc.lex.getAgency.useQuery(
    { id: selectedAgencyId! },
    { enabled: !!selectedAgencyId }
  );

  const createAgency = trpc.lex.createAgency.useMutation({
    onSuccess: () => {
      utils.lex.listAgencies.invalidate();
      setShowRegisterDialog(false);
      toast("Agency registered: The agency has been added to LEX.");
    },
    onError: (e) => toast.error(e.message),
  });

  const createSubmitter = trpc.lex.createSubmitter.useMutation({
    onSuccess: (data) => {
      utils.lex.getAgency.invalidate({ id: selectedAgencyId! });
      setShowSubmitterDialog(false);
      setNewPin({ pin: data.pin, submitterId: data.submitterId, name: data.submitter.name });
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeSubmitter = trpc.lex.revokeSubmitter.useMutation({
    onSuccess: () => {
      utils.lex.getAgency.invalidate({ id: selectedAgencyId! });
      toast("Submitter revoked");
    },
  });

  const updateStatus = trpc.lex.updateAgencyStatus.useMutation({
    onSuccess: () => {
      utils.lex.listAgencies.invalidate();
      utils.lex.getAgency.invalidate({ id: selectedAgencyId! });
      toast("Agency status updated");
    },
  });

  // Register agency form state
  const [regForm, setRegForm] = useState({ name: "", type: "npf", state: "", lga: "", commandUnit: "", contactName: "", contactPhone: "", contactEmail: "", notes: "" });
  const [subForm, setSubForm] = useState({ name: "", rank: "", phone: "" });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-600" />
            LEX — Law Enforcement Extension
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage registered agencies and their authorised submitters. Every agency is tied to a specific Nigerian state.
          </p>
        </div>
        <Button onClick={() => setShowRegisterDialog(true)}>
          <Plus className="w-4 h-4 mr-2" /> Register Agency
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Agency List */}
        <div className="lg:col-span-2 space-y-4">
          {/* Filters */}
          <div className="flex gap-3 flex-wrap">
            <Input placeholder="Search agencies..." value={search} onChange={e => setSearch(e.target.value)} className="w-48" />
            <Select value={stateFilter} onValueChange={setStateFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All states" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All states</SelectItem>
                {NIGERIAN_STATES.map(s => <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All types</SelectItem>
                {AGENCY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="text-muted-foreground text-sm">Loading agencies...</div>
          ) : (agenciesData?.agencies ?? []).length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>No agencies registered yet.</p>
                <p className="text-xs mt-1">Register the first agency to start accepting LEX submissions.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {(agenciesData?.agencies ?? []).map(agency => (
                <Card
                  key={agency.id}
                  className={`cursor-pointer transition-colors ${selectedAgencyId === agency.id ? "border-blue-500 bg-blue-50/30" : "hover:bg-muted/30"}`}
                  onClick={() => setSelectedAgencyId(agency.id)}
                >
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{agency.name}</span>
                          <Badge variant="outline" className="text-xs font-mono">{agency.agencyCode}</Badge>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[agency.status] ?? ""}`}>{agency.status}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{NIGERIAN_STATES.find(s => s.code === agency.state)?.name ?? agency.state}</span>
                          {agency.lga && <span>{agency.lga}</span>}
                          {agency.commandUnit && <span>{agency.commandUnit}</span>}
                          <span className="uppercase">{agency.type}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Agency Detail Panel */}
        <div>
          {selectedAgencyId && agencyDetail ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{agencyDetail.agency.name}</CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="font-mono text-xs">{agencyDetail.agency.agencyCode}</Badge>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[agencyDetail.agency.status] ?? ""}`}>{agencyDetail.agency.status}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm space-y-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{NIGERIAN_STATES.find(s => s.code === agencyDetail.agency.state)?.name} {agencyDetail.agency.lga ? `— ${agencyDetail.agency.lga}` : ""}</span>
                  </div>
                  {agencyDetail.agency.contactPhone && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="w-3.5 h-3.5" />
                      <span>{agencyDetail.agency.contactPhone}</span>
                    </div>
                  )}
                  {agencyDetail.agency.contactEmail && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="w-3.5 h-3.5" />
                      <span className="truncate">{agencyDetail.agency.contactEmail}</span>
                    </div>
                  )}
                </div>

                {/* Status controls */}
                <div className="flex gap-2">
                  {agencyDetail.agency.status === "active" && (
                    <Button size="sm" variant="outline" className="text-yellow-700 border-yellow-300 text-xs" onClick={() => updateStatus.mutate({ id: agencyDetail.agency.id, status: "suspended" })}>
                      Suspend
                    </Button>
                  )}
                  {agencyDetail.agency.status === "suspended" && (
                    <Button size="sm" variant="outline" className="text-green-700 border-green-300 text-xs" onClick={() => updateStatus.mutate({ id: agencyDetail.agency.id, status: "active" })}>
                      Reactivate
                    </Button>
                  )}
                </div>

                {/* Submitters */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Authorised Submitters ({agencyDetail.submitters.length})</span>
                    <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setShowSubmitterDialog(true)}>
                      <UserPlus className="w-3 h-3 mr-1" /> Add
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {agencyDetail.submitters.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No submitters registered.</p>
                    ) : agencyDetail.submitters.map(sub => (
                      <div key={sub.id} className="flex items-center justify-between text-xs bg-muted/40 rounded p-2">
                        <div>
                          <div className="font-medium">{sub.name}</div>
                          <div className="text-muted-foreground">{sub.rank ?? "—"} · Rep: {sub.reputationScore}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className={`px-1.5 py-0.5 rounded text-xs ${STATUS_COLORS[sub.status] ?? ""}`}>{sub.status}</span>
                          {sub.status === "active" && (
                            <Button size="sm" variant="ghost" className="h-6 px-1 text-red-600 hover:text-red-700" onClick={() => revokeSubmitter.mutate({ id: sub.id })}>
                              Revoke
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                <Building2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Select an agency to view details
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Register Agency Dialog */}
      <Dialog open={showRegisterDialog} onOpenChange={setShowRegisterDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Register Law Enforcement Agency</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Agency Name *</Label>
              <Input value={regForm.name} onChange={e => setRegForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Lagos State Command, Nigeria Police Force" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Agency Type *</Label>
                <Select value={regForm.type} onValueChange={v => setRegForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{AGENCY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>State *</Label>
                <Select value={regForm.state} onValueChange={v => setRegForm(f => ({ ...f, state: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                  <SelectContent>{NIGERIAN_STATES.map(s => <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>LGA</Label>
                <Input value={regForm.lga} onChange={e => setRegForm(f => ({ ...f, lga: e.target.value }))} placeholder="Local Government Area" />
              </div>
              <div>
                <Label>Command Unit</Label>
                <Input value={regForm.commandUnit} onChange={e => setRegForm(f => ({ ...f, commandUnit: e.target.value }))} placeholder="e.g. Apapa Area Command" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Contact Name</Label>
                <Input value={regForm.contactName} onChange={e => setRegForm(f => ({ ...f, contactName: e.target.value }))} />
              </div>
              <div>
                <Label>Contact Phone</Label>
                <Input value={regForm.contactPhone} onChange={e => setRegForm(f => ({ ...f, contactPhone: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Contact Email</Label>
              <Input type="email" value={regForm.contactEmail} onChange={e => setRegForm(f => ({ ...f, contactEmail: e.target.value }))} />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={regForm.notes} onChange={e => setRegForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRegisterDialog(false)}>Cancel</Button>
            <Button
              disabled={!regForm.name || !regForm.state || createAgency.isPending}
              onClick={() => createAgency.mutate({ ...regForm, type: regForm.type as any, contactEmail: regForm.contactEmail || undefined })}
            >
              {createAgency.isPending ? "Registering..." : "Register Agency"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Submitter Dialog */}
      <Dialog open={showSubmitterDialog} onOpenChange={setShowSubmitterDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Authorised Submitter</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Full Name *</Label>
              <Input value={subForm.name} onChange={e => setSubForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label>Rank</Label>
              <Input value={subForm.rank} onChange={e => setSubForm(f => ({ ...f, rank: e.target.value }))} placeholder="e.g. Inspector, Detective Superintendent" />
            </div>
            <div>
              <Label>Phone *</Label>
              <Input value={subForm.phone} onChange={e => setSubForm(f => ({ ...f, phone: e.target.value }))} placeholder="+234..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmitterDialog(false)}>Cancel</Button>
            <Button
              disabled={!subForm.name || !subForm.phone || createSubmitter.isPending}
              onClick={() => createSubmitter.mutate({ agencyId: selectedAgencyId!, name: subForm.name, rank: subForm.rank || undefined, phone: subForm.phone })}
            >
              {createSubmitter.isPending ? "Creating..." : "Create Submitter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PIN Display Dialog — shown once after submitter creation */}
      <Dialog open={!!newPin} onOpenChange={() => setNewPin(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Submitter Credentials Created</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5 shrink-0" />
              <p className="text-xs text-yellow-800">This PIN is shown <strong>once only</strong>. Record it and deliver it to the officer via a secure channel (e.g., SMS to their registered phone).</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Officer Name</Label>
              <p className="font-medium">{newPin?.name}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Submitter ID</Label>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-muted px-2 py-1 rounded flex-1 break-all">{newPin?.submitterId}</code>
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { navigator.clipboard.writeText(newPin?.submitterId ?? ""); toast("Copied"); }}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">6-Digit PIN</Label>
              <div className="flex items-center gap-2">
                <code className="text-2xl font-bold tracking-widest bg-muted px-3 py-2 rounded flex-1 text-center">
                  {showPin ? newPin?.pin : "••••••"}
                </code>
                <Button size="sm" variant="ghost" className="h-10 px-2" onClick={() => setShowPin(v => !v)}>
                  {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
                <Button size="sm" variant="ghost" className="h-10 px-2" onClick={() => { navigator.clipboard.writeText(newPin?.pin ?? ""); toast("PIN copied"); }}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { setNewPin(null); setShowPin(false); }}>Done — I have recorded the PIN</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
