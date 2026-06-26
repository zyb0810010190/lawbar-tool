# ADR — Evidence A3 audited link-create operation (design)

**Status**: DESIGN (design-only; not implementation-authorizing). **Date**: 2026-06-26.
**WI**: WI-A3-LINK-CREATE-DESIGN-00 (governed `dev-memo/run/queue.md`). **Type**: design ADR (no product code).
**Author**: Claude Code.

Composes under `AGENTS.md` §"Evidence-Genie M0 workflow composition" (layer 3) and the A3 link chain. Predecessors
(all merged to `main`): the V11 `case_box_links` table + V12 `unlinked_at`/`unlink_reason` markers
(`ADR-evidence-a3-durable-unlink-schema.md`); the resolver/export marker-awareness; the `link` audit `entity_type`
+ `LINK_UNLINKED`/`LINK_RELINKED` kinds (PR #136); the audited `unlinkLink`/`relinkLink` operations (PR #137,
`ADR-evidence-a3-unlink-break-link-workflow.md`). This ADR designs the still-missing audited **link CREATE**
operation. **It authorizes no code.** It records decisions and the WI sequencing only.

## 0. Problem

There is no governed link-creation path. `case_box_links` rows exist only via tests/raw SQL. Until links can be
created through a persistence operation with audit semantics, UI/IPC unlink/relink wiring is premature (you cannot
audibly unlink a link that was never audibly created). This ADR defines the minimal audited create operation and
the WI sequence to reach it.

## 1. Decision D1 — a new `LINK_CREATED` audit kind IS required (predecessor contract WI)

