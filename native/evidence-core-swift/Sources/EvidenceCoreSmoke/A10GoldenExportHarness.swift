// A10GoldenExportHarness.swift — the REAL native `golden-export` gate
// (WI-EVIDENCE-A10-NATIVE-GOLDEN-EXPORT-HARNESS-00). Mirrors EvidenceCoreA3Regression /
// EvidenceCoreA1CitationGate: a deterministic, offline, single-source-of-truth classifier with a stable
// result vocabulary and a thin CLI on top (a10-golden-export-cli).
//
// It is a TRUTHFUL gate, not a placeholder: it replaces the JS-shim `golden-export` `not_implemented` with a
// real check AGAINST the existing A10-T6 apps-layer golden artifact
// (apps/lawbar-desktop/tests/fixtures/a10-golden-canonical-export.json). It does NOT re-implement the
// apps-layer serializer (that would be a second source of truth), does NOT wire any live export pipeline,
// and does NOT render `.docx`/PDF. It validates that the committed golden is loadable, internally
// consistent (SHA-256 of its own serialization matches its claimed hash), shape-faithful to the ADR §4
// CanonicalExportModel, semantically consistent with its `rendered` input, and free of any href / nav
// metadata. `not_implemented` is NEVER its result; `inconclusive` and a malformed fixture are NOT pass.

import Foundation

public enum A10GoldenStatus: String, Equatable {
    case pass
    case fail
    case inconclusive
}

public enum A10GoldenClassification: String, Equatable {
    case ok
    case integrity_mismatch            // SHA-256(expectedSerialization) != expectedSha256
    case shape_mismatch                // serialization violates the ADR §4 CanonicalExportModel contract
    case authority_violation           // a row is not text-XOR-flag, or href / nav metadata is present
    case semantic_mismatch             // rows are not consistent with the `rendered` input
    case fixture_or_oracle_invalid     // golden fixture missing / unparseable
    case not_implemented               // retained for vocabulary parity; MUST NEVER be returned now
    case inconclusive_no_checkable_assertions
}

public struct A10GoldenResult: Equatable {
    public let status: A10GoldenStatus
    public let classification: A10GoldenClassification
    public let observedRowCount: Int
    public let detail: String

    public func orderedFields() -> [(String, String)] {
        [
            ("status", status.rawValue),
            ("classification", classification.rawValue),
            ("observedRowCount", String(observedRowCount)),
            ("isMarker", "false"),
            ("detail", detail),
        ]
    }
}

/// The slice of the golden fixture this gate reads. Mirrors the apps-layer A10-T6 fixture file: the locked
/// serialization + its hash, plus the `rendered` A10-T1 citations the model was built from (for semantic
/// cross-checks). Extra fixture keys are ignored.
struct A10GoldenFixture: Decodable {
    struct Citation: Decodable {
        let citationVolume: String
        let citationPageLabel: String
        let text: String
    }
    struct Rendered: Decodable {
        let linkId: String
        let sourceId: String
        let flag: String?
        let citation: Citation?
    }
    let expectedSerialization: String
    let expectedSha256: String
    let rendered: [Rendered]
    let warnings: [String]?
}

public enum EvidenceCoreA10GoldenExport {
    /// Dangerous schemes / nav metadata that MUST NEVER appear in the canonical court-fileable serialization.
    /// Lowercase — matched against a case-folded copy of the serialization (URL schemes are case-insensitive).
    static let forbiddenSubstrings = [
        "lawbar:", "http:", "https:", "javascript:", "data:", "file:", "mailto:", "vbscript:",
        "internalhref", "\"href\"",
    ]

