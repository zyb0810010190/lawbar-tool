import XCTest
import Foundation
@testable import EvidenceCoreSmoke

// D4 — why the sample page could not be resolved decides the classification.
//
// THE DEFECT. `run` gathered normalized sample values behind one bundled condition:
//
//     if !samplePoints.isEmpty, samplePage >= 0, samplePage < pageCount,
//        let page = document.page(at: samplePage) { ...populate... }
//
// Any failure left `sampleNormalized` empty, `evaluate` then saw a count mismatch against the
// oracle's sample points, and classified it `class_1_normalization_math_bug` — a fixable local
// arithmetic bug. Three quite different causes arrived at that one verdict.
//
// WHY THE CLASSIFICATION MATTERS MORE THAN THE FAILURE. class-1 says "the normalization math is
// wrong, go fix it". class-2 says "the geometry source itself is unsound — STOP, and downstream
// anchor, forms and UI work must halt". Misclassifying a class-2 as class-1 produces no visible
// failure at all; it produces continued construction on a foundation that was never sound. That is
// the most consequential judgement this gate makes.
//
// THE POLICY, now implemented rather than only described:
//
//   samplePageIndex out of range   -> fixture_or_oracle_invalid. The oracle names a page the
//                                     document does not have, so the oracle cannot adjudicate this
//                                     fixture. Nothing is learned about the renderer.
//   page(at:) nil, index in range  -> class_2_geometry_source_instability. PDFKit reported a page
//                                     count and then refused a page inside it: its own structural
//                                     report is self-contradictory, which is precisely a geometry
//                                     source you cannot trust.
//   count mismatch reaching evaluate -> stays class-1, now correctly narrowed to what it always
//                                     meant: the samples resolved, and the derived values are wrong.
//
// A note on coverage, stated rather than glossed: the `page(at:) == nil` branch is implemented and
// documented but has NO test below, because there is no way to make PDFKit report a page count and
// then refuse an in-range page without a seam this harness does not have. Writing a test that
// pretended to cover it would be worse than saying so here.
//
// The third historical cause — an empty samplePoints array — can no longer reach the count check at
// all: D2's oracle-sufficiency guard rejects such an oracle earlier, as fixture_or_oracle_invalid.
// That interaction is asserted below so a future change to either guard cannot silently revive it.
final class A07SampleResolutionTests: XCTestCase {

