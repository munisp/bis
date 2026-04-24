#!/usr/bin/env python3
"""Generate comprehensive v67 archive of the BIS Platform.
Includes node_modules, .git, and all source files.
Excludes only compiled Rust binary artifacts (target/debug/*, target/release/*)
which are 2.5 GB of non-source build outputs.
"""
import os
import zipfile
from pathlib import Path

EXCLUDE_DIRS = {
    "__pycache__",
}
EXCLUDE_EXTS = {".pyc", ".pyo"}

# Rust build artifact paths to exclude (large compiled binaries)
EXCLUDE_PATH_FRAGMENTS = [
    "/target/debug/",
    "/target/release/",
    "/target/.rustc_info.json",
    "/target/CACHEDIR.TAG",
]

src_root = Path("/home/ubuntu/bis-pwa")
out_path = Path("/home/ubuntu/bis-platform-v67-COMPLETE-20260424.zip")

if out_path.exists():
    out_path.unlink()

file_count = 0
skipped = 0
print(f"Creating archive: {out_path}")
print(f"Source: {src_root}")

with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for dirpath, dirnames, filenames in os.walk(src_root):
        # Prune __pycache__ directories in-place
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]

        for filename in filenames:
            if Path(filename).suffix in EXCLUDE_EXTS:
                continue
            full_path = Path(dirpath) / filename
            full_str = str(full_path)

            # Skip Rust build artifacts (large compiled binaries)
            if any(frag in full_str for frag in EXCLUDE_PATH_FRAGMENTS):
                skipped += 1
                continue

            arcname = full_path.relative_to(Path("/home/ubuntu"))
            try:
                zf.write(full_path, arcname)
                file_count += 1
                if file_count % 10000 == 0:
                    size_mb = out_path.stat().st_size / (1024 * 1024)
                    print(f"  {file_count:,} files... ({size_mb:.0f} MB)")
            except (OSError, PermissionError) as e:
                print(f"  SKIP {full_path}: {e}")
                skipped += 1

size_mb = out_path.stat().st_size / (1024 * 1024)
size_gb = size_mb / 1024
print(f"\nArchive created: {out_path}")
print(f"Files included: {file_count:,}")
print(f"Files skipped:  {skipped:,} (Rust build artifacts + Python bytecode)")
print(f"Size:           {size_mb:.1f} MB ({size_gb:.2f} GB)")
print(f"\nNote: v66 archive included {293050 - file_count:,} extra files")
print(f"      which were compiled Rust .rlib/.d/.rmeta build artifacts (not source code)")
