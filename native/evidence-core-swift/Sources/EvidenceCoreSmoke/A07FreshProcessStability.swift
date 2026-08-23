// A07FreshProcessStability.swift — Evidence Core Swift: FRESH-PROCESS variant of the oracle-free A0.7
// geometry-stability mode (WI-A07-STABILITY-FRESHPROC).
//
// WHY THIS EXISTS. `EvidenceCoreA07Harness.runStability` (WI-A07-STABILITY, A07ConformanceHarness.swift)
// re-reads the same unchanged file N times inside ONE process. A mid-run file swap proved the release
// between reads is effective — a re-read observes new bytes — but it cannot exclude a CoreGraphics/PDFKit
// cache keyed on the file URL that lives for the lifetime of the process. For a court-facing gate,
// "probably not cached" is not a finding. This variant removes the question: every capture happens in a
// NEW process, so no process-lifetime cache can be shared between two captures. Agreement across fresh
// processes is therefore evidence about the geometry SOURCE, not about one process's memory.
//
// SHAPE. Two halves of one mechanism:
//   1. `captureOnceCanonicalGeometry(fixtureURL:)` — the subprocess side. Loads the document, captures
//      every page via the SAME `captureAllPages` oracle mode uses, and returns the SAME `canonicalGeometry`
//      byte-exact rendering the in-process comparison compares. Surfaced as `a07-harness-cli --capture-once`.
//   2. `runStabilityFreshProcess(fixtureURL:iterations:executableURL:)` — the driver. Re-spawns the RUNNING
//      binary (resolved from the kernel, never a hardcoded `.build/debug/...` path) N times in
//      `--capture-once` mode, collects stdout, decodes each capture back into `A07Observed`, and hands the
//      captures to the EXISTING `evaluateStability` classifier.
//
// NO FORK OF THE GATE LOGIC. Capture (`captureAllPages`/`captureBox`), canonicalisation
// (`canonicalGeometry`/`canonicalBox`), and classification (`evaluateStability`) are reused verbatim. Two
// implementations would drift and then disagree about a court-facing verdict, so this file adds only the
// process plumbing and the decoder that inverts `canonicalGeometry`. The decode is exact — geometry travels
// as IEEE-754 bit patterns, so `decodeCanonicalGeometry(canonicalGeometry(x)) == x` including NaN and -0.0.
//
// BELT AND BRACES. The decoded comparison is the verdict, but a byte-exact difference in the raw subprocess
// stdout that survives decoding (a differently-formatted rendering of equal values) is still two reads
// disagreeing, so it is also classified Class-2. This check can only turn a pass into a Class-2 STOP, never
// the reverse.
//
// SAME GUARANTEES AS IN-PROCESS MODE. Reads only: creates NO oracle, WRITES NO FILE (the child's stdout is
// a pipe and its stderr is /dev/null), touches NO `dev-memo/run/evidence/**`, writes NO marker, and creates
// NO provenance/HMAC. `not_implemented` is a FAIL, never a pass; `inconclusive` is NOT pass; a Class-2 is a
// STOP that is never downgraded. `detail` strings carry counts and geometry numbers ONLY — never a file
// name, path, page content, text, or document metadata — which is what makes the mode safe to point at
// confidential client material.

import Foundation
#if canImport(Darwin)
import Darwin
#endif
#if canImport(PDFKit)
import PDFKit
#endif

extension EvidenceCoreA07Harness {

    // MARK: - CLI flag vocabulary (shared by the driver and the CLI, so they cannot drift apart)

    /// Flag that puts the binary into single-capture mode. The driver passes exactly this to its children.
    public static let captureOnceFlag = "--capture-once"

    // MARK: - Single capture (the subprocess side)

    /// Load the document, capture EVERY page's geometry, and return the canonical byte-exact rendering —
    /// the same `captureAllPages` + `canonicalGeometry` pair the in-process stability comparison uses.
    ///
    /// Returns `nil` when the input is not a local file URL, the document does not load, or the renderer is
    /// unavailable. `nil` is a FAILURE for every caller: the CLI exits non-zero and the driver classifies
    /// the run `fail`/`fixture_or_oracle_invalid`. It is never a pass.
    ///
    /// The returned string contains geometry ONLY (page count, page indices, IEEE-754 bit patterns,
    /// rotation) — no file name, path, page content, text, or document metadata.
    public static func captureOnceCanonicalGeometry(fixtureURL: URL) -> String? {
        // OFFLINE INVARIANT (same as both existing modes): `PDFDocument(url:)` is network-capable for
        // http(s) URLs. Refuse any non-file URL before loading anything (evidence-genie.md invariant 1).
        guard fixtureURL.isFileURL else { return nil }

        #if canImport(PDFKit)
        // The document is released with the pool; only value-typed geometry escapes.
        let captured: A07Observed? = autoreleasepool {
            guard let document = PDFDocument(url: fixtureURL) else { return nil }
            return captureAllPages(document)
        }
        guard let observed = captured else { return nil }
        return canonicalGeometry(observed)
        #else
        // PDFKit unavailable -> cannot capture. The driver reports this as not_implemented (a FAIL).
        return nil
        #endif
    }

