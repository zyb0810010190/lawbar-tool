# Design artifact — Audited evidence-links renderer UI (view / create / unlink / relink / export)

**Date**: 2026-06-26.
**WI (target, future)**: `WI-A3-LINK-UI-T1` — renderer UI for the audited link lifecycle (Type: UI; this artifact is
its `Design artifact:` gate reference).
**WI (this)**: `WI-A3-LINK-UI-DESIGN-00` (design-only; not A0.7-gated; no renderer code).
**Type**: UI (design only). **Surface**: a per-matter "Evidence links" disclosure inside the existing matter
detail view.
**Grounds**: the live persistence lifecycle (`createLink`/`unlinkLink`/`relinkLink` + `resolveLinkStatuses`/
`buildExportCitations`, `LINK_CREATED`/`LINK_UNLINKED`/`LINK_RELINKED`); the merged IPC surface (5 `casebox:link:*`
channels + preload `CaseBoxApi` methods, PR #142); `docs/adr/ADR-evidence-a3-link-ipc-surface.md`; and the renderer
precedents (fact create + fact review two-step + deadline transition two-step; status-label+`data-status`
rendering; i18n catalog; a11y patterns).

## Problem

The audited link lifecycle is complete in persistence + IPC, but the renderer has NO UI for it (and no link
methods in `renderer/api.ts`/`renderer/types.ts` yet). A lawyer cannot view a matter's evidence links, create a
link, see its status/export flags, unlink (break) a link with a reason, or relink it. This artifact designs that UI
so the future `WI-A3-LINK-UI-T1` impl lane has a settled, gate-referenceable design.

## Smallest safe vertical slice

A per-matter "Evidence links" disclosure (mirroring the Facts disclosure) that lists links with their resolver
**status + lifecycle** (NOT export flags — those live in the export panel, §2) and offers create / unlink
(reason-required) / relink actions, plus an "Export citations" trigger that shows the export citation set (where the
export flags appear). **Out of this slice**: export-document RENDERING (only the export DATA is shown/triggered); per-
evidence/per-anchor filtered views (matter-scoped list only in v1); any new audit-chain-internal display.

## 1. Placement / structure

- A new disclosure section **"Evidence links"** in the matter detail view, lazy-loaded on summary click (the Facts
  disclosure pattern, `renderer/screens/viewMatterFacts.ts`). Data via `api.listLinks({ matterId })` (matter from
  route context). A new screen module `renderer/screens/viewMatterLinks.ts` (loc-guardian: a dedicated file, not
  folded into `viewMatter.ts`).
- A **"Create link"** sub-form at the top of the section; the **list** below; each row carries its resolver
  **status + lifecycle** (active/unlinked), `created_at`, the `unlink_reason` (when unlinked), and its action(s) —
  **NOT** export flags (those are in the export panel, §2).
- An **"Export citations"** button at the section header that calls `api.exportLinkCitations({ matterId })` and
  renders the returned `{ citations, byFlag }` as a read-only citation list (卷X页Y labels + per-link status/flag +
  the byFlag summary counts). Export-to-document is a separate later lane.

## 2. UI state model for link rows + actions

**Two distinct data sources — the row contract is `RendererLink` ONLY (audit M1):**
- **The list row** is built from `RendererLink` (the `listLinks` projection), whose fields are exactly `id,
  matter_id, source_type, source_id, anchor_id, status, created_at, unlinked_at, unlink_reason`. So a row renders
  ONLY: the **lifecycle** (`active` when `unlinked_at` NULL vs `unlinked` when set, carrying `unlink_reason`) and the
  **resolver status** `status ∈ { valid, needs_review, broken }`. **`exportFlag` is NOT on `RendererLink`** and the
  list row MUST NOT show it — `LINK_RESPONSE_FIELDS` MUST NOT be extended with `exportFlag` (that would be an IPC
  contract change, out of scope; STOP if the impl wants it).
- **The export flags** (`exportFlag ∈ { null(clean), UNLINKED, BROKEN, NEEDS_REVIEW, NON_CITABLE, AMBIGUOUS }`) live
  ONLY in `ExportCitationResult.citations[]` (the SEPARATE `exportLinkCitations` call) and are shown ONLY in the
  **export-citations panel** (§1), joined to their link by `linkId` there — never folded into the list-row load.
- **Render rule** (never color-only): the list row shows a visible **status** label + `data-status="<status>"` + a
  CSS class (e.g. `view-links-status--broken`), mirroring the deadline urgency pill; the export panel shows a
  visible **flag** label + `data-flag="<exportFlag|clean>"` per citation. Labels live in the i18n catalog (§6). A
  row also shows `created_at`, and for an unlinked link the `unlinked_at` + `unlink_reason` (the audit-relevant
  facts; §7-auditability).
- **Action availability** (mirrors `reviewActionsFor(status)` in facts): an `active` link → **Unlink**; an
  `unlinked` link → **Relink**. Create is the section-level form. No action mutates by guessed id — every action
  carries `matterId` + `linkId` (the IPC layer does the scoped preflight).

## 3. User-facing action flows (create / unlink / relink)

All flows follow the precedent: disable controls → status "处理中… / Working…" → `api.<op>(dto)` → on `ok` refresh
the list in place + a success line ("已创建 / Created.", etc.); on `!ok` show the server message inline
(`role="alert"`), keep inputs, re-enable.

- **Create** (`api.createLink({ matterId, sourceType, sourceId, anchorId })`): a form — `sourceType` `<select>`
  (the 5-enum evidence/note/question/calcTerm/claimElement), `sourceId` + `anchorId` text inputs. Client validates
  non-empty + the sourceType enum (the IPC layer is the second guard). Not destructive → no extra confirmation
  beyond the form submit.
- **Unlink** (meaningful / durable / audited) (`api.unlinkLink({ matterId, linkId, unlinkReason })`): a per-row
  **Unlink** button reveals a **required** reason input (two-step, like fact-reject + deadline missed→met). Copy
  warns this **breaks the citation** and is **recorded in the audit trail**. Client guards a non-empty/non-blank
  reason before the call (server also enforces). Confirm button = "确认断开 / Confirm unlink".
- **Relink** (`api.relinkLink({ matterId, linkId })`): a per-(unlinked)-row **Relink** button, **no reason** (the
  persistence relink takes none); copy = "恢复此链接 / Restore link". One-click (it is reversible — the link is
  restored, the resolver recomputes the real status).

## 4. A0.7-gating + confirmation behavior

A0.7 is a **dev/commit-time governance gate, NOT a runtime feature** (`ADR-evidence-a3-link-ipc-surface.md` D4).
Therefore the UI **does NOT** show an "A0.7 marker" prompt or a runtime gate-unlock step, and the impl lane MUST
NOT invent one. The user-facing "confirmation behavior for a meaningful mutating action" is the **two-step
reason flow for unlink** (deliberate, reason-required) + the **create form submit**; relink is a single reversible
click. Runtime safety = the OS-sandbox offline posture + main-injected actor/tenant (the renderer never supplies
identity) — the UI surfaces none of that; it just calls the IPC method and renders the `{ok,error}` envelope.

## 5. Error / empty / loading / gate-failure display model

- **Loading**: a text banner ("加载链接… / Loading links…") — not spinner-only.
- **Empty**: a heading + paragraph ("此案件暂无证据链接") + a hint to use the Create form (the list-empty pattern).
- **Error (inline) — ONE model (audit L1)**: `role="alert"` shown only when an error occurs, cleared on new input.
  The **default** is to render the server **safe** message verbatim (the main process already maps
  `CaseBoxPersistenceError` → a static safe message via `errorMap.ts`; the renderer adds no REQUIRED i18n at the
  error boundary). The renderer MAY OPTIONALLY map a small allowlist of known codes to friendlier catalog copy
  (e.g. `illegal_transition` → "此链接已断开/已恢复 / link already unlinked/active — refresh the row";
  `unknown_matter`/`tenant_mismatch` → "无法加载 / could not load this matter's links"; `invalid_argument` on create
  → "missing evidence/anchor"), but it **MUST fall back to the server safe message** for any unmapped code — never a
  blank or a guessed message. (So: server-safe-message is the rule; per-code catalog copy is an optional, fallback-
  guarded refinement — the two are not in conflict.)
- **"Gate-failure"/permission state**: there is no runtime A0.7 gate, so there is no marker-failure UI. The error
  codes above are the only "permission/validation" states the user sees, all via the one error model.
- **Stale-load guard**: a superseded list load must not overwrite a refreshed list (the fact-review stale-load
  guard pattern).

## 6. Confidentiality / no-real-data constraints

- The link UI shows **identifiers (source_id, anchor_id — ids, not content), status, export flags, timestamps, and
  the lawyer-entered unlink_reason** only. It MUST NOT render raw evidence body / private PDF bytes / OCR text — the
  link DTOs carry none (the IPC `LINK_RESPONSE_FIELDS` already excludes `tenant_id`/`payload_json`; the export
  citation carries 卷X页Y DocumentPage labels, not evidence content). Linking to an evidence detail view (if any)
  reuses the EXISTING authorized evidence surface; the link UI itself adds no new evidence-content exposure.
- **No real evidence content** in fixtures, screenshots, logs, reports, or this/any design artifact — synthetic ids
  only (the `check-no-real-data` gate enforces this in the desktop tests).

## 7. Auditability without chain internals

Represent the link's audited lifecycle by its **visible facts** — created (timestamp), unlinked (timestamp +
reason), relinked — NOT by chain internals. The UI MUST NOT surface event hashes, `prev/before/after_state_hash`,
sequence numbers, or `event_kind` strings. (The existing audit-events view, if the user wants the raw chain, is a
separate surface; the link UI stays at the lifecycle/status level.)

