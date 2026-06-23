import XCTest
import Foundation
@testable import EvidenceCoreSmoke

// Tests for the WI-ENA8 A0.7 renderer-conformance harness. They run the harness against the committed
// fixture + oracle (expecting PASS), assert the deterministic result shape, and exercise each failure
// classification (class_1 / class_2 / fixture_or_oracle_invalid) + the inconclusive path via the pure
// evaluate() classifier. The harness writes no marker and the result explicitly carries isMarker=false.
final class A07ConformanceHarnessTests: XCTestCase {
    private var fixturesDir: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures")
    }
    private var fixtureURL: URL { fixturesDir.appendingPathComponent("synthetic-twopage.pdf") }
    private var oracleURL: URL { fixturesDir.appendingPathComponent("a07-renderer-conformance/oracle.json") }

    private func decodeRealOracle() throws -> A07Oracle {
        let data = try Data(contentsOf: oracleURL)
        return try JSONDecoder().decode(A07Oracle.self, from: data)
    }

    // MARK: - End-to-end against the committed fixture + oracle

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
        // A harness result is never a marker.
        let isMarker = result.orderedFields().first { $0.0 == "isMarker" }?.1
        XCTAssertEqual(isMarker, "false")
    }

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

    func testUndecodableOracleIsInvalid() throws {
        // Write a corrupt oracle to a TEMP file (never touches the committed oracle.json).
        let tmp = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("ena8-corrupt-oracle-\(UUID().uuidString).json")
        try Data("{ not valid json".utf8).write(to: tmp)
        defer { try? FileManager.default.removeItem(at: tmp) }
        let result = EvidenceCoreA07Harness.run(fixtureURL: fixtureURL, oracleURL: tmp)
        XCTAssertEqual(result.status, .fail)
        XCTAssertEqual(result.classification, .fixture_or_oracle_invalid)
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
            perPageMediaBox: [.init(pageIndex: 0, width: 612, height: 792), .init(pageIndex: 1, width: 612, height: 792)],
            sampleNormalized: oracle.expected.samplePoints.map { .init(nx: $0.normalized.nx, ny: $0.normalized.ny) }
        )
        let r = EvidenceCoreA07Harness.evaluate(observed: observed, oracle: oracle)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .class_2_geometry_source_instability)
    }

    func testClass2OnBoxMismatch() throws {
        let oracle = try decodeRealOracle()
        let observed = A07Observed(
            pageCount: 2,
            perPageMediaBox: [.init(pageIndex: 0, width: 600, height: 792), .init(pageIndex: 1, width: 612, height: 792)],
            sampleNormalized: oracle.expected.samplePoints.map { .init(nx: $0.normalized.nx, ny: $0.normalized.ny) }
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
            perPageMediaBox: [.init(pageIndex: 0, width: 612, height: 792), .init(pageIndex: 1, width: 612, height: 792)],
            sampleNormalized: bad
        )
        let r = EvidenceCoreA07Harness.evaluate(observed: observed, oracle: oracle)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .class_1_normalization_math_bug)
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
}