    // MARK: - Locating the binary to re-spawn

    /// Absolute path of the RUNNING executable, so fresh-process mode re-spawns ITSELF.
    ///
    /// Asks the kernel via `_NSGetExecutablePath` rather than trusting `CommandLine.arguments[0]`, which is
    /// whatever the parent chose to pass (observed to be a relative `./tool` when launched from its own
    /// directory) and can be spoofed outright. `Bundle.main.executableURL` is the fallback. Nothing here
    /// hardcodes a build path, so the driver works identically under `swift run`, `swift test`, a debug
    /// build, and a release build.
    public static func runningExecutableURL() -> URL? {
        #if canImport(Darwin)
        var size: UInt32 = 0
        _ = _NSGetExecutablePath(nil, &size)
        if size > 0 {
            var buffer = [CChar](repeating: 0, count: Int(size) + 1)
            if _NSGetExecutablePath(&buffer, &size) == 0 {
                let path = String(cString: buffer)
                if !path.isEmpty {
                    return URL(fileURLWithPath: path).resolvingSymlinksInPath()
                }
            }
        }
        #endif
        return Bundle.main.executableURL?.resolvingSymlinksInPath()
    }

    // MARK: - Fresh-process stability driver

    /// Run the oracle-free A0.7 stability check with EVERY capture in its own process: spawn `iterations`
    /// children of `executableURL` in `--capture-once` mode over the same unchanged file, then classify the
    /// collected captures with the existing `evaluateStability`. The verdict vocabulary is identical to
    /// in-process mode — this mode defines none of its own:
    ///
    /// - `pass` / `ok` — every fresh process reported identical geometry.
    /// - `fail` / `class_2_geometry_source_instability` — two fresh reads of the same unchanged file
    ///   disagreed. Definitional Class-2, a STOP, never downgraded to pass.
    /// - `fail` / `fixture_or_oracle_invalid` — the executable could not be resolved, a child failed to
    ///   produce a capture, a capture did not decode, or the document reported zero/partial page geometry.
    /// - `inconclusive` / `inconclusive_no_checkable_assertions` — fewer than two reads. NOT pass.
    /// - `fail` / `not_implemented` — PDFKit unavailable. `not_implemented` is a FAIL (A07-GATE-00 §4).
    ///
    /// - Parameter executableURL: binary to re-spawn. Defaults to the running executable; supplying it
    ///   explicitly is what lets the test target drive the real CLI (a test runs inside `xctest`, whose own
    ///   path is not the harness binary).
    ///
    /// Writes no file in any branch.
    public static func runStabilityFreshProcess(
        fixtureURL: URL,
        iterations: Int = EvidenceCoreA07Harness.stabilityDefaultIterations,
        executableURL: URL? = nil
    ) -> A07ConformanceResult {
        // OFFLINE INVARIANT: refuse non-file URLs before spawning anything.
        guard fixtureURL.isFileURL else {
            return A07ConformanceResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                        observedPageCount: 0,
                                        detail: "fixture must be a local file URL (offline harness); refusing non-file URL")
        }
        // Fewer than two captures compares nothing.
        guard iterations >= 2 else {
            return A07ConformanceResult(status: .inconclusive, classification: .inconclusive_no_checkable_assertions,
                                        observedPageCount: 0,
                                        detail: "stability needs at least 2 reads to compare; iterations=\(iterations) defines no checkable assertion (not pass)")
        }

