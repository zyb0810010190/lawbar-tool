// main.swift — a07-harness-cli (WI-ENA11; oracle-free stability mode added in WI-A07-STABILITY).
// Thin CLI over EvidenceCoreA07Harness so the marker writer reuses the REAL A0.7 harness (single source
// of truth; no re-implementation in bash/python).
//
// Usage:
//   a07-harness-cli <fixture.pdf> <oracle.json>
//   a07-harness-cli --stability <fixture.pdf> [--iterations N]
//
// Both modes print ONE tab-separated line to stdout: "<status>\t<classification>\t<observedPageCount>",
// and exit 0 iff status == pass. Neither writes a marker nor performs provenance/HMAC.
//
// Stability mode needs NO oracle: it re-reads the same unchanged file N times (default 3, minimum 2) and
// fails with class_2_geometry_source_instability if any two reads disagree. It creates NO oracle and
// writes NO file — stdout (plus a stderr detail line on a non-pass) is its only output, which is what
// makes it safe to point at confidential material. The detail line carries counts and geometry numbers
// only; it never prints the file name/path, page content, text, or document metadata.

import Foundation
import EvidenceCoreSmoke

let usage = """
usage:
  a07-harness-cli <fixture.pdf> <oracle.json>
  a07-harness-cli --stability <fixture.pdf> [--iterations N]   (N >= 2, default 3)
"""

func usageFailure() -> Never {
    FileHandle.standardError.write(Data((usage + "\n").utf8))
    exit(2)
}

func runSelectedMode(_ args: [String]) -> A07ConformanceResult {
    // Stability mode (oracle-free). Dispatch on the flag FIRST so `--stability <file>` is never
    // mistaken for the two-argument oracle form.
    if args.count >= 2, args[1] == "--stability" {
        guard args.count == 3 || args.count == 5, !args[2].hasPrefix("--") else { usageFailure() }
        var iterations = EvidenceCoreA07Harness.stabilityDefaultIterations
        if args.count == 5 {
            guard args[3] == "--iterations", let parsed = Int(args[4]), parsed >= 2 else { usageFailure() }
            iterations = parsed
        }
        return EvidenceCoreA07Harness.runStability(fixtureURL: URL(fileURLWithPath: args[2]),
                                                   iterations: iterations)
    }
    // Oracle conformance mode (unchanged).
    guard args.count == 3 else { usageFailure() }
    return EvidenceCoreA07Harness.run(fixtureURL: URL(fileURLWithPath: args[1]),
                                      oracleURL: URL(fileURLWithPath: args[2]))
}

let result = runSelectedMode(CommandLine.arguments)
print("\(result.status.rawValue)\t\(result.classification.rawValue)\t\(result.observedPageCount)")
if result.status != .pass {
    // Diagnosis for a non-pass verdict goes to stderr so stdout keeps its exact machine-readable shape.
    FileHandle.standardError.write(Data("detail: \(result.detail)\n".utf8))
}
exit(result.status == .pass ? 0 : 1)
