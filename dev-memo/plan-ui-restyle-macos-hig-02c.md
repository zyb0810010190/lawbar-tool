# PLAN — WI-UI-RESTYLE-2c: remove the § print-markers (narrow ornament cut)

**Type:** UI (pure presentation). **Status:** DRAFT. **Branch:** `feature/pta-claimtrack-vertical-slice` (local;
no push). **Design artifact:** `dev-memo/design/2026-08-04-app-restyle-macos-hig.md` §2.4/§5 (drop the editorial
`§` markers). Palette + layout otherwise unchanged.

## 1. Scope
Remove the two **rendered** `§` section-sign markers (the most "print-broadsheet" glyph in the UI) + the CSS that
styled them. This is the NARROW ornament cut — it does NOT touch the diffuse uppercase-"eyebrow" rules or the serif
display (those are separate: WI-2b serif; eyebrow sweep deferred as too diffuse/low-value).

### Target files
- `apps/lawbar-desktop/renderer/screens/viewMatter.ts` (~L434) — colophon header: remove the
  `el("span", { class: "colophon-marker" }, ["§"], doc)` so the header is just `[t("detail.colophonTitle")]`.
- `apps/lawbar-desktop/renderer/screens/listMatters.ts` (~L256) — remove the `const glyph = el("div",
  { class: "empty-glyph", "aria-hidden": "true" }, ["§"], doc);` AND its two usages (the `glyph,` member in the
  active-empty `list-empty-desktop` children ~L278 and the `[glyph, …]` in the archived-empty children ~L291).
  The empty states keep their `data-test-id="list-empty"` section + title/body/button — only the decorative
  aria-hidden `§` glyph is dropped.
- `apps/lawbar-desktop/renderer/index.css` — remove the now-orphan rules `.colophon-header .colophon-marker`
  (~L1122) and `.list-empty-desktop .empty-glyph` (~L2166 block). Leave the already-orphan `.section-marker`
  rules (403-420, 2289) for the separate dead-CSS cleanup (deferred WI2D-CLEANUP-1) — they're not rendered and out
  of this narrow cut.
- `apps/lawbar-desktop/renderer/i18n/ui-strings-allowlist.json` — **REGENERATE** after the edits (the two `§`
  entries at `listMatters.ts` + `viewMatter.ts` drop out, and line numbers shift). Regen command (from
  `apps/lawbar-desktop`): `node --input-type=module -e 'import {writeFileSync} from "node:fs"; import {scanAll} from "./tests/_i18n-ui-scan.mjs"; const s=scanAll().map(c=>({file:c.file,line:c.line,text:c.text,kind:c.kind})); writeFileSync("./renderer/i18n/ui-strings-allowlist.json", JSON.stringify(s,null,2)+"\n"); console.log("entries:",s.length);'`

**NOT touched:** serif / `--font-*` (WI-2b); the uppercase-eyebrow rules (deferred, diffuse); the orphan
`.section-marker` CSS (deferred dead-CSS cleanup); palette hue tokens; any `services/**`/contract/electron/IPC; no
new dependency.

## 2. Acceptance criteria
1. No `§` rendered by any screen (`grep -rn '"§"' apps/lawbar-desktop/renderer/screens` → empty); colophon header
   + both empty states still render (their `data-test-id`s intact).
2. Orphan `.colophon-marker` + `.empty-glyph` CSS removed; no other CSS rule changed.
3. Allowlist regenerated; the two `§` entries gone; **`renderer-i18n-guard` 9/9** (drift + stale-entries pass).
   *(LESSON: a comment/line shift changes allowlist line numbers — regenerate + re-run the FULL gate before
   commit, do not assume any edit is gate-neutral.)*
4. `npm --prefix apps/lawbar-desktop test` green except the pre-existing environmental
   `smoke.electron.test.mjs:21` launch timeout. `npm --prefix docs/contracts/case-box-contract test` unchanged.
   loc-guardian clean; one local commit; no push.
5. No palette/serif/eyebrow/mechanism change (`git diff` = the 2 screens + index.css + allowlist only).

## 3. Governance
Type UI, low-risk (presentation only; two hard gates guard it). Post-impl `/cc-suite:audit` on the diff. Design
artifact §2.4 satisfies UI-GATES. No push.

## 4. Stop condition
Superseded when implemented + gates green. Remaining restyle: WI-2b (serif drop — S1-test care). Then the #2
edit-case governed vertical; #3 evidence gated on A0.7.
