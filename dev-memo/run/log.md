# Auto-advance audit trail (append-only)

One block per completed WI. The runner appends before advancing. Designed so a run can be
reverted task-by-task: each commit hash here maps to one revertable commit.

<!-- Block format:
## WI-001  (2026-05-31T14:22Z)
Plan: <summary>
Codex review: PASS | Codex audit: PASS | Codex verify: PASS
Commit: <hash>
Files: <exact paths committed>
Next: WI-002
-->