## 8. Accessibility + i18n

- **a11y**: status as a visible label + `data-status` (never color-only); the unlink reason input gets a `<label
  for>` marked required + initial focus when revealed (the deadline missed→met reason pattern); Enter submits,
  Escape cancels the reason step; errors via `role="alert"`; success via `aria-live="polite"`; action buttons carry
  `aria-label` where the text isn't self-describing.
- **i18n**: ALL copy in `renderer/i18n/catalog.ts` (zh-CN; loud-fail on a missing key; the `renderer-i18n-guard`
  test forbids hardcoded UI strings). New keys the impl adds: `linkStatus.valid|needs_review|broken|unlinked`,
  `linkFlag.UNLINKED|BROKEN|NEEDS_REVIEW|NON_CITABLE|AMBIGUOUS`, `links.section.*`, `links.create.*`,
  `links.unlink.button|reasonLabel|confirm|warning`, `links.relink.button`, `links.export.button`, `links.empty.*`,
  `links.loading`.

## 9. Authority boundary (renderer bridge — the impl lane's prerequisite)

The link methods are ABSENT from `renderer/api.ts`/`renderer/types.ts`. The impl lane MUST add: the 5 methods to
the renderer `CaseBoxApi`/`CaseBoxClient` (wrapping `window.lawbar.caseBox.*` via `createCaseBoxApi` +
`stripDtoFields`); the renderer DTO types; and the `RENDERER_CREATE_LINK_DTO_FIELDS` / `RENDERER_UNLINK_LINK_…` /
`RENDERER_RELINK_LINK_…` / `RENDERER_LIST_LINKS_…` / `RENDERER_EXPORT_LINK_CITATIONS_…` strip allowlists in
`renderer/types.ts` — and EXTEND the `renderer-dto-sync.test.mjs` `PAIRS` list with the new link pairs (the
hard-coded list that gates renderer↔canonical DTO parity). The renderer strips outgoing request DTOs; it never
forwards `tenantId`/`actorUserId` (main injects them).

