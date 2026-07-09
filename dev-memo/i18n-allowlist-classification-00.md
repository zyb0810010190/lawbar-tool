# i18n allowlist classification — WI-DESKTOP-ZH-CN-I18N-COMPLETE-01

**Question this answers**: after the Chinese-first migration, is any *user-facing* English left in the
renderer? **Answer: no.** The anti-drift allowlist (`renderer/i18n/ui-strings-allowlist.json`) holds
**100** scanned occurrences; a deterministic classifier (`classifyLiteral` in `tests/_i18n-ui-scan.mjs`)
partitions them, and the guard test `renderer-i18n-guard.test.mjs` FAILS the build if the
`user-facing` class is ever non-empty.

## Breakdown (100 occurrences)

| Class | Count | Meaning | User-visible? |
|---|---:|---|---|
| `identifier-or-enum` | 52 | Single code token, no spaces: contract enum **VALUE** kept English (`client`, `third_party`, `pleading`, `llm_extraction`, …), field identifiers (`reminder_offsets`, `filing`), export-flag data-lookup keys (`AMBIGUOUS`, `BROKEN`, …), brand/glyph (`lawbar`, `L`), route-type key (`name`). | No — the VALUE stays English (schema/contract-aligned); the displayed LABEL is Chinese via a label facade. |
| `interpolation-or-separator` | 47 | After removing `${…}` interpolations, only separators/punctuation remain: `${a} · ${b}`, `${x} → ${y}`, `${label}: `, ` *`, `§`, ` `. | No — the visible text comes from `t()` / label helpers inside the interpolations. |
| `user-facing` | **0** | Real English words/phrases (prose). | — (empty; the guard keeps it empty). |

The full distinct-text listing per class is reproducible with:

```
node --input-type=module -e 'import {scanAll,classifyLiteral} from "./tests/_i18n-ui-scan.mjs"; …'
```

## Why the contract enum VALUES stay English

The `<option value>` / stored / IPC-transmitted enum tokens MUST match the contract schemas
(`case-box-*.schema.json`) — translating them would break persistence + validation. Only the
**display label** is Chinese, produced by the `renderer/i18n/labels.ts` facades:
`matterTypeLabel`, `confidentialityLabel`, `statusLabel`, `partyRoleLabel`, `partyKindLabel`,
`linkSourceTypeLabel`, `deadlineKindLabel`, `deadlineStatusLabel`, `docketSourceTypeLabel`,
`reminderKindLabel`, `auditEntityTypeLabel`, `eventKindLabel`, plus the doc/fact label maps local
to their screens. Each is an open-string lookup with a raw-value fallback, so a future schema enum
extension renders its raw code instead of throwing.

## Guard precision — what it catches, and documented residual limits

