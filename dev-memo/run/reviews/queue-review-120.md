# Queue review — WI-FORMS-T3-IMPLEMENTATION-PLAN-00

Lane: plan the later implementation of T3 证据目录及说明 (Type: PLAN; documentation / design / governance only — LOW-RISK, no code/native/schema/test/fixture/IPC/renderer).
Date: 2026-07-03. Branch: `forms-t3-implementation-plan` (from synced `main` @ `6fab0c7`). Batch: 1/3 since marker `e871d4d` — no batch closeout this lane.

## What this is
A NEW plan document `dev-memo/plan-forms-t3-evidence-catalog-00.md` planning the LATER implementation of the T3 evidence-catalog form under binding DR-00 (internal lawyer trial-review, NOT court filing; DOCX-first with NO renderer authorized; 证明内容 label; 页码 = physical bundle page range first, 卷X页Y supporting-only; no custody/seal/A8). Key verdict recorded in the plan: 序号 synthesizable + 页码 supported by `exhibit_page_range`, but **证据名称 + 证明内容 + the header 提交人诉讼地位 field have NO persisted source → schema mutation required → the future T3 implementation WI is BLOCKED pending a schema ADR (slice S0)**. Staged slice proposal S0 (schema ADR, blocking) → S1 (logical export model mirroring A10-T6 determinism) → S2 (optional UI preview, Design-artifact-gated) → S3 (DOCX generation, double-gated on the renderer decision + S1) — NONE authorized by this lane. T4/T5 stay gated; forms-spec §E non-decisions intact; raw samples under `dev-memo/run/intake/**` stay untracked input.

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
### review-plan (Path 1 runner, gpt-5.5/high/read-only)
1. Kind: review-plan.
2. Target scope: dev-memo/run/queue.md + dev-memo/plan-forms-t3-evidence-catalog-00.md (+ binding/ground-truth refs: forms-spec note §A/§E/§H, case-box-evidence-item.schema.json, schema.ts, a10CanonicalExportModel.ts).
3. Resolved runner path: /Users/zhongyibao/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs.
4. Model/effort/sandbox: gpt-5.5 / high / read-only (approval-policy per command default).
5. Job ID: `review-plan-mr4f1pn6-3ks49x`.
6. threadId: not emitted in envelope.
7. Output location: runner stdout JSON envelope (recorded here); rawOutput sha256 `10e5a3df47500469e95094d5091825be785df458604f20125767b63522e74a4d`.
8. /cc-suite:status / result retrievable: YES (runner returned `status:"completed"`, per rule determined from the envelope, not filesystem spot-checks).
9. Failure classification: none — succeeded on attempt 1 (foreground, ~2 min).
10. Retry attempts: one attempt only (full packet, Path 1, READY).
11. Fallback reason: n/a (no fallback).

**Verdict: READY (Low-risk clarifications).** Codex independently verified the ground truth: evidence contract has `exhibit_page_range`/`notes`/`party_side` but NO title/name or dedicated 证明内容 field; sqlite `case_box_evidence_items` lacks those columns; `CURRENT_SCHEMA_VERSION = 12`; matter/party expose `client/opposing/third_party`, not 原告/被告. Confirmed the plan is implementation-free, makes no renderer choice, does not expand T4/T5, commits no raw samples. No Critical/High/Medium findings.

**Low findings (both FIXED forward in the plan, same lane):**
- L1 — submitter-name derivation: schema does not enforce a single `client` party nor identify the exporting submitter → plan §3 + §4 S0 now require an explicit submitter-selection rule / export-request field decision in the S0 ADR.
- L2 — `created_at ASC, id ASC` is a stable technical order, not necessarily the lawyer-intended catalogue order → plan §3 + §4 S0 now require the S0 ADR to decide on a lawyer-controlled display-order field.

### audit / verify
- N/A for this docs-only PLAN lane: no product-code diff to audit (per `.claude/rules/cc-suite.md` §"Low-risk WIs"). Review-plan validated content/accuracy; always-loaded contract docs untouched (`check-contract-integrity` PASS).

## Verdict: READY (Low-risk clarifications; both Lows fixed forward in the plan)

QUEUE_REVIEW_VERDICT=PASS

## Local verification
Only `dev-memo/plan-forms-t3-evidence-catalog-00.md` (new plan doc) is a product/design change; the rest are in-scope governance artifacts (`queue.*` + this review file). Raw samples remain untracked (`?? dev-memo/run/intake/`) and are NOT staged. Forbidden-scope scan: NONE — no `apps/**`, `native/**`, `services/**`, schema, tests, `package.json`/lockfile, fixtures, IPC, renderer, DOCX/PDF generation, A8, forms-impl, custody, or JS-shim change; no edit to ADRs / product docs / forms-spec note / deferred-findings. `scripts/workflow/check-queue.sh` → PASS. `scripts/workflow/check-contract-integrity.sh` → PASS. No full desktop suite (docs-only). `CURRENT_SCHEMA_VERSION` unchanged; `dev-memo/run/evidence/**` untouched. Batch 1/3 (marker `e871d4d`) — not due.

## Deferred findings
None. Both review Lows were fixed forward into the plan document in this lane (S0 ADR decision items). The plan authorizes no implementation; the future T3 implementation WI is BLOCKED pending the S0 schema ADR; DOCX generation is additionally blocked on the renderer decision.
