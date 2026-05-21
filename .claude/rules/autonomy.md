---
description: Routine plan/audit/fix/verify/commit loop is pre-authorized; hard-stop list still mandatory
applies-to: "**"
---

# Autonomy Policy

This project pre-authorizes Claude Code (and Codex via cc-suite review/validate role) to drive routine project work without per-step confirmation, subject to the hard-stop list below.

## Pre-authorized actions

Claude may take all of the following without asking:

- Discover docs (read ADRs, plans, contracts, dev-memos).
- Draft plans and PLAN-* / WI-* docs.
- Review and audit plans (`/review-plan`, codex review skills).
- Fix plan defects identified by review.
- Revise existing docs, ADRs, dev-memos when scope is doc-only.
- Create follow-up work items / sub-WIs to keep scope bounded.
- Implement ONE bounded work item at a time.
- Write tests; run local test commands listed in `AGENTS.md`.
- Run `/audit`, `/audit-fix`, `/verify`, `/status`, `/result`, `/continue`.
- Fix audit findings (Critical, High, Medium) inside the active WI scope.
- Verify fixes and re-audit.
- Create docs-only ADRs and dev-memos.
- Create commits using **explicit staging** (see [[staging-hygiene]]).
- Continue to the next unblocked WI when documented defaults apply (see `docs/release/go-live-plan.md` Autonomous Choice Policy).

## Hard-stop list (still mandatory)

Stop and ask the user before any of the following, even under bypassPermissions / dangerous mode:

- `git push`, any remote write, any branch deletion.
- Deploy / release / publication / "go-live" announcement.
- Destructive broad deletes (`rm -rf` on tracked trees, `git reset --hard` on non-throwaway state, dropping tables, truncating data).
- Editing `~/.claude` or any global machine config outside the repo.
- Handling real secrets / credentials / billing / external accounts.
- Choosing an auth provider.
- Choosing a cloud vendor or any public deployment mode.
- Exposing legal documents (real or production-shaped) to external/cloud services.
- Irreversible migrations on real data.
- Production data operations.
- Final go-live approval — sub-WI completion never implies go-live.
- New runtime dependencies.
- Public API, wire-format, schema, CLI breaking changes (unless the active WI explicitly authorizes the break).

## Continuation rule

When a WI completes verification + audit cleanly and the next WI is unblocked under the Autonomous Choice Policy, **continue** without prompting. Do not ask "should I proceed?" for routine forward progress.

**Pre-flight gate** — before continuing into the next WI on a long `/goal` or `/project-autopilot` run, [[loc-guardian]] requires a `/loc-guardian:scan` and a clean verdict for hand-written source/test files. If the scan reports a fail, the loop stops until the violation is split/refactored or the user explicitly authorizes deferral.

Related: [[staging-hygiene]], [[security-boundary]], [[client-local-first]], [[loc-guardian]].