## 10. Test expectations (for the impl lane)

Renderer tests (MockDoc + stub `api`, plain node — no Electron/better-sqlite3): `renderer-links-list.test.mjs`
(lazy-load on disclosure; rows render the resolver **status** + lifecycle via `data-status`/`unlinked_at`, visible
label not color-only — NO export flag on the list row; empty/loading),
`renderer-links-create.test.mjs` (form → `createLink` → success refresh + clear / error inline; sourceType enum),
`renderer-links-unlink.test.mjs` (two-step reason; required-non-empty guard; `unlinkLink` → refresh; error keeps
inputs), `renderer-links-relink.test.mjs` (one-click `relinkLink` → refresh), `renderer-links-export.test.mjs`
(`exportLinkCitations` → citation list / error). Plus: extend `renderer-api.test.mjs` (`stripDtoFields` drops
`tenantId`/`actorUserId` from link DTOs) + `renderer-dto-sync.test.mjs` (the new RENDERER_*_LINK_DTO_FIELDS ↔
canonical pairs) + `renderer-i18n-guard` (the new catalog keys). All registered in `apps/lawbar-desktop/
package.json`'s curated test list (an additive manifest edit the impl lane's allowed-files must include).

## 11. Deferred items (explicitly addressed)

- **LINK-IPC-T1-D1** (real-db list/export IPC round-trip). **Recommendation: fold D1 into the UI impl lane** — the
  UI lane already builds/tests the desktop end-to-end and benefits from a real Electron-ABI `casebox:link:*`
  round-trip (create→list→export→unlink→relink). Add it as an Electron integration test
  (`tests/casebox-ipc.electron.test.mjs` extension). A separate Electron-integration predecessor is NOT necessary;
  bundling closes D1 exactly where the value is. If the impl lane finds the integration test too large, it MAY
  split it into its own follow-up — but D1 should close at or with the UI lane, not linger.
