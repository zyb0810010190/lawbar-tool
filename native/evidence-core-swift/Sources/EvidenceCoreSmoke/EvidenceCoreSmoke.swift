// EvidenceCoreSmoke.swift — Evidence Core Swift SKELETON (smoke only).
//
// This is NOT the real Native Evidence Core and NOT the A0.7 renderer-conformance harness.
// This smoke enum itself imports NO PDFKit, computes NO geometry, creates NO A0.7 marker, and has
// NO product behavior. Its only job is to prove the SwiftPM toolchain (and macOS CI) can build +
// test this package. (The package's PDFKit compile/import probe lives separately in
// PdfKitProbe.swift — a compile-gated import only, with no PDF load/parse and no geometry.)
// The real native core (Swift + PDFKit + A0.7) is a separate, explicitly-authorized hard-stop WI.

public enum EvidenceCoreSmoke {
    /// A smoke version string. NOT an A0.7-green marker and NOT a product version.
    public static let smokeVersion = "0.0.0-smoke"

    /// Returns a smoke value proving the package builds and runs. No behavior, no geometry, no marker.
    public static func smoke() -> String {
        "evidence-core-swift skeleton ok (\(smokeVersion))"
    }
}
