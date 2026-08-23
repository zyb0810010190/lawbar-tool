# The WI loop — auto-advance, and when it must refuse to

Companion to `docs/development-workflow.md`. That file says how ONE work item is done;
this says when the next one may start without asking.

## The constraint this design exists for

**Corrected statistic (the first draft of this file was selection-biased).** It claimed
"zero of six work items could safely auto-advance." Six is not the population — it is the
six LARGE items, chosen after the conclusion was already formed. The full session ran
eleven, and the small ones were fine:

| Size | Items | Would auto-advance safely |
|---|---|---|
| Large | release-script suite, truncation, genesis guard, scanner scope, doc sweep, CLAUDE.md | **0 of 6** |
| Small | extractor fix, 4 wrong-pointer repoints, skipReason vacuous-pass fix, two lane descriptions, 18 ADR banners | **5 of 5** |

So the predictor is not green-versus-not. It is **size**. Every large item ended in a
finding an independent pass caught or a fork only the maintainer could settle — one "fix"
was completely inert, and the gate reported OK because nothing had changed. Every small,
single-purpose item was genuinely done when its gate went green.

That is what the tiering below encodes. Green alone is sufficient for a T0. It is nowhere
near sufficient for a T2.

## Completion states

Every WI ends in exactly one. The set is **total** — every outcome maps somewhere — and
where two could apply, precedence decides.

| State | Meaning | Loop action |
|---|---|---|
| **CLEAN** | Every check **required by the item's tier** ran, and all passed | advance |
| **FINDINGS** | A required check ran and reported something fixable — a failing gate, a failing test, or an independent-pass finding | fix → re-verify → re-classify, in the same tick, max 3 rounds |
| **DECISION** | A fork only the maintainer can settle | **HALT**, report the fork |
| **BLOCKED** | A required check **could not run** — tool absent, runner stalled, dependency missing | **HALT**, report the blocker |

**Precedence, when more than one fits:** `DECISION > BLOCKED > FINDINGS > CLEAN`. A fixable
finding that is also a fork (High severity, scope-widening, new dependency, product
guarantee, hard stop) is **DECISION**, not FINDINGS.

**Round 4.** If three repair rounds have not produced CLEAN, the state becomes **DECISION** —
three failures means the item is not what it was thought to be. Record `rounds: 3` in the row.

**A failing gate is FINDINGS, not BLOCKED.** The distinction is *ran and failed* versus
*could not run*. An earlier draft left a running-but-failing gate matching no state at all.

### What each tier requires before CLEAN

**This is the canonical tier table. `docs/development-workflow.md` defers to it** — an earlier
draft defined tiers in both files with different contents, which is a drift waiting to happen.

| Tier | Applies to | Required before CLEAN | Rough cost |
|---|---|---|---|
| **T0** | comments, docs, renames, test-only additions | stage 11 + the repo gates; **stage 3 only where an executable assertion exists** | seconds |
| **T1** | a bounded change inside one package | stages 2, 3, 5, 10, 11 + **one** independent pass (`/tdd-guardian:review` or a context-free subagent) | ~2 min |
| **T2** | anything touching a court-facing invariant: audit chain, evidence links, export/DOCX, signing, persistence schema, IPC contract | **every GATE stage** — see the classification table below, which is authoritative; do not re-list the numbers here | ~15 min, real tokens |

T0 has **no** independent-pass requirement — that is deliberate, and CLEAN is defined per
tier precisely so a T0 can reach it.

**GATE stages versus ADVISORY stages.** An earlier draft said T2 "skips nothing", and that
deadlocked the loop on its very first real tick: stage 4 (loc-guardian) is not initialised
in this repo, an unrunnable required check is BLOCKED, and BLOCKED halts — so no T2 item
could ever start. The workflow document already called stage 4 "advisory input to stage 6,
not an independent gate"; the tier table contradicted it.

