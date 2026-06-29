import XCTest
import Foundation
@testable import EvidenceCoreSmoke

// Tests for the A0.7 renderer-conformance harness (WI-ENA8; messy-fixture coverage extended in
// WI-EVIDENCE-A0.7-FIXTURE-COVERAGE-00). They run the harness against the committed fixtures + oracles
// (expecting PASS), assert the deterministic result shape, and exercise each failure classification
// (class_1 / class_2 / fixture_or_oracle_invalid) + the inconclusive path via the pure evaluate()
// classifier. Messy coverage adds rotated / cropBox-mismatch / non-zero-origin / mixed-page-size
// fixtures and the corresponding class_2 (geometry-source) + class_1 (origin-not-subtracted) negatives.
// The harness writes no marker and the result explicitly carries isMarker=false.
final class A07ConformanceHarnessTests: XCTestCase {
    private var fixturesDir: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures")
    }
    private var fixtureURL: URL { fixturesDir.appendingPathComponent("synthetic-twopage.pdf") }
    private var oracleURL: URL { fixturesDir.appendingPathComponent("a07-renderer-conformance/oracle.json") }

    private var messyDir: URL { fixturesDir.appendingPathComponent("messy") }
    private func messyFixture(_ name: String) -> URL { messyDir.appendingPathComponent("synthetic-\(name).pdf") }
    private func messyOracle(_ name: String) -> URL { messyDir.appendingPathComponent("synthetic-\(name).oracle.json") }

    private func decodeRealOracle() throws -> A07Oracle {
        let data = try Data(contentsOf: oracleURL)
        return try JSONDecoder().decode(A07Oracle.self, from: data)
    }
    private func decodeMessyOracle(_ name: String) throws -> A07Oracle {
        try JSONDecoder().decode(A07Oracle.self, from: Data(contentsOf: messyOracle(name)))
    }

    /// Build an observed box; cropBox defaults to the mediaBox extent at the same origin (PDFKit's
    /// behavior when a page declares no CropBox).
    private func obsBox(_ idx: Int, _ x: Double, _ y: Double, _ w: Double, _ h: Double,
                        rot: Int = 0, crop: (Double, Double, Double, Double)? = nil) -> A07Observed.Box {
        let c = crop ?? (x, y, w, h)
        return .init(pageIndex: idx, originX: x, originY: y, width: w, height: h, rotation: rot,
                     cropBox: .init(x: c.0, y: c.1, width: c.2, height: c.3))
    }

    // MARK: - End-to-end against the committed trivial fixture + oracle (regression)

    func testRealFixturePasses() {
        let result = EvidenceCoreA07Harness.run(fixtureURL: fixtureURL, oracleURL: oracleURL)
        #if canImport(PDFKit)
        XCTAssertEqual(result.status, .pass, "real fixture should match the committed oracle within tolerance")
        XCTAssertEqual(result.classification, .ok)
        XCTAssertEqual(result.observedPageCount, 2)
        #else
        XCTAssertEqual(result.status, .fail)
        XCTAssertEqual(result.classification, .not_implemented)
        #endif
    }

    func testResultSchemaShape() {
        let result = EvidenceCoreA07Harness.run(fixtureURL: fixtureURL, oracleURL: oracleURL)
        let keys = result.orderedFields().map { $0.0 }
        XCTAssertEqual(keys, ["status", "classification", "observedPageCount", "isMarker", "detail"])
        let isMarker = result.orderedFields().first { $0.0 == "isMarker" }?.1
        XCTAssertEqual(isMarker, "false")
    }

    // MARK: - End-to-end against the messy fixtures (all expected PASS — the harness observes the
    // rotation / cropBox / non-zero-origin / mixed-size geometry the handover §13 demands)

    func testMessyRotatedFixturePasses() {
        let r = EvidenceCoreA07Harness.run(fixtureURL: messyFixture("rotated"), oracleURL: messyOracle("rotated"))
        #if canImport(PDFKit)
        XCTAssertEqual(r.status, .pass, "rotated fixture (/Rotate 90) must pass with rotation observed")
        XCTAssertEqual(r.classification, .ok)
        XCTAssertEqual(r.observedPageCount, 1)
        XCTAssertNotEqual(r.status, .inconclusive, "a checkable assertion exists; must not be inconclusive")
        #else
        XCTAssertEqual(r.classification, .not_implemented)
        #endif
    }

    func testMessyCropBoxFixturePasses() {
        let r = EvidenceCoreA07Harness.run(fixtureURL: messyFixture("cropbox"), oracleURL: messyOracle("cropbox"))
        #if canImport(PDFKit)
        XCTAssertEqual(r.status, .pass, "cropBox != mediaBox fixture must pass with cropBox observed distinctly")
        XCTAssertEqual(r.classification, .ok)
        #else
        XCTAssertEqual(r.classification, .not_implemented)
        #endif
    }

    func testMessyNonZeroOriginFixturePasses() {
        let r = EvidenceCoreA07Harness.run(fixtureURL: messyFixture("nonzero-origin"), oracleURL: messyOracle("nonzero-origin"))
        #if canImport(PDFKit)
        XCTAssertEqual(r.status, .pass, "non-zero-origin fixture must pass with origin-subtracting normalization")
        XCTAssertEqual(r.classification, .ok)
        #else
        XCTAssertEqual(r.classification, .not_implemented)
        #endif
    }

    func testMessyMixedSizesFixturePasses() {
        let r = EvidenceCoreA07Harness.run(fixtureURL: messyFixture("mixed-sizes"), oracleURL: messyOracle("mixed-sizes"))
        #if canImport(PDFKit)
        XCTAssertEqual(r.status, .pass, "mixed page sizes (Letter + A4) must pass with per-page boxes observed")
        XCTAssertEqual(r.classification, .ok)
        XCTAssertEqual(r.observedPageCount, 2)
        #else
        XCTAssertEqual(r.classification, .not_implemented)
        #endif
    }

    // MARK: - Oracle/fixture invalidity + offline invariant

    func testOracleIsReadFromDiskNotHardcoded() throws {
        // Passing a non-existent oracle URL must fail as fixture_or_oracle_invalid — proving the
        // harness genuinely reads the oracle from disk rather than self-supplying expected values.
        let bogusOracle = fixturesDir.appendingPathComponent("a07-renderer-conformance/does-not-exist.json")
        let result = EvidenceCoreA07Harness.run(fixtureURL: fixtureURL, oracleURL: bogusOracle)
        XCTAssertEqual(result.status, .fail)
        XCTAssertEqual(result.classification, .fixture_or_oracle_invalid)
    }

    func testCorruptFixtureIsInvalid() {
        let bogusFixture = fixturesDir.appendingPathComponent("a07-renderer-conformance/oracle.json") // not a PDF
        let result = EvidenceCoreA07Harness.run(fixtureURL: bogusFixture, oracleURL: oracleURL)
        #if canImport(PDFKit)
        XCTAssertEqual(result.status, .fail)
        XCTAssertEqual(result.classification, .fixture_or_oracle_invalid)
        #else
        XCTAssertEqual(result.classification, .not_implemented)
        #endif
    }

    func testUndecodableOracleIsInvalidNotPass() throws {
        // Write a corrupt oracle to a TEMP file (never touches a committed oracle). Proves a malformed
        // oracle is fixture_or_oracle_invalid and is NEVER treated as pass.
        let tmp = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("a07cov-corrupt-oracle-\(UUID().uuidString).json")
        try Data("{ not valid json".utf8).write(to: tmp)
        defer { try? FileManager.default.removeItem(at: tmp) }
        let result = EvidenceCoreA07Harness.run(fixtureURL: fixtureURL, oracleURL: tmp)
        XCTAssertEqual(result.status, .fail)
        XCTAssertEqual(result.classification, .fixture_or_oracle_invalid)
        XCTAssertNotEqual(result.status, .pass, "a malformed oracle must never be treated as pass")
    }

    func testNonFileUrlsAreRefused() {
        // Offline invariant: http(s) URLs must be refused before any load, with no network I/O.
        let httpFixture = URL(string: "https://example.com/synthetic-twopage.pdf")!
        let httpOracle = URL(string: "https://example.com/oracle.json")!
        let result = EvidenceCoreA07Harness.run(fixtureURL: httpFixture, oracleURL: httpOracle)
        XCTAssertEqual(result.status, .fail)
        XCTAssertEqual(result.classification, .fixture_or_oracle_invalid)
        XCTAssertTrue(result.detail.contains("file URL"), "must refuse non-file URLs as an offline harness")
    }

    // MARK: - Pure classifier (evaluate) — failure classifications

    func testClass2OnPageCountMismatch() throws {
        let oracle = try decodeRealOracle()
        let observed = A07Observed(
            pageCount: 3,
            perPageMediaBox: [obsBox(0, 0, 0, 612, 792), obsBox(1, 0, 0, 612, 792)],
            sampleNormalized: oracle.expected.samplePoints.map { .init(nx: $0.normalized.nx, ny: $0.normalized.ny) }
        )
        let r = EvidenceCoreA07Harness.evaluate(observed: observed, oracle: oracle)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .class_2_geometry_source_instability)
    }

    func testClass2OnBoxExtentMismatch() throws {
        let oracle = try decodeRealOracle()
        let observed = A07Observed(
            pageCount: 2,
            perPageMediaBox: [obsBox(0, 0, 0, 600, 792), obsBox(1, 0, 0, 612, 792)],
            sampleNormalized: oracle.expected.samplePoints.map { .init(nx: $0.normalized.nx, ny: $0.normalized.ny) }
        )
        let r = EvidenceCoreA07Harness.evaluate(observed: observed, oracle: oracle)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .class_2_geometry_source_instability)
    }

    func testClass2OnOriginMismatch() throws {
        // Oracle asserts origin (50,50); renderer reports origin (0,0) -> geometry-source instability.
        let oracle = try decodeMessyOracle("nonzero-origin")
        let observed = A07Observed(
            pageCount: 1,
            perPageMediaBox: [obsBox(0, 0, 0, 612, 792)], // wrong origin
            sampleNormalized: oracle.expected.samplePoints.map { .init(nx: $0.normalized.nx, ny: $0.normalized.ny) }
        )
        let r = EvidenceCoreA07Harness.evaluate(observed: observed, oracle: oracle)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .class_2_geometry_source_instability)
    }

    func testClass2OnRotationMismatch() throws {
        // Oracle asserts rotation 90; renderer reports 0 -> geometry-source instability.
        let oracle = try decodeMessyOracle("rotated")
        let observed = A07Observed(
            pageCount: 1,
            perPageMediaBox: [obsBox(0, 0, 0, 612, 792, rot: 0)], // wrong rotation
            sampleNormalized: []
        )
        let r = EvidenceCoreA07Harness.evaluate(observed: observed, oracle: oracle)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .class_2_geometry_source_instability)
    }

    func testClass2OnCropBoxMismatch() throws {
        // Oracle asserts cropBox (50,50,512,692); renderer reports cropBox == mediaBox -> instability.
        let oracle = try decodeMessyOracle("cropbox")
        let observed = A07Observed(
            pageCount: 1,
            perPageMediaBox: [obsBox(0, 0, 0, 612, 792, crop: (0, 0, 612, 792))], // wrong cropBox
            sampleNormalized: []
        )
        let r = EvidenceCoreA07Harness.evaluate(observed: observed, oracle: oracle)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .class_2_geometry_source_instability)
    }

    func testClass1OnNormalizedMismatch() throws {
        let oracle = try decodeRealOracle()
        // Boxes correct, but the normalized math is wrong -> class_1.
        var bad = oracle.expected.samplePoints.map { A07Observed.SampleNorm(nx: $0.normalized.nx, ny: $0.normalized.ny) }
        bad[0] = .init(nx: bad[0].nx + 0.01, ny: bad[0].ny)
        let observed = A07Observed(
            pageCount: 2,
            perPageMediaBox: [obsBox(0, 0, 0, 612, 792), obsBox(1, 0, 0, 612, 792)],
            sampleNormalized: bad
        )
        let r = EvidenceCoreA07Harness.evaluate(observed: observed, oracle: oracle)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .class_1_normalization_math_bug)
    }

    func testClass1OnOriginNotSubtracted() throws {
        // Box (incl. origin 50,50) correct, but samples normalized WITHOUT subtracting origin
        // (nx = x/w instead of (x-50)/612) -> a normalization/math bug, Class-1 (handover §5 example).
        let oracle = try decodeMessyOracle("nonzero-origin")
        let w = 612.0, h = 792.0
        let bad = oracle.expected.samplePoints.map { A07Observed.SampleNorm(nx: $0.pdf.x / w, ny: $0.pdf.y / h) }
        let observed = A07Observed(
            pageCount: 1,
            perPageMediaBox: [obsBox(0, 50, 50, 612, 792)], // origin correct
            sampleNormalized: bad
        )
        let r = EvidenceCoreA07Harness.evaluate(observed: observed, oracle: oracle)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .class_1_normalization_math_bug,
                       "origin-not-subtracted is a normalization bug with correct geometry => Class-1")
    }

    func testInconclusiveWhenNoCheckableAssertions() throws {
        let json = """
        { "expected": { "pageCount": 2, "perPageMediaBox": [], "samplePoints": [] },
          "tolerance": { "absolutePdfPoints": 1e-9 } }
        """
        let oracle = try JSONDecoder().decode(A07Oracle.self, from: Data(json.utf8))
        let observed = A07Observed(pageCount: 2, perPageMediaBox: [], sampleNormalized: [])
        let r = EvidenceCoreA07Harness.evaluate(observed: observed, oracle: oracle)
        XCTAssertEqual(r.status, .inconclusive)
        XCTAssertEqual(r.classification, .inconclusive_no_checkable_assertions)
        XCTAssertNotEqual(r.status, .pass, "inconclusive must never be pass")
    }

    func testExistingTrivialOracleStillDecodesBackwardCompatible() throws {
        // The pre-existing oracle has no origin/cropBox/rotation/samplePageIndex fields; it must still
        // decode (additive-optional) and pass end-to-end.
        let oracle = try decodeRealOracle()
        XCTAssertEqual(oracle.expected.pageCount, 2)
        XCTAssertNil(oracle.expected.samplePageIndex)
        XCTAssertNil(oracle.expected.perPageMediaBox.first?.rotation)
        XCTAssertNil(oracle.expected.perPageMediaBox.first?.cropBox)
    }
}
