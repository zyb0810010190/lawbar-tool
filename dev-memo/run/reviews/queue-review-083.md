# Queue review 083 — WI-A3-UNLINK-00 (unlink/break-link workflow design; design-only, NOT A0.7-gated)

**Date**: 2026-06-25.
**WI**: WI-A3-UNLINK-00 — author the unlink/break-link workflow ADR (+ a dev-memo plan): how a link is
intentionally detached from an anchor without deleting the anchor (A3-CASCADE-00 §4: separate, explicit, never
an implicit cascade), BEFORE any unlink behavior. **Design/ADR only**: no code, no schema/migration, no
unlink/delete implementation, no resolver/export/delete-guard change, no UI, no dependency, no marker/key/gate
change.
**Classification under review**: docs-only; carries NO `Requires-A07:` line — intentionally NOT A0.7-gated.
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `4ff40db745bbbbc4ac1f7bbf39caa4dfe8783b7082b6ec7870ef802864696ab5`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; governs eventual HIGH-RISK destructive unlink over court-facing evidence links).
- **Target scope**: `dev-memo/run/queue.md` WI-A3-UNLINK-00 block (compact packet inlined) + the KEY durable-unlink
  finding + the 8 decisions.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqto7gr6-l4mtez`.
- **threadId**: none emitted.
- **rawOutput sha256**: `a6e2da88dc0123955b49c352ea891fa915837f28c5cbfdce2c1d0f4cc5c75a43`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**A07-CLASSIFICATION: CONFIRMED-DESIGN-ONLY-NOT-GATED** — a docs-only ADR/plan changing no schema/code/gate/
marker/resolver/export/UI is correctly NOT gated; any future unlink IMPL is `Requires-A07: yes` (custody 9b).
**DURABLE-UNLINK-FINDING: CONFIRMED-NEEDS-SCHEMA-WI** — Codex confirmed the load-bearing finding: V11
`case_box_links.anchor_id` is NOT NULL and status is `valid|needs_review|broken` (no `unlinked`); the resolver
computes status from structural state (`ELSE 'valid'`) and export calls `resolveLinkStatuses()` first, so a
status-only unlink would be overwritten back to `valid` while the anchor/page/geometry are still valid. Gating
the first unlink implementation on a durable-unlink schema/mechanism WI is the right call (vs forcing the
physical-link-delete alternative that loses the link row). Also confirmed: the workflow preserves citation trust
(no implicit cascade; anchor/link preserved; degraded non-clean export); audit-as-predecessor for the future
destructive unlink is correct (unlink changes the evidentiary binding even with rows preserved); keeping the
durable-unlink schema + soft-delete + unreferenced-delete out of this lane is correct; no scope creep / no
A3-DB-00 hard-stop weakening.

## Findings to fold into the ADR (two Lows — design content, no scope change)
- **Low L1 — do NOT conflate explicit-unlink with today's `broken`.** Today's `broken` is resolver-computed from
  structural inconsistency (a corruption/missing-target safety net), NOT a stable explicit-unlink marker. The ADR
  MUST state that the future explicit unlink needs its OWN durable reason/status/source that the resolver respects
  and that export maps to a non-clean state — it is a distinct concept from the resolver's `broken`. RESOLVED in
  the ADR.
- **Low L2 — link-preservation is MUST for the recommended durable path.** Strengthen "SHOULD remain" to: the
  link row MUST remain for the recommended durable (link-preserving) path, UNLESS a future reviewed policy
  explicitly chooses physical link deletion (the recorded alternative). RESOLVED in the ADR.

## Disposition
READY → eligible to govern. C0 H0 M0; the two Lows are design-content clarifications authored into the ADR in this
lane and confirmed by the post-authoring broker audit + verify; neither is a scope change into
code/schema/unlink-impl/delete/UI/dependency (no stop-and-ask trigger). A07-classification
CONFIRMED-DESIGN-ONLY-NOT-GATED; DURABLE-UNLINK-FINDING CONFIRMED-NEEDS-SCHEMA-WI. Proceeding to mark-reviewed +
govern (standalone, content-bound to sha `4ff40db7…`). After authoring, broker `/cc-suite:audit` +
`/cc-suite:verify` run on the design packet before the design commit.

QUEUE_REVIEW_VERDICT=PASS