The case-box audit chain validates a v2 event's `event_kind` against the `{action, entity_type, reasonRequired}`
registry. The only `link` kinds today are `LINK_UNLINKED` and `LINK_RELINKED`, **both `action: "update"`**. Link
creation is `action: "create"`; no existing kind covers it (reusing an `update` kind for a create would lie about
the action and break the verifier's tuple check). Therefore link creation needs a NEW kind:

- **`LINK_CREATED` — `{ action: "create", entity_type: "link", reasonRequired: false }`** (creating a link needs no
  reason; mirrors `DOCUMENT_REGISTERED`/`MATTER_REGISTERED` create kinds).

Per the audit-event-kind-preservation ADR (append-only kinds; schema + TS + generated kept in sync), this is a
**separate predecessor contract WI** — exactly the pattern used for `LINK_UNLINKED`/`LINK_RELINKED`
(WI-A3-UNLINK-AUDIT-KINDS, PR #136). The persistence impl WI must NOT define the kind inline.

## 2. Decision D2 — API boundary

A concrete-class method on `SqliteCaseBoxPersistence` (SQLite-only; links are an A3 SQLite-only feature; the
shared `CaseBoxPersistence` interface and `InMemoryCaseBoxPersistence` are NOT touched — same posture as
unlink/relink):

```
createLink(input: CreateLinkInput): Promise<CaseBoxLinkRow>
// CreateLinkInput: { tenant_id, matter_id, source_type, source_id, anchor_id, actor_user_id }
```

- `id` is generated (`deps.generateId()`, ULID — required because the audit `entity_id` must be ULID).
- `created_at = stamp`, a SINGLE `const stamp = deps.nowIso()` shared by the row and the audit event `timestamp`
  (the WI-A3-UNLINK-T1 single-stamp rule).
- `payload_json` = the canonical link object; `unlinked_at`/`unlink_reason` = `NULL` (a new link is active).
- Backed by a new internal `applyCreateLinkSqlite(db, input, deps)` + `prepareCreateLink(...)` in
  `linkRepoQueries.ts` (extend the existing file), driven via `#runImmediateWrite`. Reuses `entityStateHash` /
  `priorHeadOf` / `eventHashFn` / `buildCaseBoxAuditEvent` — no new audit-chain machinery.

## 3. Decision D3 — initial `status` is provisional `needs_review`, never `valid`

`status` is `NOT NULL` (`CHECK valid|needs_review|broken`) and is resolver-OWNED (A3-RESOLVE: "valid is NEVER a
default"). `createLink` inserts a conservative provisional **`needs_review`**; the caller then runs
`resolveLinkStatuses` to compute the authoritative status (valid/needs_review/broken per the ladder). Create does
NOT run the resolver itself (keeps the create/resolve separation the package already enforces). The `LINK_CREATED`
audit hashes the persisted state EXCLUDING the resolver-derived `status` (the `linkStateForHash` shape from
WI-A3-UNLINK-T1), so the audit hash is independent of resolver timing.

## 4. Decision D4 — validation (all at the operation boundary, before any write)

- **tenant/matter identity**: the matter MUST exist and `input.tenant_id` MUST match the matter's tenant
  (`requireMatterTenant`) → `unknown_matter` / `tenant_mismatch`. (The audit event appends to this matter's chain.)
- **source**: `source_type` ∈ {`evidence`,`note`,`question`,`calcTerm`,`claimElement`}; `source_id` a non-empty
  string → else `invalid_argument`.
- **actor**: `actor_user_id` a non-empty string → else `invalid_argument`.
- **anchor existence (D4a, recommended REQUIRE-EXISTS)**: the referenced `anchor_id` MUST exist in the same
  tenant+matter at create time → else `invalid_argument`. Rationale: a link to a nonexistent anchor is a caller
  error; fail-fast at create. (The resolver still degrades a LATER-deleted anchor to `broken`; that is a different
  lifecycle moment.) **Alternative for review-plan**: allow-dangling (insert anyway; resolver → `broken`). This ADR
  RECOMMENDS require-exists; review-plan confirms or overrides.
- **duplicate id**: `CreateLinkInput` carries NO `id` — callers cannot supply one; `id` is always generated via
  `deps.generateId()`. The operation still defensively checks the generated `id` for collision (mirrors
  `createMatter`'s duplicate check); a collision → `duplicate_id` with NO row and NO event. With ULIDs a collision
  is astronomically rare, but the check is retained so a generator misuse fails closed rather than silently
  overwriting.
- **logical duplicate (D4b)**: the same `(source_type, source_id, anchor_id)` is NOT rejected — the V11 schema has
  no uniqueness on that tuple and intentionally allows multiple links. Enforcing dedup would require a UNIQUE index
  = a SCHEMA change → out of scope (see D7). Review-plan confirms "no dedup in v1".
- **no real evidence content**: tests/fixtures use only synthetic ids; no private/real legal-document content in
  fixtures, logs, or reports (Evidence M0 manual-truth posture).

## 5. Decision D5 — transactional audit append

One `BEGIN IMMEDIATE` (`#runImmediateWrite`): build the `LINK_CREATED` event, INSERT the link row, then
`writeAuditEventAndUpdateHead` — exactly ONE event per create; no row insert without a chain event and no chain
event without a row insert. The event: `action: "create"`, `entity_type: "link"`, `entity_id` = the new link id,
`before_state_hash: null` (create), `after_state_hash` = `entityStateHash(linkStateForHash(newRow))`,
`prev_event_hash` = `priorHeadOf(stored)`, `timestamp` = `stamp`, no `reason`.

## 6. Decision D6 — resolver/export expectations after create

After `createLink` + `resolveLinkStatuses`: a link whose anchor/page/geometry are valid and current resolves
`valid` and exports a clean citation. Note the require-exists rule (D4a): `createLink` CANNOT itself produce a
missing-anchor link (it rejects one), so the `needs_review`/`broken` resolver/export paths are NOT reachable
through a `createLink` call — they arise only LATER (a post-create anchor deletion or geometry-version drift) or
from a raw/legacy orphan row, and are exercised by those fixtures, not by `createLink`. `createLink` itself
changes NO resolver/export behavior — those are read paths exercised only by integration tests.

## 7. Decision D7 — NO schema change; `CURRENT_SCHEMA_VERSION` stays 12

`case_box_links` (V11) already has every column create needs; create is a plain INSERT. No new column, CHECK, FK,
cascade, or index. `CURRENT_SCHEMA_VERSION` remains **12**. The ONLY thing that would force a schema change is a
logical-duplicate UNIQUE index (D4b) — which this ADR declines. **If the implementation lane discovers a genuine
schema gap, it MUST STOP and report (a schema WI), not implement it inline.**

## 8. WI sequencing (the explicit separation the lane requires)

1. **Contract / audit-kind WI — `WI-A3-LINK-CREATE-AUDIT-KIND`** (predecessor; mirrors WI-A3-UNLINK-AUDIT-KINDS):
   additively add `LINK_CREATED { action: create, entity_type: link, reasonRequired: false }` to the schema
   `event_kind` enum + `CASE_BOX_AUDIT_EVENT_KINDS` + the regenerated type + drift tests. NOT A0.7-gated;
   HIGH-RISK contract. **This is the immediate next lane.**
2. **Persistence impl WI — `WI-A3-LINK-CREATE-T1`**: `createLink` per D2-D7. A0.7-gated (court-facing evidence
   link state, like unlink/relink), custody 9b. Depends on (1) merged.
3. **IPC/UI wiring**: separate, later, A0.7-gated. NOT in this chain yet.
4. **Export rendering**: separate, later. NOT in this chain.

These layers are independent governed WIs; higher layers do not collapse into lower ones.

## 9. Required tests for the impl lane (WI-A3-LINK-CREATE-T1)

`createLink` inserts a row with the given fields + provisional `needs_review` + NULL markers; emits EXACTLY ONE
`LINK_CREATED` event (`action: create`, `entity_type: link`, `entity_id` = new id, `before_state_hash: null`,
correct `after_state_hash`, `timestamp` == `created_at`); atomic (`event_count == COUNT == MAX(sequence)`);
rejects unknown matter / tenant mismatch / bad source_type / empty source_id / empty actor / missing anchor
(per D4a) / a generated-`id` collision (`duplicate_id`) — each leaving NO row and NO event; after `createLink` +
`resolveLinkStatuses` a valid fixture resolves `valid` and exports a clean citation. The `broken` resolver path is
NOT reachable through `createLink` under require-exists — exercise it by DELETING the anchor AFTER a successful
create (or via a raw/legacy orphan row), then asserting the resolver degrades to `broken`. Legacy compatibility
(NULL markers); no schema bump. Fixtures synthetic-only. Extend an already-wired test file (the
package `test` script is a curated list, no glob, and `package.json` is forbidden — the WI-A3-UNLINK-T1 lesson).

## 10. Stop condition / next lane

"Done" when this ADR + its governance are committed. The **next lane is the audit-kind contract WI
(WI-A3-LINK-CREATE-AUDIT-KIND)** — NOT the persistence impl — because the impl emits `LINK_CREATED`, which must
exist in the contract first. If review-plan rejects D1 (claims an existing kind covers create) or D7 (claims a
schema change is required), STOP and reconcile before opening lane (1).

## References
- `docs/adr/ADR-evidence-a3-unlink-break-link-workflow.md`, `docs/adr/ADR-evidence-a3-durable-unlink-schema.md`,
  `docs/adr/audit-event-kind-preservation.md`, `docs/adr/case-box-step-4-audit-log-shape.md`,
  `docs/adr/ADR-evidence-a3-resolver-status-transitions.md`.
- `services/case-box-persistence/src/sqlite/linkRepoQueries.ts` (the unlink/relink pattern to extend),
  `services/case-box-persistence/src/sqlite/schema.ts` (case_box_links V11/V12),
  `docs/contracts/case-box-contract/src/audit-log.ts` (`CASE_BOX_AUDIT_EVENT_KINDS`).
