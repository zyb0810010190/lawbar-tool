---
description: Run loc-guardian scan before long autonomous runs; do not continue if hand-written source/test fail thresholds are exceeded
applies-to: "**"
---

# LOC Guardrails for Autonomous Runs

Pairs with [[autonomy]] (pre-authorized actions + hard-stop list) and `.claude/loc-guardian.local.md` (project thresholds + extraction rules). The config file itself is **local-only** (matches `.claude/*.local.*` in `.gitignore`); these rules are the **tracked** policy that references it.

## When the gate applies

Run a `/loc-guardian:scan` **before** any of the following:

- **Long `/goal` runs.** Any goal-driven autonomous loop that may add or substantially modify hand-written source or test files.
- **`/project-autopilot` skill runs.** The first step of an autopilot loop AFTER `branch-clean` is now `loc-guardian:scan`.
- **Implementation WIs that add new files or grow existing source/test files materially.** Specifically: new packages, new state machines, new validator suites, new test harnesses, schema-driven code expansions.

A scan is NOT required before:

- Single-file doc edits.
- ADR / dev-memo authoring (docs threshold is policy-only, generous, and intentionally lenient).
- Pure-`.gitignore` or pure-config changes.
- Trivial typo/comment-only patches.

## Gate semantics

`/loc-guardian:scan` returns a `VERDICT: N over limit, M warnings` line. Interpret per category:

### Hand-written source (`*.ts`, `*.mjs`, `*.js`, `*.tsx`, `*.jsx` outside generated paths)

- **Pure LOC ≥ 800** = fail.
- **If any hand-written source file is over fail**, the autonomous run **must stop** and either:
  1. Split/refactor the offending file as the current WI's scope, OR
  2. Open a bounded sub-WI for the split BEFORE continuing the original WI.

The split MUST follow the extraction rules in `.claude/loc-guardian.local.md` (schema-derived types → `src/generated/`, state-machine tables → `src/transitions.ts`, per-entity validators one-per-file, etc.).

### Hand-written test (`*.test.*`, `tests/**`, `*.spec.*`)

- **Raw LOC ≥ 1200** = fail.
- **If any hand-written test file is over fail**, the autonomous run **must stop** and split the test file along behavior or entity boundaries before continuing. Conformance harnesses shared across multiple implementations may exceed the threshold with explicit user authorization; that authorization must be recorded in a dev-memo or ADR before the next gate run.

### Generated files

- **Exempt from LOC limits ONLY when clearly marked as generated.** A file qualifies as "clearly marked" iff one of these holds:
  - Path matches an explicit generated pattern (`**/dist/**`, `**/src/generated/**`, `**/node_modules/**`, `**/coverage/**`, `**/package-lock.json`).
  - File begins with a banner comment matching `AUTO-GENERATED from ...` (the `scripts/gen-types.mjs` convention used by `ocr-worker-contract` and `case-box-contract`).
- **Hand-edited generated files are NOT exempt** — the autonomous run must restore them from the source-of-truth (regenerate from schema) or treat them as hand-written.

### JSON schemas and fixtures

- Warning thresholds (schemas: 1000 LOC; fixtures: 1500 LOC) are policy-only and **may be exceeded only when justified**.
- Justification is recorded in a dev-memo or ADR (e.g. "fixture is a golden snapshot deliberately exercising every conditional branch").
- **`loc-guardian:optimizer` MUST NOT auto-refactor schemas or fixtures.** Splitting a schema into `$defs` or sub-schemas is a contract change and requires explicit user authorization.

### Docs / ADR / dev-memo

- Warning threshold (1200 LOC) is policy-only.
- Long-form docs (`docs/release/go-live-plan.md`, sign-off reports, multi-step plans) are **expected** to exceed warn. Listed in `.claude/loc-guardian.local.md` as protected; do not refactor without explicit user request.

## Hard prohibitions

- **No monolithic file growth.** A hand-written source file MUST NOT grow into a multi-thousand-line file. If any hand-written source file is observed above **1500 pure LOC**, treat it as a critical structural finding and surface it to the user immediately, regardless of the standard warn/fail thresholds. The 800 fail threshold exists precisely to prevent this drift.
- **No new violations on the autopilot path.** If a `/goal` loop introduces a NEW pure-LOC violation (file went from under fail to over fail during this loop), the loop MUST stop. Do not continue stacking work into a file you are simultaneously breaking the threshold for.
- **No silent threshold bypass.** Adding new exempt patterns to `.claude/loc-guardian.local.md` requires explicit user authorization and a written justification in the config file itself.

## Workflow integration

The autonomous loop steps are now:

1. `branch-clean` (per [[../commands/branch-clean]]).
2. **`loc-guardian:scan`** (this rule).
3. If scan returns `VERDICT: 0 over limit`, proceed.
4. If scan returns over-limit hand-written source or test files:
   - Surface the over-limit list to the user.
   - Choose: refactor inside the current WI, open a bounded split sub-WI, or stop and ask.
   - Do not continue the autopilot loop until the gate is green OR the user explicitly authorizes deferral with a written justification.
5. Read plan corpus, select next WI (per [[autonomy]] continuation rule).
6. Execute WI.
7. **`loc-guardian:scan` again before commit.** Re-running the gate after implementation catches new violations introduced by the WI itself.
8. `commit-gate` (per [[../commands/commit-gate]]).

## Failure handling

- **`/loc-guardian:scan` returns an error or empty output** — the gate is **failed-closed**. Do not continue the autonomous run. Surface the failure to the user.
- **The optimizer suggests changes that violate other rules** (e.g. proposes touching a security-boundary file without sign-off, or wants to refactor a generated file) — reject the suggestion and surface the conflict.

## Relationship to other rules

- [[autonomy]] — the LOC gate is one of the pre-flight checks the autonomy continuation rule depends on. A green LOC scan is a precondition for "continue to next WI" autonomous decisions.
- [[staging-hygiene]] — the loc-guardian config file (`.claude/loc-guardian.local.md`) is on the exclude list because it matches `.claude/*.local.*` in `.gitignore`. Never stage it. This rule file (`.claude/rules/loc-guardian.md`) IS tracked because it documents the project-wide policy.
- [[security-boundary]] — security-sensitive files (SSRF/TLS/DNS/fetcher under `services/ocr-worker/`) inherit BOTH the loc-guardian fail threshold AND the security WI loop. A split of a security file requires the full plan-review → tests → audit → verify chain.

## References

- `.claude/loc-guardian.local.md` — local thresholds + extraction rules (gitignored).
- `.claude/commands/branch-clean.md` — pre-flight working-tree state.
- `.claude/commands/commit-gate.md` — explicit-staging commit discipline.
- `.claude/skills/project-autopilot/SKILL.md` — autopilot loop (loc-guardian step lands between branch-clean and WI selection).
