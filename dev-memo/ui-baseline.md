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

**Updated 2026-06-02:** the design-artifact entry gate has since been built and merged (see
`UI-GATES.md`, `scripts/workflow/check-queue.sh`, and the PR-time
`scripts/workflow/check-ui-design-artifact.sh`). Corrected status:
- `Type: UI` **is** now a valid WI type — but a UI WI may enter a *governed queue* only with a
  concrete `Design artifact:` reference (`check-queue.sh`), and a UI PR must carry a standalone
  `Design artifact:` line (enforced at PR time).
- **Full** UI automation (the `frontend-design` → token/responsive → visual/a11y/Lighthouse
  regression chain described in `UI-GATES.md`) remains **deferred** — only the design-artifact
  entry gate is enforced today.
- The baseline recorded above remains the legacy pre-gate UI evidence, not new autonomous UI work.
