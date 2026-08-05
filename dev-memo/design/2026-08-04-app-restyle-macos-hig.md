# Design Artifact — app restyle to macOS-HIG structure (warm palette kept)

**Status:** design artifact for the UI restyle WI(s). Satisfies the UI-GATES `Design artifact:` requirement.
**Date:** 2026-08-04. **Authored by:** _jacob, from a Codex design consult (thread `019fcfbf`) + Frank's review.
**Interactive mockup (approved, palette-kept revision):** Artifact `45b3110a-fad0-48a5-a0fe-6bf9ec7ee3a1`
(local, private — matter view + ClaimTrack register, light + dark).

## 0. Intent

Remove the "rigid / print-broadsheet" feel by adopting **macOS system-app structure** (Finder / Mail / Notes:
source-list selection, soft elevation, larger radii, SF-style type hierarchy, roomier-but-still-dense spacing) —
**while keeping the existing warm colour identity verbatim.** Frank's directive (2026-08-04): the direction is
approved, *keep the original colour scheme*. So this is a **structure/scale/type** change, NOT a palette change.

## 1. What is KEPT (unchanged — do not touch)

Every colour/palette token in the two `:root` blocks of `apps/lawbar-desktop/renderer/index.css` stays at its
current value — light (`--color-background:#F7F4EE`, `--color-accent:#D88B57`, …) and dark
(`#16130F` / `#E59E6B`, …), including all surface / text / border / accent-ramp / status / confidentiality /
traffic tokens. Selection, focus, primary actions, and the "active/进行中" status badge continue to use the
honey-orange accent family — NOT a new blue. The `no-hardcoded-color` gate's "exactly 2 `:root` blocks" invariant
is preserved.

## 2. What CHANGES (structure / scale / type only)

All changes are token-value edits (mirrored byte-equal into `apps/lawbar-desktop/src/theme/tokens.ts` where the
token is in the synced set), plus a few surgical component rules. **No palette hue changes.**

### 2.1 Radius (`html` scale tokens + tokens.ts SCALE)
| token | current | new |
|---|---|---|
| `--radius-sm` | 2px | **6px** |
| `--radius-md` | 3px | **8px** |
| `--radius-lg` | 5px | **12px** |
| `--radius-pill` | 999px | 999px (keep) |

Cards use `--radius-lg`; buttons/inputs/segments `--radius-md`; chips/badges `--radius-pill`.

### 2.2 Elevation (real soft shadow, replacing the flat hairline ring)
The current `--shadow-sm` is a hairline ring (`0 0 0 1px var(--color-border)`) and `--shadow-xs:none` — this
flatness is a main source of the "rigid" feel. Replace with genuine soft elevation, **theme-specific**, in the two
`:root` blocks.

**Gate constraint (load-bearing):** the `no-hardcoded-color` scanner forbids `rgba()`/`rgb()` *everywhere*; only
**hex** (incl. 8-digit `#RRGGBBAA`) is allowed, and only inside the two `:root` blocks. So shadows MUST be
expressed as 8-digit hex, never `rgba()`.

| token | light `:root` | dark `:root` |
|---|---|---|
| `--shadow-sm` | `0 1px 2px #1F1A170D, 0 8px 22px #1F1A1714` | `0 1px 2px #00000059, 0 12px 30px #00000073` |
| `--shadow-xs` | `0 1px 2px #1F1A1710` | `0 1px 2px #0000004D` |

(`#1F1A17` = the existing warm near-black text colour, so shadows read warm, not grey.) Cards move from the ring to
`--shadow-sm`; because the ring previously supplied the card edge, card rules must also keep a
`border: 1px solid var(--color-border)` hairline so edges stay crisp on the ivory ground.

### 2.3 Type
- **Drop serif headings.** Revalue `--font-serif` to the UI sans stack so every serif-display usage becomes sans
  without editing each component rule.
- **`--font-ui` order: KEEP Noto-first (unchanged).** See §4 — the earlier "system-first" proposal was reversed
  during implementation on new evidence (a live S1 offline-determinism policy + guarding test). `--font-ui` stays
  `"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", -apple-system, system-ui, sans-serif`.
- Weights: normalise any `700` heading to `600` (avoid 700 — heavier reads worse in dense CJK and less AppKit).
  Sizes/line-heights largely unchanged; keep CJK line-heights (body ~1.5, table rows ~1.4).