Classification is **total** over every numbered stage in the workflow — an earlier draft
named 9 of the 13 and left 6, 7, 9 and 10b belonging to neither category.

| Stage | | Class | Unrunnable means |
|---|---|---|---|
| 0 | posture | gate | BLOCKED |
| 1 | spec-adversary | advisory | recorded, not blocking |
| 2 | preserve baseline — `scripts/workflow/wi-baseline.sh preserve` | gate (T1/T2) | BLOCKED — except greenfield, below |
| 3 | red → green | gate | BLOCKED |
| 4 | size | advisory | recorded, not blocking |
| 5 | two-sided verification — verdict from `wi-baseline.sh classify`, by FAILURE KIND not exit code | gate (T1/T2) | BLOCKED — except greenfield, below |
| 6 | independent audit | gate (T2) | BLOCKED |
| 7 | test-quality review | gate (T2) | BLOCKED |
| 8 | mutation spot-check | gate (T2), advisory (T1) | per tier |
| 9 | independent confirm | gate (T2) | BLOCKED |
| 10 | artifact integrity | gate | BLOCKED |
| 10b | record observables | gate — failure predicate below | BLOCKED |
| 11 | close out | gate | BLOCKED |

**What actually enforces any of this: almost nothing.** The table above marks eleven stages
as gates and the word BLOCKED appears twenty times in this file. Read plainly, that says a
machine stops the work. It does not. This repo's own posture is that hooks are advisory and
CI is the only enforcement boundary — and CI runs the package test suites, `dist`, and
`smoke-matrix`. It runs no stage of this workflow. Verified against `.github/workflows/`:

**First, the precondition that swallows the rest of this table.** Three of the four workflows
trigger on `pull_request` only — there is no `push` trigger. Nothing here runs on a commit,
on a branch, or locally. At the time of writing this branch was 95 commits ahead of
`origin/main` with nothing pushed and no PR open, which means CI had run **zero times** for
every work item completed so far. "Enforced by CI" therefore means "will be enforced, once
someone opens a pull request" — never "was enforced when the work was done".

**Second, every workflow is `paths:`-filtered,** so even on a PR a job fires only if the diff
touches its paths. `desktop-release-gates.yml` watches `apps/lawbar-desktop/**` and
`docs/contracts/**`. A work item touching only `services/case-box-persistence/**` matches
neither, and `services-ci.yml` does not run the tarball or lock checks at all.

| Stage | What actually enforces it |
|---|---|
| 3 red → green | **conditional** — on a PR whose diff touches that package's watched paths, CI runs its suite, so a failing test is caught. Nothing anywhere checks the test was written *first*. |
| 10 artifact integrity | **conditional** — `check:internal-tarballs` and `check:internal-lock` run in `desktop-release-gates.yml`, which fires only for PRs touching `apps/lawbar-desktop/**` or `docs/contracts/**`. A persistence-only item does **not** fire it. |
| 11 close out | **conditional** — `check-no-real-data` runs inside the desktop `pretest`, so it inherits exactly the same PR-and-path precondition. |
| 2 and 5 | **tested, not enforced.** Their logic is `scripts/workflow/wi-baseline.sh`, covered by 17 behavioural cases in the `workflow-scripts` lane (9 of 9 mutations killed). That stops the logic from silently rotting; it does not make anything run the stage. No CI workflow invokes this lane. |
| 0, 1, 4, 6, 7, 8, 9, 10b | **nothing, under any condition.** No hook, no CI job, no script. |

An earlier version of this table said stage 10 was enforced, flatly. That was written one
round before this one, in the same pass that removed other over-scoped claims from these
documents — which is the clearest evidence available that this failure mode is not rare and
not yet trained out.

