// main.swift — a1-citation-stability-cli (WI-EVIDENCE-A1-T6-CITATION-STABILITY-GATE-00). Thin CLI over
// EvidenceCoreA1CitationGate so the gate has a single source of truth (no re-implementation). Mirrors
// a07-harness-cli.
//
// Usage: a1-citation-stability-cli <fixture.json> <oracle.json>
// Prints one tab-separated line: "<status>\t<classification>\t<observedPageCount>". Exit 0 iff pass.
// Writes NO marker; performs no provenance/HMAC.

import Foundation
import EvidenceCoreSmoke

let args = CommandLine.arguments
guard args.count == 3 else {
    FileHandle.standardError.write(Data("usage: a1-citation-stability-cli <fixture.json> <oracle.json>\n".utf8))
    exit(2)
}
let result = EvidenceCoreA1CitationGate.run(
    fixtureURL: URL(fileURLWithPath: args[1]),
    oracleURL: URL(fileURLWithPath: args[2])
)
print("\(result.status.rawValue)\t\(result.classification.rawValue)\t\(result.observedPageCount)")
exit(result.status == .pass ? 0 : 1)
