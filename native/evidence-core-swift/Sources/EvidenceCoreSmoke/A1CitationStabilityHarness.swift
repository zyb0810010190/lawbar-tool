// A1CitationStabilityHarness.swift — Evidence Core Swift: A1-T6 citation-stability GATE
// (WI-EVIDENCE-A1-T6-CITATION-STABILITY-GATE-00).
//
// A1-T6 per docs/reference/evidence-genie-m0-developer-handover.md (§A1 line 120; §8 CI gate):
// "Citation-stability gate · citation identity · byte-identical across close/reopen/export; only from
// DocumentPage." A1 citation identity derives SOLELY from DocumentPage DATA
// ({documentId, physicalPageIndex, citationVolume?, citationPageLabel?, citationPageSortKey?, isCitable})
// — never from PDF geometry, never page-index arithmetic, never an OptimizedDocumentRendition, never the
// A10 CanonicalExportModel (A10-T1 LATER wraps this primitive into the single export contract; this gate
// is the lower-level citation-identity primitive).
//
// The harness READS a committed DocumentPage citation-map fixture (JSON) + a committed INDEPENDENT oracle
// (expected per-page outcomes derived from the fixture's KNOWN construction, NOT back-filled from harness
// output — A07-GATE-00 §3 oracle-independence applied to A1), derives each page's citation deterministically
// from DocumentPage ONLY, compares to the oracle, and emits a deterministic classified verdict. It writes
// NO marker, touches NO dev-memo/run/evidence/**, creates NO provenance/HMAC, and adds NO export/anchor/UI.
//
// DRIFT GUARD: the rendering + classification MUST match the BUILT TS contract in
// services/case-box-persistence/src/sqlite/exportCitationQueries.ts (readCitationIdentity + ambiguity +
// `卷${citationVolume}页${citationPageLabel}`). A golden test asserts `卷1页5` + the same non-citable /
// ambiguity behavior. The handover/ADR remain the single FORMAT authority; A10-T1 is the future production
// single source.
//
// NOTE: this is the NATIVE Swift gate. The JS deterministic-JSON shim (native/evidence-core/**) is
// intentionally UNCHANGED and still reports `not_implemented` until a separate wiring WI (A07-GATE-00 §6).
// `not_implemented` is a FAIL, never a pass; `inconclusive` and a malformed fixture/oracle are NOT pass.

import Foundation

public enum A1CitationStatus: String, Equatable {
    case pass
    case fail
    case inconclusive
}

public enum A1CitationClassification: String, Equatable {
    /// Pass — every checkable oracle page outcome observed identically.
    case ok
    /// A derived per-page outcome (clean text / non_citable / ambiguous) disagrees with the oracle.
    case citation_mismatch
    /// The fixture failed to load/parse, or the oracle failed to decode / is malformed.
    case fixture_or_oracle_invalid
    /// The harness could not execute. Per the gate contract this is a FAIL.
    case not_implemented
    /// The oracle defines no checkable page assertions; inconclusive is NOT pass.
    case inconclusive_no_checkable_assertions
}

/// One page's citation outcome — the deterministic, machine-state-independent A1 derivation.
public enum A1PageOutcome: String, Equatable {
    case clean        // a citable page: rendered 卷X页Y
    case non_citable  // isCitable=false, or missing/empty citationVolume/citationPageLabel
    case ambiguous    // (citationVolume, citationPageLabel) maps to >1 physical page in document scope
}

public struct A1CitationResult: Equatable {
    public let status: A1CitationStatus
    public let classification: A1CitationClassification
    public let observedPageCount: Int
    public let detail: String

    public func orderedFields() -> [(String, String)] {
        [
            ("status", status.rawValue),
            ("classification", classification.rawValue),
            ("observedPageCount", String(observedPageCount)),
            ("isMarker", "false"),
            ("detail", detail),
        ]
    }
}

// MARK: - Fixture (DocumentPage citation map) + Oracle (decoded from disk; NOT hardcoded here)

/// A committed DocumentPage citation-map fixture. Mirrors the DocumentPage citation fields only — no
/// geometry, no anchors, no links (those are A0.7/A3 concerns).
struct A1Fixture: Decodable {
    struct Page: Decodable {
        let documentId: String
        let physicalPageIndex: Int
        let citationVolume: String?
        let citationPageLabel: String?
        let citationPageSortKey: Int?
        let isCitable: Bool?
    }
    let pages: [Page]
}

