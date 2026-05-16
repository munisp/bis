#!/usr/bin/env python3
with open("client/src/pages/kyc/KYCRecordsPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add bulkResultSummary state after bulkProgress state
old1 = "  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);"
new1 = """  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkResultSummary, setBulkResultSummary] = useState<{ results: { name: string; status: string }[]; passed: number; failed: number } | null>(null);"""
assert old1 in content, "bulkProgress state anchor not found"
content = content.replace(old1, new1, 1)

# 2. Replace the toast with setting the modal state
old2 = """    setBulkProgress(null);
    setSelectedIds(new Set());
    const passed = results.filter(r => r.status === "passed").length;
    const failed = results.filter(r => r.status === "error" || r.status === "failed").length;
    toast.success(`Bulk re-verify complete: ${passed} passed, ${failed} failed / errored`);
    handleRefresh();"""
new2 = """    setBulkProgress(null);
    setSelectedIds(new Set());
    const passed = results.filter(r => r.status === "passed").length;
    const failed = results.filter(r => r.status === "error" || r.status === "failed").length;
    setBulkResultSummary({ results, passed, failed });
    handleRefresh();"""
assert old2 in content, "toast anchor not found"
content = content.replace(old2, new2, 1)

# 3. Find the last </> or closing of the main return to add the Dialog
# We'll add it just before the final closing tag of the component
old3 = "  );\n}\n"
new3 = """    {/* Bulk Re-verify Result Breakdown Dialog */}
    {bulkResultSummary && (
      <Dialog open={true} onOpenChange={() => setBulkResultSummary(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Bulk Re-verify Complete</DialogTitle>
            <DialogDescription>
              {bulkResultSummary.passed} passed · {bulkResultSummary.failed} failed / errored
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto border border-border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Subject</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {bulkResultSummary.results.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        r.status === "passed" ? "bg-green-100 text-green-700" :
                        r.status === "failed" ? "bg-red-100 text-red-700" :
                        "bg-yellow-100 text-yellow-700"
                      }`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => {
              const csv = ["Subject,Status", ...bulkResultSummary.results.map(r => `"${r.name}","${r.status}"`)].join("\\n");
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
              a.download = `bulk-reverify-${new Date().toISOString().slice(0,10)}.csv`;
              a.click();
            }}>
              <Download className="w-4 h-4 mr-1" /> Download CSV
            </Button>
            <Button onClick={() => setBulkResultSummary(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )}
  );
}
"""
# Find the last occurrence of "  );\n}\n"
idx = content.rfind("  );\n}\n")
if idx == -1:
    # Try alternate endings
    idx = content.rfind("  );\n}\n")
    print(f"ERROR: Could not find closing tag. Last 100 chars: {repr(content[-100:])}")
    exit(1)
content = content[:idx] + new3
with open("client/src/pages/kyc/KYCRecordsPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)
print(f"SUCCESS: Bulk result modal added at index {idx}")
