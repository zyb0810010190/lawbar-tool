// PageBoxProbe.swift — Evidence Core Swift: page-box inspection PROBE (WI-ENA4).
//
// This proves PDFKit can read a page's box extent (the `mediaBox` width/height) from a loaded
// PDF. It is a page-box READ probe ONLY. It performs NO coordinate transforms, NO conversion
// between PDF/user/view spaces, NO normalized-coordinate math, NO anchor / citation / page-identity
// logic, NO drawing/rendering, and NO geometry pass/fail classification. Reading the box extent is
// not the same as computing geometry: the probe reports the raw width/height PDFKit exposes and
// makes no claim about coordinates, anchors, or A0.7.
//
// Real coordinate transforms, anchor math, geometry roundtrip, renderer-conformance, and the A0.7
// harness are separate, explicitly-authorized hard-stop WIs. Nothing here begins them.

import Foundation
#if canImport(PDFKit)
import PDFKit
#endif

public enum EvidenceCorePageBoxProbe {
    /// A page's box extent (width/height) in PDF points, as PDFKit reports it. No origin transform,
    /// no normalization — just the raw size of the box.
    public struct PageBox: Equatable {
        public let width: Double
        public let height: Double
        public init(width: Double, height: Double) {
            self.width = width
            self.height = height
        }
    }

    /// Deterministic inspection result: whether the document loaded, and each page's `mediaBox` extent.
    public struct InspectResult: Equatable {
        public let loaded: Bool
        public let mediaBoxes: [PageBox]
        public init(loaded: Bool, mediaBoxes: [PageBox]) {
            self.loaded = loaded
            self.mediaBoxes = mediaBoxes
        }
    }

    /// Load a PDF and read each page's `mediaBox` extent (width/height) in PDF points. This reads the
    /// box only; it applies no coordinate transform, derives no normalized/anchor coordinates, and
    /// makes no page-identity/citation claim. Returns `loaded == false` when PDFKit is unavailable or
    /// the file fails to parse.
    public static func inspectMediaBoxes(url: URL) -> InspectResult {
        #if canImport(PDFKit)
        guard let document = PDFDocument(url: url) else {
            return InspectResult(loaded: false, mediaBoxes: [])
        }
        var boxes: [PageBox] = []
        for index in 0..<document.pageCount {
            guard let page = document.page(at: index) else { continue }
            let rect = page.bounds(for: .mediaBox)
            boxes.append(PageBox(width: Double(rect.width), height: Double(rect.height)))
        }
        return InspectResult(loaded: true, mediaBoxes: boxes)
        #else
        return InspectResult(loaded: false, mediaBoxes: [])
        #endif
    }
}
