# TOOLING-SPARK-00 — Standalone spark brainstorming component

**Status**: design rationale + scope cut.
**Date**: 2026-05-21.
**Author**: Claude Code at user's direction (TOOLING-SPARK-00 work item).

## Problem

The user wants the *idea* in Superpowers' brainstorming skill — "ground the topic in repo context, propose a single design, write a spec" — but does NOT want to:

- Install / enable full Superpowers in this repo's `enabledPlugins`.
- Inherit Superpowers' broader workflow (writing-plans, visual-companion, condition-based-waiting, etc.).
- Cede authority for review / audit / verify to anything other than `cc-suite`.
- Let a brainstorming tool start product implementation.

This dev-memo records the scope cut and the divergence from upstream.

## Existing context used

- `.claude/rules/cc-suite.md` — locks cc-suite as the authoritative broker for review-plan / audit / verify.
- `.claude/rules/autonomy.md` — hard-stop list (push, deploy, secrets, new deps, public API breaks, SQLite without ABI WI, etc.).
- `.claude/rules/client-local-first.md` — v1 single-user Mac desktop posture; rejects multi-tenant SaaS / cloud-first / browser-first framings.
- `.claude/rules/staging-hygiene.md` — explicit-staging commit discipline.
- `.claude/rules/loc-guardian.md` — LOC policy (800 fail / 500 warn for hand-written source).
- `.claude/skills/project-autopilot/SKILL.md` (referenced; not modified) — the existing autonomous loop.
- Upstream brainstorming skill at `/tmp/superpowers-brainstorm-source/skills/brainstorming/SKILL.md` (cloned read-only for inspection; not installed).
- `claude plugin list` showed Superpowers 5.0.7 already installed at USER scope (enabled globally). This repo's `.claude/settings.json` does NOT enable it for project-level workflows.

## Install-state findings (pre-implementation)

| Item | State |
|---|---|
| Superpowers globally installed | YES (user scope, v5.0.7, enabled) |
| Superpowers enabled in this repo's settings | NO (`.claude/settings.json` enables only `cc-suite@xiaolai` + `loc-guardian@xiaolai`) |
| seedex-skills `/spark` | NOT installed |
| Full Superpowers being installed in this WI | NO — explicit user prohibition |
| Global `~/.claude` files modified in this WI | NO — explicit user prohibition |
| Upstream Superpowers scripts executed | NO — clone was read-only inspection |

Decision: leave Superpowers' global install alone (not authorized to uninstall). Build a project-local, standalone component that copies the *idea* but not the code.

## Assumptions

- Inferred from repo state: cc-suite is the authoritative review broker. spark MUST feed cc-suite, never replace it.
- Safest local-first assumption: spark output should land in `dev-memo/spark/` rather than `docs/superpowers/specs/` (the upstream default), so the repo's existing docs tree is unaffected and the upstream-vs-project naming difference is visible.
- User-stated: "Do not install full Superpowers / Do not enable full Superpowers / Do not install seedex-skills `/spark` / Do not modify global `~/.claude` files / Do not replace project-autopilot / Do not replace cc-suite."
- Inferred from `.claude/rules/cc-suite.md` §"High-risk WIs": spark output that proposes implementation MUST trigger the full cc-suite review path before any code lands. Hence the verbatim §10 "Required cc-suite review" block in every implementation-shaped spec.

## Non-goals

- No replacement of `project-autopilot`, `cc-suite`, `client-architecture-reconcile`, `security-wi-loop`, or `tdd-guardian`.
- No replacement of the existing `.claude/rules/*.md` policy files (only ADDITIONS via `.claude/rules/spark.md`).
- No upstream Superpowers feature ports beyond the brainstorming idea (no writing-plans, no visual-companion, no condition-based-waiting, no spec-document-reviewer-prompt).
- No global config changes. No `~/.claude/**` edits.
- No dependency on Superpowers being installed or enabled — spark works whether Superpowers is present or absent.
- No new runtime dependencies anywhere in the repo.

## Options considered

1. **Standalone skill + command + rule + dev-memo (recommended).** Self-contained under `.claude/`. Attribution to upstream, MIT license note. No upstream code copied; only the idea adapted.
2. Wrap upstream — enable Superpowers' brainstorming skill in `.claude/settings.json` and shim it. Rejected: user explicitly forbids installing/enabling Superpowers; also pulls in Superpowers' broader skill graph.
3. Wait for upstream to ship something we can vendor. Rejected: no schedule, no need.

