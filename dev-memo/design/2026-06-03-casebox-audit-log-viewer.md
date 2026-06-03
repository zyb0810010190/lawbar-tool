# Design artifact — Case-box matter audit-event log viewer

**Date**: 2026-06-03.
**WI**: `PRODUCT(ui+ipc): surface full matter audit-event log on matter view`.
**Type**: UI (read-only). Manual-merge (touches renderer + IPC surface).
**Surface**: extends the existing matter detail screen `apps/lawbar-desktop/renderer/screens/viewMatter.ts`. No new route.
**Grounds**: `services/case-box-persistence/src/sqlite/auditRepoQueries.ts` (`listAuditEvents`, already implemented, seek-paginated), `docs/adr/case-box-step-4-audit-log-shape.md` (audit-event shape + chain semantics), `docs/contracts/case-box-contract/schemas/case-box-audit-event.schema.json`.

## Problem

A lawyer opening a matter can currently see only the audit **chain head** (head hash, last-event id, event count) via the existing "Show audit chain head" disclosure. The full ordered history — *what happened, when, by which action* — is persisted (`listAuditEvents`) but has no UI. For a legal tool, the visible, ordered chain of custody is the core trust property: "show me everything that happened to this matter."

## Scope (this WI)

- **Read-only.** No audit-event creation path (audit events are appended internally by other operations; this WI never writes).
- Surface the existing persisted events on the **existing** matter view, inside the **existing** audit disclosure. No new screen, no new route.
- One new read IPC channel: `casebox:audit:listEvents`.
- Honor the persistence API's seek pagination (`limit` + `next_cursor`).
- Preserve tenant/matter scoping (matter existence + tenant check before listing, exactly like `chainHead`).

Out of scope (explicitly not bundled): documents, deadlines/docket, facts, evidence, privilege, confidentiality UI; audit-event creation; chain *verification* UI (`verifyAuditChainForMatter`).

## Data shown per event

From `CaseBoxAuditEvent` (schema required fields): `timestamp`, `action`, `entity_type`, `entity_id`, `after_state_hash`; optional `reason`, `before_state_hash`, `prev_event_hash`, `id`, `actor_user_id`. The row renders the human-relevant subset:

- **Timestamp** — local-formatted (reuse `formatLocalDateTime`).
- **Action** — e.g. `matter.created`, `matter.archived` (verbatim from the event).
- **Entity** — `entity_type` + a shortened `entity_id` (reuse `ulidShort`).
- **Reason** — shown only when present (non-empty).

Hashes (`after_state_hash`, etc.) are NOT shown per-row in v1 (the chain head already exposes the head hash + copy affordance); keeping rows compact. Full-hash disclosure per row is a deferred enhancement, not this slice.

## Layout (ASCII mock)

```
▾ Show audit chain head
  Head hash:  a1b2c3…  [Copy]  ▸ Show full hash
  Last event: 01JZ…             ▸ Show full event id
  Event count: 3

  Audit events                                  ← new section (data-test-id="view-audit-list")
  ┌────────────────────────────────────────────┐
  │ 2026-06-03 14:02  matter.created            │   ← <li data-test-id="view-audit-event">
  │   matter · 01JZ0…                           │
  │ 2026-06-03 14:05  classification.appended   │
  │   matter · 01JZ0…   reason: sealed on intake│
  │ 2026-06-03 15:11  matter.archived           │
  │   matter · 01JZ0…   reason: closed          │
  └────────────────────────────────────────────┘
  [ Show more ]                                 ← only when next_cursor !== null
```

## Behavior & states

The event list loads **lazily**, in the same `<details>` open handler that already triggers the chain-head load (one click loads both head + first page of events). Ordering is the persistence order (chain/seek order) — rendered as an ordered `<ol>`.

| State | Render | data-test-id |
|---|---|---|
| Loading | "Loading audit events…" | `view-audit-loading` |
| Error (envelope `ok:false`) | `<p role="alert">` with `env.error.message` | `view-audit-error` |
| Empty (count 0 / no rows) | reuse the existing "No audit events recorded yet." (no separate empty list) | `view-chain-empty` |
| Populated | `<ol>` of event rows, soonest-first as returned | `view-audit-list` / `view-audit-event` |
| More available (`next_cursor !== null`) | "Show more" button appends the next page | `view-audit-more` |

- **Pagination**: first page uses the default server limit; "Show more" passes the returned `next_cursor`. Each click appends; the button is removed when `next_cursor` comes back `null`.
- **Failure isolation**: an event-list error renders inline (`role="alert"`) and does NOT blank the chain-head summary already shown.
- **No console noise** on the normal path (mirrors the existing "normal active render emits NO console.warn" test).

## IPC contract (new channel)

```
channel:  casebox:audit:listEvents
request:  ListAuditEventsDto { matterId: string; limit?: number; cursor?: string }
response: IpcEnvelope<ListAuditEventsPage>   // { rows: CaseBoxAuditEvent[]; next_cursor: string|null }
```

- Renderer never supplies `tenant_id` (server injects the active tenant); `tenant_id` is a forbidden DTO field. `limit` is bounded by the existing `MAX_LIST_LIMIT`; `cursor` by `MAX_CURSOR_LENGTH`. Validation + matter-existence + tenant-scope mirror `chainHeadHandler` exactly.

## Accessibility

- The list is an `<ol>` (ordered history). Each event is an `<li>`. Error uses `role="alert"`. "Show more" is a `<button type="button">`. Reuses the screen's existing announce region for nothing new (static content). No focus trap; tab order follows DOM.

## Non-goals / deferred

- Per-row full-hash disclosure, chain-verification status, filtering by action/entity, export. Deferred — not this slice.

## Acceptance (testable)

1. Opening the disclosure loads + renders the first page of events as an `<ol>` in chain order (renderer test with a stub api returning 2–3 events).
2. Empty matter shows the existing "No audit events recorded yet." copy (no list).
3. Envelope error renders `role="alert"` inline, head summary intact.
4. `next_cursor` present → "Show more" appears; clicking appends the next page and removes the button when the cursor is exhausted.
5. IPC handler: tenant injection, forbidden `tenant_id` → `invalid_payload`, unknown field → `invalid_payload`, absent matter → `unknown_matter` (listAuditEvents not called), tenant mismatch → `tenant_mismatch` (not called), happy path returns the page.
