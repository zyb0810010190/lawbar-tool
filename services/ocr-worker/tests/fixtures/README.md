# `services/ocr-worker/tests/fixtures/`

Self-contained fixtures for the worker tests.

## `zh-02-court-heading.png`

A synthetic simplified-Chinese court heading rendered with Hiragino Sans GB.
**Authored ground truth**: `上海市浦东新区人民法院` (see `zh-02-court-heading.txt`).

**Vendored from** `services/ocr-worker-bakeoff/fixtures/synthetic/zh-02-court-heading.png`
in commit cc2a320-era. The bakeoff manifest documents the rendering pipeline
(ImageMagick 7.1.2 on darwin-arm64, Hiragino Sans GB, 44pt on a 800x80 canvas).

Why vendor instead of reading the bakeoff path?

- The bakeoff package is dev-only and sits outside this package's dep graph.
  A cross-package filesystem dependency in worker tests would mean the worker
  test silently skips when the bakeoff disappears or moves; vendoring removes
  that fragility (audit 019e3a8f D8 Medium fix).
- The fixture is small (~3 KB); duplication cost is negligible.
- If the bakeoff's fixture changes for measurement reasons, the worker's
  expectations stay pinned to a known-good rendering.

If the upstream bakeoff fixture is re-rendered, this copy must be refreshed
in lockstep (the OCR contract here is "engine recognizes the same authored
text", not "bytes are bit-identical to the bakeoff").
