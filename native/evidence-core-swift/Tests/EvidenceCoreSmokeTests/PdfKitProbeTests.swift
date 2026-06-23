import XCTest
@testable import EvidenceCoreSmoke

// Tests for the WI-ENA2 PDFKit compile/import probe. These prove PDFKit is importable + linkable
// on macOS. They instantiate NO `PDFDocument`, load/parse NO PDF, and assert NO geometry — the
// capability is a compile-gated constant, not runtime PDF behavior.
final class PdfKitProbeTests: XCTestCase {
    func testPdfKitAvailableOnMacOS() {
        #if os(macOS)
        XCTAssertTrue(
            EvidenceCorePdfKitProbe.pdfKitAvailable,
            "PDFKit must be importable + linkable on macOS"
        )
        #else
        // PDFKit is a macOS framework; the compile-gated constant is false off macOS.
        XCTAssertFalse(EvidenceCorePdfKitProbe.pdfKitAvailable)
        #endif
    }

    func testProbeStringShape() {
        XCTAssertTrue(EvidenceCorePdfKitProbe.probe().contains("pdfkit-probe"))
    }
}
