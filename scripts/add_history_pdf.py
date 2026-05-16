#!/usr/bin/env python3
with open("client/src/pages/bis/ZeroFootprintPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# Replace the Re-run button div to add a PDF button alongside it
old = """                        <div className="flex justify-end pt-1">
                          <button
                            onClick={() => {
                              const rd = record.requestData as any;
                              setForm(f => ({
                                ...f,
                                subjectName: record.subjectName ?? "",
                                subjectId: rd?.subjectId ?? "",
                                subjectAddress: rd?.subjectAddress ?? "",
                                state: rd?.state ?? "Lagos",
                                lga: rd?.lga ?? "",
                                phone: rd?.phone ?? "",
                                statedEmployer: rd?.statedEmployer ?? "",
                                statedIncome: rd?.statedIncome ?? "",
                                selectedPillars: rd?.selectedPillars ?? f.selectedPillars,
                                fieldAgentZone: rd?.fieldAgentZone ?? "Lagos",
                                notes: rd?.notes ?? "",
                              }));
                              setView("form");
                            }}
                            className="text-xs text-orange-600 hover:text-orange-700 font-medium flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-orange-50 transition-all"
                          >
                            ↺ Re-run Investigation
                          </button>
                        </div>"""

new = """                        <div className="flex justify-between items-center pt-1">
                          <button
                            onClick={() => exportPdfMutation.mutate({ id: record.id })}
                            disabled={exportPdfMutation.isPending}
                            className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-blue-50 transition-all disabled:opacity-50"
                          >
                            ⬇️ PDF
                          </button>
                          <button
                            onClick={() => {
                              const rd = record.requestData as any;
                              setForm(f => ({
                                ...f,
                                subjectName: record.subjectName ?? "",
                                subjectId: rd?.subjectId ?? "",
                                subjectAddress: rd?.subjectAddress ?? "",
                                state: rd?.state ?? "Lagos",
                                lga: rd?.lga ?? "",
                                phone: rd?.phone ?? "",
                                statedEmployer: rd?.statedEmployer ?? "",
                                statedIncome: rd?.statedIncome ?? "",
                                selectedPillars: rd?.selectedPillars ?? f.selectedPillars,
                                fieldAgentZone: rd?.fieldAgentZone ?? "Lagos",
                                notes: rd?.notes ?? "",
                              }));
                              setView("form");
                            }}
                            className="text-xs text-orange-600 hover:text-orange-700 font-medium flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-orange-50 transition-all"
                          >
                            ↺ Re-run Investigation
                          </button>
                        </div>"""

assert old in content, "History card Re-run button not found"
content = content.replace(old, new, 1)

with open("client/src/pages/bis/ZeroFootprintPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)
print("SUCCESS: PDF button added to history cards")
