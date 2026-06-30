// A3AnchorRegressionHarness.swift — Evidence Core Swift: A3-T10 anchor-resolution regression GATE
// (WI-EVIDENCE-A3-T10-ANCHOR-REGRESSION-GATE-00).
//
// A3-T10 per docs/reference/evidence-genie-m0-developer-handover.md (§A3 line 137; §8 line 103):
// "Regression suite · reopen/freeze identical; quarantine scenarios." This harness covers the
// DATA-RESOLUTION regression SLICE of A3-T10: it replays the link-status resolver over synthetic
// anchor/link/document/geometry data and proves the resolved LinkStatus is deterministic + byte-identical
// across fixture reload (the "reopen-identical" property at the data layer). It is NOT PDF geometry
// capture (A0.7) and NOT the actual A8 restore pipeline — it must not overclaim beyond deterministic
// replay over the committed fixture.
//
// A3 anchor resolution (LinkStatus valid|needs_review|broken + the V12 durable `unlinked_at` marker) is
// DATA-driven — independent of PDF geometry, A8 snapshot, and A10 export/CanonicalExportModel (A8.6
// DEPENDS on A3-T10, not the reverse). The harness READS a committed synthetic fixture (JSON) + a
// committed INDEPENDENT oracle (expected per-link {status, unlinked} authored from the fixture's KNOWN
// construction, NOT back-filled — A07-GATE-00 §3 oracle-independence applied to A3), classifies each link
// by the REPLICATED resolver ladder, and emits a deterministic classified verdict. It writes NO marker,
// touches NO dev-memo/run/evidence/**, creates NO provenance/HMAC, and changes NO A3 runtime.
//
// DRIFT GUARD: the ladder MUST match the built resolver in
// services/case-box-persistence/src/sqlite/linkStatusResolverQueries.ts (the SQL CASE):
//   (0) unlinked_at present                 -> broken   (V12 durable explicit-unlink; A3-UNLINK-SCHEMA-00 §6)
//   (1) missing anchor target               -> broken
//   (2) missing V9 page identity            -> broken
//   (3) missing V10 geometry record         -> broken
//   (4) anchor.geometry_captured_at <> current page geometry captured_at -> needs_review (INV-A3-6)
//   (5) anchor's document superseded        -> needs_review  (another document's supersedesDocumentId == it)
//   (6) else                                -> valid
// `broken` for both explicit-unlink and structural breakage; the separate `unlinked` flag carries the
// lifecycle/audit distinction (mirrors export's UNLINKED). Tests pin each rung + combined precedence.
//
// NOTE: this is the NATIVE Swift gate. The JS deterministic-JSON shim (native/evidence-core/**) is
// intentionally UNCHANGED and still reports `not_implemented` until a separate wiring WI (A07-GATE-00 §6).
// `not_implemented` is a FAIL, never a pass; `inconclusive` and a malformed fixture/oracle are NOT pass.

import Foundation

public enum A3RegressionStatus: String, Equatable {
    case pass
    case fail
    case inconclusive
}

public enum A3RegressionClassification: String, Equatable {
    case ok
    /// A derived per-link {status, unlinked} disagrees with the oracle.
    case resolution_mismatch
    case fixture_or_oracle_invalid
    case not_implemented
    case inconclusive_no_checkable_assertions
}

/// The three computed resolver statuses (matches services/.../linkStatusResolverQueries.ts ResolvedLinkStatus).
public enum A3LinkStatus: String, Equatable {
    case valid
    case needs_review
    case broken
}

public struct A3RegressionResult: Equatable {
    public let status: A3RegressionStatus
    public let classification: A3RegressionClassification
    public let observedLinkCount: Int
    public let detail: String

    public func orderedFields() -> [(String, String)] {
        [
            ("status", status.rawValue),
            ("classification", classification.rawValue),
            ("observedLinkCount", String(observedLinkCount)),
            ("isMarker", "false"),
            ("detail", detail),
        ]
    }
}

