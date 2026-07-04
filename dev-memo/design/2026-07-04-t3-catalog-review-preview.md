# Design artifact — T3 证据目录及说明 review/preview surface (S2)

**Date**: 2026-07-04.
**WI**: `WI-FORMS-T3-S2-CATALOG-PREVIEW-00` (Forms T3 slice S2 — in-app read-only review/preview of the T3 catalog).
**Type**: UI (read-only). Manual-merge (touches renderer + a new read-only IPC channel).
**Surface**: a new read-only **证据目录及说明 (T3 catalog) preview** section on the existing matter detail screen (`apps/lawbar-desktop/renderer/screens/viewMatter.ts`), rendered by a NEW sibling module `renderer/screens/viewMatterT3Catalog.ts`. No new route.
**Grounds (source of truth)**: the S1 logical model `apps/lawbar-desktop/src/caseBox/export/t3CatalogModel.ts` (`buildT3CatalogModel` / `T3CatalogModel` / `T3CatalogRefusal`, merged in PR #170); persistence read `listEvidenceItems` (`services/case-box-persistence/src/types.ts` `ListEvidenceItemsQuery`/`ListEvidenceItemsPage`) + the existing matter read; parent plan `dev-memo/plan-forms-t3-evidence-catalog-00.md` §4 slice S2; ADR `dev-memo/adr-forms-t3-s0-schema.md`; DR-00 (`dev-memo/forms-spec-a10-t3-t5-sample-adr-00.md` §H).

## Problem

The T3 证据目录及说明 logical model exists (S1: `buildT3CatalogModel`) but there is **no way for a lawyer to see it**. It is a main-process node module (imports `node:crypto`), and — critically — **there is no `casebox:evidence:*` IPC channel at all today** (evidence is persisted but never surfaced to the renderer). So the review/preview surface cannot be a renderer-only change; it needs a read path. This slice surfaces the **read/preview** only: an in-app, read-only rendering of the S1 model for a matter. It renders the internal lawyer trial-review catalog on screen; it does **not** generate a DOCX/PDF and does **not** decide the export renderer (that is S3, separately gated).

## Key architectural decision (primary review-plan question)

Because the S1 model lives in the main process and no evidence IPC exists, S2 requires **exactly one new READ-ONLY IPC channel** that, in the main process, reads the matter + `listEvidenceItems`, calls the merged `buildT3CatalogModel`, and returns the resulting `T3CatalogModel` (plus, optionally, `t3CatalogModelSha256`) to the renderer. The renderer renders it as a read-only table — it does **not** re-implement the model logic (S1 is the single source of truth) and cannot import the main-process module (`node:crypto`). This mirrors the `casebox:document:list`/`get` read-channel precedent (`dev-memo/design/2026-06-03-casebox-documents-readonly.md`).

This is the one surface expansion S2 needs. It is read-only, non-mutating, and adds no evidence WRITE path. Alternative considered and rejected: reimplement `buildT3CatalogModel` in a renderer-safe module — rejected because it duplicates court-facing truth logic and violates "S1 is the source of truth." If the reviewer or user prefers to avoid any new IPC channel, S2 cannot proceed as a preview and must be re-scoped or deferred — surfaced here rather than silently chosen.

## Scope (this WI / slice S2)

- **Read-only.** No evidence create/edit/transition, no field entry, no submitter *editing*. Display of the S1 model only.
- **One** new read-only IPC channel: `casebox:t3:previewCatalog` (matter-scoped; builds and returns the `T3CatalogModel`). No other channel.
- A 证据目录及说明 preview section on the matter view: lazily fetch + render the header (提交人诉讼地位 + submitter 名称/姓名) and the 4-column table (序号 / 证据名称 / 证明内容 / 页码).
- Honor the S1 model exactly: ordering, `reviewNeeded` markers, non-promotion, status filtering (default `accepted`), submitter refusal.

Out of scope (not bundled): DOCX/PDF generation; any export renderer decision (S3); evidence create/edit/registration; the `卷X页Y`/A10 citation column; submitter *selection UI* beyond surfacing a refusal state (a picker is a follow-up if needed); T4/T5 (证明对象/三性/质证) of any kind; contract/schema/persistence change; `CURRENT_SCHEMA_VERSION` change; migrations; native/custody/marker/JS-shim/A8; new runtime dependency.

## LOC guard (mandatory pre-step for the impl WI)

`viewMatter.ts` is in the loc-guardian warn zone historically; the T3 preview MUST live in its own sibling `renderer/screens/viewMatterT3Catalog.ts` (mirroring `viewMatterDocuments.ts`), NOT be inlined into `viewMatter.ts`. If wiring the section pushes `viewMatter.ts` over the warn threshold, extract mechanically (no behavior change) as prior siblings did. New files kept well under the 800-source / 1200-test fail thresholds.

## Data path + IPC contract (new read-only channel)

The request DTO + result type live in a NEW per-entity module `apps/lawbar-desktop/src/caseBox/dto/t3.ts` (mirroring `dto/document.ts`), re-exported from the `dto.ts` barrel — consistent with the existing per-entity DTO split (no monolith growth).

```
casebox:t3:previewCatalog
  req:  T3PreviewCatalogDto { matterId: string; submitterSelection?: { partyIndex: number; displayNameEcho: string } }
  res:  IpcEnvelope<T3CatalogPreviewResult>
        // IpcEnvelope is the EXISTING strict shape: { ok: true, value } | { ok: false, error }.
        // A read ERROR (unknown_matter / tenant_mismatch / invalid_payload) is { ok: false, error }.
        // A submitter REFUSAL is an EXPECTED review state, NOT an error — it rides in the SUCCESS value
        // as a discriminated union (never `null`):
        //   T3CatalogPreviewResult =
        //     | { kind: "model";   model: T3CatalogModel; modelSha256?: string }
        //     | { kind: "refusal"; code: T3RefusalCode }   // one of the four S1 T3CatalogRefusal codes
```

Scoping (mirrors the matter/document channels):
- Renderer never supplies `tenant_id`/`actor_user_id` (forbidden DTO fields → `invalid_payload`); the server injects the active tenant.
- Matter existence + active-tenant checked BEFORE any evidence read; on absent matter → `unknown_matter` (evidence read not called); on tenant mismatch → `tenant_mismatch`.
- **Pagination drain (mandatory)**: `listEvidenceItems` is seek-paginated (default page 50, `next_cursor`). S1 assigns `sequence`/order over the FULL input, so the handler MUST drain **all** `status: "accepted"` pages — loop `listEvidenceItems({ tenant_id, matter_id, status: "accepted", cursor })` with a bounded page size until `next_cursor === null`, accumulate the rows, THEN call `buildT3CatalogModel` ONCE over the complete set. Never build from a single truncated page.
- The main handler calls the merged `buildT3CatalogModel({ matter, evidenceItems, submitterSelection })`; a thrown `T3CatalogRefusal` is caught and mapped to `{ ok: true, value: { kind: "refusal", code } }`, never a crash and never an error envelope.
- The renderer receives an already-built model (or a refusal result); it does NOT import `t3CatalogModel.ts`.

The renderer needs a read-only view type mirroring `T3CatalogModel` (structural, in `renderer/types.ts`); no contract-package change either way.

## Layout (ASCII mock)

```
▾ 证据目录及说明 (preview)                         ← <details data-test-id="view-t3-summary">
  提交人诉讼地位:  原告 (plaintiff)                ← header; ⟨needs review⟩ if absent/out-of-enum
  名称/姓名:       孙乐驰

  ┌──────┬──────────────┬────────────────────────┬────────┐
  │ 序号 │ 证据名称       │ 证明内容                 │ 页码    │
  ├──────┼──────────────┼────────────────────────┼────────┤
  │  1   │ 银行流水       │ 证明款项交付。            │ 4-7    │
  │  2   │ ⟨needs review⟩ │ ⟨needs review⟩          │ ⟨needs review⟩ │
  │  3   │ 借条          │ 1、证明借款…；2、证明金额。 │ 1-3    │
  └──────┴──────────────┴────────────────────────┴────────┘

  (empty)   本案暂无已采纳证据可供目录展示。         ← no accepted evidence

  (refusal) 需选择提交人：本案存在 0 或多个当事人（client），请指定提交人后再预览。
            ← T3CatalogRefusal(submitter_selection_required)
```

## Behavior & states

The preview disclosure loads lazily on first open (one `previewCatalog` call). It renders the header then the table. Each `reviewNeeded` cell renders a visible, non-fabricated marker (e.g. `⟨needs review⟩` / a localized string), never blank-that-reads-as-data and never a substituted value.

| State | Render | data-test-id |
|---|---|---|
| Loading | "加载证据目录…" | `view-t3-loading` |
| Empty (no accepted rows) | "本案暂无已采纳证据可供目录展示。" | `view-t3-empty` |
| Envelope/read error | `<p role="alert">` with `env.error.message` | `view-t3-error` |
| Submitter refusal | review banner naming the refusal (needs submitter selection / stale echo) | `view-t3-refusal` |
| Populated | header + `<table>` of rows (序号 / 证据名称 / 证明内容 / 页码) | `view-t3-table` / `view-t3-row` |
| review-needed cell | explicit marker element | `view-t3-review-needed` |

`el()` sets `textContent` (no `innerHTML`); Chinese proof text rendered verbatim (already NFC from the model). No file is written/opened.

## Field mapping (from the S1 model — no promotion)

| Column / header | Source (S1 model field) | Rule |
|---|---|---|
| 序号 | `row.sequence` | 1..n over the ordered+filtered rows; raw `display_order` not shown. |
| 证据名称 | `row.evidenceName` (`{text}` XOR `{reviewNeeded}`) | from `evidence_title` ONLY; `notes`/filename/`party_side` never shown as the name. |
| 证明内容 | `row.proofStatement` | from `proof_statement` ONLY; verbatim (NFC). |
| 页码 | `row.pageRange` | from `exhibit_page_range` ONLY; NO `卷X页Y` column; never replaced by a citation. |
| 提交人诉讼地位 | `model.litigationPosition` (`{value}` XOR `{reviewNeeded}`) | matter-level; `⟨needs review⟩` when absent/out-of-enum. |
| 名称/姓名 | `model.submitterName` | S1 submitter resolution; refusal → refusal state, never a guessed name. |

## Ordering, missing-field, non-promotion (inherited verbatim from S1)

- **Ordering**: exactly the S1 order (valid `display_order` first ascending, then stable `created_at ASC, id ASC`); the UI does not re-sort.
- **Missing/blank**: `reviewNeeded` → explicit marker cell; never invented, never blank-as-data.
- **Non-promotion**: `notes`, source-document filename, and `party_side` MUST NOT appear as 证据名称/证明内容/页码.
- **Status filtering**: default `accepted`-only (excludes proposed/rejected/superseded — supersession chain shows only the live row), per the S1 default; the UI does not widen it in M0.

## Accessibility

The catalog is a `<table>` with a `<caption>` and `<th scope="col">` column headers; the disclosure is `<details>`/`<summary>`. Errors/refusals use `role="alert"`. `review-needed` markers carry accessible text (not color-only). Tab order follows DOM. Localized strings go through the existing i18n allowlist.

## Non-goals / forbidden scope (the impl WI approves NONE of these)

- **No DOCX/PDF generation** and **no export renderer decision** (S3, separately gated on the runtime-dependency hard-stop).
- **No evidence write path** (create/edit/transition/registration) and **no submitter-editing** persistence.
- **No `卷X页Y`/A10 citation column** (页码 stays `exhibit_page_range`).
- **No contract/schema/persistence change**, **no `CURRENT_SCHEMA_VERSION` change**, **no migration/DDL**.
- **No native/custody/marker/JS-shim/A8** and **no T4/T5** fields or behavior.
- **No new runtime dependency.**
- **No re-implementation of the S1 model** in the renderer (S1 is the single source of truth).

## Acceptance (testable — for the future S2 implementation WI)

1. Preview disclosure does not call `previewCatalog` until opened; opening renders the header + rows (renderer test with a stub returning a built model).
2. 序号/证据名称/证明内容/页码 render from the model's `sequence`/`evidenceName`/`proofStatement`/`pageRange`; a `reviewNeeded` cell renders the explicit marker (`view-t3-review-needed`), never blank-as-data.
3. Empty (no accepted rows) shows the empty string; a widened status is NOT offered in M0.
4. `litigationPosition` `{value}` renders the position; `{reviewNeeded}` renders the marker.
5. A refusal result (`{ kind: "refusal", code }`) renders the `view-t3-refusal` banner naming the reason; no guessed submitter name appears. Cover **all four** S1 codes: `submitter_selection_required` (0/multi client), `submitter_index_out_of_range`, `submitter_not_client`, `submitter_selection_stale`.
6. `notes`/filename/`party_side` present on the underlying evidence never appear as 证据名称/证明内容/页码 (test with an item carrying them + no S1 fields → all three cells are `review-needed`).
7. Row order matches the S1 model order (UI does not re-sort).
8. **Pagination drain**: a matter with **> 50 accepted evidence items** yields a model over ALL of them (序号 1..n over the full set, S1 order), proving the handler drains every `accepted` page until `next_cursor === null` before building — not a single truncated page.
9. IPC handler success/error shape: renderer-supplied `tenant_id`/`actor_user_id` → `{ ok: false }` `invalid_payload`; an unknown DTO field → `invalid_payload`; a malformed `submitterSelection` (wrong types) → `invalid_payload`; absent matter → `unknown_matter` (evidence read not called); tenant mismatch → `tenant_mismatch`; a thrown `T3CatalogRefusal` → `{ ok: true, value: { kind: "refusal", code } }` (success value, NOT an error, NOT a crash, never `null`).
10. No DOCX/PDF is produced and no `卷X页Y` column exists; `页码` equals `exhibit_page_range`.
11. Regression: no T4/T5 (证明对象/三性/质证) field appears; `CURRENT_SCHEMA_VERSION` remains 12; no migration/DDL added.
