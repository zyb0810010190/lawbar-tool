# NIGHT-RUN-00 — Reusable overnight-lane policy

**Status**: tracked rule companion.
**Date**: 2026-05-22.
**Author**: Claude Code at user's direction.
**Applies to**: every overnight `/loop`, every `/project-autopilot` run, every long `/goal` session, every future "lane authorization" the user grants.

## Why this exists

`dev-memo/rollback-00.md` (ROLLBACK-00) covers what to do when a single commit is wrong. NIGHT-RUN-00 covers the **framing of an entire overnight run**: which WIs the lane permits, which files it permits Claude to touch, what reports it must produce, and when it must stop. Without this framing, every overnight invocation re-derives boundaries from chat context, the user has no template to copy when granting authorization, and Claude has no canonical reference for what "lane-scoped" actually means.

This memo is the authoritative policy. `.claude/rules/autonomy.md` and `.claude/skills/project-autopilot/SKILL.md` reference it and add the enforcement hooks.

## Core invariant

**Overnight mode is lane-scoped, never project-wide.** No user instruction like "keep going" or "make progress" grants project-wide authorization. Every overnight run requires an explicit lane authorization (the user's instruction that started the run) which names the lane and lists everything below.

If the lane authorization is unclear or omits a required field, Claude STOPS at the first decision point and asks the user to fill the missing field. Autopilot does NOT infer "the user probably meant ..." for an overnight run.

## §1 Lane authorization template (REUSABLE)

When the user wants to authorize an overnight lane, they (or Claude on their behalf, then user-approved before the run begins) write a block like the one below and paste it into the `/project-autopilot` invocation or the lane's pinned memo. Every field is REQUIRED.

```
# Overnight lane authorization — <LANE-NAME>

**Lane name**: <stable identifier, e.g. ABI-LANE / SYNC-LANE / CASE-BOX-PHASE-B-LANE>
**Authorized at**: <YYYY-MM-DD HH:MM TZ>
**Authorized for**: <single run | named time window | until lane-complete>
**Author**: <user>

## Scope

- **Allowed WIs / phases**: <explicit list, e.g. WI-ABI-01-impl only / case-box Phase B sub-WIs B1..B5 / WI-brief-doc-text-extract-policy ADR draft>.
- **Allowed files / packages**: <explicit list of paths the lane is allowed to author or modify; e.g. services/ocr-persistence/**, dev-memo/plan-abi-*.md, AGENTS.md>.
- **Forbidden files / packages within this lane**: <files INSIDE the broad scope that this lane must NOT touch; e.g. services/ocr-persistence/src/** for an ABI-lane that should only touch package.json + scripts/>.
- **Hard stops** (in addition to the global hard-stop list in .claude/rules/autonomy.md): <lane-specific stops, e.g. "stop if package-lock.json delta exceeds 200 lines">.

## Commit policy

- **Plan commits allowed?**: yes | no
- **Implementation commits allowed?**: yes | no
- **Rollback of committed work allowed?**: NO (default; auto-revert is forbidden per ROLLBACK-00 §4) | yes-named-class-only (specify which class)
- **Per-commit `commit-gate` discipline**: ALWAYS yes (no exceptions).

## Quality gates

- **Test matrix**: <enumerate test commands the lane requires to pass; e.g. npm --prefix services/ocr-persistence test, npm --prefix services/ocr-worker test>.
- **cc-suite review-plan required for**: <list of WI categories within the lane; reference .claude/rules/cc-suite.md §"High-risk WIs" for the canonical category set>.
- **cc-suite audit required for**: <usually "every commit in this lane"; reference .claude/rules/cc-suite.md §"Required recording">.
- **cc-suite verify required when**: <usually "when audit produces Critical/High/Medium findings that the WI fixed; verify confirms closure">.
- **loc-guardian requirements**: <usually "0 over fail per .claude/rules/loc-guardian.md; warning-zone tracking only" + lane-specific exemptions>.
- **Ajv strictRequired warnings**: <usually "0 expected">.

## Stop / report conditions

- **Stop if**: <enumerate lane-specific stop conditions beyond the global stop conditions in .claude/skills/project-autopilot/SKILL.md §"Stop conditions">.
- **Per-phase report format**: per `dev-memo/night-run-00.md` §6 (commit hash + files changed + tests + loc-guardian + cc-suite jobIds + fallbacks + deferred backlog + next phase).
- **STOP-FOR-ROLLBACK behavior**: emit 7-field report per `dev-memo/rollback-00.md` §4; do NOT auto-revert unless the "Rollback of committed work" field above explicitly authorizes it.

## Operational

- **Branch**: <expected branch name, usually `main` for this repo>.
- **Push policy**: NO (always per .claude/rules/autonomy.md hard-stop).
- **Plugin state**: untouched (no deletions under ~/.claude/plugins/**).
- **cc-suite artifacts**: untouched (no deletions under ${CLAUDE_PLUGIN_DATA}/state/).
- **Audit artifacts**: untouched (no wiping of dev-memo/deferred-audit-findings.md entries).

## Acknowledgments

- I (the user) acknowledge the global hard-stop list in .claude/rules/autonomy.md still applies; nothing in this lane authorization overrides those hard stops.
- I acknowledge ROLLBACK-00 (`dev-memo/rollback-00.md`) §4 still applies: auto-revert during overnight mode is forbidden unless explicitly authorized above.
```

Concrete examples:
- A future ABI-lane authorization (post WI-ABI-00 plan) might name `ABI-LANE`, allow `services/ocr-persistence/**` + AGENTS.md, forbid `services/ocr-persistence/src/**`, require both `ocr-persistence test` AND `ocr-worker test` in the test matrix, and disallow rollback.
- A future SQLite-Phase-B lane might name `CASE-BOX-PHASE-B-LANE`, allow `services/case-box-persistence/**` + the case-box-contract package, forbid OCR packages, and require the existing in-memory conformance suite stays green.

## §2 Default allowed actions (every lane inherits)

Once a lane authorization block is present and valid, the following are ALWAYS allowed inside the lane's scope without additional lane-specific grants. They are the pre-authorized actions in `.claude/rules/autonomy.md` §"Pre-authorized actions" carried into the overnight context, filtered by the lane's allowed-files list:

1. Draft the next WI plan for the lane (including the `## Review packet (compact)` section if high-risk).
2. Run `cc-suite:review-plan` via Path 1 broker (or the documented retry / fallback paths).
3. Fix plan-review findings inside the active WI scope (fix-forward per `dev-memo/rollback-00.md` §1).
4. Implement the next bounded WI inside the lane's scope.
5. Run the lane's documented test matrix.
6. Run `loc-guardian:scan` and stay within thresholds.
7. Run `cc-suite:audit` (or `cc-suite:audit-fix`).
8. Fix audit findings (Critical/High/Medium) inside the active WI scope.
9. Run `cc-suite:verify` with the audit artifact when there are findings to verify.
10. Update `dev-memo/deferred-audit-findings.md` with new deferred Lows or close existing rows.
11. Commit scoped changes via `commit-gate` with explicit staging.
12. Run `branch-clean` between phases.
13. Select the next phase inside the authorized lane per the autopilot loop's selection logic.

## §3 Default prohibitions (two classes; only §3.B is lane-grantable)

Prohibitions split into two classes. **A lane authorization can NEVER grant §3.A items; it CAN grant §3.B items when the user explicitly types the grant.**

### §3.A Absolute global hard stops (NEVER lane-overridable)

The following are FORBIDDEN in EVERY mode, including overnight mode. **No lane authorization can grant them.** They are the irreducible safety floor and are mirrored in `.claude/rules/autonomy.md` §"Hard-stop list":

- `git push` (any form, including `--force` / `--force-with-lease`).
- Deploy, release, publication, "go-live" announcement.
- Touching real secrets / credentials / `.env` / billing / external accounts.
- Branch deletion (local OR remote).
- `git reset --hard` on any ref.
- `git reset --soft`/`--mixed` followed by re-commit (use `git revert`).
- Broad `rm -rf` against tracked trees.
- Deleting untracked files inside the working tree that may be user drafts.
- Deleting `~/.claude/plugins/**` plugin state.
- Deleting cc-suite artifacts under `${CLAUDE_PLUGIN_DATA}/state/`.
- Wiping audit artifacts (job logs, `dev-memo/deferred-audit-findings.md` entries).
- Production data operations on real data.
- Irreversible migration on real data.
- `git checkout <other-branch>` from inside an in-flight WI.
- `git clean` under any flag combination.
- Broad working-tree restore (`git restore .`, `git checkout -- .`).
- Final go-live approval — sub-WI completion never implies go-live.

Triggering any of these stops the lane unconditionally, irrespective of what the lane authorization says.

### §3.B Lane-grantable exceptions (FORBIDDEN by default; the lane MAY explicitly grant)

The following are forbidden by default but MAY be authorized by a lane that explicitly names them in the relevant authorization field. The user must type the authorization themselves; "keep going" is not a grant:

- **Public API / gateway / wire-format / schema / CLI breaking changes** — only when a named WI explicitly authorizes the break.
- **UI / Electron / Tauri / desktop-shell scaffolding** — only when the lane explicitly authorizes it (e.g. a future CLIENT-01 lane).
- **Auth provider choice / cloud vendor choice / sync surface / LLM enablement / external document exposure** — only when the lane explicitly authorizes it for a named WI (e.g. a future SYNC-01 lane).
- **Committed rollback** (`git revert <hash>`) — only when the lane's "Rollback of committed work allowed?" field explicitly says "yes-named-class-only" and the commit is in that class. Per `dev-memo/rollback-00.md` §3, `git reset --hard` is NEVER the rollback mechanism (that's a §3.A absolute hard stop above).
- **New runtime dependencies** — only when the lane explicitly authorizes a named dep.

