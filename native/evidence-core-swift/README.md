# native/evidence-core-swift — Evidence Core Swift skeleton (smoke only)

**Skeleton only.** This SwiftPM package exists to prove the Swift toolchain + macOS CI can build and test a
native package in this repo. It is the first authorized step of the Native Evidence Core lane (WI-ENA1).

**This package is NOT:**
- **NOT the A0.7 renderer-conformance harness** — it runs no conformance, classifies no failures.
- **NOT a marker** — it creates no A0.7 marker and writes no files at all.
- **NOT PDF geometry** — it imports **no PDFKit** and computes no coordinates/anchors.
- **NOT product behavior** — it exposes only a smoke version/value (`EvidenceCoreSmoke.smokeVersion`,
  `EvidenceCoreSmoke.smoke()`).

It does not touch or change the existing `native/evidence-core/` JS deterministic-JSON shim.

## Build / test
```
swift build --package-path native/evidence-core-swift
swift test  --package-path native/evidence-core-swift
```
macOS CI runs the same smoke build/test in `.github/workflows/evidence-core-swift-smoke.yml` (the existing
`ui-design-artifact.yml` ubuntu check is unchanged).

## Hard stops (separate explicit authorization required)
Per `docs/adr/ADR-evidence-native-core-a07-feasibility.md` (ENA-00) and
`dev-memo/plan-batch-casebox-evidence-native-a07-feasibility-00.md`: introducing PDFKit, the real A0.7
harness, A0.7 marker generation, or Evidence UI are all hard-stops beyond this skeleton — none are
implemented here.
