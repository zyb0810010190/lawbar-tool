# PLAN — WI-PTA-VS3: ClaimTrack screen (renderer disclosure — grouped list + add form)

**Type:** UI / Tier-1.5 UI-with-legal-semantics WI under the governed lane
`dev-memo/plan-pta-claimtrack-completion-lane-00.md` (VS-3 row). **Status:** DRAFT — non-authorizing until
cc-suite `review-plan` READY. **Branch:** `feature/pta-claimtrack-vertical-slice`. Local commits only; no push.

**Design artifact:** `dev-memo/design/2026-08-03-claimtrack-screen.md` (satisfies the UI-GATES `Design artifact:`
requirement; authored from a Codex design consult, thread `019fcd47`, on Frank's explicit delegation). This docket
implements that artifact; every UX decision below traces to a numbered section of it.

**Review record:** cc-suite `review-plan` `review-plan-mseusfsg-z3clq0` (Path 1 runner, native `--background`) →
**READY (Low-risk clarifications).** All 5 §6 questions confirmed: disclosure-not-route sound for v1; the three legal
concepts stay independent; id-bearing-only party selects correct + `Party.id?:string` the right minimal widening;
client `sort_order` auto-append the right boundary; test plan adequate. Six Low-risk clarifications folded (no
re-review required): (a) the disabled state splits into two truthful cases — `<2` parties vs `≥2` parties but `<2`
id-bearing (D3, §8 copy); (b) a row-level unknown-party fallback label when a stored party id is not in the loaded
matter (§3, AC 2b, §8); (c) `track_type` selection MUST NOT auto-mutate `our_role` — defaults ok, coupling not (§3,
AC 8b); (d) a test that a 反诉 row's posture and direction do not imply each other (AC 2); (e) `package.json` named
explicitly as `apps/lawbar-desktop/package.json` (§1); (f) label-facade tests are in-scope, co-located in the new
`renderer-claim-track.test.mjs` (§1, AC 8).

**Consumes (all already shipped, unchanged):** VS-2 IPC (`api.createClaimTrack` / `api.listClaimTracks`,
`renderer/types.ts` DTOs + allowlists, preload channels — commit `9b1e0e2`); VS-1 persistence; VS-0 party ULIDs.
The backend is complete — **VS-3 is renderer-only**. No `services/**`, no `docs/contracts/**`, no `src/caseBox/**`,
no `electron/**` change.

## 1. Scope

A per-matter **ClaimTrack `<details>` disclosure**, composed into the matter detail view exactly like the facts /
links / deadlines / docket / T3 siblings (`viewMatter.ts` mainCol). It renders:
- a **read-only grouped list** — two fixed groups 本诉 (`main_claim`) then 反诉 (`counterclaim`), each ordered by
  `sort_order` asc; each row = `序号 · 标题 · 我方主张|我方应对 · 主张方 → 相对方 · 状态徽章` (design §3);
- an **add form** (the only write) — required identity fields (`track_type` / `our_role` / `claimant_party_id` /
  `respondent_party_id` / `title`) + an optional collapsed `▸ 补充内容` (the 4 summary fields); `status` is
  server-set `active`; `sort_order` is **auto-appended** client-side = next index within the selected group
  (design §4 divergence — reason recorded there).

### Architecture decision — disclosure, not a route (design §2 reconciliation)
The design artifact frames placement as a nav area (`庭审准备 › 诉请跟踪`). Every existing per-matter entity
(facts/links/deadlines/docket/T3) is instead a lazy `<details>` inside `viewMatter.ts` — no router/nav/sidebar
surface. VS-3 follows that precedent: it places ClaimTrack under the matter, near the other trial-prep disclosures,
satisfying the design's core intent ("a dense trial-prep register under the matter, not generic case metadata")
with the **minimum** surface and zero divergence from sibling structure. A top-level route + sidebar entry is
deferred (would raise the WI surface: `router.ts`/`index.ts`/`nav.ts`/`index.html`) and is not needed for v1. This
is the one deliberate divergence from the artifact's framing; the register content is unchanged.

### Target files (renderer-only)
- `renderer/screens/viewMatterClaimTracks.ts` — **NEW**. `renderClaimTracksDisclosure(doc, api, matterId, parties)`
  returning a `<details>` (mirror `renderFactsDisclosure`, `viewMatterFacts.ts`). Lazy list load on first open;
  grouped render; the add form + its validation + `unknown_party`/error handling; the disabled/empty states.
  Defines a local display interface `ClaimTrackRow` (facts-precedent `FactRow`), not a new exported type.
- `renderer/screens/viewMatter.ts` — **EDIT**: import + instantiate `renderClaimTracksDisclosure(...)` and insert it
  into the `mainCol` children array (§ lines 411-423 precedent), passing the already-loaded `matter.parties`.
- `renderer/types.ts` — **EDIT**: widen the renderer `Party` interface (lines 28-33) with `readonly id?: string`
  (the data already flows through `MATTER_RESPONSE_FIELDS.parties`; only the TS type omits it). No other type change.
- `renderer/i18n/catalog.ts` — **EDIT** (exempt from the anti-literal scanner): add the zh-CN keys (full list in §8).
- `renderer/i18n/labels.ts` — **EDIT**: add `claimTrackTypeLabel` + `claimTrackOurRoleLabel` (closed-union
  exhaustive `switch` + `assertNever`, mirror `matterTypeLabel`) and `claimTrackStatusLabel` (open-`string`
  lookup+fallback, mirror `deadlineStatusLabel` — an unknown status must never throw).
- `renderer/i18n/ui-strings-allowlist.json` — **EDIT**: regenerate after build so the new enum-value option
  literals + separators are captured (the drift guard requires an exact match; §6 discipline).
- `tests/_view-matter-dom.mjs` — **EDIT**: extend `makeStubApi` with `createClaimTrack`/`listClaimTracks`; give
  `syntheticMatter` at least two parties **carrying `id`s** so the form is enabled in tests.
- `tests/renderer-claim-track.test.mjs` — **NEW** (mirror `renderer-fact-write.test.mjs`): grouped-list render,
  form validation (required-field block; same-party-both-sides block), create forwards the correct DTO
  (auto-appended `sort_order`, server fields absent), `unknown_party`/error rendering, and the disabled state when
  < 2 id-bearing parties.
- `apps/lawbar-desktop/package.json` — **EDIT**: register `tests/renderer-claim-track.test.mjs` in the `test`
  script (and the `test:ui-*` alias if one groups the renderer tests). Test-wiring only; no dependency change.

The label-facade unit tests (`claimTrackTypeLabel` / `claimTrackOurRoleLabel` / `claimTrackStatusLabel`, including
the unknown-status fallback) live **co-located in the new `tests/renderer-claim-track.test.mjs`** (the
`renderer-audit-labels.test.mjs` facade-test idiom, kept in one new file to avoid touching a second test file).

**NOT touched:** any `services/**`, `docs/contracts/**`, `src/caseBox/**`, `electron/**`; `renderer/api.ts` /
`preload.mts` (VS-2 already wired them); `router.ts` / `index.ts` route table / `nav.ts` / `index.html` (disclosure,
not a route); `errorMap.ts` / `errorMessage.ts` (all ClaimTrack error codes — incl. `unknown_party` — already have
catalog entries and `KNOWN_ERROR_CODES` membership from `8809a9e`).

## 2. Resolved design decisions (trace to the artifact)

- **D1 — three concepts stay distinct (design §1, load-bearing).** The row shows 我方立场 (`our_role`) AND
  诉请方向 (`claimant → respondent`) as **separate** cells; neither is derived from the other, and neither is
  derived from 诉讼地位 (原告/被告). In a 反诉 these invert, so fusing them would mislabel the counterclaim.
  `our_role` uses NEW labels 我方主张/我方应对 — it is a different axis from the T3 原告/被告 position labels
  (contract: `our_role` is "Independent of plaintiff/defendant"). Do not reuse `viewT3.position.*`.
- **D2 — party selects come only from the matter's parties (design §5).** Dropdown options are built from
  `matter.parties[]`, option label `名称（诉讼地位）` where the litigation role is available, `value` = `party.id`.
  The lawyer never types an id or an ad-hoc name. Selecting the same party as both 主张方 and 相对方 is **blocked**
  (no exception-note field in v1).
- **D3 — party-id absence → TWO distinct disabled states (design §5 extended; review-plan clarification a).** VS-0
  assigns party ULIDs at matter-create; legacy matters' ids are backfilled later (deferred, no desktop trigger yet).
  So a matter may have parties **without** ids. The form populates the selects **only from id-bearing parties** and
  disables creation in two truthful cases with **distinct** copy (the design §5 "add two parties" message is
  *inaccurate* when parties already exist but lack ids):
  - **`< 2` total parties** → design §5 copy: `暂无可选当事人 — 请先在案件中添加至少两位当事人，再创建诉请跟踪项。`
    (add parties).
  - **`≥ 2` total parties but `< 2` id-bearing** → NEW copy (no fake action — backfill is not wired to the desktop
    in v1): `此案件的当事人尚未分配标识，暂无法创建诉请跟踪项。` (party identities not yet assigned).
  This is a mechanical extension of the artifact's disabled-state intent, **not** new product direction, so it is
  decided here (Codex confirmed in review-plan: id-bearing-only selects are correct + safe; do NOT invent identity;
  do NOT add a backfill button without an IPC).
- **D8 — party-label suffix reconciliation (data-model truth over the artifact's example).** Design §5's example
  `张三（原告）` assumes a per-party 原告/被告 role, but the model stores per-party `role`
  (`client`/`opposing`/`third_party` → 委托人/对方当事人/第三人 via the existing `partyRoleLabel`) plus a
  **matter-level** `litigation_position` (our side, 原告/被告) — there is NO per-party 原告/被告. The option/cell
  suffix therefore uses `partyRoleLabel(party.role)` (委托人/对方当事人/第三人) when `role` is present, and the plain
  `display_name` otherwise. Do **not** fabricate a per-party 原告/被告 — that data is not modeled. This is a
  truthful reconciliation, not a product change.
- **D4 — `sort_order` auto-append (design §4 divergence).** The renderer computes `sort_order` = count of existing
  rows in the selected group (next index); no user-facing order control in v1. Manual reorder is the first VS-3
  follow-up (paired with the edit slice). The handler passes `sort_order` through (VS-2 R6) — no server ordering.
- **D5 — status badge (design §3).** `active → 进行中`; `withdrawn → 已撤回` / `resolved → 已了结` are reserved
  (v1 only ever creates `active`, but the label facade renders all three so a future slice needs no UI change).
- **D6 — empty / first-run copy is functional, never fake sample cards (design §6).** Zero tracks with ≥2
  id-bearing parties → the design §6 empty copy + an `添加诉请` button. Zero selectable parties → the D3 disabled
  message. No sample/fake legal rows (fake content erodes trust in a court-facing tool).
- **D7 — read model.** `listClaimTracks({matterId})` returns a **plain unpaginated array** (VS-2 / design §3) —
  simpler than facts (no `next_cursor` / "load more"). Group + sort client-side.

## 3. Behavior (the disclosure)

`renderClaimTracksDisclosure(doc, api, matterId, parties)` → `<details>` with summary `诉请跟踪`. On first open
(lazy, facts precedent): `const env = await api.listClaimTracks({ matterId })`; `if (!env.ok)` render
`errorMessage(env.error)` in a `role="alert"` node and stop; else `const rows = env.value as ClaimTrackRow[]`,
partition into `main_claim` / `counterclaim`, sort each by `sort_order` asc, render the two labelled groups (each
row per design §3). **Row party-cell resolution (review-plan clarification b):** a row resolves each of
`claimant_party_id` / `respondent_party_id` against a `Map<id, party>` built from the loaded matter; when a stored id
is **not** present (e.g. a party removed after the track was created, or an id-less legacy party), the cell renders a
localized fallback `t("claimTrack.unknownParty")` (`未知当事人`) — never blank, never a crash, never the raw id. Then render the add form (or its disabled state per D3).

**Form control independence (review-plan clarification c):** the `track_type` and `our_role` radio groups are
**independent** controls. Selecting a `track_type` MUST NOT auto-mutate the `our_role` selection (and vice versa) —
initial defaults are fine, run-time coupling is not (a 反诉 does not imply 我方应对; the lawyer sets posture
explicitly).

**Add form submit:** read the fields → client validation (all required non-empty; `claimant_party_id !==
respondent_party_id`; else set an inline `t(...)` validation message and return without calling the API) →
compute `sort_order` (D4) → `track_type`/`our_role` are enum values, party ids from the selects, summaries trimmed
(empty allowed) → `const env = await api.createClaimTrack(dto)`; `if (!env.ok) { showError(errorMessage(env.error));
return; }` (this surfaces the handler's `unknown_party` / `unknown_matter` / `tenant_mismatch` / `invalid_payload`)
→ on success set a `t(...)` status line and `await refresh()` (re-list + re-render). Wrap in try/catch → a generic
`t(...)` failure message (facts precedent). The renderer supplies NO server-authority field (id/tenant/actor/status/
timestamps) — those are injected + stripped server-side (VS-2).

## 4. Acceptance criteria (declarative — execution-discipline §4)

1. The ClaimTrack disclosure renders inside the matter detail view (composed in `viewMatter.ts` mainCol), lazily
   loading the list on first open, with NO router/nav/sidebar change.
2. The list shows two fixed groups in order 本诉 then 反诉, each sorted by `sort_order` asc; each row shows
   `序号 · 标题 · 我方主张|我方应对 · 主张方 → 相对方 · 状态徽章`; `我方立场` and `诉请方向` are distinct cells
   (D1); a 反诉 row whose `our_role` and direction are inverted relative to a 本诉 row renders each on its own cell —
   a test asserts the counterclaim row's posture and direction do NOT imply each other.
2b. A row whose stored `claimant_party_id` / `respondent_party_id` is absent from the loaded matter renders the
   `未知当事人` fallback in that cell (no blank, no raw id, no crash).
3. `listClaimTracks` failure renders `errorMessage(error)` (no crash, no partial list); the list is unpaginated.
4. The add form validates before the IPC call: a missing required field OR `claimant===respondent` blocks submit
   with an inline `t(...)` message and does NOT call `api.createClaimTrack`.
5. A successful create forwards a DTO with the selected identity fields, trimmed summaries, and an auto-appended
   `sort_order` (= existing count in the group), and NO server-authority field; on success the list refreshes.
6. A create rejection (`unknown_party` / `unknown_matter` / `tenant_mismatch` / `invalid_payload`) renders the
   mapped zh-CN `errorMessage` and leaves the list unchanged.
7. The two disabled states (D3) render the correct **distinct** copy: `< 2` total parties → the "add parties"
   message; `≥ 2` parties but `< 2` id-bearing → the "party identities not yet assigned" message. With ≥2 id-bearing
   parties and zero tracks, the design §6 empty copy + `添加诉请` shows.
8. New label facades: `claimTrackTypeLabel` (本诉/反诉) + `claimTrackOurRoleLabel` (我方主张/我方应对) are
   compile-exhaustive (a new union member fails the build); `claimTrackStatusLabel` renders 进行中/已撤回/已了结
   and returns a safe fallback for an unknown status (never throws). The facades are unit-tested in the new test file.
8b. `track_type` and `our_role` form controls are independent: a test asserts selecting a `track_type` does not
   change the current `our_role` selection.
9. **No user-facing English**: every visible string routes through `t()` / a label facade; enum option `value`s stay
   bare English identifiers; `ui-strings-allowlist.json` is regenerated so the drift guard
   (`renderer-i18n-guard.test.mjs`) passes exactly, and the "no user-facing English" classifier finds none.
10. Gates: `npm --prefix apps/lawbar-desktop test` green (incl. the new `renderer-claim-track.test.mjs`, the i18n
    guard, and `renderer-dto-sync`); `npm --prefix docs/contracts/case-box-contract test` unchanged-green;
    cc-suite `audit` no open C/H/M; `verify` closes; loc-guardian clean; one revertable local commit; no push.

## 5. Governance

Tier-1.5 (UI with legal semantics — 本诉/反诉, 我方立场, 诉请方向 carry court meaning) → full cc-suite
`review-plan` + `audit` + `verify` (broker, Path 1). Built via the `implementer` subagent from this docket + the
design artifact + the scout map; I verify scope (renderer-only), gates, and drive the broker chain. UI-GATES
`Design artifact:` satisfied by `dev-memo/design/2026-08-03-claimtrack-screen.md`. No persistence/contract/schema/
IPC change; no new dependency; no router/nav change; no push. This commit is the 3rd in the batch window → a
Layer-B batch closeout (`batch-audit-279`) is due immediately after and must precede any further commit.

## 6. Review packet (compact)

- **Active plan summary:** Add a renderer-only ClaimTrack `<details>` disclosure to the matter detail view
  (facts/links/deadlines precedent) — a read-only 本诉/反诉 grouped register + an add form (the only write,
  `status` server-set `active`, `sort_order` client auto-appended), consuming the VS-2 IPC unchanged. Keeps the
  three court concepts (litigation role / our posture / claim direction) distinct; populates party selects only
  from id-bearing matter parties and disables the form otherwise. No route/nav change.
- **Exact target files:** §1.
- **Exact acceptance criteria:** §4.
- **Out of scope:** edit / status transitions (撤回/了结) / delete / filters / manual reorder / evidence-linking
  (design §7); any `services`/`contract`/`src/caseBox`/`electron`/`api`/`preload` change; a top-level route + sidebar
  nav; `getClaimTrack` (not exposed).
- **Essential references:** `dev-memo/design/2026-08-03-claimtrack-screen.md` (the authoritative UX);
  `renderer/screens/viewMatterFacts.ts` (closest read-list + single-write precedent);
  `renderer/screens/createMatter.ts` (enum `<select>` form precedent);
  `dev-memo/plan-pta-claimtrack-completion-lane-00.md` (VS-3 row + Tier-1.5 gates).
- **Review questions:**
  1. Is the disclosure-not-route decision (§1) sound for v1, given the design artifact's nav framing — does a
     `<details>` under the matter satisfy the "trial-prep register, not generic metadata" intent, and is deferring
     the sidebar route the right cut?
  2. Does the UI keep 我方立场 (`our_role`) and 诉请方向 (`claimant→respondent`) genuinely independent in both
     render and form (D1) so a 反诉 is not mislabeled?
  3. Is the party-id-absence handling (D3 — populate selects only from id-bearing parties, else disable) correct and
     safe, or does it need to instead surface a "backfill needed" affordance? Is widening the renderer `Party` type
     with `id?: string` the right, minimal change?
  4. Is the client `sort_order` auto-append (D4) the right boundary — no server ordering leaks into VS-3, and is a
     create-time-only order acceptable to defer manual reorder?
  5. Any gap in the no-user-facing-English discipline (§9) or the test plan versus the facts precedent (grouped
     render, both preflight rejections surfaced, disabled state)?

## 8. New catalog keys (zh-CN — all in `renderer/i18n/catalog.ts`; the implementer confirms exact keys against the code)

Enum labels (facade-backed):
- `claimTrack.trackType.main_claim` = 本诉 · `claimTrack.trackType.counterclaim` = 反诉
- `claimTrack.ourRole.asserting` = 我方主张 · `claimTrack.ourRole.responding` = 我方应对
- `claimTrack.status.active` = 进行中 · `claimTrack.status.withdrawn` = 已撤回 · `claimTrack.status.resolved` = 已了结

Screen chrome / list:
- `claimTrack.disclosure.title` = 诉请跟踪 · `claimTrack.group.mainClaim` = 本诉 · `claimTrack.group.counterclaim` = 反诉
- `claimTrack.unknownParty` = 未知当事人 (row party-cell fallback, D3/clarification b)
- `claimTrack.empty.title` = 暂无诉请跟踪项 · `claimTrack.empty.hint` = 先添加本案需要跟踪的本诉或反诉请求。

Add form:
- `claimTrack.add.button` = 添加诉请 · `claimTrack.form.title` = 添加诉请
- field labels: `claimTrack.form.trackType` = 类型 · `claimTrack.form.ourRole` = 我方立场 ·
  `claimTrack.form.claimant` = 主张方 · `claimTrack.form.respondent` = 相对方 · `claimTrack.form.titleField` = 标题 ·
  `claimTrack.form.supplemental` = 补充内容（请求摘要 / 抗辩摘要 / 法律依据 / 金额计算） ·
  `claimTrack.form.claimSummary` = 请求/主张摘要 · `claimTrack.form.responseSummary` = 抗辩/回应摘要 ·
  `claimTrack.form.legalBasis` = 法律依据 · `claimTrack.form.calculationSummary` = 金额/计算摘要
- buttons: `claimTrack.form.save` = 保存 · `claimTrack.form.cancel` = 取消
- validation: `claimTrack.validation.required` = 请填写必填项。 ·
  `claimTrack.validation.samePartyBothSides` = 主张方与相对方不能是同一当事人。
- status lines: `claimTrack.status.added` = 诉请已添加。 · `claimTrack.status.addFailed` = 添加诉请失败，请重试。

Disabled states (D3 — two distinct messages):
- `claimTrack.disabled.tooFewParties` = 暂无可选当事人 — 请先在案件中添加至少两位当事人，再创建诉请跟踪项。
- `claimTrack.disabled.noPartyIds` = 此案件的当事人尚未分配标识，暂无法创建诉请跟踪项。

The list above is authoritative for intent; the implementer picks the final key spelling to match the existing
catalog's dotted-namespace convention (e.g. reuse `claimTrack.group.*` for the list-group headers if a `claimTrack.*`
namespace collision is cleaner), keeps every visible string in the catalog (never a literal in the screen), and
routes each through `t()` or a facade.

## 7. Stop condition

Superseded when review-plan is READY and implementation opens; revised if review-plan flags the disclosure-vs-route
cut, the party-id handling, or the sort_order plumbing. Completes the ClaimTrack vertical slice (VS-0 identity →
VS-1 persistence → VS-2 IPC → VS-3 UI). Follow-ups (edit + manual reorder + status transitions) are a separate,
later slice per design §7.
