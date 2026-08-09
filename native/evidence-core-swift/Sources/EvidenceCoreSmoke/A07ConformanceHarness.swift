// A07ConformanceHarness.swift — Evidence Core Swift: A0.7 renderer-conformance HARNESS (WI-ENA8;
// messy-fixture coverage extended in WI-EVIDENCE-A0.7-FIXTURE-COVERAGE-00; oracle-free stability mode
// added in WI-A07-STABILITY).
//
// First real A0.7 harness per docs/adr/ADR-evidence-a07-renderer-conformance-gate.md (A07-GATE-00).
// It LOADS a synthetic fixture, READS the committed oracle (oracle.json — the expected values are NOT
// hardcoded here; they are decoded from disk so the harness cannot self-fulfill a pass), computes
// OBSERVED page count / page-box extents / box origin / cropBox / rotation / normalized sample values,
// compares them to the oracle within the oracle's own tolerance, and emits a deterministic classified
// verdict.
//
// Coverage (WI-EVIDENCE-A0.7-FIXTURE-COVERAGE-00): beyond the original mediaBox-extent-only check, the
// harness now also observes — when the oracle asserts them — per-page mediaBox ORIGIN (non-zero origin),
// per-page CROPBOX (cropBox/mediaBox mismatch; PDFKit defaults cropBox to mediaBox when absent), and
// per-page ROTATION. Sample normalization subtracts the sample page's box ORIGIN (nx = (x-originX)/width),
// so an "origin not subtracted" bug is a detectable Class-1. All new oracle fields are OPTIONAL/additive,
// so a pre-existing oracle (no origin/cropBox/rotation/samplePageIndex) still decodes and behaves exactly
// as before (origin defaults to 0 → (x-0)/w, unchanged).
//
// It writes NO marker, touches NO `dev-memo/run/evidence/**`, creates NO provenance/HMAC, builds NO
// tamper guard, and adds NO anchors / citation / persistence / UI. A passing harness result is NOT a
// marker (A07-GATE-00 §5): a durable A0.7 marker requires provenance + the tamper guard, which are
// separate authorized WIs. `not_implemented` is a FAIL, never a pass; a Class-2 (geometry-source
// instability) result is a STOP and is never downgraded to pass; `inconclusive` is NOT pass.
//
// The expected-value authority is the committed oracle, authored from each fixture's KNOWN construction
// and INDEPENDENT of this code (A07-GATE-00 §3 — never back-fill harness output into an oracle).
//
// STABILITY MODE (WI-A07-STABILITY) — `runStability(fixtureURL:iterations:)`. The gate's real question is
// whether the geometry SOURCE is reproducible, which an oracle comparison cannot ask on a document whose
// geometry has never been recorded. Stability mode needs NO oracle: it captures the full observed geometry
// of every page, fully releases the document, RE-loads the same unchanged file, and re-captures — N times —
// then compares every capture byte-exactly against the first. Any divergence between reads of the same
// unchanged file is the definitional Class-2 signal (`class_2_geometry_source_instability`): the geometry
// source is not reproducible. It reuses this file's capture path, result type, and classification enum;
// it defines no new verdict vocabulary. It reads only; it CREATES NO ORACLE and WRITES NO FILE (stdout is
// the CLI's only output), which is what makes it safe to point at confidential client material. For the
// same reason its `detail` strings carry page counts and geometry numbers ONLY — never a file name, path,
// page content, text, or document metadata.

import Foundation
#if canImport(PDFKit)
import PDFKit
#endif

public enum A07ConformanceStatus: String, Equatable {
    case pass
    case fail
    case inconclusive
}

public enum A07Classification: String, Equatable {
    /// Pass — every checkable oracle assertion observed within tolerance.
    case ok
    /// Box geometry is correct, but a derived/normalized value is wrong: a local normalization/math bug.
    case class_1_normalization_math_bug
    /// The renderer's own reported structure (page count / page box extent / box origin / cropBox /
    /// rotation) disagrees with the captured/recorded geometry: geometry-source instability.
    /// STOP / reassess (A07-GATE-00 §4). Never downgraded to pass.
    case class_2_geometry_source_instability
    /// The fixture failed to load/parse, or the oracle failed to decode / is malformed.
    case fixture_or_oracle_invalid
    /// The harness could not execute (e.g. PDFKit unavailable). Per A07-GATE-00 §4 this is a FAIL.
    case not_implemented
    /// Documented inconclusive: the oracle defines no checkable assertions, so there is nothing to
    /// pass or fail. Inconclusive is NOT pass.
    case inconclusive_no_checkable_assertions
}

