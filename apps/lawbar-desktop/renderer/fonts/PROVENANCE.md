# renderer/fonts — provenance (HS10 font-ingest)

Self-hosted WOFF2 fonts for the case-box UI design-hardening lane
(`dev-memo/plan-casebox-ui-design-hardening-00.md` rev-0.2 READY). Resolves
HS10 by **local self-hosted WOFF2 assets** — no Google Fonts CDN, no gstatic
unicode-range chunks, no system-font fallback.

Ingested 2026-05-29 via **Path 1** (local conversion of official variable TTF
to static per-weight WOFF2). Strategy A (full per-weight WOFF2). Minimal
actual-use weight set per the design CSS (`font-weight` grep = 400/500/600
only; no 700).

## License

All three families: **SIL Open Font License 1.1**. Verbatim per-family OFL
texts are concatenated in `OFL.txt` (this directory). Free to bundle +
redistribute.

| Family | Copyright (OFL header) | Reserved Font Name |
|---|---|---|
| Noto Sans SC | Copyright 2014-2021 Adobe, with RFN 'Source' | Source |
| Noto Serif SC | Copyright 2012 Google Inc. | — |
| JetBrains Mono | Copyright 2020 The JetBrains Mono Project Authors | — |

## Input artifacts (official upstream, downloaded 2026-05-29)

| Input | Source URL | Upstream version | SHA-256 (source) |
|---|---|---|---|
| `NotoSansSC[wght].ttf` (variable) | `https://github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf` | name-table `Version 2.004-H2` (google/fonts main @ 2026-05-29) | `a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da` |
| `NotoSerifSC[wght].ttf` (variable) | `https://github.com/google/fonts/raw/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf` | name-table `Version 2.003-H1` (google/fonts main @ 2026-05-29) | `050080d9255a86808f2945bffac582b31ef32bc36411ce29563b4961670c66f9` |
| `JetBrainsMono-2.304.zip` | `https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip` | release `v2.304` | `6f6376c6ed2960ea8a963cd7387ec9d76e3f629125bc33d1fdcd7eb7012f7bbf` |

Both Noto variable fonts confirmed to carry a `wght` axis spanning the needed
range (Sans 100→900, Serif 200→900; both cover 400/500/600). Source glyph
counts: Sans 31036, Serif 31058 — full coverage retained in every output (NO
subsetting).

## Conversion tooling (isolated; NOT added to project manifests)

Installed into a throwaway venv at `/tmp/fontconv-venv` (NOT
`apps/lawbar-desktop/package.json`; no runtime or dev dependency added to the
repo):

- `fonttools` 4.63.0
- `brotli` 1.2.0 (WOFF2 compression backend)
- Python 3 (`python3 -m venv`)

## Conversion commands

JetBrains Mono — direct copy from the official release webfont WOFF2 (no
conversion; byte-identical to upstream):

```
unzip JetBrainsMono-2.304.zip
cp fonts/webfonts/JetBrainsMono-Regular.woff2 → jetbrains-mono-400.woff2
cp fonts/webfonts/JetBrainsMono-Medium.woff2  → jetbrains-mono-500.woff2
```

Noto Sans SC / Noto Serif SC — instance variable→static at each weight, then
WOFF2-compress (full glyph set; no subset), via:

```python
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
ft = TTFont(src_variable_ttf)
instantiateVariableFont(ft, {"wght": W}, inplace=True)   # W ∈ {400,500,600}
ft.flavor = "woff2"
ft.save(out_woff2)
```

No `--subset`, no glyph pruning, no axis-pinning beyond `wght`.

## Output assets (final, this directory)

| File | wght | SHA-256 | Size (bytes) | Glyphs | Origin |
|---|---|---|---|---|---|
| `noto-sans-sc-400.woff2` | 400 | `f90dad78fa17624f256299d6e46a17b8bb483015e4ae286c60ff3065eefe426c` | 4,192,520 | 31036 | instanced from NotoSansSC variable |
| `noto-sans-sc-500.woff2` | 500 | `f1f6c2535db2426345f1e73f71f18079b71e9222f5a7ecf6f699d47d200908c3` | 4,268,652 | 31036 | instanced |
| `noto-sans-sc-600.woff2` | 600 | `82b98ddb1675eda9bd41f3474917236a306584c12d83f19073039cc19c80c8be` | 4,280,508 | 31036 | instanced |
| `noto-serif-sc-400.woff2` | 400 | `236ec545e73a299faf1a09e572e4d50ef699f7dadf6d9565406aeb026d28c246` | 5,732,716 | 31058 | instanced from NotoSerifSC variable |
| `noto-serif-sc-500.woff2` | 500 | `1a22f16f8c5eae50acbbb78c8b90af2ca60217eb16920da6069807e3a3f35242` | 5,809,616 | 31058 | instanced |
| `noto-serif-sc-600.woff2` | 600 | `c8b3fdaf0be8c2526aeaa78496215b4a8f6111858b6ec7e8ea3c77079caad2b3` | 5,798,088 | 31058 | instanced |
| `jetbrains-mono-400.woff2` | 400 | `a9cb1cd82332b23a47e3a1239d25d13c86d16c4220695e34b243effa999f45f2` | 92,164 | 1743 | copied verbatim (upstream Regular) |
| `jetbrains-mono-500.woff2` | 500 | `086c48dfbea9ddaff1320f7e09399b8e2924e88ce67453721255db3bdbb5a353` | 93,824 | 1743 | copied verbatim (upstream Medium) |

**Total added binary: ~29 MB** (8 WOFF2). Under the ~40-50 MB stop threshold.

Validation: every output confirmed `TTFont.flavor == "woff2"` and full glyph
count preserved (CJK 31036/31058; mono 1743). No output failed validation.

## Family → CSS var mapping (display-only; wiring is S1)

Per `dev-memo/design-source/cn-overlay.css` (load order 4, the authoritative
runtime font vars):

- `--font-serif` → Noto Serif SC (400/500/600)
- `--font-ui` → Noto Sans SC (400/500/600)
- `--font-mono` → JetBrains Mono (400/500)

No italic faces bundled: CJK Noto ships upright-only; cn-overlay replaces
`em`-italic with underline for CJK; residual Latin italic synthesizes / falls
back. No `--font-mono`+italic usage exists in the design CSS.

## HS10 status — RESOLVED (local self-hosted WOFF2)

HS10 is resolved by the eight self-hosted WOFF2 assets above. No CDN, no
gstatic chunks, no system-font fallback.

## Runtime wiring — PENDING S1 (NOT done here)

This ingest places **inert binaries only**. It does NOT:

- add `@font-face` rules (S1 writes them into the renderer CSS per design-source
  load order);
- edit `apps/lawbar-desktop/package.json` `build:assets` (S1 extends it to copy
  `renderer/fonts/` → `dist/renderer/fonts/`);
- change CSP (none needed: same-origin `file://` fonts satisfy `default-src 'self'`);
- start any visual slice S1-S4 / S6-S14.

The binaries change nothing at runtime until S1 references them.
