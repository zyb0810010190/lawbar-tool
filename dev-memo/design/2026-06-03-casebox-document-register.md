# Design artifact — Register a document into a matter (B2 WI-2b)

**Date**: 2026-06-03.
**WI**: `PRODUCT(ui+ipc): register documents to a matter` (B2 documents vertical, slice WI-2b — the write/create path; read path shipped in WI-2a, PR #30).
**Type**: UI (write — adds the first file-handling channel). Manual-merge (UI + IPC + file/storage handling).
**Surface**: an "Add document" control in the existing Documents section of the matter view (`renderer/screens/viewMatterDocuments.ts`). New main-process file-storage util `src/caseBox/documentStorage.ts`. No new screen/route.
**Grounds**: `services/case-box-persistence/src/inMemoryDocument.ts` (`registerDocument` / `prepareRegisterDocument` — expects a fully-formed, schema-valid document; enforces `matter_id`/`tenant_id` match + `status="registered"`); schema `case-box-document.schema.json`; brief §7.A.

## Problem

WI-2a made the Documents section read-only — it is empty until documents can be added. This slice lets a lawyer **add one local file to a matter** so the read surface becomes useful.

## Smallest safe vertical slice

User picks one local file → main computes `content_hash` → main copies the file into app-controlled storage → main builds a `storage_uri` → existing `registerDocument` persists the document → the Documents list refreshes and shows it.

## Conservative file-handling design

The renderer **never supplies a filesystem path**. The flow is main-driven:

1. Renderer calls `casebox:document:register` with only `{ matterId, doc_type }`.
2. Main validates the matter (existence + active tenant) **before** any dialog or filesystem access.
3. Main opens a single-file chooser (`dialog.showOpenDialog({ properties: ['openFile'] })`). Cancel → the channel returns `value: null` (not an error); nothing is stored.
4. Main computes a SHA-256 `content_hash` of the chosen file, copies it (never moves) into `<userData>/case-box-documents/<documentId>/<safe-basename>`, and derives `storage_uri = pathToFileURL(dest).href`.
5. Main builds the full document (server-authority fields injected: `id`, `tenant_id`, `actor_user_id`, `matter_id`, `source: "uploaded"`, `content_hash`, `storage_uri`, `received_at`, `status: "registered"`, `byte_size`), runs `validateDocument`, and calls `persistence.registerDocument(matterId, doc)`.

**Path-safety**: the destination is always strictly under `<storageRoot>/<documentId>/` where `documentId` is a server ULID; the user-influenced filename is reduced to `path.basename` and re-checked to resolve inside that subdir (a crafted `../…` name cannot escape; a pure `..` falls back to the documentId). The file is copied, not executed; `storage_uri` is data, displayed as text, never opened.

**Testability**: the file chooser and the storage util are injected dependencies of `registerDocumentHandler` (`chooseFile`, `storeFile`), so the handler logic is unit-tested without Electron/fs; the storage util is unit-tested against a real temp dir; production wires the dialog + `makeStoreFile(storageRoot)` in `electron/main.ts`.

## IPC contract (new channel)

```
casebox:document:register   RegisterDocumentDto { matterId: string; doc_type: DocType }
                            -> IpcEnvelope<CaseBoxDocument | null>   // null = user cancelled the chooser
```

Server-authority fields are FORBIDDEN in the DTO (`id`, `tenant_id`, `actor_user_id`, `content_hash`, `storage_uri`, `received_at`, `status`, `source`, `filename`, `byte_size`, `custody_chain`) → `invalid_payload`. `doc_type` must be a known enum value. Tenant injected server-side; renderer never supplies it.

## UI

The Documents disclosure gains an "Add document" row: a `doc_type` `<select>` + an "Add document" `<button>` + a status line. Click → button disabled + "Adding…" → on success "Added." and the list refreshes in place; on cancel "Cancelled." (no refresh); on error an inline `role="alert"`. `el()` sets `textContent` (no `innerHTML`); no file is ever opened from `storage_uri`.

## Out of scope (not bundled)

OCR, facts, evidence links, deadlines, privilege, confidentiality, file preview/open, drag-and-drop, multi-file, supersession, status/doc_type list filters. Deferred.

## Acceptance (testable)

1. Storage util: SHA-256 hash matches; file copied under `<root>/<id>/<basename>` with identical bytes (source untouched); `storage_uri` is the file URL; filename with path components → basename (no traversal); pure `..` → documentId fallback.
2. Handler happy path: builds the full document (source=uploaded, status=registered, injected tenant/actor/id), validates, persists; returns it.
3. Handler cancelled: `chooseFile` null → `value: null`; `storeFile` + `registerDocument` NOT called.
4. Handler scoping: forbidden `tenant_id`/`content_hash` → `invalid_payload`; unknown field → `invalid_payload`; invalid `doc_type` → `invalid_payload`; absent matter → `unknown_matter` (chooser NOT opened); tenant mismatch → `tenant_mismatch` (chooser NOT opened); schema violation (e.g. negative `byte_size`) → `invalid_payload` (registerDocument NOT called).
5. Renderer: add success registers (default doc_type) then refreshes the list; cancel shows "Cancelled." without refresh; error renders inline `role="alert"`.
