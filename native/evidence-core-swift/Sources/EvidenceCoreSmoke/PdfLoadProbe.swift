// PdfLoadProbe.swift — Evidence Core Swift: PDF load/page-count PROBE (WI-ENA3).
//
// This proves PDFKit can LOAD + PARSE a PDF far enough to report a deterministic structural
// result: whether the document loaded and how many pages it has. It is a load/page-count probe
// ONLY. It extracts NO geometry, NO coordinates, NO page boxes (media/crop/bleed), performs NO
// drawing/rendering, makes NO page-identity / citation claim, and is NOT the A0.7
// renderer-conformance harness. Page COUNT is a structural property, not geometry.
//
// Real PDF geometry, page identity/citation, anchors, and the A0.7 harness are separate,
// explicitly-authorized hard-stop WIs. Nothing here begins them.

import Foundation
#if canImport(PDFKit)
import PDFKit
#endif

public enum EvidenceCorePdfLoadProbe {
    /// Deterministic load result. `loaded` = the document parsed; `pageCount` = number of pages.
    /// No geometry, no coordinates, no page boxes — only the page count.
    public struct LoadResult: Equatable {
        public let loaded: Bool
        public let pageCount: Int
        public init(loaded: Bool, pageCount: Int) {
            self.loaded = loaded
            self.pageCount = pageCount
        }
    }

    /// Load a PDF from a file URL and report whether it parsed plus its page count. This reads/parses
    /// the document ONLY to count pages; it touches no page geometry, extracts no coordinates, and
    /// renders nothing. Returns `loaded == false` when PDFKit is unavailable or the file fails to parse.
    public static func load(url: URL) -> LoadResult {
        #if canImport(PDFKit)
        guard let document = PDFDocument(url: url) else {
            return LoadResult(loaded: false, pageCount: 0)
        }
        return LoadResult(loaded: true, pageCount: document.pageCount)
        #else
        return LoadResult(loaded: false, pageCount: 0)
        #endif
    }
}
