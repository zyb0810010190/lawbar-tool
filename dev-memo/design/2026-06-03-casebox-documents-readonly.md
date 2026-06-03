# Design artifact — Case-box matter documents (read-only list/get)

**Date**: 2026-06-03.
**WI**: `PRODUCT(ui+ipc): surface read-only matter documents list/get` (B2 documents vertical, slice WI-2a).
**Type**: UI (read-only). Manual-merge (touches renderer + IPC surface).
**Surface**: a new Documents section on the existing matter detail screen (`apps/lawbar-desktop/renderer/screens/viewMatter.ts`), rendered by a new sibling module `renderer/screens/viewMatterDocuments.ts`. No new route.
**Grounds**: `services/case-box-persistence/src/sqlite/documentRepoQueries.ts` (`listDocuments`, `getDocument`, already implemented); schema `docs/contracts/case-box-contract/schemas/case-box-document.schema.json`; brief §7.A litigation day-one vertical (documents listed first).

## Problem

A matter's documents are persisted (`listDocuments`/`getDocument`) but have no IPC channel and no UI. A lawyer cannot see which documents belong to a matter. This slice surfaces the **read path** only.

## Scope (this WI / slice 2a)

- **Read-only.** No registration, file picker, hashing (`content_hash`), storage copy (`storage_uri`), or file opening — display only. Document *creation* is a separate later slice (2b).
- Two new read IPC channels: `casebox:document:list`, `casebox:document:get`.
- A Documents section on the matter view: lazily list the matter's documents; expand a row to view its metadata via `get`.
- Honor seek pagination (`limit` + `next_cursor`); preserve tenant/matter scoping.

Out of scope (not bundled): facts, deadlines, evidence, privilege, confidentiality, BRCBW; document registration / file handling.

## LOC guard (mandatory pre-step)

`viewMatter.ts` was 759 LOC (loc-guardian warn zone). Before adding the Documents section, the audit/chain disclosure was extracted **mechanically** (no behavior change) into a sibling module `renderer/screens/viewMatterAudit.ts`; the Documents section lives in its own sibling `viewMatterDocuments.ts`. `viewMatter.ts` drops to ~420 LOC; both siblings are < 400. The screen is not redesigned — only the disclosure bodies move out.

## IPC contract (new channels)

```
casebox:document:list   ListDocumentsDto { matterId: string; limit?: number; cursor?: string }
                        -> IpcEnvelope<ListDocumentsPage>   // { rows: CaseBoxDocument[]; next_cursor: string|null }
casebox:document:get    GetDocumentDto   { matterId: string; documentId: string }
                        -> IpcEnvelope<CaseBoxDocument | null>
```

Scoping (mirrors the matter channels):
- Renderer never supplies `tenant_id`/`actor_user_id` (forbidden DTO fields); server injects the active tenant.
- `list`: matter existence + active-tenant checked before querying; `tenant_id`+`matter_id` injected into the query. `limit` bounded by `MAX_LIST_LIMIT`, `cursor` by `MAX_CURSOR_LENGTH`.
- `get`: matter existence + tenant checked; then `getDocument(documentId)`; the returned document must match the active tenant (else `tenant_mismatch`) AND the requested matter (else `value: null` — scoped not-found). This prevents reading another matter's/tenant's document by id.

## Layout (ASCII mock)

```
▾ Show documents                              ← <details data-test-id="view-docs-summary">
  • complaint.pdf   pleading · registered   2026-06-03 14:02   ▸ (details)
      Content hash: a1b2c3…
      Storage: file:///…/complaint.pdf
      Pages: 12
  • answer.pdf      pleading · reviewed     2026-06-04 09:10   ▸ (details)
  [ Show more ]                               ← only when next_cursor !== null

  (empty)  No documents in this matter yet.
```

## Behavior & states

The Documents disclosure loads lazily on first open (one `list` call). Each row is an expandable `<details>`; expanding it lazily calls `get` for that document and renders its metadata (content_hash truncated, storage_uri, page_count, language, mime_type, byte_size — whichever are present).

| State | Render | data-test-id |
|---|---|---|
| Loading | "Loading documents…" | `view-docs-loading` |
| Empty | "No documents in this matter yet." | `view-docs-empty` |
| List error | `<p role="alert">` with `env.error.message` | `view-docs-error` |
| Populated | `<ul>` of rows (filename, doc_type · status, received_at) | `view-docs-list` / `view-docs-item` |
| More | "Show more" appends next page via `next_cursor` | `view-docs-more` |
| Row detail loading/error/found | inline under the row | `view-docs-detail-*` |

`el()` sets `textContent` (no `innerHTML`). No file is opened; storage_uri is shown as text only.

## Accessibility

Documents are a `<ul>`; each row a `<details>`/`<summary>`. Errors use `role="alert"`. "Show more" is a `<button type="button">`. Tab order follows DOM.

## Non-goals / deferred (slice 2b and later)

Document registration, file picker, content hashing, storage copy, file opening/preview, status/doc_type filters, sorting controls. Deferred.

## Acceptance (testable)

1. Documents disclosure does not call `list` until opened; opening renders the rows (renderer test with a stub returning 2 docs).
2. Empty matter shows "No documents in this matter yet." (no rows).
3. List envelope error renders `role="alert"` inline.
4. `next_cursor` → "Show more" appends the next page and disappears when exhausted.
5. Expanding a row calls `get` with `{matterId, documentId}` and renders its metadata.
6. IPC handlers: tenant injection; forbidden `tenant_id` → `invalid_payload`; unknown field → `invalid_payload`; absent matter → `unknown_matter` (persistence read not called); tenant mismatch → `tenant_mismatch`; `get` of a doc in another matter → `value: null`; `get` of a doc in another tenant → `tenant_mismatch`; missing `documentId` → `invalid_payload`.
