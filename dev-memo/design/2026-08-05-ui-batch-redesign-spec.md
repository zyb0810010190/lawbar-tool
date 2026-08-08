# Design — Batch UI redesign spec (all interactive controls)

**Date:** 2026-08-05 (drafted); 2026-08-06 (APPROVED + scope corrected). **Status:** APPROVED by Frank on
2026-08-06 ("同意ui方案，请进行下一步"). This is the authorizing **Design artifact** for the WI-UI-* batches
(`Type: UI` per AGENTS.md UI-GATES). See §0 "Verified scope correction" — the implementation scope is narrower
than the original draft's premise; the visual *direction* is unchanged. **Scope:** every
interactive control across the 13 renderer screens. **Purpose:** decide all button layout / add-remove / naming
changes ONCE, as rules, so a small number of cohesive implementation batches can apply them — instead of
one-WI-per-button. **Basis:** the as-is control inventory (read from the real code, 2026-08-05) + 19 cross-screen
inconsistencies A–S. **Companion:** a clickable mockup of the to-be (redline that, not this table).

This spec DECIDES a first-pass direction (macOS HIG + court-facing clarity + consistency). Every row is a proposal;
Frank overrides freely on the mockup.

---

## 0. Verified scope correction (2026-08-06, read from real code before implementing)

