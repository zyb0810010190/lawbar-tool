// swift-tools-version:5.9
// Package.swift — Evidence Core Swift SKELETON (smoke only).
// This is NOT the A0.7 implementation: no PDFKit, no geometry, no marker, no product behavior.
// See README.md. It exists only to prove the SwiftPM toolchain + macOS CI build/test the package.

import PackageDescription

let package = Package(
    name: "EvidenceCoreSmoke",
    products: [
        .library(name: "EvidenceCoreSmoke", targets: ["EvidenceCoreSmoke"]),
    ],
    targets: [
        .target(name: "EvidenceCoreSmoke"),
        .testTarget(name: "EvidenceCoreSmokeTests", dependencies: ["EvidenceCoreSmoke"]),
    ]
)
