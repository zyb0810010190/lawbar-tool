# Batch audit (Layer B)

Run after every `BATCH_AUDIT_EVERY` commits, or immediately on any Layer-C risk trigger.
Purpose: catch drift that per-WI gates miss — a bad abstraction in WI 2 that WIs 3–10 build
on. Per-WI gates check each task in isolation; the batch audit checks the *accumulation*.

## Checks

**Goal drift**
- Do the completed WIs still map to the authorized `queue.md`?
- Did any WI silently expand scope, or create work not in the queue?

**Garbage-code risk**
- Net LOC growth; duplicate logic; oversized files (loc-guardian); dead code; TODO/FIXME
  count; unused exports; new dependencies; type/lint/test regressions; coverage decrease;
  public-API changes lacking docs/tests.

**Architecture drift**
- New abstractions not requested; cross-layer imports; circular deps; error-handling gaps.

**UI drift** (if UI touched)
- Token violations; responsive issues; visual regressions; accessibility violations;
  performance regressions. (See UI-GATES.md for the limitation statement.)

## Outcome

PASS → continue the batch. Any finding → stop, report, and resolve as a new WI (fixed /
deferred-with-WI / rejected-with-reason). The batch does not resume past unresolved findings.

## Study packet (echo-sleuth, after each batch)

Generate the post-hoc study record — this is the substitute for per-WI human approval, so it
must actually be produced and read. **Autonomous-safe (non-interactive) — runs in the batch:**

```
/echo-sleuth:timeline --since <batch-start> --limit 50   → dev-memo/study/<date>-timeline.md
/echo-sleuth:recap <N> --detail high                     → dev-memo/study/<date>-recap.md
/echo-sleuth:lessons --category decisions                → dev-memo/decisions/<date>-decisions.md
/echo-sleuth:lessons --category mistakes                 → dev-memo/study/<date>-mistakes.md
```

**Manual MEMORY follow-up (interactive — NOT in the autonomous path):**

```
/echo-sleuth:extract     # prompts for where to save each item; would hang an unattended run
```

`/echo-sleuth:extract` is interactive (it asks where to save candidates), so it cannot run
inside an unattended batch. Do it later under a MEMORY WI, unless a verified non-interactive
save mode exists on your machine.

The study summary should record, per batch: tasks completed (WI id, commit hash, files,
behavior); decisions (alternatives, why chosen, evidence, what would falsify it later);
audit findings and disposition; mistakes/near-misses; and a "review later" list of
high-risk files, new abstractions, and plausible-but-weakly-tested generated code.
