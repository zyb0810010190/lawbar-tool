---
name: project-autopilot
description: Use to drive the project forward through multiple WIs under the pre-authorized autonomy policy. Loops branch-clean → choose WI → plan/audit/fix/verify/commit until a hard-stop or project completion.
---

# project-autopilot

End-to-end driver. Pulls together [[../../commands/branch-clean]], [[../../commands/continue-project]], [[../../commands/commit-gate]], [[../security-wi-loop/SKILL]], and [[../client-architecture-reconcile/SKILL]] into a single autonomous loop bounded by the [[../../rules/autonomy]] hard-stop list.

## When to use

- User says "continue the project", "resume", "keep going", or invokes `/continue-project` without naming a WI.
- WORKSPACE-00 finished and the next WI under `docs/release/go-live-plan.md` is unblocked.
- A previous autopilot run paused at a hard-stop and the user has now resolved the stop condition.

**Overnight mode requires a lane authorization.** Per [[../../rules/autonomy]] §"Overnight lane policy" + `dev-memo/night-run-00.md` §1, any overnight `/loop`, `/project-autopilot`, or long `/goal` run is lane-scoped. The user's instruction that starts the run MUST include a lane authorization block (template at `dev-memo/night-run-00.md` §1) naming the lane, allowed WIs / phases, allowed and forbidden files, hard stops, commit policy, test matrix, cc-suite requirements, loc-guardian requirements, stop / report conditions. If the authorization is missing or ambiguous, autopilot stops at Step 0 (below) and asks. "Keep going" without a lane authorization is NOT sufficient for overnight scope.

Interactive (non-overnight) invocations do NOT require a lane authorization block; the existing pre-authorized actions in [[../../rules/autonomy]] §"Pre-authorized actions" apply directly.

## Loop body

Repeat until a stop condition fires.

### 0. Lane-authorization check (overnight mode only)

If this run is overnight (`/loop`, `/project-autopilot`, or a long `/goal` session):

- Look for a lane authorization block in the user's invocation message OR a referenced memo (e.g. `dev-memo/night-run-<lane>.md`).
- Validate the block against the `dev-memo/night-run-00.md` §1 template: every REQUIRED field must be present and unambiguous.
- If the block is missing or any required field is omitted / ambiguous: STOP with `LANE-AUTHORIZATION-MISSING` and ask the user to fill the template before starting the run.
- If the block is complete: pin ALL required lane fields (allowed WIs / phases, allowed and forbidden file paths, lane-specific hard stops, commit policy — plan + impl + rollback grants, test matrix, cc-suite requirements, loc-guardian requirements, stop / report conditions, operational settings — branch + push policy + plugin-state + artifacts). Every subsequent step in this loop checks against the pinned lane fields; nothing infers from chat context.

For interactive (non-overnight) runs, skip Step 0 entirely and start at Step 1.

### 1. branch-clean

- Run [[../../commands/branch-clean]].
- If `DIRTY-BLOCKING`: stop and surface.
- If `DIRTY-RECOVERABLE`: apply minimal `.gitignore` or `git restore --staged` repair, then re-run.
- If `SAFE`: continue.

### 2. Read plan corpus

- `docs/release/go-live-plan.md` — WI list + Autonomous Choice Policy.
- `docs/release/go-live-readiness-report.md` — current readiness state.
- `docs/release/wi-03-security-signoff.md` — security closure status.
- `dev-memo/plan-client-00.md` — client surface reconciliation status.
- `docs/product/project-requirements-brief.md` — whole-project requirements intake, when present (see [[../../rules/project-brief]]).
- Newest `dev-memo/*-plan.md` / `*-brainstorm.md` matching the next likely WI.

### 3. Select next WI

Apply the selection algorithm from [[../../commands/continue-project]] step 4. Prefer the smallest bounded WI that unblocks the most downstream work.

**Brief consultation gate.** Before locking the candidate WI, check `docs/product/project-requirements-brief.md` if it exists. Stop the loop with reason `BRIEF-CONFLICT` and surface to the user if:

- The candidate WI's scope contradicts a `READY` brief (e.g. WI assumes browser-first while the brief locks Mac-first; WI introduces a hard-stop item without explicit user authorization).
- The candidate WI requires the brief and the brief is missing or still `DRAFT-PENDING-REVIEW` / `AMENDMENT-PENDING-REVIEW`. Autopilot MUST NOT run `/project-brief` itself — ask the user to run it manually.
- The brief's `Reconciliation log` flags the WI's target source as `RECONCILIATION-NEEDED` and the reconciliation WI has not yet landed.

A `READY` brief whose answers are silent on the candidate WI's scope is not a conflict — proceed normally.

### 4. Route by WI shape

