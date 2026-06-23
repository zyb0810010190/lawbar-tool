// PdfKitProbe.swift — Evidence Core Swift: PDFKit compile/import PROBE (WI-ENA2).
//
// This proves PDFKit can be IMPORTED and LINKED on macOS. It is NOT geometry, NOT the A0.7
// renderer-conformance harness, NOT an A0.7 marker, and NOT product behavior. It loads and
// parses NO PDF: no `PDFDocument` is ever instantiated and no file is read. The capability
// value is a COMPILE-GATED constant via `#if canImport(PDFKit)`, not runtime PDF behavior.
//
// Real PDF geometry and the A0.7 harness are separate, explicitly-authorized hard-stop WIs.
// Nothing here begins them.

#if canImport(PDFKit)
import PDFKit
#endif

public enum EvidenceCorePdfKitProbe {
    /// Compile-gated capability constant: `true` when PDFKit is importable + linkable (macOS),
    /// `false` otherwise. Determined at COMPILE time via `#if canImport(PDFKit)`. The metatype
    /// reference forces the PDFKit symbol to resolve/link — it instantiates no `PDFDocument`,
    /// loads/parses no PDF, and computes no geometry. NOT an A0.7 capability and NOT a product
    /// readiness signal.
    public static let pdfKitAvailable: Bool = {
        #if canImport(PDFKit)
        // Metatype reference only: proves the PDFKit symbol links. No instance, no PDF, no geometry.
        _ = PDFDocument.self
        return true
        #else
        return false
        #endif
    }()

    /// A smoke probe string proving the PDFKit import compiles/links. No geometry, no marker, no behavior.
    public static func probe() -> String {
        "evidence-core-swift pdfkit-probe (pdfKitAvailable=\(pdfKitAvailable))"
    }
}
