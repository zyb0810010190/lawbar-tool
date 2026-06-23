# native/evidence-core-swift — Evidence Core Swift skeleton + PDFKit probe (smoke only)

**Skeleton + compile/import probe only.** This SwiftPM package exists to prove (1) the Swift toolchain +
macOS CI can build and test a native package in this repo (WI-ENA1), and (2) **PDFKit is importable +
linkable on macOS** (WI-ENA2). These are the first two authorized steps of the Native Evidence Core lane.

**PDFKit import is proven, nothing more.** `EvidenceCorePdfKitProbe.pdfKitAvailable` is a **compile-gated
constant** (`#if canImport(PDFKit)`), determined at compile time. The probe instantiates **no** `PDFDocument`,
loads/parses **no** PDF, and computes **no** geometry. It only proves the framework links.

**This package is NOT:**
- **NOT the A0.7 renderer-conformance harness** — it runs no conformance, classifies no failures.
- **NOT a marker** — it creates no A0.7 marker and writes no files at all.
- **NOT PDF geometry** — although it now imports PDFKit (compile/import probe), it computes **no** coordinates/
  anchors and loads/parses **no** PDF.
- **NOT product behavior** — it exposes only a smoke version/value (`EvidenceCoreSmoke.smokeVersion`,
  `EvidenceCoreSmoke.smoke()`) and the PDFKit capability probe (`EvidenceCorePdfKitProbe.pdfKitAvailable`,
  `EvidenceCorePdfKitProbe.probe()`).

It does not touch or change the existing `native/evidence-core/` JS deterministic-JSON shim.

## Build / test
```
swift build --package-path native/evidence-core-swift
swift test  --package-path native/evidence-core-swift
```
macOS CI runs the same smoke build/test (now including the PDFKit probe test) in
`.github/workflows/evidence-core-swift-smoke.yml` (the existing `ui-design-artifact.yml` ubuntu check is
unchanged). The job runs on **Apple Swift on macOS CI**; the runner image is `macos-latest`, a moving image —
no specific Swift/Xcode version is pinned or asserted.

## Hard stops (separate explicit authorization required)
Per `docs/adr/ADR-evidence-native-core-a07-feasibility.md` (ENA-00) and
`dev-memo/plan-batch-casebox-evidence-native-a07-feasibility-00.md`: PDF loading/parsing, PDF geometry
extraction, the real A0.7 renderer-conformance harness, A0.7 marker generation, marker provenance/HMAC, and
Evidence UI are all hard-stops beyond this skeleton + PDFKit-import probe — none are implemented here.
