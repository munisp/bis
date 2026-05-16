#!/usr/bin/env python3
with open("client/src/pages/kyc/KYCRecordsPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# Remove the useEffect from its current (wrong) position
bad_block = """  // Set indeterminate state on select-all checkbox
  useEffect(() => {
    const eligible = filtered.filter(r => r.status === "review" || r.status === "failed");
    const someSelected = eligible.some(r => selectedIds.has(r.id));
    const allSelected = eligible.length > 0 && eligible.every(r => selectedIds.has(r.id));
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [filtered, selectedIds]);
  const toggleSelect"""

good_block = """  const toggleSelect"""

assert bad_block in content, "Bad block not found"
content = content.replace(bad_block, good_block, 1)

# Insert it after the filtered useMemo declaration (after the closing });)
anchor = """  }, [allLoaded, statusFilter, search]);

  const handleExportCSV"""
new_anchor = """  }, [allLoaded, statusFilter, search]);

  // Set indeterminate state on select-all checkbox
  useEffect(() => {
    const eligible = filtered.filter(r => r.status === "review" || r.status === "failed");
    const someSelected = eligible.some(r => selectedIds.has(r.id));
    const allSelected = eligible.length > 0 && eligible.every(r => selectedIds.has(r.id));
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [filtered, selectedIds]);

  const handleExportCSV"""

assert anchor in content, "Anchor not found"
content = content.replace(anchor, new_anchor, 1)

with open("client/src/pages/kyc/KYCRecordsPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)
print("SUCCESS: useEffect moved after filtered declaration")
