import XCTest
import Foundation
@testable import EvidenceCoreSmoke

// Tests for the WI-ENA5 coordinate transform ROUNDTRIP probe. They reuse the existing synthetic
// fixture (Fixtures/synthetic-twopage.pdf), read page 1's mediaBox extent (612 x 792), and assert
// that normalize → denormalize recovers deterministic sample PDF-space points within a tiny
// tolerance. This is a probe only: NO rendering, NO rendered-pixel inspection, NO renderer-conformance,
// NO A0.7 claim, NO anchors, NO page identity/citation, NO persistence.
final class CoordinateRoundtripProbeTests: XCTestCase {
    private typealias Probe = EvidenceCoreCoordinateRoundtripProbe

    private var fixtureURL: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures/synthetic-twopage.pdf")
    }

    /// Deterministic sample points in PDF user-space for a 612 x 792 page: corners, center, edges,
    /// and a fractional interior point.
    private let samples: [Probe.PdfPoint] = [
        .init(x: 0, y: 0),
        .init(x: 612, y: 792),
        .init(x: 306, y: 396),
        .init(x: 100, y: 200),
        .init(x: 611.5, y: 0.25),
    ]

    /// Roundtrip tolerance: the transform is a pure divide-then-multiply, so error is at floating-point
    /// noise level. 1e-9 is comfortably above that and well below any meaningful PDF point.
    private let tolerance = 1e-9

    func testNormalizeDenormalizeRoundtripIsInvertible() {
        let result = Probe.roundtripOnFixture(url: fixtureURL, samples: samples)
        // Mirror the probe's own gate so the expectation never diverges from the implementation.
        #if canImport(PDFKit)
        XCTAssertTrue(result.loaded, "PDFKit must load the synthetic fixture where PDFKit is available")
        XCTAssertEqual(result.width, 612, accuracy: 0.5)
        XCTAssertEqual(result.height, 792, accuracy: 0.5)
        XCTAssertLessThan(result.maxAbsError, tolerance, "normalize→denormalize must be invertible within tolerance")
        #else
        XCTAssertFalse(result.loaded)
        #endif
    }

    func testNormalizationMapsIntoUnitRange() {
        // A pure arithmetic check (no fixture): interior PDF points normalize into [0, 1].
        let n = Probe.normalize(.init(x: 306, y: 396), width: 612, height: 792)
        XCTAssertEqual(n.nx, 0.5, accuracy: tolerance)
        XCTAssertEqual(n.ny, 0.5, accuracy: tolerance)
        let back = Probe.denormalize(n, width: 612, height: 792)
        XCTAssertEqual(back.x, 306, accuracy: tolerance)
        XCTAssertEqual(back.y, 396, accuracy: tolerance)
    }
}
