// A07ConformanceHarness.swift — Evidence Core Swift: A0.7 renderer-conformance HARNESS (WI-ENA8;
// messy-fixture coverage extended in WI-EVIDENCE-A0.7-FIXTURE-COVERAGE-00).
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
            let mb = page.bounds(for: .mediaBox)
            let cb = page.bounds(for: .cropBox)
            boxes.append(.init(pageIndex: box.pageIndex,
                               originX: Double(mb.origin.x), originY: Double(mb.origin.y),
                               width: Double(mb.width), height: Double(mb.height),
                               rotation: page.rotation,
                               cropBox: .init(x: Double(cb.origin.x), y: Double(cb.origin.y),
                                              width: Double(cb.width), height: Double(cb.height))))
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
}
