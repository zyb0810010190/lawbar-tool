# Queue review 090 — WI-A3-LINK-CREATE-DESIGN-00 (design ADR for the audited link-create operation; NOT A0.7-gated)

**Date**: 2026-06-26.
**WI**: WI-A3-LINK-CREATE-DESIGN-00 — produce a DESIGN-ONLY ADR
(`docs/adr/ADR-evidence-a3-link-create-operation.md`) for the still-missing audited link-CREATE operation, the
prerequisite before any UI/IPC unlink/relink wiring (links today exist only via tests/raw SQL). Authorizes no code.
**Classification under review**: PLAN (design-only ADR), **NOT A0.7-gated** (authorizes no code; executes no
A0.7-dependent code; reads no marker), but it GOVERNS eventual HIGH-RISK work (a persistence mutation + a public
audit-contract kind), so broker review-plan + audit + verify are REQUIRED on the design.
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `9497034cec87ebb3b50b79bb3f832f4125f33371a09e97a6b250ad06de3ba5ce`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; governs a design that precedes a HIGH-RISK persistence + audit-contract change).
- **Target scope**: `docs/adr/ADR-evidence-a3-link-create-operation.md` (decisions D1-D10) + the
  `dev-memo/run/queue.md` WI block + the audit-log/schema/resolver references + the 5 review questions (A-E).
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqulyvvh-fizwu7`.
- **threadId**: none emitted.
- **rawOutput sha256**: `dbdda775e65c7035704b8242633b16161d2630142b3ed16a302de2561eda32ea`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY.** Critical: none. High: none. Medium: none. One Low (clarity, fixed).
Scores: internal-consistency 4.5/5, completeness 4/5, feasibility 4.5/5, ambiguity 4/5, risk-and-sequencing 4.5/5.

- **A. CLASSIFICATION: CONFIRMED-DESIGN-NOT-GATED** — design-only + NOT A0.7-gated is correct (no code, no
  A0.7-dependent behavior, no marker); review/audit/verify still required because the design governs future
  high-risk work.
- **B. D1 (NEW KIND): CONFIRMED** — the only link kinds are LINK_UNLINKED/LINK_RELINKED (both action:update); no
  existing kind covers creation; a NEW `LINK_CREATED { action: create, entity_type: link, reasonRequired: false }`
  is required, added by a SEPARATE predecessor contract WI (not inline). Reusing an update kind would break the
  verifier's tuple integrity.
- **C. D7 (NO SCHEMA): CONFIRMED** — create is a plain INSERT into the existing V11 case_box_links; no
  schema/CURRENT_SCHEMA_VERSION change; the declined logical-duplicate UNIQUE index is correctly out of scope.
- **D. API/VALIDATION/STATUS: SOUND** — concrete-class createLink (SQLite-only); provisional needs_review (valid
  never a default); status excluded from the audit hash (matches linkStateForHash); single stamp; transactional
  one-event-per-create; before_state_hash null. Anchor REQUIRE-EXISTS confirmed the better v1 choice (prevents
  knowingly creating broken audited links; allow-dangling is technically possible but worse).
- **E. SEQUENCING/SEPARATION: CONFIRMED** — the immediate next lane MUST be the audit-kind contract WI (the impl
  cannot emit LINK_CREATED before the contract knows it); persistence impl follows (A0.7-gated); IPC/UI + export
  rendering are later independent WIs; the layers are not collapsed.

## Finding applied (one Low — clarity; no scope change)
- **Low — duplicate-id wording.** `CreateLinkInput` carries no `id` (always generated via `deps.generateId()`), so
  the prior "caller-supplied colliding id" wording was imprecise. FIXED in the ADR: D4 now states the operation
  defensively checks the GENERATED id for collision → `duplicate_id` with no row/event (fail-closed on generator
  misuse), and §9 tests reference a "generated-`id` collision". No design change.

## Disposition
READY → eligible to govern. C0 H0 M0; the one Low (duplicate-id wording) is applied in the ADR and confirmed by
the post-authoring broker audit + verify. DESIGN-ONLY; NOT A0.7-gated. The ADR adds NO LINK_CREATED kind (that is
the predecessor WI), changes NO schema, and implements NO code. Proceeding to mark-reviewed + govern (standalone,
content-bound to sha `9497034c…`). The NEXT LANE per the ADR is the audit-kind contract WI
(WI-A3-LINK-CREATE-AUDIT-KIND), NOT the persistence impl.

QUEUE_REVIEW_VERDICT=PASS
