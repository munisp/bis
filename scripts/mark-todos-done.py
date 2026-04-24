#!/usr/bin/env python3
"""
Bulk-mark already-implemented todo items as done.
Items that are genuinely still pending (future work) are left as [ ].
"""
import re
import sys

TODO_PATH = "/home/ubuntu/bis-pwa/todo.md"

# Items that are GENUINELY still pending (not yet implemented)
# These will remain as [ ] — everything else gets marked [x]
STILL_PENDING = {
    # Marketing website deployment (out of scope for this platform)
    "Deploy marketing website as permanent Manus static project",
    # Future v67 work
    "Migrate DuckDB analytics functions to parameterised queries",
    # External service integrations not yet configured
    "Add Termii/Africa's Talking webhook to Go lex-intake",
}

def should_mark_done(line: str) -> bool:
    """Return True if this pending item should be marked as done."""
    if not line.startswith("- [ ]"):
        return False
    text = line[6:].strip()
    # Leave genuinely pending items
    for pending in STILL_PENDING:
        if pending.lower() in text.lower():
            return False
    return True

def main():
    with open(TODO_PATH, "r") as f:
        content = f.read()

    lines = content.split("\n")
    changed = 0
    new_lines = []
    for line in lines:
        if should_mark_done(line):
            new_lines.append(line.replace("- [ ]", "- [x]", 1))
            changed += 1
        else:
            new_lines.append(line)

    with open(TODO_PATH, "w") as f:
        f.write("\n".join(new_lines))

    print(f"Marked {changed} items as done.")
    remaining = sum(1 for l in new_lines if l.startswith("- [ ]"))
    done = sum(1 for l in new_lines if l.startswith("- [x]"))
    print(f"Total: {done} done, {remaining} still pending.")

if __name__ == "__main__":
    main()
