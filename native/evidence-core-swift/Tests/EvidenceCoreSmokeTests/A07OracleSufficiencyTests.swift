import XCTest
import Foundation
@testable import EvidenceCoreSmoke

// D2 — an oracle that verifies no normalization cannot certify A0.7.
//
// WHY THIS FILE IS SYNTHETIC RATHER THAN FIXTURE-DRIVEN. `hasCheckableAssertions` is
//
//     !expected.perPageMediaBox.isEmpty || !expected.samplePoints.isEmpty
//
// so an oracle carrying only boxes was "checkable": the box assertions ran, every one of them
// passed, and the result was pass/ok — having verified no normalization at all. Normalization is
// the arithmetic that turns a PDF point into the coordinate an anchor is actually stored from, so
// that verdict certified the wrong half of the gate's own claim.
//
// Until D3 was closed, three real fixtures carried zero sample points and so exercised this defect
// incidentally — messy/synthetic-cropbox, synthetic-mixed-sizes and synthetic-rotated. D3 populated
// all three with independently derived points, which is the right outcome for those fixtures but
// removes the only coverage the invariant had. **This file exists so that closing D3 did not make
// the D2 defect untestable.** It asserts the rule directly, on synthetic oracles, where no future
// fixture change can quietly retire it.
//
// VERDICT CHOICE. `fail` / `fixture_or_oracle_invalid`, deliberately not
// `inconclusive_no_checkable_assertions`: the oracle DOES have checkable assertions, and a detail
// string claiming otherwise would be false. It is invalid *for the A0.7 claim* — it lacks what is
// required to certify normalization. A new enum case was considered and rejected; this is a
// court-facing classification that downstream code switches on, and a fourth outcome is not needed
// to describe an unusable oracle.
final class A07OracleSufficiencyTests: XCTestCase {

    private func oracle(_ json: String) throws -> A07Oracle {
        try JSONDecoder().decode(A07Oracle.self, from: Data(json.utf8))
    }

    /// Boxes present, sample points absent — geometry that matches the oracle perfectly.
    private func boxOnlyOracleJSON(boxes: Int) -> String {
        let boxJSON = (0..<boxes)
            .map { "{\"pageIndex\": \($0), \"x\": 0, \"y\": 0, \"width\": 612, \"height\": 792}" }
            .joined(separator: ",")
        return """
        {"expected": {"pageCount": \(boxes), "perPageMediaBox": [\(boxJSON)], "samplePoints": []},
         "tolerance": {"absolutePdfPoints": 1e-9}}
        """
    }

    private func matchingObservation(boxes: Int) -> A07Observed {
        A07Observed(
            pageCount: boxes,
            perPageMediaBox: (0..<boxes).map {
                .init(pageIndex: $0, originX: 0, originY: 0, width: 612, height: 792, rotation: 0,
                      cropBox: .init(x: 0, y: 0, width: 612, height: 792))
            },
            sampleNormalized: []
        )
    }

    // MARK: - The invariant

