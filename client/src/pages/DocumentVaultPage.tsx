import { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import BISLayout from "@/components/BISLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Upload, Search, FileText, Shield, Eye, Trash2, Download,
  Clock, FolderOpen, AlertTriangle, RefreshCw, ChevronLeft, ChevronRight,
  Lock, Unlock, File, FileImage, FileVideo, FileArchive,
} from "lucide-react";

const CATEGORIES = [
  { value: "identity_document", label: "Identity Document" },
  { value: "financial_statement", label: "Financial Statement" },
  { value: "court_order", label: "Court Order" },
  { value: "regulatory_filing", label: "Regulatory Filing" },
  { value: "sar_support", label: "SAR Support" },
  { value: "investigation_evidence", label: "Investigation Evidence" },
  { value: "kyc_document", label: "KYC Document" },
  { value: "aml_report", label: "AML Report" },
  { value: "correspondence", label: "Correspondence" },
  { value: "contract", label: "Contract" },
  { value: "other", label: "Other" },
];

function getFileIcon(mimeType?: string | null) {
  if (!mimeType) return <File className="w-5 h-5 text-slate-400" />;
  if (mimeType.startsWith("image/")) return <FileImage className="w-5 h-5 text-blue-400" />;
  if (mimeType.startsWith("video/")) return <FileVideo className="w-5 h-5 text-purple-400" />;
  if (mimeType.includes("pdf")) return <FileText className="w-5 h-5 text-red-400" />;
  if (mimeType.includes("zip") || mimeType.includes("tar")) return <FileArchive className="w-5 h-5 text-yellow-400" />;
  return <FileText className="w-5 h-5 text-slate-400" />;
}

