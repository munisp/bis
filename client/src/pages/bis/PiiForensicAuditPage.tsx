import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const MAX_FORENSIC_CURSOR_STACK = 100;

type ForensicEvent = {
  id: number;
  createdAt: Date | string;
  eventType: string;
  detail: Record<string, string | number | boolean | null>;
  integrityHash: string;
  integrityScheme: string;
  incidentRef: string | null;
  incidentStatus: string | null;
};

function isExpiredCursorError(error: { data?: { code?: string } | null; message?: string } | null): boolean {
  return error?.data?.code === "BAD_REQUEST" && error.message === "PII forensic pagination cursor is invalid or expired.";
}

function startVerifiedForensicExport(): void {
  const anchor = document.createElement("a");
  anchor.href = "/api/pii-forensics/export.ndjson";
  anchor.download = "bis-pii-forensic-audit.ndjson";
  anchor.click();
}

export default function PiiForensicAuditPage() {
  const [cursor, setCursor] = useState<string | undefined>();
  const [pagesViewed, setPagesViewed] = useState(0);
  const [pageStack, setPageStack] = useState<Array<string | undefined>>([]);
  const [cursorExpired, setCursorExpired] = useState(false);
  const query = trpc.piiKeyCustody.listForensics.useQuery(
    { limit: 100, cursor },
    {
      retry: false,
      staleTime: 0,
      gcTime: 0,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  );

  useEffect(() => {
    if (!query.data) return;
    setCursorExpired(false);
    setPagesViewed((current) => current + 1);
  }, [query.data]);

  const events = query.data?.events ?? [];
  const nextCursor = query.data?.nextCursor ?? null;
  const expired = isExpiredCursorError(query.error);
  const canDownload = !query.isFetching && !expired;
  const cursorHistoryAtLimit = pageStack.length >= MAX_FORENSIC_CURSOR_STACK;
  const formattedEvents = useMemo(() => events.map((event) => ({ ...event, createdAt: new Date(event.createdAt).toLocaleString("en-NG") })), [events]);

  function advanceToNextPage(): void {
    if (!nextCursor || query.isFetching || cursorHistoryAtLimit) return;
    setPageStack((current) => current.length >= MAX_FORENSIC_CURSOR_STACK ? current : [...current, cursor]);
    setCursor(nextCursor);
  }

  function restartAfterExpiry(): void {
    setCursor(undefined);
    setPageStack([]);
    setPagesViewed(0);
    setCursorExpired(true);
  }

  return <div className="space-y-6 p-6">
    <section className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="mb-2 flex items-center gap-2 text-primary"><ShieldCheck size={22}/><span className="font-mono text-xs uppercase tracking-[0.18em]">PII custody</span></div>
        <h1 className="text-2xl font-semibold text-foreground">Verified forensic audit</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Each page is tenant-isolated, HMAC-verified, and bounded to 100 immutable forensic events. Event detail is constrained to an approved non-PII schema.</p>
      </div>
      <Button variant="outline" disabled={!canDownload} onClick={() => { startVerifiedForensicExport(); toast.info("Starting a bounded verified forensic export. The download contains a completion record only after every page verifies."); }}><Download className="mr-2" size={15}/>Stream verified export</Button>
    </section>

    {expired ? <Card className="border-amber-300 bg-amber-50"><CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5"><div className="flex gap-3"><AlertTriangle className="mt-0.5 text-amber-700" size={18}/><p className="max-w-2xl text-sm text-amber-950">The signed continuation cursor expired or is no longer valid. No page was returned. Restarting begins a new verified scan and discards local page-navigation state to avoid presenting a mixed scan.</p></div><Button onClick={restartAfterExpiry}><RefreshCw className="mr-2" size={15}/>Restart verified scan</Button></CardContent></Card> : null}
    {cursorExpired ? <p className="text-xs text-muted-foreground">A new cursor chain is active after expiration recovery.</p> : null}
    {query.isLoading ? <div className="flex justify-center py-24"><Loader2 className="animate-spin text-muted-foreground"/></div> : null}
    {!query.isLoading && !query.error ? <Card><CardContent className="space-y-3 pt-5">{formattedEvents.length ? formattedEvents.map((event) => <div key={event.id} className="rounded border border-border/60 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><code className="text-xs text-muted-foreground">event #{event.id}</code><span className="text-xs text-muted-foreground">{event.createdAt}</span></div><p className="mt-1 text-sm font-medium text-foreground">{event.eventType}</p><p className="mt-1 break-words font-mono text-xs text-muted-foreground">{JSON.stringify(event.detail)}</p></div>) : <p className="py-12 text-center text-sm text-muted-foreground">No verified forensic events are available for this tenant.</p>}<div className="flex items-center justify-between border-t pt-4"><Button variant="outline" disabled={!pageStack.length || query.isFetching} onClick={() => { const previous = pageStack.at(-1); setPageStack((current) => current.slice(0, -1)); setCursor(previous); }}><ChevronLeft className="mr-1" size={15}/>Previous page</Button><span className="text-xs text-muted-foreground">Viewed {pagesViewed} verified page{pagesViewed === 1 ? "" : "s"}</span>      <Button disabled={!nextCursor || query.isFetching || cursorHistoryAtLimit} onClick={advanceToNextPage}>Next page<ChevronRight className="ml-1" size={15}/></Button></div></CardContent></Card> : null}
    {cursorHistoryAtLimit ? <p className="text-xs text-muted-foreground">Interactive navigation retains at most {MAX_FORENSIC_CURSOR_STACK} opaque cursors. Restart the verified scan to begin a new bounded navigation chain.</p> : null}
    {query.error && !expired ? <Card className="border-destructive/40"><CardContent className="pt-5 text-sm text-destructive">The verified forensic audit page could not be loaded. No partial result is shown. {query.error.message}</CardContent></Card> : null}
  </div>;
}
