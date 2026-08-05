# Design — Matter-details edit screen (`#/matters/:id/edit`)

**Date:** 2026-08-05. **Feature:** issue #2 "edit case info after creation" (user request). **Type:** UI design
artifact for Phase D of the matter-details-edit vertical (parent `dev-memo/plan-matter-details-edit-00.md`).
**Backend:** DONE — audited IPC `casebox:matter:updateDetails` (Phase C `99c5517`) + persistence
(Phase B `8b591cf`) + reason-hardening (`e9ff43c`). **Style:** macOS HIG restyle, original ivory+honey palette
(`dev-memo/design/2026-08-04-app-restyle-macos-hig.md`; tokens in `src/theme/tokens.ts`). **UX consult:** Codex
`review-plan-msfyrorm-0qavjf` (decisions below evaluated + accepted).

## Purpose
Let a lawyer correct/update the 6 free-text descriptive fields of a matter after creation, recording a required
court-facing `reason` on each edit. Mirrors the existing `archiveMatter` form screen (the closest precedent).

## Route + entry + nav
- Route `#/matters/:id/edit` (3-segment, ULID-guarded), mirroring `#/matters/:id/archive`. Registered in BOTH
  `renderer/router.ts` and `renderer/index.ts` (duplicated route table).
- Entry: a `view-edit` button (`button--primary`, `t("detail.editButton")`) on `viewMatter`, rendered ONLY when
  `row.status === "active"` (hidden for archived matters — decision 3). Placed in the detail header/actions area,
  NOT in the archive danger zone.
- Nav loop: viewMatter → Edit → on success `navigate(buildHash("view", {id}))` back to the refreshed detail
  (decision 5). No audit-history panel — the in-app audit VIEW was removed per the user (`我不需要审计链`,
  WI-2d `2275551`); the event is still RECORDED by the mechanism, just not displayed.

## The 6 editable fields (seeded from `getMatter`)
| Field | Label key | Required? | Clearable? |
|---|---|---|---|
| `name` | `detail.field` name (title) | REQUIRED | NO (empty-name submit blocked inline) |
| `retainer_scope` | `detail.field.retainerScope` | optional | yes → `""` |
| `case_type_text` | `detail.field.caseType` | optional | yes → `""` |
| `case_progress_text` | `detail.field.caseProgress` | optional | yes → `""` |
| `court_contact_text` | `detail.field.courtContact` | optional | yes → `""` |
| `contention_summary_text` | `detail.field.contentionSummary` | optional | yes → `""` |

Reuse the existing `detail.field.*` labels for consistency with the read-only view. `name` uses a text `input`; the
5 descriptors use `textarea` (they are multi-line in the detail view).

## Layout (top → bottom)
1. Back link (`← 返回案件`, `matterEdit.backToMatter`) + title `matterEdit.title` (interpolates `{name}`).
2. The 6 fields (name first, then the 5 descriptors), each a `.field` with label + control + inline error hint
   (`.field-hint--error`) for the name-required rule.
3. **"Changes to be recorded" summary** (`matterEdit.changesTitle`) — a live region listing which fields will
   change (by label), recomputed on every input against the seeded values (decision 2). Empty state:
   `matterEdit.changesNone` ("尚无更改"). This sits immediately ABOVE the reason field so the recorded justification
   is reviewed against the actual delta.
4. **Reason** textarea (`matterEdit.reasonLabel` with `{min}`/`{max}`), REQUIRED for every edit including clearing
   an optional field (decision 2). Bounds mirror archive: min 10, max 500.
5. Form actions: Submit (`matterEdit.submit`, `button--primary`) + Cancel (`matterEdit.cancel`, back to view).
6. Hidden `role="alert"` form-error (zh-CN safe message via `errorMessage(env.error)`) + `role="status"`
   `aria-live="polite"` announce region (mirror archive).

## Behaviour
- **Seed:** load via `api.getMatter({matterId})`; prefill each control with the current value (optional descriptors
  absent → empty control). Invalid ULID → invalid-id view, no IPC. `env.value === null` → not-found. Envelope error
  → error view.
- **Dirty-tracking (decision 1):** keep the seeded snapshot; on any input recompute the changed set; ENABLE Submit
  only when ≥1 field differs from its seed AND `name.trim()` is non-empty. This pre-empts `no_editable_change` so the
  user never hits that server error for a permanent audit action.
