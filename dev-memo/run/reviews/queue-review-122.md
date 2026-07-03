# Queue review — WI-FORMS-T3-S0-CONTRACT-FIELDS-IMPLEMENTATION-00

Lane: implement the S0 Option A payload-only contract fields (Type: IMPL; HIGH-RISK persistence/contract category — FULL broker chain run: review-plan -> implement -> audit -> fix -> verify).
Date: 2026-07-03. Branch: `forms-t3-s0-contract-fields` (from synced `main` @ `3ea9676`). Batch: 1/3 since marker `9a59d39` — no batch closeout this lane.

## What this is
First product-code lane of the forms track, implementing EXACTLY the ADR-approved fields (`dev-memo/adr-forms-t3-s0-schema.md` §4 Option A): evidence-item optional `evidence_title` (minLength 1), `proof_statement` (minLength 1; whitespace-only input normalized to ABSENT at append, before validation, caller never mutated, non-empty preserved verbatim), `display_order` (integer ≥ 0, absence-only); matter optional `litigation_position` (enum plaintiff|defendant). Payload-only: NO SQLite DDL/column/table, NO migration, `CURRENT_SCHEMA_VERSION` stays 12 (pinned by a new test). Desktop: `litigation_position` classified CREATE-FORBIDDEN only (not renderer-suppliable; NOT in `MATTER_RESPONSE_FIELDS`); internal tarballs repacked + 2-line package-lock integrity refresh per DESKTOP-DEPS-00. Versioning resolution (supersedes ADR §6 minor-bump line): contract package version REMAINS `0.1.0` — private committed tarball pinned by the payload-hash drift guard, not semver.

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
All Path 1 runner foreground, resolved runner path `/Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`, retrievable YES (all envelopes `status:"completed"`), no failure class, no fallback.

### review-plan (gpt-5.5/high/read-only; pre-implementation; 3 attempts, fix-forward between)
- Attempt 1: `review-plan-mr4i64o5-8k41lm` · NEEDS-FIX (H: desktop schema-drift gate needs a matter DTO classification the file boundary forbade; M: ADR-vs-queue versioning conflict; M: missing negative-shape fixtures for evidence_title/negative/non-integer display_order; L: normalization impl detail) · sha256 `1fa3bbfa58ea357c4336acb30be55e168dc17a33266e96573ee5fb4f714c9561`.
- Attempt 2: `review-plan-mr4ibld5-s1glur` · NEEDS-FIX (H: dto-contract.test.mjs hard-coded expected forbidden list also needs the matching single addition) · sha256 `7c06a85fe20c97c016511b9b6398bc417b38cba519139669f6331334a75cc93c`.
- Attempt 3: `review-plan-mr4idoks-4zi9dp` · **READY** (no findings; confirmed no other desktop test hard-codes the matter property set; renderer-dto-sync unaffected) · sha256 `2455359f182baf736d0385d5dc37efdf8f17b0948a166e22311730984b2fb7e1`.

### audit (gpt-5.5/high/read-only; on the implementation diff vs main)
- `audit-mr4iod7p-pju4hi` · **PASS C0 H0 M0 L3** · sha256 `edb6fcf9db8ac356e714ab8940c9c985d1f1b8a59f8b37b7145a98b79a9b62c4`. Confirmed: Option A match, required lists unchanged, no DDL/version bump, payload-only round-trip tested, normalization correct + caller unmutated, litigation_position create-forbidden only, no filename/notes promotion.
- Lows, all resolved (none deferred): **L1** untracked residue must not be staged -> behavioral, exact-path staging (verified by verify below). **L2** T4/T5 guard test title overstated ("rejected shapes") -> FIXED: retitled + NOTE that schemas remain open (additionalProperties not false) and only named-property non-introduction is pinned. **L3** trim() blankness boundary undocumented -> FIXED: normalizeAppendEvidenceInput doc comment documents String.prototype.trim() as the deliberate boundary (U+3000 = whitespace; zero-width U+200B persists verbatim).

### verify (gpt-5.5/medium/read-only; consumed the audit findings explicitly)
- `verify-mr4iuhoq-4385tz` · **ALL CLOSED** (L1/L2/L3 each verified CLOSED; no staged files; tracked diff confined to Allowed files; tarball manifest self-consistent; no new C/H/M) · sha256 `6ef8ef9198795a31cde6991623cf09749bb9df4595740c6398dd70fe866ac5ea`.

## Verdict: READY + audit PASS + verify ALL CLOSED

QUEUE_REVIEW_VERDICT=PASS

## Gates (all fresh after the post-audit L2/L3 fixes + repack)
- `npm --prefix docs/contracts/case-box-contract test` → **455 pass, 0 fail** (incl. 10 new T3-S0 tests).
- `npm --prefix services/case-box-persistence test` → **288 pass, 0 fail** (incl. 6 new hardening + 3 new parity tests; abi-smoke pretest OK).
- `npm --prefix apps/lawbar-desktop test` → **704 pass, 0 fail** (full suite; run because DTO/test/tarball/package-lock changed).
- `npm --prefix apps/lawbar-desktop run check:internal-tarballs` → PASS (fresh repack; node_modules payload freshness verified by content grep).
- `scripts/workflow/check-contract-integrity.sh` → PASS (14 docs). `scripts/workflow/check-queue.sh` → PASS.
- Forbidden-scope scan: `CURRENT_SCHEMA_VERSION = 12` untouched; no migrations dir; no schema.ts/RepoQueries/native/fixture-mutation/IPC/renderer/DOCX/custody/JS-shim/A8/T4-T5/T3-export change; no package.json manifest edit (lockfile integrity refresh only, 2 lines); raw samples untracked; `validators.test.mjs` (pre-existing 1333-LOC over-threshold) NOT grown — new contract tests went to `contract.test.mjs` (~860 LOC after).
- LOC: largest touched hand-written files well under the 800-source/1200-test fail thresholds (inMemoryEvidence.ts ~560 LOC; hardening-evidence.test.mjs ~270 LOC).

## Deferred findings
None. All review-plan findings fixed in the plan before implementation; all audit Lows closed in-lane and verified. The T3 logical model (S1), UI preview (S2), and DOCX (S3) remain separate gated WIs; T4/T5 remain design-gated.
