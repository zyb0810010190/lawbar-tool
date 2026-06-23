# native/evidence-core-swift — Evidence Core Swift skeleton + PDFKit + PDF-load probes (smoke only)

**Skeleton + probes only.** This SwiftPM package exists to prove (1) the Swift toolchain + macOS CI can build
and test a native package in this repo (WI-ENA1); (2) **PDFKit is importable + linkable on macOS** (WI-ENA2);
and (3) **PDFKit can load/parse a PDF far enough to report its page count** (WI-ENA3). These are the first
three authorized steps of the Native Evidence Core lane.

**PDFKit import is proven** — `EvidenceCorePdfKitProbe.pdfKitAvailable` is a **compile-gated constant**
(`#if canImport(PDFKit)`), determined at compile time. It instantiates no `PDFDocument` and only proves the
framework links.

**PDF load/page-count is proven** — `EvidenceCorePdfLoadProbe.load(url:)` loads a tiny synthetic fixture via
`PDFDocument(url:)` and reports a deterministic structural result (`loaded` + `pageCount`). Page **count** is
a structural property, **not** geometry: the probe extracts **no** coordinates, **no** page boxes
(media/crop/bleed), renders nothing, and makes **no** page-identity / citation claim.

**This package is NOT:**
- **NOT the A0.7 renderer-conformance harness** — it runs no conformance, classifies no failures.
- **NOT a marker** — it creates no A0.7 marker and (apart from reading the bundled test fixture) writes no files.
- **NOT PDF geometry** — it now imports PDFKit and loads a synthetic PDF to count pages, but computes **no**
  coordinates/anchors/page-boxes and makes **no** page-identity claim.
- **NOT product behavior** — it exposes only a smoke version/value (`EvidenceCoreSmoke.smokeVersion`,
  `EvidenceCoreSmoke.smoke()`), the PDFKit capability probe (`EvidenceCorePdfKitProbe.pdfKitAvailable`,
  `EvidenceCorePdfKitProbe.probe()`), and the PDF load/page-count probe (`EvidenceCorePdfLoadProbe.load(url:)`).

It does not touch or change the existing `native/evidence-core/` JS deterministic-JSON shim.

## Test fixture (synthetic, safe)
`Tests/EvidenceCoreSmokeTests/Fixtures/synthetic-twopage.pdf` is a **432-byte synthetic** PDF generated
deterministically from a minimal-PDF source (two empty Letter-size pages; **no** fonts, images, text, metadata,
or any client/confidential material). It exists solely so the load probe can assert a known page count (2). It
is safe to commit: it carries no privileged content and reveals nothing about any matter or document.

- **sha256**: `63d91a6c75cc10350c0a15df19a12620d938637acf3529c15cab7d4e6e0d9276`
- **Generation recipe** (deterministic, no dependencies): four PDF objects — a `/Catalog`, a `/Pages` node
  with `/Count 2`, and two `/Page` objects each `/MediaBox [0 0 612 792]` and otherwise empty (no `/Contents`,
  `/Font`, `/XObject`, or `/Metadata`) — emitted with a correct `xref` table and `%%EOF`. There is no page
  content stream, so the file contains no drawable marks and nothing privileged. Regenerate by re-running the
  same minimal-PDF emitter; the bytes (and sha256) are stable.

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
`dev-memo/plan-batch-casebox-evidence-native-a07-feasibility-00.md`: PDF **geometry** extraction (coordinates,
page boxes), page identity / citation, anchors, the real A0.7 renderer-conformance harness, A0.7 marker
generation, marker provenance/HMAC, and Evidence UI are all hard-stops beyond this skeleton + PDFKit-import +
PDF-load/page-count probe — none are implemented here.