    private var fixturesDir: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures")
    }
    private var fixtureURL: URL { fixturesDir.appendingPathComponent("synthetic-twopage.pdf") }

    /// Writes a temporary oracle beside no fixture — the fixture is the real committed two-page PDF.
    private func temporaryOracle(_ json: String) throws -> URL {
        let dir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("a07-d4-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("oracle.json")
        try Data(json.utf8).write(to: url)
        return url
    }

    /// A valid two-page oracle with a substitutable samplePageIndex.
    private func oracleJSON(samplePageIndex: Int) -> String {
        """
        {"expected": {"pageCount": 2,
                      "perPageMediaBox": [{"pageIndex": 0, "x": 0, "y": 0, "width": 612, "height": 792},
                                          {"pageIndex": 1, "x": 0, "y": 0, "width": 612, "height": 792}],
                      "samplePageIndex": \(samplePageIndex),
                      "samplePoints": [{"pdf": {"x": 153, "y": 198}, "normalized": {"nx": 0.25, "ny": 0.25}}]},
         "tolerance": {"absolutePdfPoints": 1e-9}}
        """
    }

    // MARK: - The policy

    /// An oracle naming page 99 of a 2-page document tells us nothing about the renderer. It is an
    /// unusable oracle, NOT evidence of a normalization bug.
    func testSamplePageIndexBeyondDocumentIsOracleInvalidNotClass1() throws {
        let oracleURL = try temporaryOracle(oracleJSON(samplePageIndex: 99))
        let r = EvidenceCoreA07Harness.run(fixtureURL: fixtureURL, oracleURL: oracleURL)
        #if canImport(PDFKit)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .fixture_or_oracle_invalid,
                       "an out-of-range samplePageIndex is an unusable oracle, not a math bug")
        XCTAssertNotEqual(r.classification, .class_1_normalization_math_bug,
                          "class-1 says 'fix the arithmetic'; there is no arithmetic to fix here")
        XCTAssertTrue(r.detail.contains("samplePageIndex"), "detail must name the field; got: \(r.detail)")
        #else
        XCTAssertEqual(r.classification, .not_implemented)
        #endif
    }

    /// Negative indices take the same path — the oracle still names a page that cannot exist.
    func testNegativeSamplePageIndexIsOracleInvalid() throws {
        let oracleURL = try temporaryOracle(oracleJSON(samplePageIndex: -1))
        let r = EvidenceCoreA07Harness.run(fixtureURL: fixtureURL, oracleURL: oracleURL)
        #if canImport(PDFKit)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .fixture_or_oracle_invalid)
        #endif
    }

    /// The boundary: the last valid index must still resolve normally. A guard that also rejected
    /// legitimate indices would trade a misclassification for a broken gate.
    func testLastValidSamplePageIndexStillResolves() throws {
        let oracleURL = try temporaryOracle(oracleJSON(samplePageIndex: 1))
        let r = EvidenceCoreA07Harness.run(fixtureURL: fixtureURL, oracleURL: oracleURL)
        #if canImport(PDFKit)
        XCTAssertEqual(r.status, .pass, "page index 1 of a 2-page document is valid and must resolve")
        XCTAssertEqual(r.classification, .ok)
        #endif
    }

    func testDefaultSamplePageIndexStillResolves() throws {
        let oracleURL = try temporaryOracle(oracleJSON(samplePageIndex: 0))
        let r = EvidenceCoreA07Harness.run(fixtureURL: fixtureURL, oracleURL: oracleURL)
        #if canImport(PDFKit)
        XCTAssertEqual(r.status, .pass)
        XCTAssertEqual(r.classification, .ok)
        #endif
    }

    // MARK: - class-1 keeps the meaning it always had

    /// With the samples resolved, a genuinely wrong derived value is still class-1. Narrowing the
    /// other causes away must not empty the category out.
    func testWrongNormalizedValueWithResolvedSamplesIsStillClass1() throws {
        let oracleURL = try temporaryOracle("""
        {"expected": {"pageCount": 2,
                      "perPageMediaBox": [{"pageIndex": 0, "x": 0, "y": 0, "width": 612, "height": 792},
                                          {"pageIndex": 1, "x": 0, "y": 0, "width": 612, "height": 792}],
                      "samplePageIndex": 0,
                      "samplePoints": [{"pdf": {"x": 153, "y": 198}, "normalized": {"nx": 0.9, "ny": 0.9}}]},
         "tolerance": {"absolutePdfPoints": 1e-9}}
        """)
        let r = EvidenceCoreA07Harness.run(fixtureURL: fixtureURL, oracleURL: oracleURL)
        #if canImport(PDFKit)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .class_1_normalization_math_bug,
                       "boxes are right, the sample resolved, the derived value disagrees — that is class-1")
        #endif
    }

    // MARK: - The third historical cause is now unreachable, and must stay so

    /// An empty samplePoints array used to reach the count check too. D2 now rejects such an oracle
    /// first. Asserted here so a change to either guard cannot silently revive the collapse.
    func testEmptySamplePointsIsCaughtByD2BeforeReachingTheCountCheck() throws {
        let oracleURL = try temporaryOracle("""
        {"expected": {"pageCount": 2,
                      "perPageMediaBox": [{"pageIndex": 0, "x": 0, "y": 0, "width": 612, "height": 792},
                                          {"pageIndex": 1, "x": 0, "y": 0, "width": 612, "height": 792}],
                      "samplePoints": []},
         "tolerance": {"absolutePdfPoints": 1e-9}}
        """)
        let r = EvidenceCoreA07Harness.run(fixtureURL: fixtureURL, oracleURL: oracleURL)
        #if canImport(PDFKit)
        XCTAssertEqual(r.classification, .fixture_or_oracle_invalid)
        XCTAssertNotEqual(r.classification, .class_1_normalization_math_bug,
                          "D2 must catch this before the sample-count check misreads it as a math bug")
        #endif
    }
}
