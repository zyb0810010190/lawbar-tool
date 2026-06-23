#!/bin/bash
# check-marker-guard.sh — fail-closed A0.7 marker tamper/fabrication guard (WI-ENA10).
#
# Per ADR A07-GATE-00 §5/§8 and ADR A07-MARK-00: an A0.7 marker is durable, provenance-valid
# evidence of a real harness pass. No marker WRITER or VALIDATOR is authorized yet (those are
# separate future WIs), so the accepted-marker set is EMPTY. This guard therefore REJECTS, fail-
# closed, ANY file under the marker namespace:
#
#     dev-memo/run/evidence/**
#
# That makes a fabricated / hand-touched / copied / schema-only marker impossible to land
# unnoticed: with no authorized writer, every such file fails. A harness result with
# isMarker=false is not a marker and cannot satisfy this guard (the harness never writes here).
#
# This guard does NOT: write a marker, generate provenance, compute HMAC/signatures, manage key
# custody, or CREATE the marker namespace. It only inspects + classifies paths, read-only.
#
# When a future, authorized marker-writer/validator WI lands, it replaces the empty accepted set
# with a provenance-valid acceptance check (re-read bound artifacts, verify tamper-evidence, and
# the ledger-bound non-replay check from A07-MARK-00 §4/§5). Until then: reject all.
#
# Usage:
#   check-marker-guard.sh [--scan]            # tracked files + working tree under the namespace (default)
#   check-marker-guard.sh --staged            # staged paths (git diff --cached)
#   check-marker-guard.sh --paths <p1> <p2>   # classify the given paths (no disk access; for tests)
#
# Exit: 0 = OK (no marker-namespace files); 2 = FAIL (a marker-namespace file is present/proposed).
set -u

MARKER_NS="dev-memo/run/evidence"
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

mode="--scan"
declare -a paths=()
case "${1:-}" in
  --paths)  shift; paths=("$@"); mode="--paths" ;;
  --staged) mode="--staged" ;;
  --scan|"") mode="--scan" ;;
  *) echo "check-marker-guard: unknown arg '${1}'"; exit 2 ;;
esac

declare -a candidates=()
case "$mode" in
  --paths)
    candidates=("${paths[@]:-}")
    ;;
  --staged)
    while IFS= read -r p; do [ -n "$p" ] && candidates+=("$p"); done \
      < <(git -C "$ROOT" diff --cached --name-only 2>/dev/null)
    ;;
  --scan)
    # Tracked files (catches a committed marker) ...
    while IFS= read -r p; do [ -n "$p" ] && candidates+=("$p"); done \
      < <(git -C "$ROOT" ls-files 2>/dev/null)
    # ... plus ANY entry physically present under the namespace — files, symlinks, dirs (not just
    # regular files), so an untracked symlink/created marker cannot slip past. Read-only: we never
    # create the directory here. `-mindepth 1` lists everything beneath the namespace.
    if [ -d "$ROOT/$MARKER_NS" ]; then
      while IFS= read -r p; do [ -n "$p" ] && candidates+=("${p#"$ROOT"/}"); done \
        < <(find "$ROOT/$MARKER_NS" -mindepth 1 2>/dev/null)
    fi
    ;;
esac

# Normalize a candidate path to a canonical repo-relative form so non-canonical inputs cannot evade
# the namespace prefix match. Lexical only (no filesystem): (a) if absolute under the repo ROOT,
# strip the ROOT prefix; (b) strip leading "./"; (c) collapse duplicate "/"; (d) resolve "." and ".."
# segments. (Git-derived paths are already canonical; this hardens --paths input + defense-in-depth.)
normalize_path() {
  local s="$1"
  case "$s" in "$ROOT"/*) s="${s#"$ROOT"/}" ;; esac
  while [ "${s#./}" != "$s" ]; do s="${s#./}"; done
  while [ "${s//\/\//\/}" != "$s" ]; do s="${s//\/\//\/}"; done
  local seg; local -a out=()
  local oldIFS="$IFS"; IFS='/'
  local -a parts=()
  read -ra parts <<< "$s"
  IFS="$oldIFS"
  for seg in "${parts[@]:-}"; do
    case "$seg" in
      ''|'.') continue ;;
      '..') [ "${#out[@]}" -gt 0 ] && unset 'out[${#out[@]}-1]' ;;
      *) out+=("$seg") ;;
    esac
  done
  local joined=""; local first=1
  for seg in "${out[@]:-}"; do
    [ -n "$seg" ] || continue
    if [ "$first" = 1 ]; then joined="$seg"; first=0; else joined="$joined/$seg"; fi
  done
  printf '%s' "$joined"
}

declare -a violations=()
norm=""
for p in "${candidates[@]:-}"; do
  [ -n "$p" ] || continue
  norm="$(normalize_path "$p")"
  case "$norm" in
    "$MARKER_NS"|"$MARKER_NS"/*) violations+=("$p") ;;  # report the original path as given
  esac
done

if [ "${#violations[@]}" -gt 0 ]; then
  echo "MARKER-GUARD: FAIL — file(s) under $MARKER_NS/** but no authorized A0.7 marker writer/validator exists."
  echo "  The accepted-marker set is EMPTY (fail-closed): a fabricated / touched / copied / schema-only marker is rejected."
  printf '  rejected: %s\n' "${violations[@]}"
  echo "  Per ADR A07-MARK-00: a valid marker requires a provenance-valid writer + tamper/fabrication validation"
  echo "  (re-read bound artifacts, verify HMAC/signature, ledger-bound non-replay). Until that WI lands, the"
  echo "  marker namespace must remain absent. See docs/adr/ADR-evidence-a07-marker-provenance.md."
  exit 2
fi

echo "MARKER-GUARD: OK — no files under $MARKER_NS/** (marker namespace absent; nothing to validate)."
exit 0
