// main.swift — lawbar-ocr (product plan R3, WI-12 step 1). Thin CLI over LawbarOcrCore, mirroring
// the other CLIs in this package: no logic here, only argument parsing and exit codes.
//
// Usage:
//   lawbar-ocr probe [--roundtrip]
//   lawbar-ocr extract <file.pdf|image> [--pages a-b] [--lang zh-Hans,en-US] [--dpi 150] [--layer-only]
//
// Output: JSON, one object per line on stdout ({"kind":"probe"...}, {"kind":"page"...},
// {"kind":"error"...}). stderr carries nothing a caller should parse.
//
// Exit codes:
//   0  every requested page produced a record (a page's own failure is IN its record, never a skip)
//   2  bad arguments
//   3  unreadable input
//   4  page range out of range
//
// The caller (Electron main) owns the wall-clock deadline and the process-group kill. This process
// never writes to the filesystem: page images live and die in memory.

import Foundation
import LawbarOcrCore

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]

func emit<T: Encodable>(_ record: T) {
    if let data = try? encoder.encode(record), let line = String(data: data, encoding: .utf8) {
        print(line)
    }
}

func fail(_ code: String, _ detail: String, exit status: Int32) -> Never {
    emit(ErrorRecord(kind: "error", code: code, detail: detail))
    exit(status)
}

var args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else { fail("bad_arguments", "usage: lawbar-ocr probe [--roundtrip] | extract <file> [--pages a-b] [--lang l1,l2] [--dpi N] [--layer-only]", exit: 2) }
args.removeFirst()

switch command {
case "probe":
    let roundtrip = args.contains("--roundtrip")
    emit(LawbarOcrCore.probe(roundtrip: roundtrip))
    exit(0)

case "extract":
    guard let file = args.first, !file.hasPrefix("--") else { fail("bad_arguments", "extract needs a file", exit: 2) }
    args.removeFirst()
    var options = Extract.Options()
    var range: ClosedRange<Int>? = nil
    var i = 0
    while i < args.count {
        let a = args[i]
        let value: String? = (i + 1 < args.count) ? args[i + 1] : nil
        switch a {
        case "--pages":
            guard let v = value else { fail("bad_arguments", "--pages needs a-b", exit: 2) }
            let parts = v.split(separator: "-").map { Int($0) }
            if parts.count == 1, let a1 = parts[0] { range = a1...a1 }
            else if parts.count == 2, let a1 = parts[0], let b1 = parts[1], a1 <= b1 { range = a1...b1 }
            else { fail("bad_arguments", "--pages must be a-b with a <= b", exit: 2) }
            i += 2
        case "--lang":
            guard let v = value else { fail("bad_arguments", "--lang needs a list", exit: 2) }
            options.languages = v.split(separator: ",").map(String.init)
            i += 2
        case "--dpi":
            guard let v = value, let d = Double(v), d >= 36, d <= 600 else { fail("bad_arguments", "--dpi must be 36...600", exit: 2) }
            options.dpi = d
            i += 2
        case "--layer-only":
            options.layerOnly = true
            i += 1
        default:
            fail("bad_arguments", "unknown option \(a)", exit: 2)
        }
    }
    do {
        try Extract.run(file: URL(fileURLWithPath: file), range: range, options: options) { emit($0) }
        exit(0)
    } catch Extract.Failure.unreadableInput(let name) {
        fail("unreadable_input", name, exit: 3)
    } catch Extract.Failure.pageOutOfRange(let requested, let pageCount) {
        fail("page_out_of_range", "requested \(requested.lowerBound)-\(requested.upperBound) of \(pageCount)", exit: 4)
    } catch {
        fail("unreadable_input", "\(error)", exit: 3)
    }

default:
    fail("bad_arguments", "unknown command \(command)", exit: 2)
}
