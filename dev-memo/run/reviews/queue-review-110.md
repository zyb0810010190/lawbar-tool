# Queue review — WI-EVIDENCE-A3-T10-ANCHOR-REGRESSION-GATE-00

Lane: build the native A3-T10 anchor-resolution regression gate (Type: IMPL; native-only; HIGH-RISK Evidence-invariant lane).
Date: 2026-06-30. Branch: `evidence-a3-t10-anchor-regression` (from `main` @ `c911e5d`).

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
### review-plan
- Kind: review-plan · Path 1 runner 0.2.18, gpt-5.5/high/read-only · Job ID `review-plan-mr06lbai-km6mwg` · completed (retrievable YES) · **READY-WITH-LOW** · rawOutput sha256 `334ecb907c90c485e1215e5b8491915d8df924bc145f602f4dcf240a0f97e1f8`.
- Lows (applied): (a) harness scoped to the data-resolution / deterministic-replay SLICE of A3-T10 (not PDF geometry / A8 restore — stated in the harness header + README); (b) drift-guard rung-by-rung + combined-precedence tests pinning the built ladder; (c) fixture field normalized to `supersedesDocumentId` on the replacement document (reverse-supersession lookup). Package.swift `a3-regression-cli` executable registration APPROVED (mirrors a07/a1).

## Verdict: READY-WITH-LOW → Lows applied (A0.7 custody NOT required; no marker)
Reviewer confirmed A3-T10 is the data-resolution regression gate, independent of A8/A10 (A8.6 depends on A3-T10, not the reverse); Swift replication of the resolver ladder is acceptable for the native deterministic gate WITH a mandatory drift guard; the clean/broken/unlinked/relinked distinction via a separate `unlinked` flag is correct; version-mismatch + reverse-supersession semantics + broken-before-needs_review ordering correct; one WI; no schema/contracts/JS-shim/A8/A10/A3-runtime change.

QUEUE_REVIEW_VERDICT=PASS

## Post-implementation cc-suite records
### audit
- Kind: audit · Path 1 runner 0.2.18, gpt-5.5/high/read-only (pre-commit working-tree, exact-path scope).
- Attempt 1: Job ID `audit-mr06t01a-9nalg8` · PROMPT_CONTEXT_ERROR — flagged the not-yet-run governance refresh (queue.reviewed/governed point to the prior WI; queue-review-110 absent) as Medium; that is the EXPECTED pre-commit ordering (governance runs STANDALONE after audit/verify), not a defect. Re-audited with the ordering clarified.
- Attempt 2: Job ID `audit-mr06winp-3vxzl7` · **Medium** — `A3AnchorRegression.evaluate` could pass with a truncated oracle (no oracle-completeness check; false-green risk). **FIXED in-WI** (per cc-suite remediation: Mediums are fixed, not deferred): `evaluate` now requires exact resolved↔oracle link-id-set equality + rejects duplicate oracle ids, returning `fixture_or_oracle_invalid` (never pass) for truncated/mismatched/duplicate oracles; new tests `testIncompleteOracleIsInvalidNotPass` + `testDuplicateOracleEntryIsInvalidNotPass`; the mismatch test rebuilt with a complete 8-link oracle.
- Attempt 3: Job ID `audit-mr0718t2-mqkhb7` · **PASS, no findings** · rawOutput sha256 `a5578c6991924e0c4897902a39d2ffb4bdf32bca3815b60af1174ee4002e9000`. Confirmed the Medium resolved; ladder matches linkStatusResolverQueries.ts; unlinked/structural distinction; byte-identical replay; deterministic ordering; offline guard; DATA-driven; scope clean; schema 12.
### verify
- Kind: verify · Path 1 runner 0.2.18 · consumed the audit chain · Job ID `verify-mr0744uk-02a72p` · rawOutput sha256 `30969739994a093941c3dbf6237affe510243c7562aceaccf7c960aee7ffa54c`.
- Verdict: **ALL CLOSED** — the attempt-2 Medium is closed in source; no undocumented C/H/M open; deliverable + scope intact; governance-ordering + residue treated as out-of-WI.

Verification run (local): `swift test` in native/evidence-core-swift → **54/54 pass** (was 38; +16 incl. the 2 completeness tests; A0.7 + A1-T6 unchanged regression). `a3-regression-cli` → `pass	ok	8`; `a1-citation-stability-cli` → `pass	ok	6`; `a07-harness-cli` → `pass	ok	2`. `check-contract-integrity` PASS (14 docs); `CURRENT_SCHEMA_VERSION` 12. No A0.7 custody/marker; `dev-memo/run/evidence/**` untouched; no HMAC/key. No JS shim wiring; no A3 runtime change.
