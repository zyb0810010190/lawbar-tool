#!/bin/bash
# check-a07-gate.sh — EVW5 A0.7 hard gate (reality-gate enforcement).
#
# Wires the A0.7 marker reality gate into hard workflow enforcement: a protected, A0.7-DEPENDENT lane
# may not pass unless a genuine, provenance-valid LOCAL A0.7 marker exists. Per the Evidence
# invariants (evidence-genie.md inv.3/inv.4 + A07-GATE-00 §1): nothing that depends on "A0.7 green"
# (Evidence anchors/architecture/UI) may proceed until A0.7 is really green — proven by a valid marker,
# not by a file merely existing.
#
# Behavior (fail-closed):
#   1. ALWAYS delegate to check-marker-guard.sh --scan, which (a) rejects committed/tracked evidence
#      material unconditionally, (b) rejects fabricated/touched/copied/schema-only LOCAL markers, and
#      (c) accepts only provenance-valid local markers (requires LAWBAR_A07_MARKER_HMAC_KEY). A clean
#      tree with no markers passes this step.
#   2. Determine whether the current action is A0.7-DEPENDENT ("required"):
#        - A07_REQUIRED=1|true|yes in the environment, OR
#        - any line in dev-memo/run/queue.md declares `Requires-A07: yes|true`.
#   3. If required: at least ONE provenance-valid local marker must exist (env key present +
#      a07_marker.py validate passes). Otherwise FAIL CLOSED (missing/invalid marker, or absent key).
#   4. If NOT required: pass (no marker is needed; a clean tree is fine).
#
# This gate NEVER writes a marker, NEVER creates the namespace, NEVER relaxes the marker guard, and
# NEVER treats an isMarker=false harness result as marker-valid. It is read-only enforcement.
set -u
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
NS="dev-memo/run/evidence"
GUARD="$HERE/check-marker-guard.sh"
MARKER_PY="$HERE/a07_marker.py"
LEDGER="$ROOT/$NS/ledger.jsonl"

# 1. Marker guard must pass (rejects committed/fabricated; validates genuine local markers).
if ! bash "$GUARD" --scan >/dev/null 2>&1; then
  echo "A07-GATE: FAIL — marker guard rejected evidence material (committed/fabricated/unverifiable local marker)."
  bash "$GUARD" --scan 2>&1 | sed 's/^/  /'
  exit 2
fi

# 2. Is the current action A0.7-dependent?
required=0
case "${A07_REQUIRED:-}" in 1|true|TRUE|yes|YES) required=1 ;; esac
if [ "$required" -eq 0 ] && [ -f "$ROOT/dev-memo/run/queue.md" ]; then
  if grep -qiE '^[[:space:]]*Requires-A07:[[:space:]]*(yes|true)[[:space:]]*$' "$ROOT/dev-memo/run/queue.md"; then
    required=1
  fi
fi

if [ "$required" -eq 0 ]; then
  echo "A07-GATE: OK — current action is not A0.7-dependent; no local marker required."
  exit 0
fi

# 3. Required: at least one provenance-valid local marker must exist.
valid=0
if [ -d "$ROOT/$NS/a07" ]; then
  for m in "$ROOT/$NS"/a07/*.marker.json; do
    [ -e "$m" ] || continue
    if python3 "$MARKER_PY" validate --marker "$m" --ledger "$LEDGER" >/dev/null 2>&1; then
      valid=1; break
    fi
  done
fi
if [ "$valid" -ne 1 ]; then
  echo "A07-GATE: FAIL (fail-closed) — this action is A0.7-DEPENDENT but no provenance-valid local A0.7 marker exists."
  echo "  A0.7 must be genuinely green first: produce a marker with scripts/workflow/a07-marker-write.sh and set"
  echo "  LAWBAR_A07_MARKER_HMAC_KEY. A fabricated/touched/copied marker or a missing key fails closed; an"
  echo "  isMarker=false harness result is not a marker. See docs/adr/ADR-evidence-a07-marker-provenance.md."
  exit 2
fi

echo "A07-GATE: OK — A0.7-dependent action gated by a provenance-valid local A0.7 marker."
exit 0
