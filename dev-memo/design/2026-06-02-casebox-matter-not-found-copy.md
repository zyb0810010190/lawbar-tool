# Design artifact — case-box "Matter not found" copy

**Date**: 2026-06-02
**Type**: UI copy correctness fix (no layout / control / IPC / persistence change)
**Surface**: the "Matter not found" error page on both view-matter and archive-matter screens
(`apps/lawbar-desktop/renderer/screens/viewMatter.ts`, `…/archiveMatter.ts`;
`data-test-id="view-not-found"` / `"archive-not-found"`).

## Problem

When a matter id resolves to nothing, both screens render:

> Matter not found
> **It may have been created in a previous session — data is in-memory only.**

That explanation is now **false**. Case-box persists to SQLite under Electron
`app.getPath("userData")` (`PRODUCT(desktop): use SQLite case-box runtime`, proven across
restart by `PRODUCT(desktop): prove case-box persistence across restart`). A matter is no
longer lost on relaunch, so "not found" is **not** caused by in-memory volatility. The copy is
both inaccurate and actively misleading: it tells the user their data was discarded when, in
fact, their matters persist locally. This is the same class of stale-copy bug fixed for the
empty state in `dev-memo/design/2026-06-02-casebox-persistent-empty-state-copy.md`.

## Decision

Replace the volatility explanation with an accurate, non-alarming reason:

> Matter not found
> **The link may be out of date.**

### Why this wording

- **Accurate**: with durable local persistence, a "not found" result means the id does not
  correspond to any stored matter — typically a stale or mistyped route (`#/matters/:id`), not
  data loss. "The link may be out of date." states that without overclaiming.
- **Avoids false implications**: it does not assert volatility (false) nor deletion (v1 archives
  matters but does not delete them, so "removed" would be misleading too).
- **Recoverable**: both screens already render a back-link (`view-back-link` /
  `archive-back-link-list`) to the matter list; the copy + link together let the user recover.
- **Minimal**: the `Matter not found` heading and page structure are unchanged; only the one
  explanatory sentence changes, identically on both screens for consistency.

## Exact copy

- view-matter not-found `<p>`: `The link may be out of date.`
- archive-matter not-found `<p>`: `The link may be out of date.` (identical)

## Out of scope (explicitly unchanged)

Layout, DOM structure, the `*-not-found` / back-link test ids, IPC contracts, persistence code,
and all workflow gates. Copy-only change plus the two test assertions that pin the string.

## Affected files

- `apps/lawbar-desktop/renderer/screens/viewMatter.ts`
- `apps/lawbar-desktop/renderer/screens/archiveMatter.ts`
- `apps/lawbar-desktop/tests/renderer-view-matter.test.mjs`
- `apps/lawbar-desktop/tests/renderer-archive-matter.test.mjs`
