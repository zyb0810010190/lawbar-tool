import XCTest
import Foundation
@testable import EvidenceCoreSmoke

// Tests for the WI-ENA3 PDF load/page-count probe. They load a tiny SYNTHETIC fixture (two empty
// Letter-size pages, generated deterministically; no fonts/images/text, no confidential material —
// see Fixtures/synthetic-twopage.pdf) and assert only that it parses and reports the expected page
// count. They extract NO geometry, NO coordinates, NO page boxes, and make NO page-identity claim.
final class PdfLoadProbeTests: XCTestCase {
    /// The fixture lives next to this test source; resolve it relative to #filePath so no SwiftPM
    /// resource bundling is needed. (`swift test` and CI both run against the checked-out source.)
    private var fixtureURL: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures/synthetic-twopage.pdf")
    }

    func testFixtureExists() {
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: fixtureURL.path),
            "synthetic fixture must be present at \(fixtureURL.path)"
        )
    }

    func testLoadsSyntheticTwoPagePdf() {
        let result = EvidenceCorePdfLoadProbe.load(url: fixtureURL)
        // Mirror the probe's own gate (`#if canImport(PDFKit)`) so the expectation never diverges
        // from the implementation on any platform where PDFKit is importable.
        #if canImport(PDFKit)
        XCTAssertTrue(result.loaded, "PDFKit must load the synthetic fixture where PDFKit is available")
        XCTAssertEqual(result.pageCount, 2, "synthetic fixture has exactly two pages")
        #else
        // Where PDFKit is not importable the probe reports not-loaded.
        XCTAssertFalse(result.loaded)
        #endif
    }
}
