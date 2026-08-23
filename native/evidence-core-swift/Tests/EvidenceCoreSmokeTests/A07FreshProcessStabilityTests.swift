import XCTest
import Foundation
@testable import EvidenceCoreSmoke

// Tests for the FRESH-PROCESS variant of the oracle-free A0.7 stability mode
// (WI-A07-STABILITY-FRESHPROC).
//
// The in-process mode re-reads one file inside one process, so a renderer cache keyed on the file URL and
// living for the process lifetime cannot be fully excluded. Fresh-process mode puts every capture in a NEW
// process, so agreement is evidence about the geometry SOURCE. These tests drive the REAL `a07-harness-cli`
// binary built alongside this test bundle — not a stand-in — so the CLI surface, the subprocess plumbing,
// and the shared classifier are all exercised as one mechanism.
//
// Coverage: all five synthetic fixtures pass in fresh-process mode; fresh-process and in-process agree on
// all five; `--capture-once` is byte-identical across repeated invocations and equals the in-process
// canonical rendering; corrupt / missing / empty / zero-page inputs are never a pass; both pre-existing
// modes still pass at the library AND CLI level (regression over the rewritten argument parser); the
// decoder round-trips exactly and rejects malformed input; and — the tests-bite requirement — a
// deliberately divergent capture producer IS detected as class_2 while its stable twin passes.
final class A07FreshProcessStabilityTests: XCTestCase {

    // MARK: - Locations

