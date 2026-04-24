#!/usr/bin/env python3
"""Generate comprehensive v68 archive of the BIS platform."""
import os
import zipfile
import sys
from pathlib import Path

SOURCE_DIR = Path("/home/ubuntu/bis-pwa")
OUTPUT_FILE = Path("/home/ubuntu/bis-platform-v68-COMPLETE-20260424.zip")

# Directories to skip (build artifacts, not source code)
SKIP_DIRS = {
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".manus-logs",
}

# Rust target directories (build artifacts — skip)
SKIP_RUST_TARGET = True

def should_skip(path: Path) -> bool:
    parts = path.parts
    for part in parts:
        if part in SKIP_DIRS:
            return True
        if part == "target" and SKIP_RUST_TARGET:
            # Check if it's a Rust target dir (has Cargo.toml sibling)
            target_parent = path
            for p in path.parents:
                if (p / "Cargo.toml").exists():
                    return True
                if p == SOURCE_DIR:
                    break
    return False

count = 0
skipped = 0

print(f"Generating archive: {OUTPUT_FILE}")
print(f"Source: {SOURCE_DIR}")

with zipfile.ZipFile(OUTPUT_FILE, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for root, dirs, files in os.walk(SOURCE_DIR):
        root_path = Path(root)
        
        # Filter out skip dirs in-place
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not (
            d == "target" and (root_path / "Cargo.toml").exists()
        )]
        
        for file in files:
            file_path = root_path / file
            if should_skip(file_path):
                skipped += 1
                continue
            try:
                arcname = file_path.relative_to(SOURCE_DIR.parent)
                zf.write(file_path, arcname)
                count += 1
                if count % 1000 == 0:
                    print(f"  {count} files archived...")
            except Exception as e:
                print(f"  SKIP {file_path}: {e}", file=sys.stderr)
                skipped += 1

size_mb = OUTPUT_FILE.stat().st_size / (1024 * 1024)
print(f"\nDone! {count} files archived, {skipped} skipped")
print(f"Archive size: {size_mb:.1f} MB")
print(f"Output: {OUTPUT_FILE}")