public struct A07ConformanceResult: Equatable {
    public let status: A07ConformanceStatus
    public let classification: A07Classification
    public let observedPageCount: Int
    public let detail: String

    /// Deterministic, ordered key/value rendering of the result (the "JSON-like" shape the gate emits).
    public func orderedFields() -> [(String, String)] {
        [
            ("status", status.rawValue),
            ("classification", classification.rawValue),
            ("observedPageCount", String(observedPageCount)),
            ("isMarker", "false"),
            ("detail", detail),
        ]
    }
}

// MARK: - Oracle (decoded from the committed oracle.json; expected values are NOT hardcoded here)

struct A07Oracle: Decodable {
    /// A PDF-space rectangle {x, y, width, height}. Used for an OPTIONAL expected cropBox.
    struct Rect: Decodable { let x: Double; let y: Double; let width: Double; let height: Double }

    struct Expected: Decodable {
        struct Box: Decodable {
            let pageIndex: Int
            let width: Double           // mediaBox extent (existing)
            let height: Double          // mediaBox extent (existing)
            let x: Double?              // OPTIONAL mediaBox origin x (default 0)
            let y: Double?              // OPTIONAL mediaBox origin y (default 0)
            let rotation: Int?         // OPTIONAL expected page rotation (degrees); checked iff present
            let cropBox: Rect?         // OPTIONAL expected cropBox (origin+extent); checked iff present
        }
        struct Sample: Decodable {
            struct Pdf: Decodable { let x: Double; let y: Double }
            struct Norm: Decodable { let nx: Double; let ny: Double }
            let pdf: Pdf
            let normalized: Norm
        }
        let pageCount: Int
        let perPageMediaBox: [Box]
        let samplePoints: [Sample]
        let samplePageIndex: Int?      // OPTIONAL page used for sample normalization (default 0)
    }
    struct Tolerance: Decodable { let absolutePdfPoints: Double }
    let expected: Expected
    let tolerance: Tolerance

    var hasCheckableAssertions: Bool { !expected.perPageMediaBox.isEmpty || !expected.samplePoints.isEmpty }
}

// MARK: - Observed geometry (produced by the harness from the real renderer)

struct A07Observed: Equatable {
    struct Rect: Equatable { let x: Double; let y: Double; let width: Double; let height: Double }
    struct Box: Equatable {
        let pageIndex: Int
        let originX: Double
        let originY: Double
        let width: Double
        let height: Double
        let rotation: Int
        let cropBox: Rect
    }
    struct SampleNorm: Equatable { let nx: Double; let ny: Double }
    let pageCount: Int
    let perPageMediaBox: [Box]
    /// Normalized sample values computed by the harness from the OBSERVED sample-page box, subtracting
    /// the box origin (nx = (x-originX)/width). This is the "math under test".
    let sampleNormalized: [SampleNorm]
}

public enum EvidenceCoreA07Harness {
    /// Run the A0.7 renderer-conformance check: load the fixture, read the oracle from disk, compute
    /// observed geometry, and classify. The oracle URL points at the committed oracle.json so the
    /// expected values are never self-supplied by this code.
    public static func run(fixtureURL: URL, oracleURL: URL) -> A07ConformanceResult {
        // 0. OFFLINE INVARIANT: both inputs MUST be local file URLs. `Data(contentsOf:)` and
        // `PDFDocument(url:)` are network-capable for http(s) URLs; the A0.7 harness is a
        // disk-fixture/disk-oracle check and MUST NOT perform any network I/O (evidence-genie.md
        // invariant 1: OS-enforced offline). Reject non-file URLs before any load.
        guard fixtureURL.isFileURL, oracleURL.isFileURL else {
            return A07ConformanceResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                        observedPageCount: 0,
                                        detail: "fixture and oracle must be local file URLs (offline harness); refusing non-file URL")
        }

