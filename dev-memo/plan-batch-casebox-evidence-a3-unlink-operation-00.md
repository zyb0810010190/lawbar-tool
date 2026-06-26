# BATCH-CASEBOX-EVIDENCE-A3-UNLINK-OPERATION-00 (WI-A3-UNLINK-T1 — audited unlink/relink operation)

**Status**: plan for the A0.7-gated unlink/relink OPERATION (custody mode 9b). The governed
`dev-memo/run/queue.md` WI-A3-UNLINK-T1 block is the execution authority. **Date**: 2026-06-26.
**Type**: IMPL (case-box-persistence; A0.7-gated; HIGH-RISK — persistence + tamper-evident audit chain).
**Predecessors (all merged to main)**: WI-A3-UNLINK-SCHEMA-01 (V12 `unlinked_at`/`unlink_reason` columns),
WI-A3-UNLINK-RESOLVE (resolver→`broken` + export→`UNLINKED` marker-awareness), WI-A3-UNLINK-AUDIT-KINDS
(`link` entity_type + `LINK_UNLINKED`/`LINK_RELINKED` audit kinds, PR #136 @ `c72e8bf`).

## Review packet (compact)

1. **Active plan summary.** Add the durable unlink/relink OPERATION over `case_box_links`: set
   (`unlinked_at`, `unlink_reason`) to unlink; clear both to relink. Each operation appends ONE tamper-evident
   v2 audit chain event (`LINK_UNLINKED` on unlink, `LINK_RELINKED` on relink) in the SAME SQLite transaction
   as the row update. SQLite-only (links are an A3 SQLite-only feature; `InMemoryCaseBoxPersistence` has no link
   support). Builds on the three merged predecessors above. A0.7-gated, custody mode 9b.

2. **Exact target files.**
   - NEW `services/case-box-persistence/src/sqlite/linkRepoQueries.ts` — `loadLinkForUpdate`, `prepareUnlinkLink`,
     `prepareRelinkLink`, `updateLinkMarkerRow`, `applyUnlinkLinkSqlite`, `applyRelinkLinkSqlite`, a
     `linkStateForHash` helper. Mirrors `deadlineRepoQueries.ts` (the `applyXxxSqlite(db, id, opts, deps)` +
     `prepare*` + audit-append shape).
   - EDIT `services/case-box-persistence/src/sqlite/SqliteCaseBoxPersistence.ts` — add two public methods
     `unlinkLink(linkId, opts)` and `relinkLink(linkId, opts)`, each `#runImmediateWrite(...)` over the
     corresponding `apply*Sqlite`. (Added to the CONCRETE class only — NOT to the shared `CaseBoxPersistence`
     interface, so `InMemoryCaseBoxPersistence` is untouched.)
   - EDIT `services/case-box-persistence/src/index.ts` — export the new opts/result TYPES
     (`UnlinkLinkOptions`, `RelinkLinkOptions`); the methods ship on the already-exported class.
   - EXTEND `services/case-box-persistence/tests/hardening-link-status-resolver.test.mjs` (already wired into the
     `npm test` curated file list) — add the 17 required unlink/relink operation tests. A NEW test file is NOT
     used: `package.json` is forbidden and the runner uses an explicit file list (no glob), so a new file would be
     orphaned (un-run) — extending the already-wired link-resolver hardening file matches the WI-A3-UNLINK-RESOLVE
     predecessor pattern (queue amended + re-reviewed; Option B, 2026-06-26).
   - EDIT this dev-memo + the governance files (queue.* + review-089).

3. **Exact acceptance criteria.**
   - `unlinkLink(linkId, { actor_user_id, unlink_reason })` on an active link sets `unlinked_at = deps.nowIso()`
     and `unlink_reason = <reason>`, preserves the row (no DELETE), and appends exactly ONE `LINK_UNLINKED`
     event (`action: update`, `entity_type: link`, `entity_id = linkId`, `reason = <reason>`, correct
     `before_state_hash`/`after_state_hash`/`prev_event_hash`, and event `timestamp` EQUAL to the row's
     `unlinked_at` — the single shared `stamp`) atomically.
   - Empty/blank/null `unlink_reason` → `CaseBoxPersistenceError("invalid_argument", …)`; row UNCHANGED; no
     audit event appended.
   - `relinkLink(linkId, { actor_user_id })` on an unlinked link clears BOTH marker columns to NULL and appends
     exactly ONE `LINK_RELINKED` event (no `reason`) atomically.
   - Unlink on an already-unlinked link, and relink on an already-active link, are DETERMINISTICALLY REJECTED
     with `illegal_transition` (row unchanged; no event).
   - A missing `linkId` → `invalid_argument` (no event).
   - After unlink: `resolveLinkStatuses` → `status='broken'` (marker precedence); `buildExportCitations` → flag
     `UNLINKED`. After relink: resolver recomputes from the lower rungs; a structurally-broken link (e.g. missing
     anchor) still resolves `broken` (relink clears the marker, it does not fabricate validity).
   - Legacy rows with both marker columns NULL remain compatible (unlink works NULL→set).
   - The marker write + audit append are atomic: `event_count == COUNT(*) == MAX(sequence)` after the op.
   - `npm --prefix services/case-box-persistence test` green; if any contract consumer is touched,
     `npm --prefix docs/contracts/case-box-contract test` green; `check-contract-integrity.sh` exit 0;
     A0.7-gated `check-gates.sh` → `GATES OK` (human custody-9b, with the HMAC key); desktop 610/610; native 38/38.

4. **Exact out-of-scope (do NOT do).** No SQLite schema change; no `CURRENT_SCHEMA_VERSION` bump; no
   CHECK/FK/cascade/index; no resolver/export BEHAVIOR change (integration tests only); no UI; no export
   rendering; no link CREATE/DELETE path; no `docs/contracts/**` change unless a consumer assertion strictly
   requires it (STOP and ask if it does — the kinds already shipped in #136); no new dependency; no
   canonicalization/verifier change; no `InMemoryCaseBoxPersistence`/shared-interface change; no marker/key/gate
   change.

5. **Essential references.** `docs/adr/ADR-evidence-a3-unlink-break-link-workflow.md` (A3-UNLINK-00 — the
   workflow + §7 audited-unlink requirement); `docs/adr/ADR-evidence-a3-durable-unlink-schema.md`
   (A3-UNLINK-SCHEMA-00 — the V12 marker mechanism + the `unlink_reason`-required-iff-`unlinked_at` invariant);
   `docs/adr/audit-event-kind-preservation.md` (the kind tuple the chain verifier enforces).

6. **Review questions.**
   1. Is a CONCRETE-class-only method pair (not on the shared `CaseBoxPersistence` interface) the right surface,
      given links are SQLite-only and the conformance harness has no link references? Or should these be
      standalone `(db, …, deps)` exports like the other A3 read functions? (Trade-off: class methods reuse the
      existing `#runImmediateWrite`/`#writeAudit` audit-write infra with zero new chain code.)
   2. Is excluding the resolver-derived `status` column from `before_state_hash`/`after_state_hash` (hashing only
      the authoritative persisted identity + marker fields) correct, so the audit hash is independent of resolver
      timing? Or should the hash mirror the full row?
   3. Are the chosen behavioral decisions correct: reject (not idempotent no-op) on re-unlink / re-relink;
      `nowIso()` clock as the `unlinked_at` source; relink takes NO reason and clears `unlink_reason`?
   4. Reason validation at the OPERATION boundary (guarantee "row unchanged" before any write) AND the contract
      builder's `reasonRequired` both enforce a unlink reason — is the double guard acceptable, or should the
      operation defer entirely to the builder?

## Design detail

### Surface
```
unlinkLink(linkId: string, opts: UnlinkLinkOptions): Promise<CaseBoxLink>   // opts: { actor_user_id, unlink_reason }
relinkLink(linkId: string, opts: RelinkLinkOptions): Promise<CaseBoxLink>   // opts: { actor_user_id }
```
Both via `#runImmediateWrite((db, deps) => apply{Unlink,Relink}LinkSqlite(db, linkId, opts, deps))` — ONE
`BEGIN IMMEDIATE` per op. The returned link is `structuredClone`d.

### apply*Sqlite (linkRepoQueries.ts), mirroring applyTransitionDeadlineSqlite
1. `loadLinkForUpdate(db, linkId)` — SELECT the row (all durable columns incl. V12 markers). Missing → throw
   `invalid_argument`.
2. `prepare{Unlink,Relink}Link(row, opts, deps)`:
   - **SINGLE OPERATION TIMESTAMP** (review Medium, 2026-06-26): capture `const stamp = deps.nowIso()` ONCE at
     the top of the prepare and use the SAME `stamp` for BOTH `next.unlinked_at` AND the audit event `timestamp`.
     Do NOT call `deps.nowIso()` twice — the injected test clock advances per call, so two calls would diverge;
     the marker and its event must be forensically identical.
   - **unlink**: reject if `row.unlinked_at !== null` (`illegal_transition`). Validate `unlink_reason` non-blank
     (`invalid_argument`). `next = { …row, unlinked_at: stamp, unlink_reason: reason }`.
   - **relink**: reject if `row.unlinked_at === null` (`illegal_transition`). `next = { …row, unlinked_at: null,
     unlink_reason: null }`. (`stamp` is still used for the audit event `timestamp`.)
   - `before_state_hash = entityStateHash(linkStateForHash(row))`,
     `after_state_hash  = entityStateHash(linkStateForHash(next))`.
   - `prev_event_hash = priorHeadOf(deps.storedAuditEventsForMatter(row.matter_id))`.
   - Build the event via `buildCaseBoxAuditEvent({ kind: "LINK_UNLINKED"|"LINK_RELINKED", id: deps.generateId(),
     tenant_id: row.tenant_id, actor_user_id: opts.actor_user_id, matter_id: row.matter_id, entity_id: linkId,
     before_state_hash, after_state_hash, prev_event_hash, timestamp: stamp, [reason for unlink] })`.
     Builder reject → `invalid_payload`. For unlink, the appended event's `timestamp` EQUALS `next.unlinked_at`
     (the same `stamp`) — asserted by a test.
3. `updateLinkMarkerRow(db, linkId, next.unlinked_at, next.unlink_reason)` — `UPDATE case_box_links SET
   unlinked_at = ?, unlink_reason = ? WHERE id = ?`. Marker columns ONLY (never `status`, never `payload_json`,
   never DELETE).
4. `deps.writeAuditEventAndUpdateHead(prepared.audit, eventHashFn(prepared.audit.event))`.

`linkStateForHash(row)` = `{ id, tenant_id, matter_id, source_type, source_id, anchor_id, created_at,
payload_json, unlinked_at, unlink_reason }` — EXCLUDES the resolver-derived `status` (non-authoritative, written
by `resolveLinkStatuses`), so the audit hash captures only authoritative persisted state.

### Behavioral decisions (locked, pending review-plan)
1. **Re-unlink → reject** `illegal_transition` (not idempotent). A second unlink would either drop the audit
   event (losing the new reason) or duplicate it — both wrong for a court audit.
2. **Re-relink → reject** `illegal_transition` (symmetric).
3. **`unlinked_at` source = `deps.nowIso()`** (the injected clock; deterministic via `makeClock` in tests) —
   identical to every other audited mutation.
4. **Relink takes NO reason**; clears `unlink_reason` to NULL; the `LINK_RELINKED` event omits `reason`
   (matching `reasonRequired: false`). Accepting a reason would contradict clearing it.

## What this does NOT change
`schema.ts` (CURRENT_SCHEMA_VERSION stays 12), `errors.ts` (`invalid_argument`/`illegal_transition`/
`invalid_payload` already exist), `linkStatusResolverQueries.ts`, `exportCitationQueries.ts`,
`anchorDeleteGuardQueries.ts`, `inMemoryRepo.ts`, the shared `CaseBoxPersistence` interface, the conformance
harness, `docs/contracts/**`, `apps/**`, `native/**`, dependencies.

## A0.7 custody (mode 9b)
Court-facing evidence link state + resolver/export presentation → A0.7-gated (same as WI-A3-UNLINK-RESOLVE).
`Requires-A07: yes`. The human mints the local marker and runs A0.7-gated `check-gates.sh` with the HMAC key;
the agent never receives/persists the key; the implementation commit is blocked until the human reports gated
PASS. The agent's own `check-gates.sh` fails closed (exit 2) without the key — expected.

## Stop conditions
STOP if implementation requires schema, UI, export rendering, a contract change, cloud, auth, or broader
lifecycle scope. STOP before the human A0.7 custody gate (report the exact command). STOP before commit if the
broker reports any Critical/High/Medium. After a clean impl commit, STOP and report; do not push/PR/merge/start
a follow-on lane without separate authorization.

## References
- `docs/adr/ADR-evidence-a3-unlink-break-link-workflow.md`, `docs/adr/ADR-evidence-a3-durable-unlink-schema.md`,
  `docs/adr/audit-event-kind-preservation.md`, `docs/adr/case-box-step-4-audit-log-shape.md`.
- `services/case-box-persistence/src/sqlite/{deadlineRepoQueries,SqliteCaseBoxPersistence,linkStatusResolverQueries,exportCitationQueries}.ts`,
  `services/case-box-persistence/src/auditChain.ts`, `docs/contracts/case-box-contract/src/audit-log.ts`.
