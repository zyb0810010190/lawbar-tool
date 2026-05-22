---
description: One-shot project requirements intake. Consolidated 20-section interview, writes a non-authoritative brief to docs/product/project-requirements-brief.md. Promote via /cc-suite:review-plan.
---

# /project-brief — Capture full product requirements once

Invoke the `project-brief` skill. The skill is fully described in `.claude/skills/project-brief/SKILL.md`.

## Behavior

- The skill grounds in repo context FIRST (AGENTS.md, `docs/product/`, `docs/adr/`, `dev-memo/plan-client-00.md`, `.claude/rules/`, recent commits).
- It presents ALL twenty question sections in ONE consolidated interview. You reply with ONE long answer.
- It writes exactly one file: `docs/product/project-requirements-brief.md`.
- It does NOT modify any ADR, dev-memo, plan, or product code.
- If your answer disagrees with an existing ADR or product doc, the conflict is logged in the brief's §"Reconciliation log" — the source doc is NOT silently rewritten.
- The brief becomes authoritative only after `/cc-suite:review-plan docs/product/project-requirements-brief.md` returns READY (or only Low-risk clarifications remain) per `.claude/rules/cc-suite.md`.
- The skill does NOT commit, does NOT push, does NOT run cc-suite automatically.
- The skill does NOT run inside `/project-autopilot`, `/loop`, or any unattended loop.

## What /project-brief replaces

Nothing in the existing workflow. It is a NEW intake surface. Downstream workflows now consult `docs/product/project-requirements-brief.md` when it exists:

- spark (`.claude/skills/spark/SKILL.md`) reads it in its Step 1 grounding.
- project-autopilot (`.claude/skills/project-autopilot/SKILL.md`) stops if a planned WI conflicts with the brief.
- WI plans must check against the brief before review-plan.

## Arguments

None. The interview is the entire input surface. Examples:

- `/project-brief` — fresh intake or "confirm / amend" of an existing brief.

## Output

A single Markdown file at `docs/product/project-requirements-brief.md` with frontmatter status `DRAFT-PENDING-REVIEW` (or `AMENDMENT-PENDING-REVIEW` when a prior `READY` brief is amended). The skill reports the path and the next bounded action, then stops.

## When NOT to use /project-brief

- Per-feature brainstorming — use `/spark` instead.
- ADR ↔ ADR reconciliation between two existing docs — use the `client-architecture-reconcile` skill.
- Implementing a WI — use the normal plan → `/cc-suite:review-plan` → implement flow.
- Auditing / verifying / reviewing existing code — invoke the relevant `/cc-suite:*` slash command directly.
- Inside `/project-autopilot` or any unattended loop — project-brief is user-invoked only.

## References

- `.claude/skills/project-brief/SKILL.md` — full skill definition.
- `.claude/rules/project-brief.md` — authority + cc-suite review focus + downstream consumption rules.
- `.claude/rules/cc-suite.md` — authoritative review broker policy.
- `.claude/rules/autonomy.md` — hard-stop list.
- `.claude/rules/client-local-first.md` — v1 client posture (informs pre-fill defaults).
- `dev-memo/project-brief-00.md` — design rationale.