        // 1. Oracle must decode. A malformed oracle is fixture_or_oracle_invalid (fail).
        guard let oracleData = try? Data(contentsOf: oracleURL),
              let oracle = try? JSONDecoder().decode(A07Oracle.self, from: oracleData) else {
            return A07ConformanceResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                        observedPageCount: 0,
                                        detail: "oracle.json missing or undecodable at \(oracleURL.lastPathComponent)")
        }

        #if canImport(PDFKit)
        // 2. Fixture must load/parse.
        guard let document = PDFDocument(url: fixtureURL) else {
            return A07ConformanceResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                        observedPageCount: 0,
                                        detail: "fixture failed to load at \(fixtureURL.lastPathComponent)")
        }
        let pageCount = document.pageCount

        // 3. Observed per-page geometry (mediaBox origin+extent, cropBox, rotation) for the indices the
        //    oracle references. PDFKit reports bounds(for: .cropBox) defaulting to the mediaBox when the
        //    page declares no CropBox.
        var boxes: [A07Observed.Box] = []
        for box in oracle.expected.perPageMediaBox {
            guard box.pageIndex >= 0, box.pageIndex < pageCount, let page = document.page(at: box.pageIndex) else {
                continue // missing page -> handled as a box-count mismatch in evaluate()
            }
            boxes.append(captureBox(page, pageIndex: box.pageIndex))
        }

        // 4. Observed normalized sample values, computed from the OBSERVED sample-page box via
        //    nx=(x-originX)/w, ny=(y-originY)/h. The sample page is oracle.samplePageIndex (default 0).
        var sampleNorm: [A07Observed.SampleNorm] = []
        let samplePage = oracle.expected.samplePageIndex ?? 0
        if !oracle.expected.samplePoints.isEmpty, samplePage >= 0, samplePage < pageCount,
           let page = document.page(at: samplePage) {
            let r = page.bounds(for: .mediaBox)
            let ox = Double(r.origin.x), oy = Double(r.origin.y), w = Double(r.width), h = Double(r.height)
            for s in oracle.expected.samplePoints {
                sampleNorm.append(.init(nx: (s.pdf.x - ox) / w, ny: (s.pdf.y - oy) / h))
            }
        }

        let observed = A07Observed(pageCount: pageCount, perPageMediaBox: boxes, sampleNormalized: sampleNorm)
        return evaluate(observed: observed, oracle: oracle)
        #else
        // PDFKit unavailable -> the harness cannot execute. not_implemented is a FAIL (A07-GATE-00 §4).
        return A07ConformanceResult(status: .fail, classification: .not_implemented,
                                    observedPageCount: 0,
                                    detail: "PDFKit unavailable; A0.7 harness not executable in this environment")
        #endif
    }

    #if canImport(PDFKit)
    // MARK: - Geometry capture (single source of truth for oracle mode AND stability mode)

    /// Capture ONE page's observed geometry: mediaBox origin+extent, cropBox, rotation. PDFKit reports
    /// `bounds(for: .cropBox)` defaulting to the mediaBox when the page declares no CropBox. Returns a
    /// pure value type, so the caller can release the document immediately after capture.
    static func captureBox(_ page: PDFPage, pageIndex: Int) -> A07Observed.Box {
        let mb = page.bounds(for: .mediaBox)
        let cb = page.bounds(for: .cropBox)
        return .init(pageIndex: pageIndex,
                     originX: Double(mb.origin.x), originY: Double(mb.origin.y),
                     width: Double(mb.width), height: Double(mb.height),
                     rotation: page.rotation,
                     cropBox: .init(x: Double(cb.origin.x), y: Double(cb.origin.y),
                                    width: Double(cb.width), height: Double(cb.height)))
    }

    /// Capture the FULL observed geometry for EVERY page of a loaded document (stability mode, which has
    /// no oracle to tell it which pages to look at). `sampleNormalized` is empty: normalized samples are
    /// an oracle-driven Class-1 check and have no meaning without oracle sample points.
    static func captureAllPages(_ document: PDFDocument) -> A07Observed {
        var boxes: [A07Observed.Box] = []
        for index in 0..<document.pageCount {
            guard let page = document.page(at: index) else { continue } // short list -> caught as invalid
            boxes.append(captureBox(page, pageIndex: index))
        }
        return A07Observed(pageCount: document.pageCount, perPageMediaBox: boxes, sampleNormalized: [])
    }
    #endif

    /// Pure classifier: compare observed geometry to the oracle. No IO. Order of checks fixes the
    /// Class-1 vs Class-2 split: structural disagreements (page count, box extent, box origin, cropBox,
    /// rotation) are Class-2 (renderer reports geometry differently than the recorded oracle); a correct
    /// box with a wrong normalized value is Class-1. (A07-GATE-00 §4; handover §5: "ratio uses mediaBox
    /// while geometry says cropBox" / "origin not subtracted" are Class-1; "PDFKit reports different
    /// crop/media bounds" / "page count differs" are Class-2.)
    static func evaluate(observed: A07Observed, oracle: A07Oracle) -> A07ConformanceResult {
        let tol = oracle.tolerance.absolutePdfPoints

        // Inconclusive: nothing to check.
        if !oracle.hasCheckableAssertions {
            return A07ConformanceResult(status: .inconclusive, classification: .inconclusive_no_checkable_assertions,
                                        observedPageCount: observed.pageCount,
                                        detail: "oracle defines no checkable assertions; inconclusive (not pass)")
        }

        // Class-2: page count disagreement (renderer structure vs recorded geometry).
        if observed.pageCount != oracle.expected.pageCount {
            return A07ConformanceResult(status: .fail, classification: .class_2_geometry_source_instability,
                                        observedPageCount: observed.pageCount,
                                        detail: "page count observed \(observed.pageCount) != oracle \(oracle.expected.pageCount)")
        }

        // Class-2: per-page structural geometry (mediaBox extent + origin, cropBox, rotation) disagreement.
        for expectedBox in oracle.expected.perPageMediaBox {
            guard let obs = observed.perPageMediaBox.first(where: { $0.pageIndex == expectedBox.pageIndex }) else {
                return A07ConformanceResult(status: .fail, classification: .class_2_geometry_source_instability,
                                            observedPageCount: observed.pageCount,
                                            detail: "missing observed mediaBox for page \(expectedBox.pageIndex)")
            }
            if abs(obs.width - expectedBox.width) > tol || abs(obs.height - expectedBox.height) > tol {
                return A07ConformanceResult(status: .fail, classification: .class_2_geometry_source_instability,
                                            observedPageCount: observed.pageCount,
                                            detail: "page \(expectedBox.pageIndex) mediaBox extent observed \(obs.width)x\(obs.height) != oracle \(expectedBox.width)x\(expectedBox.height)")
            }
            // OPTIONAL mediaBox origin (non-zero-origin coverage). Default expected origin is (0,0).
            let ex = expectedBox.x ?? 0, ey = expectedBox.y ?? 0
            if abs(obs.originX - ex) > tol || abs(obs.originY - ey) > tol {
                return A07ConformanceResult(status: .fail, classification: .class_2_geometry_source_instability,
                                            observedPageCount: observed.pageCount,
                                            detail: "page \(expectedBox.pageIndex) mediaBox origin observed (\(obs.originX),\(obs.originY)) != oracle (\(ex),\(ey))")
            }
            // OPTIONAL rotation (checked iff the oracle asserts it).
            if let rot = expectedBox.rotation, obs.rotation != rot {
                return A07ConformanceResult(status: .fail, classification: .class_2_geometry_source_instability,
                                            observedPageCount: observed.pageCount,
                                            detail: "page \(expectedBox.pageIndex) rotation observed \(obs.rotation) != oracle \(rot)")
            }
            // OPTIONAL cropBox (cropBox/mediaBox-mismatch coverage; checked iff the oracle asserts it).
            if let cb = expectedBox.cropBox {
                if abs(obs.cropBox.x - cb.x) > tol || abs(obs.cropBox.y - cb.y) > tol
                    || abs(obs.cropBox.width - cb.width) > tol || abs(obs.cropBox.height - cb.height) > tol {
                    return A07ConformanceResult(status: .fail, classification: .class_2_geometry_source_instability,
                                                observedPageCount: observed.pageCount,
                                                detail: "page \(expectedBox.pageIndex) cropBox observed (\(obs.cropBox.x),\(obs.cropBox.y),\(obs.cropBox.width),\(obs.cropBox.height)) != oracle (\(cb.x),\(cb.y),\(cb.width),\(cb.height))")
                }
            }
        }

        // Class-1: normalized sample disagreement (box is correct, so a mismatch is a math bug — e.g.
        // origin not subtracted, or ratio uses the wrong box).
        guard observed.sampleNormalized.count == oracle.expected.samplePoints.count else {
            return A07ConformanceResult(status: .fail, classification: .class_1_normalization_math_bug,
                                        observedPageCount: observed.pageCount,
                                        detail: "observed sample count \(observed.sampleNormalized.count) != oracle \(oracle.expected.samplePoints.count)")
        }
        for (i, expectedSample) in oracle.expected.samplePoints.enumerated() {
            let obs = observed.sampleNormalized[i]
            if abs(obs.nx - expectedSample.normalized.nx) > tol || abs(obs.ny - expectedSample.normalized.ny) > tol {
                return A07ConformanceResult(status: .fail, classification: .class_1_normalization_math_bug,
                                            observedPageCount: observed.pageCount,
                                            detail: "sample \(i) normalized observed (\(obs.nx),\(obs.ny)) != oracle (\(expectedSample.normalized.nx),\(expectedSample.normalized.ny))")
            }
        }

        // All checkable assertions observed within tolerance.
        return A07ConformanceResult(status: .pass, classification: .ok,
                                    observedPageCount: observed.pageCount,
                                    detail: "all \(oracle.expected.perPageMediaBox.count) box + \(oracle.expected.samplePoints.count) sample assertions within tolerance \(tol)")
    }

    // MARK: - Stability mode (WI-A07-STABILITY) — no oracle, no file written

    /// Default number of independent reads a stability run performs.
    public static let stabilityDefaultIterations = 3

    /// Run the ORACLE-FREE A0.7 stability check: read the SAME unchanged file `iterations` times, fully
    /// releasing the document between reads, and compare every capture byte-exactly against the first.
    ///
    /// - `pass` / `ok` — every read reported identical geometry.
    /// - `fail` / `class_2_geometry_source_instability` — two reads of the same unchanged file disagreed.
    ///   That is the definitional Class-2 signal and a STOP; it is never downgraded to pass.
    /// - `fail` / `fixture_or_oracle_invalid` — the document did not load, reported zero pages, or did not
    ///   yield geometry for every page. Never a pass.
    /// - `inconclusive` / `inconclusive_no_checkable_assertions` — fewer than two reads requested, so there
    ///   is nothing to compare. Inconclusive is NOT pass.
    /// - `fail` / `not_implemented` — PDFKit unavailable. `not_implemented` is a FAIL (A07-GATE-00 §4).
    ///
    /// Reads only. Creates NO oracle and writes NO file, so it leaves no artifact on disk and is safe to
    /// point at confidential material. `detail` carries counts and geometry numbers only — never the file
    /// name/path, page content, text, or document metadata.
    public static func runStability(fixtureURL: URL,
                                    iterations: Int = EvidenceCoreA07Harness.stabilityDefaultIterations) -> A07ConformanceResult {
        // OFFLINE INVARIANT (same as oracle mode): `PDFDocument(url:)` is network-capable for http(s)
        // URLs. Reject any non-file URL before loading anything (evidence-genie.md invariant 1).
        guard fixtureURL.isFileURL else {
            return A07ConformanceResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                        observedPageCount: 0,
                                        detail: "fixture must be a local file URL (offline harness); refusing non-file URL")
        }
        // Fewer than two reads compares nothing. Guarded here as well as in evaluateStability so the
        // read loop below can never be entered with a degenerate count.
        guard iterations >= 2 else {
            return A07ConformanceResult(status: .inconclusive, classification: .inconclusive_no_checkable_assertions,
                                        observedPageCount: 0,
                                        detail: "stability needs at least 2 reads to compare; iterations=\(iterations) defines no checkable assertion (not pass)")
        }

        #if canImport(PDFKit)
        var captures: [A07Observed] = []
        for read in 1...iterations {
            // Each read builds a FRESH PDFDocument inside its own autorelease pool and captures only
            // value-typed geometry. No document reference outlives the pool, so the next iteration is a
            // genuine re-load of the file rather than a re-read of a retained in-memory document.
            let captured: A07Observed? = autoreleasepool {
                guard let document = PDFDocument(url: fixtureURL) else { return nil }
                return captureAllPages(document)
            }
            guard let observed = captured else {
                return A07ConformanceResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                            observedPageCount: 0,
                                            detail: "document failed to load on read \(read) of \(iterations) (not pass)")
            }
            captures.append(observed)
        }
        return evaluateStability(captures: captures)
        #else
        // PDFKit unavailable -> the harness cannot execute. not_implemented is a FAIL (A07-GATE-00 §4).
        return A07ConformanceResult(status: .fail, classification: .not_implemented,
                                    observedPageCount: 0,
                                    detail: "PDFKit unavailable; A0.7 stability mode not executable in this environment")
        #endif
    }

    /// Pure classifier for stability mode: compare N captures of the same unchanged file. No IO.
    /// `captures[0]` is the reference read. Mirrors the `run` / `evaluate` split of oracle mode so the
    /// Class-2 branch is directly testable without needing a genuinely unstable renderer.
    static func evaluateStability(captures: [A07Observed]) -> A07ConformanceResult {
        guard let first = captures.first, captures.count >= 2 else {
            return A07ConformanceResult(status: .inconclusive, classification: .inconclusive_no_checkable_assertions,
                                        observedPageCount: captures.first?.pageCount ?? 0,
                                        detail: "stability needs at least 2 reads to compare; got \(captures.count) (not pass)")
        }
        // A document with no pages has no geometry source to assess: invalid, never pass.
        guard first.pageCount > 0 else {
            return A07ConformanceResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                        observedPageCount: 0,
                                        detail: "document reports 0 pages; no geometry to assess (not pass)")
        }
        guard first.perPageMediaBox.count == first.pageCount else {
            return A07ConformanceResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                        observedPageCount: first.pageCount,
                                        detail: "geometry captured for only \(first.perPageMediaBox.count) of \(first.pageCount) pages (not pass)")
        }

        let reference = canonicalGeometry(first)
        for (index, other) in captures.enumerated().dropFirst() where canonicalGeometry(other) != reference {
            // Two reads of the SAME unchanged file disagreed: the geometry source is not reproducible.
            return A07ConformanceResult(status: .fail, classification: .class_2_geometry_source_instability,
                                        observedPageCount: other.pageCount,
                                        detail: "geometry source not reproducible: \(stabilityDivergence(first: first, other: other, read: index + 1))")
        }
        return A07ConformanceResult(status: .pass, classification: .ok,
                                    observedPageCount: first.pageCount,
                                    detail: "geometry identical across \(captures.count) independent reads of \(first.pageCount) pages")
    }

    // MARK: - Deterministic geometry rendering (stability comparison + divergence reporting)

    /// IEEE-754 bit pattern of a Double, so the stability comparison is byte-exact rather than `==`-exact
    /// (`==` would call NaN != NaN a divergence it cannot describe, and -0.0 == 0.0 a match).
    private static func bits(_ value: Double) -> String { String(value.bitPattern, radix: 16) }

    /// Byte-exact canonical rendering of one captured page. Comparison key only; never printed.
    static func canonicalBox(_ box: A07Observed.Box) -> String {
        "p\(box.pageIndex)|media=\(bits(box.originX)),\(bits(box.originY)),\(bits(box.width)),\(bits(box.height))"
            + "|rot=\(box.rotation)"
            + "|crop=\(bits(box.cropBox.x)),\(bits(box.cropBox.y)),\(bits(box.cropBox.width)),\(bits(box.cropBox.height))"
    }

    /// Byte-exact canonical rendering of one full capture (page count + every captured page).
    static func canonicalGeometry(_ observed: A07Observed) -> String {
        (["pages=\(observed.pageCount)"] + observed.perPageMediaBox.map(canonicalBox)).joined(separator: "\n")
    }

    /// Human-readable decimal rendering of one page's geometry, used ONLY in a divergence detail.
    /// Geometry numbers only — no file name, page content, text, or metadata.
    static func describeBox(_ box: A07Observed.Box) -> String {
        "media=(\(box.originX),\(box.originY),\(box.width),\(box.height)) rot=\(box.rotation) "
            + "crop=(\(box.cropBox.x),\(box.cropBox.y),\(box.cropBox.width),\(box.cropBox.height))"
    }

    /// Describe the FIRST difference between the reference read and a later read, deterministically.
    static func stabilityDivergence(first: A07Observed, other: A07Observed, read: Int) -> String {
        if first.pageCount != other.pageCount {
            return "page count read 1 = \(first.pageCount), read \(read) = \(other.pageCount)"
        }
        for (index, box) in first.perPageMediaBox.enumerated() {
            guard index < other.perPageMediaBox.count else {
                return "page \(box.pageIndex) geometry captured on read 1 but missing on read \(read)"
            }
            let otherBox = other.perPageMediaBox[index]
            if canonicalBox(box) != canonicalBox(otherBox) {
                return "page \(box.pageIndex) read 1 \(describeBox(box)) != read \(read) \(describeBox(otherBox))"
            }
        }
        if other.perPageMediaBox.count != first.perPageMediaBox.count {
            return "captured page count read 1 = \(first.perPageMediaBox.count), read \(read) = \(other.perPageMediaBox.count)"
        }
        return "captures differ between read 1 and read \(read)"
    }
}
