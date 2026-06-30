import XCTest
import Foundation
@testable import EvidenceCoreSmoke

// Tests for the A1-T6 citation-stability gate (WI-EVIDENCE-A1-T6-CITATION-STABILITY-GATE-00). They run the
// gate against the committed DocumentPage citation-map fixture + oracle (expecting PASS), assert the
// deterministic result shape, prove byte-identical citation identity across repeat runs, prove the 卷X页Y
// golden format + ambiguity + non-citable behavior match the built TS contract, and prove inconclusive /
// malformed / mismatch are never pass. The gate writes no marker (isMarker=false).
final class A1CitationStabilityHarnessTests: XCTestCase {
    private var fixturesDir: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("Fixtures").appendingPathComponent("a1-citation")
    }
    private var fixtureURL: URL { fixturesDir.appendingPathComponent("citation-map.json") }
    private var oracleURL: URL { fixturesDir.appendingPathComponent("citation-map.oracle.json") }

    private func decodeFixture() throws -> A1Fixture {
        try JSONDecoder().decode(A1Fixture.self, from: Data(contentsOf: fixtureURL))
    }

    // MARK: - End-to-end against the committed fixture + oracle

    func testRealFixturePasses() {
        let r = EvidenceCoreA1CitationGate.run(fixtureURL: fixtureURL, oracleURL: oracleURL)
        XCTAssertEqual(r.status, .pass, "committed citation map should match the committed oracle: \(r.detail)")
        XCTAssertEqual(r.classification, .ok)
        XCTAssertEqual(r.observedPageCount, 6)
    }

    func testResultSchemaShape() {
        let r = EvidenceCoreA1CitationGate.run(fixtureURL: fixtureURL, oracleURL: oracleURL)
        XCTAssertEqual(r.orderedFields().map { $0.0 }, ["status", "classification", "observedPageCount", "isMarker", "detail"])
        XCTAssertEqual(r.orderedFields().first { $0.0 == "isMarker" }?.1, "false")
    }

    // MARK: - Drift guard: 卷X页Y golden + ambiguity + non-citable match the built TS contract

    func testGoldenCitationFormatAndClassification() throws {
        let derived = EvidenceCoreA1CitationGate.derive(try decodeFixture())
        func page(_ id: String, _ idx: Int) -> A1DerivedPage? { derived.first { $0.documentId == id && $0.physicalPageIndex == idx } }
        // Clean golden 卷1页5 — byte-for-byte the built TS `卷${citationVolume}页${citationPageLabel}`.
        XCTAssertEqual(page("d1", 0)?.outcome, .clean)
        XCTAssertEqual(page("d1", 0)?.text, "卷1页5")
        XCTAssertEqual(page("d1", 1)?.text, "卷1页6")
        // Ambiguous: (2,3) on two physical pages in d2 — never a clean citation.
        XCTAssertEqual(page("d2", 0)?.outcome, .ambiguous)
        XCTAssertEqual(page("d2", 1)?.outcome, .ambiguous)
        XCTAssertNil(page("d2", 0)?.text)
        // Non-citable: isCitable=false and empty citationVolume.
        XCTAssertEqual(page("d3", 0)?.outcome, .non_citable)
        XCTAssertEqual(page("d3", 1)?.outcome, .non_citable)
    }

    // MARK: - A1-T6 core: byte-identical citation identity across close/reopen (repeat runs)

    func testCitationIdentityByteIdenticalAcrossRuns() throws {
        let fx = try decodeFixture()
        let s1 = EvidenceCoreA1CitationGate.serialize(EvidenceCoreA1CitationGate.derive(fx))
        let s2 = EvidenceCoreA1CitationGate.serialize(EvidenceCoreA1CitationGate.derive(fx))
        XCTAssertEqual(s1, s2, "citation identity must be byte-identical across repeat derivations")
        // Reload the fixture from disk (close/reopen) and re-derive — still byte-identical.
        let fx2 = try decodeFixture()
        let s3 = EvidenceCoreA1CitationGate.serialize(EvidenceCoreA1CitationGate.derive(fx2))
        XCTAssertEqual(s1, s3, "citation identity must be byte-identical across close/reopen")
    }

    func testSerializationIsFullyDeterministicAndMachineIndependent() throws {
        // The serialization is a pure function of the fixture: no machine paths, timestamps, locale, or
        // renderer metadata. Asserting an exact constant proves determinism + machine-independence.
        let US = "\u{1F}"
        let expected = [
            "d1\(US)0\(US)clean\(US)卷1页5",
            "d1\(US)1\(US)clean\(US)卷1页6",
            "d2\(US)0\(US)ambiguous\(US)",
            "d2\(US)1\(US)ambiguous\(US)",
            "d3\(US)0\(US)non_citable\(US)",
            "d3\(US)1\(US)non_citable\(US)",
        ].joined(separator: "\n")
        let actual = EvidenceCoreA1CitationGate.serialize(EvidenceCoreA1CitationGate.derive(try decodeFixture()))
        XCTAssertEqual(actual, expected, "deterministic ordering + format; no machine/time/locale dependence")
        XCTAssertFalse(actual.contains("/Users"), "serialization must not contain machine paths")
    }

    // MARK: - Negatives: inconclusive / malformed / mismatch are NEVER pass

    func testInconclusiveWhenNoCheckableAssertions() throws {
        let fx = try decodeFixture()
        let oracle = try JSONDecoder().decode(A1Oracle.self, from: Data("{ \"expected\": [] }".utf8))
        let r = EvidenceCoreA1CitationGate.evaluate(fixture: fx, oracle: oracle)
        XCTAssertEqual(r.status, .inconclusive)
        XCTAssertEqual(r.classification, .inconclusive_no_checkable_assertions)
        XCTAssertNotEqual(r.status, .pass, "inconclusive must never be pass")
    }

    func testMalformedOracleIsInvalidNotPass() throws {
        let tmp = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("a1t6-corrupt-oracle-\(UUID().uuidString).json")
        try Data("{ not valid json".utf8).write(to: tmp)
        defer { try? FileManager.default.removeItem(at: tmp) }
        let r = EvidenceCoreA1CitationGate.run(fixtureURL: fixtureURL, oracleURL: tmp)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .fixture_or_oracle_invalid)
        XCTAssertNotEqual(r.status, .pass, "a malformed oracle must never be pass")
    }

    func testMissingFixtureIsInvalidNotPass() {
        let bogus = fixturesDir.appendingPathComponent("does-not-exist.json")
        let r = EvidenceCoreA1CitationGate.run(fixtureURL: bogus, oracleURL: oracleURL)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .fixture_or_oracle_invalid)
    }

    // The committed oracle's expected rows, as mutable dicts — the base for building COMPLETE oracles that
    // satisfy the A1T6-AUD-L1 completeness gate, with one row deliberately mutated per test.
    private func completeExpected() throws -> [[String: Any]] {
        let raw = try JSONSerialization.jsonObject(with: Data(contentsOf: oracleURL)) as! [String: Any]
        return raw["expected"] as! [[String: Any]]
    }
    private func oracle(_ expected: [[String: Any]]) throws -> A1Oracle {
        let data = try JSONSerialization.data(withJSONObject: ["expected": expected])
        return try JSONDecoder().decode(A1Oracle.self, from: data)
    }
    private func mutate(_ rows: [[String: Any]], doc: String, page: Int,
                        _ f: (inout [String: Any]) -> Void) -> [[String: Any]] {
        var out = rows
        for i in out.indices where (out[i]["documentId"] as? String) == doc && (out[i]["physicalPageIndex"] as? Int) == page {
            f(&out[i])
        }
        return out
    }

    func testAmbiguityExpectedCleanIsMismatchNotPass() throws {
        // A COMPLETE oracle (so the completeness gate is satisfied) that wrongly flips the ambiguous page
        // d2/0 to a clean citation must FAIL (mismatch), proving the gate never silently turns an ambiguous
        // label into a clean citation.
        let fx = try decodeFixture()
        let rows = mutate(try completeExpected(), doc: "d2", page: 0) { $0["outcome"] = "clean"; $0["text"] = "卷2页3" }
        let r = EvidenceCoreA1CitationGate.evaluate(fixture: fx, oracle: try oracle(rows))
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .citation_mismatch)
        XCTAssertNotEqual(r.status, .pass)
    }

    // MARK: - A1T6-AUD-L1 hardening: oracle completeness + row validity (deferred Low closed)

    func testIncompleteOracleIsInvalidNotPass() throws {
        // Drop a derived page (d3/1) from the oracle: a partial oracle must be fixture_or_oracle_invalid,
        // NOT a false-green pass on the subset it covers.
        let fx = try decodeFixture()
        let rows = try completeExpected().filter { !(($0["documentId"] as? String) == "d3" && ($0["physicalPageIndex"] as? Int) == 1) }
        let r = EvidenceCoreA1CitationGate.evaluate(fixture: fx, oracle: try oracle(rows))
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .fixture_or_oracle_invalid)
    }

    func testOverCoveringOracleIsInvalidNotPass() throws {
        // Add an expectation for a page that does not exist in the derived map: must be invalid.
        let fx = try decodeFixture()
        var rows = try completeExpected()
        rows.append(["documentId": "d9", "physicalPageIndex": 9, "outcome": "non_citable"])
        let r = EvidenceCoreA1CitationGate.evaluate(fixture: fx, oracle: try oracle(rows))
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .fixture_or_oracle_invalid)
    }

    func testDuplicateOracleKeyIsInvalidNotPass() throws {
        // A duplicate page key in the oracle must be invalid (cardinality, not just set membership).
        let fx = try decodeFixture()
        var rows = try completeExpected()
        rows.append(["documentId": "d1", "physicalPageIndex": 0, "outcome": "clean", "text": "卷1页5"])
        let r = EvidenceCoreA1CitationGate.evaluate(fixture: fx, oracle: try oracle(rows))
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .fixture_or_oracle_invalid)
    }

    func testNonCleanRowWithStrayTextIsInvalidNotPass() throws {
        // An ambiguous (non-clean) expected row carrying a stray `text` is a malformed oracle.
        let fx = try decodeFixture()
        let rows = mutate(try completeExpected(), doc: "d2", page: 0) { $0["text"] = "卷2页3" } // stays outcome=ambiguous
        let r = EvidenceCoreA1CitationGate.evaluate(fixture: fx, oracle: try oracle(rows))
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .fixture_or_oracle_invalid)
    }

    func testCleanRowMissingTextIsInvalidNotPass() throws {
        // A clean expected row missing its required 卷X页Y `text` is a malformed oracle.
        let fx = try decodeFixture()
        let rows = mutate(try completeExpected(), doc: "d1", page: 0) { $0.removeValue(forKey: "text") }
        let r = EvidenceCoreA1CitationGate.evaluate(fixture: fx, oracle: try oracle(rows))
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .fixture_or_oracle_invalid)
    }

    func testUnknownOutcomeIsInvalidNotPass() throws {
        // An expected row naming an unknown outcome is a malformed oracle (not a checkable assertion).
        let fx = try decodeFixture()
        let rows = mutate(try completeExpected(), doc: "d3", page: 0) { $0["outcome"] = "weird" }
        let r = EvidenceCoreA1CitationGate.evaluate(fixture: fx, oracle: try oracle(rows))
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .fixture_or_oracle_invalid)
    }

    func testNonFileUrlsAreRefused() {
        let r = EvidenceCoreA1CitationGate.run(
            fixtureURL: URL(string: "https://example.com/citation-map.json")!,
            oracleURL: URL(string: "https://example.com/oracle.json")!)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .fixture_or_oracle_invalid)
        XCTAssertTrue(r.detail.contains("file URL"))
    }
}