Before implementing, the actual renderer was re-read (not the draft's inventory). Findings that **narrow** the
scope (the visual direction below is unchanged; there is simply less to change than the A–S table implied):

- **The `.button` CSS family is already complete** in `renderer/index.css`: `.button`, `--primary`, `--accent`,
  `--danger`, `--danger-strong`, `--ghost`, `--secondary`, `--sm`. No CSS authoring needed.
- **The core-flow screens already adopt it correctly** — `createMatter` (`button--primary` submit, `button`
  cancel, `button--secondary` party add/remove), `editMatter` (same), `archiveMatter` (`button--danger`),
  `listMatters` (`button--accent` new, `button list-load-more` pagination), `viewMatter` (`button--primary`
  edit, `button--danger` archive). The draft's premise "core screens abandon the button system" was **wrong**.
- **The real gap = the 7 matter sub-section screens.** Their buttons use bespoke `view-*` classes
  (`view-docs-add-btn`, `view-facts-add-btn`, `view-claim-tracks-add-btn`, `view-deadlines-*`,
  `view-docket-*`, `view-links-*`, `view-t3-export-button`) that have **zero dedicated CSS** → they render as
  near-default browser buttons. This is the genuine F/E gap and the entire real WI-UI-1.
- **WI-UI-2..4 will be re-verified against real code the same way** before implementing — several draft claims
  (form-action order, missing 取消) are likely already satisfied on some screens. No batch is implemented on the
  draft's word alone.

**WI-UI-1 method (surgical):** for each bespoke sub-section button, **prepend** `button button--<weight> ` to
its class (keep the bespoke class as a suffix, keep every `data-test-id`, labels/handlers untouched). Weights:
danger = unlink/dismiss and their confirms (`view-links-unlink(-confirm)`, `view-docket-dismiss(-btn|-confirm)`);
primary = add/create/reveal + confirm-a-benign-step (`*-add-btn`, `view-links-create-btn`,
`view-deadlines-confirm-btn`, `view-deadlines-transition-confirm`); secondary = export / inline-edit / relink /
any cancel / status toggles (`view-*-export*`, `view-docket-edit-btn`, `view-links-relink`,
`view-deadlines-transition-btn`, all `*-cancel`).

### Open questions resolved (2026-08-06)

- **(R) Settings utility row → DEFERRED to a separate WI.** The 打开数据目录 / 复制诊断信息 utilities require new
  IPC and are not pure presentation; WI-UI-4 only rebalances Settings with static info. Interactive utilities
  are a later opt-in WI. Supersedes §3's "add a utility row (optional)" — presentation-only in these batches.
- **(I, action order) → INLINE surfaces use `[primary, cancel]`; a future MODAL surface would use macOS
  HIG `[cancel, primary]`.** Decided 2026-08-08 for WI-UI-2, at Frank's direction to route the call to Codex
  (`review-plan-mskgim15-vhefre`, thread `019fe1bb-754a-7113-aaa8-eaa9a0e85806`).
  *Why this was a real fork:* the app is macOS-only with a native-feel goal, and Apple's HIG puts the default
  button RIGHTMOST — the opposite of this spec's approved `[primary, cancel]`. Verified reality first: 4 of 5
  action rows are already primary-first (`viewMatterDeadlines.ts:593`, `viewMatterDocketProposals.ts:525`,
  `archiveMatter`, `editMatter`); only `viewMatterClaimTracks.ts:448` was `[cancel, save]`.
  *Mechanism for the decision (not "best practice says"):* HIG's ordering is written for modal/alert surfaces
  that STOP the user to force a choice between escape and default. These are inline task controls embedded in
  a list/document workflow, read left-to-right — so primary-first keeps the row's main verb first in scan
  order and keeps every inline row mechanically uniform. Destructive rows deliberately do NOT deviate: if
  destructive rows reversed order while benign ones did not, placement would become a hidden safety signal
  users must learn, which is weak and easily mislearned. The real guard on these flows is the mandatory typed
  reason — already hardened against whitespace-only input in `e9ff43c`.
  *Scope limit:* this convention binds INLINE surfaces only. No true modal/sheet exists in the app today; if
  one is ever introduced it follows macOS HIG (primary right), because the split follows interaction surface,
  not danger level. So WI-UI-2 changes exactly one existing row (ClaimTracks) and places both new cancels
  after their confirm.
- **(O, 2-step escape) → CONFIRMED by code, exactly two missing.** `view-facts-reject-confirm` and
  `view-links-unlink-confirm` are the only confirm actions in the renderer with no cancel sibling; every other
  confirm already pairs with one. Both are destructive and both require a typed reason, so a user who reveals
  the reason input currently has no way to back out. WI-UI-2 adds `view-facts-reject-cancel` and
  `view-links-unlink-cancel`.
- **(D, deadlines) → KEEP 提议 semantics; do NOT rename to 添加期限.** The docket lifecycle is
  proposed → confirmed → materialized (`docs/adr/case-box-step-6-deadline-docketing-rules.md`); "添加" would
  misrepresent the two-step. The committed ADR outranks the "添加X uniformly" proposal (source hierarchy). The
  D rule still applies to non-lifecycle add actions (documents / facts / claim-tracks / evidence).

---

## 1. Naming rules + legal-term glossary

**Verbs (one intent → one verb):**
| Intent | Rule | Fixes |
|---|---|---|
| Start creating the ONE top-level entity (a matter) | **新建案件** (the entry CTA) → its commit button **创建案件** | B |
| Add a child record to a matter | **添加X** — 添加当事人 / 添加文档 / 添加事实 / 添加诉请 / 添加期限 (was 新增/添加/提议 mixed) | D |
| Commit any inline form (add-form or edit-form) | **保存** (editMatter "保存更改"→保存; docket "保存修改"→保存; claimTrack 保存 ✓) | C |
| Abandon a form / collapse a reveal | **取消** (one shared key) | H |
| Confirm a two-step destructive action | **确认+对象**: 确认归档 / 确认驳回 / 确认断开 / 确认完成 (the bare "确认" on missed→met becomes 确认完成) | G |
| Return to the matter list | **← 返回案件列表** (one key; add the missing arrow on notFound) | A |
| Return to one matter | **← 返回案件** (one key) | A |

**In-flight status:** specific, never generic — "正在创建链接…" / "正在断开…" / "正在恢复…" (retire the shared opaque
"处理中…"). Matches the app's existing specific style ("正在归档…", "正在保存…"). Fixes N.

**Required marker:** every required field/legend ends with " *", uniformly (createMatter has it, claimTrack lacks
it). Fixes Q.

**Glossary (one term per concept, app-wide):** 案件 (matter), 当事人 (party), 期限 (deadline), 事实 (fact),
诉请 (claim track), 文档 (document), 证据链接 (evidence link), 归档 (archive), 驳回 (dismiss/reject),
断开 (unlink), 审计日志 (audit log). Ban vague labels ("确定"/"处理"); every action names its object.

---

## 2. Visual-weight rules (the shared `.button` family, applied everywhere)

| Weight | Class | Use |
|---|---|---|
| **Primary** | `button button--primary` | the ONE main action of a screen/form: 创建案件, 保存, 编辑…, 添加X (the reveal), the primary confirm of a benign 2-step |
| **Danger** | `button button--danger` | EVERY destructive / irreversible-audited action AND its confirm: 归档…, 确认归档, 断开→确认断开, 驳回→确认驳回, 撤回 |
| **Neutral/secondary** | `button button--secondary` | 取消, 添加当事人 (form-row add), 加载更多, 导出… |
| **Back** | `back-link` | the two back links only |

**Hard rule — no bespoke button classes.** Every `view-*-btn` in the matter sub-sections (documents, deadlines,
docket, facts, links, claim-tracks, T3) MUST adopt `button` + the weight modifier above. This is the single biggest
consistency fix (F): today those seven sub-sections have no shared visual weight. `data-test-id`s stay unchanged so
the smoke tests keep their hooks (S).

**Danger weight reaches in-section destructive actions (E):** 断开 (unlink), 驳回 (dismiss/reject), 撤回 (withdraw)
render as `button--danger`, same as archive — a court-facing tool must not show "break this citation, recorded in
the audit log" with neutral weight.

---

## 3. Layout + grouping rules

- **Form action order — primary first, then cancel**, everywhere: `[Save/Submit, Cancel]`. Fixes I (claimTrack is
  currently `[Cancel, Save]`; docket edit `[Save, Cancel]`).
- **Matter-level actions** (viewMatter): keep **编辑…** as a header primary; keep **归档…** in a distinct
  「危险操作」 section (destructive actions stay visually separated from benign ones — intentional, not drift).
  Resolves L by making the separation a rule, not an accident.
- **Two-step "reveal reason → confirm" is ONE standard component** (O): reveal a reason input + `[确认X (danger),
  取消 (neutral)]`. Add the missing 取消 to fact-reject and link-unlink (today they have no escape). Same layout,
  labels, and danger weight in all four sites (deadline missed→met, docket dismiss, fact reject, link unlink).
- **Pagination** "加载更多" is always `button button--secondary` (J: three of four sites lack the class today).
- **Settings** gains a light action affordance so it doesn't read as broken next to the action-dense chrome (R) —
  e.g. a 「打开数据目录」 / 「复制诊断信息」 utility row (proposal; Frank decides if wanted).
- **"编辑…" (navigate) vs "编辑" (inline)** (K): keep the ellipsis "编辑…" ONLY for navigation-to-a-screen; the
  docket in-row inline edit uses a distinct label 「修改此项」 to signal in-place editing, not navigation.

---

## 4. Cross-screen consistency check (A–S → resolution)

| # | Inconsistency | Resolution |
|---|---|---|
| A | "返回列表" under 4 keys; notFound drops the arrow | one key `nav.backToList` = "← 返回案件列表"; one `nav.backToMatter` = "← 返回案件" |
| B | new-matter named 3 ways, weighted 2 ways | 新建案件 (start) → 创建案件 (commit); all primary weight (drop accent) |
| C | save labelled 4 ways | 保存 for every inline commit; 创建案件 only for the matter create |
| D | add-child verb 新增/添加/提议 mixed | 添加X uniformly |
| E | danger weight only top-level | danger weight on all destructive actions incl. sub-sections |
| F | sub-sections abandon the button system | all controls adopt `.button` family |
| G | confirm labels inconsistent; bare "确认" | 确认+对象 everywhere; 确认完成 replaces bare 确认 |
| H | 取消 under 6 keys, mixed weight | one `nav.cancel` key, `button--secondary` |
| I | save/cancel order differs | `[primary, cancel]` everywhere |
| J | 加载更多 styled 2 ways | always `button--secondary` |
| K | "编辑…" nav vs "编辑" inline | 编辑… = navigate; 修改此项 = inline |
| L | matter actions split across regions | rule: header=编辑 primary, 危险操作 section=归档 danger |
| M | duplicate placeholder keys | one `form.selectPlaceholder` = "— 请选择 —" |
| N | generic "处理中…" | specific per-action status strings |
| O | 2-step reason reveal reimplemented | one standard component (reason + 确认X danger + 取消) |
| P | export named by content vs format | 导出引用 / 导出证据目录（DOCX） — name the content, note the format in parens |
| Q | required marker inconsistent | " *" on all required legends/labels |
| R | Settings has no affordances | add a utility row (optional) |
| S | data-test-id conventions differ | preserve ALL existing ids (test hooks); redesign is class/label/layout only |

---

## 5. Batched implementation plan (fewest cohesive batches)

Ordered so each batch is one cohesive, independently-shippable WI. Batches 1–2 are pure presentation (low-risk —
lighter loop); 3–4 touch copy + structure; none touch persistence/IPC/data.

- **Batch UI-1 — the shared button system (F, E, J).** Give every `view-*-btn` and pagination control the
  `.button` family + correct weight; apply danger weight to all destructive actions. CSS + class strings only; no
  label/behavior change. Biggest visual payoff, lowest risk. (~7 sub-section files + index.css.)
- **Batch UI-2 — form action order + the 2-step component (I, O).** Normalize `[primary, cancel]`; unify the
  reveal-reason→confirm affordance (add the two missing 取消). (claimMatter/claimTrack/docket + facts/links/deadline
  reason flows.)
- **Batch UI-3 — naming + catalog consolidation (A,B,C,D,G,H,K,M,N,P,Q).** Apply the verb rules; collapse the
  duplicated keys (back-links, cancel, placeholder) into shared keys; specific status strings; required markers.
  Copy-only + catalog; regen the i18n allowlist ONCE at the end. (catalog.ts + every screen's label refs.)
- **Batch UI-4 — matter action cluster + Settings affordance (L, R).** Finalize viewMatter header vs 危险操作
  placement; add the Settings utility row if Frank wants it.

Governance: Batches 1–2 are pure presentation → desktop gate (i18n guard + color guard + dto-sync + screen tests)
is sufficient; self-review acceptable per cc-suite low-risk. Batches 3–4 (copy/structure) → desktop gate + one
cc-suite audit each. None touch the audit chain, server authority, or data. Every batch preserves all
`data-test-id`s. Regenerate the line-indexed i18n allowlist as the LAST step of any batch that shifts screen lines,
then re-run the full desktop gate (the standing lesson).

---

## Redline instructions
Open the companion mockup and mark up: (1) any label you'd word differently, (2) any button that should move /
appear / disappear, (3) any weight (primary/danger/neutral) you disagree with, (4) whether Settings gets the
utility row, (5) whether deadline "propose→confirm" keeps 提议 or becomes 添加期限. Your redlines replace the
proposals here; then I implement in the 4 batches above.