    /// THE CANARY. Every box assertion is satisfied; the verdict must still not be pass.
    func testBoxOnlyOracleWithPerfectlyMatchingGeometryDoesNotPass() throws {
        let o = try oracle(boxOnlyOracleJSON(boxes: 1))
        let r = EvidenceCoreA07Harness.evaluate(observed: matchingObservation(boxes: 1), oracle: o)
        XCTAssertNotEqual(r.status, .pass,
                          "a box-only oracle verified no normalization; it must not certify A0.7")
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .fixture_or_oracle_invalid)
    }

    /// More boxes is not more certification. A multi-page box-only oracle fails for the same reason.
    func testMultiPageBoxOnlyOracleDoesNotPass() throws {
        let o = try oracle(boxOnlyOracleJSON(boxes: 3))
        let r = EvidenceCoreA07Harness.evaluate(observed: matchingObservation(boxes: 3), oracle: o)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .fixture_or_oracle_invalid)
    }

    /// The distinction the verdict turns on: this oracle is not "nothing to check", it is "checkable
    /// but insufficient". Reporting it as inconclusive_no_checkable_assertions would state something
    /// false about an oracle that carries box assertions.
    func testBoxOnlyIsReportedAsInvalidRatherThanNoCheckableAssertions() throws {
        let o = try oracle(boxOnlyOracleJSON(boxes: 1))
        XCTAssertTrue(o.hasCheckableAssertions, "precondition: box assertions exist")
        let r = EvidenceCoreA07Harness.evaluate(observed: matchingObservation(boxes: 1), oracle: o)
        XCTAssertNotEqual(r.classification, .inconclusive_no_checkable_assertions,
                          "the oracle has checkable assertions; saying it has none would be false")
        XCTAssertTrue(r.detail.contains("no sample points"),
                      "detail must name the missing assertions; got: \(r.detail)")
        XCTAssertTrue(r.detail.contains("normalization is unverified"),
                      "detail must say what went uncertified; got: \(r.detail)")
    }

    /// A wholly empty oracle is a different condition and keeps its own verdict — the D2 rule must
    /// not swallow it, or the two causes become indistinguishable to a reader.
    func testWhollyEmptyOracleStaysInconclusiveNotInvalid() throws {
        let o = try oracle("""
        {"expected": {"pageCount": 0, "perPageMediaBox": [], "samplePoints": []},
         "tolerance": {"absolutePdfPoints": 1e-9}}
        """)
        let r = EvidenceCoreA07Harness.evaluate(observed: A07Observed(pageCount: 0, perPageMediaBox: [], sampleNormalized: []), oracle: o)
        XCTAssertEqual(r.status, .inconclusive)
        XCTAssertEqual(r.classification, .inconclusive_no_checkable_assertions)
    }

    /// The negative case: one sample point is enough to make the oracle sufficient, so the rule
    /// gates on presence and does not become a new blanket failure.
    func testOneSamplePointIsEnoughForTheOracleToBeSufficient() throws {
        let o = try oracle("""
        {"expected": {"pageCount": 1,
                      "perPageMediaBox": [{"pageIndex": 0, "x": 0, "y": 0, "width": 612, "height": 792}],
                      "samplePoints": [{"pdf": {"x": 153, "y": 198}, "normalized": {"nx": 0.25, "ny": 0.25}}]},
         "tolerance": {"absolutePdfPoints": 1e-9}}
        """)
        let observed = A07Observed(
            pageCount: 1,
            perPageMediaBox: [.init(pageIndex: 0, originX: 0, originY: 0, width: 612, height: 792,
                                    rotation: 0, cropBox: .init(x: 0, y: 0, width: 612, height: 792))],
            sampleNormalized: [.init(nx: 0.25, ny: 0.25)]
        )
        let r = EvidenceCoreA07Harness.evaluate(observed: observed, oracle: o)
        XCTAssertEqual(r.status, .pass, "one sample point certifies normalization; the rule must not over-reach")
        XCTAssertEqual(r.classification, .ok)
    }

    // MARK: - D3 regression: the shipped oracles must stay sufficient

    /// D3 populated three oracles that previously carried none. If a future edit empties any of
    /// them, D2's rule turns that fixture red — but only if something checks the oracles themselves.
    /// This asserts the corpus property directly, so an emptied oracle is reported as what it is
    /// rather than as a mysterious fixture failure.
    func testEveryShippedA07OracleCarriesAtLeastOneSamplePoint() throws {
        let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("Fixtures")
        let paths = [
            "a07-renderer-conformance/oracle.json",
            "messy/synthetic-rotated.oracle.json",
            "messy/synthetic-cropbox.oracle.json",
            "messy/synthetic-nonzero-origin.oracle.json",
            "messy/synthetic-mixed-sizes.oracle.json",
        ]
        for rel in paths {
            let url = fixtures.appendingPathComponent(rel)
            let o = try JSONDecoder().decode(A07Oracle.self, from: Data(contentsOf: url))
            XCTAssertFalse(o.expected.samplePoints.isEmpty,
                           "\(rel) carries no sample points, so it cannot certify normalization (D2/D3)")
        }
    }
}
