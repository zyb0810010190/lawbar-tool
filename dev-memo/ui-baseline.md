# UI baseline

Date: 2026-05-31T15:11:17Z
Commit: 27ffa0a

## Purpose

This document records the UI that existed before the Claude Design UI gate was introduced.
Existing UI is treated as legacy baseline evidence, not as new autonomous UI work.

## Existing UI areas

- Desktop renderer under `apps/lawbar-desktop/renderer/`
- Theme tokens under `apps/lawbar-desktop/src/theme/`
- Renderer and UI tests under `apps/lawbar-desktop/tests/`

## Current automated UI-related checks

- `npm --prefix apps/lawbar-desktop test`
- renderer import checks
- no-real-data checks
- no hardcoded renderer color checks
- renderer route/API/DOM tests

## Future UI work

Future UI WIs require the Claude Design gate before autonomous execution:
- `Type: UI` is not enabled yet.
- UI WIs must include a design artifact before they can enter a governed queue.
- UI automation remains deferred until the Design artifact gate is built.