struct A1Oracle: Decodable {
    struct Expected: Decodable {
        let documentId: String
        let physicalPageIndex: Int
        let outcome: String        // "clean" | "non_citable" | "ambiguous"
        let text: String?          // 卷X页Y, required iff outcome == clean
    }
    let expected: [Expected]
    var hasCheckableAssertions: Bool { !expected.isEmpty }
}

// MARK: - Derived per-page citation (the deterministic A1 output)

struct A1DerivedPage: Equatable {
    let documentId: String
    let physicalPageIndex: Int
    let sortKey: Int
    let outcome: A1PageOutcome
    let text: String? // 卷X页Y iff outcome == clean
}

public enum EvidenceCoreA1CitationGate {
    /// Citation identity from DocumentPage ONLY — mirrors the TS readCitationIdentity contract:
    /// isCitable==false -> nil; citationVolume/citationPageLabel must be non-empty (trimmed) strings.
    static func citationIdentity(_ p: A1Fixture.Page) -> (vol: String, label: String)? {
        if p.isCitable == false { return nil }
        guard let vol = p.citationVolume, let label = p.citationPageLabel else { return nil }
        if vol.trimmingCharacters(in: .whitespaces).isEmpty { return nil }
        if label.trimmingCharacters(in: .whitespaces).isEmpty { return nil }
        return (vol, label)
    }

    /// Pure, deterministic derivation of every page's citation outcome from the fixture ALONE.
    /// No IO, no machine paths, no timestamps, no locale, no renderer metadata. Ordering is canonical:
    /// (documentId, sortKey, physicalPageIndex). Ambiguity is per-document (citationVolume,citationPageLabel)
    /// occurrence > 1 — matching the TS contract.
    static func derive(_ fixture: A1Fixture) -> [A1DerivedPage] {
        // Per-document label-occurrence counts over citable pages (the A1 ambiguity scope).
        var labelCountByDoc: [String: [String: Int]] = [:]
        for p in fixture.pages {
            if let id = citationIdentity(p) {
                let key = "\(id.vol)\u{1F}\(id.label)"
                labelCountByDoc[p.documentId, default: [:]][key, default: 0] += 1
            }
        }
        var derived: [A1DerivedPage] = []
        for p in fixture.pages {
            let sortKey = p.citationPageSortKey ?? p.physicalPageIndex
            guard let id = citationIdentity(p) else {
                derived.append(.init(documentId: p.documentId, physicalPageIndex: p.physicalPageIndex,
                                     sortKey: sortKey, outcome: .non_citable, text: nil))
                continue
            }
            let key = "\(id.vol)\u{1F}\(id.label)"
            let occ = labelCountByDoc[p.documentId]?[key] ?? 0
            if occ > 1 {
                derived.append(.init(documentId: p.documentId, physicalPageIndex: p.physicalPageIndex,
                                     sortKey: sortKey, outcome: .ambiguous, text: nil))
            } else {
                derived.append(.init(documentId: p.documentId, physicalPageIndex: p.physicalPageIndex,
                                     sortKey: sortKey, outcome: .clean, text: "卷\(id.vol)页\(id.label)"))
            }
        }
        // Canonical deterministic ordering.
        derived.sort {
            if $0.documentId != $1.documentId { return $0.documentId < $1.documentId }
            if $0.sortKey != $1.sortKey { return $0.sortKey < $1.sortKey }
            return $0.physicalPageIndex < $1.physicalPageIndex
        }
        return derived
    }

    /// Byte-stable serialization of the derived citation map. This is the "citation identity" whose
    /// byte-identity across close/reopen/export A1-T6 protects. Contains ONLY fixture-derived data.
    static func serialize(_ derived: [A1DerivedPage]) -> String {
        derived.map { "\($0.documentId)\u{1F}\($0.physicalPageIndex)\u{1F}\($0.outcome.rawValue)\u{1F}\($0.text ?? "")" }
            .joined(separator: "\n")
    }

