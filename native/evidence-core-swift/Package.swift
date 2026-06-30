// swift-tools-version:5.9
// Package.swift — Evidence Core Swift SKELETON (smoke only).
// This is NOT the A0.7 implementation: no PDFKit, no geometry, no marker, no product behavior.
// See README.md. It exists only to prove the SwiftPM toolchain + macOS CI build/test the package.

import PackageDescription

let package = Package(
    name: "EvidenceCoreSmoke",
    products: [
        .library(name: "EvidenceCoreSmoke", targets: ["EvidenceCoreSmoke"]),
        // Thin CLI that runs the A0.7 harness and prints its deterministic verdict, so the marker
        // writer (WI-ENA11) reuses the real harness instead of re-implementing classification.
        .executable(name: "a07-harness-cli", targets: ["A07HarnessCLI"]),
        // Thin CLI for the A1-T6 citation-stability gate (WI-EVIDENCE-A1-T6-CITATION-STABILITY-GATE-00),
        // mirroring a07-harness-cli — single source of truth over EvidenceCoreSmoke.
        .executable(name: "a1-citation-stability-cli", targets: ["A1CitationStabilityCLI"]),
    ],
    targets: [
        .target(name: "EvidenceCoreSmoke"),
        .executableTarget(name: "A07HarnessCLI", dependencies: ["EvidenceCoreSmoke"]),
        .executableTarget(name: "A1CitationStabilityCLI", dependencies: ["EvidenceCoreSmoke"]),
        .testTarget(name: "EvidenceCoreSmokeTests", dependencies: ["EvidenceCoreSmoke"]),
    ]
)