`classifyLiteral` runs two passes: it classifies any quoted literal **inside** `${…}` interpolations
(so English hidden in a template expression like `` `${cond ? "Save changes" : label}` `` is caught —
audit High #1), then classifies the interpolation-stripped remainder. Dotted catalog keys inside
`${t("a.b.c")}` stay `identifier-or-enum` and are not flagged.

Residual limits (accepted; each is backstopped by the **scan==allowlist exactness** test, which forces
a visible, reviewable allowlist regeneration for any NEW literal — nothing is silently absorbed):

1. **Raw enum VALUE interpolated bare** (`` `${d.kind}` `` with no label facade) strips to a separator
   and is not caught by the classifier. Mitigation: every such interpolation is routed through a label
   facade (this WI wired deadline kind/status, docket proposed_kind/source_type, docket reminder kind,
   audit entity_type), and locked by per-screen rendered-DOM tests (e.g. `renderer-view-matter.test.mjs`
   asserts the deadline row renders `文件提交 · 待处理`, not `filing · pending`). A comprehensive sweep
   (`grep -oE '\$\{…\.(kind|status|type|…)\}' | grep -v 'Label('`) returns zero remaining raw-enum
   interpolations.
2. **A lone single English WORD** (no space, e.g. a hypothetical `Save`) is indistinguishable from an
   enum value and classifies `identifier-or-enum`. Mitigation: single-word UI copy in this repo goes
   through `t()`; a new lone word would still trip the scan==allowlist exactness test.
3. **UI copy returned by a helper outside the scanned idioms** (el children / `setText` / `textContent`
   / aria-label|title|placeholder) is not scanned. Mitigation: same exactness backstop; a future
   scanner-scope enhancement (audit High #2) is tracked separately, not in this UI WI.

These are guard-precision limits, not gaps in the migration itself: the migration routes all display
text through `t()` / label facades, and the `user-facing` class is currently **empty**.

## Helper-return coverage (WI-DESKTOP-I18N-SCANNER-SCOPE-02 — closes I18N-GUARD-H2)

The idiom scan sees literals only in el() children / `setText` / `textContent` / aria positions, so
user-visible copy produced by a **helper that `return`s a string/template literal** (rendered at its
call site as `[helper(x)]`) was previously invisible. A second pass — `scanReturnAll()` in
`tests/_i18n-ui-scan.mjs` — now collects `return <literal>` occurrences across the same
DOM-constructing scan set (`renderer/screens/**.ts` + `renderer/index.ts`) and feeds them to the same
classifier; the guard asserts the union `scanAll() ∪ scanReturnAll()` has **0** user-facing. Current
result: 7 return-literals, all exempt (route-name tokens `list`/`new`/`settings`/`view`/`archive`/
`not-found`, and `UTC`). A helper returning English UI copy now fails the build (bite test in
`renderer-i18n-guard.test.mjs`).

### Investigation result (no live leak)

A whole-file extract of every renderer string/template literal, classified, surfaced **no user-visible
English leak**. The English-shaped strings found are all NON-rendered:

- `renderer/format.ts` — pre-i18n English label helpers (`matterTypeLabel`→"Litigation matter",
  `confidentialityLabel`→"Normal", `deadlineUrgencyLabel`→"Overdue", `ledgerCategoryLabel`→"Litigation",
  …). **Dead**: no screen imports them (screens resolve labels via `renderer/i18n/labels.ts`; from
  `format.ts` they import only `formatLocalDateTime` / `hashTruncate` / `ulidShort` / `deadlineUrgency`).
  Retained under `renderer-format-ledger.test.mjs`. `format.ts` is a pure utility module, outside the
  DOM-constructing scan set by the same rule the idiom scan uses.
- `renderer/screens/auditEventLabels.ts` — `EVENT_KIND_LABELS` English map. Used **only for its keys**
  (a `hasOwnProperty` membership check in `viewMatterAudit.ts`); the values are never read for display
  (the screen renders `eventKindLabel(kind)` from the zh-CN catalog). Not a literal return, so not a
  helper-return leak.
- Class lists / `data-test-id` / selectors / import paths / an `Error()` message — non-UI code strings.

These two English reservoirs were non-rendered; `WI-DESKTOP-I18N-DEAD-LABELS-03` (below) **removed them**.

## Dead English reservoirs — removed (WI-DESKTOP-I18N-DEAD-LABELS-03)

The two non-rendered English reservoirs identified above are gone:

- `renderer/format.ts` — deleted the dead pre-i18n label helpers `matterTypeLabel` / `confidentialityLabel`
  / `statusLabel` / `deadlineUrgencyLabel` / `ledgerCategoryLabel` (no screen imported them; the live
  zh-CN labels are the `renderer/i18n/labels.ts` facades). Kept the pure `ledgerCategory` token classifier
  (no English) + the used formatters (`formatLocalDateTime` / `hashTruncate` / `ulidShort` /
  `classifyDeadlineUrgency`). Their orphaned unit tests were removed; the `ledgerCategory` mapping tests
  stay.
- `renderer/screens/auditEventLabels.ts` — **deleted**. Its English `EVENT_KIND_LABELS` map was used only
  as a key-membership set; replaced by `isKnownAuditEventKind(kind)` in `renderer/i18n/labels.ts` (backed
  by the already-exhaustive `EVENT_KIND_ID` record). `viewMatterAudit.ts` uses the predicate (which also
  narrows the type, removing an `as` cast). Behavior is identical — known kind → zh-CN `eventKindLabel`,
  null/unknown → raw `action`; cc-suite audit `audit-mrcw9tqg-670o1k` = PASS.

Net effect: the renderer no longer contains any English-label reservoir (rendered or dead). Contract enum
VALUES remain English (schema-aligned); only display labels are Chinese via the catalog/facades.

## Runtime error surfaces (WI-DESKTOP-ZH-CN-ERROR-SURFACES-04)

The static allowlist / classifier see only *literals*; the English text a user saw on an IPC failure was a
**runtime** value — `env.error.message`, produced main-side by `errorMap.ts` — invisible to the guard (which
is why `user-facing = 0` held even though a failure banner rendered English). This is now localized at the
DISPLAY layer: `renderer/i18n/errorMessage.ts` maps the stable `error.code` → a generic zh-CN `error.<code>`
catalog message (fallback `error.unknown`); all ~30 renderer error banners/alerts/status lines call
`errorMessage(env.error)` instead of `env.error.message`. The main process is unchanged — codes and the
English `message` stay for `console.error` diagnostics; the renderer never surfaces the raw `message` (no
SQL/path/identifier leak; proven by `renderer-error-message.test.mjs`). Contract enum VALUES and IPC channel
names are untouched.
