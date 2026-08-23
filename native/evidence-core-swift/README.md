# native/evidence-core-swift — Evidence Core Swift: probes + A0.7 conformance harness (no marker)

**Probes + the A0.7 harness (no marker).** This SwiftPM package proves (1) the Swift toolchain + macOS CI can
build and test a native package in this repo (WI-ENA1); (2) **PDFKit is importable + linkable on macOS**
(WI-ENA2); (3) **PDFKit can load/parse a PDF far enough to report its page count** (WI-ENA3); (4) **PDFKit can
read a page's raw box extent (`mediaBox` width/height)** (WI-ENA4); (5) **a PDF-space ↔ normalized-`[0,1]`
coordinate transform is invertible (roundtrips)** (WI-ENA5); and (6) it implements the **A0.7
renderer-conformance harness** that classifies observed geometry against the committed oracle (WI-ENA8). These
are the first authorized steps of the Native Evidence Core lane. The harness **writes no A0.7 marker** — a
durable marker requires provenance + the tamper guard, which are separate authorized WIs (A07-GATE-00 §5/§8).

**PDFKit import is proven** — `EvidenceCorePdfKitProbe.pdfKitAvailable` is a **compile-gated constant**
(`#if canImport(PDFKit)`), determined at compile time. It instantiates no `PDFDocument` and only proves the
framework links.

**PDF load/page-count is proven** — `EvidenceCorePdfLoadProbe.load(url:)` loads a tiny synthetic fixture via
`PDFDocument(url:)` and reports a deterministic structural result (`loaded` + `pageCount`). Page **count** is
a structural property, **not** geometry.

**Page-box read is proven** — `EvidenceCorePageBoxProbe.inspectMediaBoxes(url:)` proves only that PDFKit can
read a page's **raw `mediaBox` extent** (`width`/`height` in PDF points) via `page.bounds(for: .mediaBox)`. It
reads the box size **only**: it applies **no** coordinate transform, **no** PDF/user/view-space conversion,
**no** normalized-coordinate math, **no** anchor / citation / page-identity logic, and **no** geometry pass/fail
classification. Reading a box extent is structural metadata, not coordinate math.

**Coordinate roundtrip is proven** — the **internal, probe-only** `EvidenceCoreCoordinateRoundtripProbe`
(`normalize`/`denormalize`/`roundtripOnFixture`) proves only that a PDF-space point can be normalized against a
page's box extent into `[0,1]` and inverted back, recovering the original within ~`1e-9`. It is deliberately
**`internal`** (exercised only by the test target via `@testable import`) — **not** a product/API/JS surface.
It is **NOT** production anchor geometry: **no** rotation, **no** origin/box-offset, **no** captured-geometry
versioning, **no** persistence, **no** viewport/pixel mapping, **no** anchor/citation/page-identity, **no**
renderer-conformance, and **no** A0.7 claim. It only demonstrates the arithmetic is invertible.

**A0.7 renderer-conformance harness (WI-ENA8) — classifies, does NOT mark.** `EvidenceCoreA07Harness.run(fixtureURL:oracleURL:)`
loads the committed synthetic fixture, **reads the committed oracle from disk** (`a07-renderer-conformance/oracle.json`
— expected values are NOT hardcoded in the harness, so it cannot self-fulfill a pass), computes observed page
count / `mediaBox` extents / normalized sample values, compares them to the oracle within the oracle's own
tolerance, and returns a deterministic verdict: `status` (`pass`/`fail`/`inconclusive`) + `classification`
(`ok` / `class_1_normalization_math_bug` / `class_2_geometry_source_instability` / `fixture_or_oracle_invalid`
/ `not_implemented` / `inconclusive_no_checkable_assertions`). **`not_implemented` is a fail**; **inconclusive
is not pass**; a **Class-2** geometry-source instability is a STOP and is never downgraded to pass. The result
carries `isMarker=false`: a passing harness run is **not** an A0.7 marker.

**A0.7 stability mode (WI-A07-STABILITY) — oracle-free, writes nothing.** The gate's real question is whether
the geometry **source** is reproducible, which an oracle comparison cannot ask about a document whose geometry
has never been recorded — and recording an oracle for a real client filing would persist client-derived page
dimensions to disk. `EvidenceCoreA07Harness.runStability(fixtureURL:iterations:)` needs **no oracle**: it
captures the full observed geometry of **every** page (the same capture path oracle mode uses), fully releases
the document, **re-loads the same unchanged file**, re-captures — `iterations` times (default **3**, minimum
**2**) — and compares every capture **byte-exactly** (IEEE-754 bit patterns) against the first. It reuses the
existing result type and classification enum: identical captures are `pass`/`ok`; **any** divergence between
reads of the same unchanged file is `fail`/`class_2_geometry_source_instability` (the definitional Class-2
signal — the geometry source is not reproducible — a STOP, never downgraded to pass); a document that fails to
load, reports zero pages, or does not yield geometry for every page is `fail`/`fixture_or_oracle_invalid`;
fewer than two reads is `inconclusive`/`inconclusive_no_checkable_assertions`. It **reads only**: it creates
**no oracle** and **writes no file**, and its `detail` strings carry counts and geometry numbers **only** —
never the file name/path, page content, text, or document metadata. That is what makes it safe to point at
confidential material.

