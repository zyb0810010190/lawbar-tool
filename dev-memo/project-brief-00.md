# PROJECT-BRIEF-00 — Project requirements intake workflow

**Status**: design rationale + scope cut.
**Date**: 2026-05-21.
**Author**: Claude Code at user's direction (PROJECT-BRIEF-00 work item).

## Problem

Whole-product direction is fragmented across many sources in this repo:

- `docs/product/product-target-architecture.md` (post-Phase-0 product summary).
- `dev-memo/plan-client-00.md` (client-surface reconciliation source).
- `.claude/rules/client-local-first.md` (v1 client posture).
- `docs/adr/case-box-step-*.md` (case-box subsystem decisions).
- `docs/adr/client-application-surface.md`, `docs/adr/sync-bridge-architecture.md`, etc.
- `dev-memo/superseded/case-box-plan.md` (historical).

Every new spark spec and every new WI plan implicitly re-derives "what is the product" from those sources, and the assistant frequently re-asks the user whole-project questions that were already answered. The user wants to state the full product requirements ONCE — vision, target users, primary platform, Mac app, WeChat companion, local-first / sync expectations, legal workflow, OCR, documents, deadlines, privilege/audit, AI boundaries, multi-user, export, security, deployment, business model, must-have vs later, non-goals, hard-stops — and have future workflows consult that single intake document.

This dev-memo records the scope cut for the project-brief workflow component.

## Existing context used

- `.claude/rules/cc-suite.md` — locks cc-suite as the authoritative broker for review-plan / audit / verify.
- `.claude/rules/autonomy.md` — hard-stop list. The brief's §20 surfaces these explicitly.
- `.claude/rules/client-local-first.md` — v1 single-user Mac desktop posture. Pre-fills brief §3-§6 defaults.
- `.claude/rules/spark.md` — existing brainstorming rule. spark and project-brief are siblings, not competitors: spark = per-feature; project-brief = whole-product.
- `.claude/rules/staging-hygiene.md` — explicit-staging commit discipline.
- `.claude/skills/spark/SKILL.md` — existing brainstorming skill. project-brief follows its "ground in repo first / non-authoritative / never invoke cc-suite / commit outside autopilot" shape.
- `.claude/skills/project-autopilot/SKILL.md` — autopilot loop. project-brief is NOT an autopilot step; autopilot consults the brief but never runs `/project-brief`.
- `.claude/skills/client-architecture-reconcile/SKILL.md` — for resolving ADR ↔ brief conflicts after review (downstream of project-brief, not a substitute).
- `docs/product/product-target-architecture.md` — current authoritative product summary; the brief either confirms it or supersedes it via reconciliation.
- `dev-memo/plan-client-00.md` — client-surface reconciliation source; remains valid until folded into a `READY` brief.

## Assumptions

- Inferred from `.claude/rules/cc-suite.md` §"High-risk WIs": product-level intake that may shape future architecture, security, persistence, or wire-format decisions is high-risk by definition. Therefore the brief is NOT authoritative until `/cc-suite:review-plan` returns READY. The skill stops short of invoking review-plan itself; the user runs it.
- Inferred from `.claude/rules/autonomy.md` hard-stop list: any answer that triggers an autonomy hard-stop (auth provider, cloud vendor, real-data migration, public deployment, secret material, new runtime deps) MUST come from explicit user input and MUST be recorded in §20 as STOP-AND-ASK. The skill defaults nothing of consequence.
- Safest local-first assumption per [[../.claude/rules/client-local-first]]: the brief's default fill for client surface, network posture, and data residency follows the locked v1 direction (Mac desktop primary, local-first default, sync opt-in, WeChat deferred, browser deferred, multi-tenant SaaS not-v1).
- User-stated: "Add a project-level requirements intake command so I can state my full project requirements once" + "one consolidated interview, not drip-feed" + "use existing repo context first and pre-fill known assumptions" + "must not implement anything" + "must not change existing ADRs automatically" + "if the brief conflicts with existing ADRs, mark reconciliation-needed" + 20 question sections enumerated + 5 downstream rules + cc-suite review requirement + "commit only workflow/docs changes".

## Non-goals