function formatBytes(bytes?: number | null): string {
  if (!bytes) return "—";
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function getCategoryColor(cat?: string | null): string {
  const colors: Record<string, string> = {
    identity_document: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    financial_statement: "bg-green-500/20 text-green-300 border-green-500/30",
    court_order: "bg-red-500/20 text-red-300 border-red-500/30",
    regulatory_filing: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    sar_support: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    investigation_evidence: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    kyc_document: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
    aml_report: "bg-pink-500/20 text-pink-300 border-pink-500/30",
    correspondence: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
    contract: "bg-teal-500/20 text-teal-300 border-teal-500/30",
    other: "bg-slate-500/20 text-slate-300 border-slate-500/30",
  };
  return colors[cat ?? "other"] ?? colors.other;
}

export default function DocumentVaultPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [confidentialFilter, setConfidentialFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  // Upload dialog state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState<string>("other");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadConfidential, setUploadConfidential] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Detail dialog state
  const [detailDoc, setDetailDoc] = useState<number | null>(null);
  const [deleteDocId, setDeleteDocId] = useState<number | null>(null);
  const [deleteReason, setDeleteReason] = useState("");

  const utils = trpc.useUtils();

  const { data: stats } = trpc.documentVault.stats.useQuery();
  const { data, isLoading, refetch } = trpc.documentVault.list.useQuery({
    search: search || undefined,
    category: category !== "all" ? category : undefined,
    confidential: confidentialFilter === "confidential" ? true : confidentialFilter === "public" ? false : undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const { data: detailData } = trpc.documentVault.get.useQuery(
    { id: detailDoc! },
    { enabled: detailDoc !== null }
  );

  const uploadMutation = trpc.documentVault.upload.useMutation({
    onSuccess: () => {
      toast.success("Document uploaded successfully");
      setUploadOpen(false);
      setUploadFile(null);
      setUploadDescription("");
      utils.documentVault.list.invalidate();
      utils.documentVault.stats.invalidate();
    },
    onError: (e) => toast.error(`Upload failed: ${e.message}`),
  });

  const deleteMutation = trpc.documentVault.delete.useMutation({
    onSuccess: () => {
      toast.success("Document deleted");
      setDeleteDocId(null);
      setDeleteReason("");
      utils.documentVault.list.invalidate();
      utils.documentVault.stats.invalidate();
    },
    onError: (e) => toast.error(`Delete failed: ${e.message}`),
  });

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 50 * 1024 * 1024) {
        toast.error("File too large — maximum file size is 50 MB");
        return;
      }
      setUploadFile(file);
      setUploadOpen(true);
    }
  }, [toast]);

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = (e.target?.result as string).split(",")[1];
        await uploadMutation.mutateAsync({
          filename: uploadFile.name,
          mimeType: uploadFile.type || "application/octet-stream",
          base64Content: base64,
          sizeBytes: uploadFile.size,
          category: uploadCategory as any,
          description: uploadDescription || undefined,
          confidential: uploadConfidential,
        });
        setUploading(false);
      };
      reader.readAsDataURL(uploadFile);
    } catch {
      setUploading(false);
    }
  };

  const totalPages = Math.ceil((data?.total ?? 0) / PAGE_SIZE);

  return (
    <BISLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Document Vault</h1>
            <p className="text-slate-400 text-sm mt-1">
              Secure document storage with chain-of-custody tracking
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="border-slate-600 text-slate-300">
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button
              onClick={() => fileInputRef.current?.click()}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Document
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileSelect}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip,.txt,.csv"
            />
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <FolderOpen className="w-4 h-4 text-blue-400" />
                <span className="text-slate-400 text-xs">Total Documents</span>
              </div>
              <div className="text-2xl font-bold text-white">{stats?.total ?? 0}</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="w-4 h-4 text-red-400" />
                <span className="text-slate-400 text-xs">Confidential</span>
              </div>
              <div className="text-2xl font-bold text-red-400">{stats?.confidential ?? 0}</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-green-400" />
                <span className="text-slate-400 text-xs">Last 7 Days</span>
              </div>
              <div className="text-2xl font-bold text-green-400">{stats?.recentUploads ?? 0}</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <File className="w-4 h-4 text-purple-400" />
                <span className="text-slate-400 text-xs">Total Size</span>
              </div>
              <div className="text-2xl font-bold text-purple-400">{formatBytes(stats?.totalSizeBytes)}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search by filename or description..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(0); }}
                  className="pl-9 bg-slate-700 border-slate-600 text-white placeholder:text-slate-400"
                />
              </div>
              <Select value={category} onValueChange={v => { setCategory(v); setPage(0); }}>
                <SelectTrigger className="w-48 bg-slate-700 border-slate-600 text-white">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={confidentialFilter} onValueChange={v => { setConfidentialFilter(v); setPage(0); }}>
                <SelectTrigger className="w-40 bg-slate-700 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Access</SelectItem>
                  <SelectItem value="confidential">Confidential Only</SelectItem>
                  <SelectItem value="public">Non-Confidential</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Document Table */}
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-base">
              Documents ({data?.total ?? 0} total)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-12 text-slate-500">Loading documents...</div>
            ) : data?.documents.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No documents found</p>
                <p className="text-sm mt-1">Upload your first document to get started</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="text-left py-2 px-3 text-slate-400">Document</th>
                        <th className="text-left py-2 px-3 text-slate-400">Category</th>
                        <th className="text-left py-2 px-3 text-slate-400">Size</th>
                        <th className="text-left py-2 px-3 text-slate-400">Access</th>
                        <th className="text-left py-2 px-3 text-slate-400">Uploaded</th>
                        <th className="text-right py-2 px-3 text-slate-400">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.documents.map(doc => (
                        <tr key={doc.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-3">
                              {getFileIcon(doc.mimeType)}
                              <div>
                                <div className="text-white font-medium truncate max-w-xs">{doc.filename}</div>
                                {doc.description && (
                                  <div className="text-slate-400 text-xs truncate max-w-xs">{doc.description}</div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <Badge variant="outline" className={`text-xs ${getCategoryColor(doc.category)}`}>
                              {CATEGORIES.find(c => c.value === doc.category)?.label ?? doc.category ?? "Other"}
                            </Badge>
                          </td>
                          <td className="py-3 px-3 text-slate-300">{formatBytes(doc.sizeBytes)}</td>
                          <td className="py-3 px-3">
                            {doc.confidential ? (
                              <div className="flex items-center gap-1 text-red-400">
                                <Lock className="w-3 h-3" />
                                <span className="text-xs">Confidential</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 text-green-400">
                                <Unlock className="w-3 h-3" />
                                <span className="text-xs">Standard</span>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-slate-400 text-xs">
                            {new Date(doc.createdAt).toLocaleDateString("en-NG")}
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2 justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDetailDoc(doc.id)}
                                className="text-slate-400 hover:text-white h-7 w-7 p-0"
                                title="View details"
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              <a href={doc.url} target="_blank" rel="noopener noreferrer">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-blue-400 hover:text-blue-300 h-7 w-7 p-0"
                                  title="Download"
                                >
                                  <Download className="w-4 h-4" />
                                </Button>
                              </a>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteDocId(doc.id)}
                                className="text-red-400 hover:text-red-300 h-7 w-7 p-0"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-700">
                    <span className="text-slate-400 text-sm">
                      Page {page + 1} of {totalPages} ({data?.total} documents)
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                        className="border-slate-600 text-slate-300"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={page >= totalPages - 1}
                        className="border-slate-600 text-slate-300"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Category Breakdown */}
        {stats && stats.byCategory.length > 0 && (
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white text-base">Documents by Category</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {stats.byCategory
                  .sort((a, b) => b.count - a.count)
                  .map(cat => (
                    <button
                      key={cat.category}
                      onClick={() => { setCategory(cat.category ?? "other"); setPage(0); }}
                      className="flex items-center justify-between p-3 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-colors text-left"
                    >
                      <span className="text-slate-300 text-sm">
                        {CATEGORIES.find(c => c.value === cat.category)?.label ?? cat.category ?? "Other"}
                      </span>
                      <Badge variant="outline" className={`text-xs ${getCategoryColor(cat.category)}`}>
                        {cat.count}
                      </Badge>
                    </button>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {uploadFile && (
              <div className="flex items-center gap-3 p-3 bg-slate-700 rounded-lg">
                {getFileIcon(uploadFile.type)}
                <div>
                  <div className="text-white font-medium">{uploadFile.name}</div>
                  <div className="text-slate-400 text-xs">{formatBytes(uploadFile.size)}</div>
                </div>
              </div>
            )}
            <div>
              <Label className="text-slate-300">Category</Label>
              <Select value={uploadCategory} onValueChange={setUploadCategory}>
                <SelectTrigger className="mt-1 bg-slate-700 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-300">Description (optional)</Label>
              <Textarea
                value={uploadDescription}
                onChange={e => setUploadDescription(e.target.value)}
                placeholder="Brief description of this document..."
                className="mt-1 bg-slate-700 border-slate-600 text-white placeholder:text-slate-400"
                rows={3}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={uploadConfidential}
                onCheckedChange={setUploadConfidential}
                id="confidential"
              />
              <Label htmlFor="confidential" className="text-slate-300 flex items-center gap-2">
                <Lock className="w-4 h-4 text-red-400" />
                Mark as Confidential
              </Label>
            </div>
            {uploadConfidential && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <span className="text-red-300 text-sm">
                  Confidential documents are restricted to authorised personnel only.
                </span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} className="border-slate-600 text-slate-300">
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!uploadFile || uploading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {uploading ? "Uploading..." : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Document Detail Dialog */}
      <Dialog open={detailDoc !== null} onOpenChange={() => setDetailDoc(null)}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Document Details</DialogTitle>
          </DialogHeader>
          {detailData && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-slate-400 text-xs">Filename</Label>
                  <div className="text-white font-medium mt-1">{detailData.document.filename}</div>
                </div>
                <div>
                  <Label className="text-slate-400 text-xs">Category</Label>
                  <div className="mt-1">
                    <Badge variant="outline" className={getCategoryColor(detailData.document.category)}>
                      {CATEGORIES.find(c => c.value === detailData.document.category)?.label ?? detailData.document.category}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-slate-400 text-xs">Size</Label>
                  <div className="text-white mt-1">{formatBytes(detailData.document.sizeBytes)}</div>
                </div>
                <div>
                  <Label className="text-slate-400 text-xs">MIME Type</Label>
                  <div className="text-slate-300 mt-1 text-sm">{detailData.document.mimeType ?? "—"}</div>
                </div>
                <div>
                  <Label className="text-slate-400 text-xs">Access Level</Label>
                  <div className="mt-1">
                    {detailData.document.confidential ? (
                      <Badge className="bg-red-500/20 text-red-300 border-red-500/30">Confidential</Badge>
                    ) : (
                      <Badge className="bg-green-500/20 text-green-300 border-green-500/30">Standard</Badge>
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-slate-400 text-xs">Uploaded</Label>
                  <div className="text-slate-300 mt-1 text-sm">
                    {new Date(detailData.document.createdAt).toLocaleString("en-NG")}
                  </div>
                </div>
              </div>
              {detailData.document.description && (
                <div>
                  <Label className="text-slate-400 text-xs">Description</Label>
                  <div className="text-slate-300 mt-1 text-sm">{detailData.document.description}</div>
                </div>
              )}

              {/* Chain of Custody */}
              <div>
                <Label className="text-slate-400 text-xs mb-2 block">Chain of Custody</Label>
                {detailData.custodyChain.length === 0 ? (
                  <div className="text-slate-500 text-sm">No custody events recorded</div>
                ) : (
                  <div className="space-y-2">
                    {detailData.custodyChain.map(event => (
                      <div key={event.id} className="flex items-start gap-3 p-2 bg-slate-700/50 rounded-lg">
                        <Clock className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-white text-sm font-medium">{event.action}</div>
                          <div className="text-slate-400 text-xs">
                            {new Date(event.createdAt).toLocaleString("en-NG")}
                            {event.userId && ` · User #${event.userId}`}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <a href={detailData.document.url} target="_blank" rel="noopener noreferrer" className="flex-1">
                  <Button className="w-full bg-blue-600 hover:bg-blue-700">
                    <Download className="w-4 h-4 mr-2" />
                    Download Document
                  </Button>
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDocId !== null} onOpenChange={() => setDeleteDocId(null)}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="w-5 h-5" />
              Delete Document
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-slate-300">
              This action is permanent and will be recorded in the audit trail.
              Please provide a reason for deletion.
            </p>
            <div>
              <Label className="text-slate-300">Reason for Deletion</Label>
              <Textarea
                value={deleteReason}
                onChange={e => setDeleteReason(e.target.value)}
                placeholder="Enter reason for deletion..."
                className="mt-1 bg-slate-700 border-slate-600 text-white placeholder:text-slate-400"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDocId(null)} className="border-slate-600 text-slate-300">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteDocId && deleteReason.trim()) {
                  deleteMutation.mutate({ id: deleteDocId, reason: deleteReason });
                }
              }}
              disabled={!deleteReason.trim() || deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BISLayout>
  );
}
