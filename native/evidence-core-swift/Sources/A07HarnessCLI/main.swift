// main.swift — a07-harness-cli (WI-ENA11; oracle-free stability mode added in WI-A07-STABILITY;
// fresh-process stability + single-capture mode added in WI-A07-STABILITY-FRESHPROC).
// Thin CLI over EvidenceCoreA07Harness so the marker writer reuses the REAL A0.7 harness (single source
// of truth; no re-implementation in bash/python).
//
// Usage:
//   a07-harness-cli <fixture.pdf> <oracle.json>
//   a07-harness-cli --stability <fixture.pdf> [--fresh-process] [--iterations N]
//   a07-harness-cli --capture-once <fixture.pdf>
//
// The two VERDICT modes (oracle, stability) print ONE tab-separated line to stdout:
// "<status>\t<classification>\t<observedPageCount>", and exit 0 iff status == pass. Usage errors exit 2.
// No mode writes a marker or performs provenance/HMAC, and no mode writes any file.
//
// Stability mode needs NO oracle: it captures the geometry of the same unchanged file N times (default 3,
// minimum 2) and fails with class_2_geometry_source_instability if any two reads disagree. `--fresh-process`
// puts every capture in a NEW process (this binary re-spawned in `--capture-once` mode), which removes the
// only remaining doubt about the in-process form — that a renderer cache keyed on the file URL could
// outlive a released document within one process. Both forms share one capture path, one canonical
// rendering, and one classifier, so their verdicts have identical shape and vocabulary.
//
// `--capture-once` is the subprocess primitive `--fresh-process` drives: it prints ONLY the canonical
// geometry string (page count, page indices, IEEE-754 bit patterns, rotation) and exits 0; a document that
// does not load exits non-zero. It prints no file name, no path, and no document metadata.
//
// Every mode creates NO oracle and writes NO file — stdout (plus a stderr detail line on a non-pass) is the
// only output, which is what makes these modes safe to point at confidential material. Detail lines carry
// counts and geometry numbers only; they never print the file name/path, page content, text, or metadata.

import Foundation
import EvidenceCoreSmoke

let usage = """
usage:
  a07-harness-cli <fixture.pdf> <oracle.json>
  a07-harness-cli --stability <fixture.pdf> [--fresh-process] [--iterations N]   (N >= 2, default 3)
  a07-harness-cli --capture-once <fixture.pdf>
"""

func usageFailure() -> Never {
    FileHandle.standardError.write(Data((usage + "\n").utf8))
    exit(2)
}

/// Single-capture mode. Not a verdict mode: it emits the canonical geometry string and nothing else, so
/// `--fresh-process` can compare captures taken by independent processes. Exits before the verdict printer.
func runCaptureOnceIfSelected(_ args: [String]) {
    guard args.count >= 2, args[1] == EvidenceCoreA07Harness.captureOnceFlag else { return }
    guard args.count == 3, !args[2].hasPrefix("--") else { usageFailure() }
    guard let geometry = EvidenceCoreA07Harness
        .captureOnceCanonicalGeometry(fixtureURL: URL(fileURLWithPath: args[2])) else {
        // Non-loadable input (or an unavailable renderer) is a FAILURE, never a silent empty success.
        // The message names no path: this mode is pointed at confidential material.
        FileHandle.standardError.write(
            Data("detail: capture failed; document did not load or the renderer is unavailable (not pass)\n".utf8))
        exit(1)
    }
    print(geometry)
    exit(0)
}

func runSelectedMode(_ args: [String]) -> A07ConformanceResult {
    // Stability mode (oracle-free). Dispatch on the flag FIRST so `--stability <file>` is never
    // mistaken for the two-argument oracle form.
    if args.count >= 2, args[1] == "--stability" {
        guard args.count >= 3, !args[2].hasPrefix("--") else { usageFailure() }
        var iterations = EvidenceCoreA07Harness.stabilityDefaultIterations
        var sawIterations = false
        var freshProcess = false
        var index = 3
        // Trailing options accept either order; a repeat or an unknown token is a usage error (exit 2).
        while index < args.count {
            switch args[index] {
            case "--fresh-process":
                guard !freshProcess else { usageFailure() }
                freshProcess = true
                index += 1
            case "--iterations":
                guard !sawIterations, index + 1 < args.count,
                      let parsed = Int(args[index + 1]), parsed >= 2 else { usageFailure() }
                iterations = parsed
                sawIterations = true
                index += 2
            default:
                usageFailure()
            }
        }
        let fixtureURL = URL(fileURLWithPath: args[2])
        return freshProcess
            ? EvidenceCoreA07Harness.runStabilityFreshProcess(fixtureURL: fixtureURL, iterations: iterations)
            : EvidenceCoreA07Harness.runStability(fixtureURL: fixtureURL, iterations: iterations)
    }
    // Oracle conformance mode (unchanged).
    guard args.count == 3 else { usageFailure() }
    return EvidenceCoreA07Harness.run(fixtureURL: URL(fileURLWithPath: args[1]),
                                      oracleURL: URL(fileURLWithPath: args[2]))
}

runCaptureOnceIfSelected(CommandLine.arguments)
let result = runSelectedMode(CommandLine.arguments)
print("\(result.status.rawValue)\t\(result.classification.rawValue)\t\(result.observedPageCount)")
if result.status != .pass {
    // Diagnosis for a non-pass verdict goes to stderr so stdout keeps its exact machine-readable shape.
    FileHandle.standardError.write(Data("detail: \(result.detail)\n".utf8))
}
exit(result.status == .pass ? 0 : 1)