- **LINK-IPC-T1-D2** (stale "no errorMap change" governance prose). **Recommendation: a separate tiny docs-only
  cleanup lane** (or fold into the next governance-doc pass). It is doc-consistency only (the committed file-level
  governance is correct). Do NOT edit it in this UI design lane. It does not block the UI lane.
- **D3 — IPC ADR §2 DTO table stale (review-plan Low, 2026-06-26)**: `docs/adr/ADR-evidence-a3-link-ipc-surface.md`
  §2 still shows `UnlinkLinkDto { linkId, unlinkReason }` / `RelinkLinkDto { linkId }` WITHOUT `matterId`, but the
  live DTOs (`apps/lawbar-desktop/src/caseBox/dto/link.ts`) + this design include `matterId` (the WI-A3-LINK-IPC-T1
  High#1 scoped-preflight fix). This design correctly follows the live DTOs. **Fold the ADR §2 table sync into the
  same docs-only cleanup lane as D2** (do NOT edit the ADR here). Doc-consistency only; not blocking.

## 12. Sequencing recommendation

**Next lane = the UI IMPLEMENTATION (`WI-A3-LINK-UI-T1`, Type: UI)**, citing this artifact as its `Design artifact:`
(the PR-time `check-ui-design-artifact` gate + the queue UI gate). That lane: (1) the renderer link bridge (§9), (2)
the `viewMatterLinks` screen + the create/unlink/relink/export flows + status rendering, (3) the i18n catalog keys,
(4) the renderer tests (§10), (5) **D1's Electron integration round-trip**. A0.7 posture: the UI lane is NOT
A0.7-gated at runtime; its **commit SHOULD be treated as A0.7-gated (custody 9b)** — it touches court-facing link
presentation, like the IPC lane — UNLESS that lane's own review-plan records a concrete contrary reason. Either
way, NO runtime A0.7 marker UI is added (review-plan note, 2026-06-26). The **D2 docs cleanup** is an independent
trivial lane, anytime.

## Out of scope (this design)

Export-document rendering; per-evidence/per-anchor filtered link views; bulk operations; an audit-chain-internal
viewer; any renderer code; any IPC/persistence/schema/contract change.

## Stop condition

"Done" when this artifact + its governance are committed. "Outdated" when `WI-A3-LINK-UI-T1` ships (the artifact is
retired/realized), or when a superseding link-UX decision is recorded.
