#!/usr/bin/env python3
"""
Generate comprehensive v69 archive of the BIS platform.
Includes all source code, node_modules, .git, and services.
Excludes: Rust target/ build artifacts (compiled binaries), Python __pycache__, .pyc files.
"""
import zipfile
import os
import sys
from pathlib import Path

SOURCE_DIR = Path("/home/ubuntu/bis-pwa")
OUTPUT = Path("/home/ubuntu/bis-platform-v69-COMPLETE-20260424.zip")

# Directories to skip entirely (build artifacts, not source)
SKIP_DIRS = {
    ".manus-logs",
    "__pycache__",
}

# File patterns to skip
SKIP_EXTENSIONS = {".pyc", ".pyo"}

def should_skip(path: Path, rel: str) -> bool:
    parts = rel.split("/")
    # Skip Rust target directories
    if "target" in parts:
        idx = parts.index("target")
        # Keep Cargo.toml, Cargo.lock, src/ — skip compiled artifacts
        remaining = parts[idx + 1:]
        if remaining and remaining[0] in ("debug", "release", "x86_64-unknown-linux-gnu", ".fingerprint", "incremental", "build", "deps"):
            return True
    # Skip named dirs
    for part in parts:
        if part in SKIP_DIRS:
            return True
    # Skip by extension
    if path.suffix in SKIP_EXTENSIONS:
        return True
    return False

def main():
    if OUTPUT.exists():
        OUTPUT.unlink()
        print(f"Removed existing archive: {OUTPUT}")

    file_count = 0
    skipped = 0

    print(f"Creating archive: {OUTPUT}")
    print(f"Source: {SOURCE_DIR}")

    with zipfile.ZipFile(OUTPUT, "w", zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as zf:
        for root, dirs, files in os.walk(SOURCE_DIR):
            root_path = Path(root)
            rel_root = root_path.relative_to(SOURCE_DIR.parent)

            # Filter dirs in-place to avoid descending into skip dirs
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]

            for fname in files:
                fpath = root_path / fname
                rel = str(rel_root / fname)

                if should_skip(fpath, rel):
                    skipped += 1
                    continue

                try:
                    zf.write(fpath, rel)
                    file_count += 1
                    if file_count % 5000 == 0:
                        size_mb = OUTPUT.stat().st_size / 1024 / 1024
                        print(f"  {file_count:,} files... ({size_mb:.0f} MB)")
                except Exception as e:
                    print(f"  WARN: skipped {rel}: {e}", file=sys.stderr)

    final_size = OUTPUT.stat().st_size / 1024 / 1024
    print(f"\nDone!")
    print(f"  Files included: {file_count:,}")
    print(f"  Files skipped:  {skipped:,}")
    print(f"  Archive size:   {final_size:.1f} MB")
    print(f"  Output:         {OUTPUT}")

if __name__ == "__main__":
    main()
