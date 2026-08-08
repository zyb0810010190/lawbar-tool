# echo-sleuth — Continuity workflow rules

`echo-sleuth` is a memory + conversation-archaeology plugin (xiaolai/echo-sleuth, v0.4.0). It mines past Claude Code sessions for decisions, lessons, and stale assumptions, and helps promote those into durable project rules so future sessions don't repeat the same mistakes or contradict prior choices.

This rule codifies when and how to invoke echo-sleuth for **lane continuity**, **post-RCA knowledge promotion**, **pre-rule-change discovery**, and **periodic memory hygiene**. The rule itself is durable; the underlying plugin surfaces (slash commands + agents) may evolve.

## Enablement gate (READ FIRST — this rule is conditional)

echo-sleuth is an **optional** plugin that may be installed or removed at any time. Everything
below is written as if it were available, so an availability check governs the whole file. Check
before relying on any trigger — do not assume either state:

```bash
ls -d ~/.claude/plugins/cache/xiaolai/echo-sleuth 2>/dev/null && \
  python3 -c "import json;print(json.load(open('.claude/settings.json')).get('enabledPlugins'))"
```

- **While the plugin is absent, every REQUIRED trigger in §"When to invoke" is DORMANT.** A
  dormant trigger MUST NOT block a WI, MUST NOT be recorded as a skipped or failed gate, and
  MUST NOT be cited as review clearance. Do not invoke `/echo-sleuth:*` — the command does not
  resolve, and a failed invocation is not evidence of anything.
- **The underlying obligation survives the plugin.** echo-sleuth is one *mechanism* for
  continuity, not the continuity requirement itself. While it is dormant, satisfy the same
  intent from sources already in the repo: `git log`, the `dev-memo/` corpus (especially
  `dev-memo/run/log.md` and `dev-memo/deferred-audit-findings.md`), prior ADRs, and the rule
  files themselves. Cite what was actually consulted.
- **Re-arming is automatic.** When the plugin is installed and enabled, the triggers below
  become REQUIRED again with no edit to this file. Confirm availability before claiming a
  trigger ran.

This gate exists because a rule that mandates an uninvokable command is unenforceable: it
cannot be satisfied, so it silently converts every WI into a contract violation. Stating the
condition is what keeps the rule honest.

**Prior art (same shape, already tracked policy):** `BATCH-AUDIT.md` §"Study packet" already
carves out `/echo-sleuth:extract` as un-runnable inside an unattended batch and defers the
obligation to a later MEMORY WI rather than dropping it. This gate generalizes that pattern:
mechanism unavailable → trigger does not fire → obligation deferred, never discarded.

## Available surfaces (as of plugin v0.4.0)

Slash commands (user-typed or assistant-driven):
- `/echo-sleuth:recap` — short summary of the most recent conversations / sessions.
- `/echo-sleuth:recall <query>` — recall specific decisions, rationales, or named artifacts from past sessions.
- `/echo-sleuth:lessons` — surfaces past mistakes and corrections, suitable for pre-rule-change review.
- `/echo-sleuth:extract` — extract durable knowledge from a recent session into project memory / rules.
- `/echo-sleuth:timeline` — chronological reconstruction of decisions on a topic.
- `/echo-sleuth:audit` — audit memory for staleness / contradiction / drift.
- `/echo-sleuth:dashboard` — overview of memory health.
- `/echo-sleuth:prune` — remove stale or contradicted memories.

Agents (assistant-driven via the Agent tool):
- `echo-sleuth:recall` — same shape as the slash command but invocable as an agent.
- `echo-sleuth:analyze` — deeper conversation analysis on a specific question.
- `echo-sleuth:memory-auditor` — focused memory-staleness pass.
- `echo-sleuth:file-historian` — history of a specific file across conversations.
- `echo-sleuth:schema-scout` — recover prior schema decisions.

The rule below references these by capability, not exact command name — if the plugin renames a surface, this rule still applies.

## When to invoke (REQUIRED triggers)

### A. Lane-start recap (before any major lane)

Before authorizing or executing any of the following:
- A new Phase-B sub-WI plan or impl (B1+).
- A new umbrella plan or umbrella-plan revision.
- A new ADR under `docs/adr/`.
- A new RCA lane.
- A `/project-autopilot` or `/loop` start.
- A whole-project intake via `/project-brief`.

**Invoke `/echo-sleuth:recap`** (or the recall agent) to surface:
- The most recent commits' lane scope.
- Unresolved deferred-audit-finding rows that the new lane could naturally close.
- Any open `STOP-AND-ASK` items from prior lanes.
- The most recent `CCSUITE-PATH1-RCA-01`-class operational lessons that affect tool choice.

Cite the recap in the new lane's pre-flight section ("Existing context used" / "Predecessors") so the lane carries its provenance.

### B. Post-RCA memory extraction (REQUIRED)

After any RCA lane completes (e.g. `CCSUITE-PATH1-RCA-01`):