## Recommended direction

**Option 1.** Ship 4 workflow files (all under `.claude/` or `dev-memo/`):

| File | Role |
|---|---|
| `.claude/skills/spark/SKILL.md` | Skill body; describes purpose, non-authority, behavior, attribution. |
| `.claude/commands/spark.md` | Slash-command surface. Routes `/spark <topic>` to the skill. |
| `.claude/rules/spark.md` | Spec template (12 required sections), behavioral rules, commit policy, conflict resolution with existing skills. |
| `dev-memo/tooling-spark-00.md` | This file. Design rationale, scope cut, divergence from upstream. |

Every output spec lands at `dev-memo/spark/YYYY-MM-DD-<topic>-spark.md` and stops there. cc-suite is invoked only AFTER promotion.

## Divergence from upstream

| Aspect | Upstream Superpowers brainstorming | This repo's spark |
|---|---|---|
| Terminal skill | `writing-plans` (must be invoked) | Stop after writing spec; user runs `/cc-suite:review-plan` if promoting |
| Output path | `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` | `dev-memo/spark/YYYY-MM-DD-<topic>-spark.md` |
| Visual companion | Required offer when visual content likely | Removed (no browser companion) |
| User-question discipline | "One at a time, multiple choice preferred, can be open-ended" | "At most ONE question per turn; safest local-first default otherwise" |
| Approval gate | Sequential per-section user approvals | Single spec output; user reviews afterward |
| Hard-stop integration | None | Surfaces `.claude/rules/autonomy.md` hard-stops; refuses to recommend implementation when triggered |
| cc-suite integration | N/A | Every implementation-shaped spec carries verbatim "Required cc-suite review" block |
| Autopilot participation | Implicit | Explicitly forbidden unless user selects `/spark` as current step |
| Installation | Plugin install + enable | Project-local workflow files only; no plugin, no enable, no global edit |
| License | MIT (upstream) | MIT-attributed; this repo's files inherit project license |

## Risks

| # | Severity | Risk | Mitigation |
|---|---|---|---|
| 1 | Low | spark spec mistaken for an authoritative plan and implementation starts without cc-suite review | Every spec carries the verbatim "Required cc-suite review" block; §10 in spark spec template; SKILL.md hard-prohibition list |
| 2 | Low | spark accidentally runs inside autopilot and spawns specs autonomously | SKILL.md + rule file both forbid; project-autopilot does not list spark in its step graph |
| 3 | Low | Drift between upstream brainstorming idea and this repo's adaptation | Attribution preserved; if upstream changes meaningfully and we want to absorb, open a TOOLING-SPARK-NN WI |
| 4 | Low | spark's "safest local-first assumption" misreads the repo and produces a wrong recommendation | §3 "Assumptions" cites sources; user can correct on review; spec is non-authoritative, so the cc-suite review path catches drift |

## Hard stops

None — workflow / docs only. No code, no schema, no dependency, no global edit, no push.

## Required cc-suite review

Not implementation-authorizing; no cc-suite review required for the tooling component itself. (This dev-memo + the 3 workflow files are docs-only additions to `.claude/` and `dev-memo/`. They add a non-authoritative tool but do not change product code, contracts, or the cc-suite review path.)

If a future change to the spark workflow proposes affecting product code, contracts, or cc-suite policy, THAT change goes through cc-suite review-plan in the normal way.

## Next bounded action suggestion

After this WI commits, the user may:

1. Invoke `/spark <topic>` for any pending brainstorming need.
2. Open a normal WI plan (`dev-memo/plan-<topic>.md`) and run `/cc-suite:review-plan` per the existing workflow.

This WI itself does NOT start any product WI.

## Stop condition

- spark workflow is functional once `.claude/skills/spark/SKILL.md`, `.claude/commands/spark.md`, `.claude/rules/spark.md`, and this dev-memo are committed.
- Stale only if the upstream brainstorming skill changes meaningfully AND the user wants to absorb the change → open TOOLING-SPARK-NN.
- Superseded if cc-suite ever ships a native brainstorming command, at which point this component is removed and the WI is closed.
