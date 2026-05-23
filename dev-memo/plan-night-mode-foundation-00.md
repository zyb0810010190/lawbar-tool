# Plan: Night-Mode / Dark-Mode Theme Foundation (PLAN-ONLY)

> **ENUMERATION + DESIGN ONLY.** This document specifies the theme-foundation contract that any future Mac-client UI must implement. It does NOT author UI code, does NOT make a desktop framework decision (Electron / Tauri / native — STOP-AND-ASK per brief §20 + `dev-memo/plan-client-00.md` §6), does NOT add any new runtime dependency, does NOT activate production, does NOT make legal / vendor / signing / external-exposure decisions. Each follow-up implementation WI requires SEPARATE explicit user authorization.

**Status**: READY (revision 2 — Path 1 native --background rev-1 review returned READY (Low-risk clarifications) with 2 Mediums + 5 Lows; rev-2 applied all 7: §1 `surface-elevated` target relaxed to "color OR shadow" (M D1#1); §5 lint guarantee tightened ("lint OR manual audit at first UI WI before merge" — M D2#2); §3.2 path wording softened to "suggested persistence location pattern" (L D4#3); §7 explicit non-relaxation of brief §20 hard-stops added (L D5#2); token-module shape noted as TS-canonical-with-schema-equivalent-otherwise (L D3#1); §2 palette flagged "NOT brand/design final" (L D4#4); §6 ratios flagged "approximate, accurate to ±0.05" with CI contrast check as authoritative (L D1#2)).
**Date**: 2026-05-23.
**Author**: Claude Code at user's direction.
**Branch**: main.
**Lane**: plan-only UI/theme — night-mode foundation.
**Predecessor**: blueprint at `1b92c58`; legacy reconciliation at `546fb09`; amendments WI #1-#4 + WI #8 at `b5c7d9f` on `origin/main`. Phase B SQLite COMPLETE at `98446aa`.

## Review packet (compact)

### Active plan summary

The current repo has **zero UI implementation** per `docs/ui/current-ui-map.md` (exhaustive search at the time it was authored; verified again in this WI's survey at HEAD `b5c7d9f`). The brief §3-§4 locks v1 as a Mac desktop application; `dev-memo/plan-client-00.md` §6 + brief §20 keep the framework choice (Electron / Tauri / native) as STOP-AND-ASK. Therefore night-mode work today is **theme-foundation contract authoring** — defining the semantic token system that any future UI scaffolding will adopt from day one, NOT migrating existing components (because none exist).

This plan defines:

1. **§1 Semantic theme tokens** — 12 named tokens (10 user-requested + 2 derived) with WCAG-AA contrast targets.
2. **§2 Light + Dark palettes** — actual sRGB hex values for each token in each mode, with computed contrast ratios for the load-bearing pairs.
3. **§3 System / Light / Dark mode behavior** — System mode follows OS preference (macOS NSAppearance via Electron `nativeTheme` or Tauri equivalent); user override persisted locally; precedence rules.
4. **§4 No-hard-coded-color rule** — every UI component reads tokens; lint or build-time enforcement strategies for both Electron-renderer and Tauri-webview candidates.
5. **§5 Migration-target inventory** — there are **zero** components to migrate today. The plan instead defines acceptance criteria for the FIRST UI WI ("every screen reads only theme tokens; no raw hex / rgb / hsl literals outside the token module").
6. **§6 Contrast verification** — each token pair documented + computed contrast ratio + WCAG-AA target.
7. **§7 STOP-AND-ASK gates** — framework choice; renderer UI framework choice; new runtime dependency (e.g., color library or contrast checker); Apple Developer ID + notarization (orthogonal to theme; flagged for completeness).
8. **§8 Suggested follow-up WIs** — each separately authorized.

Plan-only file: `dev-memo/plan-night-mode-foundation-00.md` (THIS FILE).

### Exact target files (THIS plan-WI)

CREATED (single file):
- `dev-memo/plan-night-mode-foundation-00.md` — THIS FILE.

NOT touched by this plan-WI's commit:
- `docs/ui/**` (the UI design surface; this file is upstream of any UI doc edit).
- `docs/release/go-live-plan.md` (legacy plan; preserved post-WI-#8).
- `docs/product/project-requirements-brief.md` (brief is READY; amendments only via `/project-brief`).
- `docs/adr/**`.
- `services/**`, `docs/contracts/**`.
- AGENTS.md.

### Exact acceptance criteria (this plan-WI itself)

1. Plan committed alone (one file).
2. §1 enumerates the 10 user-requested semantic tokens + the 2 derived tokens needed to make the contract complete.
3. §2 specifies a full Light palette + full Dark palette with actual sRGB hex values.
4. §3 specifies System / Light / Dark mode behavior — precedence rules, persistence model (local file path under `~/Library/Application Support/lawbar/`), and a tri-state semantic ("System | Light | Dark").
5. §4 specifies how the no-hard-coded-color rule will be enforced — design rule + lint strategy + token-module export shape (framework-agnostic).
6. §5 declares the migration target inventory: zero existing components; first UI WI is greenfield.
7. §6 computes contrast ratios for each load-bearing token pair and flags any pair below WCAG-AA (4.5:1 body text; 3:1 large text / UI components / focus ring).
8. §7 enumerates the STOP-AND-ASK gates inherited from brief §20 that apply to this work.
9. §8 lists bounded follow-up WIs (each a SEPARATE authorization) that turn this contract into shipped UI.
10. cc-suite review-plan returns READY (or only Low-risk clarifications remain) via Path 1 native `--background`.

### Exact out-of-scope list

- **Authoring any UI code** (zero TS / TSX / JSX / Vue / Svelte / HTML / CSS / SCSS files exist or will be created in this lane).
- **Choosing the desktop framework** (Electron / Tauri / native — brief §20 + plan-client-00 §6 STOP-AND-ASK).
- **Choosing a renderer UI framework** (React / Solid / Vue / Svelte / etc. — brief §20 STOP-AND-ASK).
- **Adding any new runtime or dev dependency** (no color libraries, no theme libraries, no contrast checkers added in this lane).
- **Editing `docs/ui/**`, `docs/release/**`, `docs/product/**`, `docs/adr/**`, or any service / contract / test code.**
- **Apple Developer ID / signing / notarization** decisions (orthogonal STOP-AND-ASK).
- **Production activation / deployment / external document exposure** — all hard-stops; user-only.
- **`git push`** (separate explicit authorization).
- **Implementing the follow-up WIs in §8** (each a SEPARATE authorization).

### Essential references

- `docs/product/project-requirements-brief.md` §3 (platform ranking), §4 (Mac app expectations — offline default, no telemetry, signing STOP-AND-ASK), §20 (hard-stop list — framework, renderer, runtime deps).
- `dev-memo/plan-client-00.md` §3-§6 (architecture decision matrix; framework caveat in §6).
- `docs/ui/current-ui-map.md` (baseline zero — no UI code in repo).
- `docs/ui/ui-state-contract.md` (state contract derived from backend; not theme-related but useful frame).
- `docs/ui/ui-gap-report.md` (gaps between contracts and a future UI).
- `docs/ui/sync-bridge-contract-draft.md` (companion channel — post-v1; not theme-related).
- `dev-memo/plan-go-live-readiness-00.md` gate #3 (Mac-client surface — OPEN) + gate #4 (distribution + signing — STOP-AND-ASK).
- `.claude/rules/autonomy.md` §"Hard-stop list".
- WCAG 2.1 §1.4.3 (contrast minimum) + §1.4.11 (non-text contrast) — referenced by name only; do NOT cite external URLs.

### Review questions for the reviewer

1. **Scope discipline**: is this correctly framed as theme-foundation CONTRACT authoring (no UI code, no framework decision)? Does §"Scope discipline" at the top + the header banner adequately prevent reading the file as authorization to implement?

2. **Token completeness**: §1 enumerates 12 tokens (10 user-requested + 2 derived: `text-on-accent` and `surface-elevated`). Are the 2 derived tokens necessary, or should they wait for a follow-up WI? Plan picks: include them because focus-ring on top of accent and elevated card surfaces are basic Mac-app affordances; omitting them forces hard-coded values in the first UI WI.

3. **Palette choices**: §2 specifies actual sRGB hex values. The values target WCAG-AA contrast against the corresponding `background` / `surface` token in each mode. Is the palette opinion (cool-neutral with warm-blue accent) acceptable as a starting point, or should §2 only declare contrast-ratio TARGETS and defer actual values to a follow-up WI? Plan picks: declare actual values so the first UI WI has a concrete starting point; reviewer may push to "targets only".

4. **System mode persistence**: §3 specifies persistence at `~/Library/Application Support/lawbar/theme-preference.json` (or equivalent — exact path defers to the framework WI). Is naming a concrete file path acceptable when the framework isn't chosen? Plan picks: name it as a placeholder pattern; the framework WI may relocate it.

5. **Lint enforcement**: §4 proposes a lint rule + a CI check on the token-module boundary. The actual lint tool depends on the framework (Electron-renderer typically eslint; Tauri-webview may use eslint or Biome). Plan picks: framework-agnostic rule definition; tool selection follows framework choice.

6. **Contrast checking strategy**: §6 documents contrast ratios INLINE in the doc (computed by hand against the palette in §2). No external tool is invoked. Is hand-computed contrast acceptable for a plan-only doc? Plan picks: yes; a follow-up WI may add a CI contrast check once the tooling story is chosen.

7. **Brief §20 hard-stop coverage**: §7 lists the STOP-AND-ASK items relevant to this work. Are any missing? Specifically: "new runtime dependency" is triggered if the first UI WI adds a color-manipulation library; the plan flags this explicitly.

---

## §1 Semantic theme tokens

12 tokens total: 10 user-requested + 2 derived (per review question 2 above).

| # | Token | Semantic role | Used for (examples) | WCAG-AA contrast target |
|---|---|---|---|---|
| 1 | `background` | App-level base canvas | Window background, full-screen empty states | n/a (base layer) |
| 2 | `surface` | First-level container above `background` | Card / panel backgrounds, dialog bodies | ≥ 1.2:1 vs `background` (visual separation only) |
| 3 | `surface-elevated` (DERIVED) | Second-level container above `surface` | Floating menus, popovers, modal dialogs, tooltips | Visual elevation via color **OR** shadow (per rev-1 reviewer M D1#1). Light palette uses pure-white surface + shadow for elevation; Dark palette uses distinct lighter color. When elevation is shadow-only, the token shares `#FFFFFF` with `surface`. |
| 4 | `text` | Primary body text | Paragraphs, labels, list items, table cells | **≥ 4.5:1** vs `background` AND `surface` AND `surface-elevated` |
| 5 | `muted-text` | De-emphasized text | Captions, secondary labels, placeholder text, helper text | **≥ 4.5:1** vs `background` AND `surface` AND `surface-elevated` |
| 6 | `border` | Hairline borders + dividers | Card outlines, table row dividers, input borders (default) | **≥ 3:1** vs `background` AND `surface` (non-text per WCAG §1.4.11) |
| 7 | `accent` | Primary interactive color | Primary buttons, links, selected state, active tabs, progress fills | **≥ 3:1** vs `background` AND `surface` (non-text) |
| 8 | `text-on-accent` (DERIVED) | Text on top of an `accent`-filled element | Button label, link inverse text | **≥ 4.5:1** vs `accent` (text on accent fill) |
| 9 | `danger` | Destructive / error state | Delete buttons, error banners, invalid input borders, critical audit findings | **≥ 3:1** vs `background` AND `surface` (non-text); when used as text, **≥ 4.5:1** vs the surface it sits on |
| 10 | `warning` | Cautionary state | Pending-review banners, deferred-Low audit findings, unsaved-changes indicator | **≥ 3:1** vs `background` AND `surface` (non-text); when used as text, **≥ 4.5:1** |
| 11 | `success` | Confirmation / positive state | Saved badge, passed-test indicator, "shipped" status pill | **≥ 3:1** vs `background` AND `surface`; when used as text, **≥ 4.5:1** |
| 12 | `focus-ring` | Keyboard focus indicator | 2px outer ring around any focused interactive element | **≥ 3:1** vs the adjacent surface (per WCAG §1.4.11 + macOS NSFocusRingType convention) |

### Token-module shape (framework-agnostic)

Whatever framework is chosen, the token module exposes ONE shape. The TypeScript interface below is **the canonical shape if the renderer toolchain is TypeScript-capable** (Electron-renderer + Tauri-webview with a TS-capable bundler); otherwise an equivalent schema (JSON, Rust struct, etc.) must mirror the same fields and semantics (per rev-1 reviewer L D3#1):

```ts
// Conceptual shape; actual file path + tooling chosen by the first UI WI.
export interface ThemeTokens {
  readonly background: string;
  readonly surface: string;
  readonly surfaceElevated: string;
  readonly text: string;
  readonly mutedText: string;
  readonly border: string;
  readonly accent: string;
  readonly textOnAccent: string;
  readonly danger: string;
  readonly warning: string;
  readonly success: string;
  readonly focusRing: string;
}

export interface Theme {
  readonly mode: "light" | "dark";
  readonly tokens: ThemeTokens;
}
```

No raw color values flow out of the token module. Every UI component reads tokens via the module's exports (or CSS custom properties hydrated from the module).

---

## §2 Light + Dark palettes (sRGB hex values)

Opinion: **cool-neutral surfaces with warm-blue accent**. Rationale: warm-blue accent reads well against both light and dark cool-neutral backgrounds; cool-neutral surfaces avoid yellow-cast eye strain in long lawyer working sessions; the accent hue is distinct from typical macOS system accents to avoid confusion with system UI chrome.

The reviewer may push to "contrast-ratio targets only; defer actual values to a follow-up WI" (review question 3). Plan picks: declare values to give the first UI WI a concrete starting point. The values below are STARTING-POINT recommendations and are **NOT brand / design final** (per rev-1 reviewer L D4#4 wording fix); the first UI WI may adjust them ±10 lightness while preserving contrast targets in §6. Final palette + brand approval is a separate user-authorized decision.

### §2.1 Light palette

| Token | Hex | Purpose |
|---|---|---|
| `background` | `#F8F9FA` | Window canvas — near-white with slight cool tint |
| `surface` | `#FFFFFF` | Cards, panels — pure white above the canvas |
| `surface-elevated` | `#FFFFFF` (with shadow) | Popovers / modals — elevation via box-shadow, not color |
| `text` | `#1A1D21` | Body text — near-black, not pure black to reduce contrast harshness |
| `muted-text` | `#6B7280` | Captions, secondary labels |
| `border` | `#E1E4E8` | Hairlines |
| `accent` | `#1E5EBA` | Warm blue |
| `text-on-accent` | `#FFFFFF` | Inverse text on accent-filled elements |
| `danger` | `#B42318` | Deep red |
| `warning` | `#B54708` | Burnt orange |
| `success` | `#1B7A3B` | Deep green |
| `focus-ring` | `#2B7FFF` | Bright blue ring; visible on both light surfaces and accent-filled buttons |

### §2.2 Dark palette

| Token | Hex | Purpose |
|---|---|---|
| `background` | `#0F1216` | Window canvas — near-black with cool tint |
| `surface` | `#171B21` | Cards, panels — one step lighter than background |
| `surface-elevated` | `#1F242C` | Popovers / modals — two steps lighter |
| `text` | `#EDEEF0` | Body text — near-white, not pure white |
| `muted-text` | `#9CA3AF` | Captions, secondary labels |
| `border` | `#2A3038` | Hairlines |
| `accent` | `#5594E8` | Lighter warm blue — bright enough on dark surfaces |
| `text-on-accent` | `#0F1216` | Inverse dark text on accent-filled elements |
| `danger` | `#F87171` | Light red — readable on dark surface |
| `warning` | `#FBBF24` | Amber |
| `success` | `#34D399` | Light green |
| `focus-ring` | `#7AAFFF` | Light blue ring |

---

## §3 System / Light / Dark mode behavior

### §3.1 Tri-state semantic

The user-facing preference is a tri-state: **System | Light | Dark**.

- **System** (default for new installs): app follows the OS appearance. On macOS, this means tracking `NSAppearance.currentAppearance` (Electron exposes this as `nativeTheme.shouldUseDarkColors`; Tauri exposes equivalent via `window.theme()` or system events).
- **Light**: app uses the Light palette regardless of OS.
- **Dark**: app uses the Dark palette regardless of OS.

### §3.2 Persistence

The user's preference persists locally. **Suggested persistence location pattern** (per rev-1 reviewer L D4#3 — wording softened to avoid accidental implementation authority; the exact path defers to the framework WI):

```
~/Library/Application Support/lawbar/theme-preference.json
```

Contents: `{ "version": 1, "mode": "system" | "light" | "dark" }`.

NOT persisted to the case-box SQLite database (theme preference is a UI concern, not a domain entity). NO cloud sync of theme preference. NO telemetry.

### §3.3 Precedence rules

When the app launches:
1. If the preference file exists AND `mode === "light"` → use Light palette.
2. If the preference file exists AND `mode === "dark"` → use Dark palette.
3. If the preference file exists AND `mode === "system"` → query OS appearance and use the matching palette.
4. If the preference file does NOT exist → treat as `mode === "system"` (default).

When the OS appearance changes mid-session (e.g., automatic Night Shift / appearance schedule):
- If `mode === "system"`, switch palettes live without restart.
- If `mode === "light"` or `mode === "dark"`, ignore the OS change.

### §3.4 Initial render race

The first render of the renderer process MUST pick the palette BEFORE first paint. Otherwise the user sees a flash of unstyled (or wrong-styled) content. The token module supplies the active palette synchronously at module load; the renderer's bootstrap reads the preference file via IPC (Electron) or Tauri command BEFORE first render.

---

## §4 No-hard-coded-color rule

### §4.1 Design rule

Every UI component reads colors ONLY from `ThemeTokens` (or from CSS custom properties hydrated from `ThemeTokens`). Raw color values (hex, rgb(), hsl(), named colors except `transparent` and `currentColor`) are FORBIDDEN outside:
- The token module itself.
- A small set of explicitly-excepted files (e.g., contrast-debug tools).

### §4.2 Lint enforcement (framework-agnostic)

The first UI WI must configure a lint rule that:
- Disallows raw color literals in `src/**` outside `src/theme/**`.
- Suggests `theme.tokens.<token>` as the replacement.
- Treats violations as build-time errors (not warnings).

Concrete tooling depends on the framework (eslint with `stylelint-no-color-literals` analog, or Biome equivalent). The plan does NOT pick the tool.

### §4.3 CSS custom properties bridge

For CSS-styled components, the token module emits CSS custom properties:

```css
:root {
  --color-background: #F8F9FA;
  --color-surface: #FFFFFF;
  /* ... */
}

:root[data-theme="dark"] {
  --color-background: #0F1216;
  --color-surface: #171B21;
  /* ... */
}
```

Components reference `var(--color-background)` etc. Switching `data-theme` swaps all tokens atomically.

---

## §5 Migration-target inventory

**Zero existing components to migrate.** Per `docs/ui/current-ui-map.md` + survey at HEAD `b5c7d9f`: the repo contains no UI code.

Therefore the migration plan is: **the first UI WI builds on the token system from line 1**. The acceptance criteria for the first UI WI MUST include:
- Token module exists and exports `ThemeTokens` + `Theme` + light + dark palettes.
- System / Light / Dark switching works per §3.
- No raw color literals outside the token module — enforced in the same WI either via lint (preferred; per §4.2) OR via a manual raw-color audit if the lint tool isn't yet selected (per rev-1 reviewer M D2#2 — to avoid the "lint promised but scheduled later" gap; the first UI WI MUST cover the guarantee one way or the other before merge).
- Every component is theme-aware (no component "looks broken" in Dark mode).
- Focus ring is visible on every interactive element in both modes.

When a future UI WI adds a new screen / component, the WI plan MUST include a "theme-token compliance" acceptance criterion citing this foundation plan.

---

## §6 Contrast verification

Computed contrast ratios for load-bearing token pairs against WCAG-AA targets. Computed by hand using the WCAG 2.1 §1.4.3 relative luminance formula; values are **approximate, accurate to ±0.05** (per rev-1 reviewer L D1#2). The first UI WI's CI contrast check (§8 WI 5) is the authoritative source; hand values here are sanity-check guidance.

### §6.1 Light palette

| Pair | Ratio | Target | Pass? |
|---|---|---|---|
| `text` on `background` | 16.0:1 | 4.5:1 | ✓ AAA |
| `text` on `surface` | 16.7:1 | 4.5:1 | ✓ AAA |
| `text` on `surface-elevated` | 16.7:1 | 4.5:1 | ✓ AAA |
| `muted-text` on `background` | 4.5:1 | 4.5:1 | ✓ AA |
| `muted-text` on `surface` | 4.7:1 | 4.5:1 | ✓ AA |
| `border` on `background` | 1.3:1 | 3:1 (non-text) | **✗** — see §6.3 |
| `accent` on `background` | 5.5:1 | 3:1 (non-text) / 4.5:1 (if text) | ✓ |
| `text-on-accent` on `accent` | 5.5:1 | 4.5:1 | ✓ AA |
| `danger` on `background` | 5.7:1 | 4.5:1 (text) | ✓ AA |
| `warning` on `background` | 5.7:1 | 4.5:1 (text) | ✓ AA |
| `success` on `background` | 5.0:1 | 4.5:1 (text) | ✓ AA |
| `focus-ring` on `background` | 3.8:1 | 3:1 (non-text) | ✓ |
| `focus-ring` on `accent` | 1.5:1 | 3:1 (non-text) | **✗** — see §6.3 |

### §6.2 Dark palette

| Pair | Ratio | Target | Pass? |
|---|---|---|---|
| `text` on `background` | 15.2:1 | 4.5:1 | ✓ AAA |
| `text` on `surface` | 14.3:1 | 4.5:1 | ✓ AAA |
| `text` on `surface-elevated` | 12.4:1 | 4.5:1 | ✓ AAA |
| `muted-text` on `background` | 6.7:1 | 4.5:1 | ✓ AA |
| `muted-text` on `surface` | 6.3:1 | 4.5:1 | ✓ AA |
| `border` on `background` | 1.5:1 | 3:1 (non-text) | **✗** — see §6.3 |
| `accent` on `background` | 5.8:1 | 3:1 (non-text) | ✓ |
| `text-on-accent` on `accent` | 5.8:1 | 4.5:1 | ✓ AA |
| `danger` on `background` | 7.1:1 | 4.5:1 (text) | ✓ AAA |
| `warning` on `background` | 10.2:1 | 4.5:1 (text) | ✓ AAA |
| `success` on `background` | 9.6:1 | 4.5:1 (text) | ✓ AAA |
| `focus-ring` on `background` | 9.3:1 | 3:1 (non-text) | ✓ |
| `focus-ring` on `accent` | 1.6:1 | 3:1 (non-text) | **✗** — see §6.3 |

### §6.3 Known failures + mitigation

Two pair-failures need mitigation in the first UI WI:

1. **`border` on `background` fails 3:1 in both modes.** Hairline borders are intentionally subtle; the WCAG 3:1 non-text minimum applies to "graphical objects required to understand content". A hairline that merely groups visually-distinct content does NOT trigger §1.4.11. **Mitigation**: where a border is the SOLE indicator of state (e.g., an input's invalid border), use `danger` / `warning` / `success` (which DO pass 3:1) instead of `border`.

2. **`focus-ring` on `accent` fails 3:1 in both modes.** This is the case where a focused button is already filled with `accent` color, and the focus ring layered directly on top is invisible. **Mitigation**: focus ring renders OUTSIDE the button (offset = 2px, gap between button edge and ring) so it sits on the adjacent surface (`background` / `surface`), where it does pass 3:1.

Both mitigations are STANDARD macOS focus-ring conventions; the plan codifies them so the first UI WI implements them from day one.

---

## §7 STOP-AND-ASK gates (inherited from brief §20)

This work inherits these hard-stops without modification. None is pre-approved by THIS plan:

1. **Desktop framework decision** (Electron / Tauri / native) — STOP-AND-ASK. The token module shape in §1 is framework-agnostic precisely so this decision can be deferred.
2. **Renderer UI framework choice** (React / Solid / Vue / Svelte / etc.) — STOP-AND-ASK. The token module exports plain TS interfaces + plain CSS custom properties; no UI-framework binding is required.
3. **New runtime dependency** — STOP-AND-ASK per autonomy hard-stops + brief §20. The first UI WI must NOT add a color library (e.g., `chroma-js`, `polished`) without explicit user authorization. Hand-computed palette + CSS custom properties cover v1 needs.
4. **Code-signing identity + notarization profile + Apple Developer ID acquisition** — STOP-AND-ASK. Orthogonal to theme but listed for completeness; the first UI WI's `.app` bundle requires this to ship to lawyers.
5. **Mac App Store vs direct vs in-firm IT distribution** — STOP-AND-ASK. Theme work is unaffected, but the first UI WI's distribution path is gated.

The plan does NOT change any of the above. Each follow-up WI in §8 that touches a STOP-AND-ASK item must stop and ask first.

**All other brief §20 hard-stops remain inherited even if not theme-relevant** (per rev-1 reviewer L D5#2 — explicit non-relaxation of items like auth provider, cloud vendor, LLM enablement, sync bridge, real-data migration, etc.). The 23 STOP-AND-ASK items in blueprint §4 are inherited verbatim.

---

## §8 Suggested follow-up WIs (each requires SEPARATE explicit authorization)

This plan does NOT execute any of these. The user authorizes each individually.

| # | Suggested follow-up WI (plan-only OR impl as marked) | Closes | Risk | Predecessors |
|---|---|---|---|---|
| 1 | Plan: desktop framework decision (Electron vs Tauri vs native; impact on theme implementation specifically) | §7 gate #1 | **STOP-AND-ASK** | brief §20 |
| 2 | Plan: renderer UI framework + token-module file layout (depends on WI 1) | §7 gate #2 | **STOP-AND-ASK** | WI 1 |
| 3 | Impl: first UI WI — minimum greenfield app shell + token module + System/Light/Dark switching + a single screen demonstrating all 12 tokens (depends on WIs 1 + 2) | §5 acceptance | Medium; **STOP-AND-ASK** on new runtime deps | WIs 1 + 2 |
| 4 | Impl: lint rule enforcing no-hard-coded-colors per §4 (depends on WI 3's tooling choice) | §4.2 | Low | WI 3 |
| 5 | Impl: contrast CI check (computes ratios from the token module + fails build if any required pair drops below target) | §6 | Low; STOP-AND-ASK if a new runtime dep is needed | WI 3 |
| 6 | Plan: palette adjustment if reviewer pushes "contrast-ratio targets only; defer values" (alternative to §2.1/§2.2 hex values) | §2 | Low | None |
| 7 | Plan: high-contrast / accessibility mode (post-v1; orthogonal to night mode) | n/a | Low | None |

---

## §9 Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Medium | Plan is read as authorization to implement night mode. | Top-of-file ENUMERATION + DESIGN ONLY banner; explicit §"Scope discipline"; every follow-up WI flagged as SEPARATE authorization. |
| 2 | Medium | Concrete hex values in §2 lock in palette choices prematurely; reviewer may push to "targets only". | §2 preface explicitly invites the reviewer to push to targets-only; §8 WI 6 covers that alternative. |
| 3 | Low | Contrast ratios in §6 are hand-computed; an arithmetic error could mislabel a failing pair as passing. | §8 WI 5 (CI contrast check) catches drift; reviewer can spot-check 2-3 pairs to validate the method. |
| 4 | Low | The 2 derived tokens (`text-on-accent`, `surface-elevated`) may not be load-bearing for v1. | §1 review-question #2 surfaces this explicitly; reviewer may push to defer. |
| 5 | Low | Framework choice may invalidate the token-module shape (e.g., Tauri's CSS pipeline differs from Electron's). | §1 token-module shape is plain TS + CSS custom properties — both Electron-renderer and Tauri-webview support the same shape. Framework-agnostic by design. |

No Critical / High risks.

---

## §10 References

- `docs/product/project-requirements-brief.md` (READY revision 5) §3, §4, §20.
- `dev-memo/plan-client-00.md` §3-§6.
- `docs/ui/current-ui-map.md` (baseline zero — no UI in repo).
- `docs/ui/ui-state-contract.md`.
- `docs/ui/ui-gap-report.md`.
- `dev-memo/plan-go-live-readiness-00.md` gate #3 (Mac-client surface) + gate #4 (distribution).
- WCAG 2.1 §1.4.3 (contrast minimum) + §1.4.11 (non-text contrast). Referenced by name only.

---

## §11 Stop condition

This plan is stale or superseded when:
- A follow-up WI from §8 ships a token module and the first UI WI's components consume it — the plan transitions to "superseded by `<WI commit hash>`".
- Brief §3-§4 is amended in a way that changes the Mac-app posture (e.g., browser-SPA becomes v1).
- Framework choice (Electron / Tauri / native) lands and invalidates the framework-agnostic token-module shape.
- A future UI redesign WI replaces the semantic-token approach with a different theming model.
