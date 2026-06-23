// CoordinateRoundtripProbe.swift — Evidence Core Swift: coordinate transform ROUNDTRIP probe (WI-ENA5).
//
// This proves only that a PDF-space point can be normalized against a page's box extent
// (width/height) into [0, 1] and inverted back, recovering the original within a tiny tolerance.
// It is a PROBE-ONLY transform — deliberately NOT a product API (kept `internal`, exercised only by
// the test target via `@testable import`).
//
// It is NOT production anchor geometry: no rotation, no origin/box-offset handling, no
// `geometryCapturedAt` versioning, no persistence, no page identity / citation. It performs NO
// PDF rendering/drawing, inspects NO rendered pixels, runs NO renderer-conformance, builds NO A0.7
// harness, and makes NO A0.7 green claim. It only demonstrates the arithmetic is invertible on the
// existing synthetic fixture's page box.
//
// Real anchor geometry, renderer-conformance, and the A0.7 harness are separate, explicitly-authorized
// hard-stop WIs. Nothing here begins them.

import Foundation
#if canImport(PDFKit)
import PDFKit
#endif

enum EvidenceCoreCoordinateRoundtripProbe {
    /// A point in PDF user-space points.
    struct PdfPoint: Equatable {
        let x: Double
        let y: Double
    }

    /// A point normalized to the page-box extent, each component in [0, 1].
    struct NormalizedPoint: Equatable {
        let nx: Double
        let ny: Double
    }

    /// Normalize a PDF-space point against a box extent (width/height) into [0, 1]. Probe-only:
    /// no rotation, no origin offset, no rendered pixels.
    static func normalize(_ point: PdfPoint, width: Double, height: Double) -> NormalizedPoint {
        NormalizedPoint(nx: point.x / width, ny: point.y / height)
    }

    /// Invert `normalize`: map a normalized point back to PDF-space against the same box extent.
    static func denormalize(_ point: NormalizedPoint, width: Double, height: Double) -> PdfPoint {
        PdfPoint(x: point.nx * width, y: point.ny * height)
    }

    /// Deterministic roundtrip result over a set of sample points: whether the fixture loaded, the
    /// page-1 box extent used, and the maximum absolute error between each original point and its
    /// normalize→denormalize roundtrip.
    struct RoundtripResult: Equatable {
        let loaded: Bool
        let width: Double
        let height: Double
        let maxAbsError: Double
    }

    /// Load the fixture, read page 1's `mediaBox` extent, and roundtrip each sample point
    /// (PDF-space → normalized [0,1] → PDF-space), reporting the max absolute error. Probe-only.
    static func roundtripOnFixture(url: URL, samples: [PdfPoint]) -> RoundtripResult {
        #if canImport(PDFKit)
        guard let document = PDFDocument(url: url), let page = document.page(at: 0) else {
            return RoundtripResult(loaded: false, width: 0, height: 0, maxAbsError: .infinity)
        }
        let box = page.bounds(for: .mediaBox)
        let width = Double(box.width)
        let height = Double(box.height)
        var maxError = 0.0
        for point in samples {
            let recovered = denormalize(normalize(point, width: width, height: height), width: width, height: height)
            maxError = max(maxError, max(abs(recovered.x - point.x), abs(recovered.y - point.y)))
        }
        return RoundtripResult(loaded: true, width: width, height: height, maxAbsError: maxError)
        #else
        return RoundtripResult(loaded: false, width: 0, height: 0, maxAbsError: .infinity)
        #endif
    }
}
