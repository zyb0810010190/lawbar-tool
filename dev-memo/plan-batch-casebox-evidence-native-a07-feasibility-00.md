# BATCH-CASEBOX-EVIDENCE-NATIVE-A07-FEASIBILITY-00 (feasibility plan — proposal)

**Status**: proposal/feasibility plan (WI-ENA0). **Date**: 2026-06-22.
**Lane**: `evidence-native-a07-feasibility`. **Type**: PLAN (documentation only). **No implementation.**
**ADR**: `docs/adr/ADR-evidence-native-core-a07-feasibility.md` records the architectural decision this plan
proposes (cc-suite review-plan advised an ADR is warranted).

This plan **proposes** the Native Evidence Core / A0.7 work; it **performs none of it**. Introducing
**Swift / SwiftPM / PDFKit / macOS CI / a real A0.7 harness / an A0.7 marker** are **autonomy hard-stops
that require separate explicit user authorization** (§8). This WI creates no Swift files, no `Package.swift`,
no macOS CI, no marker, no UI, and no hooks.

## 1. Toolchain decision
**Recommendation: Swift + SwiftPM + PDFKit for the real native core; the current JS shim continues as the
contract/stub until that is authorized.** The Evidence-Genie M0 handover specifies PDFKit for render +
coordinate fidelity + page-identity stability — exactly what A0.7 validates. **PDFKit requires macOS**: it
is an Apple framework (AppKit/Quartz stack), not available on Linux. Local developer machines (counsel +
dev Macs) support it; **CI does not today** (the repo's only workflow runs on `ubuntu-latest`), so a real
A0.7 build/test needs a macOS runner (§2). Alternatives considered: (a) continue the JS shim only — cannot
test PDFKit coordinate fidelity, so A0.7 can never go green; (b) a non-PDFKit PDF renderer (pdfium etc.) —
diverges from the handover's controlled-renderer requirement and re-opens geometry-source risk. **Swift +
PDFKit is the soundest path; the JS shim bridges the contract until authorized.**

## 2. macOS CI decision
Real A0.7 conformance must run on macOS. **Required runner: a GitHub Actions `macos-latest`
(GitHub-hosted) runner** for the Swift build + the A0.7 conformance gate. **Cost/availability risk**:
GitHub-hosted macOS minutes bill at ~10× Linux and have lower concurrency; mitigate by running the macOS
job only on Evidence-core paths / a label, keeping the bulk on Linux. **Split**: `ubuntu-latest` keeps the
existing Node/Electron/contract tests (`npm --prefix apps/lawbar-desktop test`, `check-gates.sh`,
`check-contract-integrity.sh`); **`macos-latest`** runs the Swift native-core build + `renderer-conformance`
(A0.7) against synthetic fixtures. Introducing the macOS workflow is a **hard-stop** (§8).

## 3. Native-core boundary
- **Swift / PDFKit owns**: PDF render, geometry capture (resolved box, bounds, rotation, cropBox→mediaBox
  fallback), page-identity, ratio↔page-space↔ratio coordinate transforms, and the A0.7 conformance harness.
- **Node / Electron owns**: case-box persistence, IPC, the UI, and all existing services — unchanged.
- **CLI-contract compatibility**: the real Swift core exposes the **same** deterministic-JSON command
  surface as the existing `native/evidence-core` JS shim (10 commands; `version`/`healthcheck` pass; the 8
  gate commands). The Swift binary replaces the JS *stubs* for the gate commands while keeping the
  envelope (`schemaVersion`, `ok`, `command`, `status`, `diagnostics`, `result`|`error`) and exit-code
  semantics identical, so callers (e.g. `/evidence-geometry-gate`) do not change.

## 4. A0.7 renderer-conformance design
- **Fixtures**: a **synthetic / public** messy-卷宗 set — stamped scans, rotated pages, cropBox/mediaBox
  mismatch + non-zero origin, mixed page sizes, screenshot-style images, handwritten-IOU stand-ins. **No
  confidential client PDFs** (§6). Counsel-supplied real fixtures stay out of git unless separately authorized.
- **Invocation**: `native/evidence-core/cli renderer-conformance` (the Swift binary, same path/command as
  the shim).
- **Output**: deterministic JSON — stable `schemaVersion`, fixed fields, **no timestamps/randomness**; per
  fixture a resolved-box/bounds/rotation/round-trip result.
- **`not_implemented` → failed**: until the real harness exists, `renderer-conformance` stays
  `not_implemented` (exit non-zero) — never a pass.
- **Per-failure classification** (the load-bearing A0.7 semantics): **Class 1 — normalization bug** (page
  identity + geometry stable but a rect lands shifted/inverted/scaled: box-origin not subtracted, y-axis
  inversion, wrong rotation, cropBox/mediaBox ratio mismatch, viewport leak) → fix the A3-T2 normalization
  math and re-run; **no architecture reset**. **Class 2 — geometry-source instability** (the same unmodified
  file reopened yields unstable physicalPageIndex / page count / resolvedBox / bounds / rotation / geometry
  hash) → **STOP downstream work**; reassess the geometry-source assumption (import canonicalization, a
  different renderer, page fingerprinting, or a stronger page identity than physicalPageIndex). The harness
  **emits the class per failure**, not just pass/fail.

## 5. Marker provenance / tamper design (closes the prior EVW5 forgery hole)
- **Who creates the marker**: **only the real Swift A0.7 harness**, on a genuine conformance pass — never
  hand-authored, never by an agent.
- **Exact path**: `dev-memo/run/evidence/a07.renderer-conformance.passed.json`.
- **Schema**: `{ status:"passed", gate:"A0.7", command:"renderer-conformance", harnessVersion,
  fixtureSetSha256, resultSha256, producedBy:"native-evidence-core", provenanceHmac }` — where
  `provenanceHmac` is computed by the harness over `(harnessVersion, fixtureSetSha256, resultSha256)` with a
  key the harness holds; **schema-valid is NOT provenance-valid** (the EVW5 lesson).
- **How hand-authored markers are rejected**: a consumer (the future no-UI-before-A0.7 hook, and
  `/evidence-geometry-gate`) verifies the `provenanceHmac` against the recomputed digest; a hand-authored or
  edited marker has no valid HMAC → **rejected / not-green**. Missing / malformed / `not_implemented` → fail.
- **How Bash/Write/Edit fabrication is blocked later** (EVW5b work, hard-stop): (a) extend the run-control
  PreToolUse guards to **protect `dev-memo/run/evidence/**`** (deny agent Write/Edit/MultiEdit **and** Bash
  writes — incl. `plutil`/`PlistBuddy`/`sed -i`/`perl -i`/`cp`/`mv`/redirect/inline-interpreter — to that
  path, with canonical-path matching); AND (b) the HMAC check above, so even a write that slips a guard
  produces a marker that fails provenance verification. Two independent layers.

## 6. Data / security boundary
- **Local-only**; no cloud / no network; the Evidence app sandbox carries no network entitlements.
- **No confidential material in CI fixtures** — CI uses **synthetic / public fixtures only**. Real client
  卷宗 are never committed and never run in CI unless the user explicitly authorizes a private, access-controlled
  fixture path (a separate decision).
- The A0.7 harness reads only local fixtures; it writes only the provenance-protected marker (and only on a
  real pass), nothing else.

## 7. Migration path (JS shim → real Swift-backed implementation)
- The shim's **command names and output schema are preserved** (`schemaVersion`, `ok`/`command`/`status`/
  `diagnostics`/`result`|`error`; `version`/`healthcheck` pass; the 8 gates). The Swift implementation fills
  in the gate commands; `not_implemented` flips to real `passed`/`failed`.