**Invoke `/echo-sleuth:extract`** (or the appropriate skill) within the SAME RCA lane, BEFORE closing the lane. The extract pass MUST produce one or more durable artifacts:

1. **Update the relevant project rule file** (e.g. `.claude/rules/cc-suite.md`, `.claude/rules/security-boundary.md`, `.claude/rules/loc-guardian.md`, etc.). The RCA's evidence becomes a permanent §"Anti-pattern" / §"Recovery procedure" section.
2. **Cross-reference the RCA dev-memo** from the rule file so the evidence remains discoverable.
3. **Add a `dev-memo/` follow-up only if** the lesson is too narrow to warrant a rule change. Default is: promote to rule.

Skipping this step means the lesson stays buried in the RCA dev-memo and the failure recurs in the next lane.

### C. Pre-rule-change discovery (BEFORE editing any `.claude/rules/*.md`)

Before editing any rule file:

**Invoke `/echo-sleuth:lessons`** or `/echo-sleuth:recall <rule-name>` to surface:
- Prior decisions about the same rule scope.
- Cases where this rule was bypassed and the consequence.
- Adjacent rules that may already cover the proposed change.

If a prior decision contradicts the proposed change, surface the conflict to the user BEFORE editing. The new edit either supersedes the prior decision (with explicit recording of WHY) or matches it.

This step prevents accidental rule regression — e.g., re-introducing an anti-pattern that a prior RCA already forbade.

### D. Periodic memory hygiene (between lanes)

At natural lane boundaries (between major Phase-B sub-WIs, after umbrella revisions, after major refactors):

**Invoke `/echo-sleuth:audit` + `/echo-sleuth:dashboard`** to detect:
- Stale memories that reference removed files / superseded ADRs.
- Memories that contradict each other across sessions.
- Memories whose load-bearing facts (commit hashes, jobIds, file paths) are no longer present in the repo.

If `/echo-sleuth:audit` flags staleness:
- Resolve by updating the rule / memory to current state.
- OR invoke `/echo-sleuth:prune` to remove the stale entry (recorded in commit message).
- NEVER leave a stale memory in place hoping it self-corrects. Stale memory misleads future Claude sessions.

This is a maintenance pass, not a gate — failure to detect staleness does not block a lane, but unresolved staleness flagged by audit DOES block the next major rule change.

## Hard prohibitions

echo-sleuth MUST NOT:

- Edit product source (`services/**/src/`, `docs/contracts/**/src/`, `docs/contracts/**/schemas/`).
- Stage, commit, or push.
- Bypass `.claude/rules/cc-suite.md` (cc-suite remains the authoritative review broker; echo-sleuth is a memory layer, NOT a review layer).
- Auto-prune memories that are flagged "stale" without user confirmation when the memory has not been demonstrably superseded in the current repo state.
- Run inside `/loop` or `/project-autopilot` autonomously to mutate rule files. The continuity workflow's promotion step (B above) is interactive: the assistant proposes, the user authorizes.

## Cross-references

- `.claude/rules/cc-suite.md` §"Background-invocation discipline" — the canonical example of a rule produced by an echo-sleuth-style extract pass (CCSUITE-PATH1-RCA-01 → permanent anti-pattern + recovery section).
- `.claude/rules/autonomy.md` — hard-stop list; echo-sleuth is bound by the same list (no push, no destructive ops).
- `.claude/rules/project-brief.md` — the whole-project intake; lane-start recap is the input to the brief's "Sources consulted" section.
- `.claude/rules/spark.md` — per-feature brainstorming; spark Step 1 grounding may reuse echo-sleuth recall to find prior decisions on the same feature.
- `.claude/rules/staging-hygiene.md` — echo-sleuth's prune step must follow explicit-staging discipline (no `git add .`).
- `dev-memo/ccsuite-path1-rca-01.md` (CCSUITE-PATH1-RCA-01; commit `d3e1cbc`) — first project use of the post-RCA extract workflow this rule codifies.

## Durable facts (carried forward as load-bearing context)

These facts MUST survive across sessions. If echo-sleuth audit flags any as stale, REVERIFY against the repo before pruning:

1. **Path 1 native `--background` is safe** for cc-suite review-plan / audit / verify per CCSUITE-PATH1-RCA-01 (commit `d3e1cbc`).
2. **Bash-tool `run_in_background: true` wrapping cc-suite/Codex/runner is UNSAFE** — produces HARNESS_REAP failure class; orphans `running` jobs. Forbidden per `.claude/rules/cc-suite.md` §"Background-invocation discipline".
3. **B6 implementation verified the Path 1 native `--background` pattern in production use** via audit job `audit-mph4cun6-aav6q2` (commit `667bb9c`).
4. **B7 implementation MUST account for the B6 deferred `impl-parity.test.mjs` split** (B6 deferred-finding D4#1; 773 LOC → 7 per-entity files; closes when B7 ships per `dev-memo/plan-case-box-persistence-B7-docket.md` §1.7).

When echo-sleuth recalls / extracts on these topics, surface these four facts verbatim.