So ten of thirteen stages are held up by the executing agent choosing to honour this file, and
the other three are held up by it too until a pull request exists. That is not an argument for deleting the gate vocabulary — the stages earn their
keep, and three audits of this document found defects precisely because they were applied. It
is an argument against ever citing "stage 5 is a gate" as evidence that stage 5 happened. The
row's Evidence and Notes columns are the only record that it did, and a row can be written by
the same agent that skipped the stage.

This is the same rule the repo already applies to hooks — never cite a hook result as proof —
extended to the workflow that replaced them. If you want any of these ten enforced rather than
merely intended, the mechanism is a CI job, and today there is not one.

**Greenfield exception, stated canonically here.** Stages 2 and 5 prove a regression test
fails against pre-change code. For a symbol that does not exist yet, every test fails
against the baseline trivially — a compile error, not evidence a test has teeth.

The test is therefore narrow, and it has been wrong twice — each time in the direction of
waiving the gate, so state it carefully.

**Greenfield means no existing HEAD entrypoint can reach the behaviour being changed.** Not
"the WI only adds behaviour" (the first wrong version), and not "every symbol the tests call
is absent at HEAD" (the second). The second is gameable in one step: wrap a change to
existing code in a new helper, point the tests at the helper, and the item classifies as
greenfield while the changed behaviour is still reachable through the old product path. The
question is what the CHANGE touches, not what the tests happen to import.

The unit is also finer than a work item. WI-07 had both kinds at once: its pure-function
suite called a module absent at HEAD and was correctly greenfield, while its wiring guard
read the built `main.js` and failed at baseline with a real assertion. One item, two
classifications, and the item as a whole was NOT greenfield. Classify per test, not per row —
and see the executable discriminator in `docs/development-workflow.md` stage 5, which decides
this from the failure kind rather than from anyone's judgement.

The earlier "only adds behaviour" wording wrongly cleared two items. WI-03 added a gate *inside*
`openSqliteCaseBoxPersistence`, which already existed — so a baseline run could open a
corrupt database and observe the old, wrong behaviour, which is a real two-sided test and
was skipped. WI-04 explicitly extends an existing restore drill. Neither was greenfield.
Adding a new function to an existing file does not make the work item greenfield; only the
tests' reachability at HEAD decides it.

When it does apply, record `no baseline — greenfield` in `Notes` and treat stages 2 and 5
as satisfied. They remain gates for any change to behaviour that already exists.
`docs/development-workflow.md` defers to this.

**Stage 10b is not machine-checkable — see the enforcement map above; the row is free-form
Markdown and nothing reads it. What follows is a classification rule the executing agent
applies to itself, not a gate something else will trip. It is also TIER-AWARE: a T0 has no
independent-pass requirement, so it has no agent, model or finding ids to record, and
demanding them would either block valid T0 work or invite a fabricated `none` for a pass that
never ran — record `independent pass: not required (T0)` instead. For any item where an
independent pass WAS required or actually run, classify FINDINGS, not CLEAN, when any of
these is absent from the row or its report:** the exact command invoked, the agent or model name, the finding ids
returned (or the literal `none`), the diffstat, and the list of files touched measured
against the WI's *declared* files. Any file touched outside the declared list is a finding
in its own right, not a footnote. This predicate exists because the column above says only
what *unrunnable* means, and writing a note is always runnable — so as written, 10b was a
gate no input could fail.

A stage being advisory is not permission to skip it silently. If it did not run, the row
must say so and why.

**Advisory-UNRUNNABLE and advisory-FINDING are different things.** Advisory means an
*unrunnable* advisory stage does not block. It does **not** mean an advisory stage's
findings are ignorable. The spec-adversary (stage 1) exists precisely to find a wrong spec
before implementation; letting implementation proceed over its findings wastes the stage
entirely. Material advisory findings become FINDINGS or DECISION **before stage 3**, judged
by the same DECISION list as anything else.

Budget a six-item T2 queue at roughly ninety minutes of independent passes before any of
the actual work.

## What counts as DECISION — halt on any of these

Not a judgment call. If the WI produced any of the following, the loop stops:

- A change to a **product guarantee** — what the tool claims about tamper-evidence.
- A **new dependency**, a new key, or anything stored outside the repo.
- A choice between two defensible designs the WI text does not already decide.
- A **hard stop** from `CLAUDE.md` — push, PR, merge, branch delete, real client data.
- A finding whose fix would **genuinely widen** scope beyond what the WI describes —
  meaning the work becomes something other than what the WI says. A merely *mislocated*
  declared-files field is NOT this; see the scope bullet below, which controls that case.
- Any finding rated **High or above** that the loop did not itself close.
- **Changing, deleting, weakening or reinterpreting a test or an acceptance criterion.**
  The workflow already forbids an auto-fixer doing this; without it here, the loop could
  route the same act through ordinary FINDINGS repair.
- **The WI itself is wrong in a way that changes what the work IS** — its `Done when` is
  not achievable or not checkable, its tier is mis-assigned, or its intent is ambiguous.

  *Not* every scope error. Found on the first real tick: WI-02's declared files named
  `services/case-box-persistence/src/**`, but document bytes are managed in
  `apps/lawbar-desktop/src/caseBox/documentStorage.ts` — persistence holds only the
  metadata. The intent ("re-hash stored files against their recorded `content_hash`") was
  never in doubt; only the path field was wrong. Halting a run for that is the rule being
  too coarse. **Mislocated scope with unambiguous intent: correct the row, record the
  correction in `Evidence`, continue. Scope that is genuinely wider or different than the
  WI describes: DECISION.** The test is whether correcting it changes what the work is.
- **Three repair rounds elapsed** without reaching CLEAN.

## Loop mechanics

Dynamic `/loop` — the model self-paces; there is no interval to tune. `ScheduleWakeup` is
the harness primitive `/loop` uses in dynamic mode; it is not a repo file, so do not look
for one.

```
/loop budget=6 Execute the next ready WI in docs/wi-queue.md per docs/development-workflow.md.
      Classify CLEAN / FINDINGS / DECISION / BLOCKED per docs/wi-loop.md, write the outcome
      and its evidence into the queue row, advance only on CLEAN, halt on DECISION or BLOCKED.
```

**Refuse to start without a budget.** `budget=N` caps the WIs a run may complete. A loop
with no ceiling is a runaway, and "a budget bounds the run" is not a budget.

Per tick:

1. **Read** `docs/wi-queue.md` and record its sha256 as `base_hash`.
2. **Select** the first row whose `Status` is `ready` **and** whose `Depends` are all
   `CLEAN`. If none, stop the loop and say why — empty queue and fully-blocked queue are
   different outcomes and must not print the same message.
3. **Claim** it: set `Status: in-progress`, `Owner`, `Since` (ISO). Write, then re-read.
4. Run the stages its tier requires.
5. Run the tier's independent pass. **Record which one ran, by name.** A pass that did not
   run is BLOCKED — never CLEAN.
6. **Classify** per the table above, applying precedence. On FINDINGS, repair and
   re-classify **within this same tick**, up to 3 rounds; only the final state is written.
7. **Write back** the outcome, evidence and round count.
8. `CLEAN` → `ScheduleWakeup` for the next WI, unless the budget is spent.
   Anything else → `ScheduleWakeup({stop:true})`.

### Writing to the queue safely

The loop reads and writes the same file, so an unguarded write can lose a human edit or
leave a corrupt table.

- **Compare-and-swap, re-based after every write the loop itself makes.** Hold a
  `expected_hash`, initially the file's hash at step 1. Before each write, re-read; if
  the hash differs from `expected_hash`, abort and report — someone edited the queue
  mid-tick. **After each of the loop's own successful writes, set `expected_hash` to the
  new file's hash.** An earlier draft captured `base_hash` once at step 1, so the claim
  write at step 3 invalidated it and the final write aborted every time — the loop could
  never complete a tick. Found by the second audit, not by running.
