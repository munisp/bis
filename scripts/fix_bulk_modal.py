#!/usr/bin/env python3
with open("client/src/pages/kyc/KYCRecordsPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# Remove the misplaced modal from KYCBiometricHistory (lines 770-824)
# The modal starts at "    {/* Bulk Re-verify Result Breakdown Dialog */}" inside KYCBiometricHistory
# and ends just before the final "}\n" of KYCBiometricHistory

bad_modal_block = """    {/* Bulk Re-verify Result Breakdown Dialog */}
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

if bad_modal_block not in content:
    print("ERROR: bad modal block not found")
    print("Last 200 chars of file:", repr(content[-200:]))
    exit(1)

# Remove the bad block (which incorrectly closes the file with );})
content = content.replace(bad_modal_block, "  );\n}\n", 1)

# Now insert the modal correctly before </BISLayout> in KYCRecordsPage
good_modal = """      {/* Bulk Re-verify Result Breakdown Dialog */}
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
    </BISLayout>"""

old_bis_close = "    </BISLayout>"
# Find the one inside KYCRecordsPage (not KYCBiometricHistory)
# The KYCRecordsPage ends at line 662 originally, so we replace only the first occurrence
if old_bis_close not in content:
    print("ERROR: </BISLayout> not found")
    exit(1)
content = content.replace(old_bis_close, good_modal, 1)

with open("client/src/pages/kyc/KYCRecordsPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)
print("SUCCESS: Bulk modal moved to correct location in KYCRecordsPage")
