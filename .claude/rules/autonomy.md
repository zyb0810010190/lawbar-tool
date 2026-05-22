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
- Review and audit plans via cc-suite. Assistant-driven automation runs through the **plugin runner `codex-runner.mjs`** (Path 1) by default — equivalent to the user typing `/cc-suite:review-plan` / `/cc-suite:audit` / `/cc-suite:verify`. **These are slash commands or runner invocations, NOT Skills** — never invoke via `Skill(cc-suite:*)`. Direct Codex MCP is the fallback only when the runner is unavailable. See [[cc-suite]] for the path-order decision matrix and the eight required-recording fields per invocation.
- Fix plan defects identified by review.
- Revise existing docs, ADRs, dev-memos when scope is doc-only.
- Create follow-up work items / sub-WIs to keep scope bounded.
- Implement ONE bounded work item at a time.
- Write tests; run local test commands listed in `AGENTS.md`.
- Run cc-suite slash commands: `/cc-suite:audit`, `/cc-suite:audit-fix`, `/cc-suite:verify`, `/cc-suite:status`, `/cc-suite:result`, `/cc-suite:continue`. (See [[cc-suite]].)
- Fix audit findings (Critical, High, Medium) inside the active WI scope.
- Verify fixes and re-audit.
- Create docs-only ADRs and dev-memos.
- Create commits using **explicit staging** (see [[staging-hygiene]]).
- **Fix-forward** on plan-review / audit / verify / test / loc-guardian findings inside the active WI scope (per `dev-memo/rollback-00.md` §1).
- **Uncommitted rollback** via targeted `git restore <path>` / `git checkout -- <path>` for active-WI files only, with paths enumerated and the active-WI file list verified (per `dev-memo/rollback-00.md` §2 and [[staging-hygiene]] §"Uncommitted rollback").
- **Committed rollback** via `git revert <hash>` in interactive mode at user direction. NEVER `git reset --hard` to undo a commit (see Hard-stop list). During overnight / `/loop` / `/project-autopilot` runs, auto-revert is FORBIDDEN — autopilot stops with `STOP-FOR-ROLLBACK` and emits the 7-field report (per `dev-memo/rollback-00.md` §4 and [[../skills/project-autopilot/SKILL]]).
- Continue to the next unblocked WI when documented defaults apply (see `docs/release/go-live-plan.md` Autonomous Choice Policy).

## Hard-stop list (still mandatory)

Stop and ask the user before any of the following, even under bypassPermissions / dangerous mode:

- `git push`, any remote write, any branch deletion.
- `git push --force` / `git push --force-with-lease` (forbidden under any circumstance without explicit per-invocation user authorization).
- Deleting branches (`git branch -D`, `git push origin --delete <branch>`).
- `git reset --hard` on ANY ref — use `git revert <hash>` instead (per `dev-memo/rollback-00.md` §3).
- `git reset --soft`/`--mixed` followed by re-commit (use `git revert` instead).
- Auto-revert of committed work during overnight / `/loop` / `/project-autopilot` runs (per `dev-memo/rollback-00.md` §4 — autopilot must stop with `STOP-FOR-ROLLBACK` instead).
- `git clean` under any flag combination (deletes untracked files).
- Broad working-tree restore (`git restore .`, `git checkout -- .`) — use targeted single-path restore per [[staging-hygiene]] §"Uncommitted rollback".
- `git checkout <other-branch>` from inside an in-flight WI (would discard uncommitted active-WI changes).
- Deploy / release / publication / "go-live" announcement.
- Destructive broad deletes (`rm -rf` on tracked trees, dropping tables, truncating data).
- Deleting untracked files inside the working tree that may be user drafts.
- Deleting `~/.claude/plugins/**` plugin state (cc-suite, codex, etc.).
- Deleting cc-suite artifacts under `${CLAUDE_PLUGIN_DATA}/state/`.
- Wiping audit artifacts (job logs, `dev-memo/deferred-audit-findings.md` entries).
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

## Committed rollback restrictions

`dev-memo/rollback-00.md` is the authoritative policy.

- Fix-forward is preferred when the issue is local and scoped (per `dev-memo/rollback-00.md` §5).
- Rollback (via `git revert`) is preferred when the commit pursues wrong product direction, weakens a security boundary, mixes scopes, or violates the brief/an ADR.
- Reverting a high-risk WI (cc-suite-recorded) MUST itself produce a 7-field rollback recording in the revert commit message (per `dev-memo/rollback-00.md` §6 and [[cc-suite]] §"Rollback recording").
- Overnight / `/loop` / `/project-autopilot` modes do NOT auto-revert. Autopilot stops with `STOP-FOR-ROLLBACK` (per [[../skills/project-autopilot/SKILL]] §"Stop conditions") and emits the 7-field stop-and-report.

Related: [[staging-hygiene]], [[security-boundary]], [[client-local-first]], [[loc-guardian]], [[cc-suite]], `dev-memo/rollback-00.md`.