- **Atomic replace.** Write to a temp file, then rename. Never edit in place.
- **Evidence goes in its own columns**, never crammed into one prose cell: `Pass` (which
  independent pass ran), `Rounds`, `Evidence` (a path to a report file, **path only**), and
  `Notes` (one short line — advisory stages skipped and why, scope corrections). Anything
  longer belongs in the linked report. A finding containing a pipe or newline would
  otherwise break the Markdown table.

### Status transitions

`Status` is control state; `Outcome` is the result of the last tick. The loop sets both.

| On | Status becomes | Outcome becomes |
|---|---|---|
| claim | `in-progress` | unchanged |
| CLEAN | `done` | `CLEAN` |
| DECISION | `held` | `DECISION` |
| BLOCKED | `held` | `BLOCKED` |
| FINDINGS, rounds remaining | *(transient — never written; the tick is still running)* | — |
| FINDINGS, 3 rounds spent | `held` | `DECISION` |

`held` always means a human must act: nothing but a human moves a row out of `held`. That is narrower than an earlier draft, which said nothing but a human returns a row to `ready` at all — flatly contradicting the stale-row recovery two paragraphs below, and the same rule in `docs/wi-queue.md`. Stale `in-progress` rows are the one automatic return to `ready`, and they are deliberate: they fail toward recovery, not toward a permanent lock.

A row must never sit `in-progress` with material findings recorded and `Outcome` still
empty. The first live tick did exactly that — WI-02 carried "10 spec gaps" in its notes
while `Outcome` was `—`. Per the advisory-finding rule above, those gaps are FINDINGS and
the row must say so before implementation starts.

### Recovering a stranded item

A tick that dies after step 3 leaves `in-progress` forever, and step 2 only selects
`ready`. So: an `in-progress` row whose `Since` is older than 60 minutes is **stale**. The
next tick resets it to `ready`, appends a note, and does not silently retry — a WI that
stranded once may have stranded for a reason.

### Non-negotiables

- **The queue is a file, not memory.** Compaction silently summarises a list held in
  conversation; a later tick then works the wrong item. Re-read every tick.
- **The loop never pushes, never opens a PR, never `git add .`.** Hard stops in
  `CLAUDE.md`; no loop state authorises them.
- **Committing is opt-in and off by default.** When on, commit only after CLEAN, explicit
  paths only. Left off, changes accumulate and `git diff HEAD` stops being a usable scope —
  so turn it on for runs past ~3 WIs.
- **A tick that changes nothing is still reported.** "Checked, nothing to do" is a result.

## Why not `Workflow` or `/tdd-guardian:workflow`

`/tdd-guardian:workflow` already chains plan → design-tests → implement-per-WI → coverage →
mutation → review, and it is the right tool *inside* one WI. It does not persist across
turns, and it halts only on gate failure — it has no DECISION state, which is the state
that mattered five times out of six here.

The `Workflow` tool spawns many agents in parallel. That suits a fan-out; a WI queue is
inherently sequential, because each item may change what the next one should be.


## Untested

**Which ticks have completed is not recorded here** — `docs/wi-queue.md` holds it, one row
per item, and that is the only copy. Do not restate a count from a table that changes every
tick.

What the queue cannot tell you, and what this file exists to say: **unattended advance is
still unproven.** Every tick so far was started by an explicit human instruction, so the loop
has never selected its own next row. Classification, repair rounds and write-back have all
executed end to end more than once — but do not cite CLEAN outcomes as evidence that
auto-advance works. They are evidence that the stages and the write-back work.

Budget for a repair round: completed ticks have generally needed one, triggered by an
independent pass rather than by a failing test. The `Rounds` column has the figures.

This paragraph was itself stale for two whole ticks: it still read "no item has completed"
after both had. That is the failure this file warns about, committed by this file. Keep
correcting it from what actually happens rather than from what it says.
