# Plan — WI-DESKTOP-RELEASE-SMOKE-MATRIX-05

**Type**: TEST (release-readiness). No product source change. Follows the zh-CN i18n lane
(PRs #236–#240). **Design artifact**: `dev-memo/desktop-release-smoke-matrix.md` (the matrix itself).

## Goal

A small, durable **packaged-app** smoke matrix that proves the core lawyer workflows still work after
i18n / settings / error-surface changes — so future PRs have a fast release-path signal.

## What changed

- `tests/casebox-ui.electron.test.mjs`: restructured the single packaged flow into the explicit **M1–M9
  matrix** in ONE electron launch (~3s). Added the three previously-uncovered items: M2 `案件` nav back to
  list, M4 created-matter-appears-in-list, M6 explicit sub-screen assertion, and M9 a **localized error
  path** (submit New Matter empty → zh-CN validation banner, asserting no English / raw detail leaks).
  Renamed the test to reflect the matrix.
- `package.json`: added `test:smoke-matrix` (alias of `test:ui-packaged`) for discoverability.
- `dev-memo/desktop-release-smoke-matrix.md` (new): the matrix table (9 items → hooks), run instructions,
  design choices, and intentional deferrals.

Assertions use visible zh-CN text + stable `data-test-id` hooks (not implementation details). The
existing local-first no-DB-leak post-scan is retained.

## Matrix coverage (all M1–M9 green)

M1 launch zh-CN · M2 sidebar nav 案件/新建案件/设置 · M3 create via enum dropdowns · M4 matter appears in
list · M5 detail opens · M6 sub-screen renders (deadlines + audit chain) · M7 archive · M8 settings via
real `app:info` preload/IPC · M9 localized error banner without English/raw leak. Plus the local-first
DB-location invariant.

## Intentionally deferred (see the matrix doc)

Deep sub-screen CRUD, pagination/multi-matter, non-macOS packaged runs, and IPC-failure error banners in
the packaged app (no failure-injection seam — the IPC error → zh-CN mapping is unit-tested in
`renderer-error-message.test.mjs` + per-screen envelope-error tests).

## Governance

Test/doc-only, low-risk (no product source, no schema/contract/enum change, no i18n guard weakened; guard
still reports user-facing English = 0). Per `.claude/rules/cc-suite.md` §"Low-risk WIs", self-review with
recording is acceptable. Self-review: the smoke uses only stable hooks + visible zh-CN text; M9 exercises a
deterministic reachable error path (client-side validation) rather than an injected IPC failure (no seam);
one electron launch keeps runtime ~3s; full unit suite (819) unchanged; `dist` + `test:smoke-matrix` green
on a fresh build.

## Acceptance (met)

- `npm --prefix apps/lawbar-desktop test` → 819 pass / 0 fail.
- `npm run test:ui-packaged` / `test:smoke-matrix` → 1 pass (M1–M9).
- `npm run dist` → success (arm64 + x64); smoke re-run green on the fresh build.
- user-facing English **0 → 0** (no renderer source changed). No product behavior changed.

## Out of scope

Product redesign, schema/contract enum values, new i18n surfaces, backend, `.mcp.json`.
