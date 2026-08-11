---
path: native/evidence-core-swift/**
---

# A0.7 is PROVISIONAL — do not describe it as green

This package holds the Evidence gate CLIs: `A07HarnessCLI`, `A1CitationStabilityCLI`,
`A3RegressionCLI`, `A10GoldenExportCLI`, `EvidenceCoreSmoke`.

A0.7 (`renderer-conformance`) is the first real Evidence architecture gate, and it is **not
green**. Four harness defects are open — a NaN bypass, oracle incompleteness, class-1
misclassification, and all five oracles carrying zero `samplePoints`, which means the
normalization check has never actually executed on a sample. A run that reports success while
the oracle contains no sample points has not demonstrated conformance.

Standing consequences:

- **`not_implemented` is a failure, never a pass.** Same for `inconclusive_*`.
- **A class-2 result is an architectural stop**, not a bug to work around. Class-1 is local
  normalization and fixable inline; class-2 means the geometry source itself is unstable, and
  anchors, forms, and UI must not be built on top of it.
- **No Evidence UI ships before A0.7 is genuinely green.**
- The marker/provenance tooling that used to attest gate runs was removed with the governance
  layer on 2026-08-10. There is currently **nothing that can prove this gate ran**, so no
  artifact in this repo should claim it did.

Product invariants this gate protects are in `docs/product/evidence-m0-prd.md` §5.

*Trust: advisory here; `evidence-core-swift-smoke.yml` builds and smokes the package in CI,
but no CI job asserts A0.7 conformance.*
