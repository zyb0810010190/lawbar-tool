# Queue review 055 — WI-ENA2 (BATCH-CASEBOX-EVIDENCE-NATIVE-PDFKIT-PROBE)

**Date**: 2026-06-22.
**WI**: WI-ENA2 — extend the merged `native/evidence-core-swift/` skeleton with a **PDFKit compile/import
probe**: `import PDFKit` + a deterministic capability value (e.g. `pdfKitAvailable == true` on macOS) + a
Swift test proving PDFKit import/availability. A compile/import/capability probe ONLY — no PDF load/parse,
no geometry, no renderer-conformance, no A0.7, no marker, no provenance/HMAC, no UI/product behavior. The
second user-authorized implementation hard-stop. **HIGH-RISK** (new native framework dependency on the
Evidence native-core path).
**Queue**: `dev-memo/run/queue.md` (single WI; prior WI-ENA1 executed + merged via PR #103, `34e6c43`).
**Reviewed queue.md sha256**: `6a8b229e61359b21c3deb9cd75cea67710590269df3480548f6d7ebe42e958c4`.

## cc-suite invocation (required recording)

- **Kind**: review-plan (HIGH-RISK; broker required, no self-review).
- **Target scope**: `dev-memo/run/queue.md` WI-ENA2 block (compact packet inlined) + ENA0 feasibility plan
  §1-§3 + ADR ENA-00 + the merged ENA1 skeleton it extends (read-only).
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqpx08sv-624mtc`.
- **threadId**: none emitted.
- **rawOutput sha256**: `ffd7461149eaf006fac146f98e5859f989491e821c812135de303bfc36de3feb`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict

**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**SCOPE-ASSESSMENT: NOT-BROADER** (Codex confirmed the WI does not cross into geometry, A0.7, marker,
provenance, UI, or JS-shim behavior, and is not broader than a PDFKit compile/import probe).

Codex confirmed (adversarially): ENA2 is **strictly** a PDFKit compile/import/capability probe extending the
ENA1 skeleton — feasible as `import PDFKit` + a deterministic `pdfKitAvailable == true` symbol + a macOS
Swift test, with **no** PDF load/parse, **no** geometry, **no** renderer-conformance, **no** A0.7 harness,
**no** marker/provenance/HMAC, **no** UI/product behavior, and **no** change to the `native/evidence-core` JS
shim. Risk classified correctly as HIGH-RISK (new native framework dependency). Per the user's stop-if-broader
gate: scope is NOT broader → eligible to govern + implement.

## Low-risk clarifications (folded into implementation; non-blocking)

1. **`macos-latest` is a moving image** — it does NOT guarantee Apple Swift 5.9.x. The local toolchain note
   (5.9.2) is about the LOCAL machine; CI must NOT be described as pinned to 5.9.x. Implementation: README/status
   note says "Apple Swift on macOS CI" (unpinned), and neither the probe symbol nor the test asserts a specific
   Swift/Xcode version.
2. **Capability value = compile-gated constant** (`#if canImport(PDFKit)` → `pdfKitAvailable == true`), NOT
   runtime PDF behavior. The probe and its test MUST NOT instantiate or load `PDFDocument` (no PDF parsing).
3. **`Package.swift` changed only if** required for linking/platform declaration (otherwise left as-is).

These sharpen the design within the authorized boundary; they do not expand scope, so the verdict stands as
READY and governance proceeds.

## Disposition

READY → eligible to govern. Proceeding to mark-reviewed + govern (standalone, content-bound to sha
`6a8b229e…`). HIGH-RISK: after implementation, broker `/cc-suite:audit` + `/cc-suite:verify` run on the impl
scope before commit. User authorization for the PDFKit-compile/import-probe step was given explicitly;
PDF load/parse, geometry, renderer-conformance, A0.7, marker, provenance/HMAC, hooks, and UI remain separate
hard-stops.

QUEUE_REVIEW_VERDICT=PASS