- **Patch construction:** send only the 6 fields in `patch`; for each descriptor, `""` (cleared) is sent as an
  explicit change; `name` always sent (required). (Persistence canonicalizes + rejects a true no-op; the UI's
  dirty-gate makes that unreachable in the happy path.)
- **Name required (decision 4):** on submit, if `name.trim()===""` → inline field error
  (`matterEdit.error.nameRequired`), focus name, no IPC. The 5 descriptors may submit as `""`.
- **Reason validation:** trim; too-short → `matterEdit.error.reasonTooShort {min}`; too-long →
  `matterEdit.error.reasonTooLong {max}`; both inline, focus reason, no IPC.
- **Submit:** re-entrancy guard; disable submit; announce `matterEdit.status.saving`; call
  `api.updateMatterDetails({matterId, patch, reason})`; on `!ok` show `errorMessage(env.error)` in the form-error
  (handles `matter_archived`/`no_editable_change`/`invalid_payload`/`unknown_matter`/`tenant_mismatch`/
  `audit_chain_desync` as zh-CN safe messages), re-enable, return; on success announce
  `matterEdit.status.saved` → `navigate(view)`.
- **Archived direct-route (decision 3):** if `row.status !== "active"`, render a READ-ONLY variant — the fields shown
  disabled + an archived banner `matterEdit.archivedBanner` ("案件已归档，需先取消归档才能编辑。") + a back/unarchive
  affordance; NO editable form, NO submit. (The entry button is already hidden for archived, so this is the
  direct-URL safety net.)

## Style
- No hardcoded hex (`renderer-no-hardcoded-color.test.mjs`). Reuse `.field`, `.field textarea/input`,
  `.field-hint--error`, `.form-error`, `.form-actions`, `.button`/`.button--primary`, `.back-link`, `.view-card`.
  The macOS look (radius 6/8/12, warm elevation shadows, ivory canvas `#F7F4EE` / honey accent `#D88B57`) is
  inherited from the tokens — the form matches archive automatically.
- The "Changes to be recorded" summary uses a `.view-card`-like container (muted heading + a list); accent only on
  the changed-field labels if any accent is used — keep it quiet.

## Copy (new `matterEdit.*` + `detail.editButton`, all zh-CN, through `t()`)
`detail.editButton` "编辑…"; `matterEdit.backToMatter` "← 返回案件"; `matterEdit.title` "编辑案件信息 — {name}";
`matterEdit.loading` "正在加载案件…"; `matterEdit.notFoundTitle`/`invalidIdBody`/`unavailableTitle`/`staleLinkBody`
(mirror matterArchive); `matterEdit.changesTitle` "将记录的更改"; `matterEdit.changesNone` "尚无更改";
`matterEdit.reasonLabel` "原因 *（{min}–{max} 个字符）"; `matterEdit.submit` "保存更改"; `matterEdit.cancel` "取消";
`matterEdit.error.nameRequired` "案件名称不能为空。"; `matterEdit.error.reasonTooShort` "请填写原因，且至少需 {min} 个字符。";
`matterEdit.error.reasonTooLong` "原因不得超过 {max} 个字符。"; `matterEdit.status.saving` "正在保存…";
`matterEdit.status.saved` "已保存"; `matterEdit.archivedBanner` "案件已归档，需先取消归档才能编辑。".

## Tests
- `tests/renderer-edit-matter.test.mjs` (mirror `renderer-archive-matter.test.mjs` MockDoc harness): invalid ULID →
  no IPC; envelope error / not-found views; seed prefill; dirty-gate (submit disabled with no change, enabled after
  a change); name-required inline block (no IPC); reason too-short/too-long inline; happy-path calls
  `updateMatterDetails` with the right patch+reason and navigates to view; each persistence error → safe message;
  archived → read-only (no submit). Register in `package.json` test script.
- `viewMatter` test: assert the `view-edit` button exists + navigates for active, and is ABSENT for archived.
- Regenerate `ui-strings-allowlist.json` (the `node -e` scanner one-liner) AFTER the source is final; re-run the
  FULL desktop gate (the i18n guard is LINE-INDEXED — a late comment edit shifts entries; regen is the last step).

## Out of scope
Editing parties / confidentiality / jurisdiction / matter_type / status (each has its own audited path or is
frozen); the audit-history VIEW (removed per user); any push/merge.