- Compatibility: a `schemaVersion` bump happens **only** if the contract changes (additive fields preferred,
  so existing callers keep working). `/evidence-geometry-gate` keeps invoking `renderer-conformance`
  unchanged.
- Sequencing: keep the JS shim until the Swift core passes its own tests on macOS CI; then swap the gate
  command backends behind the same CLI.

## 8. Review gates and hard stops
- **Explicit user authorization is REQUIRED before** introducing SwiftPM / `Package.swift` / PDFKit /
  macOS CI / a real A0.7 harness / an A0.7 marker. Each is an **autonomy hard-stop** (new runtime/toolchain;
  new CI; security/provenance surface).
- **broker `/cc-suite:review-plan` is required** on the implementation plan (high-risk: native toolchain +
  security/provenance), with **broker `/cc-suite:audit` + `/cc-suite:verify`** after implementation.
- **No implementation until authorized.** This WI (ENA0) and this lane stop at proposal/ADR.

## 9. Relationship to future work
- **Real A0.7 implementation** — the downstream of this lane (separate, authorized, governed WIs).
- **EVW5 hard hooks (EVW5a/EVW5b)** — buildable once the real surfaces + the provenance-protected marker
  exist; they must cover Write/Edit/MultiEdit **and** Bash (incl. plist-mutation tools), canonical paths,
  and the marker-tamper protection in §5.
- **Evidence UI** — only after A0.7 is genuinely green (no UI before A0.7 green remains binding).

## References
- `docs/adr/ADR-evidence-native-core-a07-feasibility.md` (the decision record).
- `dev-memo/evidence-product-definition-closeout-00.md`, `dev-memo/plan-batch-casebox-evidence-workflow-port-00.md`,
  `docs/adr/ADR-evidence-m0-xiaolai-workflow-composition.md` (EVW-00), `.claude/rules/evidence-genie.md`,
  `docs/reference/evidence-genie-m0-developer-handover.md`, `native/evidence-core/` (the JS shim),
  `.claude/rules/autonomy.md`, `.claude/rules/client-local-first.md`.
