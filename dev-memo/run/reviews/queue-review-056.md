# Queue review 056 — WI-ENA3 (BATCH-CASEBOX-EVIDENCE-NATIVE-PDF-LOAD-PROBE)

**Date**: 2026-06-22.
**WI**: WI-ENA3 — extend the merged `native/evidence-core-swift/` package with a **PDF load / page-count
probe**: `EvidenceCorePdfLoadProbe.load(url:)` loads a tiny SYNTHETIC PDF via `PDFDocument(url:)` and returns
`{loaded, pageCount}`; a Swift test loads a committed tiny synthetic fixture and asserts `loaded == true` and
`pageCount == 2` on macOS. A load / page-count probe ONLY — page COUNT is structural, NOT geometry; no
coordinates, no page boxes, no page-identity/citation, no renderer-conformance, no A0.7, no marker,
no provenance/HMAC, no UI/product behavior, no JS-shim change. The third user-authorized implementation
hard-stop. **HIGH-RISK** (first PDF load/parse on the Evidence native-core path + a committed binary fixture).
**Queue**: `dev-memo/run/queue.md` (single WI; prior WI-ENA2 executed + merged via PR #104, `a77c780`).
**Reviewed queue.md sha256**: `c34bf9cd0765b7b1a9c7d21cb6b5dd48be0610f09a9f95d5cfa98959856031ca`.

## cc-suite invocation (required recording)

- **Kind**: review-plan (HIGH-RISK; broker required, no self-review).
- **Target scope**: `dev-memo/run/queue.md` WI-ENA3 block (compact packet inlined) + ENA0 feasibility plan
  §1-§3 + ADR ENA-00 + evidence-genie.md invariants + the merged ENA1/ENA2 package (read-only).
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqpxu4mv-11c64u`.
- **threadId**: none emitted.
- **rawOutput sha256**: `a1021af25d2fc326a9051aede08dedb22dbb640a1894c15ae04910ed2fe3a331`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict

**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**SCOPE-ASSESSMENT: NOT-BROADER** (Codex confirmed nothing crosses into geometry, page boxes, page
identity/citation, anchors, A0.7, marker, provenance, UI, or JS-shim behavior; `pageCount` is structural
metadata, not geometry).

Codex confirmed (adversarially): ENA3 is **strictly** a PDF load / page-count probe — feasible as
`PDFDocument(url:)` + `pageCount` + a committed tiny synthetic fixture, with no new dependency and no geometry.
A committed deterministic synthetic PDF is **preferred over** test-time generation (stable, reviewable). Risk
classified correctly as HIGH-RISK (first PDF load behavior + binary fixture). Per the user's stop-if-broader
gate: scope is NOT broader → eligible to govern + implement.

## Low-risk clarifications (folded into implementation; non-blocking)

1. **Fixture provenance + checksum in the README.** Codex asked for a generation recipe/checksum showing the
   fixture has no fonts/images/text/confidential content. Implementation: the README records the deterministic
   minimal-PDF generation recipe and the fixture sha256
   (`63d91a6c75cc10350c0a15df19a12620d938637acf3529c15cab7d4e6e0d9276`, 432 bytes, two empty Letter pages).
2. **Positive boundary grep.** The verification grep positively confirms NO `PDFPage`/`page(at:)`/`.bounds`/
   `CGRect`/`CGPoint`/rendering APIs/`mediaBox`/`cropBox` and NO marker/HMAC/provenance terms appear outside the
   allowed probe/test paths.
3. **Clean macOS-only guards.** `pdfKitAvailable`/`load(url:)` and the page-count assertion are guarded by
   `#if canImport(PDFKit)` / `#if os(macOS)` so the package degrades cleanly off macOS (CI is macOS-only).

These sharpen the design within the authorized boundary; they do not expand scope, so the verdict stands as
READY and governance proceeds.

## Disposition

READY → eligible to govern. Proceeding to mark-reviewed + govern (standalone, content-bound to sha
`c34bf9cd…`). HIGH-RISK: after implementation, broker `/cc-suite:audit` + `/cc-suite:verify` run on the impl
scope before commit. User authorization for the PDF-load/page-count-probe step (synthetic/public fixture only)
was given explicitly; geometry, coordinates, page boxes, page identity/citation, anchors, renderer-conformance,
A0.7, marker, provenance/HMAC, hooks, and UI remain separate hard-stops.

QUEUE_REVIEW_VERDICT=PASS
