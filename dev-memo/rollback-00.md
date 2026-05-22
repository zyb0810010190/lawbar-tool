# ROLLBACK-00 — cc-suite-compatible rollback policy

**Status**: tracked rule companion.
**Date**: 2026-05-22.
**Author**: Claude Code at user's direction.
**Applies to**: every autopilot iteration, every overnight `/loop`, every interactive WI.

## Why this exists

Autonomous mode (long `/goal` runs, `/project-autopilot`, overnight `/loop`) needs a precise rule for **when Claude may rewind state** and **when it must stop**. Without this rule, the implicit choices vary across WIs: some prefer fix-forward, some implicitly `git restore .`, some leave a half-broken WI uncommitted on the working tree. None of those defaults are safe under bypassPermissions mode where every git operation lands without per-step confirmation.

This memo is the authoritative policy. The four rule files ([[../.claude/rules/staging-hygiene.md]], [[../.claude/rules/autonomy.md]], [[../.claude/rules/cc-suite.md]], [[../.claude/skills/project-autopilot/SKILL.md]]) reference this memo and add the enforcement hooks.

## The six policy points (canonical)

### 1. Fix-forward is the default

Claude may automatically fix the following classes of finding **inside the active WI scope, without rolling back**:

- `/cc-suite:review-plan` findings (Critical/High/Medium per `.claude/rules/cc-suite.md` §"Audit remediation policy").
- `/cc-suite:audit` findings (same).
- Test failures (per-package `npm test` exit non-zero).
- `/cc-suite:verify` residuals (audit findings still open after a fix pass).
- `/loc-guardian:scan` over-limit reports inside the active WI's touched files.

Fix-forward applies whether the WI is plan-only, contract-only, persistence, security, or docs. The contract is: each fix is **another edit + another test/audit run + another commit (if pre-commit)** OR **another edit on top of the WI's commit (if post-commit, inside the same WI)** rather than rewinding.

### 2. Uncommitted rollback — narrow, targeted, transparent

Before a WI is committed, Claude MAY use `git restore` / `git checkout -- <path>` to discard active-WI changes, but only under the following constraints:

1. **Active-WI scope only.** Every restored file MUST be inside the file list the current WI authored or modified. Files from other sessions, user drafts, or untracked scratch material are NEVER touched.
2. **Explicit path enumeration.** Before any restore, Claude prints the exact `git restore <path>` (one per file) it is about to run. No glob expansion. No `git restore .`. No `git checkout -- .`.
3. **Targeted restore syntax.** Allowed: `git restore <path>`, `git checkout -- <path>`. Forbidden: `git restore .`, `git checkout -- .`, `git reset --hard`, `git clean -fd`.
4. **No deletion of untracked files.** `git clean` is forbidden under any flag combination.
5. **No deletion of user-deferred work.** If the WI introduced a file the user has not yet acknowledged (e.g., a half-drafted plan, a fixture the user has been editing), Claude does NOT restore it.
6. **Preserve audit trail.** If the WI had cc-suite invocations recorded, the recording stays — restoration does NOT delete logs under `${CLAUDE_PLUGIN_DATA}/state/`.

Uncommitted rollback is a recovery step, not a routine path. Prefer fix-forward; use uncommitted rollback only when:
- the edit produced a syntactically broken file that the next edit cannot reach (rare but possible during refactors),
- the edit accidentally touched a file outside scope (the touched file is restored; the rest of the WI continues),
- an error in test scaffolding makes the WI un-runnable.

### 3. Committed rollback — `git revert`, NEVER `git reset`

Once a commit lands, the rollback mechanism is **always**:

```
git revert <commit-hash>
```

NOT `git reset`. NOT `git reset --hard`. NOT `git reset --soft` followed by re-commit. The reasons:

- `git revert` produces a NEW commit. History is preserved. Reviewers can see the rollback in `git log`.
- `git reset --hard` rewrites the working tree silently and erases the commit from the local branch. Combined with `git push --force` (forbidden — see §"Forbidden ops"), it erases history from the remote too. Even without push, it disorients future code archaeology.
- `git revert` works correctly with subsequent commits that depend on the reverted commit's surface. `git reset` requires manual conflict resolution and forces every dependent commit to be re-applied.

If the reverted commit was a high-risk WI (cc-suite-recorded), the revert MUST itself be recorded per §6 below.

### 4. Overnight mode restriction

