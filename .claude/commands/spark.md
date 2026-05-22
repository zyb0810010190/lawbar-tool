---
description: Brainstorm an idea into a non-authoritative spark spec under dev-memo/spark/. Does NOT implement code, commit product code, or replace cc-suite review/audit/verify.
---

# /spark — Brainstorm idea → non-authoritative spark spec

Invoke the `spark` skill on the user's topic. The skill is fully described in `.claude/skills/spark/SKILL.md`.

## Behavior

- spark grounds the topic in this repo's existing context (`AGENTS.md`, ADRs, plans, commits) BEFORE asking the user anything.
- spark asks AT MOST one targeted question when a load-bearing fact is genuinely missing; otherwise it makes the safest local-first assumption and records it.
- spark emits ONE spec file under `dev-memo/spark/YYYY-MM-DD-<topic>-spark.md` and stops.
- spark does NOT implement code, run cc-suite, run the autopilot loop, promote to a WI, or commit product code.
- spark surfaces and halts on hard-stops from `.claude/rules/autonomy.md` (push / deploy / secrets / new deps / public API breaks / SQLite without ABI WI / cloud-sync / LLM / etc.).
- spark output includes the verbatim "Required cc-suite review" block (per `.claude/rules/spark.md`) when the idea is implementation-shaped; otherwise the short "Not implementation-authorizing" notice.

## What spark replaces

Nothing in the existing workflow. It is a NEW upstream-attributed component that produces specs as INPUT to the existing cc-suite review-plan → audit → verify pipeline.

## Arguments

The user's natural-language topic. Examples:

- `/spark llm fact extractor for case-box`
- `/spark adopt vite for the future client`
- `/spark how should we surface OCR errors to the lawyer`

## Output

A single Markdown file at `dev-memo/spark/YYYY-MM-DD-<topic>-spark.md`. The skill reports the path and the next bounded action, then stops.

## When NOT to use /spark

- The user said "implement X" — route to the normal WI plan → cc-suite review-plan flow.
- The user said "audit X" / "review X" / "verify X" — invoke the relevant cc-suite slash command directly.
- The autopilot loop is running — spark is not an autopilot step.

## References

- `.claude/skills/spark/SKILL.md` — full skill definition.
- `.claude/rules/spark.md` — spec template + promotion rules + attribution.
- `.claude/rules/cc-suite.md` — authoritative review broker policy.
- `.claude/rules/autonomy.md` — hard-stop list.
- `dev-memo/tooling-spark-00.md` — design rationale.