- **No replacement** of `project-autopilot`, `cc-suite`, `client-architecture-reconcile`, `security-wi-loop`, `spark`, or `tdd-guardian`.
- **No replacement** of any existing `.claude/rules/*.md` policy file. project-brief.md is ADDITIVE; spark.md and project-autopilot/SKILL.md get focused updates (consult-the-brief hooks); everything else is untouched.
- **No ADR mutation.** When the brief disagrees with an existing ADR, the brief's `Reconciliation log` records the conflict; the ADR is changed only by a follow-up reconciliation WI that runs through cc-suite review-plan.
- **No multi-file brief.** One file at `docs/product/project-requirements-brief.md`. No `docs/product/project-brief/` subdirectory.
- **No automated status flip to `READY`.** The skill writes `DRAFT-PENDING-REVIEW` (or `AMENDMENT-PENDING-REVIEW`); the status field becomes `READY` only via a post-review commit by the user or a follow-up turn.
- **No autopilot participation.** The skill refuses to run inside `/project-autopilot` or `/loop`. Autopilot consults the brief but does NOT invoke `/project-brief` itself.
- **No new runtime dependencies** anywhere in the repo.
- **No global config changes.** No `~/.claude/**` edits.
- **No product code changes.** This WI is workflow/docs only.

## Options considered

1. **Standalone command + skill + rule + dev-memo (recommended).** Self-contained under `.claude/` and `dev-memo/`. The single output doc lives under `docs/product/` (alongside the existing product summary) so it's discoverable by reviewers without browsing `.claude/`. Spark.md and project-autopilot/SKILL.md get focused "consult the brief" updates; everything else is untouched.
2. **Extend spark to ask whole-project questions when triggered with a vague enough topic.** Rejected: muddies spark's purpose (per-feature), and spark's "ask at most ONE question" rule directly conflicts with a 20-section interview.
3. **Bake the intake into `client-architecture-reconcile`.** Rejected: reconciliation is a downstream activity (resolving two existing docs). The brief is the INPUT side, captured before any reconciliation is needed.
4. **Bake the intake into a cc-suite slash command.** Rejected: cc-suite is the reviewer, not the question-asker. The brief is the INPUT to `/cc-suite:review-plan`.
5. **Skip the brief entirely; rely on existing docs.** Rejected: the user explicitly asked to state requirements once, and the existing docs are technical (ADRs) or fragmented (multiple plans). The brief is the canonical product-level intake.

## Recommended direction

**Option 1.** Ship 7 workflow files (all under `.claude/`, `dev-memo/`, or `docs/product/`):

| File | Role | New / Updated |
|---|---|---|
| `.claude/commands/project-brief.md` | Slash-command surface. Routes `/project-brief` to the skill. | NEW |
| `.claude/skills/project-brief/SKILL.md` | Skill body; describes purpose, non-authority, behavior, 20-section template, conflict handling. | NEW |
| `.claude/rules/project-brief.md` | Authority hierarchy, cc-suite review focus, downstream consumption rules, conflict handling, status lifecycle. | NEW |
| `.claude/rules/spark.md` | Add "consult the brief in Step 1" + "do not ask whole-project questions" hooks. | UPDATED |
| `.claude/skills/spark/SKILL.md` | Add the brief to Step 1 grounding; route whole-project requests to `/project-brief`. | UPDATED |
| `.claude/skills/project-autopilot/SKILL.md` | Add the brief to "Read plan corpus" and add `BRIEF-CONFLICT` stop condition. | UPDATED |
| `dev-memo/project-brief-00.md` | This file. | NEW |

The brief itself (`docs/product/project-requirements-brief.md`) is NOT created by this WI. The first run of `/project-brief` creates it. The user explicitly asked us NOT to invoke `/project-brief` automatically at the end of this WI.

## Divergence from spark

| Aspect | spark | project-brief |
|---|---|---|
| Scope | One feature / one idea | Entire product direction |
| Interview shape | At-most-ONE targeted question | ONE consolidated 20-section interview |
| Output path | `dev-memo/spark/YYYY-MM-DD-<topic>-spark.md` | `docs/product/project-requirements-brief.md` |
| Output multiplicity | One file per spark | One canonical file (overwritten or amended) |
| Authority | Always non-authoritative; promote to a tracked plan to act on | Becomes authoritative after `/cc-suite:review-plan` returns READY |
| Conflict handling | Surface in §8 Hard stops; HARD STOP block in §10 | `Reconciliation log` + `Suggested follow-up WIs`; ADRs NOT silently rewritten |
| cc-suite invocation | Never (post-promotion only) | Never (skill stops; user runs `/cc-suite:review-plan`) |
| Autopilot participation | Forbidden | Forbidden |
| Triggering language | "brainstorm X" / "what if Y" / "sketch a spec for Z" | "/project-brief" / "let me state the full project requirements once" |

The two skills are siblings. spark.md's hard-prohibitions and SKILL.md's Step 1 are updated to route whole-project requests to project-brief.

