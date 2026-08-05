# PLAN — WI-UI-RESTYLE-1: macOS-HIG radius revalue (palette unchanged)

**Type:** UI (pure presentation; no legal semantics). **Status:** DRAFT.
**Branch:** `feature/pta-claimtrack-vertical-slice` (local; no push).
**Design artifact:** `dev-memo/design/2026-08-04-app-restyle-macos-hig.md` (approved direction; mockup Artifact
`45b3110a-…`). This docket implements artifact §2.1 (radius) only. **Scope-narrowed after the WI-1 audit**
(`audit-msfihuyp`): the shadow tokens are unconsumed and the serif change needs consumer-retargeting, so both moved
to WI-2 (artifact §5). Ornament cleanup + audit-panel removal were already WI-2.

## 1. Scope
Revalue the **radius** scale tokens to the macOS-HIG values (the only token change that is actually consumed and
therefore visible on its own — 35 `var(--radius-*)` sites). **Keep every palette hue token unchanged.** Token edits
only; no component rule, no screen/logic change, no visible-string change.

### Target files
- `apps/lawbar-desktop/renderer/index.css` — `html` scale block: `--radius-sm 2→6`, `--radius-md 3→8`,
  `--radius-lg 5→12` (`--radius-pill` unchanged). Nothing else.
- `apps/lawbar-desktop/src/theme/tokens.ts` — mirror the three radius values in `SCALE_TOKENS`, **byte-equal** with
  index.css.

**NOT touched (all WI-2 or out of scope):** any palette hue token; `--shadow-*` (unconsumed — revalue + wire in
WI-2); `--font-serif`/`--font-ui` (serif drop needs consumer-retarget + dead-font removal — WI-2); any
`renderer/screens/**.ts`; the `§`/eyebrow/drop-cap ornaments (WI-2); `viewMatterAudit` composition (WI-2); anything
under the Evidence A0.7 gate; no new dependency.

## 2. Acceptance criteria
1. `--radius-sm/md/lg` hold 6/8/12px in BOTH index.css (`html` block) and tokens.ts (`SCALE_TOKENS`), byte-equal;
   `--radius-pill` unchanged. No other token changed. **All palette hue tokens byte-identical** (`git diff` shows
   no `--color-*`/`--conf-*`/`--status-*`/`--traffic-*` change), and no `--shadow-*`/`--font-*` change.
2. `renderer-no-hardcoded-color.test.mjs` passes (exactly 2 `:root` blocks; unaffected by radius).
3. `main.test.mjs` palette-sync passes (index.css ↔ tokens.ts byte-equal).
4. `smoke.electron.test.mjs:161` (S1 font wiring, Noto-first) passes; `renderer-i18n-guard` passes.
5. `npm --prefix apps/lawbar-desktop test` green **except** the pre-existing environmental
   `smoke.electron.test.mjs:21` launch timeout (documented in AGENTS.md; proven to fail identically on the clean
   baseline — accepted, out of scope). `npm --prefix docs/contracts/case-box-contract test` unchanged-green.
   loc-guardian clean; one revertable local commit; no push.

## 3. Governance
Type UI, low-risk (presentation only; two hard gates guard it). Not a high-risk cc-suite category → post-impl
`/cc-suite:audit` on the diff (proportionate); self-review fallback permitted per `.claude/rules/cc-suite.md`
"Low-risk WIs" if the broker is unavailable, recorded. Design artifact satisfies UI-GATES. No palette/logic/
schema/dependency change; no push.

## 4. Stop condition
Superseded when implemented + gates green. WI-2 (ornament cleanup + audit-panel UI removal + weight pass) follows,
pending Frank's confirmation that "不需要审计链" means hide-the-UI-panel (mechanism preserved).
