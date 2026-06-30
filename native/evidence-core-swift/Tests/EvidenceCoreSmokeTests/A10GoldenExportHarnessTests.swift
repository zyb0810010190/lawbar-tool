import XCTest
import Foundation
@testable import EvidenceCoreSmoke

// Tests for the A10 native golden-export gate (WI-EVIDENCE-A10-NATIVE-GOLDEN-EXPORT-HARNESS-00).
// They run the gate against the REAL A10-T6 apps-layer golden fixture (single source of truth — no copy in
// the Swift package), expecting PASS, and prove every failure class (integrity / shape / authority /
// semantic / fixture-invalid) is detected and is NEVER pass. The gate replaces the JS-shim `golden-export`
// `not_implemented`; `not_implemented` must NEVER be its result. It writes no marker and wires no pipeline.
final class A10GoldenExportHarnessTests: XCTestCase {
    // Resolve the apps-layer fixture by repo-relative path from this test file:
    // .../native/evidence-core-swift/Tests/EvidenceCoreSmokeTests/<this>.swift -> repo root (up 5) -> apps/...
    private var repoRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // EvidenceCoreSmokeTests
            .deletingLastPathComponent()   // Tests
            .deletingLastPathComponent()   // evidence-core-swift
            .deletingLastPathComponent()   // native
            .deletingLastPathComponent()   // repo root
    }
    private var goldenURL: URL {
        repoRoot.appendingPathComponent("apps/lawbar-desktop/tests/fixtures/a10-golden-canonical-export.json")
    }

    private func loadFixtureDict() throws -> [String: Any] {
        let data = try Data(contentsOf: goldenURL)
        return (try JSONSerialization.jsonObject(with: data)) as! [String: Any]
    }
    /// Re-encode a (possibly mutated) fixture dict to a temp file and run the gate against it.
    private func runOnDict(_ dict: [String: Any]) throws -> A10GoldenResult {
        let data = try JSONSerialization.data(withJSONObject: dict)
        let tmp = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("a10-golden-\(abs(dict.count &* 2654435761)).json")
        try data.write(to: tmp)
        defer { try? FileManager.default.removeItem(at: tmp) }
        return EvidenceCoreA10GoldenExport.run(fixtureURL: tmp)
    }

    // MARK: - End-to-end against the real apps-layer golden

    func testRealGoldenFixturePasses() {
        let r = EvidenceCoreA10GoldenExport.run(fixtureURL: goldenURL)
        XCTAssertEqual(r.status, .pass, "the committed A10-T6 golden must pass the native gate: \(r.detail)")
        XCTAssertEqual(r.classification, .ok)
        XCTAssertEqual(r.observedRowCount, 5) // the golden fixture has 5 links (3 clean + 2 degraded)
    }

    func testResultSchemaShape() {
        let r = EvidenceCoreA10GoldenExport.run(fixtureURL: goldenURL)
        XCTAssertEqual(r.orderedFields().map { $0.0 }, ["status", "classification", "observedRowCount", "isMarker", "detail"])
        XCTAssertEqual(r.orderedFields().first { $0.0 == "isMarker" }?.1, "false")
    }

    func testNotImplementedIsNeverTheResult() {
        let r = EvidenceCoreA10GoldenExport.run(fixtureURL: goldenURL)
        XCTAssertNotEqual(r.classification, .not_implemented, "the gate is real now; not_implemented must never be returned")
    }

    // MARK: - Failure classes are detected (never pass)

    func testMissingFixtureIsFixtureInvalid() {
        let r = EvidenceCoreA10GoldenExport.run(fixtureURL: repoRoot.appendingPathComponent("does-not-exist.json"))
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .fixture_or_oracle_invalid)
    }

    func testTamperedSerializationFailsIntegrity() throws {
        var d = try loadFixtureDict()
        let ser = d["expectedSerialization"] as! String
        // flip a citation page label inside the serialization without updating expectedSha256
        d["expectedSerialization"] = ser.replacingOccurrences(of: "卷2页6", with: "卷2页9")
        let r = try runOnDict(d)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .integrity_mismatch)
    }

    func testInjectedHrefFailsAuthority() throws {
        // Build a serialization with an internalHref and a matching hash so integrity passes but the
        // no-href-leak check must still fail (defense in depth).
        var d = try loadFixtureDict()
        let ser = (d["expectedSerialization"] as! String)
            .replacingOccurrences(of: "\"rows\":[", with: "\"rows\":[{\"internalHref\":\"lawbar://citation/doc1/0\",\"linkId\":\"L0\"},")
        d["expectedSerialization"] = ser
        d["expectedSha256"] = EvidenceCoreA10GoldenExport.sha256Hex(ser) // re-hash so integrity passes
        let r = try runOnDict(d)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .authority_violation)
    }

    func testInventedCanonicalModelVersionFailsShape() throws {
        var d = try loadFixtureDict()
        let ser = (d["expectedSerialization"] as! String)
            .replacingOccurrences(of: "{\"citationFormatVersion\"", with: "{\"canonicalModelVersion\":\"x\",\"citationFormatVersion\"")
        d["expectedSerialization"] = ser
        d["expectedSha256"] = EvidenceCoreA10GoldenExport.sha256Hex(ser)
        let r = try runOnDict(d)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .shape_mismatch)
    }

    func testNullSentinelRowFailsShape() throws {
        var d = try loadFixtureDict()
        // reintroduce a null-sentinel row (the pre-fix A10-T6 shape) — must be rejected
        let ser = (d["expectedSerialization"] as! String)
            .replacingOccurrences(of: "{\"flag\":\"BROKEN\",\"linkId\":\"L1\"}",
                                   with: "{\"citationText\":null,\"flag\":\"BROKEN\",\"linkId\":\"L1\"}")
        d["expectedSerialization"] = ser
        d["expectedSha256"] = EvidenceCoreA10GoldenExport.sha256Hex(ser)
        let r = try runOnDict(d)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .shape_mismatch)
    }

    func testRenderedRowMismatchFailsSemantic() throws {
        var d = try loadFixtureDict()
        // mutate a rendered citation's text so it no longer matches its row, keeping serialization+hash intact
        var rendered = d["rendered"] as! [[String: Any]]
        for i in rendered.indices {
            if (rendered[i]["linkId"] as? String) == "L3", var cit = rendered[i]["citation"] as? [String: Any] {
                cit["text"] = "卷9页9"
                rendered[i]["citation"] = cit
            }
        }
        d["rendered"] = rendered
        let r = try runOnDict(d)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .semantic_mismatch)
    }

    // MARK: - Determinism unit checks

    func testTopLevelKeyOrderIsCanonical() throws {
        let ser = try (loadFixtureDict()["expectedSerialization"] as! String)
        let keys = EvidenceCoreA10GoldenExport.topLevelKeyOrder(ser)
        XCTAssertEqual(keys, keys.sorted(), "top-level keys must be in canonical ascending order")
        XCTAssertTrue(keys.contains("rows") && keys.contains("citations") && keys.contains("flags"))
    }

    func testSha256IsStable() {
        let a = EvidenceCoreA10GoldenExport.sha256Hex("卷1页5")
        let b = EvidenceCoreA10GoldenExport.sha256Hex("卷1页5")
        XCTAssertEqual(a, b)
        XCTAssertEqual(a.count, 64)
    }

    func testSha256MatchesNistVectors() {
        // FIPS 180-4 known-answer vectors — proves the pure-Swift SHA-256 is correct, not just self-consistent.
        XCTAssertEqual(EvidenceCoreA10GoldenExport.sha256Hex(""),
                       "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        XCTAssertEqual(EvidenceCoreA10GoldenExport.sha256Hex("abc"),
                       "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        XCTAssertEqual(EvidenceCoreA10GoldenExport.sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
                       "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1")
    }

    // MARK: - False-green gaps closed (review-plan-mr0ntbv0)

    func testUnknownTopLevelKeyFailsShape() throws {
        var d = try loadFixtureDict()
        // inject a forbidden machine-path/renderer-metadata key (sorted in, re-hashed so integrity passes)
        let ser = (d["expectedSerialization"] as! String)
            .replacingOccurrences(of: "{\"citationFormatVersion\"",
                                   with: "{\"absMachinePath\":\"/Users/x\",\"citationFormatVersion\"")
        d["expectedSerialization"] = ser
        d["expectedSha256"] = EvidenceCoreA10GoldenExport.sha256Hex(ser)
        let r = try runOnDict(d)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .shape_mismatch)
    }

    func testDuplicateRowLinkIdFailsShape() throws {
        var d = try loadFixtureDict()
        // duplicate an existing row (L5) so rows contain a duplicate linkId, re-hash to pass integrity
        let ser = (d["expectedSerialization"] as! String)
            .replacingOccurrences(of: "{\"citationText\":\"卷3页12\",\"linkId\":\"L5\"}",
                                   with: "{\"citationText\":\"卷3页12\",\"linkId\":\"L5\"},{\"citationText\":\"卷3页12\",\"linkId\":\"L5\"}")
        d["expectedSerialization"] = ser
        d["expectedSha256"] = EvidenceCoreA10GoldenExport.sha256Hex(ser)
        let r = try runOnDict(d)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .shape_mismatch)
    }

    func testRenderedSetMismatchFailsSemantic() throws {
        var d = try loadFixtureDict()
        // rename a rendered linkId so the rendered set no longer equals the row set (count still matches)
        var rendered = d["rendered"] as! [[String: Any]]
        for i in rendered.indices where (rendered[i]["linkId"] as? String) == "L5" {
            rendered[i]["linkId"] = "L9"
        }
        d["rendered"] = rendered
        let r = try runOnDict(d)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .semantic_mismatch)
    }

    // MARK: - Whole-model semantic (review-plan-mr0nxqci): citations/linkDegradations/flags/sourceObjectIds

    func testStrippedCitationsArrayFailsSemantic() throws {
        var d = try loadFixtureDict()
        // empty out citations[] in the serialization (rows still match rendered), rehash so integrity passes
        let ser = (d["expectedSerialization"] as! String)
            .replacingOccurrences(of: "\"citations\":[{\"citationPageLabel\":\"6\",\"citationVolume\":\"2\",\"linkId\":\"L3\",\"text\":\"卷2页6\"},{\"citationPageLabel\":\"9\",\"citationVolume\":\"1\",\"linkId\":\"L4\",\"text\":\"卷1页9\"},{\"citationPageLabel\":\"12\",\"citationVolume\":\"3\",\"linkId\":\"L5\",\"text\":\"卷3页12\"}]",
                                   with: "\"citations\":[]")
        XCTAssertNotEqual(ser, d["expectedSerialization"] as! String, "citations slice must have matched")
        d["expectedSerialization"] = ser
        d["expectedSha256"] = EvidenceCoreA10GoldenExport.sha256Hex(ser)
        let r = try runOnDict(d)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .semantic_mismatch)
    }

    func testStrippedFlagsArrayFailsSemantic() throws {
        var d = try loadFixtureDict()
        let ser = (d["expectedSerialization"] as! String)
            .replacingOccurrences(of: "\"flags\":[\"BROKEN\",\"UNLINKED\"]", with: "\"flags\":[]")
        XCTAssertNotEqual(ser, d["expectedSerialization"] as! String, "flags slice must have matched")
        d["expectedSerialization"] = ser
        d["expectedSha256"] = EvidenceCoreA10GoldenExport.sha256Hex(ser)
        let r = try runOnDict(d)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .semantic_mismatch)
    }

    // MARK: - Exact cardinality + element-shape (review-plan-mr0o2co5): junk / duplicate / extra elements

    func testJunkCitationElementFailsSemantic() throws {
        var d = try loadFixtureDict()
        // append a junk element to citations[] (count now wrong + malformed shape), rehash to pass integrity
        let ser = (d["expectedSerialization"] as! String)
            .replacingOccurrences(of: "\"linkId\":\"L5\",\"text\":\"卷3页12\"}]",
                                   with: "\"linkId\":\"L5\",\"text\":\"卷3页12\"},{\"junk\":\"x\"}]")
        XCTAssertNotEqual(ser, d["expectedSerialization"] as! String, "junk-citation slice must have matched")
        d["expectedSerialization"] = ser
        d["expectedSha256"] = EvidenceCoreA10GoldenExport.sha256Hex(ser)
        let r = try runOnDict(d)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .semantic_mismatch)
    }

    func testDuplicateFlagFailsSemantic() throws {
        var d = try loadFixtureDict()
        // duplicate a flag entry (distinct-sorted contract violated), rehash to pass integrity
        let ser = (d["expectedSerialization"] as! String)
            .replacingOccurrences(of: "\"flags\":[\"BROKEN\",\"UNLINKED\"]",
                                   with: "\"flags\":[\"BROKEN\",\"BROKEN\",\"UNLINKED\"]")
        XCTAssertNotEqual(ser, d["expectedSerialization"] as! String, "dup-flag slice must have matched")
        d["expectedSerialization"] = ser
        d["expectedSha256"] = EvidenceCoreA10GoldenExport.sha256Hex(ser)
        let r = try runOnDict(d)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .semantic_mismatch)
    }

    func testExtraSourceObjectIdFailsSemantic() throws {
        var d = try loadFixtureDict()
        // add an unexpected sourceObjectId, rehash to pass integrity
        let ser = (d["expectedSerialization"] as! String)
            .replacingOccurrences(of: "\"sourceObjectIds\":[\"s-L1\",\"s-L2\",\"s-L3\",\"s-L4\",\"s-L5\"]",
                                   with: "\"sourceObjectIds\":[\"s-L1\",\"s-L2\",\"s-L3\",\"s-L4\",\"s-L5\",\"s-L9\"]")
        XCTAssertNotEqual(ser, d["expectedSerialization"] as! String, "src slice must have matched")
        d["expectedSerialization"] = ser
        d["expectedSha256"] = EvidenceCoreA10GoldenExport.sha256Hex(ser)
        let r = try runOnDict(d)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .semantic_mismatch)
    }

    // MARK: - Exact row key set + stable order (review-plan-mr0o6o6e)

    func testExtraRowKeyFailsAuthority() throws {
        var d = try loadFixtureDict()
        // inject a `debug` key into a clean row, rehash to pass integrity
        let ser = (d["expectedSerialization"] as! String)
            .replacingOccurrences(of: "{\"citationText\":\"卷2页6\",\"linkId\":\"L3\"}",
                                   with: "{\"citationText\":\"卷2页6\",\"debug\":\"x\",\"linkId\":\"L3\"}")
        XCTAssertNotEqual(ser, d["expectedSerialization"] as! String, "row-key slice must have matched")
        d["expectedSerialization"] = ser
        d["expectedSha256"] = EvidenceCoreA10GoldenExport.sha256Hex(ser)
        let r = try runOnDict(d)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .authority_violation)
    }

    func testUnorderedRowsFailShape() throws {
        var d = try loadFixtureDict()
        // swap rows L3 and L4 so the array is no longer linkId-ascending, rehash to pass integrity
        let ser = (d["expectedSerialization"] as! String)
            .replacingOccurrences(of: "{\"citationText\":\"卷2页6\",\"linkId\":\"L3\"},{\"citationText\":\"卷1页9\",\"linkId\":\"L4\"}",
                                   with: "{\"citationText\":\"卷1页9\",\"linkId\":\"L4\"},{\"citationText\":\"卷2页6\",\"linkId\":\"L3\"}")
        XCTAssertNotEqual(ser, d["expectedSerialization"] as! String, "row-order slice must have matched")
        d["expectedSerialization"] = ser
        d["expectedSha256"] = EvidenceCoreA10GoldenExport.sha256Hex(ser)
        let r = try runOnDict(d)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .shape_mismatch)
    }

    // MARK: - Scalar field types/values + recursive key order (review-plan-mr0ob3az)

    func testWrongTypeExportTypeFailsShape() throws {
        var d = try loadFixtureDict()
        // exportType as a number instead of a string, rehash to pass integrity
        let ser = (d["expectedSerialization"] as! String)
            .replacingOccurrences(of: "\"exportType\":\"evidence-index\"", with: "\"exportType\":5")
        XCTAssertNotEqual(ser, d["expectedSerialization"] as! String, "exportType slice must have matched")
        d["expectedSerialization"] = ser
        d["expectedSha256"] = EvidenceCoreA10GoldenExport.sha256Hex(ser)
        let r = try runOnDict(d)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .shape_mismatch)
    }

    func testWrongVersionStringFailsShape() throws {
        var d = try loadFixtureDict()
        let ser = (d["expectedSerialization"] as! String)
            .replacingOccurrences(of: "\"citationFormatVersion\":\"a10.citation.v1\"",
                                   with: "\"citationFormatVersion\":\"a10.citation.v2\"")
        XCTAssertNotEqual(ser, d["expectedSerialization"] as! String, "version slice must have matched")
        d["expectedSerialization"] = ser
        d["expectedSha256"] = EvidenceCoreA10GoldenExport.sha256Hex(ser)
        let r = try runOnDict(d)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .shape_mismatch)
    }

    func testNestedNonCanonicalKeyOrderFailsShape() throws {
        var d = try loadFixtureDict()
        // a degraded row's keys out of canonical order ({linkId,flag} instead of {flag,linkId}), rehash
        let ser = (d["expectedSerialization"] as! String)
            .replacingOccurrences(of: "{\"flag\":\"BROKEN\",\"linkId\":\"L1\"}",
                                   with: "{\"linkId\":\"L1\",\"flag\":\"BROKEN\"}")
        XCTAssertNotEqual(ser, d["expectedSerialization"] as! String, "nested-order slice must have matched")
        d["expectedSerialization"] = ser
        d["expectedSha256"] = EvidenceCoreA10GoldenExport.sha256Hex(ser)
        let r = try runOnDict(d)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .shape_mismatch)
    }

    func testRecursiveKeysSortedUnitChecks() {
        XCTAssertTrue(EvidenceCoreA10GoldenExport.recursiveKeysSorted("{\"a\":1,\"b\":{\"x\":1,\"y\":2},\"c\":[{\"m\":1,\"n\":2}]}"))
        XCTAssertFalse(EvidenceCoreA10GoldenExport.recursiveKeysSorted("{\"b\":1,\"a\":2}"))           // top-level
        XCTAssertFalse(EvidenceCoreA10GoldenExport.recursiveKeysSorted("{\"a\":{\"y\":1,\"x\":2}}"))   // nested
    }

    // MARK: - A10-T1 citation-identity invariant + case-insensitive href scan (audit-mr0oi6gh)

    func testCitationTextNot卷页FailsAuthority() throws {
        var d = try loadFixtureDict()
        // change L3's citation text to arbitrary (no longer 卷2页6) in BOTH the serialization and rendered,
        // then rehash so integrity passes — only the 卷X页Y invariant should catch it.
        let ser = (d["expectedSerialization"] as! String)
            .replacingOccurrences(of: "{\"citationPageLabel\":\"6\",\"citationVolume\":\"2\",\"linkId\":\"L3\",\"text\":\"卷2页6\"}",
                                   with: "{\"citationPageLabel\":\"6\",\"citationVolume\":\"2\",\"linkId\":\"L3\",\"text\":\"tampered\"}")
            .replacingOccurrences(of: "{\"citationText\":\"卷2页6\",\"linkId\":\"L3\"}",
                                   with: "{\"citationText\":\"tampered\",\"linkId\":\"L3\"}")
        XCTAssertNotEqual(ser, d["expectedSerialization"] as! String, "citation-text slice must have matched")
        d["expectedSerialization"] = ser
        d["expectedSha256"] = EvidenceCoreA10GoldenExport.sha256Hex(ser)
        var rendered = d["rendered"] as! [[String: Any]]
        for i in rendered.indices where (rendered[i]["linkId"] as? String) == "L3" {
            var cit = rendered[i]["citation"] as! [String: Any]; cit["text"] = "tampered"; rendered[i]["citation"] = cit
        }
        d["rendered"] = rendered
        let r = try runOnDict(d)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .authority_violation)
    }

    func testUppercaseSchemeLeakFailsAuthority() throws {
        var d = try loadFixtureDict()
        // inject an uppercase-scheme URL into a warning string, rehash so integrity passes
        let ser = (d["expectedSerialization"] as! String)
            .replacingOccurrences(of: "\"warnings\":[", with: "\"warnings\":[\"HTTP://evil/x\",")
        XCTAssertNotEqual(ser, d["expectedSerialization"] as! String, "warning slice must have matched")
        d["expectedSerialization"] = ser
        d["expectedSha256"] = EvidenceCoreA10GoldenExport.sha256Hex(ser)
        let r = try runOnDict(d)
        XCTAssertEqual(r.status, .fail)
        XCTAssertEqual(r.classification, .authority_violation)
    }
}
