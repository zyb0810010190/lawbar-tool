QUEUE_REVIEW_VERDICT=PASS

# Queue review — BATCH-CASEBOX-FACT-REVIEW-00, WI-802 (fact transition IPC)

- Fresh governed batch (BATCH-CASEBOX-FACT-REVIEW-00) replacing the CLOSED BATCH-CASEBOX-UI-00 queue. WI-802 is the only current implementation WI; review UI (bridge + controls) is the separate design-gated WI-804, deferred.
- WI-802 (Type IMPL, Depends: none): add CHANNEL.factTransition ("casebox:fact:transition") + transitionFactHandler consuming the ALREADY-EXISTING persistence transitionFact + getFact and the contract status enum. Renderer DTO { matterId, factId, to, rejection_reason? }; server injects reviewer_actor_user_id + at; fail-closed scoped getFact({tenant_id, matter_id, fact_id}) preflight before the unscoped transitionFact (mirrors WI-601 docket-confirm); dedicated renderer-safe projection; domain transition rules + illegal_transition stay in persistence (surfaced, not re-implemented). New tests/ipc-fact-handlers.unit.test.mjs (NOT the 1534-LOC ipc-handlers.unit.test.mjs) wired into the gate.
- Proposal input: dev-memo/plan-batch-casebox-fact-review-00.md (untracked scratch; not part of the governance mechanism).
- cc-suite review-plan job: review-plan-mq1lrx4k-pe42tb (final; Path 1 runner v0.2.18, gpt-5.5, effort high, sandbox read-only).
- Codex verdict: READY TO GOVERN — no Critical / High / Medium.
- Review history (the loop caught real correctness issues, all resolved before governance):
  - review-plan-mq1loihw-mgoinb: NEEDS-FIX — Critical (candidate->accepted is ILLEGAL per the contract/ADR no-auto-accept + persistence conformance; the acceptance wrongly implied it returns ok) + 2 Medium (rejection_reason must be absent unless to===rejected; capture activeTenant/actor/at once per invocation). Fixed in the queue block.
  - review-plan-mq1lrx4k-pe42tb: READY TO GOVERN — corrected transition matrix (candidate->reviewed/rejected ok; reviewed->accepted/rejected ok; candidate->accepted illegal_transition) confirmed against docs/adr/case-box-step-2-fact-promotion-and-provenance.md + docs/contracts/case-box-contract/tests/state-machine.test.mjs; both Mediums resolved.

# Confirmations
- Queue-lint (check-queue.sh) PASSED on the live queue (1 WI: WI-802).
- Contract + persistence already provide the lifecycle (status enum + transitionFact + getFact); WI-802 adds ONLY the IPC channel/handler/DTO — no contract-schema or persistence-src change.
- Security-boundary (tenant-scoped write; fail-closed scoped getFact preflight closing a cross-matter/cross-tenant transition bypass; allowlisted renderer-safe projection; server-injected reviewer/timestamp). Per-WI broker review-plan + audit + verify required at implementation time.
- Pre-existing critical LOC finding: tests/ipc-handlers.unit.test.mjs = 1534 LOC (over the 1200 test-fail threshold + past the 1500 critical line). WI-802 is FORBIDDEN from touching it; its tests go in the new dedicated tests/ipc-fact-handlers.unit.test.mjs. A separate bounded TEST-split WI for the monolith is recommended in the proposal (WI-805, independent) — NOT part of WI-802.
- No migrations / infra-prod / secrets / new runtime dependency / contract-schema change / persistence src change.
