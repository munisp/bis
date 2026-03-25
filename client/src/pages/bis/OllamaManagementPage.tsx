import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Brain, Cpu, MessageSquare, Database, AlertTriangle,
  CheckCircle2, RefreshCw, Send, Zap, BarChart2, Loader2,
} from "lucide-react";
import BISLayout from "@/components/BISLayout";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModelInfo {
  name: string;
  size: number;
  modified_at: string;
  digest: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OllamaManagementPage() {
  const [selectedModel, setSelectedModel] = useState("llama3.2");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("You are a BIS compliance assistant. Answer questions about AML, KYC, and fraud investigation.");
  const [lakehouseQuestion, setLakehouseQuestion] = useState("");
  const [lakehouseResult, setLakehouseResult] = useState<{ sql?: string; model?: string } | null>(null);
  const [riskSubject, setRiskSubject] = useState("");
  const [riskScore, setRiskScore] = useState(65);
  const [riskFactors, setRiskFactors] = useState("PEP status, High-risk jurisdiction, Unusual transaction patterns");
  const [riskExplanation, setRiskExplanation] = useState("");
  const [mediaSubject, setMediaSubject] = useState("");
  const [mediaArticle, setMediaArticle] = useState("");
  const [mediaResult, setMediaResult] = useState<any>(null);

  // Queries
  const { data: health, refetch: refetchHealth, isLoading: healthLoading } = trpc.ollama.health.useQuery(undefined, { retry: false });
  const { data: modelsData, isLoading: modelsLoading } = trpc.ollama.listModels.useQuery(undefined, { retry: false });
  const models: ModelInfo[] = (modelsData as any)?.models ?? [];

  // Mutations
  const chatMutation = trpc.ollama.chat.useMutation({
    onSuccess: (data: any) => {
      const content = data?.message?.content ?? data?.choices?.[0]?.message?.content ?? JSON.stringify(data);
      setChatMessages(prev => [...prev, { role: "assistant", content }]);
    },
    onError: (e) => toast.error("Chat failed: " + e.message),
  });

  const lakehouseMutation = trpc.ollama.lakehouseQuery.useMutation({
    onSuccess: (data: any) => setLakehouseResult(data),
    onError: (e) => toast.error("Lakehouse query failed: " + e.message),
  });

  const riskMutation = trpc.ollama.explainRisk.useMutation({
    onSuccess: (data: any) => setRiskExplanation(data?.explanation ?? ""),
    onError: (e) => toast.error("Risk explanation failed: " + e.message),
  });

  const mediaMutation = trpc.ollama.analyseMedia.useMutation({
    onSuccess: (data: any) => setMediaResult(data),
    onError: (e) => toast.error("Media analysis failed: " + e.message),
  });

  const handleChat = () => {
    if (!chatInput.trim()) return;
    const userMsg: ChatMessage = { role: "user", content: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    chatMutation.mutate({
      messages: [...chatMessages, userMsg],
      model: selectedModel,
      system: systemPrompt || undefined,
    });
  };

  const isOnline = (health as any)?.ollama_online === true;
  const statusColor = healthLoading ? "bg-amber-500" : isOnline ? "bg-emerald-500" : "bg-red-500";
  const statusLabel = healthLoading ? "Checking..." : isOnline ? "Online" : "Offline";

  return (
    <BISLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="w-7 h-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Ollama AI Engine</h1>
              <p className="text-sm text-muted-foreground">Local LLM integration for BIS compliance intelligence</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className={`w-2 h-2 rounded-full ${statusColor} animate-pulse`} />
              <span className="text-muted-foreground">Ollama: <span className="text-foreground font-medium">{statusLabel}</span></span>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchHealth()} disabled={healthLoading}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${healthLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Status cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Default Model", value: (health as any)?.default_model ?? selectedModel, icon: <Brain className="w-4 h-4" /> },
            { label: "Loaded Models", value: modelsLoading ? "…" : String(models.length), icon: <Cpu className="w-4 h-4" /> },
            { label: "Adapter Status", value: (health as any)?.status ?? "unknown", icon: <Zap className="w-4 h-4" /> },
            { label: "Endpoints", value: "6 active", icon: <BarChart2 className="w-4 h-4" /> },
          ].map(({ label, value, icon }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">{icon}<span className="text-xs">{label}</span></div>
                <p className="font-semibold capitalize">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="chat">
          <TabsList className="grid grid-cols-5 w-full max-w-2xl">
            <TabsTrigger value="chat"><MessageSquare className="w-3.5 h-3.5 mr-1.5" />Chat</TabsTrigger>
            <TabsTrigger value="lakehouse"><Database className="w-3.5 h-3.5 mr-1.5" />Lakehouse</TabsTrigger>
            <TabsTrigger value="risk"><AlertTriangle className="w-3.5 h-3.5 mr-1.5" />Risk</TabsTrigger>
            <TabsTrigger value="media"><Brain className="w-3.5 h-3.5 mr-1.5" />Media</TabsTrigger>
            <TabsTrigger value="models"><Cpu className="w-3.5 h-3.5 mr-1.5" />Models</TabsTrigger>
          </TabsList>

          {/* ── Chat ── */}
          <TabsContent value="chat" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="lg:col-span-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Compliance Chat</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="h-72 overflow-y-auto border rounded p-3 space-y-3 bg-muted/20">
                    {chatMessages.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center mt-8">Start a conversation with the local LLM</p>
                    )}
                    {chatMessages.map((msg, i) => (
                      <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                          {msg.content}
                        </div>
                      </div>
                    ))}
                    {chatMutation.isPending && (
                      <div className="flex justify-start">
                        <div className="bg-muted rounded-lg px-3 py-2">
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Ask about AML, KYC, sanctions..."
                      onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleChat()}
                    />
                    <Button onClick={handleChat} disabled={chatMutation.isPending || !chatInput.trim()}>
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setChatMessages([])}>Clear chat</Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Settings</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Model</Label>
                    <Select value={selectedModel} onValueChange={setSelectedModel}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {models.length > 0
                          ? models.map(m => <SelectItem key={m.name} value={m.name}>{m.name}</SelectItem>)
                          : ["llama3.2", "llama3.1", "mistral", "phi3", "gemma2"].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)
                        }
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">System Prompt</Label>
                    <Textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={6} className="text-xs" />
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Lakehouse NL→SQL ── */}
          <TabsContent value="lakehouse" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Natural Language → SQL (Lakehouse)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Question</Label>
                  <Input
                    value={lakehouseQuestion}
                    onChange={(e) => setLakehouseQuestion(e.target.value)}
                    placeholder="e.g. Show me the top 10 high-risk investigations from Nigeria in the last 30 days"
                  />
                </div>
                <Button
                  onClick={() => lakehouseMutation.mutate({ question: lakehouseQuestion, model: selectedModel })}
                  disabled={lakehouseMutation.isPending || !lakehouseQuestion.trim()}
                >
                  {lakehouseMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Database className="w-4 h-4 mr-2" />}
                  Generate SQL
                </Button>
                {lakehouseResult && (
                  <div className="space-y-2">
                    <Label className="text-xs">Generated SQL</Label>
                    <pre className="bg-muted/50 rounded p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">{lakehouseResult.sql}</pre>
                    <p className="text-xs text-muted-foreground">Model: {lakehouseResult.model}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Risk Explanation ── */}
          <TabsContent value="risk" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Risk Score Explanation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Subject Name</Label>
                    <Input value={riskSubject} onChange={(e) => setRiskSubject(e.target.value)} placeholder="John Doe" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Risk Score (0–100)</Label>
                    <Input type="number" min={0} max={100} value={riskScore} onChange={(e) => setRiskScore(Number(e.target.value))} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Risk Factors (comma-separated)</Label>
                  <Input value={riskFactors} onChange={(e) => setRiskFactors(e.target.value)} />
                </div>
                <Button
                  onClick={() => riskMutation.mutate({
                    subject: riskSubject,
                    riskScore,
                    factors: riskFactors.split(",").map(f => f.trim()).filter(Boolean),
                    model: selectedModel,
                  })}
                  disabled={riskMutation.isPending || !riskSubject.trim()}
                >
                  {riskMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <AlertTriangle className="w-4 h-4 mr-2" />}
                  Generate Explanation
                </Button>
                {riskExplanation && (
                  <div className="bg-muted/40 rounded p-4 text-sm leading-relaxed">{riskExplanation}</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Adverse Media ── */}
          <TabsContent value="media" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Adverse Media Analysis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Subject</Label>
                  <Input value={mediaSubject} onChange={(e) => setMediaSubject(e.target.value)} placeholder="Company or individual name" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Article / Text</Label>
                  <Textarea value={mediaArticle} onChange={(e) => setMediaArticle(e.target.value)} rows={6} placeholder="Paste news article or text to analyse..." />
                </div>
                <Button
                  onClick={() => mediaMutation.mutate({ subject: mediaSubject, article: mediaArticle, model: selectedModel })}
                  disabled={mediaMutation.isPending || !mediaSubject.trim() || !mediaArticle.trim()}
                >
                  {mediaMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Brain className="w-4 h-4 mr-2" />}
                  Analyse
                </Button>
                {mediaResult && (
                  <div className="bg-muted/40 rounded p-4 space-y-2">
                    <div className="flex items-center gap-3">
                      <Badge variant={mediaResult.relevant ? "destructive" : "secondary"}>
                        {mediaResult.relevant ? "Adverse" : "Clean"}
                      </Badge>
                      {mediaResult.severity && <Badge variant="outline" className="capitalize">{mediaResult.severity}</Badge>}
                      {mediaResult.category && <Badge variant="outline" className="capitalize">{mediaResult.category}</Badge>}
                    </div>
                    {mediaResult.summary && <p className="text-sm">{mediaResult.summary}</p>}
                    {mediaResult.raw && <pre className="text-xs font-mono whitespace-pre-wrap">{mediaResult.raw}</pre>}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Models ── */}
          <TabsContent value="models" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Loaded Models</CardTitle>
              </CardHeader>
              <CardContent>
                {modelsLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-4">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Loading models…</span>
                  </div>
                ) : models.length === 0 ? (
                  <div className="text-center py-8">
                    <Cpu className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No models loaded or Ollama is offline.</p>
                    <p className="text-xs text-muted-foreground mt-1">Run <code className="bg-muted px-1 rounded">ollama pull llama3.2</code> to get started.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {models.map((model) => (
                      <div key={model.name} className="flex items-center justify-between p-3 bg-muted/40 rounded">
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          <div>
                            <p className="font-medium text-sm">{model.name}</p>
                            <p className="text-xs text-muted-foreground">{model.digest?.slice(0, 12)}…</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">{formatBytes(model.size)}</p>
                          <p className="text-xs text-muted-foreground">{new Date(model.modified_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-4 p-3 bg-muted/20 rounded text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">Quick Commands</p>
                  <p><code className="bg-muted px-1 rounded">ollama pull llama3.2</code> — 2B parameter, fast inference</p>
                  <p><code className="bg-muted px-1 rounded">ollama pull mistral</code> — 7B, strong reasoning</p>
                  <p><code className="bg-muted px-1 rounded">ollama pull nomic-embed-text</code> — embeddings for semantic search</p>
                  <p><code className="bg-muted px-1 rounded">ollama pull phi3</code> — Microsoft Phi-3, efficient</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </BISLayout>
  );
}
