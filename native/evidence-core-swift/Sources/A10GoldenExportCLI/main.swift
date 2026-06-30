// main.swift — a10-golden-export-cli (WI-EVIDENCE-A10-NATIVE-GOLDEN-EXPORT-HARNESS-00). Thin CLI over
// EvidenceCoreA10GoldenExport so the `golden-export` gate has a single source of truth. Mirrors
// a3-regression-cli / a1-citation-stability-cli / a07-harness-cli.
//
// Usage: a10-golden-export-cli <a10-golden-canonical-export.json>
// Prints one tab-separated line: "<status>\t<classification>\t<observedRowCount>". Exit 0 iff pass.
// Writes NO marker; performs no provenance/HMAC; reads only the local golden fixture (offline).

import Foundation
import EvidenceCoreSmoke

let args = CommandLine.arguments
guard args.count == 2 else {
    FileHandle.standardError.write(Data("usage: a10-golden-export-cli <golden-canonical-export.json>\n".utf8))
    exit(2)
}
let result = EvidenceCoreA10GoldenExport.run(fixtureURL: URL(fileURLWithPath: args[1]))
print("\(result.status.rawValue)\t\(result.classification.rawValue)\t\(result.observedRowCount)")
exit(result.status == .pass ? 0 : 1)
