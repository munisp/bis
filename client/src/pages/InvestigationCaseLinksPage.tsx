import { useState } from "react";
import BISLayout from "@/components/BISLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Link2, Unlink, Plus, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function InvestigationCaseLinksPage() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [selectedInvId, setSelectedInvId] = useState<string>("");
  const [newInvId, setNewInvId] = useState<string>("");
  const [caseId, setCaseId] = useState<string>("");
  const [notes, setNotes] = useState("");

  // Use listForInvestigation with a dummy id=0 to get all links (or use a dedicated all-links endpoint)
  // For now, list all links by querying with a broad filter
  const { data: invData } = trpc.investigations.list.useQuery({ limit: 100, offset: 0 });
  const { data: casesData } = trpc.cases.list.useQuery({ pageSize: 100 });

  const create = trpc.investigationLinks.link.useMutation({
    onSuccess: () => {
      toast.success("Link created");
      utils.investigationLinks.listForInvestigation.invalidate();
      setOpen(false);
      setNewInvId("");
      setCaseId("");
      setNotes("");
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const remove = trpc.investigationLinks.unlink.useMutation({
    onSuccess: () => {
      toast.success("Link removed");
      utils.investigationLinks.listForInvestigation.invalidate();
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  // Fetch links for selected investigation
  const { data: links } = trpc.investigationLinks.listForInvestigation.useQuery(
    { investigationId: Number(selectedInvId) },
    { enabled: !!selectedInvId && Number(selectedInvId) > 0 }
  );

  return (
    <BISLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Investigation — Case Links</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Connect investigations to related cases for cross-reference and unified reporting.
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                New Link
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Link Investigation to Case</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label>Investigation</Label>
                  <Select value={newInvId} onValueChange={setNewInvId}>
                    <SelectTrigger><SelectValue placeholder="Select investigation..." /></SelectTrigger>
                    <SelectContent>
                      {invData?.items?.map((inv) => (
                        <SelectItem key={inv.id} value={String(inv.id)}>
                          {inv.subjectName ?? inv.ref ?? `INV-${inv.id}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Case</Label>
                  <Select value={caseId} onValueChange={setCaseId}>
                    <SelectTrigger><SelectValue placeholder="Select case..." /></SelectTrigger>
                    <SelectContent>
                      {casesData?.cases?.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.title ?? c.ref ?? `CASE-${c.id}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Notes (optional)</Label>
                  <Textarea
                    placeholder="Describe the relationship between this investigation and case..."
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={3}
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={() => create.mutate({
                    investigationId: Number(newInvId),
                    caseId: Number(caseId),
                    notes: notes || undefined
                  })}
                  disabled={!newInvId || !caseId || create.isPending}
                >
                  <Link2 className="h-4 w-4 mr-2" />
                  Create Link
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Investigation selector for viewing links */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <Label className="text-sm text-muted-foreground mb-2 block">Select an investigation to view its case links</Label>
            <Select value={selectedInvId} onValueChange={setSelectedInvId}>
              <SelectTrigger className="max-w-sm">
                <SelectValue placeholder="Choose investigation..." />
              </SelectTrigger>
              <SelectContent>
                {invData?.items?.map((inv) => (
                  <SelectItem key={inv.id} value={String(inv.id)}>
                    {inv.subjectName ?? inv.ref ?? `INV-${inv.id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {!selectedInvId ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <Link2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Select an investigation above</p>
              <p className="text-sm mt-1">Case links for the selected investigation will appear here.</p>
            </CardContent>
          </Card>
        ) : !links?.length ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <Link2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No links yet</p>
              <p className="text-sm mt-1">Use the "New Link" button to connect this investigation to a case.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {links.map((link) => (
              <Card key={link.id}>
                <CardContent className="flex items-center justify-between py-3 px-5">
                  <div className="flex items-center gap-3">
                    <Link2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div>
                      <div className="flex items-center gap-2 text-sm">
                        <Badge variant="outline" className="font-mono text-xs">
                          INV-{selectedInvId}
                        </Badge>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                        <Badge variant="outline" className="font-mono text-xs">
                          CASE-{link.caseId}
                        </Badge>
                      </div>
                      {link.notes && <p className="text-xs text-muted-foreground mt-0.5">{link.notes}</p>}
                      <p className="text-xs text-muted-foreground/60 mt-0.5">
                        Linked {new Date(link.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => remove.mutate({ linkId: link.id })}
                  >
                    <Unlink className="h-3.5 w-3.5" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </BISLayout>
  );
}
