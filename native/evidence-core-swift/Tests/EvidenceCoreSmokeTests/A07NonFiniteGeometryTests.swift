import XCTest
import Foundation
@testable import EvidenceCoreSmoke

// D1 — non-finite observed geometry must never pass.
//
// WHY THIS EXISTS. Every geometry comparison in A07ConformanceHarness has the form
//
//     if abs(observed - expected) > tol { ...fail... }
//
// In IEEE 754 `NaN > tol` is FALSE, so `abs(NaN - x) > tol` is false and a NaN observation trips
// no check at all — it passes. Before this file, a grep for isNaN / isFinite / isInfinite across
// the whole 460-line harness returned nothing: there was no finiteness guard anywhere.
//
// That is not one missing edge case. A NaN reaching the comparison means the renderer returned a
// non-representable coordinate, which is *precisely* the condition this gate exists to detect, and
// it was the one condition the gate was structurally blind to. A0.7 is the gate that decides
// whether PDFKit page geometry is trustworthy enough for citations and anchors to be stable, in a
// tool whose anchors may be relied on in court. A gate that reports "pass" for geometry that is
// not a number is worse than no gate, because downstream evidence work is authorized on it.
//
// CLASSIFICATION. A non-finite coordinate is class_2_geometry_source_instability, not class_1.
// Class-1 means "the normalization math is locally wrong, fix it"; class-2 means "the geometry
// source itself is unsound, STOP and reassess". A renderer emitting NaN is the second: no amount
// of correcting arithmetic downstream makes a non-number into a coordinate.
//
// NOTE ON INFINITY. `abs(inf - x) > tol` is TRUE, so an infinite observation already failed before
// this change — but by accident, via whichever extent check happened to run first, with a detail
// message describing a size mismatch rather than the real problem. The tests below pin infinity to
// the same explicit non-finite rejection so the reported reason matches the actual defect.
//
// SCOPE. Oracle mode (`evaluate`) only. Stability mode has a second, independent NaN path:
// `evaluateStability` compares canonical geometry strings, and two NaN reads produce identical
// strings, so it returns pass — see A07StabilityHarnessTests. Whether "two reads agreed" is the
// right answer for NaN is a separate product decision, deliberately not settled here.
final class A07NonFiniteGeometryTests: XCTestCase {
    private var fixturesDir: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures")
    }
    private var oracleURL: URL { fixturesDir.appendingPathComponent("a07-renderer-conformance/oracle.json") }

    private func realOracle() throws -> A07Oracle {
        try JSONDecoder().decode(A07Oracle.self, from: Data(contentsOf: oracleURL))
    }

    private func obsBox(_ idx: Int, _ x: Double, _ y: Double, _ w: Double, _ h: Double,
                        rot: Int = 0, crop: (Double, Double, Double, Double)? = nil) -> A07Observed.Box {
        let c = crop ?? (x, y, w, h)
        return .init(pageIndex: idx, originX: x, originY: y, width: w, height: h, rotation: rot,
                     cropBox: .init(x: c.0, y: c.1, width: c.2, height: c.3))
    }

    /// Boxes that reproduce the oracle exactly. The oracle's origin, rotation and cropBox are all
    /// OPTIONAL with documented defaults (origin 0, rotation unchecked, cropBox = mediaBox extent),
    /// so the defaults are applied here rather than assumed present.
    private func boxesMatching(_ oracle: A07Oracle) -> [A07Observed.Box] {
        oracle.expected.perPageMediaBox.map { b in
            let crop: (Double, Double, Double, Double) = b.cropBox.map { ($0.x, $0.y, $0.width, $0.height) }
                ?? (b.x ?? 0, b.y ?? 0, b.width, b.height)
            return obsBox(b.pageIndex, b.x ?? 0, b.y ?? 0, b.width, b.height,
                          rot: b.rotation ?? 0, crop: crop)
        }
    }

    /// Sample values that match the oracle exactly, so a failure can only come from the box under test.
    private func matchingSamples(_ oracle: A07Oracle) -> [A07Observed.SampleNorm] {
        oracle.expected.samplePoints.map { .init(nx: $0.normalized.nx, ny: $0.normalized.ny) }
    }

    // MARK: - The core defect: NaN in each geometry field

    func testNaNBoxExtentIsRejectedAsClass2() throws {
        let oracle = try realOracle()
        let observed = A07Observed(
            pageCount: 2,
            perPageMediaBox: [obsBox(0, 0, 0, Double.nan, 792), obsBox(1, 0, 0, 612, 792)],
            sampleNormalized: matchingSamples(oracle)
        )
        let r = EvidenceCoreA07Harness.evaluate(observed: observed, oracle: oracle)
        XCTAssertEqual(r.status, .fail, "a NaN box width passed every tolerance check before this guard")
        XCTAssertEqual(r.classification, .class_2_geometry_source_instability,
                       "a renderer emitting NaN is an unsound geometry source, not a normalization bug")
    }

    func testNaNBoxOriginIsRejectedAsClass2() throws {
        let oracle = try realOracle()
        let observed = A07Observed(
            pageCount: 2,
            perPageMediaBox: [obsBox(0, Double.nan, 0, 612, 792), obsBox(1, 0, 0, 612, 792)],
            sampleNormalized: matchingSamples(oracle)
        )
        let r = EvidenceCoreA07Harness.evaluate(observed: observed, oracle: oracle)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .class_2_geometry_source_instability)
    }

    func testNaNCropBoxIsRejectedAsClass2() throws {
        let oracle = try realOracle()
        let observed = A07Observed(
            pageCount: 2,
            perPageMediaBox: [obsBox(0, 0, 0, 612, 792, crop: (0, 0, Double.nan, 792)), obsBox(1, 0, 0, 612, 792)],
            sampleNormalized: matchingSamples(oracle)
        )
        let r = EvidenceCoreA07Harness.evaluate(observed: observed, oracle: oracle)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .class_2_geometry_source_instability)
    }

    /// The normalized sample values are the "math under test". A NaN here also slipped through, and
    /// it is the value an anchor would actually be stored from.
    func testNaNNormalizedSampleIsRejectedAsClass2() throws {
        let oracle = try realOracle()
        try XCTSkipIf(oracle.expected.samplePoints.isEmpty, "this oracle carries no sample points")
        var samples = matchingSamples(oracle)
        samples[0] = .init(nx: Double.nan, ny: samples[0].ny)
        let observed = A07Observed(
            pageCount: 2,
            perPageMediaBox: [obsBox(0, 0, 0, 612, 792), obsBox(1, 0, 0, 612, 792)],
            sampleNormalized: samples
        )
        let r = EvidenceCoreA07Harness.evaluate(observed: observed, oracle: oracle)
        XCTAssertEqual(r.status, .fail, "a NaN normalized sample passed before this guard")
        XCTAssertEqual(r.classification, .class_2_geometry_source_instability)
    }

    // MARK: - Infinity: already failed, but for the wrong stated reason

    func testInfiniteBoxExtentIsRejectedAsClass2() throws {
        let oracle = try realOracle()
        let observed = A07Observed(
            pageCount: 2,
            perPageMediaBox: [obsBox(0, 0, 0, Double.infinity, 792), obsBox(1, 0, 0, 612, 792)],
            sampleNormalized: matchingSamples(oracle)
        )
        let r = EvidenceCoreA07Harness.evaluate(observed: observed, oracle: oracle)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .class_2_geometry_source_instability)
    }

    // MARK: - The guard must not become a new way to fail

    /// The whole point of a finiteness guard is that it fires ONLY on non-finite input. If it also
    /// rejected ordinary geometry, it would trade a blind spot for a broken gate — so pin the
    /// negative case explicitly rather than trusting the other suites to catch it.
    func testFullyFiniteMatchingGeometryStillPasses() throws {
        let oracle = try realOracle()
        let observed = A07Observed(pageCount: oracle.expected.pageCount,
                                   perPageMediaBox: boxesMatching(oracle),
                                   sampleNormalized: matchingSamples(oracle))
        let r = EvidenceCoreA07Harness.evaluate(observed: observed, oracle: oracle)
        XCTAssertEqual(r.status, .pass, "the finiteness guard must not reject ordinary geometry")
        XCTAssertEqual(r.classification, .ok)
    }

    /// Negative zero is finite and legitimate (PDFKit can report -0.0 for an origin). It must be
    /// treated as 0.0, not swept up by the guard.
    func testNegativeZeroOriginIsFiniteAndPasses() throws {
        let oracle = try realOracle()
        let boxes = boxesMatching(oracle).map { b in
            A07Observed.Box(pageIndex: b.pageIndex,
                            originX: b.originX == 0 ? -0.0 : b.originX,
                            originY: b.originY, width: b.width, height: b.height,
                            rotation: b.rotation, cropBox: b.cropBox)
        }
        let observed = A07Observed(pageCount: oracle.expected.pageCount,
                                   perPageMediaBox: boxes,
                                   sampleNormalized: matchingSamples(oracle))
        let r = EvidenceCoreA07Harness.evaluate(observed: observed, oracle: oracle)
        XCTAssertEqual(r.status, .pass, "-0.0 is a finite coordinate and must not trip the guard")
    }

    /// The detail string is what a human reads when the gate stops the lane. It must name the real
    /// condition — a stack trace that says "width mismatch" for a NaN sends the reader after the
    /// wrong bug.
    func testDetailNamesTheNonFiniteCondition() throws {
        let oracle = try realOracle()
        let observed = A07Observed(
            pageCount: 2,
            perPageMediaBox: [obsBox(0, 0, 0, Double.nan, 792), obsBox(1, 0, 0, 612, 792)],
            sampleNormalized: matchingSamples(oracle)
        )
        let r = EvidenceCoreA07Harness.evaluate(observed: observed, oracle: oracle)
        XCTAssertTrue(r.detail.lowercased().contains("non-finite"),
                      "detail must say the observation was non-finite; got: \(r.detail)")
        XCTAssertTrue(r.detail.contains("page 0"), "detail must locate the offending page; got: \(r.detail)")
    }
}
