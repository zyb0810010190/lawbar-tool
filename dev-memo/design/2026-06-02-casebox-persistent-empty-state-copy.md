# Design artifact — case-box persistent empty-state copy

**Date**: 2026-06-02
**Type**: UI copy change (no layout / control / IPC / persistence change)
**Surface**: matter-list empty state (`apps/lawbar-desktop/renderer/screens/listMatters.ts`,
`data-test-id="list-empty"`)

## Problem

The active empty-state card reads:

> No matters yet. Click + New matter to create the first one. **Data is held in memory only —
> relaunching the app clears it.**

That second sentence is now **false**. The desktop case-box runtime persists to SQLite under
Electron `app.getPath("userData")` (landed: `PRODUCT(desktop): use SQLite case-box runtime`,
and proven across restart by `PRODUCT(desktop): prove case-box persistence across restart`).
Telling the user their data is volatile is both inaccurate and undermines trust in a legal
tool whose value depends on durable local storage.

## Decision

Replace the volatility sentence with an accurate, reassuring local-persistence statement:

> No matters yet. Click + New matter to create the first one. **Matters are stored locally on
> this device.**

### Why this wording

- **Accurate**: matters persist locally (SQLite under `userData`), surviving relaunch.
- **Local-first framing**: "on this device" matches the v1 local-first posture
  (`.claude/rules/client-local-first.md`) — it states persistence without implying any cloud
  or sync (which is opt-in and not present here).
- **Minimal**: one sentence swap; the first two sentences ("No matters yet…create the first
  one.") are unchanged, so the call-to-action and tone are preserved.
- The archived empty state ("No archived matters.") is unaffected.

## Exact copy

- Active empty state: `No matters yet. Click + New matter to create the first one. Matters are stored locally on this device.`
- Archived empty state: `No archived matters.` (unchanged)

## Out of scope (explicitly unchanged)

Layout, DOM structure, the `list-empty` test id, the `+ New matter` control, IPC contracts,
persistence code, and all workflow gates. This is a copy-only change plus the three test
assertions that pin the copy string.

## Affected files

- `apps/lawbar-desktop/renderer/screens/listMatters.ts` — the copy string.
- `apps/lawbar-desktop/tests/{casebox-ui.electron,smoke.electron,renderer-list-matters}.test.mjs`
  — assertions that pin the empty-state text.