// MARK: - Fixture (synthetic anchor/link resolution state) + Oracle (decoded from disk; NOT hardcoded)

struct A3Fixture: Decodable {
    struct Document: Decodable {
        let id: String
        /// If set, THIS document supersedes `supersedesDocumentId` — so that target document is superseded
        /// (reverse lookup, matching the built resolver). Does NOT mean this document is superseded.
        let supersedesDocumentId: String?
    }
    struct Page: Decodable { let documentId: String; let physicalPageIndex: Int }
    struct Geometry: Decodable { let documentId: String; let physicalPageIndex: Int; let capturedAt: String }
    struct Anchor: Decodable {
        let anchorId: String
        let documentId: String
        let physicalPageIndex: Int
        let geometryCapturedAt: String
    }
    struct Link: Decodable { let linkId: String; let anchorId: String; let unlinkedAt: String? }
    let documents: [Document]
    let pages: [Page]
    let geometries: [Geometry]
    let anchors: [Anchor]
    let links: [Link]
}

struct A3Oracle: Decodable {
    struct Expected: Decodable { let linkId: String; let status: String; let unlinked: Bool }
    let expected: [Expected]
    var hasCheckableAssertions: Bool { !expected.isEmpty }
}

struct A3ResolvedLink: Equatable {
    let linkId: String
    let status: A3LinkStatus
    let unlinked: Bool
}

public enum EvidenceCoreA3Regression {
    /// Pure, deterministic resolution of every link from the fixture ALONE — the REPLICATED resolver
    /// ladder. No IO, no machine paths, no timestamps, no locale. Ordering canonical: by linkId.
    static func resolve(_ fx: A3Fixture) -> [A3ResolvedLink] {
        let pageKeys = Set(fx.pages.map { "\($0.documentId)\u{1F}\($0.physicalPageIndex)" })
        var geomByKey: [String: String] = [:] // (documentId,physicalPageIndex) -> current captured_at
        for g in fx.geometries { geomByKey["\(g.documentId)\u{1F}\(g.physicalPageIndex)"] = g.capturedAt }
        let anchorById: [String: A3Fixture.Anchor] = Dictionary(uniqueKeysWithValues: fx.anchors.map { ($0.anchorId, $0) })
        // A document is SUPERSEDED iff another document's supersedesDocumentId points at it (reverse lookup).
        let supersededIds = Set(fx.documents.compactMap { $0.supersedesDocumentId })

        var out: [A3ResolvedLink] = []
        for link in fx.links {
            let unlinked = link.unlinkedAt != nil
            let status: A3LinkStatus
            if unlinked {
                status = .broken                                   // rung 0
            } else if let a = anchorById[link.anchorId] {
                let pageKey = "\(a.documentId)\u{1F}\(a.physicalPageIndex)"
                if !pageKeys.contains(pageKey) {
                    status = .broken                               // rung 2 (missing V9 page)
                } else if let cur = geomByKey[pageKey] {
                    if a.geometryCapturedAt != cur {
                        status = .needs_review                     // rung 4 (geometry version mismatch)
                    } else if supersededIds.contains(a.documentId) {
                        status = .needs_review                     // rung 5 (document superseded)
                    } else {
                        status = .valid                            // rung 6
                    }
                } else {
                    status = .broken                               // rung 3 (missing V10 geometry)
                }
            } else {
                status = .broken                                   // rung 1 (missing anchor target)
            }
            out.append(.init(linkId: link.linkId, status: status, unlinked: unlinked))
        }
        out.sort { $0.linkId < $1.linkId }
        return out
    }

    /// Byte-stable serialization of the resolved link set — the "anchor resolution" whose byte-identity
    /// across reopen/replay A3-T10 protects. Fixture-derived data only.
    static func serialize(_ resolved: [A3ResolvedLink]) -> String {
        resolved.map { "\($0.linkId)\u{1F}\($0.status.rawValue)\u{1F}\($0.unlinked ? "unlinked" : "linked")" }
            .joined(separator: "\n")
    }

