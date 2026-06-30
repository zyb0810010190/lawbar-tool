import XCTest
import Foundation
@testable import EvidenceCoreSmoke

// Tests for the A3-T10 anchor-resolution regression gate (WI-EVIDENCE-A3-T10-ANCHOR-REGRESSION-GATE-00).
// They run the gate against the committed synthetic fixture + oracle (expecting PASS), prove byte-identical
// resolution across reopen/replay, pin each resolver rung + combined precedence (drift guard vs the built
// linkStatusResolverQueries.ts ladder), and prove inconclusive / malformed / mismatch are never pass. The
// gate writes no marker (isMarker=false) and changes no A3 runtime.
final class A3AnchorRegressionHarnessTests: XCTestCase {
    private var fixturesDir: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("Fixtures").appendingPathComponent("a3-regression")
    }
    private var fixtureURL: URL { fixturesDir.appendingPathComponent("anchor-regression.json") }
    private var oracleURL: URL { fixturesDir.appendingPathComponent("anchor-regression.oracle.json") }

    private func decodeFixture() throws -> A3Fixture {
        try JSONDecoder().decode(A3Fixture.self, from: Data(contentsOf: fixtureURL))
    }
    private func fixture(_ json: String) throws -> A3Fixture {
        try JSONDecoder().decode(A3Fixture.self, from: Data(json.utf8))
    }
    private func status(_ fx: A3Fixture, _ linkId: String) -> (A3LinkStatus, Bool)? {
        EvidenceCoreA3Regression.resolve(fx).first { $0.linkId == linkId }.map { ($0.status, $0.unlinked) }
    }

    // MARK: - End-to-end against the committed fixture + oracle

    func testRealFixturePasses() {
        let r = EvidenceCoreA3Regression.run(fixtureURL: fixtureURL, oracleURL: oracleURL)
        XCTAssertEqual(r.status, .pass, "committed regression fixture should match the committed oracle: \(r.detail)")
        XCTAssertEqual(r.classification, .ok)
        XCTAssertEqual(r.observedLinkCount, 8)
    }

    func testResultSchemaShape() {
        let r = EvidenceCoreA3Regression.run(fixtureURL: fixtureURL, oracleURL: oracleURL)
        XCTAssertEqual(r.orderedFields().map { $0.0 }, ["status", "classification", "observedLinkCount", "isMarker", "detail"])
        XCTAssertEqual(r.orderedFields().first { $0.0 == "isMarker" }?.1, "false")
    }

    // MARK: - State coverage on the committed fixture (clean/broken/unlinked/relinked/version/superseded)

    func testAllRequiredStatesCovered() throws {
        let fx = try decodeFixture()
        XCTAssertEqual(status(fx, "L1-valid")?.0, .valid)
        XCTAssertEqual(status(fx, "L2-stale-version")?.0, .needs_review)        // geometry version mismatch
        XCTAssertEqual(status(fx, "L3-superseded")?.0, .needs_review)           // document superseded
        XCTAssertEqual(status(fx, "L4-missing-page")?.0, .broken)
        XCTAssertEqual(status(fx, "L5-missing-geometry")?.0, .broken)
        XCTAssertEqual(status(fx, "L6-unknown-anchor")?.0, .broken)            // missing anchor target
        // unlinked: broken AND the marker distinguishes it from a structural broken.
        XCTAssertEqual(status(fx, "L7-unlinked")?.0, .broken)
        XCTAssertEqual(status(fx, "L7-unlinked")?.1, true)
        // relinked: same structurally-valid anchor, unlinkedAt cleared -> valid (and not flagged unlinked).
        XCTAssertEqual(status(fx, "L8-relinked")?.0, .valid)
        XCTAssertEqual(status(fx, "L8-relinked")?.1, false)
    }

    // MARK: - Reopen/replay byte-identical + machine-independent serialization

    func testResolutionByteIdenticalAcrossRuns() throws {
        let fx = try decodeFixture()
        XCTAssertEqual(EvidenceCoreA3Regression.serialize(EvidenceCoreA3Regression.resolve(fx)),
                       EvidenceCoreA3Regression.serialize(EvidenceCoreA3Regression.resolve(fx)))
        let fx2 = try decodeFixture() // close/reopen
        XCTAssertEqual(EvidenceCoreA3Regression.serialize(EvidenceCoreA3Regression.resolve(fx)),
                       EvidenceCoreA3Regression.serialize(EvidenceCoreA3Regression.resolve(fx2)))
    }

    func testSerializationIsDeterministicAndMachineIndependent() throws {
        let US = "\u{1F}"
        let expected = [
            "L1-valid\(US)valid\(US)linked",
            "L2-stale-version\(US)needs_review\(US)linked",
            "L3-superseded\(US)needs_review\(US)linked",
            "L4-missing-page\(US)broken\(US)linked",
            "L5-missing-geometry\(US)broken\(US)linked",
            "L6-unknown-anchor\(US)broken\(US)linked",
            "L7-unlinked\(US)broken\(US)unlinked",
            "L8-relinked\(US)valid\(US)linked",
        ].joined(separator: "\n")
        let actual = EvidenceCoreA3Regression.serialize(EvidenceCoreA3Regression.resolve(try decodeFixture()))
        XCTAssertEqual(actual, expected, "deterministic ordering by linkId; no machine/time/locale dependence")
        XCTAssertFalse(actual.contains("/Users"))
    }

    // MARK: - Drift guard: rung-by-rung + combined precedence vs linkStatusResolverQueries.ts CASE

    func testRungUnlinkedBeatsEverything() throws {
        // unlinked + missing anchor still -> broken with unlinked=true (rung 0 highest).
        let fx = try fixture("""
        { "documents": [], "pages": [], "geometries": [], "anchors": [],
          "links": [ { "linkId": "x", "anchorId": "ghost", "unlinkedAt": "2026-06-30T00:00:00Z" } ] }
        """)
        XCTAssertEqual(status(fx, "x")?.0, .broken)
        XCTAssertEqual(status(fx, "x")?.1, true)
    }

    func testRungMissingGeometryBeatsSuperseded() throws {
        // missing V10 geometry (rung 3) wins over supersession (rung 5) -> broken, not needs_review.
        let fx = try fixture("""
        { "documents": [ { "id": "new", "supersedesDocumentId": "d" }, { "id": "d" } ],
          "pages": [ { "documentId": "d", "physicalPageIndex": 0 } ],
          "geometries": [],
          "anchors": [ { "anchorId": "a", "documentId": "d", "physicalPageIndex": 0, "geometryCapturedAt": "t1" } ],
          "links": [ { "linkId": "x", "anchorId": "a" } ] }
        """)
        XCTAssertEqual(status(fx, "x")?.0, .broken)
        XCTAssertEqual(status(fx, "x")?.1, false)
    }

    func testRungVersionMismatchBeatsSuperseded() throws {
        // geometry mismatch (rung 4) wins over supersession (rung 5) -> still needs_review (both map there,
        // but order is pinned).
        let fx = try fixture("""
        { "documents": [ { "id": "new", "supersedesDocumentId": "d" }, { "id": "d" } ],
          "pages": [ { "documentId": "d", "physicalPageIndex": 0 } ],
          "geometries": [ { "documentId": "d", "physicalPageIndex": 0, "capturedAt": "t1" } ],
          "anchors": [ { "anchorId": "a", "documentId": "d", "physicalPageIndex": 0, "geometryCapturedAt": "t0" } ],
          "links": [ { "linkId": "x", "anchorId": "a" } ] }
        """)
        XCTAssertEqual(status(fx, "x")?.0, .needs_review)
    }

    func testSupersessionIsReverseLookup() throws {
        // A document is superseded iff ANOTHER document's supersedesDocumentId points at it. The
        // superseding (new) document itself remains valid.
        let fx = try fixture("""
        { "documents": [ { "id": "new", "supersedesDocumentId": "old" }, { "id": "old" } ],
          "pages": [ { "documentId": "new", "physicalPageIndex": 0 }, { "documentId": "old", "physicalPageIndex": 0 } ],
          "geometries": [ { "documentId": "new", "physicalPageIndex": 0, "capturedAt": "t1" },
                          { "documentId": "old", "physicalPageIndex": 0, "capturedAt": "t1" } ],
          "anchors": [ { "anchorId": "an", "documentId": "new", "physicalPageIndex": 0, "geometryCapturedAt": "t1" },
                       { "anchorId": "ao", "documentId": "old", "physicalPageIndex": 0, "geometryCapturedAt": "t1" } ],
          "links": [ { "linkId": "n", "anchorId": "an" }, { "linkId": "o", "anchorId": "ao" } ] }
        """)
        XCTAssertEqual(status(fx, "n")?.0, .valid)        // the new (superseding) document is fine
        XCTAssertEqual(status(fx, "o")?.0, .needs_review) // the old (superseded) document
    }

    // MARK: - Negatives: inconclusive / malformed / mismatch are NEVER pass

    func testInconclusiveWhenNoCheckableAssertions() throws {
        let fx = try decodeFixture()
        let oracle = try JSONDecoder().decode(A3Oracle.self, from: Data("{ \"expected\": [] }".utf8))
        let r = EvidenceCoreA3Regression.evaluate(fixture: fx, oracle: oracle)
        XCTAssertEqual(r.status, .inconclusive)
        XCTAssertEqual(r.classification, .inconclusive_no_checkable_assertions)
        XCTAssertNotEqual(r.status, .pass)
    }

    func testMalformedOracleIsInvalidNotPass() throws {
        let tmp = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("a3t10-corrupt-oracle-\(UUID().uuidString).json")
        try Data("{ not valid json".utf8).write(to: tmp)
        defer { try? FileManager.default.removeItem(at: tmp) }
        let r = EvidenceCoreA3Regression.run(fixtureURL: fixtureURL, oracleURL: tmp)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .fixture_or_oracle_invalid)
        XCTAssertNotEqual(r.status, .pass)
    }

    func testMissingFixtureIsInvalidNotPass() {
        let r = EvidenceCoreA3Regression.run(fixtureURL: fixturesDir.appendingPathComponent("nope.json"), oracleURL: oracleURL)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .fixture_or_oracle_invalid)
    }

    func testIncompleteOracleIsInvalidNotPass() throws {
        // A truncated oracle covering only ONE of the 8 resolved links must NOT pass — it is rejected as
        // fixture_or_oracle_invalid (oracle completeness; audit-mr06winp-3vxzl7 Medium fix), never a false green.
        let fx = try decodeFixture()
        let partial = try JSONDecoder().decode(A3Oracle.self, from: Data("""
        { "expected": [ { "linkId": "L1-valid", "status": "valid", "unlinked": false } ] }
        """.utf8))
        let r = EvidenceCoreA3Regression.evaluate(fixture: fx, oracle: partial)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .fixture_or_oracle_invalid)
        XCTAssertNotEqual(r.status, .pass, "a truncated oracle must never pass")
    }

    func testDuplicateOracleEntryIsInvalidNotPass() throws {
        let fx = try fixture("""
        { "documents": [], "pages": [], "geometries": [], "anchors": [],
          "links": [ { "linkId": "x", "anchorId": "ghost" } ] }
        """)
        let dup = try JSONDecoder().decode(A3Oracle.self, from: Data("""
        { "expected": [ { "linkId": "x", "status": "broken", "unlinked": false },
                        { "linkId": "x", "status": "broken", "unlinked": false } ] }
        """.utf8))
        let r = EvidenceCoreA3Regression.evaluate(fixture: fx, oracle: dup)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .fixture_or_oracle_invalid)
    }

    func testWrongOracleExpectationIsMismatchNotPass() throws {
        // A COMPLETE oracle (covers all 8 links) with one wrong expectation (L7-unlinked as valid) must
        // FAIL as resolution_mismatch (not invalid — the oracle is complete, just wrong).
        let fx = try decodeFixture()
        let bad = try JSONDecoder().decode(A3Oracle.self, from: Data("""
        { "expected": [
          { "linkId": "L1-valid",            "status": "valid",        "unlinked": false },
          { "linkId": "L2-stale-version",    "status": "needs_review", "unlinked": false },
          { "linkId": "L3-superseded",       "status": "needs_review", "unlinked": false },
          { "linkId": "L4-missing-page",     "status": "broken",       "unlinked": false },
          { "linkId": "L5-missing-geometry", "status": "broken",       "unlinked": false },
          { "linkId": "L6-unknown-anchor",   "status": "broken",       "unlinked": false },
          { "linkId": "L7-unlinked",         "status": "valid",        "unlinked": false },
          { "linkId": "L8-relinked",         "status": "valid",        "unlinked": false }
        ] }
        """.utf8))
        let r = EvidenceCoreA3Regression.evaluate(fixture: fx, oracle: bad)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .resolution_mismatch)
        XCTAssertNotEqual(r.status, .pass)
    }

    func testNonFileUrlsAreRefused() {
        let r = EvidenceCoreA3Regression.run(
            fixtureURL: URL(string: "https://example.com/a.json")!,
            oracleURL: URL(string: "https://example.com/o.json")!)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .fixture_or_oracle_invalid)
        XCTAssertTrue(r.detail.contains("file URL"))
    }
}
