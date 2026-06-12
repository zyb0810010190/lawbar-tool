# Queue review 036 — WI-DPE5 (BATCH-CASEBOX-DOCKET-PROPOSAL-EDIT-UI-00)

**Date**: 2026-06-12.
**WI**: WI-DPE5 — renderer UI edit affordance for a proposed docket entry (terminal UI layer).
**Queue**: `dev-memo/run/queue.md`.
**Reviewed queue.md sha256 (post-fold)**: `d2f8476889813c2e1e62086519eedb162af6c2372229bd3bbdaafd5f4b7ac7b2`.
**Pre-fold sha256 (sent to broker)**: `b58fd16b7abb3824c39598a90ab47376e8ee6514182c5181680974fcb93d18a2`.
**Design artifact**: `dev-memo/design/2026-06-12-docket-proposal-edit-ui.md` (design commit `56e19b4`).
**Plan**: `dev-memo/plan-batch-casebox-docket-proposal-edit-ui-00.md`.

## cc-suite invocation (required recording)

- **Kind**: review-plan.
- **Target scope**: queue.md WI-DPE5 block + plan + design artifact + ADR (`docs/adr/docket-proposal-edit.md`), file-scoped prompt.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs` (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqaiq0th-mw0jj0`.
- **threadId**: none emitted.
- **Result location**: `${CLAUDE_PLUGIN_DATA}/state/lawbar-tool-8153f46e0d61e5fb/jobs/review-plan-mqaiq0th-mw0jj0.json`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, completed with rawOutput).
- **Failure classification**: none (succeeded first attempt; no timeout).
- **Retry attempts**: 1 (single attempt, FULL focused packet).

## Verdict

**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.

All six review questions answered YES (renderer-bridge ownership in DPE5 correct; security posture
defense-in-depth with main as authority; `revised_at` display-only; "(edited)" badge consistent with ADR §6;
sibling-split LOC mitigation adequate; review-plan-first gate + UI tier judgment correct).

## Low-risk clarifications (folded into the queue before govern)

- **Low #1 — `reminder_offsets` passthrough**: coherent and safer than omission (omitting could risk schema
  rejection or accidental blanking). Impl MUST pass the projected row value through **as data, not a
  UI-serialized string**, and tests MUST assert **both** the unchanged `null` case and the non-empty array
  case. → Folded into Acceptance criteria ("PASSED AS DATA … asserted for BOTH the null case and the
  non-empty array case (review-036 Low #1)").
- **Low #2 — sibling-split ownership boundary**: the optional `viewMatterDocketProposalEdit.ts` split is a
  good LOC mitigation **only if** it stays purely presentational — it may own form DOM, validation, and
  save/cancel callbacks, while `viewMatterDocketProposals.ts` retains row/list lifecycle, pagination, the
  generation guard, and refresh ownership. → Folded into Scope ("The sibling, if split, owns ONLY the form
  DOM, field validation, and the save/cancel callbacks; viewMatterDocketProposals.ts RETAINS row/list
  lifecycle, pagination, the loadGen generation guard, and refresh ownership (review-036 Low #2)").

Both are non-blocking tightenings; no design change. The queue was re-linted after folding (PASS), so the
governed sha binds the post-fold content.

## Disposition

READY with two folded Low clarifications → eligible to govern. Proceeding to mark-reviewed + govern
(standalone, content-bound to sha `d2f8476889813c2e1e62086519eedb162af6c2372229bd3bbdaafd5f4b7ac7b2`).
Implementation is NOT authorized by this review — it begins only on an explicit user instruction.

QUEUE_REVIEW_VERDICT=PASS
