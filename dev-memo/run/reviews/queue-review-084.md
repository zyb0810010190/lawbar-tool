# Queue review 084 — WI-A3-UNLINK-SCHEMA-00 (durable-unlink schema mechanism design; design-only, NOT A0.7-gated)

**Date**: 2026-06-25.
**WI**: WI-A3-UNLINK-SCHEMA-00 — author the durable-unlink schema-mechanism ADR (+ a dev-memo plan) that decides
HOW an explicit unlink is durably represented (resolving the A3-UNLINK-00 finding) so the resolver/export can
distinguish it from structural `broken`, before any schema implementation. **Design/ADR only**: no schema/DDL/
migration code, no resolver/export/delete-guard change, no dependency, no marker/key/gate change.
**Classification under review**: docs-only; carries NO `Requires-A07:` line — intentionally NOT A0.7-gated.
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `f1f3aba2f53b51851fb1d5479d1101b7a3a59183404256dc32705a77c8f0607e`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; governs an eventual HIGH-RISK V12 schema migration + resolver/export change).
- **Target scope**: `dev-memo/run/queue.md` WI-A3-UNLINK-SCHEMA-00 block (compact packet inlined) + the 5
  mechanism options + the 10 decisions.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqu4xxym-rdv1pz`.
- **threadId**: none emitted.
- **rawOutput sha256**: `fad1ef04beb3feabf45222c7fc7fe9c0c6b5db5c22d0079f46cb479c08d10db4`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**A07-CLASSIFICATION: CONFIRMED-DESIGN-ONLY-NOT-GATED** — a docs-only ADR/plan changing no schema/resolver/
export/dependency/marker/gate is correctly NOT gated; the future V12 migration/resolver/export IMPL is
`Requires-A07: yes` (custody 9b).
**MECHANISM: OPTION-1-MARKER-COLUMNS-SOUND** — Codex confirmed option 1 (durable unlink marker/reason columns on
`case_box_links`, preserving `anchor_id` + the link row, resolver respects the marker) is the right M0 mechanism:
it preserves `anchor_id`, link-row history, A3 identity, and A10 no-drop while avoiding the enum churn of adding
`unlinked` to LinkStatus and the identity loss of a nullable `anchor_id`; a separate lifecycle table is heavier.
Keeping `anchor_id NOT NULL` + `LinkStatus = valid|needs_review|broken` is sound (explicit unlink is lifecycle/
audit state, not structural validity). V11->V12 additive migration is correct (existing rows default to
not-unlinked, no rewrite, `CURRENT_SCHEMA_VERSION` stays 11 in this lane). Deferring the exact DDL, export flag,
audit shape, unlink operation, and physical-link-delete policy is correct, provided the ADR chooses the mechanism
and records non-clean export as mandatory.

## Findings to fold into the ADR/plan (three Lows — design content, no scope change)
- **Low L1 — the marker is a hard OVERRIDE (read by export, not only `status`).** With LinkStatus unchanged, the
  unlink marker MUST be an override that prevents a clean export even if the structural inputs remain valid. The
  future export code MUST read the marker (not only `status`), or the resolver-first export shape could still
  clean-export a marked link. The ADR MUST state: the resolver does not recompute a marked link to valid AND the
  export reads the marker to flag it distinctly (a non-clean flag, distinguishable from structural `broken`),
  never clean. RESOLVED in the ADR (decisions 4/5).
- **Low L2 — tight, non-enum marker shape.** Prefer a nullable `unlinked_at` (marker present iff NOT NULL) +
  a required `unlink_reason` (when unlinked) over an extensible `unlink_status` lifecycle enum, so it does not
  become a second status ladder (unless the ADR deliberately wants lifecycle expansion — it does not for M0).
  RESOLVED in the ADR (decision 1 column shape).
- **Low L3 — terminal-until-relink invariant (future V12).** The future V12 WI MUST spell out: an unlinked link
  is terminal-until-relink; relink clears the marker atomically and re-runs/recomputes status; unlink is NEVER
  represented by overloading structural `broken`. RESOLVED in the ADR (app-layer invariants) + the plan.

## Disposition
READY → eligible to govern. C0 H0 M0; the three Lows are design-content refinements authored into the ADR/plan in
this lane and confirmed by the post-authoring broker audit + verify; none is a scope change into
schema/DDL/resolver/export/dependency (no stop-and-ask trigger). A07-classification CONFIRMED-DESIGN-ONLY-NOT-GATED;
MECHANISM OPTION-1-MARKER-COLUMNS-SOUND. Proceeding to mark-reviewed + govern (standalone, content-bound to sha
`f1f3aba2…`). After authoring, broker `/cc-suite:audit` + `/cc-suite:verify` run on the design packet before the
design commit.

QUEUE_REVIEW_VERDICT=PASS
