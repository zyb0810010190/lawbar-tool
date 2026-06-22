# native/evidence-core — Evidence-Genie M0 harness contract shim (JS-only)

**This is NOT the Swift/PDFKit A0.7 implementation.** It is a dependency-free Node deterministic-JSON
**contract shim**: it pins the command surface, the JSON envelope, and the failure semantics so the rest of
the workflow (e.g. `/evidence-geometry-gate`) can wire to a stable contract — *before* the real native
Evidence Core exists.

The real implementation (Swift + SwiftPM + PDFKit, macOS-only) is a **separate, explicitly-authorized
autonomy hard-stop WI** (new runtime/toolchain). It is deferred — see
`dev-memo/plan-batch-casebox-evidence-workflow-port-00.md` (WI-EVW7) and
`docs/adr/ADR-evidence-m0-xiaolai-workflow-composition.md` (EVW-00). Until it lands,
**`renderer-conformance` (A0.7) and every other gate report `not_implemented`, which FAILS — never passes.**

## Command surface (10 commands)

**Utility commands (2) — pass (exit 0):**
- `version` — prints the schema version + the command inventory + a shim/not-real-core flag.
- `healthcheck` — confirms the shim runs.

**Evidence gate commands (8) — `not_implemented`, i.e. FAIL (exit non-zero):**
- `renderer-conformance` (A0.7 — the first real Evidence architecture gate; stays not_implemented here)
- `geometry-roundtrip`
- `citation-stability-gate`
- `coordinate-roundtrip`
- `a3-regression`
- `snapshot-verify`
- `golden-export`
- `compress-readability-fixtures`

An unknown/malformed command returns deterministic error JSON and exits non-zero.

## Contract

```
{ "schemaVersion": "1.0.0", "ok": <bool>, "command": "<name>",
  "status": "passed" | "not_implemented" | "failed" | "error",
  "diagnostics": [ ... ],
  "result": { ... }    // present when ok
  // or
  "error": { "code": "...", "message": "..." }   // present when not ok
}
```

- Deterministic: **no timestamps, no randomness**; stable key order; stable `schemaVersion`.
- Exit codes: `passed` → 0; `not_implemented` / `failed` → 1; unknown/malformed → 2.
- `not_implemented` is a **failure**, never a pass.
- **No command writes a file, a marker, or anything under `dev-memo/run/evidence/`.** No A0.7-green marker
  is ever fabricated here; the real, provenance-protected marker is produced only by the future native A0.7
  harness.

## Usage

```
node native/evidence-core/cli.mjs version              # exit 0
node native/evidence-core/cli.mjs healthcheck          # exit 0
node native/evidence-core/cli.mjs renderer-conformance # status not_implemented, exit 1
node native/evidence-core/cli.mjs bogus                # error JSON, exit 2
```

## Tests

```
npm --prefix native/evidence-core test     # node --test tests/*.test.mjs
```