| WI shape | Skill / command |
|---|---|
| Security / SSRF / TLS / DNS / fetcher / auth / sandbox | [[../security-wi-loop/SKILL]] |
| Client surface / gateway / sync / ADR reconciliation | [[../client-architecture-reconcile/SKILL]] |
| General bounded code WI | plan → `/cc-suite:review-plan` (when in-scope per [[../../rules/cc-suite]]) → implement → tests → `/cc-suite:audit-fix` → `/cc-suite:verify` → [[../../commands/commit-gate]] |
| Doc-only ADR / dev-memo | draft → `/cc-suite:review-plan` (optional for low-risk per [[../../rules/cc-suite]]; self-review fallback allowed with recording) → [[../../commands/commit-gate]] |

**cc-suite commands are slash commands OR plugin-runner invocations, NOT Skills.** Never invoke as `Skill(cc-suite:*)` — see [[../../rules/cc-suite]]. Assistant-driven runs use the plugin runner `codex-runner.mjs` (Path 1) by default; direct Codex MCP is the fallback (Path 2); `codex exec` is the last resort (Path 3); if all three fail, stop and ask the user (Path 4). Self-review remains forbidden for high-risk WIs unless the user explicitly authorizes the fallback in the same turn.

**High-risk `review-plan` runs follow the retry policy** in [[../../rules/cc-suite]] §"Retry policy": Path 1 full packet → Path 1 compact packet (on `spawnSync codex ETIMEDOUT`) → Path 2 compact packet (on second timeout) → Path 3 last resort. Plans for high-risk WIs MUST carry a `## Review packet (compact)` section so the second attempt has a narrow prompt ready. Every failure (and its retry trace) lands in `dev-memo/cc-suite-reliability-log.md`. The eleven recording fields in [[../../rules/cc-suite]] §"Required recording" now include failure classification, retry-attempt log, and fallback reason.

### 5. Verify gate

- Run package tests touched by the WI.
- Run `/cc-suite:audit-fix` (or `/cc-suite:audit` + manual fix) on the changed scope. (Slash command; see [[../../rules/cc-suite]].)
- Resolve audit findings per [[../../rules/cc-suite]] §"Audit remediation policy": every Critical/High/Medium MUST be FIXED-and-verified or explicitly ESCALATED; Lows may be deferred only when out-of-scope / cleanup-only / explicitly accepted. Every deferral records the five fields (finding ID, severity, reason, target WI/backlog, safe-to-proceed?) BOTH in the WI's commit message AND as an appended row in `dev-memo/deferred-audit-findings.md` (the project-wide backlog).
- Run `/cc-suite:verify` — its verdict MUST be `ALL CLOSED` (or `ALL CLOSED + DEFERRED-PER-WI Lows`) before commit. Undocumented open Critical/High/Medium → escalate, do not commit.

### 6. Commit

- Run [[../../commands/commit-gate]] with explicit staging.
- Never push.
- **Overnight mode**: emit a per-phase report block immediately after commit per `dev-memo/night-run-00.md` §6 (commit hash + files changed + tests + loc-guardian verdict + cc-suite job IDs + fallback usage + deferred backlog changes + next phase selected). The report lives in the autopilot output AND duplicates the same fields into the commit message body, matching the existing R-5 / R-6 / ROLLBACK-00 commit-message style.

### 7. Continue or stop

- If next WI exists and no stop condition: loop to step 1.
- Otherwise: stop with a summary.

## Stop conditions

Stop immediately when any of the following hold:

- `branch-clean` returns `DIRTY-BLOCKING`.
- Next WI matches a hard-stop in [[../../rules/autonomy]] (push, deploy, go-live, secrets, auth-provider choice, cloud-vendor choice, irreversible migration, production data, broad destructive delete, global config edit, exposing legal docs externally).
- **`LANE-AUTHORIZATION-MISSING`** (overnight mode only) — The user's invocation did not include a complete lane authorization block per `dev-memo/night-run-00.md` §1, OR the block is ambiguous on a required field. Per [[../../rules/autonomy]] §"Overnight lane policy", autopilot does NOT infer the lane scope from chat context.
- **`BRIEF-CONFLICT`** — Next WI conflicts with `docs/product/project-requirements-brief.md` (READY status), OR the brief is missing/`DRAFT-PENDING-REVIEW`/`AMENDMENT-PENDING-REVIEW` and the WI requires it, OR an unresolved `RECONCILIATION-NEEDED` entry blocks the WI's target source. See [[../../rules/project-brief]] §"Downstream consumption rules". Autopilot MUST NOT run `/project-brief` itself.
- **`LANE-EXIT`** (overnight mode only) — The next reasonable WI is OUTSIDE the pinned lane's "Allowed WIs / phases" or "Allowed files / packages". Autopilot does NOT widen the lane unilaterally; the user must either grant a new lane authorization or close the run.
- **`LANE-LOCAL-STOP`** (overnight mode only) — A lane-specific stop condition fires (any entry in the lane authorization's "Stop if" field).
- Audit yields Critical/High that cannot be closed inside the current WI scope.
- A product-direction question arises not answered by [[../../rules/client-local-first]], `plan-client-00.md`, or the brief.
- **`STOP-FOR-ROLLBACK`** — A previously-committed WI (this autopilot session OR earlier) is found to be wrong in a way fix-forward cannot repair (wrong product direction / weakened security boundary / mixed scopes / brief-or-ADR violation / broad unsafe behavior per `dev-memo/rollback-00.md` §5). Autopilot MUST NOT auto-revert during overnight mode; it stops and emits the 7-field rollback report (see §"Stop output" below). See `dev-memo/rollback-00.md` §4 + [[../../rules/cc-suite]] §"Rollback recording" + [[../../rules/autonomy]] §"Committed rollback restrictions".
- All planned WIs in `go-live-plan.md` are `done` — go-live readiness gate is itself a hard-stop and requires explicit user approval.
- The user interrupts.

Overnight-mode lane-aware stop conditions are documented in full at `dev-memo/night-run-00.md` §7. The list above pins the most common stop reasons; `night-run-00.md` is the authoritative reference.

## Stop output

When stopping, produce a short report:

- Last completed WI + commit hash.
- Next WI candidate (if any) + the stop reason that prevents proceeding.
- Files changed in this autopilot session, grouped by commit.
- Outstanding audit findings, if any.
- Recommended next user action.

**Overnight mode**: the per-phase report (per `dev-memo/night-run-00.md` §6) has already been emitted after every commit during the run. The stop-output above is the FINAL summary; it cross-references the per-phase reports but does NOT duplicate them. If the stop reason is `LANE-AUTHORIZATION-MISSING` or `LANE-EXIT` or `LANE-LOCAL-STOP`, name the offending lane field in the report.

### STOP-FOR-ROLLBACK report (7 fields)

When the stop reason is `STOP-FOR-ROLLBACK`, the report extends the above with the seven-field block from `dev-memo/rollback-00.md` §4:

1. **Bad commit hash** — the commit Claude believes should be reverted.
2. **Reason** — one-paragraph description of why the commit is wrong (wrong product direction / weakened security boundary / mixed scopes / brief-or-ADR violation / broad unsafe behavior).
3. **Affected files** — `git show --name-only <hash>`-style list.
4. **cc-suite job IDs** — every `review-plan` / `audit` / `verify` / `audit-fix` jobId recorded for the bad commit (from its commit message's recording block).
5. **Recommended revert command** — the literal `git revert <hash>` line the user can copy-paste.
6. **Tests needed after revert** — exact `npm --prefix <pkg> test` invocations the user should run after the revert lands.
7. **Downstream-dependency note** — if any commit AFTER the bad commit modifies the same files, name it explicitly so the user can decide whether to revert downstream too.

Autopilot does NOT run `git revert` itself in overnight mode. The user reviews the report and, if they authorize the revert, runs it themselves OR grants Claude per-invocation authorization to do so in interactive mode. The revert commit message then carries the 7-field rollback recording per [[../../rules/cc-suite]] §"Rollback recording".

## Forbidden inside the loop

PLUS every hard-stop entry in [[../../rules/autonomy]] §"Hard-stop list" (the canonical source). Specifically including, for clarity:

- `git push` (also `--force` / `--force-with-lease`).
- Branch deletion (local OR remote).
- `git reset --hard` on ANY ref.
- **Auto-revert of committed work** (`git revert <hash>`, `git reset --hard`, or any equivalent). Autopilot stops with `STOP-FOR-ROLLBACK` instead. See `dev-memo/rollback-00.md` §4 + [[../../rules/cc-suite]] §"Rollback recording" + [[../../rules/autonomy]] §"Committed rollback restrictions".
- **Broad working-tree restore** (`git restore .`, `git checkout -- .`, `git clean -fd`). Uncommitted rollback uses targeted single-path `git restore <path>` only — see [[../../rules/staging-hygiene]] §"Uncommitted rollback (active-WI scope only)".
- **Deleting untracked files inside the working tree** that may be user drafts.
- **Deleting `~/.claude/plugins/**`** plugin state (cc-suite, codex, etc.).
- **Deleting cc-suite artifacts** under `${CLAUDE_PLUGIN_DATA}/state/`.
- **Wiping audit artifacts** (job logs, `dev-memo/deferred-audit-findings.md` entries).
- Editing `~/.claude` or any path outside the repo.
- Touching `.env` / secrets / credentials.
- Picking auth providers or cloud vendors.
- Claiming go-live readiness.

Related: [[../security-wi-loop/SKILL]], [[../client-architecture-reconcile/SKILL]], [[../../rules/autonomy]], [[../../rules/staging-hygiene]], [[../../rules/cc-suite]], [[../../rules/execution-discipline]], `dev-memo/rollback-00.md`, `dev-memo/night-run-00.md`.
