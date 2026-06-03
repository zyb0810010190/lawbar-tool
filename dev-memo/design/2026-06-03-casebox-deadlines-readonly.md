# Design artifact — Matter deadlines (read-only list) + handler split

**Date**: 2026-06-03.
**WI**: `PRODUCT(ui+ipc): surface matter deadlines and docket read-only` (B7 deadline read surface).
**Type**: UI (read-only). Manual-merge (UI + IPC surface).
**Surface**: a new Deadlines section on the matter view (`renderer/screens/viewMatter.ts`), rendered by a new sibling `renderer/screens/viewMatterDeadlines.ts`. No new route.
**Grounds**: `services/case-box-persistence/src/sqlite/deadlineRepoQueries.ts` (`listDeadlines`, already implemented, seek-paginated); ADR `docs/adr/case-box-step-6-deadline-docketing-rules.md`; schema `case-box-deadline.schema.json`; brief §7.A.

## Problem

A matter's deadlines are persisted (`listDeadlines`) but have no IPC channel and no UI. Deadline visibility is the highest-anxiety litigator need ("did I miss a filing?"). This slice surfaces the **read path** only.

## Mandatory structural pre-step (done) — handler split

`apps/lawbar-desktop/src/caseBox/handlers.ts` had reached 614 LOC, accumulating every IPC handler (loc-guardian warn zone). Before adding deadline handlers it was split **mechanically** (no behavior change) into per-entity sibling modules, with `handlers.ts` kept as a thin barrel so every existing import (`from "./handlers.js"`, tests' `from "../dist/.../handlers.js"`) is unchanged:

| Module | Contents | LOC |
|---|---|---|
| `handlerShared.ts` | `CHANNEL`, `PersistenceProvider`/`ClockFn`, `isPlainJsonObject` + `shapeGuardFailure` + `forbiddenFieldFailure` | 55 |
| `matterHandlers.ts` | create / get / list / archive | 233 |
| `auditHandlers.ts` | chainHead / listAuditEvents | 130 |
| `documentHandlers.ts` | list / get / register (+ `DOC_TYPES`, `RegisterDocumentDeps`) | 254 |
| `deadlineHandlers.ts` | listDeadlines (this WI) | 79 |
| `handlers.ts` | barrel re-export only | 26 |

Equivalence proof: all pre-existing handler + renderer tests pass unchanged after the split (320/0 total, of which the prior suite was 306).

## Product scope (this WI)

- **Read-only.** No docket creation, deadline confirmation/dismissal/editing, transitions, notifications, calendar export, or date-rule mutation.
- Smallest useful surface: **one** channel `casebox:deadline:list` (seek-paginated). The `getDeadlineCalendar` aggregation is **deferred** (not bundled) to keep the slice tight.
- Tenant/matter scoping preserved.

## IPC contract (new channel)

```
casebox:deadline:list   ListDeadlinesDto { matterId: string; limit?: number; cursor?: string }
                        -> IpcEnvelope<ListDeadlinesPage>   // { rows: CaseBoxDeadline[]; next_cursor: string|null }
```

`listDeadlinesHandler` mirrors the document/audit list handlers exactly: forbidden (`tenant_id`/`actor_user_id`) + unknown-field rejection, `matterId`/`limit`/`cursor` validation, matter-existence + active-tenant check **before** the read, server-side `tenant_id`+`matter_id` injection.

## UI

A lazy "Show deadlines" disclosure on the matter view. Each row renders the human-relevant `CaseBoxDeadline` subset: `due_at` (local-formatted), `kind · status`, and optionally `source_rule_citation` (rule) and `owner_user_id` (short). Empty → "No deadlines recorded for this matter." Error → inline `role="alert"`. "Show more" pagination via `next_cursor`. `el()` sets `textContent` (no `innerHTML`).

## Out of scope / deferred

Calendar channel (`getDeadlineCalendar`), docket entries, confirm/dismiss/transition, status/kind filters, notifications, export. Deferred.

## Acceptance (testable)

1. Handler split: all pre-existing handler + renderer tests pass unchanged (equivalence).
2. Deadlines disclosure does not call `list` until opened; opening renders the rows.
3. Empty matter → "No deadlines recorded for this matter."
4. Error → inline `role="alert"`.
5. `next_cursor` → "Show more" appends the next page and disappears when exhausted.
6. IPC handler: tenant injection; forbidden `tenant_id` → `invalid_payload`; unknown field → `invalid_payload`; non-int limit → `invalid_payload`; absent matter → `unknown_matter` (read not called); tenant mismatch → `tenant_mismatch` (read not called).
