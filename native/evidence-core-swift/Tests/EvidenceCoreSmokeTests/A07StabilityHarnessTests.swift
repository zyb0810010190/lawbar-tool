import XCTest
import Foundation
@testable import EvidenceCoreSmoke

// Tests for the ORACLE-FREE A0.7 stability mode (WI-A07-STABILITY).
//
// Stability mode asks the gate's real question — is the geometry SOURCE reproducible? — by re-reading the
// same unchanged file N times and comparing every capture byte-exactly against the first. These tests
// cover: all five committed synthetic fixtures are stable at N=3; the pre-existing two-argument oracle
// mode still works (regression over the shared capture path); a corrupt / missing / empty / zero-page
// document is never a pass; fewer than two reads is inconclusive, not pass; two runs are byte-identical;
// the mode writes NO file anywhere; and a divergence between reads classifies as class_2 (via the pure
// evaluateStability classifier, mirroring how the oracle mode's evaluate() is tested).
final class A07StabilityHarnessTests: XCTestCase {
    private var fixturesDir: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures")
    }
    private var messyDir: URL { fixturesDir.appendingPathComponent("messy") }
    private var oracleURL: URL { fixturesDir.appendingPathComponent("a07-renderer-conformance/oracle.json") }

    /// The five committed synthetic fixtures, paired with their oracles (oracle used only by the
    /// regression test; stability mode needs none).
    private var allFixtures: [(name: String, pdf: URL, oracle: URL, pages: Int)] {
        [
            ("twopage", fixturesDir.appendingPathComponent("synthetic-twopage.pdf"), oracleURL, 2),
            ("cropbox", messyDir.appendingPathComponent("synthetic-cropbox.pdf"),
             messyDir.appendingPathComponent("synthetic-cropbox.oracle.json"), 1),
            ("mixed-sizes", messyDir.appendingPathComponent("synthetic-mixed-sizes.pdf"),
             messyDir.appendingPathComponent("synthetic-mixed-sizes.oracle.json"), 2),
            ("nonzero-origin", messyDir.appendingPathComponent("synthetic-nonzero-origin.pdf"),
             messyDir.appendingPathComponent("synthetic-nonzero-origin.oracle.json"), 1),
            ("rotated", messyDir.appendingPathComponent("synthetic-rotated.pdf"),
             messyDir.appendingPathComponent("synthetic-rotated.oracle.json"), 1),
        ]
    }

    private func obsBox(_ idx: Int, _ x: Double, _ y: Double, _ w: Double, _ h: Double,
                        rot: Int = 0, crop: (Double, Double, Double, Double)? = nil) -> A07Observed.Box {
        let c = crop ?? (x, y, w, h)
        return .init(pageIndex: idx, originX: x, originY: y, width: w, height: h, rotation: rot,
                     cropBox: .init(x: c.0, y: c.1, width: c.2, height: c.3))
    }

    private func capture(_ boxes: [A07Observed.Box]) -> A07Observed {
        A07Observed(pageCount: boxes.count, perPageMediaBox: boxes, sampleNormalized: [])
    }

    private func tempURL(_ suffix: String) -> URL {
        URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("a07stability-\(UUID().uuidString)\(suffix)")
    }

    /// Minimal, deterministic ZERO-page PDF (a /Pages node with /Count 0 and no /Kids), written to a temp
    /// file. All-ASCII, so byte offsets equal UTF-8 counts and the xref table is exact.
    private func writeZeroPagePDF(to url: URL) throws {
        let objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [] /Count 0 >>"]
        var pdf = "%PDF-1.4\n"
        var offsets: [Int] = []
        for (index, body) in objects.enumerated() {
            offsets.append(pdf.utf8.count)
            pdf += "\(index + 1) 0 obj\n\(body)\nendobj\n"
        }
        let startxref = pdf.utf8.count
        pdf += "xref\n0 \(objects.count + 1)\n0000000000 65535 f \n"
        for offset in offsets { pdf += String(format: "%010d 00000 n \n", offset) }
        pdf += "trailer\n<< /Size \(objects.count + 1) /Root 1 0 R >>\nstartxref\n\(startxref)\n%%EOF\n"
        try Data(pdf.utf8).write(to: url)
    }

    /// Recursive snapshot of a directory: path + size + mtime for every entry, sorted. Used to prove the
    /// stability mode leaves no artifact and mutates nothing.
    private func snapshot(_ dir: URL) throws -> [String] {
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
        guard let walker = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: keys) else {
            return []
        }
        var rows: [String] = []
        for case let url as URL in walker {
            let values = try url.resourceValues(forKeys: Set(keys))
            let mtime = values.contentModificationDate?.timeIntervalSince1970 ?? -1
            rows.append("\(url.path)|\(values.fileSize ?? -1)|\(mtime)")
        }
        return rows.sorted()
    }

    // MARK: - All five synthetic fixtures are stable (N = 3)

    func testAllFiveSyntheticFixturesAreStable() {
        for fixture in allFixtures {
            let result = EvidenceCoreA07Harness.runStability(fixtureURL: fixture.pdf, iterations: 3)
            #if canImport(PDFKit)
            XCTAssertEqual(result.status, .pass, "\(fixture.name): geometry must be reproducible across reads")
            XCTAssertEqual(result.classification, .ok, "\(fixture.name)")
            XCTAssertEqual(result.observedPageCount, fixture.pages, "\(fixture.name)")
            #else
            XCTAssertEqual(result.status, .fail, "\(fixture.name)")
            XCTAssertEqual(result.classification, .not_implemented, "\(fixture.name)")
            #endif
        }
    }

    func testStabilityDefaultIterationsIsThreeAndMatchesExplicitThree() {
        XCTAssertEqual(EvidenceCoreA07Harness.stabilityDefaultIterations, 3)
        let fixture = allFixtures[0].pdf
        let byDefault = EvidenceCoreA07Harness.runStability(fixtureURL: fixture)
        let explicit = EvidenceCoreA07Harness.runStability(fixtureURL: fixture, iterations: 3)
        XCTAssertEqual(byDefault, explicit)
    }

    func testStabilityResultSchemaShapeMatchesOracleMode() {
        let result = EvidenceCoreA07Harness.runStability(fixtureURL: allFixtures[0].pdf, iterations: 3)
        XCTAssertEqual(result.orderedFields().map { $0.0 },
                       ["status", "classification", "observedPageCount", "isMarker", "detail"])
        XCTAssertEqual(result.orderedFields().first { $0.0 == "isMarker" }?.1, "false")
    }

    // MARK: - Regression: the pre-existing two-argument oracle mode is unchanged

    func testOracleModeStillPassesForAllFiveFixtures() {
        for fixture in allFixtures {
            let result = EvidenceCoreA07Harness.run(fixtureURL: fixture.pdf, oracleURL: fixture.oracle)
            #if canImport(PDFKit)
            XCTAssertEqual(result.status, .pass, "\(fixture.name): oracle mode must still pass")
            XCTAssertEqual(result.classification, .ok, "\(fixture.name)")
            XCTAssertEqual(result.observedPageCount, fixture.pages, "\(fixture.name)")
            #else
            XCTAssertEqual(result.classification, .not_implemented, "\(fixture.name)")
            #endif
        }
    }

    func testOracleModeStillReportsFixtureInvalidForNonPdf() {
        // The shared capture path must not have changed oracle mode's invalid-input behavior.
        let result = EvidenceCoreA07Harness.run(fixtureURL: oracleURL, oracleURL: oracleURL)
        #if canImport(PDFKit)
        XCTAssertEqual(result.status, .fail)
        XCTAssertEqual(result.classification, .fixture_or_oracle_invalid)
        #else
        XCTAssertEqual(result.classification, .not_implemented)
        #endif
    }

    // MARK: - Never a pass: corrupt / missing / empty / zero-page documents

    func testCorruptFileIsNotPass() {
        // oracle.json is valid JSON but is not a PDF.
        let result = EvidenceCoreA07Harness.runStability(fixtureURL: oracleURL, iterations: 3)
        XCTAssertNotEqual(result.status, .pass, "an unreadable document must never be a pass")
        #if canImport(PDFKit)
        XCTAssertEqual(result.status, .fail)
        XCTAssertEqual(result.classification, .fixture_or_oracle_invalid)
        #else
        XCTAssertEqual(result.classification, .not_implemented)
        #endif
    }

    func testMissingFileIsNotPass() {
        let missing = fixturesDir.appendingPathComponent("does-not-exist-\(UUID().uuidString).pdf")
        let result = EvidenceCoreA07Harness.runStability(fixtureURL: missing, iterations: 3)
        XCTAssertNotEqual(result.status, .pass)
        #if canImport(PDFKit)
        XCTAssertEqual(result.classification, .fixture_or_oracle_invalid)
        #endif
    }

    func testEmptyFileIsNotPass() throws {
        let empty = tempURL(".pdf")
        try Data().write(to: empty)
        defer { try? FileManager.default.removeItem(at: empty) }
        let result = EvidenceCoreA07Harness.runStability(fixtureURL: empty, iterations: 3)
        XCTAssertNotEqual(result.status, .pass, "a 0-byte file must never be a pass")
        #if canImport(PDFKit)
        XCTAssertEqual(result.classification, .fixture_or_oracle_invalid)
        #endif
    }

    func testZeroPageDocumentIsNotPass() throws {
        let zeroPage = tempURL(".pdf")
        try writeZeroPagePDF(to: zeroPage)
        defer { try? FileManager.default.removeItem(at: zeroPage) }
        let result = EvidenceCoreA07Harness.runStability(fixtureURL: zeroPage, iterations: 3)
        // PDFKit may refuse to load a 0-page document, or load it and report pageCount 0. Either way the
        // verdict is invalid-and-fail; it is NEVER a pass.
        XCTAssertNotEqual(result.status, .pass, "a zero-page document must never be a pass")
        #if canImport(PDFKit)
        XCTAssertEqual(result.status, .fail)
        XCTAssertEqual(result.classification, .fixture_or_oracle_invalid)
        XCTAssertEqual(result.observedPageCount, 0)
        #else
        XCTAssertEqual(result.classification, .not_implemented)
        #endif
    }

    func testZeroPageCaptureIsNotPassInPureClassifier() {
        // Belt-and-braces: whatever PDFKit does with the file above, a zero-page CAPTURE is invalid.
        let empty = A07Observed(pageCount: 0, perPageMediaBox: [], sampleNormalized: [])
        let result = EvidenceCoreA07Harness.evaluateStability(captures: [empty, empty])
        XCTAssertEqual(result.status, .fail)
        XCTAssertEqual(result.classification, .fixture_or_oracle_invalid)
        XCTAssertNotEqual(result.status, .pass)
    }

    func testPartialGeometryCaptureIsNotPass() {
        // Document claims 2 pages but only 1 page yielded geometry: invalid, never pass.
        let partial = A07Observed(pageCount: 2, perPageMediaBox: [obsBox(0, 0, 0, 612, 792)],
                                  sampleNormalized: [])
        let result = EvidenceCoreA07Harness.evaluateStability(captures: [partial, partial])
        XCTAssertEqual(result.status, .fail)
        XCTAssertEqual(result.classification, .fixture_or_oracle_invalid)
    }

    func testFewerThanTwoReadsIsInconclusiveNotPass() {
        for iterations in [1, 0, -1] {
            let result = EvidenceCoreA07Harness.runStability(fixtureURL: allFixtures[0].pdf,
                                                            iterations: iterations)
            XCTAssertEqual(result.status, .inconclusive, "iterations=\(iterations)")
            XCTAssertEqual(result.classification, .inconclusive_no_checkable_assertions,
                           "iterations=\(iterations)")
            XCTAssertNotEqual(result.status, .pass, "inconclusive must never be pass")
        }
        let single = EvidenceCoreA07Harness.evaluateStability(captures: [capture([obsBox(0, 0, 0, 612, 792)])])
        XCTAssertEqual(single.status, .inconclusive)
        XCTAssertEqual(single.classification, .inconclusive_no_checkable_assertions)
    }

    func testNonFileUrlIsRefused() {
        let http = URL(string: "https://example.com/confidential.pdf")!
        let result = EvidenceCoreA07Harness.runStability(fixtureURL: http, iterations: 3)
        XCTAssertEqual(result.status, .fail)
        XCTAssertEqual(result.classification, .fixture_or_oracle_invalid)
        XCTAssertTrue(result.detail.contains("file URL"), "must refuse non-file URLs as an offline harness")
    }

    // MARK: - Divergence between reads of the same file => class_2 (the definitional STOP signal)

    func testIdenticalCapturesPass() {
        let reference = capture([obsBox(0, 0, 0, 612, 792), obsBox(1, 50, 50, 595, 842, rot: 90)])
        let result = EvidenceCoreA07Harness.evaluateStability(captures: [reference, reference, reference])
        XCTAssertEqual(result.status, .pass)
        XCTAssertEqual(result.classification, .ok)
        XCTAssertEqual(result.observedPageCount, 2)
    }

    func testClass2OnBoxExtentDivergenceBetweenReads() {
        let first = capture([obsBox(0, 0, 0, 612, 792)])
        let drifted = capture([obsBox(0, 0, 0, 612, 791.5)])
        let result = EvidenceCoreA07Harness.evaluateStability(captures: [first, drifted])
        XCTAssertEqual(result.status, .fail)
        XCTAssertEqual(result.classification, .class_2_geometry_source_instability,
                       "two reads of the same unchanged file disagreeing IS geometry-source instability")
        XCTAssertTrue(result.detail.contains("read 2"), "detail must name the diverging read")
    }

    func testClass2OnOriginRotationAndCropBoxDivergence() {
        let first = capture([obsBox(0, 0, 0, 612, 792, rot: 0, crop: (0, 0, 612, 792))])
        let variants = [
            capture([obsBox(0, 1, 0, 612, 792, rot: 0, crop: (0, 0, 612, 792))]),   // origin drift
            capture([obsBox(0, 0, 0, 612, 792, rot: 90, crop: (0, 0, 612, 792))]),  // rotation drift
            capture([obsBox(0, 0, 0, 612, 792, rot: 0, crop: (5, 5, 602, 782))]),   // cropBox drift
        ]
        for variant in variants {
            let result = EvidenceCoreA07Harness.evaluateStability(captures: [first, variant])
            XCTAssertEqual(result.status, .fail)
            XCTAssertEqual(result.classification, .class_2_geometry_source_instability)
        }
    }

    func testClass2OnPageCountDivergenceBetweenReads() {
        let first = capture([obsBox(0, 0, 0, 612, 792), obsBox(1, 0, 0, 612, 792)])
        let shrunk = capture([obsBox(0, 0, 0, 612, 792)])
        let result = EvidenceCoreA07Harness.evaluateStability(captures: [first, shrunk])
        XCTAssertEqual(result.status, .fail)
        XCTAssertEqual(result.classification, .class_2_geometry_source_instability)
        XCTAssertTrue(result.detail.contains("page count"), "detail: \(result.detail)")
    }

    func testDivergenceIsDetectedInAnyLaterRead() {
        let first = capture([obsBox(0, 0, 0, 612, 792)])
        let drifted = capture([obsBox(0, 0, 0, 612, 700)])
        let result = EvidenceCoreA07Harness.evaluateStability(captures: [first, first, first, drifted])
        XCTAssertEqual(result.classification, .class_2_geometry_source_instability)
        XCTAssertTrue(result.detail.contains("read 4"), "detail must name read 4: \(result.detail)")
    }

    func testByteExactComparisonDistinguishesSignedZeroAndNaN() {
        // `==` on Doubles would call -0.0 == 0.0 a match and NaN == NaN a divergence it cannot describe.
        // The canonical rendering compares IEEE-754 bit patterns instead.
        let zero = capture([obsBox(0, 0.0, 0, 612, 792)])
        let negativeZero = capture([obsBox(0, -0.0, 0, 612, 792)])
        XCTAssertNotEqual(EvidenceCoreA07Harness.canonicalGeometry(zero),
                          EvidenceCoreA07Harness.canonicalGeometry(negativeZero))
        let nan = capture([obsBox(0, Double.nan, 0, 612, 792)])
        XCTAssertEqual(EvidenceCoreA07Harness.canonicalGeometry(nan),
                       EvidenceCoreA07Harness.canonicalGeometry(nan))
        XCTAssertEqual(EvidenceCoreA07Harness.evaluateStability(captures: [nan, nan]).status, .pass)
    }

    // MARK: - Determinism

    func testTwoStabilityRunsProduceIdenticalOutput() {
        for fixture in allFixtures {
            let first = EvidenceCoreA07Harness.runStability(fixtureURL: fixture.pdf, iterations: 3)
            let second = EvidenceCoreA07Harness.runStability(fixtureURL: fixture.pdf, iterations: 3)
            XCTAssertEqual(first, second, "\(fixture.name): stability output must be deterministic")
            XCTAssertEqual(first.orderedFields().map { "\($0.0)=\($0.1)" },
                           second.orderedFields().map { "\($0.0)=\($0.1)" }, "\(fixture.name)")
        }
    }

    func testDivergenceDetailIsDeterministic() {
        let first = capture([obsBox(0, 0, 0, 612, 792), obsBox(1, 0, 0, 612, 792)])
        let drifted = capture([obsBox(0, 0, 0, 612, 792), obsBox(1, 0, 0, 600, 792)])
        let a = EvidenceCoreA07Harness.evaluateStability(captures: [first, drifted])
        let b = EvidenceCoreA07Harness.evaluateStability(captures: [first, drifted])
        XCTAssertEqual(a, b)
        XCTAssertTrue(a.detail.contains("page 1"), "first differing page is reported: \(a.detail)")
    }

    // MARK: - Confidentiality: writes nothing, and leaks no file name

    func testStabilityWritesNoFileAndMutatesNothing() throws {
        // The system temp dir is deliberately NOT asserted here: unrelated processes write to it during a
        // test run, which would make the assertion flaky rather than meaningful. The fixture tree and the
        // working directory are the two places an artifact could plausibly land.
        // The working directory is listed SHALLOWLY (it can contain a build tree the test run itself
        // writes into); the fixture tree is snapshotted recursively with sizes and mtimes.
        let cwd = FileManager.default.currentDirectoryPath
        let beforeFixtures = try snapshot(fixturesDir)
        let beforeCwd = try FileManager.default.contentsOfDirectory(atPath: cwd).sorted()

        for fixture in allFixtures {
            _ = EvidenceCoreA07Harness.runStability(fixtureURL: fixture.pdf, iterations: 3)
        }

        XCTAssertEqual(try snapshot(fixturesDir), beforeFixtures,
                       "stability mode must not create, modify, or touch anything in the fixture tree")
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: cwd).sorted(), beforeCwd,
                       "stability mode must not write into the working directory")
    }

    func testStabilityDetailNeverLeaksTheFileName() {
        // The mode is pointed at confidential client PDFs, whose FILE NAME can itself be privileged.
        // No detail string may echo it — pass or fail.
        let passing = EvidenceCoreA07Harness.runStability(fixtureURL: allFixtures[0].pdf, iterations: 3)
        XCTAssertFalse(passing.detail.contains("synthetic-twopage"), "detail: \(passing.detail)")
        XCTAssertFalse(passing.detail.contains(".pdf"), "detail: \(passing.detail)")

        let failing = EvidenceCoreA07Harness.runStability(fixtureURL: oracleURL, iterations: 3)
        XCTAssertFalse(failing.detail.contains("oracle.json"), "detail: \(failing.detail)")
        XCTAssertFalse(failing.detail.contains(fixturesDir.path), "detail: \(failing.detail)")
    }
}