    /// Run the gate: load the fixture + oracle from disk, derive, compare to the oracle, classify.
    public static func run(fixtureURL: URL, oracleURL: URL) -> A1CitationResult {
        // Offline invariant: local file URLs only (no network I/O).
        guard fixtureURL.isFileURL, oracleURL.isFileURL else {
            return A1CitationResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                    observedPageCount: 0,
                                    detail: "fixture and oracle must be local file URLs (offline harness)")
        }
        guard let fxData = try? Data(contentsOf: fixtureURL),
              let fixture = try? JSONDecoder().decode(A1Fixture.self, from: fxData) else {
            return A1CitationResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                    observedPageCount: 0,
                                    detail: "fixture missing or undecodable at \(fixtureURL.lastPathComponent)")
        }
        guard let orData = try? Data(contentsOf: oracleURL),
              let oracle = try? JSONDecoder().decode(A1Oracle.self, from: orData) else {
            return A1CitationResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                    observedPageCount: 0,
                                    detail: "oracle missing or undecodable at \(oracleURL.lastPathComponent)")
        }
        return evaluate(fixture: fixture, oracle: oracle)
    }

    /// Pure classifier (no IO). Derives twice and requires byte-identical serialization (intra-run
    /// stability), then compares every page's outcome/text to the oracle.
    static func evaluate(fixture: A1Fixture, oracle: A1Oracle) -> A1CitationResult {
        if !oracle.hasCheckableAssertions {
            return A1CitationResult(status: .inconclusive, classification: .inconclusive_no_checkable_assertions,
                                    observedPageCount: fixture.pages.count,
                                    detail: "oracle defines no checkable page assertions; inconclusive (not pass)")
        }

        // Determinism: two independent derivations must serialize byte-identically.
        let d1 = derive(fixture)
        let d2 = derive(fixture)
        if serialize(d1) != serialize(d2) {
            return A1CitationResult(status: .fail, classification: .citation_mismatch,
                                    observedPageCount: fixture.pages.count,
                                    detail: "non-deterministic derivation: two runs differ")
        }

        let byKey: [String: A1DerivedPage] = Dictionary(uniqueKeysWithValues:
            d1.map { ("\($0.documentId)\u{1F}\($0.physicalPageIndex)", $0) })

        func key(_ e: A1Oracle.Expected) -> String { "\(e.documentId)\u{1F}\(e.physicalPageIndex)" }
        func invalid(_ detail: String) -> A1CitationResult {
            A1CitationResult(status: .fail, classification: .fixture_or_oracle_invalid,
                             observedPageCount: fixture.pages.count, detail: detail)
        }

        // A1T6-AUD-L1 (oracle-ROW validity): each expected row MUST name a known outcome and carry `text`
        // IFF outcome == clean — a non-clean row (`non_citable`/`ambiguous`) with a stray `text`, or a clean
        // row missing its 卷X页Y `text`, is a malformed oracle, NOT a checkable assertion.
        let validOutcomes: Set<String> = ["clean", "non_citable", "ambiguous"]
        for exp in oracle.expected {
            if !validOutcomes.contains(exp.outcome) {
                return invalid("oracle page \(key(exp)) has unknown outcome '\(exp.outcome)'")
            }
            if exp.outcome == "clean" {
                if (exp.text ?? "").isEmpty {
                    return invalid("oracle page \(key(exp)) outcome=clean must carry a non-empty text")
                }
            } else if exp.text != nil {
                return invalid("oracle page \(key(exp)) outcome=\(exp.outcome) must NOT carry a text")
            }
        }

        // A1T6-AUD-L1 (oracle COMPLETENESS): the oracle MUST cover EXACTLY the derived page set — no
        // duplicate keys, every derived page has an expectation, and no expectation names a non-derived page.
        // A partial / over-covering / duplicate oracle is `fixture_or_oracle_invalid`, never a false green.
        let oracleKeys = oracle.expected.map(key)
        if Set(oracleKeys).count != oracleKeys.count {
            return invalid("oracle contains a duplicate page key")
        }
        if Set(oracleKeys) != Set(byKey.keys) {
            return invalid("oracle page set != derived page set (oracle must cover exactly every derived page)")
        }

        for exp in oracle.expected {
            let k = "\(exp.documentId)\u{1F}\(exp.physicalPageIndex)"
            guard let obs = byKey[k] else {
                return A1CitationResult(status: .fail, classification: .citation_mismatch,
                                        observedPageCount: fixture.pages.count,
                                        detail: "oracle page \(k) not present in derived map")
            }
            guard obs.outcome.rawValue == exp.outcome else {
                return A1CitationResult(status: .fail, classification: .citation_mismatch,
                                        observedPageCount: fixture.pages.count,
                                        detail: "page \(k) outcome observed \(obs.outcome.rawValue) != oracle \(exp.outcome)")
            }
            if exp.outcome == "clean" {
                if obs.text != exp.text {
                    return A1CitationResult(status: .fail, classification: .citation_mismatch,
                                            observedPageCount: fixture.pages.count,
                                            detail: "page \(k) citation observed \(obs.text ?? "nil") != oracle \(exp.text ?? "nil")")
                }
            }
        }

        return A1CitationResult(status: .pass, classification: .ok,
                                observedPageCount: fixture.pages.count,
                                detail: "all \(oracle.expected.count) oracle page assertions matched; derivation byte-stable across runs")
    }
}
