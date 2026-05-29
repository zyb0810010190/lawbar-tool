# design-source — provenance

Recovered design-source assets for the case-box UI design-hardening lane
(`dev-memo/plan-casebox-ui-design-hardening-00.md` rev-0.2 READY).

## Assets

### Plan C symbol (recovered 2026-05-28)

| File | SHA-256 | Source | Provenance | Handoff ref |
|---|---|---|---|---|
| `lawbar-plan-c-original-shape.svg` | `3071b8ec659e04cbc3ed6bf76e3d6ebfd9a53ce970d64d91481f3d012962bed1` | `~/Downloads/lawbar-plan-c-original-shape.svg` (mtime 2026-05-28 10:23) | Claude Design canvas export; copied byte-identical (`cmp` confirmed) | §02 C 符号资产 — Plan C archive-index mark; the SVG mask shape for `.lb-mk` |

### Eight CSS source files + README (ingested 2026-05-29)

**Input archive**: `/Users/zhongyibao/Downloads/Lawbar Case Box UI Design Hardening.zip`
**Archive SHA-256**: `166ea35191a95253cef72fbde25aa84eaeb3fbb6636578fdbcaaf1c80c776627`
**Archive layout**: single top-level dir `lawbar-css-source/` containing 8 `.css` + `README.md` (9 entries; 122,672 bytes uncompressed).
**Verification**: every file extracted, confirmed un-minified (105–1192 lines each; minified would be 1–3 lines), copied byte-identical (`cmp -s` IDENTICAL for all 9). No inference, no rewrite, no minify, no merge, no JS extraction.

| File | SHA-256 | Source version (per README) | Contents |
|---|---|---|---|
| `editorial-tokens.css` | `a0ea6ad44734bce4709a025855694a159b769fe42ed864478620513777f9978c` | v0.2 (editorial direction) | `:root` palette + size / spacing / radius / shadow tokens, incl. `[data-theme="dark"]` |
| `editorial-styles.css` | `6abc7f881bb1dd99512417df0ce3adca3d2bc4e126b65630715ef289d915cafe` | v0.2 (editorial direction) | Typography base + component rules (button / form / table / card / pill / colophon) |
| `desktop-shell.css` | `851f4f5dbf095c3e2b724b74d445f4eae68faaa8d4152e936c16ae68d140e7fb` | v0.3 (desktop shell) | Desktop app shell — titlebar · sidebar · status-bar · main area |
| `cn-overlay.css` | `6f11778fd4f270f1853b92e93dea6b6794ab33a62ab517b380a2c3e7df46c13b` | v0.4 (Simplified Chinese direction) | CJK font stack + size adjustments + `em` → underline emphasis (replaces italic) |
| `v08-additions.css` | `9af0cc361fbc98b1d0ba7b8b836e715a070db8b791b80bf8e023350b4a1eb1dc` | v0.8 (12-screen build) | Three ledgers / detail / upload sheet / file rows / todo calendar / archive / workbench |
| `v11-auth.css` | `a3d66ff34cd5b85639b6b98de821036fcc28c45999a96ea97548c2450648c6e1` | v0.11 (auth pages) | Login / register / reset password / WeChat mini-program login |
| `v12-typography.css` | `5334d1c97317fa90b25be60931279bebbb3e79dad0ba7d32ba11e07fe28ba4f6` | v0.12 (typography refine) | Title↔body same-column alignment fix (must load AFTER the above) |
| `v13-mark.css` | `4aa4835c1ac24741576508777b4216e928d978a92b2e73ac899f34b9457f111a` | v0.13 (Plan C symbol) | Plan C archive-index micro-mark `.lb-mk` + color / size variants |
| `README.md` | `c855662b8666f0edb34650c6655884650af10c84890bdd7a417511339ddcf681` | — | Design-source manifest: load order + version map + font policy |

## Load order (per README — later overrides earlier)

1. `editorial-tokens.css`
2. `editorial-styles.css`
3. `desktop-shell.css`
4. `cn-overlay.css`
5. `v08-additions.css`
6. `v11-auth.css`
7. `v12-typography.css`
8. `v13-mark.css`

This load order is the authoritative sequence for the impl WI's §4.2 CSS-porting
stages (plan §8 slices S3-S4-S10-S11). The plan's slice ordering MUST honor it.

## HS9 — RESOLVED (2026-05-29)

The eight CSS source files named in handoff §02 B are now present as discrete,
un-minified, design-authored source files under `dev-memo/design-source/`,
verified against the archive by SHA-256. The earlier UNRESOLVED state (filesystem
search returned zero; handoff carried filenames only as display-text) is closed by
the real design-source export `Lawbar Case Box UI Design Hardening.zip`.

HS9 no longer blocks slices S1-S4 and S6-S14. The dependency-free S5
(`ledgerCategory` formatter) already shipped at `6ede506`.

The Plan C SVG (`lawbar-plan-c-original-shape.svg`) is the mask shape; `v13-mark.css`
is now the authoritative `.lb-mk` rule source. No hand-building of `.lb-mk` is needed
or permitted — port from `v13-mark.css`.

## HS10 — UNRESOLVED / DEFERRED (fonts CDN-only; no local WOFF2)

The README §"字体 / Fonts" states the design uses the **Google Fonts CDN only**;
the export bundle contains **NO local WOFF2 files**. The README's `<link>` to
`fonts.googleapis.com` is NOT usable in the runtime because:

- The renderer CSP is `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'` — `fonts.googleapis.com` / `fonts.gstatic.com` are cross-origin and blocked.
- The source-acquisition WI explicitly forbids adding Google Fonts CDN links to runtime code.
- No local WOFF2 files were supplied; system-font fallback is NOT authorized.

HS10 therefore remains UNRESOLVED. To proceed with font fidelity, EITHER:
- supply self-hosted WOFF2 files (README points to github.com/googlefonts/noto-cjk
  + github.com/JetBrains/JetBrainsMono) for local bundling under
  `apps/lawbar-desktop/renderer/fonts/`, OR
- explicitly authorize a system-CJK-font fallback (PingFang SC / Hiragino Sans)
  with a smoke assertion.

Until one is chosen, slice S1 (font bundle) stays blocked; CSS-only slices that do
not depend on the bundled fonts MAY proceed once authorized, falling back to the
system font stack at render time (visual fidelity reduced; documented).
