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

## Loop body

Repeat until a stop condition fires.

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
- Newest `dev-memo/*-plan.md` / `*-brainstorm.md` matching the next likely WI.

### 3. Select next WI

Apply the selection algorithm from [[../../commands/continue-project]] step 4. Prefer the smallest bounded WI that unblocks the most downstream work.

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
- Run `/cc-suite:verify`.
- Audit must show no unresolved Critical/High before commit.

### 6. Commit

- Run [[../../commands/commit-gate]] with explicit staging.
- Never push.

### 7. Continue or stop

- If next WI exists and no stop condition: loop to step 1.
- Otherwise: stop with a summary.

## Stop conditions

Stop immediately when any of the following hold:

- `branch-clean` returns `DIRTY-BLOCKING`.
- Next WI matches a hard-stop in [[../../rules/autonomy]] (push, deploy, go-live, secrets, auth-provider choice, cloud-vendor choice, irreversible migration, production data, broad destructive delete, global config edit, exposing legal docs externally).
- Audit yields Critical/High that cannot be closed inside the current WI scope.
- A product-direction question arises not answered by [[../../rules/client-local-first]] or `plan-client-00.md`.
- All planned WIs in `go-live-plan.md` are `done` — go-live readiness gate is itself a hard-stop and requires explicit user approval.
- The user interrupts.

## Stop output

When stopping, produce a short report:

- Last completed WI + commit hash.
- Next WI candidate (if any) + the stop reason that prevents proceeding.
- Files changed in this autopilot session, grouped by commit.
- Outstanding audit findings, if any.
- Recommended next user action.

## Forbidden inside the loop

- `git push`.
- Branch deletion.
- Editing `~/.claude` or any path outside the repo.
- Touching `.env` / secrets / credentials.
- Picking auth providers or cloud vendors.
- Claiming go-live readiness.

Related: [[../security-wi-loop/SKILL]], [[../client-architecture-reconcile/SKILL]], [[../../rules/autonomy]], [[../../rules/staging-hygiene]].
