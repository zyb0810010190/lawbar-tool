# Queue template — copy a block per Work Item into queue.md.
# Inline "# comments" after a value are stripped by check-queue.sh, but keep VALUES concrete.

## WI-001: add inline email validation to signup
Type: IMPL
Scope: validate email format on the signup form before submit
Source of truth: specs/signup.md
Allowed files: src/signup.js
Forbidden files: none
Gates: npm test
Acceptance criteria: invalid emails show an inline error and block submit
Risk flags: none
Depends on: none
Commit boundary: one local commit for the validation change

## WI-002: implement matter-list empty state
# Type: UI WIs require a concrete 'Design artifact:' field (UI-GATES.md) or check-queue.sh fails the lint.
Type: UI
Scope: render an empty-state card on the matter list when no matters exist
Source of truth: dev-memo/ui-baseline.md
Design artifact: dev-memo/design/2026-06-01-matter-list-empty-state.md (Claude Design export)
Allowed files: apps/lawbar-desktop/renderer/screens/listMatters.ts
Forbidden files: none
Gates: npm --prefix apps/lawbar-desktop run test:ui-list-matters
Acceptance criteria: the empty-state card renders when the matter list is empty
Risk flags: none
Depends on: none
Commit boundary: one local commit for the empty-state UI
