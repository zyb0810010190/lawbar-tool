# Queue review — WI-FORMS-T3-S0-SCHEMA-ADR-00

Lane: design the T3 lawyer-entered catalog fields schema ADR (Type: PLAN; documentation / design / governance only — docs-only lane DESIGNING a high-risk future persistence change, so FULL broker review-plan was required and run).
Date: 2026-07-03. Branch: `forms-t3-s0-schema-adr` (from synced `main` @ `198b14f`). Batch: 1/3 since marker `545adec` — no batch closeout this lane. Pre-flight continuity: echo-sleuth lane-start recap run earlier this same session (pre-flight for the parent WI-FORMS-T3-IMPLEMENTATION-PLAN-00 lane); the interval since is first-hand session context (PR #167 merge + closeout `198b14f`).

## What this is
A NEW ADR `dev-memo/adr-forms-t3-s0-schema.md` designing (not implementing) the S0 schema change that unblocks T3: lawyer-entered 证据名称 (`evidence_title`), 证明内容 (`proof_statement`), optional lawyer-controlled `display_order` (evidence item), and 提交人诉讼地位 (`litigation_position` enum plaintiff|defendant, matter). **Recommendation: Option A — payload-only additive optional contract properties; NO new SQLite columns, NO DDL, NO migration/backfill, and NO `CURRENT_SCHEMA_VERSION` increment in the later implementation WI** (payload_json is canonical; columns are lifted only for indexes; V12 is the additive precedent). Option B (lifted `display_order` column + V13 ALTER) deferred. `exhibit_page_range` confirmed SUFFICIENT for physical 页码 (verbatim passthrough; absent renders explicit blank). Submitter selection: single-client auto; zero/multi-client refuses pending explicit selection (party index + display_name echo, refuse on mismatch); M0 invariant that the matter-level litigation position applies to ALL client parties, else refuse. T4/T5 stay gated; renderer decision stays separate; §E non-decisions intact; raw samples untracked.

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
### review-plan (Path 1 runner, gpt-5.5/high/read-only — FULL review, persistence-design category)
1. Kind: review-plan (3 attempts, fix-forward between).
2. Target scope: dev-memo/adr-forms-t3-s0-schema.md + dev-memo/run/queue.md (+ ground truth: schema.ts, case-box-evidence-item/matter schema JSONs, types.ts, a10CanonicalExportModel.ts; parent plan + DR-00).
3. Resolved runner path: /Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs.
4. Model/effort/sandbox: gpt-5.5 / high / read-only (approval-policy per command default).
5-7. Attempts (all Path 1 foreground, full packet; each `status:"completed"`):
   - Attempt 1: job `review-plan-mr4g3kv9-b0vg94` · **NEEDS-FIX** (M1 display_order nullability inconsistency; M2 multi-client submitter under-specified vs parties shape; L1 proof_statement empty-string semantics; L2 A10 "reuses helpers" inaccurate — stableStringify is module-private) · rawOutput sha256 `12d2029a8fb99361b78dff2afa1eba2939f0a408924df225b9edd87b3ea02f8c`. Load-bearing Option A claim independently VERIFIED (payload canonical; no additionalProperties:false; generated types tolerate extra props; list API returns full rows → no DDL / no version bump needed).
   - Fixes applied (ADR only): absence-only display_order everywhere; party-index + display_name-echo selection input + shared-litigation-position M0 invariant (per-party position = follow-up ADR); proof_statement minLength 1 + empty-normalized-to-absent; "mirrors the A10-T6 pattern" wording + duplicate-or-extract-helper note; §7 tests extended (stale-selection echo mismatch, shared-position refusal).
   - Attempt 2: job `review-plan-mr4g7l35-8utgw0` · **NEEDS-FIX** (residual "null-fallback" wording ADR §7; stale "determinism helpers S1 reuses" in ADR References + queue.md Scope) · rawOutput sha256 `b98f8b65ad4a75e2958ad4ed58f902de6b5e3434e8906eeed2be0993a3694bd3`. Confirmed M1/M2/L1/L2 fixes landed.
   - Fixes applied: ADR §7 "absent-property fallback"; References "pattern S1 mirrors; not modified"; queue.md Scope "MIRRORING its deterministic-serialization pattern…". Queue re-linted (PASS).
   - Attempt 3: job `review-plan-mr4g9q25-jzwqcj` · **READY** ("Findings: none… No new inconsistency") · rawOutput sha256 `9b5f3332cfebc4ee05e91b16a0a480b47b4b154bc94de9931935b2dac72f93cf`.
8. /cc-suite:status / result retrievable: YES for all three (runner envelopes `status:"completed"`).
9. Failure classification: none (no TIMEOUT/API/runner failure; NEEDS-FIX verdicts are review content, not invocation failures).
10. Retry attempts: 3 (Path 1 full packet each; fix-forward between attempts; no packet downgrade or path fallback needed).
11. Fallback reason: n/a.

### audit / verify
- N/A for this docs-only ADR lane: the committed diff is documentation/governance only, so there is no product-code scope for /cc-suite:audit (per `.claude/rules/cc-suite.md` §"Low-risk WIs"; the HIGH-RISK broker requirement was satisfied by the FULL review-plan above, and review-plan did not require an audit). The LATER S0 implementation WI is the high-risk persistence WI and carries the full review-plan + audit + verify chain.

## Verdict: READY (attempt 3; all attempt-1/2 findings fixed forward in the ADR + queue wording)

QUEUE_REVIEW_VERDICT=PASS

## Local verification
Only `dev-memo/adr-forms-t3-s0-schema.md` (new ADR) is a product/design change; the rest are in-scope governance artifacts (`queue.*` + this review file). Raw samples remain untracked (`?? dev-memo/run/intake/`) and are NOT staged. Forbidden-scope scan: NONE — no CURRENT_SCHEMA_VERSION change (stays 12, file untouched), no migration file, no `apps/**`, `native/**`, `services/**`, `docs/contracts/**`, schema/contract/validator/generated-type edit, tests, `package.json`/lockfile, fixtures, IPC, renderer, DOCX/PDF generation, A8, custody/marker, JS shim, T4/T5, or forms-implementation change. `scripts/workflow/check-queue.sh` → PASS (re-run after the queue wording fix). `scripts/workflow/check-contract-integrity.sh` → PASS. No full desktop suite (docs-only). Batch 1/3 (marker `545adec`) — not due.

## Deferred findings
None. All review findings (2 Medium + 2 Low across attempts 1-2) were fixed forward in this lane. The ADR authorizes no implementation; the later S0 implementation WI (contract properties + validators + tests) is a separate governed high-risk WI; a per-party litigation-position field, if ever needed, is a named follow-up ADR.
