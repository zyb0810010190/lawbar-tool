---
name: spark
description: On-demand brainstorming and spec writer for new ideas. Non-authoritative. Produces a spark spec under dev-memo/spark/; does NOT implement code, commit product code, or replace cc-suite review/audit/verify. Promote the spec into a tracked WI plan / ADR / dev-memo before implementation.
---

# spark — Standalone brainstorming + spec component

## Attribution

- Based on the brainstorming skill from [obra/superpowers](https://github.com/obra/superpowers).
- Upstream: https://github.com/obra/superpowers
- License: MIT, per upstream repository (`Copyright (c) 2025 Jesse Vincent`).
- Adapted for this repo as a standalone `spark` brainstorming skill.
- Full Superpowers workflow intentionally **not installed or enabled** for this repo's workflows.
- `cc-suite` remains the authoritative review/audit/verify broker. spark feeds cc-suite, never replaces it.

## What spark IS

A focused, on-demand idea-to-spec helper. Takes a vague request ("we should add X", "what if we did Y", "explore Z"), grounds it in this repo's existing context, and emits a single spark spec under `dev-memo/spark/YYYY-MM-DD-<topic>-spark.md` containing:

1. Problem statement
2. Existing context used
3. Assumptions
4. Non-goals
5. Options considered
6. Recommended direction (ONE — alternatives only when they materially change the decision)
7. Risks
8. Hard stops
9. Required downstream artifact (WI plan / ADR / dev-memo)
10. Required cc-suite review (boilerplate block — see below)
11. Next bounded WI suggestion
12. Stop condition

## What spark IS NOT

- **NOT an implementation skill.** spark writes no product code. It writes one Markdown spec under `dev-memo/spark/` and stops.
- **NOT a commit driver.** spark may produce a `dev-memo/spark/...` file (workflow doc, safe to commit alone), but it MUST NOT commit alongside product code or stage any product changes.
- **NOT a cc-suite replacement.** spark output is non-authoritative. Promotion to implementation requires the full cc-suite path per [[../../rules/cc-suite]]: review-plan → (fix) → audit → verify.
- **NOT an autopilot participant.** spark does NOT run inside `/loop`, `/project-autopilot`, overnight runs, or any unattended loop unless explicitly selected by the user as the current WI.
- **NOT a hard-stop bypass.** spark explicitly surfaces hard-stops from [[../../rules/autonomy]] (push, deploy, secrets, destructive ops, public API breaks, new deps, etc.) and stops to ask when the idea triggers one.
- **NOT a generic questioner.** spark MUST read `AGENTS.md`, relevant ADRs, recent commits, plans, dev-memos, and the current repo state BEFORE asking the user anything. Generic questions that the repo already answers are forbidden.

## When to use spark

The user typed `/spark` or asked you to brainstorm an idea before locking a plan. Triggers include:

- "Brainstorm X."
- "What if we did Y?"
- "Sketch a spec for Z."
- "I'm not sure how to approach this — explore."

If the request is "build X" or "implement Y", that is **not** a spark task. Route it to the normal WI plan → cc-suite review-plan → implement flow per [[../../rules/cc-suite]] and [[../../rules/autonomy]].

If the request is "review X plan" or "audit Y code", route to cc-suite directly.

## Workflow

### 1. Ground in repo context FIRST

Before asking any question, read:

- `AGENTS.md` and any `CLAUDE.md` / `GEMINI.md` referenced from it.
- **`docs/product/project-requirements-brief.md` if it exists** — the authoritative whole-product intake (see [[../../rules/project-brief]]). Cite it in §2 of the spark spec with its current `status:`.
- The current plan corpus: `dev-memo/plan-*.md`, `dev-memo/spark/*.md`, `dev-memo/deferred-audit-findings.md`.
- `docs/adr/` index — the ADRs relevant to the topic.
- Recent commits via `git log --oneline -30`.
- Any cited file paths in the user's prompt.

If the answer is already in the repo, USE it. Do not re-ask.

If the user's request is whole-project direction (vision / target users / primary platform / business model / hard-stop policy / etc.) rather than a single feature, **stop** and recommend `/project-brief` instead. spark is for per-feature brainstorming; whole-project intake is `/project-brief`'s scope.

If `docs/product/project-requirements-brief.md` exists and the spark idea contradicts a `READY` brief, surface the conflict in §8 "Hard stops" of the spec and prepend the HARD STOP block in §10.

### 2. Decide if the topic triggers a hard-stop

If the proposed idea would require ANY of the following per [[../../rules/autonomy]], surface immediately and stop:

- Production deployment, release publication, go-live announcement.
- Destructive broad deletes / `rm -rf` / `git reset --hard` / dropping tables.
- Real secrets / credentials / billing / external accounts.
- New runtime dependencies.
- Public API / wire-format / schema / CLI breaking changes.
- SQLite / better-sqlite3 / native-module work without prior ABI remediation WI authorization.
- Cloud / sync / external network / SaaS / multi-tenant gateway.
- LLM execution / OCR-package implementation changes.
- Electron / Tauri / Windows / browser-first / WeChat-primary framings (see [[../../rules/client-local-first]]).
- `git push` / branch delete / remote write.

When a hard-stop fires, the spark output's §8 "Hard stops" lists each one explicitly, and §10 "Required cc-suite review" prepends:

> **HARD STOP triggered.** This idea is NOT authorized for implementation. User must explicitly authorize each hard-stop item before any cc-suite review-plan is invoked.

### 3. Ask ONLY targeted questions

If you genuinely lack a load-bearing piece of information that the repo does not answer, ask **one** question. Use `AskUserQuestion` with a small option set when possible. Otherwise default to the safest local-first assumption per [[../../rules/client-local-first]] and record it in §3 "Assumptions".

Do NOT ask multiple rounds of questions. Do NOT ask questions the repo answers. Generate one recommended direction; show alternatives only when they materially change the decision.

### 4. Write the spark spec

Output path: `dev-memo/spark/YYYY-MM-DD-<topic>-spark.md`. Create the `dev-memo/spark/` directory if it does not exist. Topic slug is kebab-case, derived from the idea (e.g., `2026-05-21-llm-fact-extractor-spark.md`).

Use the template in [[../../rules/spark]] §"Spark spec template". Every section is required.

### 5. Stop

spark's terminal state is "spec written, path reported." Do NOT:

- Invoke cc-suite review-plan.
- Promote the spec into a WI plan.
- Start any implementation.
- Loop back into another brainstorm round.

Report the path and the next recommended bounded action ("promote to `dev-memo/plan-<topic>.md`, then run `/cc-suite:review-plan`") and stop.

## Promotion path (informational; spark does NOT execute this)

The user (or a follow-up turn) takes the spec and:

1. Creates a tracked WI plan / ADR / dev-memo. For HIGH-RISK scope per [[../../rules/cc-suite]], the plan MUST include a `## Review packet (compact)` block.
2. Runs `/cc-suite:review-plan` per the path order in [[../../rules/cc-suite]] (Path 1 default, retry policy on TIMEOUT per CCSUITE-02).
3. Iterates until READY TO BUILD or only Low-risk clarifications remain.
4. Implements one bounded WI at a time per [[../../rules/autonomy]].
5. Runs `/cc-suite:audit` and `/cc-suite:verify` per the audit-remediation policy.

spark's output is the **input** to step 1. Nothing about spark short-circuits steps 2-5.

## What goes into "Required cc-suite review" (§10 of every spec)

Every spark spec that proposes an implementation, architecture change, ADR, WI, or product direction MUST include verbatim:

```
## Required cc-suite review

This idea is not authorized for implementation until:
1. It is promoted into a tracked WI plan / ADR / dev-memo.
2. The plan includes a `## Review packet (compact)` section if high-risk.
3. cc-suite review-plan returns READY or only Low-risk clarifications remain.
4. Any Critical/High findings are fixed and re-reviewed.
5. Any hard-stop items are explicitly authorized by the user.
```

If the spark output is only a brainstorming note NOT intended for implementation (e.g., "what would it look like if we eventually …"), §10 must instead read:

> Not implementation-authorizing; no cc-suite review required until promoted to a WI.

The choice between the two forms is the writer's responsibility, surfaced in §9 "Required downstream artifact". A note that says "promote to ADR-XX" or "promote to WI plan" requires the full block; a pure thinking-out-loud note may use the short form.

## References

- [[../../rules/spark]] — full spec template and promotion rules.
- [[../../rules/cc-suite]] — authoritative review/audit/verify broker policy.
- [[../../rules/autonomy]] — hard-stop list.
- [[../../rules/client-local-first]] — v1 client posture (local-first Mac desktop, no SaaS).
- [[../../rules/staging-hygiene]] — explicit-staging commit discipline.
- [[../../rules/loc-guardian]] — LOC gate (not enforced by spark, but spark specs that propose new files should note expected LOC budget).
- `dev-memo/tooling-spark-00.md` — design rationale, scope cut, divergence from upstream.
- Upstream (read-only reference, NOT installed): https://github.com/obra/superpowers
