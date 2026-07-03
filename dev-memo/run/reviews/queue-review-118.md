# Queue review — WI-FORMS-SPEC-A10-T3-T5-SAMPLE-ADR-00

Lane: forms-spec design note from real T3/T5 samples (Type: PLAN; documentation / design / spec only — LOW-RISK, no code/native/schema/test/fixture/IPC).
Date: 2026-07-02. Branch: `evidence-forms-spec-a10-t3-t5-sample-adr` (from synced `main` @ `1cbe4af`). Batch: 1/3 since marker `a68584d` — no batch closeout this lane.

## What this is
Adds ONE design note `dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md` grounding the still-gated A10-T3/T4/T5 forms in two REAL user-provided samples (untracked input under `dev-memo/run/intake/forms-samples/`, NOT committed): the T3 证据目录及说明 PDF and the T5 质证意见 DOCX. It records the observed T3 four-column table (序号/证据名称/证明内容/页码 — with 页码 = physical bundle page ranges, not 卷X页Y) + header/footer/signature block; the observed T5 narrative 三性 pattern (per-opposing-evidence 真实性/合法性/关联性 + 证明目的 + reasons); marks T4 under-specified (missing proof-model); recommends the sequence T3 → T5 → T4; and states explicit non-decisions + open questions. It authorizes NO implementation.

## cc-suite recording (per .claude/rules/cc-suite.md §"Required recording")
### review-plan
- Kind: review-plan · Path 1 runner 0.2.18, gpt-5.5/high/read-only · Job ID `review-plan-mr4d6rz2-dyd1os` · completed (retrievable YES) · **READY-WITH-LOW** · rawOutput sha256 `3a0089e9d96f7de65bfa30a0bd2be5a4929398ee33d9efbb9d3c18dc90bd520e`.
- Confirmed: the note is accurate to the samples — T5 is directly supported by the DOCX (case-number header, 质证意见, salutation, per-opposing-evidence 三性 positions + 证明目的 + statute citations + party evidence references); T4 is correctly left under-specified; the 页码 physical-range vs 卷X页Y conflict is correctly flagged as an OPEN decision (not silently chosen); T3-first is sound (table/header/footer over mostly existing catalogue data); the non-decisions + open questions are strong enough to prevent treating this as approval; treating the raw samples as untracked input-only is correct. (T3 PDF has no text layer — the note's structure was captured by the author via the Read tool's visual PDF render, pages 1–2; the reviewer independently OCR-confirmed a table-like structure + physical page ranges 1-5/10-11/29-30/41-49.)
- **Low (expected, no content fix):** the review-packet's "only the design note is new" phrasing is imprecise — the worktree also has `dev-memo/run/queue.md` + `queue.linted` modified (governance bookkeeping, IN scope) plus pre-existing untracked residue and the untracked raw samples. **Resolution:** commit exact allowed paths only (the design note + governance); the raw samples under `dev-memo/run/intake/**` and all residue remain unstaged. Staging hygiene, not a content defect.

### audit / verify
- N/A for this docs-only PLAN design note: there is no product-code diff to audit (per `.claude/rules/cc-suite.md` §"Low-risk WIs", a separate `/cc-suite:audit` is not required for a docs-only design note). The review-plan validated the note's content/accuracy; the always-loaded contract docs are untouched (`check-contract-integrity` PASS).

## Verdict: READY-WITH-LOW → Low is staging hygiene (commit exact paths; raw samples stay untracked)

QUEUE_REVIEW_VERDICT=PASS

## Local verification
Only `dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md` is a new relevant file (plus the in-scope governance artifacts). The raw sample files remain untracked (`?? dev-memo/run/intake/`) and are NOT staged. Forbidden-scope scan: NONE — no `apps/**`, `native/**`, `services/**`, schema, tests, `package.json`/lockfile, fixtures, IPC, A8, forms-impl, custody, or JS-shim change; no edit to the A10 closeout doc / product docs / ADR / deferred-findings. `scripts/workflow/check-queue.sh` → PASS. `scripts/workflow/check-contract-integrity.sh` → PASS (14 docs). No full desktop suite (docs-only). `CURRENT_SCHEMA_VERSION` unchanged; `dev-memo/run/evidence/**` untouched.

## Deferred findings
None. The review-plan Low is expected governance/staging hygiene (resolved by exact-path staging; raw samples untracked), not a content defect. T4 and T5 remain design-gated by the note itself (open questions); T3 becomes PLAN-WI-eligible only after this note is governed AND its T3 open questions are answered — this note authorizes no implementation.
