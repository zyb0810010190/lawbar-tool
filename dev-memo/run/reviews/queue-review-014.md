QUEUE_REVIEW_VERDICT=PASS

# Queue review — BATCH-CASEBOX-DOCKET-LIFECYCLE-00 (WI-D1…WI-D4): pending docket proposals read + dismiss

- Fresh governed queue (the closed WORKFLOW-GOVERNANCE-INTEGRITY-00 queue replaced). Product slice: surface durable PENDING docket proposals after reload (read) + DISMISS/cancel proposals. Deadline status-transitions, edit-in-place (no contract op; needs ADR), and reminders/scheduling are OUT of scope; NO persistence/contract change (everything downstream already exists).
  - **WI-D1 (IMPL/IPC)** — `casebox:docket:list` read handler over the existing `listDocketEntries`, projected through the existing `DOCKET_ENTRY_RESPONSE_FIELDS`. No renderer → no design artifact.
  - **WI-D2 (IMPL/IPC)** — `casebox:docket:dismiss` fail-closed scoped handler; PROPOSED-only (confirmed-entry dismissal out of scope — would orphan a materialized deadline); server-injected actor/timestamp; forbidden-field rejection; mandatory projection. No design artifact.
  - **WI-D3 (ASSET/design)** — `dev-memo/design/2026-06-06-casebox-docket-pending-dismiss.md` (doc-only). Satisfies WI-D4's renderer-path design gate.
  - **WI-D4 (UI)** — renderer bridge + pending-proposals list + per-proposal Dismiss control; design-gated by WI-D3; LOC-extraction contingency for `viewMatterDeadlines.ts` (528→800 cap). Depends on D1+D2+D3.
- Proposal: `dev-memo/plan-batch-casebox-docket-lifecycle-00.md` (left untracked; the governed queue is the authority).
- cc-suite review-plan: initial `review-plan-mq218vc4-7l4iil` returned **NEEDS-FIX** (1 Medium + 1 Low); re-review `review-plan-mq21baq8-wnu3o7` returned **PASS** after the fixes (Path 1 runner v0.2.18, gpt-5.5, effort high, sandbox read-only).
- Findings fixed BEFORE governance:
  - **Medium (WI-D2 confirmed-entry dismissal)**: narrowed to PROPOSED-only — after the scoped `getDocketEntry` preflight and BEFORE any persistence dismiss, the handler asserts `confirmation_state === "proposed"` and rejects (fail closed) confirmed/already-dismissed entries; a test enforces a confirmed entry cannot be dismissed. Rationale: dismissing a confirmed entry would orphan its materialized deadline (separate slice + consistency decision).
  - **Low (mandatory projection)**: WI-D1 + WI-D2 acceptance now require `projectRow(…, DOCKET_ENTRY_RESPONSE_FIELDS)` on every success path with an explicit no-leak test (no `tenant_id`/`actor_user_id`/`confirmation_actor_user_id`/`dismissal_actor_user_id`).

# Confirmations
- Queue-lint (check-queue.sh) PASSED on the amended live queue (4 WIs), including the Type-UI `Design artifact:` requirement on WI-D4 (concrete reference to the WI-D3 artifact path).
- Allowed files do not intersect `dev-memo/run/forbidden-paths.txt` (secrets/infra/migrations only).
- Slice boundary holds: no edit / deadline-transition / reminders; no `services/**` or `docs/contracts/**`; no new runtime dependency; no migrations.
- Dependency order coherent (D4 depends on D1, D2, D3). Authority boundary on the dismiss handler (server-injected actor/timestamp, forbidden-field rejection, fail-closed scoped preflight, proposed-only) explicit. List handler cannot leak stripped fields (mandatory projection + test).