If any of these is required for the lane to progress and is NOT explicitly authorized, autopilot STOPS with a clear stop reason and emits the report (§6).

## §4 Fix-forward default

For every category of finding within the lane, **fix-forward** is the default action (per `dev-memo/rollback-00.md` §1):

- `cc-suite:review-plan` findings (Critical/High/Medium per `.claude/rules/cc-suite.md` §"Audit remediation policy").
- `cc-suite:audit` findings (same).
- `cc-suite:verify` residuals (audit findings still open after a fix pass).
- Test failures (per-package `npm test` exit non-zero).
- `loc-guardian:scan` over-limit reports inside the lane's touched files.

Fix-forward applies whether the WI is plan-only, contract-only, persistence, security, or docs. Each fix is another edit + another test/audit run inside the same WI. Reverting the commit is the LAST resort, governed by §5.

## §5 Rollback is a hard stop by default

Per `dev-memo/rollback-00.md` §4: during overnight mode, Claude MUST NOT auto-revert committed work UNLESS the lane authorization's "Rollback of committed work allowed?" field explicitly says "yes-named-class-only" and the bad commit belongs to that class.

If rollback appears necessary outside the named class, autopilot stops with `STOP-FOR-ROLLBACK` and emits the 7-field report per [[../.claude/skills/project-autopilot/SKILL.md]] §"Stop output" → §"STOP-FOR-ROLLBACK report (7 fields)". The user reviews; the user (NOT autopilot) authorizes the revert via the next interactive turn or by explicitly granting per-invocation authorization in the same turn.

