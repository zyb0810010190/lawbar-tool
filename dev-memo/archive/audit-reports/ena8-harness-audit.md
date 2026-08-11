**Findings**
- **High**: [A07ConformanceHarness.swift](/Users/zhongyibao/ClaudeProjects/lawbar-tool/native/evidence-core-swift/Sources/EvidenceCoreSmoke/A07ConformanceHarness.swift:102) accepts arbitrary `URL`s and immediately calls `Data(contentsOf: oracleURL)` at line 104, then `PDFDocument(url: fixtureURL)` at line 113. For `http(s)` URLs, `Data(contentsOf:)` is network-capable. WI-ENA8 is explicitly a disk-fixture/disk-oracle harness and must not add network behavior. Add `fixtureURL.isFileURL && oracleURL.isFileURL` validation before any load, returning `fail/fixture_or_oracle_invalid` if not file URLs.

- **Low**: [A07ConformanceHarnessTests.swift](/Users/zhongyibao/ClaudeProjects/lawbar-tool/native/evidence-core-swift/Tests/EvidenceCoreSmokeTests/A07ConformanceHarnessTests.swift:44) proves missing oracle failure, but not an undecodable oracle. The implementation does handle undecodable JSON via the combined `Data(contentsOf:)`/`JSONDecoder` guard, but the requested test matrix specifically includes missing/undecodable oracle. Add an in-memory temp corrupt oracle only if the test environment permits without touching the committed oracle; do not rewrite `oracle.json`.

**Confirmed**
- Expected values come from decoded `A07Oracle` fields, not hardcoded harness constants: page count at line 164, boxes at 171-177, normalized samples at 190-192.
- Missing/undecodable oracle returns `fail/fixture_or_oracle_invalid` in code.
- Class-2 page count and mediaBox disagreement return `fail/class_2_geometry_source_instability`; no Class-2 path returns pass.
- Correct box with normalized mismatch returns `fail/class_1_normalization_math_bug`.
- `not_implemented` returns fail; inconclusive returns `.inconclusive`, not pass.
- No marker/file write/provenance/HMAC/tamper guard/dev-memo evidence write found in scoped files; result shape carries `isMarker=false`.
- No anchors, citation persistence, PDFView/UI conversion, export/OCR/AI/cloud/auth feature, JS shim change, or new dependency in the scoped changes.
- Tests cover real-fixture pass, result shape, class_1, class_2, fixture invalid, missing oracle, and inconclusive using an in-memory oracle.

I could not execute `swift test --package-path native/evidence-core-swift` because the current sandbox is read-only and Swift failed creating `/tmp/xcrun_db-*`.

Verdict: **FAIL until file-URL enforcement is added; otherwise the core classification logic is sound.**
