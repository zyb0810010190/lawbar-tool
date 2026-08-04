# Design Artifact — ClaimTrack screen (WI-PTA-VS3)

**Status:** design artifact for the VS-3 UI WI (satisfies the UI-GATES `Design artifact:` requirement of
`dev-memo/plan-pta-claimtrack-completion-lane-00.md` §1 VS-3). **Date:** 2026-08-03.
**Authored by:** _jacob, from a cc-suite Codex design consult (thread `019fcd47`), on Frank's explicit
delegation of the VS-3 design decision (overriding the lane's default "human checkpoint" for this WI).

## 0. Intent (one line)

A **dense trial-prep register**, not a workflow board. The screen must answer instantly:
*"Which claim thread is this, between whom, and what is our posture?"* Correctness and trust beat polish —
this is a v1 internal tool for one litigation lawyer, offline, zh-CN.

## 1. Three concepts that MUST stay distinct (load-bearing — collapsing them causes counterclaim errors)

- **诉讼地位 (litigation role):** 原告 / 被告 — a party's standing in the case (from the matter's party data).
- **我方立场 (our posture):** 我方主张 / 我方应对 — `our_role` = asserting / responding.
- **诉请方向 (thread direction):** 主张方 → 相对方 — `claimant_party_id → respondent_party_id`.

All three are shown where available; none is derived from another. (In a 反诉, our posture and the thread
direction invert relative to the 本诉 — so a UI that fuses them would mislabel the counterclaim.)

## 2. Navigation / entry point

Lives under the matter's **trial-prep** area, near evidence / issues / hearing-prep — NOT as generic case
metadata. Nav label: **庭审准备 › 诉请跟踪**.

## 3. List (read-only)

Two FIXED groups, in this order, each ordered by `sort_order` ascending:
1. **本诉** (`track_type = main_claim`)
2. **反诉** (`track_type = counterclaim`)

Each row shows (NO title-only rows — a bare title is ambiguous before a hearing):

`序号 · 标题 · 我方主张|我方应对 · 主张方 → 相对方 · 状态徽章`

```
诉请跟踪
── 本诉 ─────────────────────────────
 1  返还借款本金        我方主张   张三 → 李四      进行中
 2  违约金              我方主张   张三 → 李四      进行中
── 反诉 ─────────────────────────────
 1  抵销已付款项        我方应对   李四 → 张三      进行中
                                         [ + 添加诉请 ]
```

- Status badge maps `active → 进行中` (v1 only ever shows 进行中; `withdrawn → 已撤回`, `resolved → 已了结`
  reserved for a later slice). Party cells show the party's display name; role suffix `（原告）/（被告）`
  when the matter provides it.
- List is unpaginated (persistence returns the full matter-scoped array; claim counts are bounded).

## 4. Add form (the only write in VS-3; created as `status = active`)

**Required — the claim-identity fields** (validated before the create IPC call):
- `track_type` — radio: 本诉 / 反诉
- `our_role` — radio: 我方主张 / 我方应对
- `claimant_party_id` — dropdown of matter parties (see §5)
- `respondent_party_id` — dropdown of matter parties (see §5)
- `title` — short text, non-empty

**Optional — a collapsed `▸ 补充内容` section** (empty string allowed; shown, not required — money/legal
basis matter in court, but forcing them causes rushed filler or abandoned entries):
- `claim_summary` — 请求/主张摘要
- `response_summary` — 抗辩/回应摘要
- `legal_basis` — 法律依据
- `calculation_summary` — 金额/计算摘要

**Auto / server-side (never in the form):** `id`, `tenant_id`, `actor_user_id`, `status = "active"`,
`created_at`, `updated_at`, and `sort_order`.

```
添加诉请
 类型     (•) 本诉   ( ) 反诉                *必填
 我方立场 (•) 我方主张 ( ) 我方应对          *必填
 主张方   [ 张三（原告） ▾ ]                *必填
 相对方   [ 李四（被告） ▾ ]                *必填
 标题     [___________________________]     *必填
 ▸ 补充内容（请求摘要 / 抗辩摘要 / 法律依据 / 金额计算）  选填
                                   [ 取消 ]  [ 保存 ]
```

### `sort_order` — the one deliberate divergence from the consult
The consult recommended a lawyer-visible, editable `sort_order` at creation (lawyers prepare in
claim-importance order). VS-3 instead **auto-appends** (`sort_order` = next number within the selected
group) and displays the `序号`, deferring *manual reordering* to the edit slice. Reason: v1 has no edit, so
a create-time-only order control is half a feature (it can't re-sort existing rows) while adding form
friction; a lawyer naturally enters claims in importance order during prep, which append already preserves.
**Manual reorder is the first VS-3 follow-up, paired with the edit slice.**

## 5. Party selection rules

- Dropdowns populated ONLY from the matter's existing parties (source-of-truth; the lawyer never types an
  id or an ad-hoc name). Option label: `名称（诉讼地位）`, e.g. `张三（原告）`.
- **Block** selecting the same party as both 主张方 and 相对方 (no exception-note field exists in v1).
- If the matter has **fewer than two parties**, DISABLE "添加诉请" and show:
  `暂无可选当事人 — 请先在案件中添加至少两位当事人，再创建诉请跟踪项。`

## 6. Empty / first-run states (functional copy — NEVER sample/fake legal cards; fake content erodes trust)

- Zero tracks (≥2 parties exist): `暂无诉请跟踪项` / `先添加本案需要跟踪的本诉或反诉请求。` + primary
  button `添加诉请`.
- Zero selectable parties: the §5 no-parties message (add disabled).

## 7. Deliberately NOT in VS-3 (Codex challenge — build the trustworthy register first)

Edit / status transitions (撤回 / 了结) / delete / filters / kanban or timeline views / claim resolution /
tags / attachments / evidence-linking / manual reorder. These are meaningful only after the core register is
trustworthy. The single thing to get right is **row identity** — `type + our posture + 主张方→相对方 +
title + order`; if that's ambiguous the lawyer can't rely on the screen in prep.

## 8. i18n

All strings via the zh-CN catalog (no literals). New enum-label facades needed: `track_type`
(本诉/反诉), `our_role` (我方主张/我方应对), `status` (进行中/已撤回/已了结). Party role suffix reuses the
existing matter party-role labels if present.

## References
`dev-memo/plan-pta-claimtrack-completion-lane-00.md` (VS-3 row + gates); the ClaimTrack contract
(`case-box-claim-track.schema.json`); Codex design consult thread `019fcd47`.