The committed-rollback mechanism, when authorized, is ALWAYS `git revert <hash>` per `dev-memo/rollback-00.md` §3, NEVER `git reset --hard`, NEVER force-push.

## §6 Reporting after each phase commit

For every commit in the lane, autopilot emits a per-phase report block. The block lives in the autopilot output (chat / log) AND duplicates the same fields into the commit message body (matching the existing R-5 / R-6 / ROLLBACK-00 commit-message style).

Required fields:

1. **Phase / WI name**: `WI-<lane>-<phase>` identifier from the plan.
2. **Commit hash**: the hash autopilot just created.
3. **Files changed**: explicit list (matches `git diff --name-only HEAD~1`).
4. **Tests run + outcomes**: `npm --prefix <pkg> test` invocations + pass/fail counts.
5. **loc-guardian verdict**: pure-LOC scan result; warning-zone files; over-fail files (should be 0).
6. **cc-suite job IDs**: every `review-plan` / `audit` / `audit-fix` / `verify` jobId for this commit.
7. **Fallback usage**: if any Path 1 attempt failed and Path 2/3/4 was used, name which fallback fired and why.
8. **Deferred backlog changes**: any new rows in `dev-memo/deferred-audit-findings.md`; any rows closed.
9. **Next phase selected**: the WI autopilot will attempt next inside this lane (or "lane complete" / a stop reason).

