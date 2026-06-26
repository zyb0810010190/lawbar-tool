# Queue review 088 — WI-A3-UNLINK-AUDIT-KINDS (contract support for link unlink/relink audit events; NOT A0.7-gated, HIGH-RISK contract)

**Date**: 2026-06-26.
**WI**: WI-A3-UNLINK-AUDIT-KINDS — additively add a `link` audit `entity_type` + the `LINK_UNLINKED` /
`LINK_RELINKED` audit-event kinds to the case-box-contract audit vocabulary (schema enum + `CASE_BOX_AUDIT_ENTITY_TYPES`
+ `CASE_BOX_AUDIT_EVENT_KINDS` + the regenerated type), governed by the audit-event-kind-preservation ADR, so the
future durable unlink/relink OPERATION (WI-A3-UNLINK-T1) can emit a tamper-evident audit event. CONTRACT-ONLY: no
emitter, no persistence change, no SQLite schema/version change, no resolver/export/UI change.
**Classification under review**: SOURCE (a CONTRACT / audit-event-kind change over the tamper-evident audit
vocabulary), **NOT A0.7-gated** (no geometry-derived A3 behavior; no marker/key) but **HIGH-RISK** (public-API /
audit-chain security) — broker review-plan + audit + verify REQUIRED.
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `0a3cd16a3146d094d6f883e3dc0e5cf1bd2817e55ebb1edf739bdef363aadb58`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; governs a HIGH-RISK public audit-contract / tamper-evidence change).
- **Target scope**: `dev-memo/run/queue.md` WI-A3-UNLINK-AUDIT-KINDS block (compact packet inlined) + the proposed
  kinds + the 6 review questions.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqugufiv-brs3tr`.
- **threadId**: none emitted.
- **rawOutput sha256**: `ab1ba4fe18ff1556eb899feb06a71db111ae87337ff84bb843f1c5fd64468ca2`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY.** Critical: none. High: none. Medium: none.
**A07-CLASSIFICATION: CONFIRMED-NOT-GATED-HIGH-RISK** — Codex confirmed: this adds audit vocabulary + tests but
executes no geometry-derived A3 behavior, reads no custody marker, and changes no resolver/export/persistence
behavior, so it is correctly NOT A0.7-gated; it is still correctly HIGH-RISK because it touches the public audit
contract + the tamper-evident kind registry (broker review-plan + audit + verify required).
**KINDS: AS-PROPOSED-OK** — `LINK_UNLINKED { action: "update", entity_type: "link", reasonRequired: true }` +
`LINK_RELINKED { action: "update", entity_type: "link", reasonRequired: false }` confirmed. `update` is correct
(the link row is updated with the marker, not created/deleted); `reasonRequired: false` for relink is acceptable
(it does not forbid a reason, only avoids mandating one; fits the row model where relink clears `unlink_reason`).
Also confirmed: the additions follow the audit-event-kind-preservation ADR (append-only; schema + TS + generated
kept in sync; no canonicalization change; the verifier enforces the tuple by the registry addition alone — no
verifier-logic change); CONTRACT-ONLY with the emitter deferred to WI-A3-UNLINK-T1 is correct (defining a kind
before its first emitter is the established pattern); no scope creep / no weakened audit tamper-evidence / no
A3-DB-00 hard stop.

## Findings to apply (two Lows — impl/test guidance; no scope change)
- **Low L1 — existing drift tests (heed + keep green).** `tests/audit-event-kind-v2.test.mjs` already asserts the
  schema `event_kind` enum equals the registry keys, and `tests/state-machine.test.mjs` asserts the schema
  `entity_type` enum equals `CASE_BOX_AUDIT_ENTITY_TYPES`. The additive schema + registry edits keep these green
  ONLY if the schema enums and the TS arrays/objects are edited in sync. Apply: add `link` to BOTH the schema
  entity_type enum AND `CASE_BOX_AUDIT_ENTITY_TYPES`; add `LINK_UNLINKED`/`LINK_RELINKED` to BOTH the schema
  event_kind enum AND `CASE_BOX_AUDIT_EVENT_KINDS`. If any snapshot-style assertion surfaces, update it ADDITIVELY
  only.
- **Low L2 — relink reason (confirmed).** `LINK_RELINKED.reasonRequired: false` is acceptable; do not mandate a
  relink reason unless a future operation policy requires one.

## Disposition
READY → eligible to govern. C0 H0 M0; the two Lows are implementation/test-guidance items (keep the drift tests
green by editing schema + TS in sync; relink reasonRequired false) applied in this lane and confirmed by the
post-implementation broker audit + verify; neither is a scope change into an emitter/persistence/SQLite-schema/
resolver/export/UI change (no stop-and-ask trigger). A07-classification CONFIRMED-NOT-GATED-HIGH-RISK; KINDS
AS-PROPOSED-OK. This lane has NO custody-9b gate (not A0.7-gated). Proceeding to mark-reviewed + govern (standalone,
content-bound to sha `0a3cd16a…`). After authoring, broker `/cc-suite:audit` + `/cc-suite:verify` run on the
implementation diff before the implementation commit.

QUEUE_REVIEW_VERDICT=PASS