### 2.4 Component-layer de-rigidify (the ornaments) — deferred to WI-2
Remove the editorial/print language at the component-CSS layer: `§` section markers, uppercase-mono "eyebrows",
drop-caps, colophon/letterpress touches (`editorial-styles.css`, `cn-overlay.css`, `v12-typography.css`). Replace
with plain SF section labels and source-list-style disclosure `<summary>` rows (chevron + row, not a legal
heading). This is a larger component-CSS pass, split out so WI-1 stays token-scoped and gate-safe.

### 2.5 UI removal per Frank (2026-08-04)
Remove the **审计链 (audit-chain) disclosure** from the matter view (`viewMatter.ts` composition) — UI only. The
audit-chain **mechanism in persistence is unchanged and non-negotiable** (critical invariant); only its on-screen
panel is removed. This is a one-line composition change (drop `viewMatterAudit` from the `mainCol` array) + its
test; belongs with WI-2 (component/UI), not the token WI.

## 3. Gate constraints (must pass)
- `renderer-no-hardcoded-color.test.mjs`: exactly 2 `:root` blocks; no `rgba()`/`rgb()`; hex only, only in `:root`.
  New shadows use 8-digit hex accordingly.
- `main.test.mjs` palette-sync: any changed token that appears in `tokens.ts` (`LIGHT/DARK_THEME_TOKENS` compat
  subset + `SCALE_TOKENS`) must be updated in BOTH files, byte-equal.
- `renderer-i18n-guard` unaffected (no visible-string changes in WI-1).

## 4. Font order — REVERSED during implementation (kept Noto-first)
Initially I chose system-font-first (`-apple-system` first) for a crisper Latin/SF look. Implementation surfaced
new evidence that reversed this: `smoke.electron.test.mjs:161` ("S1 font wiring") guards a **live** policy — the
body stack MUST lead with the self-hosted `Noto Sans SC` — established for **offline rendering determinism** (the
app bundles its own WOFF2 so it renders identically on any machine, independent of installed system fonts;
`renderer/fonts/PROVENANCE.md`, HS10). Weighing it: the "Apple feel" comes overwhelmingly from **structure**
(elevation, radii, dropped serif), not from Latin rendering in SF vs Noto Sans (a subtle difference at UI sizes).
The system-first swap was the ONLY change that touched a live policy, required editing its guarding test, and
traded away offline determinism — for the smallest visual gain. **Decision: keep `--font-ui` Noto-first**
(unchanged), respect S1, and still drop serif headings (`--font-serif: var(--font-ui)`). Net: all structural
de-rigidify wins, zero conflict with S1, no test change, offline determinism preserved.

## 5. Sequencing (revised after WI-1 audit `audit-msfihuyp`)
The WI-1 audit found two things that reshape the split: the `--shadow-*` tokens have **zero `var(--shadow-*)`
consumers** (revaluing them is visually inert until component rules are wired to them), and aliasing
`--font-serif → var(--font-ui)` is an incoherent half-measure (misnamed token + the bundled Noto Serif face goes
dead). Both need the **component layer** to be coherent/visible. So:
- **WI-UI-RESTYLE-1 (token revalue — radius only):** §2.1 radius (`--radius-sm/md/lg` → 6/8/12px). This is the ONLY
  token change that is actually consumed (35 `var(--radius-*)` sites) and therefore visible on its own. Token-only,
  both hard gates green, palette untouched. Shipped first as a clean, bounded increment.
- **WI-UI-RESTYLE-2 (component restyle):** §2.2 elevation — revalue `--shadow-sm/-xs` (8-digit hex) **AND wire card
  rules to `box-shadow: var(--shadow-sm)`** so the soft elevation actually appears; §2.3 serif drop — **retarget the
  `--font-serif` consumers to `--font-ui` and remove the now-dead `--font-serif` token + its `@font-face` + the Noto
  Serif WOFF2** (proper removal, not an alias); §2.4 ornaments; §2.5 audit-panel removal; weight normalisation.
  Component-CSS + `viewMatter.ts` composition + font-file removal + tests. This is where the bulk of the visible
  de-rigidify (elevation, no-serif, no-ornaments) actually lands.

## 6. Out of scope
Any palette hue change; new colours; a third `:root` block; layout re-architecture; new dependencies; the audit
mechanism; anything under the Evidence A0.7 gate.
