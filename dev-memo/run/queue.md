## WI-001: record canary start note
Type: WORKFLOW
Scope: create a short note that records the first autonomous canary location and purpose
Source of truth: HANDOVER.md
Allowed files: dev-memo/canary-start.md
Forbidden files: none
Gates: scripts/workflow/check-gates.sh
Acceptance criteria: dev-memo/canary-start.md exists and contains the phrase first non-UI canary
Risk flags: none
Depends on: none
Commit boundary: one local commit for the canary start note

## WI-002: record gate command note
Type: WORKFLOW
Scope: create a short note documenting the lawbar-tool gate command used by the workflow
Source of truth: scripts/workflow/check-gates.sh
Allowed files: dev-memo/gate-command-note.md
Forbidden files: none
Gates: scripts/workflow/check-gates.sh
Acceptance criteria: dev-memo/gate-command-note.md exists and contains npm --prefix apps/lawbar-desktop test
Risk flags: none
Depends on: none
Commit boundary: one local commit for the gate command note

## WI-003: record UI baseline pointer
Type: EVIDENCE
Scope: create a short note pointing future UI work to the legacy UI baseline
Source of truth: dev-memo/ui-baseline.md
Allowed files: dev-memo/ui-baseline-pointer.md
Forbidden files: none
Gates: scripts/workflow/check-gates.sh
Acceptance criteria: dev-memo/ui-baseline-pointer.md exists and contains dev-memo/ui-baseline.md
Risk flags: none
Depends on: none
Commit boundary: one local commit for the UI baseline pointer