    private var fixturesDir: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures")
    }
    private var messyDir: URL { fixturesDir.appendingPathComponent("messy") }
    private var oracleURL: URL { fixturesDir.appendingPathComponent("a07-renderer-conformance/oracle.json") }

    /// Directory SwiftPM built this test bundle into — the same directory the package's executables land
    /// in, for both debug and release builds. Not a hardcoded `.build/debug/...` path.
    private var productsDirectory: URL {
        for bundle in Bundle.allBundles where bundle.bundlePath.hasSuffix(".xctest") {
            return bundle.bundleURL.deletingLastPathComponent()
        }
        return Bundle.main.bundleURL
    }
    /// The real CLI. A test runs inside `xctest`, so `runningExecutableURL()` would resolve to the test
    /// runner; the driver's `executableURL:` seam exists exactly for this.
    private var harnessCLI: URL { productsDirectory.appendingPathComponent("a07-harness-cli") }

    private var allFixtures: [(name: String, pdf: URL, oracle: URL, pages: Int)] {
        [
            ("twopage", fixturesDir.appendingPathComponent("synthetic-twopage.pdf"), oracleURL, 2),
            ("cropbox", messyDir.appendingPathComponent("synthetic-cropbox.pdf"),
             messyDir.appendingPathComponent("synthetic-cropbox.oracle.json"), 1),
            ("mixed-sizes", messyDir.appendingPathComponent("synthetic-mixed-sizes.pdf"),
             messyDir.appendingPathComponent("synthetic-mixed-sizes.oracle.json"), 2),
            ("nonzero-origin", messyDir.appendingPathComponent("synthetic-nonzero-origin.pdf"),
             messyDir.appendingPathComponent("synthetic-nonzero-origin.oracle.json"), 1),
            ("rotated", messyDir.appendingPathComponent("synthetic-rotated.pdf"),
             messyDir.appendingPathComponent("synthetic-rotated.oracle.json"), 1),
        ]
    }

    // MARK: - Helpers

    private func tempURL(_ suffix: String) -> URL {
        URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("a07fresh-\(UUID().uuidString)\(suffix)")
    }

    private struct RunOutput { let stdout: String; let stderr: String; let exitCode: Int32 }

    /// Run an executable and capture stdout/stderr/exit code. Used to drive the real CLI.
    @discardableResult
    private func run(_ executable: URL, _ arguments: [String]) throws -> RunOutput {
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        let out = Pipe(), err = Pipe()
        process.standardOutput = out
        process.standardError = err
        process.standardInput = FileHandle.nullDevice
        try process.run()
        let outData = out.fileHandleForReading.readDataToEndOfFile()
        let errData = err.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return RunOutput(stdout: String(decoding: outData, as: UTF8.self),
                         stderr: String(decoding: errData, as: UTF8.self),
                         exitCode: process.terminationStatus)
    }

    private func obsBox(_ idx: Int, _ x: Double, _ y: Double, _ w: Double, _ h: Double,
                        rot: Int = 0, crop: (Double, Double, Double, Double)? = nil) -> A07Observed.Box {
        let c = crop ?? (x, y, w, h)
        return .init(pageIndex: idx, originX: x, originY: y, width: w, height: h, rotation: rot,
                     cropBox: .init(x: c.0, y: c.1, width: c.2, height: c.3))
    }

    private func capture(_ boxes: [A07Observed.Box]) -> A07Observed {
        A07Observed(pageCount: boxes.count, perPageMediaBox: boxes, sampleNormalized: [])
    }

    /// Write an executable `/bin/sh` stub that stands in for `--capture-once`. It lets the driver be driven
    /// by a capture producer whose behavior the test chooses — including a deliberately UNSTABLE one, which
    /// is how these tests prove they can bite.
    private func writeStub(_ body: String) throws -> URL {
        let url = tempURL(".sh")
        try Data("#!/bin/sh\n\(body)\n".utf8).write(to: url)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        return url
    }

    /// A stub that prints `first` on invocation 1 and `later` on every subsequent invocation, using a
    /// counter file in the temp dir so the two child processes cannot share state any other way.
    private func writeAlternatingStub(first: String, later: String) throws -> (stub: URL, counter: URL) {
        let counter = tempURL(".count")
        let stub = try writeStub("""
        n=0
        [ -f "\(counter.path)" ] && n=$(cat "\(counter.path)")
        n=$((n+1))
        printf '%s' "$n" > "\(counter.path)"
        if [ "$n" -eq 1 ]; then
        cat <<'A07EOF'
        \(first)
        A07EOF
        else
        cat <<'A07EOF'
        \(later)
        A07EOF
        fi
        """)
        return (stub, counter)
    }

    private func snapshot(_ dir: URL) throws -> [String] {
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
        guard let walker = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: keys) else {
            return []
        }
        var rows: [String] = []
        for case let url as URL in walker {
            let values = try url.resourceValues(forKeys: Set(keys))
            rows.append("\(url.path)|\(values.fileSize ?? -1)|\(values.contentModificationDate?.timeIntervalSince1970 ?? -1)")
        }
        return rows.sorted()
    }

    /// Minimal deterministic ZERO-page PDF (a /Pages node with /Count 0 and no /Kids). All-ASCII, so byte
    /// offsets equal UTF-8 counts and the xref table is exact.
    private func writeZeroPagePDF(to url: URL) throws {
        let objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [] /Count 0 >>"]
        var pdf = "%PDF-1.4\n"
        var offsets: [Int] = []
        for (index, body) in objects.enumerated() {
            offsets.append(pdf.utf8.count)
            pdf += "\(index + 1) 0 obj\n\(body)\nendobj\n"
        }
        let startxref = pdf.utf8.count
        pdf += "xref\n0 \(objects.count + 1)\n0000000000 65535 f \n"
        for offset in offsets { pdf += String(format: "%010d 00000 n \n", offset) }
        pdf += "trailer\n<< /Size \(objects.count + 1) /Root 1 0 R >>\nstartxref\n\(startxref)\n%%EOF\n"
        try Data(pdf.utf8).write(to: url)
    }

    // MARK: - Pre-flight: the real CLI is where we expect it

    func testHarnessCliBinaryIsBuiltAlongsideTheTestBundle() {
        XCTAssertTrue(FileManager.default.isExecutableFile(atPath: harnessCLI.path),
                      "a07-harness-cli must be built next to the test bundle at \(harnessCLI.path)")
    }

    func testRunningExecutableUrlResolvesToTheRunningBinaryNotAHardcodedPath() {
        // Inside a test the running binary is the xctest runner. The point is that resolution returns the
        // path of the process that is ACTUALLY running — not a relative argv[0], and not a hardcoded
        // `.build/debug/a07-harness-cli` (which would still exist relative to the package working
        // directory during `swift test`, so "the path exists" alone would not catch that mistake).
        let resolved = EvidenceCoreA07Harness.runningExecutableURL()
        XCTAssertNotNil(resolved)
        guard let resolved else { return }
        XCTAssertTrue(resolved.path.hasPrefix("/"), "must be absolute: \(resolved.path)")
        XCTAssertTrue(FileManager.default.isExecutableFile(atPath: resolved.path), resolved.path)
        XCTAssertNotEqual(resolved.path, CommandLine.arguments.first, "must not be a bare argv[0]")
        XCTAssertNotEqual(resolved.standardizedFileURL, harnessCLI.standardizedFileURL,
                          "this process is xctest, not the harness CLI — a hardcoded CLI path is wrong")
        // Cross-check against Foundation's independent answer for the same question.
        XCTAssertEqual(resolved, Bundle.main.executableURL?.resolvingSymlinksInPath())
    }

    func testFreshProcessRespawnsItselfFromAnyLocationAndWorkingDirectory() throws {
        // Copy the CLI somewhere unrelated and run it with the working directory set elsewhere. If the
        // driver located its child by a build-relative path instead of by the running binary, this breaks.
        let relocated = tempURL("-relocated-a07-harness-cli")
        try FileManager.default.copyItem(at: harnessCLI, to: relocated)
        defer { try? FileManager.default.removeItem(at: relocated) }

        let fixture = allFixtures[0]
        let process = Process()
        process.executableURL = relocated
        process.arguments = ["--stability", fixture.pdf.path, "--fresh-process"]
        process.currentDirectoryURL = URL(fileURLWithPath: "/")
        let out = Pipe(), err = Pipe()
        process.standardOutput = out
        process.standardError = err
        try process.run()
        let stdout = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        let stderr = String(decoding: err.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        process.waitUntilExit()

        XCTAssertEqual(stdout, "pass\tok\t\(fixture.pages)\n", "stderr: \(stderr)")
        XCTAssertEqual(process.terminationStatus, 0)
    }

    // MARK: - Fresh-process stability over all five synthetic fixtures

    func testFreshProcessStabilityPassesForAllFiveSyntheticFixtures() {
        for fixture in allFixtures {
            let result = EvidenceCoreA07Harness.runStabilityFreshProcess(
                fixtureURL: fixture.pdf, iterations: 3, executableURL: harnessCLI)
            #if canImport(PDFKit)
            XCTAssertEqual(result.status, .pass,
                           "\(fixture.name): geometry must reproduce across INDEPENDENT processes — detail: \(result.detail)")
            XCTAssertEqual(result.classification, .ok, "\(fixture.name)")
            XCTAssertEqual(result.observedPageCount, fixture.pages, "\(fixture.name)")
            #else
            XCTAssertEqual(result.status, .fail, "\(fixture.name)")
            XCTAssertEqual(result.classification, .not_implemented, "\(fixture.name)")
            #endif
        }
    }

    func testFreshProcessAndInProcessModesAgreeOnAllFiveFixtures() {
        for fixture in allFixtures {
            let fresh = EvidenceCoreA07Harness.runStabilityFreshProcess(
                fixtureURL: fixture.pdf, iterations: 3, executableURL: harnessCLI)
            let inProcess = EvidenceCoreA07Harness.runStability(fixtureURL: fixture.pdf, iterations: 3)
            XCTAssertEqual(fresh.status, inProcess.status, "\(fixture.name)")
            XCTAssertEqual(fresh.classification, inProcess.classification, "\(fixture.name)")
            XCTAssertEqual(fresh.observedPageCount, inProcess.observedPageCount, "\(fixture.name)")
            // Same field vocabulary, in the same order, with the same isMarker=false.
            XCTAssertEqual(fresh.orderedFields().map { $0.0 }, inProcess.orderedFields().map { $0.0 },
                           "\(fixture.name)")
            XCTAssertEqual(fresh.orderedFields().first { $0.0 == "isMarker" }?.1, "false", "\(fixture.name)")
        }
    }

    func testFreshProcessDefaultIterationsMatchesInProcessDefault() {
        let fixture = allFixtures[0].pdf
        let byDefault = EvidenceCoreA07Harness.runStabilityFreshProcess(fixtureURL: fixture,
                                                                        executableURL: harnessCLI)
        let explicit = EvidenceCoreA07Harness.runStabilityFreshProcess(
            fixtureURL: fixture, iterations: EvidenceCoreA07Harness.stabilityDefaultIterations,
            executableURL: harnessCLI)
        XCTAssertEqual(byDefault, explicit)
    }

    // MARK: - --capture-once is byte-stable and equals the in-process canonical rendering

    func testCaptureOnceOutputIsByteIdenticalAcrossRepeatedInvocations() throws {
        for fixture in allFixtures {
            var outputs: [String] = []
            for _ in 0..<5 {
                let run = try run(harnessCLI, [EvidenceCoreA07Harness.captureOnceFlag, fixture.pdf.path])
                XCTAssertEqual(run.exitCode, 0, "\(fixture.name): capture-once must exit 0 — \(run.stderr)")
                XCTAssertFalse(run.stdout.isEmpty, "\(fixture.name)")
                outputs.append(run.stdout)
            }
            for (index, output) in outputs.enumerated().dropFirst() {
                XCTAssertEqual(output, outputs[0],
                               "\(fixture.name): invocation \(index + 1) differs byte-exactly from invocation 1")
            }
        }
    }

    func testCaptureOnceMatchesTheInProcessCanonicalGeometryExactly() throws {
        for fixture in allFixtures {
            let run = try run(harnessCLI, [EvidenceCoreA07Harness.captureOnceFlag, fixture.pdf.path])
            XCTAssertEqual(run.exitCode, 0, "\(fixture.name)")
            let fromCli = run.stdout.hasSuffix("\n") ? String(run.stdout.dropLast()) : run.stdout
            let inProcess = EvidenceCoreA07Harness.captureOnceCanonicalGeometry(fixtureURL: fixture.pdf)
            #if canImport(PDFKit)
            XCTAssertEqual(fromCli, inProcess,
                           "\(fixture.name): the subprocess must emit the SAME canonical rendering the in-process comparison uses")
            // ...and that rendering must decode back to the same geometry the classifier compares.
            let decoded = EvidenceCoreA07Harness.decodeCanonicalGeometry(fromCli)
            XCTAssertNotNil(decoded, "\(fixture.name)")
            XCTAssertEqual(decoded.map(EvidenceCoreA07Harness.canonicalGeometry), inProcess, "\(fixture.name)")
            XCTAssertEqual(decoded?.pageCount, fixture.pages, "\(fixture.name)")
            #else
            XCTAssertNil(inProcess, "\(fixture.name)")
            #endif
        }
    }

    func testCaptureOnceOutputLeaksNoPathOrFileName() throws {
        // The mode is pointed at confidential client PDFs, whose FILE NAME can itself be privileged.
        for fixture in allFixtures {
            let run = try run(harnessCLI, [EvidenceCoreA07Harness.captureOnceFlag, fixture.pdf.path])
            XCTAssertFalse(run.stdout.contains("/"), "\(fixture.name): stdout must contain no path")
            XCTAssertFalse(run.stdout.contains(".pdf"), "\(fixture.name)")
            XCTAssertFalse(run.stdout.contains("synthetic"), "\(fixture.name)")
        }
        let failing = try run(harnessCLI, [EvidenceCoreA07Harness.captureOnceFlag, oracleURL.path])
        XCTAssertNotEqual(failing.exitCode, 0, "a non-loadable document must exit non-zero")
        XCTAssertFalse(failing.stderr.contains("oracle.json"), failing.stderr)
        XCTAssertFalse(failing.stderr.contains(fixturesDir.path), failing.stderr)
    }

    // MARK: - Never a pass: corrupt / missing / empty / zero-page / bad executable

    func testCorruptFileIsNotPassInFreshProcessMode() {
        // oracle.json is valid JSON but is not a PDF: every child fails to load and exits non-zero.
        let result = EvidenceCoreA07Harness.runStabilityFreshProcess(
            fixtureURL: oracleURL, iterations: 3, executableURL: harnessCLI)
        XCTAssertNotEqual(result.status, .pass, "an unreadable document must never be a pass")
        XCTAssertEqual(result.status, .fail)
        XCTAssertEqual(result.classification, .fixture_or_oracle_invalid)
        XCTAssertFalse(result.detail.contains("oracle.json"), result.detail)
    }

    func testMissingFileIsNotPassInFreshProcessMode() {
        let missing = fixturesDir.appendingPathComponent("does-not-exist-\(UUID().uuidString).pdf")
        let result = EvidenceCoreA07Harness.runStabilityFreshProcess(
            fixtureURL: missing, iterations: 3, executableURL: harnessCLI)
        XCTAssertNotEqual(result.status, .pass)
        XCTAssertEqual(result.classification, .fixture_or_oracle_invalid)
    }

    func testEmptyFileIsNotPassInFreshProcessMode() throws {
        let empty = tempURL(".pdf")
        try Data().write(to: empty)
        defer { try? FileManager.default.removeItem(at: empty) }
        let result = EvidenceCoreA07Harness.runStabilityFreshProcess(
            fixtureURL: empty, iterations: 3, executableURL: harnessCLI)
        XCTAssertNotEqual(result.status, .pass, "a 0-byte file must never be a pass")
        XCTAssertEqual(result.classification, .fixture_or_oracle_invalid)
    }

    func testZeroPageDocumentIsNotPassInFreshProcessMode() throws {
        let zeroPage = tempURL(".pdf")
        try writeZeroPagePDF(to: zeroPage)
        defer { try? FileManager.default.removeItem(at: zeroPage) }
        let result = EvidenceCoreA07Harness.runStabilityFreshProcess(
            fixtureURL: zeroPage, iterations: 3, executableURL: harnessCLI)
        // PDFKit may refuse the document (child exits non-zero) or load it and report 0 pages (the shared
        // classifier rejects it). Either way it is invalid-and-fail; it is NEVER a pass.
        XCTAssertNotEqual(result.status, .pass, "a zero-page document must never be a pass")
        XCTAssertEqual(result.status, .fail)
        XCTAssertEqual(result.classification, .fixture_or_oracle_invalid)
        XCTAssertEqual(result.observedPageCount, 0)
    }

    func testNonFileUrlIsRefusedInFreshProcessMode() {
        let http = URL(string: "https://example.com/confidential.pdf")!
        let result = EvidenceCoreA07Harness.runStabilityFreshProcess(
            fixtureURL: http, iterations: 3, executableURL: harnessCLI)
        XCTAssertEqual(result.status, .fail)
        XCTAssertEqual(result.classification, .fixture_or_oracle_invalid)
        XCTAssertTrue(result.detail.contains("file URL"), result.detail)
    }

    func testUnresolvableExecutableIsNotPass() {
        let missing = tempURL("-no-such-binary")
        let result = EvidenceCoreA07Harness.runStabilityFreshProcess(
            fixtureURL: allFixtures[0].pdf, iterations: 3, executableURL: missing)
        XCTAssertNotEqual(result.status, .pass, "no capture happened; that can never be a pass")
        XCTAssertEqual(result.status, .fail)
        XCTAssertEqual(result.classification, .fixture_or_oracle_invalid)
    }

    func testFewerThanTwoReadsIsInconclusiveNotPassInFreshProcessMode() {
        for iterations in [1, 0, -1] {
            let result = EvidenceCoreA07Harness.runStabilityFreshProcess(
                fixtureURL: allFixtures[0].pdf, iterations: iterations, executableURL: harnessCLI)
            XCTAssertEqual(result.status, .inconclusive, "iterations=\(iterations)")
            XCTAssertEqual(result.classification, .inconclusive_no_checkable_assertions, "iterations=\(iterations)")
            XCTAssertNotEqual(result.status, .pass, "inconclusive must never be pass")
        }
        let none = EvidenceCoreA07Harness.evaluateFreshProcessCaptures(outputs: ["pages=1"])
        XCTAssertEqual(none.status, .inconclusive)
        XCTAssertNotEqual(none.status, .pass)
    }

    // MARK: - The tests bite: a deliberately divergent capture producer IS detected

    func testStableStubPassesButDivergentStubIsClass2() throws {
        let stable = EvidenceCoreA07Harness.canonicalGeometry(capture([obsBox(0, 0, 0, 612, 792)]))
        let drifted = EvidenceCoreA07Harness.canonicalGeometry(capture([obsBox(0, 0, 0, 612, 791.5)]))

        // Control: a stub that always prints the same capture is a pass. Without this, a divergence test
        // could be passing for the wrong reason (e.g. the stub never running at all).
        let stableStub = try writeStub("cat <<'A07EOF'\n\(stable)\nA07EOF")
        defer { try? FileManager.default.removeItem(at: stableStub) }
        let stablePass = EvidenceCoreA07Harness.runStabilityFreshProcess(
            fixtureURL: allFixtures[0].pdf, iterations: 3, executableURL: stableStub)
        XCTAssertEqual(stablePass.status, .pass, "control stub must pass — detail: \(stablePass.detail)")
        XCTAssertEqual(stablePass.classification, .ok)

        // The mutation: read 2 reports a different page height for the same unchanged file.
        let (divergentStub, counter) = try writeAlternatingStub(first: stable, later: drifted)
        defer {
            try? FileManager.default.removeItem(at: divergentStub)
            try? FileManager.default.removeItem(at: counter)
        }
        let divergent = EvidenceCoreA07Harness.runStabilityFreshProcess(
            fixtureURL: allFixtures[0].pdf, iterations: 3, executableURL: divergentStub)
        XCTAssertEqual(divergent.status, .fail, "a divergent capture must NOT pass")
        XCTAssertEqual(divergent.classification, .class_2_geometry_source_instability,
                       "two fresh reads disagreeing IS geometry-source instability")
        XCTAssertTrue(divergent.detail.contains("read 2"), "detail must name the diverging read: \(divergent.detail)")
    }

    func testDivergentPageCountAcrossProcessesIsClass2() throws {
        let onePage = EvidenceCoreA07Harness.canonicalGeometry(capture([obsBox(0, 0, 0, 612, 792)]))
        let twoPages = EvidenceCoreA07Harness.canonicalGeometry(
            capture([obsBox(0, 0, 0, 612, 792), obsBox(1, 0, 0, 612, 792)]))
        let (stub, counter) = try writeAlternatingStub(first: twoPages, later: onePage)
        defer {
            try? FileManager.default.removeItem(at: stub)
            try? FileManager.default.removeItem(at: counter)
        }
        let result = EvidenceCoreA07Harness.runStabilityFreshProcess(
            fixtureURL: allFixtures[0].pdf, iterations: 2, executableURL: stub)
        XCTAssertEqual(result.classification, .class_2_geometry_source_instability)
        XCTAssertTrue(result.detail.contains("page count"), result.detail)
    }

    func testByteDifferentButValueEqualRenderingIsStillClass2() {
        // Decoding normalizes: `p00` parses to the same page index as `p0`, and an upper-case hex bit
        // pattern to the same Double. Two reads that RENDER differently are still two reads disagreeing,
        // so the raw-byte check must catch what the decoder would otherwise smooth over.
        let reference = EvidenceCoreA07Harness.canonicalGeometry(capture([obsBox(0, 0, 0, 612, 792)]))
        let restyled = reference.replacingOccurrences(of: "p0|", with: "p00|")
        XCTAssertNotEqual(restyled, reference, "the variant must actually differ byte-wise")
        XCTAssertEqual(EvidenceCoreA07Harness.decodeCanonicalGeometry(restyled),
                       EvidenceCoreA07Harness.decodeCanonicalGeometry(reference),
                       "...while decoding to identical geometry")

        let result = EvidenceCoreA07Harness.evaluateFreshProcessCaptures(outputs: [reference, restyled])
        XCTAssertEqual(result.status, .fail)
        XCTAssertEqual(result.classification, .class_2_geometry_source_instability)
        XCTAssertTrue(result.detail.contains("byte-exactly"), result.detail)
    }

    func testChildFailureAndGarbageOutputAreNeverPass() throws {
        let stable = EvidenceCoreA07Harness.canonicalGeometry(capture([obsBox(0, 0, 0, 612, 792)]))
        let cases: [(name: String, body: String)] = [
            ("non-zero exit", "printf '%s\\n' '\(stable)'\nexit 3"),
            ("silent success", "exit 0"),
            ("garbage", "echo 'not canonical geometry'"),
            ("truncated", "echo 'pages=1'\necho 'p0|media=0,0'"),
            ("bad header", "echo 'pagecount=1'\nprintf '%s\\n' '\(stable.split(separator: "\n")[1])'"),
        ]
        for testCase in cases {
            let stub = try writeStub(testCase.body)
            defer { try? FileManager.default.removeItem(at: stub) }
            let result = EvidenceCoreA07Harness.runStabilityFreshProcess(
                fixtureURL: allFixtures[0].pdf, iterations: 2, executableURL: stub)
            XCTAssertNotEqual(result.status, .pass, "\(testCase.name) must never be a pass")
            XCTAssertEqual(result.status, .fail, "\(testCase.name)")
            XCTAssertEqual(result.classification, .fixture_or_oracle_invalid, "\(testCase.name)")
        }
    }

    // MARK: - Decoder: exact inverse of the canonical rendering, strict about malformed input

    func testDecodeRoundTripsExactlyIncludingNaNAndSignedZero() {
        let tricky = capture([
            obsBox(0, -0.0, 0.0, 612, 792, rot: 0, crop: (0, 0, 612, 792)),
            obsBox(1, -12.25, 8.5, 595.276, 841.89, rot: 270, crop: (-1.5, 2.25, 500.125, 700.0625)),
            obsBox(2, Double.nan, Double.infinity, -0.0, 1e-300, rot: 180, crop: (1e300, -1e-300, 3, 4)),
        ])
        let rendered = EvidenceCoreA07Harness.canonicalGeometry(tricky)
        guard let decoded = EvidenceCoreA07Harness.decodeCanonicalGeometry(rendered) else {
            return XCTFail("canonical geometry must decode")
        }
        // Re-rendering is the equality test: A07Observed uses `==` on Doubles, which cannot compare NaN.
        XCTAssertEqual(EvidenceCoreA07Harness.canonicalGeometry(decoded), rendered)
        XCTAssertEqual(decoded.pageCount, 3)
        XCTAssertEqual(decoded.perPageMediaBox.map { $0.rotation }, [0, 270, 180])
        // Signed zero survives: the bit patterns differ, so page 0's origin is -0.0, not 0.0.
        XCTAssertEqual(decoded.perPageMediaBox[0].originX.sign, .minus)
        XCTAssertTrue(decoded.perPageMediaBox[2].originX.isNaN)
        // A trailing newline (as `print` emits) is tolerated.
        XCTAssertEqual(EvidenceCoreA07Harness.decodeCanonicalGeometry(rendered + "\n")
            .map(EvidenceCoreA07Harness.canonicalGeometry), rendered)
    }

    func testDecodeRejectsMalformedInput() {
        let malformed = [
            "", "pages=", "pages=x", "pages=-1", "not-a-header",
            "pages=1\np0|media=0,0,0|rot=0|crop=0,0,0,0",              // 3 media fields
            "pages=1\np0|media=0,0,0,0|rot=0",                          // missing crop section
            "pages=1\np0|media=0,0,0,0|rot=x|crop=0,0,0,0",             // non-integer rotation
            "pages=1\np0|media=0,0,0,zz|rot=0|crop=0,0,0,0",            // non-hex bit pattern
            "pages=1\nq0|media=0,0,0,0|rot=0|crop=0,0,0,0",             // wrong page prefix
            "pages=1\np0|mediabox=0,0,0,0|rot=0|crop=0,0,0,0",          // wrong field name
        ]
        for text in malformed {
            XCTAssertNil(EvidenceCoreA07Harness.decodeCanonicalGeometry(text),
                         "must reject: \(text.replacingOccurrences(of: "\n", with: "\\n"))")
        }
    }

    // MARK: - Regression: both pre-existing modes still work, at library AND CLI level

    func testPreExistingLibraryModesStillPassForAllFiveFixtures() {
        for fixture in allFixtures {
            let oracleMode = EvidenceCoreA07Harness.run(fixtureURL: fixture.pdf, oracleURL: fixture.oracle)
            XCTAssertEqual(oracleMode.status, .pass, "\(fixture.name): oracle mode — \(oracleMode.detail)")
            XCTAssertEqual(oracleMode.classification, .ok, "\(fixture.name)")
            XCTAssertEqual(oracleMode.observedPageCount, fixture.pages, "\(fixture.name)")

            let inProcess = EvidenceCoreA07Harness.runStability(fixtureURL: fixture.pdf, iterations: 3)
            XCTAssertEqual(inProcess.status, .pass, "\(fixture.name): in-process stability — \(inProcess.detail)")
            XCTAssertEqual(inProcess.classification, .ok, "\(fixture.name)")
            XCTAssertEqual(inProcess.observedPageCount, fixture.pages, "\(fixture.name)")
        }
    }

    /// Every accepted argument form of every verdict mode emits the SAME one-line contract. Exercised on
    /// one fixture because what is under test is the (rewritten) argument parser, not the geometry; the
    /// per-fixture coverage lives in the library-level tests above and in the CLI test below.
    func testCliVerdictModesAllEmitTheSameOneLineContract() throws {
        let fixture = allFixtures[0]
        let expected = "pass\tok\t\(fixture.pages)\n"
        let invocations: [[String]] = [
            [fixture.pdf.path, fixture.oracle.path],                             // pre-existing oracle
            ["--stability", fixture.pdf.path],                                   // pre-existing default
            ["--stability", fixture.pdf.path, "--iterations", "4"],              // pre-existing explicit
            ["--stability", fixture.pdf.path, "--fresh-process"],                // new
            ["--stability", fixture.pdf.path, "--fresh-process", "--iterations", "4"],
            ["--stability", fixture.pdf.path, "--iterations", "4", "--fresh-process"],
        ]
        for arguments in invocations {
            let run = try run(harnessCLI, arguments)
            XCTAssertEqual(run.stdout, expected, "\(arguments) — stderr: \(run.stderr)")
            XCTAssertEqual(run.exitCode, 0, "\(arguments)")
            XCTAssertTrue(run.stderr.isEmpty, "\(arguments): \(run.stderr)")
        }
    }

    func testCliFreshProcessModePassesForAllFiveSyntheticFixtures() throws {
        for fixture in allFixtures {
            let run = try run(harnessCLI, ["--stability", fixture.pdf.path, "--fresh-process"])
            XCTAssertEqual(run.stdout, "pass\tok\t\(fixture.pages)\n", "\(fixture.name) — stderr: \(run.stderr)")
            XCTAssertEqual(run.exitCode, 0, "\(fixture.name)")
            XCTAssertTrue(run.stderr.isEmpty, "\(fixture.name): \(run.stderr)")
        }
    }

    func testCliNonPassExitsOneWithDetailOnStderrInEveryVerdictMode() throws {
        let arguments: [[String]] = [
            [oracleURL.path, oracleURL.path],
            ["--stability", oracleURL.path],
            ["--stability", oracleURL.path, "--fresh-process"],
        ]
        for argument in arguments {
            let run = try run(harnessCLI, argument)
            XCTAssertEqual(run.exitCode, 1, "\(argument)")
            XCTAssertEqual(run.stdout, "fail\tfixture_or_oracle_invalid\t0\n", "\(argument)")
            // `contains`, not `hasPrefix`: CoreGraphics itself logs a line to stderr when it is handed a
            // non-PDF. That third-party noise carries no path, and the harness's own detail line follows it.
            XCTAssertTrue(run.stderr.contains("detail: "), "\(argument): \(run.stderr)")
            XCTAssertFalse(run.stderr.contains(fixturesDir.path), "\(argument): \(run.stderr)")
        }
    }

    func testCliUsageErrorsExitTwo() throws {
        let bad: [[String]] = [
            [],
            ["--stability"],
            ["--stability", "--iterations"],
            ["--stability", allFixtures[0].pdf.path, "--iterations"],
            ["--stability", allFixtures[0].pdf.path, "--iterations", "1"],
            ["--stability", allFixtures[0].pdf.path, "--iterations", "x"],
            ["--stability", allFixtures[0].pdf.path, "--unknown"],
            ["--stability", allFixtures[0].pdf.path, "--fresh-process", "--fresh-process"],
            ["--stability", allFixtures[0].pdf.path, "--iterations", "3", "--iterations", "4"],
            [EvidenceCoreA07Harness.captureOnceFlag],
            [EvidenceCoreA07Harness.captureOnceFlag, allFixtures[0].pdf.path, "extra"],
            [allFixtures[0].pdf.path],
            [allFixtures[0].pdf.path, oracleURL.path, "extra"],
        ]
        for arguments in bad {
            let run = try run(harnessCLI, arguments)
            XCTAssertEqual(run.exitCode, 2, "\(arguments) must be a usage error — stdout: \(run.stdout)")
            XCTAssertTrue(run.stdout.isEmpty, "\(arguments): usage errors print nothing to stdout")
            XCTAssertTrue(run.stderr.contains("usage:"), "\(arguments)")
        }
    }

    // MARK: - Confidentiality: writes nothing

    func testFreshProcessModeWritesNoFileAndMutatesNothing() throws {
        // The system temp dir is deliberately NOT asserted (unrelated processes write there during a test
        // run). The fixture tree and the working directory are where an artifact could plausibly land.
        let cwd = FileManager.default.currentDirectoryPath
        let beforeFixtures = try snapshot(fixturesDir)
        let beforeCwd = try FileManager.default.contentsOfDirectory(atPath: cwd).sorted()

        for fixture in allFixtures {
            _ = EvidenceCoreA07Harness.runStabilityFreshProcess(
                fixtureURL: fixture.pdf, iterations: 3, executableURL: harnessCLI)
            _ = try run(harnessCLI, [EvidenceCoreA07Harness.captureOnceFlag, fixture.pdf.path])
        }

        XCTAssertEqual(try snapshot(fixturesDir), beforeFixtures,
                       "fresh-process mode must not create, modify, or touch anything in the fixture tree")
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: cwd).sorted(), beforeCwd,
                       "fresh-process mode must not write into the working directory")
    }

    func testFreshProcessDetailNeverLeaksTheFileName() {
        let passing = EvidenceCoreA07Harness.runStabilityFreshProcess(
            fixtureURL: allFixtures[0].pdf, iterations: 3, executableURL: harnessCLI)
        XCTAssertFalse(passing.detail.contains("synthetic-twopage"), passing.detail)
        XCTAssertFalse(passing.detail.contains(".pdf"), passing.detail)
        XCTAssertFalse(passing.detail.contains(fixturesDir.path), passing.detail)

        let failing = EvidenceCoreA07Harness.runStabilityFreshProcess(
            fixtureURL: oracleURL, iterations: 3, executableURL: harnessCLI)
        XCTAssertFalse(failing.detail.contains("oracle.json"), failing.detail)
        XCTAssertFalse(failing.detail.contains(fixturesDir.path), failing.detail)
    }
}
