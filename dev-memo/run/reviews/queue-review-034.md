QUEUE_REVIEW_VERDICT=PASS

# Queue review — BATCH-CASEBOX-DOCKET-PROPOSAL-EDIT-PERSIST-00 (WI-DPE3 SOURCE, persistence)

Single WI-DPE3: the persistence layer (`editDocketEntry`, in-memory + SQLite) authorized by
`docs/adr/docket-proposal-edit.md` §7/§9, consuming the merged DPE2 contract. HIGH-RISK — persistence +
audit-chain boundary + new public API method → broker review-plan before code, broker audit + verify
after. NO IPC/DTO (DPE4), NO UI (DPE5), NO schema migration. Plan:
`dev-memo/plan-batch-casebox-docket-proposal-edit-persist-00.md`.

## cc-suite review-plan (Path 1 runner v0.2.18 native --background, gpt-5.5/high/read-only)
- `review-plan-mq9joana-myktjt` (first pass): **NEEDS-FIX** (no Critical; 1 High + 2 required changes).
  Findings folded:
  - High: `EditDocketEntryOpts` carried no tenant/matter scope → a mutating op couldn't express
    `tenant_mismatch`/`unknown_matter`. Fixed: `editDocketEntry(opts)` with a single scoped
    `EditDocketEntryOpts = { tenant_id, matter_id, entry_id, editor_actor_user_id, + six content fields }`;
    tenant/matter/entry checks run BEFORE mutation and audit.
  - Required #1: unknown-entry behavior made concrete — a mutating op THROWS
    `CaseBoxPersistenceError("invalid_argument","unknown docket entry: …")`, never returns `null`
    (mirrors confirm/dismiss `inMemoryDocket.ts:237,401`). Error mapping reuses existing `errors.ts` codes
    (unknown matter → `unknown_matter`; entry∉matter → `matter_id_mismatch`; tenant → `tenant_mismatch`;
    non-proposed → `illegal_transition`; `DocketEntryEditError` → `invalid_payload`) — NO `errors.ts` change.
  - Required #2: corrected the SQLite consistency test — directly assert lifted `proposed_kind` ===
    `payload_json.proposed_kind` (raw-row read); the SQLite list path filters only
    `confirmation_state`/`source_type`, NOT `proposed_kind`.
  - Clarification: sample the fixed clock ONCE, reuse for both `revised_at` and the audit `timestamp`.
- `review-plan-mq9k05oz-xl4ug3` (confirm): **READY-with-clarifications** — no Critical/High/Medium. The
  five folded fixes resolve the prior High + required changes. Three non-blocking clarifications, FOLDED:
  - (1) factual correction: `ConfirmDocketEntryOpts`/`DismissDocketEntryOpts` do NOT carry
    `tenant_id`/`matter_id` (`types.ts:333`) — the scope tuple mirrors `GetDocketEntryQuery`, and edit is
    deliberately MORE scoped than confirm/dismiss. (Plan/queue wording corrected.)
  - (2) the single scoped `editDocketEntry(opts)` signature is the reviewer-preferred shape (kept).
  - (3) precision: the six-field allow-list IGNORES caller-supplied non-editable/internal fields (never
    read → absent from the persisted entry + audit) rather than throwing; tests assert ABSENCE. (Wording
    corrected; `assertValidDocketEntryEdit` remains the defense-in-depth conformance check.)
  rawOutput sha256 `2adaae6f21dbc0f8a30f5d055381a318c7eea91022304fc6a25aa80d15124c51`.

### cc-suite recording (per .claude/rules/cc-suite.md)
- Kind/scope: review-plan ×2 on WI-DPE3 (the 10 persistence files + plan). Resolved runner:
  `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs` (Path 1). Model/effort/sandbox:
  gpt-5.5 / high / read-only. Jobs above, both `status:"completed"`, retrievable. Failure class: none.

## Confirmations
- Queue-lint PASSED (1 SOURCE WI; no deps unmet — depends on merged DPE2 `52e5b1b` + DPE2-FIX1 `e86747f`;
  concrete scope/allowed-files/gates/acceptance).
- Allowed files = the 10 declared `services/case-box-persistence/**` surfaces. Forbidden = `schema.ts`
  (no migration), `docs/contracts/**`, `apps/lawbar-desktop/**` (DPE4/DPE5), `errors.ts` (no new code).
- No forbidden-path intersection with `dev-memo/run/forbidden-paths.txt`.
- HIGH-RISK security-boundary gate satisfied by the broker review-plan (required pre-impl); the mandatory
  broker audit + verify on the impl scope are owed AFTER implementation (NOT in this governance step).
- Governance follows the documented rule: mark-reviewed + govern STANDALONE (NOT bundled with any commit —
  `batch-commit-guard` checks the pre-refresh governed hash), content-bind verified. This governance step
  writes `queue.reviewed`/`queue.governed` only; it does NOT commit (no implementation authorized).

## Post-review scope addendum (mechanical; user-directed 2026-06-11)
During WI-DPE3 implementation the new public method `editDocketEntry` necessarily changes the
`InMemoryCaseBoxPersistence.prototype` method-allowlist invariant (`tests/invariants.test.mjs` test 6.2.7,
which pins the EXACT public method set). Adding the method bumps the allowlist 43→44. With explicit user
authorization, `services/case-box-persistence/tests/invariants.test.mjs` was added to the WI's allowed
files SOLELY for this mechanical reflection: add `"editDocketEntry"` to the expected array + update the
test title/count 43→44; no other test-surface edit. This is a reflection of the already-reviewed public-API
addition — the design is unchanged, so review-plan `review-plan-mq9k05oz-xl4ug3` (READY-with-clarifications)
stands and no fresh review-plan was run (per the user's mechanical-only condition). QUEUE_REVIEW_VERDICT=PASS.
