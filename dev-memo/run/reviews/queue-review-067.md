# Queue review 067 — WI-A3-00 (anchor/link engine contract design; design-only, NOT A0.7-gated)

**Date**: 2026-06-23.
**WI**: WI-A3-00 — author the A3 anchor/link engine CONTRACT DESIGN packet (ADR + dev-memo plan) before any
implementation. Convert the handover's A3 model into repo-local ADR/spec boundaries: A3 invariants, headless
API contracts (signatures only), first implementation WI sequence, test fixtures, failure classes, stop
conditions. **Design/docs only**: no code, no schema/migration, no dependency, no marker/key handling.
**Classification under review**: this docs-only WI carries NO `Requires-A07:` line — intentionally NOT
A0.7-gated (user reclassification 2026-06-23, overriding the prior "must include Requires-A07: yes"
instruction). All FUTURE A3 implementation WIs MUST declare `Requires-A07: yes` + pass the A0.7 hard gate.
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `d5b609f346a95473bf5740e3ffbae06556275479321720d25e5c148066a9fac8`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; the design governs eventual HIGH-RISK anchor/persistence/native work).
- **Target scope**: `dev-memo/run/queue.md` WI-A3-00 block (compact packet inlined) + the A3 invariants /
  headless API contracts / classification decision.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqqpew61-aef001`.
- **threadId**: none emitted.
- **rawOutput sha256**: `4a34acc1e7e927f374bf69d0e238c0ff567c7138ead1174bf562bbb9ee803a22`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none.
**A07-CLASSIFICATION: CONFIRMED-DESIGN-ONLY-NOT-GATED** — Codex confirmed it is sound that a docs-only
contract-design WI is NOT A0.7-gated while every A3 implementation WI IS (Requires-A07: yes + provenance-valid
marker); requiring a live marker to author an ADR would conflate provenance-gated execution with design
documentation. Codex also confirmed: (2) headless normalization math (A3-T2) FIRST, before schema/persistence
(A3-T1) — "the schema should encode stable semantics, not discover them"; (3) leaving the anchor-delete cascade
(A3-T6) explicitly unresolved is the disciplined choice given the source leaves it undecided.

## Findings to fold into the design packet
- **Medium — deterministic ratio precision + fail-closed provenance.** The ADR MUST record (a) deterministic
  precision/rounding semantics for persisted `page_ratio` rects + an explicit roundtrip tolerance (else two
  correct-looking implementations disagree → false `needs_review`, unstable exports, link drift); and (b) link
  resolution MUST fail closed when required geometry provenance is absent OR ambiguous, not only when it
  mismatches. Both are design content authored into the ADR within this lane (no code). RESOLVED in the ADR
  (A3 invariants + the resolve-link contract), verified by `/cc-suite:verify` after authoring.
- **Low — enumerate the 10 decisions.** Avoid checklist-shaped ambiguity by enumerating all ten required
  design decisions explicitly. Already enumerated 1–10 in the queue block's "Required design decisions to
  record" field; the ADR + plan mirror the same enumerated list. RESOLVED.

## Disposition
READY → eligible to govern. The Medium + Low are design-content items authored into the ADR/plan in this same
lane and confirmed by the post-authoring broker audit + verify; neither is a scope change into
implementation/UI/DB-dependency/native/key-marker (no stop-and-ask trigger fired). Proceeding to mark-reviewed
+ govern (standalone, content-bound to sha `d5b609f3…`). After authoring, broker `/cc-suite:audit` +
`/cc-suite:verify` run on the design packet before the design commit.

QUEUE_REVIEW_VERDICT=PASS
