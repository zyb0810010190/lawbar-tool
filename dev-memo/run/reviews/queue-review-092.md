# Queue review 092 — WI-A3-LINK-CREATE-T1 (audited createLink persistence operation; A0.7-gated, custody 9b, HIGH-RISK)

**Date**: 2026-06-26.
**WI**: WI-A3-LINK-CREATE-T1 — implement the headless audited `createLink` operation: insert a durable
`case_box_links` row (provisional `status='needs_review'`, NULL markers) and emit EXACTLY ONE `LINK_CREATED`
chain event in the SAME `BEGIN IMMEDIATE`. The emitter of the `LINK_CREATED` kind shipped in PR #139, per the
merged link-create ADR (PR #138, D1-D10). Concrete-class method on `SqliteCaseBoxPersistence` (SQLite-only).
**Classification under review**: IMPL (persistence CREATE over court-facing evidence link state + the
tamper-evident audit chain), **A0.7-gated** (custody mode 9b; `Requires-A07: yes`) and **HIGH-RISK** — broker
review-plan + audit + verify REQUIRED.
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `059009d75525ab55b8fdd4d2c967f197923c5839a1e9521423abf5b2049fc02e`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; governs a HIGH-RISK A0.7-gated persistence + audit-chain change).
- **Target scope**: `dev-memo/plan-batch-casebox-evidence-a3-link-create-t1-00.md` + the `dev-memo/run/queue.md`
  WI block + the link-create ADR + the pattern files (linkRepoQueries / SqliteCaseBoxPersistence / auditChain /
  schema / audit-log) + the 5 review questions (A-E, B = the evidence-existence ADR-extension).
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mquxn69s-vrqyeo`.
- **threadId**: none emitted.
- **rawOutput sha256**: `8cd021e769cef84a9168b9e36a6172a855e867856d007620d0bddf25f5ad3748`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (with only a Low item).** Critical: none. High: none. Medium: none.
Scores: A07-classification 5/5, evidence-existence extension 4/5, create-event hash 5/5, initial-state+atomicity
4.5/5, scope 5/5.

- **A. A0.7-CLASSIFICATION: CONFIRMED-GATED-9B** — creates durable court-facing evidence link rows + emits
  LINK_CREATED into the tamper-evident chain; custody-9b is correct (NOT a STOP).
- **B. EVIDENCE-EXISTENCE ADR-EXTENSION: ACCEPTABLE NOW (no ADR amendment required)** — the T1 authorization
  explicitly requires "missing evidence is rejected" + boundary enforcement; under the repo source hierarchy the
  current explicit user authorization OUTRANKS the earlier design ADR. It is a stricter operation-boundary
  validation, NOT a schema/contract change; `case_box_evidence_items` already supports tenant/matter-scoped
  existence checks. The non-evidence handling (non-empty `source_id` only, since note/question/calcTerm/
  claimElement have no backing tables) is sound and the gap is recorded. The plan + queue record the divergence
  clearly.
- **C. CREATE-EVENT HASH: CONFIRMED** — `before_state_hash: null` (create) + `after_state_hash =
  entityStateHash(linkStateForHash(newRow))` (excluding resolver-owned `status`); single `nowIso()` stamp shared
  by `created_at` + the event `timestamp`. `LINK_CREATED { action: create, entity_type: link, reasonRequired:
  false }` already present.
- **D. INITIAL STATE + ATOMICITY: SOUND** — `status='needs_review'` (valid never a default); NULL markers =
  active; deterministic `payload_json`; one `BEGIN IMMEDIATE` (insert + one audit append); rejections before any
  write leave no row/event; a generated-id collision must still leave no committed row/event via rollback + mapped
  error.
- **E. SCOPE: CONFIRMED** — no schema/CURRENT_SCHEMA_VERSION change, no contract change (LINK_CREATED shipped
  #139), no resolver/export/UI/IPC/InMemory/shared-interface/delete/dependency change; extend the already-wired
  hardening test file.

## Finding to apply (one Low — mechanical; no scope change)
- **Low — generated-id collision → duplicate_id.** Explicitly translate a generated link-id collision into
  `CaseBoxPersistenceError("duplicate_id", ...)` — precheck `SELECT 1 FROM case_box_links WHERE id=?` before the
  insert (mirrors `createMatter`) so a collision leaves NO row and NO event; the one `BEGIN IMMEDIATE` rolls back
  on any throw. Add a test.

## Disposition
READY → eligible to govern. C0 H0 M0; the one Low (duplicate_id mapping via precheck + a test) is applied in this
lane and confirmed by the post-implementation broker audit + verify. A07-classification CONFIRMED-GATED-9B (this
lane HAS a custody-9b human gate before the implementation commit). The evidence-existence ADR-extension is
authorized as-implemented (no ADR amendment required). Proceeding to mark-reviewed + govern (standalone,
content-bound to sha `059009d7…`). After authoring, the human runs the A0.7-gated `check-gates.sh` (custody 9b),
then broker `/cc-suite:audit` + `/cc-suite:verify` run on the implementation diff before the implementation commit
(running a Layer-B closeout first if the batch guard requires it).

QUEUE_REVIEW_VERDICT=PASS
