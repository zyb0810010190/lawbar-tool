# Queue review — WI-EVIDENCE-A10-NATIVE-GOLDEN-EXPORT-HARNESS-00

Lane: implement the REAL native `golden-export` gate in the Swift package, validating the A10-T6 apps-layer golden artifact (Type: IMPL; HIGH-RISK Evidence-invariant lane — A10 court-fileable export reproducibility; an A8.6 prerequisite).
Date: 2026-06-30. Branch: `evidence-a10-native-golden-export-harness` (from synced `main` @ `372cc37`). Batch: 1/3 since marker `0742464` — no batch closeout this lane.

## What this is
Replaces the JS-shim `golden-export` `not_implemented` placeholder with a real, truthful, deterministic Swift gate (`EvidenceCoreA10GoldenExport`), mirroring the A0.7/A1-T6/A3-T10 pattern. It validates the EXISTING A10-T6 apps-layer golden fixture (`apps/lawbar-desktop/tests/fixtures/a10-golden-canonical-export.json`) — single source of truth, read by repo-relative path, NOT copied or re-derived — via: integrity (pure-Swift FIPS 180-4 SHA-256 == `expectedSha256`); shape (exact allowed top-level key set, no invented `canonicalModelVersion`, scalar field types + pinned versions, recursive canonical key order, no null sentinels); no-href-leak (case-insensitive); rows (exact per-row key set `{linkId,citationText}`XOR`{linkId,flag}`, no dup, linkId order); rendered set-equality + per-link text/flag; A10-T1 citation-identity (`text == 卷{volume}页{label}`); whole-model arrays (citations/linkDegradations/flags/sourceObjectIds/warnings: exact cardinality+element-shape+no-dup+order+set/ordered equality). Thin CLI `a10-golden-export-cli` prints `<status>\t<classification>\t<rowCount>`, exit 0 iff pass. `not_implemented` is NEVER returned. Writes no marker; no network; no `.docx`/PDF; does NOT touch the JS shim (`native/evidence-core/**` — golden-export stays not_implemented there by design), the apps `a10*.ts` modules, the golden fixture, or the a07/a1/a3 harnesses.

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
### review-plan (Path 1 runner 0.2.18, gpt-5.5/high/read-only)
Six attempts — each NEEDS-FIX closed a real false-green gap in the gate, fixed in-WI:
- `review-plan-mr0ntbv0-1l9rv5` NEEDS-FIX: (1) semantic check used count+lookup not set-equality (duplicate/missing linkIds); (2) unknown top-level fields allowed; (3) SHA-256 self-tested only. **Fixed** (exact set-equality + dup rejection; exact allowed top-level key set; FIPS vectors).
- `review-plan-mr0nxqci-fsi016` NEEDS-FIX: whole-model arrays (citations/linkDegradations/flags/sourceObjectIds/warnings) validated by key-presence only — a stripped `citations:[]` could pass. **Fixed** (set-membership cross-checks vs `rendered`).
- `review-plan-mr0o2co5-8i7gzq` NEEDS-FIX: Set+compactMap ignored cardinality / dropped junk/duplicate elements. **Fixed** (exact cardinality + element key-set + no-dup + ordered equality).
- `review-plan-mr0o6o6e-29q8hb` NEEDS-FIX: (1) rows accepted extra arbitrary keys; (2) array order (linkId) unvalidated. **Fixed** (exact row key set; linkId-ascending order on rows/citations/linkDegradations).
- `review-plan-mr0ob3az-q5qutp` NEEDS-FIX: (1) scalar top-level fields type/value unchecked; (2) only top-level key order validated. **Fixed** (scalar types + pinned versions; recursive key-order validator).
- `review-plan-mr0ofp8r-99kb4o` · completed (retrievable YES) · **READY** · rawOutput sha256 `7a24a8349d5ca81663b0a7103f61b1ee3782b6d289ce4afba20b2061640e6139`. No remaining Medium+ false-green path; JS-shim residual acknowledged out-of-scope.

## Verdict: READY (all six review-plan rounds' findings resolved in-WI)

QUEUE_REVIEW_VERDICT=PASS

## Post-implementation cc-suite records
### audit (Path 1 runner 0.2.18, gpt-5.5/high/read-only; pre-commit working-tree, exact-path scope)
- Attempt 1 — Job ID `audit-mr0oi6gh-ar3eud` · **High + Medium** (FIXED in-WI): High = the A10-T1 citation-identity invariant `text == 卷{volume}页{label}` was not enforced (arbitrary citation text could pass) → now asserted per citation (→ authority_violation); Medium = the no-href-leak scan was case-sensitive (`HTTP:`/`JavaScript:` survived) → now case-insensitive (lowercased scan + lowercase needles). No Critical.
- Attempt 2 — Job ID `audit-mr0on4wu-f4kvyd` · **CLEAN — no findings** · rawOutput sha256 `44a097ee2bac159b7cf55b1e02ac1fb8de5470c7e40bf581e6455c300ee5897e`. Confirmed both closed; pure-Swift SHA-256 + FIPS vectors; exact shape/rows/arrays/order; not_implemented never returned; no live-pipeline/.docx/PDF/marker/JS-shim/apps-source/services/schema/golden-fixture edit; Package.swift only the new target/product; read-only fixture check `shaMatches=true, rowCount=5`, no href hits, no bad citation text. (`check-contract-integrity` PASS.)
### verify
- Kind: verify · Path 1 runner 0.2.18, gpt-5.5/medium · consumed the audit-2 report · Job ID `verify-mr0oq9vs-8x1bk0` · rawOutput sha256 `5e9543a1fa6694e8f7e153b005a988e1f2217151fd518d9a26b5a7e316f28ce4`.
- Verdict: **ALL CLOSED**.

## Local verification
`swift build --package-path native/evidence-core-swift` + `swift test ...` → **82/82 pass** (was 65; +17 net A10 tests; 28 in the A10 suite). The CLI on the real golden → `pass\tok\t5`, exit 0 (no longer `not_implemented`). Apps A10-T6/T1/T2 targeted regression → 30/30. `check-contract-integrity` PASS (14 docs). Only `native/evidence-core-swift/Package.swift` modified (new target/product) + 3 new Swift files; JS shim, apps `a10*.ts`, the golden fixture, and the a07/a1/a3 harnesses untouched; `CURRENT_SCHEMA_VERSION` unchanged; `dev-memo/run/evidence/**` untouched.

## Deferred findings
None. All six review-plan rounds' findings + the one audit High + one audit Medium were FIXED in-WI and verified closed. (The JS shim's `golden-export` remaining `not_implemented` is an explicitly out-of-scope, forbidden-to-touch surface — the real gate is the Swift `a10-golden-export-cli`/harness, consistent with A0.7/A1-T6/A3-T10.)
