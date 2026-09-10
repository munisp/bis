#!/usr/bin/env bash
# Reject active references to the retained legacy React Native client. The
# historical mobile/ directory is intentionally excluded: its contents remain
# available solely for approved forensic continuity and migration reference.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

matches="$(
  {
    git grep -n -I -E '(^|[^[:alnum:]_-])mobile/' -- . ':(exclude)mobile/**' ':(exclude)scripts/check-deprecated-mobile-references.sh' || true
    git grep -n -I -E '(/home/ubuntu/bis/mobile|working-directory:[[:space:]]*mobile([[:space:]]|$)|cache-dependency-path:[[:space:]]*mobile/|(^|[[:space:];])cd[[:space:]]+mobile([[:space:];]|$))' -- . ':(exclude)mobile/**' ':(exclude)scripts/check-deprecated-mobile-references.sh' || true
  } | LC_ALL=C sort -u
)"

if [[ -n "$matches" ]]; then
  printf '%s\n' 'Deprecated mobile-client references found outside mobile/:' >&2
  printf '%s\n' "$matches" >&2
  exit 1
fi

printf '%s\n' 'PASS: no active references to the deprecated mobile client were found outside mobile/.'
