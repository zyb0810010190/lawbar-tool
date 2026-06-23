# Queue review 057 — WI-ENA4 (BATCH-CASEBOX-EVIDENCE-NATIVE-PAGEBOX-PROBE)

**Date**: 2026-06-22.
**WI**: WI-ENA4 — extend the merged `native/evidence-core-swift/` package with a **page-box inspection
probe**: `EvidenceCorePageBoxProbe.inspectMediaBoxes(url:)` loads the EXISTING synthetic fixture, reads each
page's `mediaBox` extent via `page.bounds(for: .mediaBox)`, and returns `{loaded, mediaBoxes:[{width,height}]}`;
a Swift test asserts each of 2 pages is `612 x 792`. A page-box READ probe ONLY — reading box extents is
structural metadata, NOT coordinate math; no coordinate transforms, no normalized coordinates, no anchors, no
page identity/citation, no geometry classification, no rendering, no renderer-conformance, no A0.7, no marker,
no provenance/HMAC, no UI/product behavior, no JS-shim change, no new fixture. The fourth user-authorized
implementation hard-stop. **HIGH-RISK** (first page-geometry-adjacent read on the Evidence native-core path).
**Queue**: `dev-memo/run/queue.md` (single WI; prior WI-ENA3 executed + merged via PR #105, `61c0ca0`).
**Reviewed queue.md sha256**: `f6b019530c1c9691a555fe2bc5790e400455ffed6ed5c82b91322b7a9313132e`.

## cc-suite invocation (required recording)

- **Kind**: review-plan (HIGH-RISK; broker required, no self-review).
- **Target scope**: `dev-memo/run/queue.md` WI-ENA4 block (compact packet inlined) + ENA0 feasibility plan
  §1-§3 + ADR ENA-00 + evidence-genie.md invariants + the merged ENA1/ENA2/ENA3 package (read-only).
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqpz0m5m-05yyke`.
- **threadId**: none emitted.
- **rawOutput sha256**: `4f60861e31fecb2b41b800c440df714b235ee29b1f6a165f476fb73719a63ea5`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict

**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**SCOPE-ASSESSMENT: NOT-BROADER** (Codex confirmed reading raw width/height is structural PDF metadata, not
coordinate math, and nothing crosses into transforms, normalized coordinates, anchors, page identity/citation,
geometry classification, rendering, renderer-conformance, A0.7, marker, provenance, UI, or JS-shim behavior).

Codex confirmed (adversarially): ENA4 is **strictly** a page-box READ probe — feasible as load existing
fixture + `page.bounds(for: .mediaBox)` + assert `612 x 792`, no new dependency, no new fixture. Reading
width/height alone is genuinely distinct from the anchor-geometry hard-stop (it maps no points, normalizes no
coordinates, identifies no citation, classifies no geometry, claims no renderer conformance). Risk classified
correctly as HIGH-RISK. Per the user's stop-if-broader gate: scope is NOT broader → eligible to govern +
implement.

## Low-risk clarifications (folded into implementation; non-blocking)

1. **`.mediaBox` only** — not cropBox/mediaBox alternatives. Implementation: the probe reads `.mediaBox` only
   (`inspectMediaBoxes`); the queue's "and/or cropBox" wording is narrowed to mediaBox-only in code.
2. **Return only `width`/`height`** — no origin, no rect, no page-index/page-identity semantics beyond array
   order. Implementation: `PageBox` is exactly `{width, height}`.
3. **Forbid coordinate/anchor vocabulary in symbol names** — no `Geometry`/`Anchor`/`Coordinate`/`Normalize`/
   `Citation`/`Renderer`. Implementation: symbols are `EvidenceCorePageBoxProbe`, `PageBox`, `InspectResult`,
   `inspectMediaBoxes`, `mediaBoxes`, `width`, `height` — none use the forbidden roots.
4. **README wording** — must say this proves only that PDFKit can read raw page-box extents. Implementation:
   the README/status note states page-box-read-proven / no-coordinate-transforms / no-A0.7 / no-marker /
   no-product-behavior, and that it reads raw `mediaBox` width/height only.

These sharpen the design within the authorized boundary; they do not expand scope, so the verdict stands as
READY and governance proceeds.

## Disposition

READY → eligible to govern. Proceeding to mark-reviewed + govern (standalone, content-bound to sha
`f6b01953…`). HIGH-RISK: after implementation, broker `/cc-suite:audit` + `/cc-suite:verify` run on the impl
scope before commit. User authorization for the page-box-inspection-probe step was given explicitly;
coordinate transforms, normalized coordinates, anchors, page identity/citation, geometry classification,
rendering, renderer-conformance, A0.7, marker, provenance/HMAC, hooks, and UI remain separate hard-stops.

QUEUE_REVIEW_VERDICT=PASS
