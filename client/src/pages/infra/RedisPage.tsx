// RedisPage.tsx — Redis Key Browser & Stats
// Admin-only: key browser, get/set/delete, memory stats, flush-by-namespace

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import BISLayout from "@/components/BISLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Database, Search, RefreshCw, Plus, Trash2, Eye, CheckCircle2,
  AlertTriangle, MemoryStick, Key, Clock, Layers, AlertOctagon,
} from "lucide-react";

// ─── Set Key Dialog ───────────────────────────────────────────────────────────
function SetKeyDialog({ open, onClose, onSet, prefillKey = "" }: {
  open: boolean; onClose: () => void; onSet: () => void; prefillKey?: string;
}) {
  const [key, setKey] = useState(prefillKey);
  const [value, setValue] = useState("");
  const [ttl, setTtl] = useState<number | undefined>(undefined);

  const set = trpc.redis.set.useMutation({
    onSuccess: () => { toast.success("Key set"); onSet(); onClose(); },
    onError: (e) => toast.error("Set failed: " + e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Set Redis Key</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Key</Label>
            <Input placeholder="namespace:key" value={key} onChange={e => setKey(e.target.value)} className="font-mono" />
          </div>
          <div>
            <Label className="text-xs">Value (JSON or string)</Label>
            <Textarea
              value={value}
              onChange={e => setValue(e.target.value)}
              rows={4}
              className="font-mono text-xs"
              placeholder='"hello world" or {"id": 1}'
            />
          </div>
          <div>
            <Label className="text-xs">TTL (seconds, optional)</Label>
            <Input
              type="number"
              placeholder="3600"
              value={ttl ?? ""}
              onChange={e => setTtl(e.target.value ? Number(e.target.value) : undefined)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              // value is always passed as a string to the server (it stores JSON strings)
              set.mutate({ key, value, ttlSeconds: ttl });
            }}
            disabled={set.isPending || !key || !value}
          >
            {set.isPending ? "Setting…" : "Set Key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Inspect Key Dialog ───────────────────────────────────────────────────────
function InspectKeyDialog({ keyName, open, onClose }: { keyName: string; open: boolean; onClose: () => void }) {
  const { data, isLoading } = trpc.redis.inspect.useQuery({ key: keyName }, { enabled: open && !!keyName });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-mono text-sm">{keyName}</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="text-center py-6 text-muted-foreground text-sm">Loading…</div>
        ) : data ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-muted/30 rounded-lg p-3">
                <div className="text-xs text-muted-foreground">Type</div>
                <div className="font-mono text-sm font-medium">{data.type}</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-3">
                <div className="text-xs text-muted-foreground">TTL</div>
                <div className="font-mono text-sm font-medium">{data.ttl === -1 ? "∞ persistent" : data.ttl === -2 ? "expired" : `${data.ttl}s`}</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-3">
                <div className="text-xs text-muted-foreground">Exists</div>
                <div className="font-mono text-sm font-medium">{data.exists ? "Yes" : "No"}</div>
              </div>
            </div>
            <div>
              <Label className="text-xs">Value</Label>
              <pre className="bg-muted/30 rounded-lg p-3 text-xs font-mono overflow-auto max-h-48 whitespace-pre-wrap break-all">
                {data.value != null ? (
                  (() => {
                    const raw = String(data.value);
                    try { return JSON.stringify(JSON.parse(raw), null, 2); }
                    catch { return raw; }
                  })()
                ) : "(null)"}
              </pre>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground text-sm">Key not found</div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Flush Namespace Dialog ───────────────────────────────────────────────────
function FlushNamespaceDialog({ open, onClose, onFlushed }: { open: boolean; onClose: () => void; onFlushed: () => void }) {
  const [ns, setNs] = useState("");
  const flush = trpc.redis.flushNamespace.useMutation({
    onSuccess: (d) => { toast.success(`Flushed ${d.deletedCount} keys in "${d.namespace}"`); onFlushed(); onClose(); },
    onError: (e) => toast.error("Flush failed: " + e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Flush Namespace</DialogTitle></DialogHeader>
        <div>
          <Label className="text-xs">Namespace prefix (e.g. "session", "rate", "cache")</Label>
          <Input placeholder="session" value={ns} onChange={e => setNs(e.target.value)} className="font-mono" />
          <p className="text-xs text-muted-foreground mt-1">Deletes all keys matching <code>{ns}:*</code></p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => { if (confirm(`Delete all keys in "${ns}:*"?`)) flush.mutate({ namespace: ns }); }}
            disabled={flush.isPending || !ns}
          >
            {flush.isPending ? "Flushing…" : "Flush"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
function RedisPageInner() {
  const [pattern, setPattern] = useState("*");
  const [searchInput, setSearchInput] = useState("*");
  const [setOpen, setSetOpen] = useState(false);
  const [inspectKey, setInspectKey] = useState<string | null>(null);
  const [flushOpen, setFlushOpen] = useState(false);

  const { data: statusData } = trpc.redis.status.useQuery();
  const { data: keysData, refetch: refetchKeys, isLoading: keysLoading } = trpc.redis.listKeys.useQuery({
    pattern,
    count: 200,
  });
  const { data: memData } = trpc.redis.memoryStats.useQuery();

  const del = trpc.redis.del.useMutation({
    onSuccess: (d) => { toast.success(`Deleted key: ${d.key}`); refetchKeys(); },
    onError: (e) => toast.error("Delete failed: " + e.message),
  });

  const keys: string[] = keysData && "keys" in keysData ? (keysData.keys as string[]) : [];
  const totalKeys = keysData && "total" in keysData ? (keysData.total as number) : 0;
  const connected = keysData && "connected" in keysData ? keysData.connected : false;

  const mem = memData && "stats" in memData ? (memData.stats as Record<string, string> | null) : null;
  const usedMemory = mem?.used_memory_human ?? "—";
  const peakMemory = mem?.used_memory_peak_human ?? "—";
  const connectedClients = (statusData as any)?.connected_clients ?? "—";

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Database className="h-6 w-6 text-red-400" />
            Redis Key Browser
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Inspect sessions, rate-limit counters, cache entries, and event idempotency keys.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setFlushOpen(true)} className="gap-2 text-destructive border-destructive/40 hover:bg-destructive/10">
            <AlertOctagon className="h-4 w-4" />
            Flush Namespace
          </Button>
          <Button onClick={() => setSetOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Set Key
          </Button>
        </div>
      </div>

      {/* Connection banner */}
      <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm border ${
        connected
          ? "bg-emerald-950/30 border-emerald-700/40 text-emerald-300"
          : "bg-amber-950/30 border-amber-700/40 text-amber-300"
      }`}>
        {connected
          ? <><CheckCircle2 className="h-4 w-4" />Redis connected — {totalKeys} total keys</>
          : <><AlertTriangle className="h-4 w-4" />Redis not connected — set REDIS_URL env var</>}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Keys", value: totalKeys, icon: Key, color: "text-red-400" },
          { label: "Used Memory", value: usedMemory, icon: MemoryStick, color: "text-blue-400" },
          { label: "Peak Memory", value: peakMemory, icon: Layers, color: "text-purple-400" },
          { label: "Clients", value: connectedClients, icon: Database, color: "text-emerald-400" },
        ].map(stat => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <Icon className={`h-5 w-5 ${stat.color}`} />
                  <div>
                    <div className="text-xl font-bold font-mono">{stat.value}</div>
                    <div className="text-xs text-muted-foreground">{stat.label}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Key browser */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Keys</CardTitle>
              <CardDescription className="text-xs">Pattern matching — use * for wildcard, e.g. session:* or rate:*</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Pattern: *"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") setPattern(searchInput); }}
                  className="pl-8 h-8 w-56 text-sm font-mono"
                />
              </div>
              <Button variant="outline" size="sm" onClick={() => { setPattern(searchInput); }}>
                Search
              </Button>
              <Button variant="ghost" size="sm" onClick={() => refetchKeys()}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead className="w-20">Namespace</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keysLoading ? (
                <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">Loading keys…</TableCell></TableRow>
              ) : keys.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No keys match pattern "{pattern}"</TableCell></TableRow>
              ) : keys.map((k: string) => {
                const ns = k.includes(":") ? k.split(":")[0] : "—";
                return (
                  <TableRow key={k}>
                    <TableCell className="font-mono text-xs">{k}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs font-mono">{ns}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setInspectKey(k)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => { if (confirm(`Delete key "${k}"?`)) del.mutate({ key: k }); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
            Showing {keys.length} of {totalKeys} keys matching <code className="font-mono bg-muted px-1 rounded">{pattern}</code>
          </div>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <SetKeyDialog open={setOpen} onClose={() => setSetOpen(false)} onSet={() => refetchKeys()} />
      {inspectKey && (
        <InspectKeyDialog keyName={inspectKey} open={true} onClose={() => setInspectKey(null)} />
      )}
      <FlushNamespaceDialog open={flushOpen} onClose={() => setFlushOpen(false)} onFlushed={() => refetchKeys()} />
    </div>
  );
}

export default function RedisPage() {
  return <BISLayout title="Redis" subtitle="Cache & Session Store"><RedisPageInner /></BISLayout>;
}