**A0.7 fresh-process stability (WI-A07-STABILITY-FRESHPROC) — every capture in a NEW process.** The
in-process form above re-reads one file inside **one** process, so a CoreGraphics/PDFKit cache keyed on the
file URL and living for the **process lifetime** cannot be fully excluded — a mid-run file swap proved the
release between reads is effective, but "probably not cached" is not a finding for a court-facing gate.
`EvidenceCoreA07Harness.runStabilityFreshProcess(fixtureURL:iterations:executableURL:)` removes the question:
it re-spawns **the running binary** (resolved from the kernel via `_NSGetExecutablePath`, never a hardcoded
build path, so it behaves identically under `swift run`, `swift test`, debug, and release) `iterations` times
in `--capture-once` mode and compares the collected captures. It **reuses** the same capture path, the same
canonical rendering, and the same `evaluateStability` classifier as the in-process form — there is **one**
implementation of the gate logic, not two — so the verdict shape and vocabulary are identical. Agreement
across independent processes is evidence about the geometry **source**, not about one process's memory.
A capture that decodes to equal values but **renders** differently is also Class-2: the byte-exact check can
only turn a pass into a STOP, never the reverse. Like every other mode it **writes no file** (the child's
stdout is a pipe, its stderr is `/dev/null`) and leaks no file name or path.

`--capture-once` is the subprocess primitive the driver drives: it prints **only** the canonical geometry
string (page count, page indices, IEEE-754 bit patterns, rotation) and exits 0; a document that does not load
exits non-zero. It is not a verdict mode and emits no marker.

```
a07-harness-cli <fixture.pdf> <oracle.json>
a07-harness-cli --stability <fixture.pdf> [--fresh-process] [--iterations N]   (N >= 2, default 3)
a07-harness-cli --capture-once <fixture.pdf>
```

The three **verdict** invocations (oracle, in-process stability, fresh-process stability) print one
tab-separated line to stdout — `<status>\t<classification>\t<observedPageCount>` — and exit 0 iff
`status == pass`. A non-pass additionally writes one `detail: ...` line to **stderr**, so stdout keeps its
exact machine-readable shape for `scripts/workflow/a07-marker-write.sh`. A usage error exits **2** and prints
nothing to stdout. Fresh-process mode costs one process launch per iteration (~0.1 s each on the reference
machine) against ~1 ms for the whole in-process run; it is a deliberate trade of speed for an exclusion the
in-process form cannot make.

**This package is NOT (still):**
- **NOT an A0.7 marker** — the harness (both oracle mode and stability mode) writes **no** marker and **no**
  files; it touches **no**
  `dev-memo/run/evidence/**`, and creates **no** provenance/HMAC and **no** tamper/fabrication guard. A durable,
  provenance-valid marker is a separate authorized WI (A07-GATE-00 §5/§8).
- **NOT production anchor geometry** — the coordinate roundtrip is an internal probe and the harness reads only
  box/structural geometry; neither is the production anchor implementation (a separate hard-stop WI).
- **NOT product behavior** — no anchors, no citation/page-identity persistence, no PDFView/UI conversion, no
  export, no OCR/AI/cloud/auth/network. Public symbols: `EvidenceCoreSmoke.smokeVersion`/`.smoke()`,
  `EvidenceCorePdfKitProbe.pdfKitAvailable`/`.probe()`, `EvidenceCorePdfLoadProbe.load(url:)`,
  `EvidenceCorePageBoxProbe.inspectMediaBoxes(url:)`, `EvidenceCoreA07Harness.run(fixtureURL:oracleURL:)`,
  `EvidenceCoreA07Harness.runStability(fixtureURL:iterations:)`/`.stabilityDefaultIterations`, and
  `EvidenceCoreA07Harness.runStabilityFreshProcess(fixtureURL:iterations:executableURL:)`/
  `.captureOnceCanonicalGeometry(fixtureURL:)`/`.runningExecutableURL()`/`.captureOnceFlag`.
  The coordinate roundtrip probe is internal (no public symbol).

It does not touch or change the existing `native/evidence-core/` JS deterministic-JSON shim.

## Test fixture (synthetic, safe)
`Tests/EvidenceCoreSmokeTests/Fixtures/synthetic-twopage.pdf` is a **432-byte synthetic** PDF generated
deterministically from a minimal-PDF source (two empty Letter-size pages; **no** fonts, images, text, metadata,
or any client/confidential material). It exists solely so the load probe can assert a known page count (2),
the page-box probe can assert each page's `mediaBox` extent (612 x 792 points), and the coordinate-roundtrip
probe can assert invertibility against that extent. It is safe to commit: it carries no privileged content and
reveals nothing about any matter or document.

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
macOS CI runs the same smoke build/test (now covering all probe tests plus the A0.7 harness: PDFKit import,
PDF load/page-count, page-box read, coordinate roundtrip, and A0.7 conformance) in `.github/workflows/evidence-core-swift-smoke.yml` (the existing `ui-design-artifact.yml` ubuntu check is
unchanged). The job runs on **Apple Swift on macOS CI**; the runner image is `macos-latest`, a moving image —
no specific Swift/Xcode version is pinned or asserted.

## Hard stops (separate explicit authorization required)
Per `docs/adr/ADR-evidence-native-core-a07-feasibility.md` (ENA-00) and
`docs/adr/ADR-evidence-a07-renderer-conformance-gate.md` (A07-GATE-00 §5/§8): **A0.7 marker generation**, marker
**provenance/HMAC**, the **tamper/fabrication guard**, **EVW5 hard hooks**, **production anchor geometry**
(rotation, captured-geometry versioning, viewport/pixel mapping, persistence), page identity / citation, PDF
rendering/PDFView conversion, and Evidence UI are all hard-stops beyond this probe set + the A0.7 harness — none
are implemented here. The A0.7 harness (WI-ENA8) classifies geometry against the committed oracle but writes
**no** marker. (Reading a raw `mediaBox` width/height (WI-ENA4) and proving an internal `[0,1]` coordinate
roundtrip (WI-ENA5) are structural/
arithmetic probes, not production anchor geometry.)
