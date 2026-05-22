# spark — Brainstorming workflow rules

`spark` is a project-local, on-demand brainstorming + spec writer. It is non-authoritative: every spark output is INPUT to the existing cc-suite review pipeline, never a replacement for it.

## Attribution and scope

- Based on the brainstorming skill from [obra/superpowers](https://github.com/obra/superpowers).
- License: MIT, per upstream repository.
- Adapted for this repo as a standalone component. Full Superpowers workflow is **not installed or enabled** for this project — the `enabledPlugins` list in `.claude/settings.json` deliberately omits it.
- `cc-suite` remains the authoritative broker per [[cc-suite]]. spark feeds cc-suite, never overrides it.

## Hard prohibitions

spark MUST NOT:

- Write product code, edit `services/**/src/`, edit `docs/contracts/**/src/`, edit `docs/contracts/**/schemas/`, edit test files outside `dev-memo/spark/`.
- Stage or commit any product file. The only file spark produces is `dev-memo/spark/YYYY-MM-DD-<topic>-spark.md`.
- Invoke cc-suite commands (review-plan / audit / verify / audit-fix) on its own output. The user, or a follow-up turn, runs cc-suite AFTER promoting the spark spec.
- Run inside `/loop`, `/project-autopilot`, autonomous overnight runs, or any unattended loop unless the user explicitly selected `/spark` as the current step.
- Bypass [[loc-guardian]] or any hard-stop in [[autonomy]].
- Replace the existing project-autopilot, cc-suite, security-wi-loop, client-architecture-reconcile, or project-brief skills.
- Ask whole-project requirements questions. spark is for ONE feature / ONE idea. Whole-product intake is `/project-brief`'s scope — see [[project-brief]]. If a spark turn finds itself drafting whole-product direction, it MUST stop and recommend `/project-brief`.

## project-brief consultation

When `docs/product/project-requirements-brief.md` exists:

- spark's Step 1 grounding MUST read it.
- spark's §2 "Existing context used" MUST cite the brief AND its current `status:` (`DRAFT-PENDING-REVIEW` / `AMENDMENT-PENDING-REVIEW` / `READY`).
- spark MUST NOT ask any question the brief already answers. The brief's answer becomes the pre-filled default; spark records it in §3 "Assumptions" as "derived from `docs/product/project-requirements-brief.md` §N".
- A `DRAFT-PENDING-REVIEW` or `AMENDMENT-PENDING-REVIEW` brief is consulted but its answers are flagged "non-authoritative; subject to cc-suite review".
- A `READY` brief's answers are authoritative product direction (see [[project-brief]] §"Authority hierarchy"). spark ideas that contradict a `READY` brief land in §8 "Hard stops" of the spark spec, and §10 prepends the HARD STOP block.

When the brief does NOT exist:

- spark proceeds as before, but if the user's idea reads like whole-project direction (vision / target users / primary platform / business model / etc.), spark stops and recommends running `/project-brief` first.

## Spark spec template (every section required)

Every file at `dev-memo/spark/YYYY-MM-DD-<topic>-spark.md` MUST contain these 12 sections in order:

```markdown
# Spark — <topic title>

**Status**: spark spec (non-authoritative). Not implementation-authorizing.
**Date**: YYYY-MM-DD.
**Author**: Claude Code (spark skill).

## 1. Problem statement

One paragraph: what is the user trying to accomplish, and what is broken / missing / unclear today?

## 2. Existing context used

Bullet list of files / ADRs / plans / dev-memos / commits that spark READ before drafting. Cite paths.
- `AGENTS.md` §...
- `dev-memo/plan-case-box-persistence-00.md` §10.2
- `docs/adr/case-box-step-0-boundary.md` §4
- `git log --oneline -10` showed ...

## 3. Assumptions

Bullets. Each assumption is either:
- "Inferred from repo state: <citation>" — derivable from the context above.
- "Safest local-first assumption per `.claude/rules/client-local-first.md`" — when the repo is silent.
- "User-stated in this turn" — when the user supplied a fact.

If a load-bearing assumption is genuinely missing AND not safely defaultable, §3 names it explicitly and §6 declines to recommend until the user resolves it.

## 4. Non-goals

Bullets. What is intentionally EXCLUDED. Use the parent plan / ADR exclusion lists as the starting point.

## 5. Options considered

Brief: 2-3 directions if alternatives materially change the decision. ONE if not. For each:
- Name + 1-sentence summary.
- Why considered.
- Why kept or dropped.

## 6. Recommended direction

ONE recommendation. Crisp. References the option name from §5. Notes the file paths / packages / boundaries that would be touched.

## 7. Risks

Severity-marked bullets. Critical / High / Medium / Low. For each:
- Risk.
- Likelihood × impact.
- Mitigation candidate (or "no mitigation available; surface as gate").

## 8. Hard stops

Bullets. Each hard-stop from [[autonomy]] that this idea would trigger if implemented as recommended. If none, write "None — within the autonomous lane." Common triggers:
- SQLite / better-sqlite3 / native-module → requires ABI remediation WI.
- New runtime dependency.
- Public API / schema / CLI breaking change.
- External network / cloud / sync / SaaS / auth-provider choice.
- LLM execution.
- Deploy / push / release.

## 9. Required downstream artifact

One of:
- Promote to `dev-memo/plan-<topic>.md` (WI plan). Triggers cc-suite review-plan path.
- Promote to `docs/adr/<topic>.md` (architecture decision record). Triggers cc-suite review-plan path.
- Promote to `dev-memo/<topic>.md` (dev-memo). May skip cc-suite if low-risk and doc-only.
- None — pure thinking-out-loud note. §10 uses the short form.

## 10. Required cc-suite review

Implementation-shaped specs (most) use this verbatim block:

> This idea is not authorized for implementation until:
> 1. It is promoted into a tracked WI plan / ADR / dev-memo.
> 2. The plan includes a `## Review packet (compact)` section if high-risk.
> 3. cc-suite review-plan returns READY or only Low-risk clarifications remain.
> 4. Any Critical/High findings are fixed and re-reviewed.
> 5. Any hard-stop items are explicitly authorized by the user.

Pure brainstorming notes use the short form:

> Not implementation-authorizing; no cc-suite review required until promoted to a WI.

If §8 listed any hard-stop, this section prepends:

> **HARD STOP triggered.** This idea is NOT authorized for implementation. User must explicitly authorize each hard-stop item before any cc-suite review-plan is invoked.

## 11. Next bounded WI suggestion

One bounded WI the user could open IF they want to proceed. Format: "WI-spark-<short>: <one-sentence scope>." Mention expected file paths and an LOC budget hint if relevant.

## 12. Stop condition

How the user (or a follow-up turn) knows this spark spec is "done" or "outdated":
- "Promoted to <path>; spec retired."
- "Superseded by <path>."
- "Stale after <event>."
```

## Behavioral rules during a spark turn

1. **Repo context first.** Read `AGENTS.md`, relevant ADRs/plans/dev-memos, and `git log` BEFORE asking the user anything.
2. **At most one question.** If a load-bearing fact is genuinely missing and not safely defaultable, ask ONE targeted question with a small option set. Otherwise default to the safest local-first assumption and record it in §3.
3. **One recommendation.** §6 names ONE direction. §5 lists alternatives only when they materially change the decision.
4. **No code edits.** spark may read `services/**` and `docs/contracts/**` for context. spark MUST NOT edit them.
5. **One output file.** Spec goes to `dev-memo/spark/YYYY-MM-DD-<topic>-spark.md`. Create the directory if missing.
6. **Stop after writing.** Do NOT invoke cc-suite, do NOT promote, do NOT implement. Report the path and the next bounded action; stop.
7. **No autopilot participation.** If the user invokes spark inside an autopilot loop, spark refuses unless the user explicitly selected `/spark` as the current step.

## Commit policy for spark outputs

spark spec files (`dev-memo/spark/*.md`) are workflow / documentation artifacts. They MAY be committed alone via explicit staging per [[staging-hygiene]]. They MUST NOT be committed in the same commit as product code. Commit message convention: `docs: spark spec — <topic>`.

The skill itself does NOT commit. The user (or a follow-up turn) commits when ready.

## Conflict with existing skills

If a user request could be served by both `/spark` and another existing skill (e.g., `/cc-suite:review-plan`, `/project-autopilot`), prefer the EXISTING skill. spark is for ideas that don't yet have a plan; cc-suite is for plans that already exist.

## References

- [[cc-suite]] — authoritative review broker.
- [[autonomy]] — hard-stop list.
- [[client-local-first]] — v1 client posture.
- [[staging-hygiene]] — commit discipline.
- [[loc-guardian]] — LOC policy.
- `.claude/skills/spark/SKILL.md` — skill body.
- `.claude/commands/spark.md` — slash-command surface.
- `dev-memo/tooling-spark-00.md` — design rationale + divergence from upstream.