During autopilot / `/loop` / overnight `/goal` runs, Claude MUST NOT auto-revert committed work unless the lane authorization (the user's instruction that started the run) **explicitly allows auto-revert** for a named class of commits.

The user's typical autopilot invocation does NOT include auto-revert authorization. The default posture is therefore:

> If during overnight mode any rollback appears necessary, **STOP** and emit a stop-and-report block with the fields below. Do NOT run `git revert` yourself.

Stop-and-report fields (required):

1. **Bad commit hash** — the commit Claude believes should be reverted.
2. **Reason** — one-paragraph description of why the commit is wrong (wrong product direction / weakened security boundary / mixed scopes / etc.).
3. **Affected files** — `git show --name-only <hash>`-style list.
4. **cc-suite job IDs** — every `review-plan` / `audit` / `verify` / `audit-fix` jobId recorded for the commit (from its commit message's recording block).
5. **Recommended revert command** — verbatim `git revert <hash>` line the user can copy-paste.
6. **Tests needed after revert** — exact `npm --prefix <pkg> test` invocations the user should run after the revert lands.
7. **Whether downstream commits depend on the bad commit** — if any commit after the bad commit modifies the same files, name it explicitly. The user decides whether to revert downstream too.

Autopilot's `STOP-FOR-ROLLBACK` exit reason (new) carries this block.

### 5. Fix-forward vs rollback — when to prefer which

Prefer **fix-forward** when the issue is local and scoped:

- Single test failure inside the active WI.
- Audit finding limited to the WI's touched files.
- LOC over-limit on a single touched file.
- `cc-suite review-plan` Low-or-Medium finding that the WI can fix without changing the plan's recommended direction.
- Test assertion was wrong (fix the test, not the implementation).

Prefer **rollback** when:

- The commit pursues the **wrong product direction** (e.g., implements a feature the brief now says is post-v1, or contradicts a `READY` brief in a way no fix-forward edit can repair).
- The commit's **schema or model direction is wrong** (e.g., introduces a new entity that breaks the original-file-retention invariant; introduces a multi-file-per-document API when Option α was the recommended direction).
- The commit **weakens a security boundary** (e.g., loosens SSRF defense, broadens `allowedAddresses`, removes an `assertExternalHandlingAllowed` call).
- The commit **mixed scopes** (e.g., shipped contract changes AND persistence changes AND ADR amendments in one commit when the plan said docs-only). Even if each piece is correct, the mixed commit defeats reviewer focus and the audit trail.
- The commit's implementation **violates the project brief or a reviewed ADR** in a way no surgical edit can repair.
- An audit finds **broad unsafe behavior** affecting many call sites (not just the WI's touched files).

When fix-forward is technically possible but the commit is conceptually wrong, prefer rollback. Fix-forward exists to keep momentum on correct work; it is not a way to paper over wrong direction.

### 6. cc-suite compatibility — rollback recording

When a previously-committed high-risk WI is rolled back via `git revert`, the revert commit MUST record, per `.claude/rules/cc-suite.md` §"Required recording" extension below:

1. **Original commit hash** (the commit being reverted).
2. **Revert commit hash** (the commit that lands the `git revert`).
3. **Original cc-suite job IDs** — every `review-plan` / `audit` / `audit-fix` / `verify` jobId from the original commit's recording block.
4. **Reason** — one-paragraph description (matches §4's stop-and-report `reason`).
5. **Tests run after revert** — the test commands and their pass/fail outcomes.
6. **Whether the revert itself was audited** — typically NO for revert-only commits; YES if the revert touches multiple unrelated files and the user wants a sanity check.
7. **Deferred-audit backlog changes** — if the original commit had deferred findings in `dev-memo/deferred-audit-findings.md`, the revert MUST update those rows to `status: reverted` (referencing the revert commit hash).

This recording lives in the revert commit's message body, parallel to the §"Required recording" 11-field block on a normal cc-suite invocation. Without it, a `git log` reader cannot tell whether the rollback was deliberate, was reviewed, or affected the audit trail.

## Forbidden operations (require explicit per-invocation user authorization)

The following operations are NEVER taken automatically by Claude, in interactive OR autopilot mode, regardless of the lane authorization granted by the user's initial instruction:

- `git reset --hard` on ANY ref.
- `git reset --soft`/`--mixed` followed by recommit (use `git revert` instead).
- `git push --force` / `git push --force-with-lease`.
- Deleting branches (`git branch -D`, `git push origin --delete <branch>`).
- Broad `rm -rf` against tracked trees (single-file `rm` of a tracked file inside the active WI is allowed during fix-forward refactors, with the deletion enumerated in the commit message).
- Deleting **untracked** files that may be user drafts (`/tmp/...` outside the repo is fine; `<repo>/dev-memo/spark/*` or any path under the working tree is NOT).
- Deleting `~/.claude/plugins/**` plugin state (cc-suite state, codex state, etc.).
- Deleting cc-suite artifacts under `${CLAUDE_PLUGIN_DATA}/state/`.
- Wiping audit artifacts (job logs, dev-memo/deferred-audit-findings.md entries).
- `git checkout <other-branch>` from inside an in-flight WI (would discard uncommitted active-WI changes; user authorizes the branch switch explicitly).

Any of these requires the user to type the operation themselves, OR explicit per-invocation authorization in the same turn ("yes, run `git reset --hard origin/main`"). The lane authorization that starts a `/goal` or `/project-autopilot` run does NOT grant any of these by default.

## Two distinct 7-field blocks (NOT one — clarification per audit Dim-1 #1)

Two seven-field structures exist in this memo. They are NOT the same block; downstream cross-references must use the precise name:

- **STOP-FOR-ROLLBACK report (§4)** — emitted by autopilot when it stops because a previously-committed WI is wrong. Audience: the user, who decides whether to authorize the revert. Lives in chat / autopilot output, NOT in any commit. Fields: bad commit hash, reason, affected files, cc-suite job IDs, recommended revert command, tests after revert, downstream-dependency note.
- **Rollback recording (§6)** — appended to the revert commit's message body when the user authorizes the revert and Claude lands `git revert <hash>`. Audience: future `git log` readers. Lives in the revert commit message. Fields: original commit hash, revert commit hash, original cc-suite job IDs, reason, tests run after revert, whether the revert was audited, deferred-audit backlog changes.

Both blocks share several field labels (commit hash, reason, jobIds, tests). They are NOT interchangeable. Future docs should always say "the 7-field STOP-FOR-ROLLBACK report" OR "the 7-field rollback recording", never just "the 7-field block".

## How the rules wire this in

- **[[../.claude/rules/staging-hygiene.md]]** — §"Uncommitted rollback (active-WI scope only)" enforces §2 of this memo. Existing repair rules say "do not force-push to fix"; this memo extends to "and do not broad-reset; use targeted `git restore` only." (Audit Dim-4 #2: section title is exactly "Uncommitted rollback (active-WI scope only)".)
- **[[../.claude/rules/autonomy.md]]** — Hard-stop list extended with the §"Forbidden operations" entries from this memo. Pre-authorized actions list explicitly names "fix-forward", "uncommitted rollback (targeted)", "committed rollback via `git revert` in interactive mode". Auto-revert during overnight mode is NOT pre-authorized.
- **[[../.claude/rules/cc-suite.md]]** — Standalone new section §"Rollback recording" mirrors this memo's §6. The 11-field cc-suite recording structure parallels the 7-field rollback recording; they are distinct blocks for distinct events.
- **[[../.claude/skills/project-autopilot/SKILL.md]]** — §"Stop conditions" adds `STOP-FOR-ROLLBACK` per §4 of this memo. §"Stop output" extends with the 7-field STOP-FOR-ROLLBACK report (NOT the rollback recording). §"Forbidden inside the loop" explicitly enumerates auto-revert + broad working-tree restore so the loop-local list does not silently rely on the autonomy hard-stop reference (audit Dim-2 #1).

## Examples

### Example A — fix-forward (preferred)

WI-brief-doc-asset-impl audit returns 2 Medium findings: stale "behavior unchanged" comments in `inMemoryMatter.ts` and `inMemoryDocument.ts`. Action: edit the comments in the same WI; commit one fixup commit OR fold into the WI's single commit before initial commit. **NO rollback.**

### Example B — uncommitted rollback (rare, targeted)

During R-5 implementation, a refactor of `inMemoryRepo.ts` accidentally introduced a syntax error that broke `tsc`. The next edit cannot reach the broken line because the parser bails out. Action:

```
$ git restore docs/contracts/case-box-contract/src/inMemoryRepo.ts
# (single-file targeted restore; not `git restore .`)
# Re-attempt the refactor with smaller steps.
```

No other file is touched. The WI continues from the pre-broken state.

### Example C — committed rollback (overnight stop)

Autopilot lands a commit that adds a `CaseBoxFileAsset` entity. Subsequent reading shows brief `R-7` + plan `plan-brief-doc-reconcile.md` recommended Option α (extend `CaseBoxDocument`), NOT Option γ (new entity). The commit pursues the wrong product direction.

Action: autopilot stops with `STOP-FOR-ROLLBACK`:

```
STOP-FOR-ROLLBACK
- Bad commit hash: f00ba12
- Reason: introduces CaseBoxFileAsset entity, contradicting plan §4.2 Option α recommendation.
- Affected files: docs/contracts/case-box-contract/schemas/case-box-file-asset.schema.json (new),
  docs/contracts/case-box-contract/src/generated/case-box-file-asset.ts (new),
  docs/contracts/case-box-contract/src/index.ts (export added).
- cc-suite job IDs: review-plan-mpx... audit-mpx...
- Recommended revert: git revert f00ba12
- Tests needed after revert:
    npm --prefix docs/contracts/case-box-contract test
    npm --prefix services/case-box-persistence test
- Downstream commits depending on f00ba12: none.
```

User reviews; if user authorizes, user runs `git revert f00ba12` themselves OR explicitly grants Claude per-invocation authorization to run it.

### Example D — committed rollback (interactive)

User says "this commit broke the persistence absorption — please revert and re-implement." Action: Claude runs `git revert <hash>`, records the 7-field rollback recording in the revert commit message, then opens a new attempt at the WI. This is interactive authorization, not autopilot auto-revert.

## Stop condition

This memo is stale or superseded when:

- A future rules WI tightens / loosens the §2 uncommitted-rollback constraints (e.g., adds an additional allowed syntax).
- A future cc-suite-compatibility WI changes the recording shape; §6 fields would need to align.
- A new autopilot lane (e.g., a `--auto-revert` flag) is introduced; §4 would need to recognize it.

Until any of those occurs, this memo is the authoritative reference. The four rule files cross-reference it.
