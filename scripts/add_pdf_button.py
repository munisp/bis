#!/usr/bin/env python3
with open("client/src/pages/bis/ZeroFootprintPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add osintRecordId state after osintReport state
old1 = "  const [osintReport, setOsintReport] = useState<string | null>(null);"
new1 = """  const [osintReport, setOsintReport] = useState<string | null>(null);
  const [osintRecordId, setOsintRecordId] = useState<number | null>(null);"""
assert old1 in content, "State anchor not found"
content = content.replace(old1, new1, 1)

# 2. Set osintRecordId in onSuccess
old2 = "      setOsintReport(data.result);\n      setInvestigation(inv);"
new2 = "      setOsintReport(data.result);\n      setOsintRecordId(data.id ?? null);\n      setInvestigation(inv);"
assert old2 in content, "onSuccess anchor not found"
content = content.replace(old2, new2, 1)

# 3. Clear osintRecordId in reset
old3 = 'setView("form"); setOsintReport(null); setInvestigation(null); }}'
new3 = 'setView("form"); setOsintReport(null); setInvestigation(null); setOsintRecordId(null); }}'
assert old3 in content, "Reset anchor not found"
content = content.replace(old3, new3, 1)

# 4. Add exportOsintPdf mutation after the zeroFootprintMutation
old4 = "  const handleSubmit = (e: React.FormEvent) => {"
new4 = """  const exportPdfMutation = trpc.screening.exportOsintPdf.useMutation({
    onSuccess: (data) => {
      const a = document.createElement("a");
      a.href = data.url;
      a.download = data.filename;
      a.target = "_blank";
      a.click();
      toast.success("PDF report downloaded");
    },
    onError: (e) => toast.error(`PDF export failed: ${e.message}`),
  });

  const handleSubmit = (e: React.FormEvent) => {"""
assert old4 in content, "handleSubmit anchor not found"
content = content.replace(old4, new4, 1)

# 5. Replace the Download Report button with a PDF download button
old5 = '''              <button onClick={() => {
                if (!osintReport) return;
                const blob = new Blob([osintReport], { type: "text/plain" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `osint-${investigation?.investigationId ?? "report"}.md`;
                a.click();
              }} className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 rounded-xl text-sm flex items-center justify-center gap-2">
                <span>⬇️</span> Download Report
              </button>'''
new5 = '''              <button onClick={() => {
                if (!osintReport) return;
                const blob = new Blob([osintReport], { type: "text/plain" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `osint-${investigation?.investigationId ?? "report"}.md`;
                a.click();
              }} className="flex-1 bg-card border border-border text-muted-foreground font-medium py-3 rounded-xl text-sm flex items-center justify-center gap-2">
                <span>⬇️</span> Download .md
              </button>
              <button
                onClick={() => { if (osintRecordId) exportPdfMutation.mutate({ id: osintRecordId }); }}
                disabled={!osintRecordId || exportPdfMutation.isPending}
                className="flex-1 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm flex items-center justify-center gap-2"
              >
                {exportPdfMutation.isPending ? "Generating…" : "⬇️ Download PDF"}
              </button>'''
assert old5 in content, "Download button anchor not found"
content = content.replace(old5, new5, 1)

with open("client/src/pages/bis/ZeroFootprintPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)
print("SUCCESS: PDF export button added to ZeroFootprintPage")
