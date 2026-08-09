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

### Remediation lane — committing the fix for a FAILED audit

A Critical/High/Medium cannot be deferred (`batch-closeout.mjs` requires
`AUDIT-VERDICT: BATCH-PASS C0 H0 M0 L<n>`), so fix-and-re-audit is the only path — and that path
needs a commit, which `batch-commit-guard.sh` otherwise blocks as audit-DUE. **The action that
resolves the finding was the one action the system forbade.** Twice this deadlock was broken by
spending a single-use `human.override`, which is break-glass, not routine process.

The remediation lane (WI-BATCH-REMEDIATION-LANE-00) fixes that. It applies **only to an audit that
has FAILED** — a merely-DUE audit is not a deadlock, it is an audit nobody has run yet, and the
correct response is to run it. A **human** creates `dev-memo/run/remediation.authorized` (the agent
cannot: it is hook-protected exactly like `human.ack` / `human.override`):

```
# remediation-authorization v1
range_base=<40-hex>              # MUST equal dev-memo/run/last-batch-audit AND the live window BASE
audit_head=<40-hex>              # the HEAD the failing audit covered (ancestor-or-equal of HEAD)
broker_job_id=audit-xxxxxxxx-yyyyyy
broker_output_sha256=<sha256 of that job's rawOutput>
finding_ids=M1, L1               # which finding(s) this commit resolves
reason=<one line, kept in the audit trail>
allowed_path=services/x/src/thing.ts     # exact file
allowed_path=services/x/tests/           # trailing '/' = directory prefix
```

`batch-commit-guard.sh` then permits **exactly one** commit, and only after verifying, fail-closed:
the artifact is strictly well-formed; `range_base` is the current marker *and* the live BASE; the
named broker job's `rawOutput` hashes to `broker_output_sha256` and declares
`AUDIT-RANGE: <range_base>..<audit_head>` plus `AUDIT-VERDICT: BATCH-FAIL …` on their own lines;
the commit form cannot smuggle content past the index (no `-a`, `-p`, `-i`, `-o`, `--amend`,
`--pathspec-from-file`, `--`, pathspec operands, chaining, redirection or substitution); and every
staged path is inside `allowed_path`. The token is then consumed and logged to `dev-memo/run/log.md`,
exactly like `human.override`.

This **narrows** the existing escape rather than widening it: an override permits *any* commit and
bypasses risk/governance/count; the remediation lane bypasses **only** the audit-DUE deny, for a
path-scoped commit bound to a specific failing job. Risk flag, governed queue, the BCG-6 content
hash, the closeout sentinel and the `AUTO_ADVANCE_MAX` breaker all still apply.

**The marker is not advanced.** A remediation commit does not close the window: commits stay blocked
until a follow-up Layer-B audit covering `range_base..<new head>` returns PASS and the closeout runs.

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

## Automated closeout (BATCH-CLOSEOUT-AUTO-00)

The marker advance (`dev-memo/run/last-batch-audit` → HEAD) that clears `batch-commit-guard.sh`'s
audit-DUE block is performed by `scripts/workflow/batch-closeout.mjs` — not a human or a free agent
write. The script verifies, fail-closed, a git-tracked **attestation** in the study packet AND
hard-binds it to the broker audit job by output hash + declared range. Plan:
`dev-memo/plan-batch-closeout-automation-00.md` (rev-2). The closeout log is
`dev-memo/batch-closeout-log.md`.

### 1. Broker prompt MUST emit machine lines

When running the Layer-B audit through the cc-suite broker (`/cc-suite:audit` / runner), the audit
prompt MUST instruct the auditor to emit these two lines verbatim in its output, using the exact
window SHAs:

```
AUDIT-RANGE: <BASE>..<HEAD>
AUDIT-VERDICT: BATCH-PASS C0 H0 M0 L<n>     (or BATCH-FAIL …)
```

`BASE` = the current `last-batch-audit` (or `batch-start` if newer); `HEAD` = the audited HEAD. These
lines live in the broker job's `rawOutput` and are what binds the closeout to *this* range (the job
JSON stores only `rawOutput` + `threadId`; there is no structured range/kind/status field).

### 2. Study-packet attestation block

After a PASS, add to `dev-memo/study/<date>-batch-audit-*.md`:

```
<!-- batch-audit-attestation v1
range_base: <BASE 40-hex>
target_sha: <HEAD 40-hex>
verdict: BATCH-PASS
findings: C0 H0 M0 L<n>
broker_job_id: <cc-suite jobId, e.g. audit-xxxxxxxx>
broker_output_sha256: <sha256 of the broker job's rawOutput>
-->
```

Compute `broker_output_sha256` over the exact `rawOutput` bytes of the cited job
(`.../jobs/<jobId>.json`). Any `L>0` requires each Low to be dispositioned in a tracked file
(`dev-memo/deferred-audit-findings.md`).

### 3. Run the closeout

```
node scripts/workflow/batch-closeout.mjs --attestation dev-memo/study/<date>-batch-audit-*.md
```

It re-derives the window, verifies the attestation + range-bound broker output, preflights commit
blockers, writes `dev-memo/run/.closeout-pending`, advances the marker, creates the batch-close commit
(study packet + closeout-log), and removes the sentinel last. On any failure it writes nothing or
restores the marker. If interrupted, re-run it (or `--reconcile`) — the sentinel keeps the breaker
blocked until reconciled. The closeout never commits product code and never advances the marker
without a verified, range-bound broker PASS.