    public static func run(fixtureURL: URL) -> A10GoldenResult {
        guard fixtureURL.isFileURL else {
            return A10GoldenResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                   observedRowCount: 0, detail: "golden fixture must be a local file URL (offline harness)")
        }
        guard let data = try? Data(contentsOf: fixtureURL),
              let fixture = try? JSONDecoder().decode(A10GoldenFixture.self, from: data) else {
            return A10GoldenResult(status: .fail, classification: .fixture_or_oracle_invalid,
                                   observedRowCount: 0, detail: "golden fixture missing or undecodable at \(fixtureURL.lastPathComponent)")
        }
        return evaluate(fixture)
    }

    /// Pure classifier (no IO). Order: integrity -> parse -> shape -> no-href-leak -> rows authority ->
    /// semantic consistency with `rendered`. Any failure is a FAIL with a specific classification.
    static func evaluate(_ fixture: A10GoldenFixture) -> A10GoldenResult {
        let ser = fixture.expectedSerialization

        // 1. INTEGRITY — the golden's own serialization must hash to its claimed sha256 (tamper-evident).
        let actualHash = sha256Hex(ser)
        guard actualHash == fixture.expectedSha256.lowercased() else {
            return fail(.integrity_mismatch, 0,
                        "sha256(expectedSerialization)=\(actualHash) != expectedSha256=\(fixture.expectedSha256.lowercased())")
        }

        // 2. PARSE — the serialization must be valid JSON object.
        guard let obj = (try? JSONSerialization.jsonObject(with: Data(ser.utf8))) as? [String: Any] else {
            return fail(.shape_mismatch, 0, "expectedSerialization is not a JSON object")
        }

        // 3. SHAPE — ADR §4 CanonicalExportModel: required keys present, NO invented `canonicalModelVersion`,
        //    top-level keys in canonical (ascending) order, no null sentinels in rows.
        let required = ["citationFormatVersion", "citations", "exportTemplateVersion", "exportType",
                        "flags", "linkDegradations", "rows", "sourceObjectIds", "warnings"]
        for key in required where obj[key] == nil {
            return fail(.shape_mismatch, 0, "canonical model missing required key '\(key)'")
        }
        // EXACT allowed top-level key set (ADR §4 is a finite model): the required keys plus the optional
        // `generatedFromSnapshotId`. Any other key — invented `canonicalModelVersion`, or forbidden
        // machine-path/renderer metadata such as `rendererMetadata` — is a shape violation.
        let allowedTopLevel = Set(required + ["generatedFromSnapshotId"])
        for key in obj.keys where !allowedTopLevel.contains(key) {
            return fail(.shape_mismatch, 0, "canonical model carries unexpected top-level key '\(key)'")
        }
        // Scalar fields must be the right TYPE + pinned VALUE (a rehashed `exportType: 5` or wrong version
        // string must not false-green): exportType a non-empty string; the two versions exactly pinned;
        // generatedFromSnapshotId (if present) a string.
        guard let exportType = obj["exportType"] as? String, !exportType.isEmpty else {
            return fail(.shape_mismatch, 0, "exportType must be a non-empty string")
        }
        guard (obj["citationFormatVersion"] as? String) == "a10.citation.v1" else {
            return fail(.shape_mismatch, 0, "citationFormatVersion must be the pinned 'a10.citation.v1'")
        }
        guard (obj["exportTemplateVersion"] as? String) == "a10.template.v1" else {
            return fail(.shape_mismatch, 0, "exportTemplateVersion must be the pinned 'a10.template.v1'")
        }
        if let snap = obj["generatedFromSnapshotId"], !(snap is String) {
            return fail(.shape_mismatch, 0, "generatedFromSnapshotId must be a string when present")
        }
        // Canonical key order must hold RECURSIVELY (the serializer sorts object keys at every depth), not
        // just at the top level — a rehashed serialization with nested keys out of order must not pass.
        if !recursiveKeysSorted(ser) {
            return fail(.shape_mismatch, 0, "object keys are not in canonical ascending order (recursively)")
        }
        if ser.contains("\"citationText\":null") || ser.contains("\"flag\":null") {
            return fail(.shape_mismatch, 0, "rows carry a null sentinel (must be key-presence XOR)")
        }

        // 4. NO-HREF-LEAK — no scheme / nav metadata anywhere in the canonical serialization. URL schemes are
        //    case-insensitive (HTTP:, JavaScript:, FILE: ...), so scan case-folded.
        let lowerSer = ser.lowercased()
        for needle in forbiddenSubstrings where lowerSer.contains(needle) {
            return fail(.authority_violation, 0, "canonical serialization contains forbidden token '\(needle)'")
        }

        // 5. ROWS — each row is a key-presence union: exactly one of {citationText} XOR {flag}, plus linkId,
        //    no href / nav metadata key.
        guard let rows = obj["rows"] as? [[String: Any]] else {
            return fail(.shape_mismatch, 0, "rows is not an array of objects")
        }
        for row in rows {
            guard let linkId = row["linkId"] as? String, !linkId.isEmpty else {
                return fail(.authority_violation, rows.count, "a row is missing a non-empty linkId")
            }
            // EXACT row key set (the CanonicalExportRow union is precisely {linkId,citationText} XOR
            // {linkId,flag}): this enforces text-XOR-flag, excludes href/nav metadata, AND rejects any extra
            // arbitrary key (e.g. a `debug` field). The value must be a String.
            let keys = Set(row.keys)
            let cleanRow = keys == ["linkId", "citationText"] && row["citationText"] is String
            let flagRow = keys == ["linkId", "flag"] && row["flag"] is String
            if !(cleanRow || flagRow) {
                return fail(.authority_violation, rows.count,
                            "row \(linkId): keys must be EXACTLY {linkId,citationText} or {linkId,flag} with a string value")
            }
        }

        // 6. SEMANTIC — rows must be consistent with the `rendered` input by EXACT link-id SET equality
        //    (not just equal counts — duplicates could otherwise mask a dropped id), clean citations ->
        //    a citationText row carrying the exact 卷X页Y text; flagged citations -> a flag row.
        let rowIds = rows.compactMap { $0["linkId"] as? String }
        let renderedIds = fixture.rendered.map { $0.linkId }
        if Set(rowIds).count != rowIds.count {
            return fail(.shape_mismatch, rows.count, "rows contain a duplicate linkId")
        }
        if Set(renderedIds).count != renderedIds.count {
            return fail(.fixture_or_oracle_invalid, rows.count, "rendered input contains a duplicate linkId")
        }
        if Set(rowIds) != Set(renderedIds) {
            return fail(.semantic_mismatch, rows.count,
                        "row link-id set != rendered link-id set (a citation was dropped, added, or renamed)")
        }
        // Stable array ORDER is part of determinism (the model sorts rows by linkId). A rehashed
        // serialization with the same elements in non-canonical order must NOT pass.
        if rowIds != rowIds.sorted() {
            return fail(.shape_mismatch, rows.count, "rows[] are not ordered by linkId (non-deterministic order)")
        }
        var rowById: [String: [String: Any]] = [:]
        for row in rows { if let id = row["linkId"] as? String { rowById[id] = row } }
        for r in fixture.rendered {
            guard let row = rowById[r.linkId] else {
                return fail(.semantic_mismatch, rows.count, "rendered link \(r.linkId) has no row")
            }
            if let flag = r.flag {
                guard (row["flag"] as? String) == flag else {
                    return fail(.semantic_mismatch, rows.count, "link \(r.linkId): flagged citation must map to flag '\(flag)'")
                }
            } else {
                guard let citation = r.citation else {
                    return fail(.fixture_or_oracle_invalid, rows.count, "rendered link \(r.linkId): clean citation without a citation payload")
                }
                guard (row["citationText"] as? String) == citation.text else {
                    return fail(.semantic_mismatch, rows.count, "link \(r.linkId): clean citation must map to citationText '\(citation.text)'")
                }
            }
        }

        // 7. WHOLE-MODEL SEMANTIC — every ADR §4 array must be EXACTLY consistent with `rendered` (and the
        //    input warnings): exact cardinality + element shape + no duplicates + set membership, so a
        //    stripped array, a duplicate, an extra junk element, or a wrong-shaped element cannot hide behind
        //    set membership. This validates the model against its inputs; it does NOT re-derive serialization.
        let cleanRendered = fixture.rendered.filter { $0.flag == nil }
        let flaggedRendered = fixture.rendered.filter { $0.flag != nil }
        func nfc(_ s: String) -> String { s.precomposedStringWithCanonicalMapping } // mirror serializer NFC

        // citations[]: exactly the clean rendered citations; each element EXACTLY {linkId,citationVolume,
        // citationPageLabel,text} (extra/missing keys or non-string values fail).
        guard let rawCitations = obj["citations"] as? [[String: Any]] else {
            return fail(.shape_mismatch, rows.count, "citations is not an array of objects")
        }
        if rawCitations.count != cleanRendered.count {
            return fail(.semantic_mismatch, rows.count, "citations[] count \(rawCitations.count) != clean rendered count \(cleanRendered.count)")
        }
        var actualCitations = Set<String>()
        for c in rawCitations {
            guard Set(c.keys) == ["linkId", "citationVolume", "citationPageLabel", "text"],
                  let id = c["linkId"] as? String, let v = c["citationVolume"] as? String,
                  let l = c["citationPageLabel"] as? String, let t = c["text"] as? String else {
                return fail(.semantic_mismatch, rows.count, "citations[] has a malformed element")
            }
            // A10-T1 citation-identity invariant: the text MUST be exactly 卷{volume}页{label} (the single
            // citation syntax). A tampered fixture with arbitrary citation text must NOT pass.
            if t != "卷\(v)页\(l)" {
                return fail(.authority_violation, rows.count,
                            "citation \(id): text '\(t)' != the required 卷\(v)页\(l)")
            }
            actualCitations.insert("\(id)\u{1F}\(v)\u{1F}\(l)\u{1F}\(t)")
        }
        if actualCitations.count != rawCitations.count {
            return fail(.semantic_mismatch, rows.count, "citations[] contains a duplicate")
        }
        let citationIds = rawCitations.compactMap { $0["linkId"] as? String }
        if citationIds != citationIds.sorted() {
            return fail(.shape_mismatch, rows.count, "citations[] are not ordered by linkId (non-deterministic order)")
        }
        let expectedCitations = Set(cleanRendered.compactMap { r -> String? in
            r.citation.map { "\(r.linkId)\u{1F}\(nfc($0.citationVolume))\u{1F}\(nfc($0.citationPageLabel))\u{1F}\(nfc($0.text))" }
        })
        if actualCitations != expectedCitations {
            return fail(.semantic_mismatch, rows.count, "citations[] is not the set of clean rendered citations")
        }

        // linkDegradations[]: exactly the flagged rendered; each element EXACTLY {linkId,flag}.
        guard let rawDeg = obj["linkDegradations"] as? [[String: Any]] else {
            return fail(.shape_mismatch, rows.count, "linkDegradations is not an array of objects")
        }
        if rawDeg.count != flaggedRendered.count {
            return fail(.semantic_mismatch, rows.count, "linkDegradations[] count \(rawDeg.count) != flagged rendered count \(flaggedRendered.count)")
        }
        var actualDeg = Set<String>()
        for dn in rawDeg {
            guard Set(dn.keys) == ["linkId", "flag"], let id = dn["linkId"] as? String, let f = dn["flag"] as? String else {
                return fail(.semantic_mismatch, rows.count, "linkDegradations[] has a malformed element")
            }
            actualDeg.insert("\(id)\u{1F}\(f)")
        }
        if actualDeg.count != rawDeg.count {
            return fail(.semantic_mismatch, rows.count, "linkDegradations[] contains a duplicate")
        }
        let degIds = rawDeg.compactMap { $0["linkId"] as? String }
        if degIds != degIds.sorted() {
            return fail(.shape_mismatch, rows.count, "linkDegradations[] are not ordered by linkId (non-deterministic order)")
        }
        if actualDeg != Set(flaggedRendered.map { "\($0.linkId)\u{1F}\($0.flag ?? "")" }) {
            return fail(.semantic_mismatch, rows.count, "linkDegradations[] is not the set of flagged rendered citations")
        }

        // flags[] / sourceObjectIds[] / warnings[] are distinct-SORTED in the model — assert EXACT ordered
        // equality to the expected distinct-sorted list (catches duplicates, extras, junk, and bad order).
        guard let actualFlags = obj["flags"] as? [String] else {
            return fail(.shape_mismatch, rows.count, "flags is not an array of strings")
        }
        if actualFlags != Array(Set(flaggedRendered.compactMap { $0.flag })).sorted() {
            return fail(.semantic_mismatch, rows.count, "flags[] is not the distinct-sorted set of emitted flags")
        }
        guard let actualSrc = obj["sourceObjectIds"] as? [String] else {
            return fail(.shape_mismatch, rows.count, "sourceObjectIds is not an array of strings")
        }
        if actualSrc != Array(Set(fixture.rendered.map { $0.sourceId })).sorted() {
            return fail(.semantic_mismatch, rows.count, "sourceObjectIds[] is not the distinct-sorted set of rendered source ids")
        }
        // warnings are caller-supplied: the model's warnings == the distinct-sorted NFC of the input warnings.
        guard let actualWarn = obj["warnings"] as? [String] else {
            return fail(.shape_mismatch, rows.count, "warnings is not an array of strings")
        }
        if actualWarn != Array(Set((fixture.warnings ?? []).map(nfc))).sorted() {
            return fail(.semantic_mismatch, rows.count, "warnings[] does not match the distinct-sorted input warning set")
        }

        return A10GoldenResult(status: .pass, classification: .ok, observedRowCount: rows.count,
                               detail: "golden canonical export is integrity-, shape-, authority-, and semantically-consistent (\(rows.count) rows)")
    }

    /// SHA-256 (hex) of a UTF-8 string. Pure Swift (FIPS 180-4) — no CryptoKit, so the gate needs no
    /// platform-availability floor and stays self-contained. Deterministic; the reproducibility-unit hash.
    static func sha256Hex(_ s: String) -> String {
        SHA256Pure.hexDigest(Array(s.utf8))
    }

    /// True iff EVERY JSON object's keys appear in ascending order at EVERY depth in the serialization — the
    /// deterministic-serializer invariant (the apps serializer sorts object keys recursively). Avoids
    /// re-serializing (no second source of truth): it streams the text and, per object frame, checks each key
    /// is strictly greater than the previous key at that frame. Returns false on any out-of-order key.
    static func recursiveKeysSorted(_ ser: String) -> Bool {
        // Per-object frame: the last key seen + whether the next string is a key. Arrays push a non-object frame.
        var frames: [(isObject: Bool, lastKey: String?, expectingKey: Bool)] = []
        var inString = false, escaped = false, capturing = false
        var current = ""
        for c in ser {
            if inString {
                if escaped { escaped = false; if capturing { current.append(c) } }
                else if c == "\\" { escaped = true; if capturing { current.append(c) } }
                else if c == "\"" {
                    inString = false
                    if capturing {
                        capturing = false
                        let last = frames[frames.count - 1].lastKey
                        if let last = last, !(current > last) { return false } // not strictly ascending
                        frames[frames.count - 1].lastKey = current
                        frames[frames.count - 1].expectingKey = false
                    }
                } else if capturing { current.append(c) }
                continue
            }
            switch c {
            case "{": frames.append((true, nil, true))
            case "[": frames.append((false, nil, false))
            case "}", "]": if !frames.isEmpty { frames.removeLast() }
            case "\"":
                inString = true
                if let top = frames.last, top.isObject, top.expectingKey { capturing = true; current = "" }
            case ",": if !frames.isEmpty, frames[frames.count - 1].isObject { frames[frames.count - 1].expectingKey = true }
            default: break
            }
        }
        return true
    }

    /// Extract the top-level object keys in the order they appear in the serialization (depth-aware so nested
    /// object/array keys are not counted).
    static func topLevelKeyOrder(_ ser: String) -> [String] {
        var keys: [String] = []
        var depth = 0
        var inString = false
        var escaped = false
        var current = ""
        var expectingKey = false
        let chars = Array(ser)
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if inString {
                if escaped { escaped = false }
                else if c == "\\" { escaped = true }
                else if c == "\"" { inString = false; if expectingKey && depth == 1 { /* key captured below */ } }
                else if expectingKey && depth == 1 { current.append(c) }
                i += 1
                continue
            }
            switch c {
            case "{", "[":
                depth += 1
                if c == "{" && depth == 1 { expectingKey = true }
            case "}", "]":
                depth -= 1
            case "\"":
                inString = true
                if expectingKey && depth == 1 { current = "" }
            case ":":
                if expectingKey && depth == 1 { keys.append(current); expectingKey = false }
            case ",":
                if depth == 1 { expectingKey = true }
            default:
                break
            }
            i += 1
        }
        return keys
    }

    private static func fail(_ c: A10GoldenClassification, _ count: Int, _ detail: String) -> A10GoldenResult {
        A10GoldenResult(status: .fail, classification: c, observedRowCount: count, detail: detail)
    }
}

