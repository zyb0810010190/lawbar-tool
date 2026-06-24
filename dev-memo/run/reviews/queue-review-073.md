# Queue review 073 — WI-A3-PAGE-00 (DocumentPage/DocumentPageGeometry foundation + A3-SCHEMA-00 reconciliation; design-only, NOT A0.7-gated)

**Date**: 2026-06-23.
**WI**: WI-A3-PAGE-00 — reconcile A3-SCHEMA-00 with the verified case-box-persistence substrate (no FKs; no
DocumentPage/DocumentPageGeometry tables) and define the prerequisite page/geometry foundation, sequencing it
BEFORE A3-T1-IMPL (Option C). **Design/ADR only**: no schema/migration/code/dependency/FK-change/encryption/UI.
**Classification under review**: docs-only; carries NO `Requires-A07:` line — intentionally NOT A0.7-gated.
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `75c13cee3ef8f49a859e48ad1e179c280455014de6f8e20178afbf947748e227`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; resolves a source conflict + governs eventual HIGH-RISK foundation/persistence work).
- **Target scope**: `dev-memo/run/queue.md` WI-A3-PAGE-00 block (compact packet inlined) + the conflict + the
  reconciliation/sequencing decisions.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqraib59-epso96`.
- **threadId**: none emitted.
- **rawOutput sha256**: `22929374ee0f5acf29a95897932902799a067fa9fe23f7cf3342c6ead3fe6afd`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**A07-CLASSIFICATION: CONFIRMED-DESIGN-ONLY-NOT-GATED.** **SEQUENCING: OPTION-C-PREREQUISITE-FIRST-OK.**
Codex confirmed: (1) a design-only reconciliation WI is rightly not gated while the future DocumentPage /
DocumentPageGeometry / A3-T1-IMPL implementation WIs are; (2) translating ADR "FK ->" to NOT NULL columns +
app-layer invariants is the correct reconciliation, and a narrow note amending the merged A3-SCHEMA-00 is the
right repair (leaving it contradicting the substrate would force future implementers to fail or silently
violate convention); (3) DocumentPage + DocumentPageGeometry are true prerequisites (anchors can't bind
citation identity without a page-identity owner, nor geometry provenance without a geometry-version owner) —
Option C (foundations first) is correct; (4) the owner-field sets are complete at design level and excluding
viewport/screen is correct; (5) no scope creep into implementation/migration/dependency/FK-change/encryption/UI;
the A3-DB-00 encryption hard stop + Evidence invariants are not weakened.

## Finding to fold into the ADR
- **Low — name the app-layer page-identity invariant explicitly.** Because SQLite FKs are out of scope, the
  ADR MUST state the exact app-layer invariant binding `DocumentPageGeometry` to page identity: every
  `DocumentPageGeometry` row's `(documentId, physicalPageIndex)` MUST reference the SAME canonical page
  identity owned by `DocumentPage` (`UNIQUE(documentId, physicalPageIndex)`) — NOT a parallel/second page
  identity path; `geometryCapturedAt` is the version within that page. RESOLVED in the ADR; verified by
  `/cc-suite:verify`.

## Disposition
READY → eligible to govern. The Low is a design-content clarification authored into the ADR in this lane and
confirmed by the post-authoring broker audit + verify; it is not a scope change into
implementation/migration/dependency/FK-change/encryption/UI (no stop-and-ask trigger fired). Proceeding to
mark-reviewed + govern (standalone, content-bound to sha `75c13cee…`). After authoring, broker
`/cc-suite:audit` + `/cc-suite:verify` run on the design packet before the design commit.

QUEUE_REVIEW_VERDICT=PASS
