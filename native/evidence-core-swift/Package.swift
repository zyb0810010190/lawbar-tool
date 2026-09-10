// swift-tools-version:5.9
// Package.swift — Evidence Core Swift SKELETON (smoke only).
// This is NOT the A0.7 implementation: no PDFKit, no geometry, no marker, no product behavior.
// See README.md. It exists only to prove the SwiftPM toolchain + macOS CI build/test the package.

import PackageDescription

let package = Package(
    name: "EvidenceCoreSmoke",
    // R3 / WI-12: LawbarOcrCore needs Vision (10.15+) and VNRecognizeTextRequestRevision3 (13+).
    // The product is macOS-only and CI builds on macos-14; 13 is the floor the helper is tested on.
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "EvidenceCoreSmoke", targets: ["EvidenceCoreSmoke"]),
        // Thin CLI that runs the A0.7 harness and prints its deterministic verdict, so the marker
        // writer (WI-ENA11) reuses the real harness instead of re-implementing classification.
        .executable(name: "a07-harness-cli", targets: ["A07HarnessCLI"]),
        // Thin CLI for the A1-T6 citation-stability gate (WI-EVIDENCE-A1-T6-CITATION-STABILITY-GATE-00),
        // mirroring a07-harness-cli — single source of truth over EvidenceCoreSmoke.
        .executable(name: "a1-citation-stability-cli", targets: ["A1CitationStabilityCLI"]),
        // Thin CLI for the A3-T10 anchor-resolution regression gate
        // (WI-EVIDENCE-A3-T10-ANCHOR-REGRESSION-GATE-00), mirroring the a07/a1 CLIs.
        .executable(name: "a3-regression-cli", targets: ["A3RegressionCLI"]),
        // Thin CLI for the A10 native golden-export gate
        // (WI-EVIDENCE-A10-NATIVE-GOLDEN-EXPORT-HARNESS-00) — validates the A10-T6 apps-layer golden
        // CanonicalExportModel fixture. Mirrors the a07/a1/a3 CLIs.
        .executable(name: "a10-golden-export-cli", targets: ["A10GoldenExportCLI"]),
        // R3 / WI-12: the system-framework OCR helper (PDFKit + Vision, zero third-party deps). The
        // packaged app spawns `lawbar-ocr` under a deadline; every record carries the helper's own
        // build digest so the app can prove which binary ran. Tiers are decided by the bake-off,
        // not here. See dev-memo/plan-outstanding-work-00.md WI-12.
        .library(name: "LawbarOcrCore", targets: ["LawbarOcrCore"]),
        .executable(name: "lawbar-ocr", targets: ["LawbarOcrCLI"]),
    ],
    targets: [
        .target(name: "EvidenceCoreSmoke"),
        .executableTarget(name: "A07HarnessCLI", dependencies: ["EvidenceCoreSmoke"]),
        .executableTarget(name: "A1CitationStabilityCLI", dependencies: ["EvidenceCoreSmoke"]),
        .executableTarget(name: "A3RegressionCLI", dependencies: ["EvidenceCoreSmoke"]),
        .executableTarget(name: "A10GoldenExportCLI", dependencies: ["EvidenceCoreSmoke"]),
        .testTarget(name: "EvidenceCoreSmokeTests", dependencies: ["EvidenceCoreSmoke"]),
        .target(name: "LawbarOcrCore"),
        .executableTarget(name: "LawbarOcrCLI", dependencies: ["LawbarOcrCore"]),
        .testTarget(name: "LawbarOcrCoreTests", dependencies: ["LawbarOcrCore"]),
    ]
)