        #if canImport(PDFKit)
        guard let executable = executableURL ?? runningExecutableURL(),
              FileManager.default.isExecutableFile(atPath: executable.path) else {
            return A07ConformanceResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                        observedPageCount: 0,
                                        detail: "could not resolve an executable binary to re-spawn for fresh-process capture (not pass)")
        }

        var outputs: [String] = []
        for read in 1...iterations {
            guard let output = captureInFreshProcess(executable: executable, fixtureURL: fixtureURL) else {
                return A07ConformanceResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                            observedPageCount: 0,
                                            detail: "fresh-process capture failed on read \(read) of \(iterations) (not pass)")
            }
            outputs.append(output)
        }
        return evaluateFreshProcessCaptures(outputs: outputs)
        #else
        // PDFKit unavailable -> the harness cannot execute. not_implemented is a FAIL (A07-GATE-00 §4).
        return A07ConformanceResult(status: .fail, classification: .not_implemented,
                                    observedPageCount: 0,
                                    detail: "PDFKit unavailable; A0.7 fresh-process stability mode not executable in this environment")
        #endif
    }

    /// Spawn ONE child in `--capture-once` mode and return its stdout verbatim, or `nil` if the child could
    /// not be launched, did not exit cleanly with status 0, or produced no output.
    ///
    /// stdout is a pipe (read to end BEFORE `waitUntilExit`, so a full pipe buffer cannot deadlock the
    /// child), stderr is `/dev/null`, and stdin is `/dev/null`. Nothing is written to disk.
    static func captureInFreshProcess(executable: URL, fixtureURL: URL) -> String? {
        let process = Process()
        process.executableURL = executable
        process.arguments = [captureOnceFlag, fixtureURL.path]
        let stdout = Pipe()
        process.standardOutput = stdout
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice

        do {
            try process.run()
        } catch {
            return nil
        }
        let data = stdout.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        // A signal death or a non-zero exit is a failed capture, never a silently-empty pass.
        guard process.terminationReason == .exit, process.terminationStatus == 0 else { return nil }
        guard let text = String(data: data, encoding: .utf8), !text.isEmpty else { return nil }
        return text
    }

    /// Pure classifier for fresh-process mode: decode each child's stdout and delegate the verdict to the
    /// EXISTING `evaluateStability`. No IO, so the Class-2 branch is directly testable.
    static func evaluateFreshProcessCaptures(outputs: [String]) -> A07ConformanceResult {
        guard outputs.count >= 2 else {
            return A07ConformanceResult(status: .inconclusive, classification: .inconclusive_no_checkable_assertions,
                                        observedPageCount: 0,
                                        detail: "stability needs at least 2 reads to compare; got \(outputs.count) (not pass)")
        }
        var captures: [A07Observed] = []
        for (index, output) in outputs.enumerated() {
            guard let observed = decodeCanonicalGeometry(output) else {
                return A07ConformanceResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                            observedPageCount: 0,
                                            detail: "fresh-process capture \(index + 1) of \(outputs.count) is not decodable canonical geometry (not pass)")
            }
            captures.append(observed)
        }

        let verdict = evaluateStability(captures: captures)

        // Belt and braces: decoding normalizes (e.g. `p00` and `0X1P+0` decode to the same values), so a
        // raw-byte difference between two children could in principle survive it. Two reads of the same
        // unchanged file rendering differently is still the geometry source failing to reproduce, so it is
        // Class-2. This can only turn a pass into a STOP, never the reverse.
        if verdict.status == .pass, let reference = outputs.first,
           let differing = outputs.enumerated().dropFirst().first(where: { $0.element != reference }) {
            return A07ConformanceResult(status: .fail, classification: .class_2_geometry_source_instability,
                                        observedPageCount: verdict.observedPageCount,
                                        detail: "geometry source not reproducible: capture rendering differs byte-exactly between read 1 and read \(differing.offset + 1) despite equal decoded values")
        }
        return verdict
    }

    // MARK: - Decoding (exact inverse of canonicalGeometry / canonicalBox)

    /// Decode a full canonical capture (`pages=N` followed by one line per captured page) back into the
    /// `A07Observed` the shared classifier consumes. Blank lines are ignored so a trailing newline from the
    /// child's `print` is not a parse error. Returns `nil` on anything malformed — which the caller treats
    /// as `fixture_or_oracle_invalid`, never a pass.
    static func decodeCanonicalGeometry(_ text: String) -> A07Observed? {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard let header = lines.first, header.hasPrefix("pages="),
              let pageCount = Int(header.dropFirst("pages=".count)), pageCount >= 0 else { return nil }
        var boxes: [A07Observed.Box] = []
        for line in lines.dropFirst() where !line.isEmpty {
            guard let box = decodeCanonicalBox(line) else { return nil }
            boxes.append(box)
        }
        return A07Observed(pageCount: pageCount, perPageMediaBox: boxes, sampleNormalized: [])
    }

    /// Decode one canonical page line: `p<index>|media=<h>,<h>,<h>,<h>|rot=<int>|crop=<h>,<h>,<h>,<h>`.
    static func decodeCanonicalBox(_ line: String) -> A07Observed.Box? {
        let parts = line.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 4,
              parts[0].hasPrefix("p"), let pageIndex = Int(parts[0].dropFirst()),
              parts[1].hasPrefix("media="), let media = decodeBitPatterns(parts[1].dropFirst("media=".count)),
              parts[2].hasPrefix("rot="), let rotation = Int(parts[2].dropFirst("rot=".count)),
              parts[3].hasPrefix("crop="), let crop = decodeBitPatterns(parts[3].dropFirst("crop=".count))
        else { return nil }
        return .init(pageIndex: pageIndex,
                     originX: media[0], originY: media[1], width: media[2], height: media[3],
                     rotation: rotation,
                     cropBox: .init(x: crop[0], y: crop[1], width: crop[2], height: crop[3]))
    }

    /// Decode exactly four comma-separated IEEE-754 bit patterns (hex) back into Doubles. Exact for every
    /// Double including NaN and -0.0, which is why the canonical form carries bit patterns rather than
    /// decimal text.
    private static func decodeBitPatterns<S: StringProtocol>(_ text: S) -> [Double]? {
        let fields = text.split(separator: ",", omittingEmptySubsequences: false)
        guard fields.count == 4 else { return nil }
        var values: [Double] = []
        values.reserveCapacity(4)
        for field in fields {
            guard let pattern = UInt64(field, radix: 16) else { return nil }
            values.append(Double(bitPattern: pattern))
        }
        return values
    }
}
