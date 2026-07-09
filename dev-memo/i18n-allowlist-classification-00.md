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
