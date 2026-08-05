# PLAN — WI-UI-RESTYLE-2a: soft elevation (revalue shadow tokens + wire card rules)

**Type:** UI (pure presentation). **Status:** DRAFT. **Branch:** `feature/pta-claimtrack-vertical-slice` (local;
no push). **Design artifact:** `dev-memo/design/2026-08-04-app-restyle-macos-hig.md` §2.2 (elevation) + §3 (gates).
Follows WI-UI-RESTYLE-1 (`f1f115f`, radius). Palette hues unchanged.

## 1. Scope
Replace the flat hairline-ring "cards" with genuine soft **elevation**: revalue the `--shadow-*` tokens to
warm-tinted soft shadows (currently they are `0 0 0 1px …` / `none` AND have zero consumers), and **wire the
primary card/panel container rules to consume `var(--shadow-sm)`** so the depth actually appears. Keep the existing
card borders (hairline edge) — elevation sits on top of the border for the macOS-panel look.

### Target files (renderer CSS + token mirror only)
- `apps/lawbar-desktop/renderer/index.css`
  - light `:root`: `--shadow-sm: 0 1px 2px #1F1A170D, 0 8px 22px #1F1A1714;` + `--shadow-xs: 0 1px 2px #1F1A1710;`
  - dark `:root[data-theme="dark"]`: `--shadow-sm: 0 1px 2px #00000059, 0 12px 30px #00000073;` +
    `--shadow-xs: 0 1px 2px #0000004D;`
  - remove the `html`-block `--shadow-xs: none;` (moved into the two `:root` blocks so alpha is theme-specific AND
    stays inside the gate-exempt `:root` scope). **8-digit hex only — never `rgba()`.** `#1F1A17` = the existing
    warm near-black, so shadows read warm.
  - wire elevation: add `box-shadow: var(--shadow-sm);` to the primary card/panel container rules (e.g.
    `.view-card`, `.stat-card`, `.workspace-card`, `.binding-card`, `.parties-section`, `.archive-summary`, and the
    matter-detail disclosure cards) — the containers a user reads as "cards". Keep their existing `border`. Do NOT
    add elevation to every element (tasteful, cards/panels only). Confirm the exact rule set by grepping the real
    stylesheet; wire what is genuinely a card/panel.
- `apps/lawbar-desktop/src/theme/tokens.ts` — mirror `--shadow-sm` (both theme records) + `--shadow-xs` (move into
  `LIGHT/DARK_THEME_TOKENS`, remove from `SCALE_TOKENS`), **byte-equal** with index.css (palette-sync).

**NOT touched:** any palette hue token; radius (WI-1, done); `--font-*` / serif (WI-2b); the `§`/eyebrow/drop-cap
ornaments (WI-2c); `viewMatterAudit` composition (WI-2d); any screen `.ts` beyond none; font files; Evidence.

## 2. Acceptance criteria
1. `--shadow-sm`/`--shadow-xs` hold the design-artifact §2.2 values as **8-digit hex** in the two `:root` blocks
   (no `rgba()`); `--shadow-xs` no longer on the `html` block. Byte-equal in tokens.ts (theme records).
2. The card/panel rules consume `var(--shadow-sm)` (grep shows `>0` `var(--shadow-` consumers now); borders kept.
3. No palette hue token changed; no radius/font change (`git diff` shows only shadow tokens + card box-shadow lines).
4. `renderer-no-hardcoded-color` ✔ (exactly 2 `:root` blocks; no rgba; hex only in `:root`); `main.test.mjs`
   palette-sync ✔; `smoke.electron.test.mjs:161` S1 ✔.
5. `npm --prefix apps/lawbar-desktop test` green except the pre-existing environmental `smoke.electron.test.mjs:21`
   launch timeout (accepted, out of scope). Contract tests unchanged-green. loc-guardian clean; one local commit;
   no push.

## 3. Governance
Type UI, low-risk (presentation; two hard gates guard it). Post-impl `/cc-suite:audit` on the diff. Design artifact
satisfies UI-GATES. No palette/logic/schema/dependency change; no push.

## 4. Stop condition
Superseded when implemented + gates green. Remaining restyle: WI-2b (serif drop + dead-font removal — needs care
around the S1 fetchable-face assertion), WI-2c (ornament removal: `§`/eyebrows/drop-caps), WI-2d (audit-chain UI
panel removal — `viewMatter.ts` composition + test; mechanism preserved per Frank 2026-08-04).
