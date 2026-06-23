import XCTest
import Foundation
@testable import EvidenceCoreSmoke

// Tests for the WI-ENA4 page-box inspection probe. They reuse the existing synthetic fixture
// (Fixtures/synthetic-twopage.pdf — two empty Letter-size pages) and assert each page's mediaBox
// extent (612 x 792 points). They perform NO coordinate transforms, NO normalized-coordinate math,
// NO anchor/citation/page-identity logic, and NO rendering.
final class PageBoxProbeTests: XCTestCase {
    private var fixtureURL: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures/synthetic-twopage.pdf")
    }

    func testMediaBoxExtentsForSyntheticFixture() {
        let result = EvidenceCorePageBoxProbe.inspectMediaBoxes(url: fixtureURL)
        // Mirror the probe's own gate so the expectation never diverges from the implementation.
        #if canImport(PDFKit)
        XCTAssertTrue(result.loaded, "PDFKit must load the synthetic fixture where PDFKit is available")
        XCTAssertEqual(result.mediaBoxes.count, 2, "synthetic fixture has exactly two pages")
        for box in result.mediaBoxes {
            // Letter-size MediaBox [0 0 612 792]: extent is 612 x 792 PDF points.
            XCTAssertEqual(box.width, 612, accuracy: 0.5)
            XCTAssertEqual(box.height, 792, accuracy: 0.5)
        }
        #else
        XCTAssertFalse(result.loaded)
        #endif
    }
}