/// Minimal, dependency-free SHA-256 (FIPS 180-4). Self-contained so the golden-export gate needs no
/// CryptoKit / platform-availability floor. Operates on bytes; returns a lowercase hex digest.
enum SHA256Pure {
    private static let k: [UInt32] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]

    static func hexDigest(_ message: [UInt8]) -> String {
        var h: [UInt32] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]

        // Pre-processing: append 0x80, pad with zeros, append 64-bit big-endian bit length.
        var msg = message
        let bitLen = UInt64(message.count) &* 8
        msg.append(0x80)
        while msg.count % 64 != 56 { msg.append(0x00) }
        for shift in stride(from: 56, through: 0, by: -8) { msg.append(UInt8((bitLen >> UInt64(shift)) & 0xff)) }

        func rotr(_ x: UInt32, _ n: UInt32) -> UInt32 { (x >> n) | (x << (32 - n)) }

        for chunkStart in stride(from: 0, to: msg.count, by: 64) {
            var w = [UInt32](repeating: 0, count: 64)
            for i in 0..<16 {
                let j = chunkStart + i * 4
                w[i] = (UInt32(msg[j]) << 24) | (UInt32(msg[j + 1]) << 16) | (UInt32(msg[j + 2]) << 8) | UInt32(msg[j + 3])
            }
            for i in 16..<64 {
                let s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3)
                let s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10)
                w[i] = w[i - 16] &+ s0 &+ w[i - 7] &+ s1
            }

            var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7]
            for i in 0..<64 {
                let S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
                let ch = (e & f) ^ (~e & g)
                let t1 = hh &+ S1 &+ ch &+ k[i] &+ w[i]
                let S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
                let maj = (a & b) ^ (a & c) ^ (b & c)
                let t2 = S0 &+ maj
                hh = g; g = f; f = e; e = d &+ t1; d = c; c = b; b = a; a = t1 &+ t2
            }
            h[0] = h[0] &+ a; h[1] = h[1] &+ b; h[2] = h[2] &+ c; h[3] = h[3] &+ d
            h[4] = h[4] &+ e; h[5] = h[5] &+ f; h[6] = h[6] &+ g; h[7] = h[7] &+ hh
        }

        return h.map { String(format: "%08x", $0) }.joined()
    }
}
