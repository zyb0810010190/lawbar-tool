QUEUE_REVIEW_VERDICT=PASS

# Queue review — BATCH-CASEBOX-FACT-REVIEW-00, WI-804 (fact review UI)

- WI-804 (Type UI, Depends: WI-802) — the renderer half of the fact-review batch: wire the bridge for the merged casebox:fact:transition channel (WI-802) + add per-fact Review/Accept/Reject controls + review-state rendering to the Facts disclosure, per the committed design artifact dev-memo/design/2026-06-05-casebox-fact-review.md (WI-803, commit b105863). No backend/contract/persistence change.
- Design artifact present + committed: dev-memo/design/2026-06-05-casebox-fact-review.md (satisfies the UI-GATES.md Type:UI gate).
- Legal-edges-only controls (candidate: Review/Reject; reviewed: Accept/Reject; accepted/rejected terminal; NO candidate->accepted — the no-auto-accept ADR; server illegal_transition surfaced inline). Renderer forwards only { matterId, factId, to, rejection_reason? }; server injects reviewer + timestamps + computes lifecycle. Reject requires a non-empty reason (never sent for Review/Accept). Status text-first (not color-only). Reuses the WI-701 listContainer/loadGen stale-load guard + refresh-in-place.
- cc-suite review-plan job: review-plan-mq1n7pks-secu8y (Path 1 runner v0.2.18, gpt-5.5, effort high, sandbox read-only).
- Codex verdict: READY-WITH-LOW — no Critical / High / Medium. One Low: refresh-in-place reloads facts from the FIRST page, so a transitioned row on a later page may reset pagination — ACCEPTED for this slice; the acceptance criteria explicitly forbid asserting pagination preservation across a transition refresh (recorded in the WI-804 block).

# Confirmations
- Queue-lint (check-queue.sh) PASSED on the live queue (WI-802 done + WI-804).
- WI-804 changes only renderer + bridge + new dedicated test file; Forbidden-files protect the deadline UI, renderer-view-matter.test.mjs (loc-guardian margin), renderer-fact-write.test.mjs, the shared _view-matter-dom.mjs harness, src/caseBox, caseBoxHandlers.ts, services, and contracts.
- Breaker note (Option A): WI-804's governance commit makes commits-since-marker == 3; an interim batch closeout over b6c0b8d..<this governance commit> runs IMMEDIATELY after governance to advance the marker and restore headroom BEFORE the WI-804 implementation commit (the sanctioned breaker-reset mechanism; not a prohibited cleanup commit).
- No migrations / infra-prod / secrets / new runtime dependency / contract-schema change / persistence src change.
