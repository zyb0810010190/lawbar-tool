// A07ConformanceHarness.swift — Evidence Core Swift: A0.7 renderer-conformance HARNESS (WI-ENA8).
//
// First real A0.7 harness per docs/adr/ADR-evidence-a07-renderer-conformance-gate.md (A07-GATE-00).
// It LOADS the existing synthetic fixture, READS the committed oracle (oracle.json — the expected
// values are NOT hardcoded here; they are decoded from disk so the harness cannot self-fulfill a
// pass), computes OBSERVED page count / page-box extents / normalized sample values, compares them to
// the oracle within the oracle's own tolerance, and emits a deterministic classified verdict.
//
// It writes NO marker, touches NO `dev-memo/run/evidence/**`, creates NO provenance/HMAC, builds NO
// tamper guard, and adds NO anchors / citation / persistence / UI. A passing harness result is NOT a
// marker (A07-GATE-00 §5): a durable A0.7 marker requires provenance + the tamper guard, which are
// separate authorized WIs. `not_implemented` is a FAIL, never a pass; a Class-2 (geometry-source
// instability) result is a STOP and is never downgraded to pass.
//
// The expected-value authority is the committed oracle (manifest.json / oracle.json), authored under
// WI-ENA7 BEFORE this harness existed (A07-GATE-00 §3 — oracle independent of code under test).

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
    /// The renderer's own reported structure (page count / page box) disagrees with the captured/recorded
    /// geometry: geometry-source instability. STOP / reassess (A07-GATE-00 §4). Never downgraded to pass.
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
    struct Expected: Decodable {
        struct Box: Decodable { let pageIndex: Int; let width: Double; let height: Double }
        struct Sample: Decodable {
            struct Pdf: Decodable { let x: Double; let y: Double }
            struct Norm: Decodable { let nx: Double; let ny: Double }
            let pdf: Pdf
            let normalized: Norm
        }
        let pageCount: Int
        let perPageMediaBox: [Box]
        let samplePoints: [Sample]
    }
    struct Tolerance: Decodable { let absolutePdfPoints: Double }
    let expected: Expected
    let tolerance: Tolerance

    var hasCheckableAssertions: Bool { !expected.perPageMediaBox.isEmpty || !expected.samplePoints.isEmpty }
}

// MARK: - Observed geometry (produced by the harness from the real renderer)

struct A07Observed: Equatable {
    struct Box: Equatable { let pageIndex: Int; let width: Double; let height: Double }
    struct SampleNorm: Equatable { let nx: Double; let ny: Double }
    let pageCount: Int
    let perPageMediaBox: [Box]
    /// Normalized sample values computed by the harness from the OBSERVED page-0 box (parallel to
    /// the oracle's samplePoints, same order). This is the "math under test".
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

        // 3. Observed per-page mediaBox for the indices the oracle references.
        var boxes: [A07Observed.Box] = []
        for box in oracle.expected.perPageMediaBox {
            guard box.pageIndex >= 0, box.pageIndex < pageCount, let page = document.page(at: box.pageIndex) else {
                continue // missing page -> handled as a box-count mismatch in evaluate()
            }
            let rect = page.bounds(for: .mediaBox)
            boxes.append(.init(pageIndex: box.pageIndex, width: Double(rect.width), height: Double(rect.height)))
        }

        // 4. Observed normalized sample values, computed from the OBSERVED page-0 box via nx=x/w, ny=y/h.
        var sampleNorm: [A07Observed.SampleNorm] = []
        if let page0 = document.page(at: 0) {
            let r = page0.bounds(for: .mediaBox)
            let w = Double(r.width), h = Double(r.height)
            for s in oracle.expected.samplePoints {
                sampleNorm.append(.init(nx: s.pdf.x / w, ny: s.pdf.y / h))
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
    /// Class-1 vs Class-2 split: structural disagreements (page count, box extent) are Class-2; a
    /// correct box with a wrong normalized value is Class-1.
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

        // Class-2: per-page mediaBox extent disagreement.
        for expectedBox in oracle.expected.perPageMediaBox {
            guard let obs = observed.perPageMediaBox.first(where: { $0.pageIndex == expectedBox.pageIndex }) else {
                return A07ConformanceResult(status: .fail, classification: .class_2_geometry_source_instability,
                                            observedPageCount: observed.pageCount,
                                            detail: "missing observed mediaBox for page \(expectedBox.pageIndex)")
            }
            if abs(obs.width - expectedBox.width) > tol || abs(obs.height - expectedBox.height) > tol {
                return A07ConformanceResult(status: .fail, classification: .class_2_geometry_source_instability,
                                            observedPageCount: observed.pageCount,
                                            detail: "page \(expectedBox.pageIndex) mediaBox observed \(obs.width)x\(obs.height) != oracle \(expectedBox.width)x\(expectedBox.height)")
            }
        }

        // Class-1: normalized sample disagreement (box is correct, so a mismatch is a math bug).
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
