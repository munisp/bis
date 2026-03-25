/**
 * GoamlXmlPreviewSheet
 * Slide-over panel that shows the generated FATF goAML 4.0 XML for a filing.
 * Compliance officers can review the XML before clicking "Submit to NFIU".
 */
import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Copy, Download, Send, FileCode2, CheckCircle2, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface GoamlXmlPreviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filingId: number | null;
  filingRef?: string;
  onSubmitSuccess?: (goamlRef: string) => void;
}

/**
 * Syntax-highlight XML by wrapping tags, attributes, and values in coloured spans.
 * Returns an array of JSX spans for rendering inside a <pre>.
 */
function highlightXml(xml: string): React.ReactNode {
  // Split on XML tokens using a regex that captures them
  const parts = xml.split(/(<[^>]+>)/g);
  return parts.map((part, i) => {
    if (part.startsWith("</")) {
      return <span key={i} className="text-blue-400">{part}</span>;
    }
    if (part.startsWith("<?")) {
      return <span key={i} className="text-gray-400 italic">{part}</span>;
    }
    if (part.startsWith("<")) {
      // Tag with attributes — colour tag name cyan, attributes amber
      const coloured = part
        .replace(/^(<\/?)([a-zA-Z_:][a-zA-Z0-9_:.-]*)/, (_, slash, name) =>
          `${slash}<span class="xml-tag">${name}</span>`
        )
        .replace(/ ([a-zA-Z_:][a-zA-Z0-9_:.-]*)=/g, (_, attr) =>
          ` <span class="xml-attr">${attr}</span>=`
        )
        .replace(/"([^"]*)"/g, (_, val) => `"<span class="xml-val">${val}</span>"`);
      return (
        <span
          key={i}
          className="text-cyan-400"
          dangerouslySetInnerHTML={{ __html: coloured }}
        />
      );
    }
    // Text content
    return part ? (
      <span key={i} className="text-emerald-300">{part}</span>
    ) : null;
  });
}

export default function GoamlXmlPreviewSheet({
  open,
  onOpenChange,
  filingId,
  filingRef,
  onSubmitSuccess,
}: GoamlXmlPreviewSheetProps) {
  const [submitted, setSubmitted] = useState(false);

  const { data: xmlData, isLoading: xmlLoading } = trpc.goaml.getXml.useQuery(
    { id: filingId! },
    { enabled: open && filingId != null }
  );

  const submitMutation = trpc.goaml.submit.useMutation({
    onSuccess: (result) => {
      setSubmitted(true);
      toast.success("STR submitted to NFIU", {
        description: `Reference: ${result.goamlReferenceNumber}`,
      });
      onSubmitSuccess?.(result.goamlReferenceNumber);
    },
    onError: (e) => toast.error("Submission failed", { description: e.message }),
  });

  const xml = xmlData?.xml ?? "";

  const handleCopy = () => {
    navigator.clipboard.writeText(xml);
    toast.success("XML copied to clipboard");
  };

  const handleDownload = () => {
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filingRef ?? "goaml-str"}.xml`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("XML downloaded");
  };

  const handleSubmit = () => {
    if (!filingId) return;
    submitMutation.mutate({ id: filingId });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col gap-0 p-0"
      >
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <FileCode2 className="h-5 w-5 text-amber-500" />
            <div>
              <SheetTitle className="text-base">goAML XML Preview</SheetTitle>
              <SheetDescription className="text-xs mt-0.5">
                FATF goAML 4.0 schema — review before submitting to NFIU
              </SheetDescription>
            </div>
            {filingRef && (
              <Badge variant="outline" className="ml-auto text-xs font-mono">
                {filingRef}
              </Badge>
            )}
          </div>
        </SheetHeader>

        {/* XML viewer */}
        <ScrollArea className="flex-1 px-6 py-4">
          {xmlLoading ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading XML…</span>
            </div>
          ) : xml ? (
            <pre className="text-xs font-mono leading-relaxed bg-zinc-950 text-zinc-100 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-all border border-zinc-800">
              <style>{`
                .xml-tag { color: #67e8f9; }
                .xml-attr { color: #fbbf24; }
                .xml-val { color: #86efac; }
              `}</style>
              {highlightXml(xml)}
            </pre>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-12">
              No XML available for this filing.
            </div>
          )}
        </ScrollArea>

        <Separator />

        <SheetFooter className="px-6 py-4 flex flex-row items-center gap-2 justify-between">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!xml}
              className="gap-1.5"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy XML
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={!xml}
              className="gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </Button>
          </div>

          {submitted ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
              <CheckCircle2 className="h-4 w-4" />
              Submitted to NFIU
            </div>
          ) : (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!xml || submitMutation.isPending}
              className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
            >
              {submitMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Submit to NFIU
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
