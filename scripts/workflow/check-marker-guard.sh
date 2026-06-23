#!/bin/bash
# check-marker-guard.sh — fail-closed A0.7 marker tamper/fabrication guard (WI-ENA10; extended WI-ENA11).
#
# Per ADR A07-GATE-00 §5/§8 and ADR A07-MARK-00: an A0.7 marker is durable, provenance-valid
# evidence of a real harness pass. Markers are LOCAL-ONLY run-state under the namespace:
#
#     dev-memo/run/evidence/**     (gitignored; NEVER committed)
#
# Guard policy:
#   * --staged AND tracked files (git ls-files) under the namespace — including the ledger — are
#     rejected UNCONDITIONALLY: committed/staged markers are never allowed.
#   * --scan validates only UNTRACKED (local) markers: a *.marker.json is accepted ONLY if it is
#     provenance-valid via scripts/workflow/a07_marker.py (HMAC over the canonical payload + matching
#     bound fixture/oracle bytes + a ledger-bound runId), which requires LAWBAR_A07_MARKER_HMAC_KEY.
#     The guard-owned ledger.jsonl is skipped; any other namespace file is rejected. Without the key
#     (or on any validation failure) it FAILS CLOSED. A fabricated / hand-touched / copied / schema-
#     only marker, and an isMarker=false harness result, all fail. A clean tree (no markers, e.g. CI)
#     passes.
#
# This guard itself does NOT write a marker, generate provenance, compute HMAC, manage key custody,
# or CREATE the marker namespace. It inspects + classifies paths and delegates marker validation to
# a07_marker.py (read-only). The marker WRITER is scripts/workflow/a07-marker-write.sh.
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

HERE="$(cd "$(dirname "$0")" && pwd)"
LEDGER_REL="$MARKER_NS/ledger.jsonl"

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
under_ns() { case "$1" in "$MARKER_NS"|"$MARKER_NS"/*) return 0 ;; *) return 1 ;; esac; }
# Validate a genuine LOCAL marker via the provenance core (HMAC + bound-artifact + ledger checks).
validate_local_marker() {
  python3 "$HERE/a07_marker.py" validate --marker "$ROOT/$1" --ledger "$ROOT/$LEDGER_REL" >/dev/null 2>&1
}

declare -a violations=()

if [ "$mode" = "--paths" ] || [ "$mode" = "--staged" ]; then
  # Unconditional: ANY namespace path given/staged is rejected. Committed/staged markers (and the
  # ledger) are NEVER allowed — markers are local-only run-state.
  declare -a candidates=()
  if [ "$mode" = "--paths" ]; then
    candidates=("${paths[@]:-}")
  else
    while IFS= read -r p; do [ -n "$p" ] && candidates+=("$p"); done \
      < <(git -C "$ROOT" diff --cached --name-only 2>/dev/null)
  fi
  for p in "${candidates[@]:-}"; do
    [ -n "$p" ] || continue
    under_ns "$(normalize_path "$p")" && violations+=("$p")
  done
else
  # --scan: (1) tracked namespace files = committed markers => ALWAYS reject.
  declare -A tracked_ns=()
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    n="$(normalize_path "$p")"
    if under_ns "$n"; then tracked_ns["$n"]=1; violations+=("$p (committed marker material — never allowed)"); fi
  done < <(git -C "$ROOT" ls-files 2>/dev/null)
  # (2) Untracked working-tree entries (files + symlinks) under the namespace: validate genuine local
  #     markers, skip the guard-owned ledger, reject anything else. Read-only: never creates the dir.
  if [ -d "$ROOT/$MARKER_NS" ]; then
    while IFS= read -r abs; do
      [ -n "$abs" ] || continue
      rel="${abs#"$ROOT"/}"; n="$(normalize_path "$rel")"
      under_ns "$n" || continue
      [ -n "${tracked_ns[$n]:-}" ] && continue
      case "$n" in
        "$LEDGER_REL") : ;;  # guard-owned ledger, not a marker
        *.marker.json)
          if ! validate_local_marker "$n"; then violations+=("$rel (not a provenance-valid local marker)"); fi ;;
        *) violations+=("$rel (non-marker file in marker namespace)") ;;
      esac
    done < <(find "$ROOT/$MARKER_NS" -mindepth 1 \( -type f -o -type l \) 2>/dev/null)
  fi
fi

if [ "${#violations[@]}" -gt 0 ]; then
  echo "MARKER-GUARD: FAIL — dev-memo/run/evidence/** material that is not a genuine, provenance-valid local marker."
  printf '  rejected: %s\n' "${violations[@]}"
  echo "  Committed/staged markers (and the ledger) are NEVER allowed; a LOCAL marker is accepted only when"
  echo "  provenance-valid: HMAC over the canonical payload + matching bound fixture/oracle bytes + a ledger-bound"
  echo "  runId, with LAWBAR_A07_MARKER_HMAC_KEY set. Fabricated/touched/copied/schema-only markers fail."
  echo "  See docs/adr/ADR-evidence-a07-marker-provenance.md and scripts/workflow/a07_marker.py."
  exit 2
fi

echo "MARKER-GUARD: OK — no committed marker material; any local markers present are provenance-valid (or namespace absent)."
exit 0
