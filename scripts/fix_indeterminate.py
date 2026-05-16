#!/usr/bin/env python3
with open("client/src/pages/kyc/KYCRecordsPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add useRef import (already has useState, useMemo, useCallback, useEffect)
content = content.replace(
    "import React, { useState, useMemo, useCallback, useEffect } from \"react\";",
    "import React, { useState, useMemo, useCallback, useEffect, useRef } from \"react\";"
)

# 2. Add selectAllRef declaration after the bulkResultSummary state
old_state = "  const [bulkResultSummary, setBulkResultSummary] = useState<{ results: { name: string; status: string }[]; passed: number; failed: number } | null>(null);"
new_state = """  const [bulkResultSummary, setBulkResultSummary] = useState<{ results: { name: string; status: string }[]; passed: number; failed: number } | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);"""
content = content.replace(old_state, new_state, 1)

# 3. Add useEffect to set indeterminate state on the ref
old_toggle = "  const toggleSelect = useCallback((id: number) => {"
new_toggle = """  // Set indeterminate state on select-all checkbox
  useEffect(() => {
    const eligible = filtered.filter(r => r.status === "review" || r.status === "failed");
    const someSelected = eligible.some(r => selectedIds.has(r.id));
    const allSelected = eligible.length > 0 && eligible.every(r => selectedIds.has(r.id));
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [filtered, selectedIds]);

  const toggleSelect = useCallback((id: number) => {"""
content = content.replace(old_toggle, new_toggle, 1)

# 4. Wire the ref to the checkbox
old_cb = """                      <input
                        type="checkbox"
                        className="rounded border-border cursor-pointer"
                        checked={filtered.filter(r => r.status === "review" || r.status === "failed").length > 0 &&
                          filtered.filter(r => r.status === "review" || r.status === "failed").every(r => selectedIds.has(r.id))}
                        onChange={() => toggleSelectAll(filtered)}
                        title="Select all eligible records"
                      />"""
new_cb = """                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        className="rounded border-border cursor-pointer"
                        checked={filtered.filter(r => r.status === "review" || r.status === "failed").length > 0 &&
                          filtered.filter(r => r.status === "review" || r.status === "failed").every(r => selectedIds.has(r.id))}
                        onChange={() => toggleSelectAll(filtered)}
                        title="Select all eligible records"
                      />"""
assert old_cb in content, "Checkbox not found"
content = content.replace(old_cb, new_cb, 1)

with open("client/src/pages/kyc/KYCRecordsPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)
print("SUCCESS: Indeterminate checkbox state added")
