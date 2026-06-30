// main.swift — a3-regression-cli (WI-EVIDENCE-A3-T10-ANCHOR-REGRESSION-GATE-00). Thin CLI over
// EvidenceCoreA3Regression so the gate has a single source of truth. Mirrors a07-harness-cli /
// a1-citation-stability-cli.
//
// Usage: a3-regression-cli <fixture.json> <oracle.json>
// Prints one tab-separated line: "<status>\t<classification>\t<observedLinkCount>". Exit 0 iff pass.
// Writes NO marker; performs no provenance/HMAC.

import Foundation
import EvidenceCoreSmoke

let args = CommandLine.arguments
guard args.count == 3 else {
    FileHandle.standardError.write(Data("usage: a3-regression-cli <fixture.json> <oracle.json>\n".utf8))
    exit(2)
}
let result = EvidenceCoreA3Regression.run(
    fixtureURL: URL(fileURLWithPath: args[1]),
    oracleURL: URL(fileURLWithPath: args[2])
)
print("\(result.status.rawValue)\t\(result.classification.rawValue)\t\(result.observedLinkCount)")
exit(result.status == .pass ? 0 : 1)
