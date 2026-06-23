// main.swift — a07-harness-cli (WI-ENA11). Thin CLI over EvidenceCoreA07Harness so the marker
// writer reuses the REAL A0.7 harness (single source of truth; no re-implementation in bash/python).
//
// Usage: a07-harness-cli <fixture.pdf> <oracle.json>
// Prints one tab-separated line to stdout: "<status>\t<classification>\t<observedPageCount>".
// Exit 0 iff status == pass; otherwise non-zero. It writes NO marker and performs no provenance/HMAC.

import Foundation
import EvidenceCoreSmoke

let args = CommandLine.arguments
guard args.count == 3 else {
    FileHandle.standardError.write(Data("usage: a07-harness-cli <fixture.pdf> <oracle.json>\n".utf8))
    exit(2)
}
let result = EvidenceCoreA07Harness.run(
    fixtureURL: URL(fileURLWithPath: args[1]),
    oracleURL: URL(fileURLWithPath: args[2])
)
print("\(result.status.rawValue)\t\(result.classification.rawValue)\t\(result.observedPageCount)")
exit(result.status == .pass ? 0 : 1)
