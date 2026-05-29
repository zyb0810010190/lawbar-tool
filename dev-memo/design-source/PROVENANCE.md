# design-source — provenance

Recovered design-source assets for the case-box UI design-hardening lane
(`dev-memo/plan-casebox-ui-design-hardening-00.md` rev-0.2 READY).

## Assets

| File | SHA-256 | Source | Provenance | Handoff ref |
|---|---|---|---|---|
| `lawbar-plan-c-original-shape.svg` | `3071b8ec659e04cbc3ed6bf76e3d6ebfd9a53ce970d64d91481f3d012962bed1` | `~/Downloads/lawbar-plan-c-original-shape.svg` (mtime 2026-05-28 10:23) | Claude Design canvas export; copied byte-identical (`cmp` confirmed) | §02 C 符号资产 — Plan C archive-index mark; the SVG mask shape for `.lb-mk` |

## Status of the eight CSS source files (HS9 — UNRESOLVED)

Per `dev-memo/plan-casebox-ui-design-hardening-00.md` §11 HS9, the eight CSS
source files named in handoff §02 B are STILL MISSING:

- `editorial-tokens.css`
- `editorial-styles.css`
- `desktop-shell.css`
- `cn-overlay.css`
- `v08-additions.css`
- `v11-auth.css`
- `v12-typography.css`
- `v13-mark.css`

Filesystem search (`/`, `~/Downloads`, repo) returned zero discrete files.
The handoff (`dev-memo/Lawbar Handoff v1.0 _standalone_.html`) is a bundled
React standalone; the filenames appear only as display-text inside its §02
reference table, NOT as embedded file content. The eight files were NOT
reconstructed (forbidden per source-acquisition WI: "not by inference"; "do
not hand-create substitute CSS").

HS9 blocks slices S1-S4 and S6-S14 of the design-hardening impl WI. Only the
dependency-free S5 (`ledgerCategory` formatter) shipped — committed at
`6ede506`.

## Status of the Plan C SVG → `v13-mark.css` relationship

The recovered SVG is the MASK SHAPE only. The `.lb-mk` CSS (mask-image rules
+ size/color variants per handoff Appendix) must still come from
`v13-mark.css` — which remains missing. This SVG does NOT authorize
hand-building the `.lb-mk` class around it.

## Status of fonts (HS10 — DEFERRED)

No Noto Serif SC / Noto Sans SC / JetBrains Mono WOFF2 files located. Per the
source-acquisition WI sequencing, HS10 is decided only after HS9 is solved.