    public static func run(fixtureURL: URL, oracleURL: URL) -> A3RegressionResult {
        guard fixtureURL.isFileURL, oracleURL.isFileURL else {
            return A3RegressionResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                      observedLinkCount: 0, detail: "fixture and oracle must be local file URLs (offline harness)")
        }
        guard let fxData = try? Data(contentsOf: fixtureURL),
              let fixture = try? JSONDecoder().decode(A3Fixture.self, from: fxData) else {
            return A3RegressionResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                      observedLinkCount: 0, detail: "fixture missing or undecodable at \(fixtureURL.lastPathComponent)")
        }
        guard let orData = try? Data(contentsOf: oracleURL),
              let oracle = try? JSONDecoder().decode(A3Oracle.self, from: orData) else {
            return A3RegressionResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                      observedLinkCount: 0, detail: "oracle missing or undecodable at \(oracleURL.lastPathComponent)")
        }
        return evaluate(fixture: fixture, oracle: oracle)
    }

    /// Pure classifier (no IO). Resolves twice, requires byte-identical serialization (reopen/replay
    /// stability), then compares every link's {status, unlinked} to the oracle.
    static func evaluate(fixture: A3Fixture, oracle: A3Oracle) -> A3RegressionResult {
        if !oracle.hasCheckableAssertions {
            return A3RegressionResult(status: .inconclusive, classification: .inconclusive_no_checkable_assertions,
                                      observedLinkCount: fixture.links.count,
                                      detail: "oracle defines no checkable link assertions; inconclusive (not pass)")
        }
        let r1 = resolve(fixture)
        let r2 = resolve(fixture)
        if serialize(r1) != serialize(r2) {
            return A3RegressionResult(status: .fail, classification: .resolution_mismatch,
                                      observedLinkCount: fixture.links.count,
                                      detail: "non-deterministic resolution: two runs differ")
        }
        let byId: [String: A3ResolvedLink] = Dictionary(uniqueKeysWithValues: r1.map { ($0.linkId, $0) })

        // Oracle COMPLETENESS (no false green from a truncated oracle): the oracle MUST cover EXACTLY the
        // resolved link set — every resolved link has an expectation, every expectation names a real link,
        // and no oracle link-id is duplicated. A partial/mismatched oracle is fixture_or_oracle_invalid, NOT
        // pass (audit-mr06winp-3vxzl7 Medium).
        let resolvedIds = Set(byId.keys)
        let oracleIds = Set(oracle.expected.map { $0.linkId })
        if oracle.expected.count != oracleIds.count {
            return A3RegressionResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                      observedLinkCount: fixture.links.count,
                                      detail: "oracle has duplicate link-id entries")
        }
        if resolvedIds != oracleIds {
            let missing = resolvedIds.subtracting(oracleIds).sorted()
            let extra = oracleIds.subtracting(resolvedIds).sorted()
            return A3RegressionResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                      observedLinkCount: fixture.links.count,
                                      detail: "oracle does not cover the resolved link set exactly (missing: \(missing); unknown: \(extra))")
        }

        for exp in oracle.expected {
            guard let obs = byId[exp.linkId] else {
                return A3RegressionResult(status: .fail, classification: .resolution_mismatch,
                                          observedLinkCount: fixture.links.count,
                                          detail: "oracle link \(exp.linkId) not present in resolved set")
            }
            if obs.status.rawValue != exp.status || obs.unlinked != exp.unlinked {
                return A3RegressionResult(status: .fail, classification: .resolution_mismatch,
                                          observedLinkCount: fixture.links.count,
                                          detail: "link \(exp.linkId) observed {\(obs.status.rawValue),unlinked=\(obs.unlinked)} != oracle {\(exp.status),unlinked=\(exp.unlinked)}")
            }
        }
        return A3RegressionResult(status: .pass, classification: .ok,
                                  observedLinkCount: fixture.links.count,
                                  detail: "all \(oracle.expected.count) oracle link assertions matched; resolution byte-stable across runs")
    }
}