## Divergence from existing docs

- `docs/product/product-target-architecture.md` already exists and is described as "authoritative product summary". The brief, once `READY`, becomes the canonical INTAKE; the architecture summary becomes a derived view. The conflict between the two is handled the same way as any ADR conflict — `Reconciliation log` in the brief, follow-up WI to align. This WI does NOT modify the architecture summary.
- `dev-memo/plan-client-00.md` remains valid until folded into a `READY` brief; the brief's §3-§6 will absorb its decisions and a reconciliation WI will mark the plan superseded.

## Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Medium | The brief is treated as authoritative before `/cc-suite:review-plan` runs, and a downstream WI builds on a `DRAFT-PENDING-REVIEW` brief. | Frontmatter `status:` field is explicit. Rule file authority hierarchy puts non-`READY` briefs below ADRs. Autopilot stops with `BRIEF-CONFLICT` if a WI requires the brief and the brief is non-`READY`. |
| 2 | Medium | The 20-section interview is too long; the user gives up partway and the brief lands with many `DEFERRED` answers. | The skill explicitly allows `DEFERRED — (reason)` per section and ships a partial brief. cc-suite review-plan flags large deferred sets as `NEEDS-FIX`. |
| 3 | Medium | The brief silently overrides an existing ADR because the conflict isn't detected. | The skill's Step 5 explicitly scans the repo files listed in Step 1 for conflicts and logs them. cc-suite review-plan focus item 2 explicitly checks for missing Reconciliation entries. |
| 4 | Low | spark and project-brief overlap and confuse the user about which to invoke. | Both skills' "When to use" sections explicitly route the other case. The trigger language is distinct ("brainstorm" vs "state full requirements"). |
| 5 | Low | Autopilot mistakenly runs `/project-brief` itself, breaking the user-invoked-only rule. | Hard prohibition in `.claude/skills/project-brief/SKILL.md` and `.claude/skills/project-autopilot/SKILL.md`. Stop condition `BRIEF-CONFLICT` says autopilot stops and asks the user. |
| 6 | Low | The brief's hard-stops list (§20) gets out of sync with `.claude/rules/autonomy.md`. | The rule file mentions autonomy as the canonical hard-stop list; the brief's §20 is "user-explicit additions / confirmations" of the same items, not a replacement. cc-suite review focus item 5 checks for clarity. |
| 7 | Low | The brief's frontmatter `status:` field is edited by hand and a typo lands. | The skill never writes `READY` directly. A follow-up commit flips the field; the commit message convention (`chore: promote project brief to READY`) makes the change visible. |

## Hard stops

None — workflow / docs only. No product code, no schema, no dependency, no global edit, no push. The brief file itself MAY contain hard-stop items (§20), but THIS WI does not write the brief — only the workflow infrastructure for it.

## Required cc-suite review

Not implementation-authorizing; no cc-suite review required for the workflow infrastructure itself. (This dev-memo + the 6 workflow files are docs-only additions/updates to `.claude/` and `dev-memo/`. They add a non-authoritative tool but do not change product code, contracts, or the cc-suite review path.)

If a future change to the project-brief workflow proposes affecting product code, contracts, or cc-suite policy, THAT change goes through cc-suite review-plan in the normal way.

The FIRST run of `/project-brief` (which writes `docs/product/project-requirements-brief.md`) DOES require `/cc-suite:review-plan` before the brief becomes authoritative — that requirement is encoded in the brief's §"Required cc-suite review" block and in `.claude/rules/project-brief.md`.

## Next bounded action suggestion

After this WI commits, the user may:

1. Invoke `/project-brief` to capture the full product requirements once.
2. Review the generated brief, amend if needed, then run `/cc-suite:review-plan docs/product/project-requirements-brief.md`.
3. After READY: flip the frontmatter `status:` to `READY` in a follow-up commit (`chore: promote project brief to READY`).
4. Open any reconciliation WIs the brief's `Reconciliation log` flagged.

This WI itself does NOT invoke `/project-brief`. The user explicitly asked us to stop after commit.

## Stop condition

- project-brief workflow is functional once `.claude/commands/project-brief.md`, `.claude/skills/project-brief/SKILL.md`, `.claude/rules/project-brief.md`, the spark.md / spark SKILL.md / project-autopilot SKILL.md updates, and this dev-memo are committed.
- Stale only if the user opens a follow-up WI to revise the interview shape, the conflict-handling rules, or the downstream consumption rules.
- Superseded if cc-suite ever ships a native project-requirements intake command, at which point this component is removed and the WI is closed.