Reports are concise. A typical per-phase report is ~15 lines.

## §7 Stop conditions (lane-aware)

Autopilot STOPS the lane (no further commits, emits the per-phase report's "Next phase selected" as a stop reason) when ANY of the following 9 conditions hold. The user's policy enumerated 7 high-level categories; the list below expands them by separating the test/cc-suite/loc-guardian fix-forward-exhausted entries (each is a distinct failure mode in practice). Auditors and reviewers may count either way:

1. **Lane complete**: every authorized WI / phase has committed green; no further work matches the lane's "Allowed WIs / phases" field.
2. **Next phase exits the lane**: the next reasonable WI is outside the lane's "Allowed WIs / phases" or "Allowed files / packages". Autopilot does NOT widen the lane unilaterally.
3. **Global hard-stop**: any item from `.claude/rules/autonomy.md` §"Hard-stop list" (or §3.A of this memo) is triggered.
4. **Test failure that cannot be fixed inside the lane**: a test fails AND fix-forward inside the lane's allowed file set does not repair it (the fix would require touching forbidden files OR exit the lane scope).
5. **cc-suite failure beyond retry / fallback**: `review-plan` attempt sequence per `.claude/rules/cc-suite.md` §"Retry policy" exhausted without READY; `audit` returns Critical/High that cannot close inside scope; `verify` cannot consume the audit artifact.
6. **loc-guardian over-fail that cannot be fixed inside the lane**: a hand-written source or test file exceeds the fail threshold and cannot be split inside the lane's allowed file set without scope creep.
7. **STOP-FOR-ROLLBACK**: a committed WI is wrong in a way fix-forward cannot repair AND the lane's "Rollback of committed work" field does NOT explicitly authorize auto-revert. Emit the 7-field stop-and-report per `dev-memo/rollback-00.md` §4.
8. **Lane-specific stop**: any condition listed in the lane authorization's "Stop if" field.
9. **User interrupts**: explicit user message during the run.

## §8 Worked example — minimal lane authorization for ABI-LANE

Illustrative ONLY. The actual ABI lane authorization, when the user grants it, may differ. This shows the template populated.

```
# Overnight lane authorization — ABI-LANE

**Lane name**: ABI-LANE
**Authorized at**: 2026-XX-YY HH:MM CST
**Authorized for**: single run, until WI-ABI-01-impl commits green or a stop fires
**Author**: zyb_lawyer@hotmail.com

## Scope

- **Allowed WIs / phases**: WI-ABI-01-impl ONLY (per dev-memo/plan-abi-00-better-sqlite3.md §3).
- **Allowed files / packages**: services/ocr-persistence/package.json, services/ocr-persistence/scripts/abi-smoke.mjs (NEW), AGENTS.md, services/ocr-persistence/package-lock.json (mechanical).
- **Forbidden files / packages within this lane**: services/ocr-persistence/src/**, services/ocr-persistence/tests/**, services/case-box-persistence/**, docs/contracts/**, AGENTS.md sections OTHER than the Node-range sentence.
- **Hard stops**: package-lock.json delta exceeds 300 added lines (indicates an unintended cascade); OCR worker test fails with a NEW error class (NOT the documented ABI baseline).

## Commit policy

- **Plan commits allowed?**: yes (only the impl WI plan, if it needs revision pre-commit).
- **Implementation commits allowed?**: yes — exactly ONE commit per the plan's §3.3 acceptance criteria.
- **Rollback of committed work allowed?**: NO.
- **Per-commit `commit-gate` discipline**: yes.

## Quality gates

- **Test matrix**: npm --prefix services/ocr-persistence test; npm --prefix services/ocr-worker test; npm --prefix services/case-box-persistence test; npm --prefix docs/contracts test; npm --prefix docs/contracts/case-box-contract test.
- **cc-suite review-plan required for**: WI-ABI-01-impl (already READY in this WI's predecessor plan).
- **cc-suite audit required for**: the single impl commit.
- **cc-suite verify required when**: audit produces Critical/High/Medium.
- **loc-guardian requirements**: 0 over fail; abi-smoke.mjs under 20 LOC.
- **Ajv strictRequired warnings**: 0 expected.

## Stop / report conditions

- **Stop if**: §"Hard stops" above triggered; ALL test commands not green after the single commit; cc-suite audit emits Critical/High the WI cannot fix in scope.
- **Per-phase report format**: per night-run-00.md §6.
- **STOP-FOR-ROLLBACK behavior**: emit 7-field report; do NOT auto-revert.

## Operational

- **Branch**: main.
- **Push policy**: NO.
- **Plugin state**: untouched.
- **cc-suite artifacts**: untouched.
- **Audit artifacts**: untouched.

## Acknowledgments

- Global hard-stop list still applies.
- ROLLBACK-00 §4 still applies.
```

## §9 How the rules wire this in

- **[[../.claude/rules/autonomy.md]]** — adds §"Overnight lane policy" cross-referencing this memo. Pre-authorized actions list explicitly notes that overnight mode applies the lane-scope filter on top of the existing list.
- **[[../.claude/skills/project-autopilot/SKILL.md]]** — §"When to use" gains an "if invoked in overnight mode, require a lane authorization block" sentence. §"Loop body" adds a Step 0 to validate the lane authorization before entering the loop. §"Stop conditions" cross-references §7 above for the lane-aware stops. §"Stop output" adds the per-phase report format from §6 above.
- **[[../.claude/rules/cc-suite.md]]** — Cross-references section gains a NIGHT-RUN-00 entry pointing here.
- **[[../.claude/rules/staging-hygiene.md]]** — Related section gains a NIGHT-RUN-00 entry; no body text change (the explicit-staging discipline already applies in every mode).
- **`dev-memo/rollback-00.md`** (ROLLBACK-00) is **complementary**: ROLLBACK-00 governs single-commit recovery, NIGHT-RUN-00 governs whole-lane authorization. Both are referenced together. (Note: ROLLBACK-00 lives under `dev-memo/`, not `.claude/rules/`, because it is a policy memo rather than an enforcement rule; the rule files reference it.)

## §10 Stop condition for THIS memo

This memo is stale or superseded when:

- A future rules WI changes the lane authorization template fields (adds / removes / renames any required field). §1 template is the canonical shape; the wiring rules and reporting fields must match.
- A future autopilot redesign replaces the "lane" abstraction with a different mechanism. Until that lands, this memo is the authoritative reference.
- A future cc-suite policy change reshapes the cc-suite recording fields (currently 11) or the rollback recording fields (currently 7). The lane authorization's "cc-suite" + "Stop/report" fields must align.
- The user explicitly retires NIGHT-RUN-00 in a successor WI.
