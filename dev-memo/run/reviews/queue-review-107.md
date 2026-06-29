# Queue review — WI-EVIDENCE-A0.7-FIXTURE-COVERAGE-00

Lane: strengthen the real Swift/PDFKit A0.7 renderer-conformance harness to meaningful messy-fixture coverage (Type: IMPL; native-only; HIGH-RISK Evidence-invariant lane).
Date: 2026-06-29. Branch: `evidence-a07-fixture-coverage` (from `main` @ `1db87fa`).

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
### review-plan
- Kind: review-plan · Path 1 runner 0.2.18, gpt-5.5/high/read-only · Job ID `review-plan-mqzbplew-x8tv7i` · completed (retrievable YES) · **READY-WITH-LOW** · rawOutput sha256 `9d91f67bd147873d1c41e21d4d6b88f3f085ca463abc461e433a23df2d20a22a`.
- Lows (applied): (1) define expanded oracle shape explicitly (per-page mediaBox origin+extent, cropBox, rotation, samplePageIndex) — done; (2) keep committed fixture/oracle pairs as expected-PASS, put class_1/class_2 negatives in pure evaluate() unit tests (no committed mismatching "instability oracle") — done; (3) class_2 only after ruling out malformation, cropBox-vs-mediaBox = class_1 only when geometry already correct — honored; (4) hand-authored PDFs fine, record sha256/provenance + PDFKit-parse tests — done (README sha256 + end-to-end tests); Package.swift no change (tests locate fixtures via #filePath). A0.7 custody NOT required for this lane.

## Verdict: READY-WITH-LOW → Lows applied (A0.7 custody NOT required; no marker)
Reviewer confirmed the approach is the smallest meaningful coverage increase without weakening A07-GATE-00 (oracle independence §3; class_1/class_2 + inconclusive-not-pass §4; no-marker §5; JS-shim-unchanged §6); classification semantics correct (renderer-structure disagreement = class_2; correct-box-wrong-derivation = class_1); additive-optional oracle fields are the right backward-compat strategy; one WI appropriate; no JS-shim/Package.swift/schema/custody touch.

QUEUE_REVIEW_VERDICT=PASS

## Post-implementation cc-suite records
### audit
- Kind: audit · Path 1 runner 0.2.18, gpt-5.5/high/read-only (pre-commit working-tree scope).
- Attempt 1: Job ID `audit-mqzc20lg-3jtol5` · PROMPT_CONTEXT_ERROR — flagged pre-existing untracked root-intake/run-state residue as a scope/hygiene "Medium"; not a real defect (code/fixture substance PASS). That residue is out-of-WI + excluded by exact-path staging. Re-audited with the exact-path-staging contract clarified.
- Attempt 2: Job ID `audit-mqzc4tg9-y0jqc7` · **PASS, no findings** · rawOutput sha256 `5a90ff05a45343eccc6d0f35975c9e4af3f87b76634a67747f28407f602e80e7`. Confirmed: harness preserves offline guard / not_implemented=fail / inconclusive!=pass / structural-class_2-before-normalization-class_1 / origin-cropBox-rotation observation / origin subtraction; 4 synthetic non-confidential minimal PDFs + 4 independent oracles + README with matching sha256; oracle values derived from fixture construction (not back-filled); existing oracle still decodes (backward compat); no JS shim / Package.swift / schema / contracts / ADR / marker / key change; schema 12.
### verify
- Kind: verify · Path 1 runner 0.2.18 · consumed the attempt-2 audit (no-findings PASS) · Job ID `verify-mqzc77qc-8ndjni` · rawOutput sha256 `f622589a2e972a7455030e958a0265aa3ae573e305ecc2d7f858e29ab77d965b`.
- Verdict: **ALL CLOSED** — no prior C/H/M open; deliverable + scope intact; residue out-of-WI.

Verification run (local, pre-audit): `swift test` in native/evidence-core-swift → **28/28 pass** (was 19; +9). `a07-harness-cli` verdicts: original `pass	ok	2` (regression); rotated `pass	ok	1`; cropbox `pass	ok	1`; nonzero-origin `pass	ok	1`; mixed-sizes `pass	ok	2`. `check-contract-integrity` PASS (14 docs); `CURRENT_SCHEMA_VERSION` 12. No A0.7 custody/marker; `dev-memo/run/evidence/**` untouched; no HMAC/key requested/received/printed/persisted/staged. No JS shim wiring.
