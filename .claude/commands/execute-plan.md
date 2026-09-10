---
description: Implement one or more plan files end to end — execute every WI, stamp each item's completion back into its plan after the repo gate passes, then audit the built code against each plan and close the gaps. Use when handed written plans and asked to ship them completely rather than partially. Never pushes, never merges, never runs an unattended fixer.
argument-hint: "<plan-file>..."
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Skill
---

<!--
ADAPTED FOR lawbar-tool from a generic /execute-plan. Each departure was measured against this
repository before it was made; none is a matter of taste.

1. NUMBERED HEADINGS ARE NOT WORK ITEMS. The generic version parsed `## 1.` as an item boundary.
   Across dev-memo/plan-*.md that rule manufactures 251 spurious items — sections named
   "Problem statement", "Governance / sequencing (hard requirements)", "Stop condition" — and
   would then implement them, stamp them, and write DONE into governance documents. Only
   checkboxes and `WI-<n>` labels are boundaries here.
2. THE STAMP IS `**Done:**`, NOT `**Status:**`. `Status:` is already an overloaded field in this
   repo — it carries `design`, `completed`, and `DRAFT — non-authorizing` in different files, and
   a first-match scan of it reports shipped plans as drafts. It is not reliable enough to add
   completion state to.
3. `TaskCreate` / `TaskUpdate` DO NOT EXIST in this build. Progress is a printed tally.
4. "VERIFIED" MEANS THE REPO GATE, NOT "A CHECK RAN". This session alone produced a test that
   passed locally and failed in CI, a test that could only pass in CI, and several that passed
   while proving nothing until a guard was added. The bar here is two-sided: a regression test
   must FAIL on the pre-change code, and additive work is verified by mutation.
5. THE UNATTENDED AUDIT-FIX STEP IS REMOVED. Its report ends by recommending `git checkout .`,
   which discards every uncommitted change in the tree; it fixes all findings without asking; and
   this repo records autonomous fixers editing outside scope and misreporting it. Run
   /cc-suite:audit-fix by hand, on a clean tree, when you choose to. What REPLACES it (added
   2026-09-10, after two R2 items merged with no second head on new IPC boundary code) is a
   READ-ONLY review station in Step 3 item 5: the Codex runner, one file per job, findings
   verified before anything is touched.
6. HARD STOPS ARE RESTATED HERE because a command that "ships completely" is exactly where they
   get forgotten. See Rules.
-->

## User Input

```text
$ARGUMENTS
```

Every token is a plan path. At least one is required. Plans are processed in the order given, so
list a prerequisite plan before the plan that depends on it.

## Goal

Carry each plan from written intent to verified code, without leaving the machine:

1. Implement every work item in every plan — no partial delivery.
2. Record each item's completion inside its own plan file, only after the repo gate passes.
3. Audit the built code against each plan and close every gap found.

Report honestly at the end. A work item that could not be finished is reported as blocked, never
as done. Nothing is pushed, merged, or committed by this command — the tree is left for the owner
to review.

## Step 1 — Parse and validate input, or stop

1. If `$ARGUMENTS` is empty, stop. Print `Usage: /execute-plan <plan-file>...`, then run `Glob`
   on `dev-memo/plan-*.md` and `docs/product/*.md` and list what you find as candidates. Do not
   guess which files were meant.
2. Confirm every path exists and is readable. If any fails, stop and print each failing path. Do
   not create any file.
3. `Read` every plan file in full before touching any code.
4. Print the resolved plan list in processing order.

## Steps 2–4 run once per plan

Fully complete Steps 2, 3, and 4 for one plan — extract, implement, gap-audit — before starting
the next, so a later plan that builds on an earlier one sees finished work. Keep a per-plan tally
(items done, items blocked, gaps closed, gaps outstanding) for the final report.

Below, "the plan" means the plan currently being processed.

## Step 2 — Extract the work items

1. Parse the plan into a list of work items. **Exactly two things are item boundaries:** a
   checkbox line (`- [ ]` / `- [x]`) and a heading containing a `WI-<n>` label. Nothing else is.
   A numbered heading such as `## 3. Acceptance criteria` is a document section, not a task, and
   must not be parsed as one.
2. If the plan contains numbered headings, print them under the line
   `Not parsed as work items (section headings):` so the owner can see what was deliberately
   excluded. This is a report, not a warning.
3. If the plan yields zero work items, note it in the tally, print the plan's headings, and move
   to the next plan. Do not invent items.
4. Re-read any `**Done:**` stamps already present (see Step 3). Stamped items are skipped — this
   command is resumable and safe to re-run.
5. Print the parsed item list and the skip count before writing any code.

## Step 3 — Implement each item, stamping completion as you go

Work items one at a time, in plan order. For each item:

1. **Record the baseline.** Before editing any source file, copy it outside the repo and note its
   `sha256`. A regression test written for this item must be run against that baseline and must
   FAIL there; a test that passes both before and after is not testing the change. Where no such
   seam exists yet, building it is part of the item.
2. Implement the smallest change that fully satisfies the item as written — `Write` for new
   files, `Edit` for existing ones. If the item touches `docs/contracts/case-box-contract` or
   `services/case-box-persistence`, remember they reach the app as COMMITTED TARBALLS: run
   `npm --prefix apps/lawbar-desktop run check:internal-tarballs` and repack on drift, or the app
   under test is not the code you changed.
3. Register any new `tests/*.test.mjs` in `apps/lawbar-desktop/package.json` `scripts.test`. That
   list is hand-maintained; a file not named there never runs and looks like coverage.
4. **Verify with the repo gate**, not with whichever single check is convenient:
   - `/tdd-guardian:gate commit` — AND, whenever the item touched `apps/lawbar-desktop/`,
     `/tdd-guardian:gate desktop` as well. The desktop lane is bound to `push`, not `commit`,
     so the commit gate alone never runs the tests for desktop changes. Found the first time this
     command was exercised: nine lanes went green without executing the file that had changed.
   - `npm --prefix apps/lawbar-desktop run check:no-real-data:all`
   - `node scripts/docs/check-doc-references.mjs`
   - `npm --prefix apps/lawbar-desktop run check:internal-tarballs` if either internal package changed
   For additive work, where red-first is inherently inconclusive, run at least one mutation
   against each claim the item makes and record which mutants died. A surviving mutant is either
   a missing test or a measurement that corrects the claim — say which.
5. **Independent review, read-only, before the stamp.** The gate proves the code does what its
   own tests say; it cannot see what the same head wrote and then tested. Whenever the item added
   or changed BOUNDARY code — an IPC handler, a preload entry, a DTO allowlist, an error mapper,
   a persistence query, anything the audit chain or the store touches — put each such file through
   a second head before stamping. This is a review, not a fixer: nothing it says is applied
   without being verified against the file first.

   The route is cc-suite's Codex runner, invoked by absolute path (no `/cc-suite:init`):

   ```bash
   bash ~/.claude/plugins/cache/xiaolai/cc-suite/2.0.1/scripts/codex-preflight.sh   # model list first; never guess a slug
   node ~/.claude/plugins/cache/xiaolai/cc-suite/2.0.1/scripts/codex-runner.mjs \
     --kind audit --model <slug from preflight> --effort high --sandbox read-only \
     --timeout-ms 540000 -- "$(cat <prompt-file>)"
   ```

   Constraints, each learned the hard way:
   - **One job per file.** A combined job stalls past the deadline.
   - **Inline the text.** Paste the unified diff plus every whole function it touches, and say
     "do not run commands, read files, or search; every fact you need is below." Pointing Codex
     at the tree makes it explore until the deadline.
   - **Gate what you transmit.** Run the prompt file through the eight PATTERNS in
     `apps/lawbar-desktop/scripts/check-no-real-data.mjs` first (the CLI reports "0 files in
     scope" for a scratch file, which is vacuous — apply the regexes directly). Never inline the
     `f86c8e4` diff.
   - **Findings are evidence, not verdicts.** Verify each against the file. A verified High or
     Medium blocks the stamp until it is fixed and the full gate in item 4 has run again; a Low
     is recorded under **Outstanding work**. A finding that does not survive verification is
     recorded as such — the disagreement is part of the trail.
   - **If the route is unreachable** (preflight fails, or the job stalls twice), substitute a
     fresh subagent with no conversation context given the same inlined text, and say in the
     stamp which head was used.

   Record the review in the stamp as `**Reviewed:** codex <thread id> — N findings, M verified,
   K fixed` (or `subagent` in place of `codex`, or `not required — no boundary code`).

6. Quote the result line of each check. Then, and only then, `Edit` the plan to stamp the item
   directly beneath its heading, using this exact block:

   ```markdown
   **Done:** 2026-01-01
   **Changed:** path/to/file.ts, path/to/other.ts
   **Verified:** gate commit (1284 passed) · no-real-data OK · doc-references 172/172 · mutants 3/3 killed
   **Reviewed:** codex 01a0abcd — 3 findings, 2 verified, 2 fixed
   ```

   Use `**Blocked:** <what stopped it>` in place of the three lines when the item cannot be
   finished. Never stamp `Done:` on a partial item; a partial item is blocked, with the remainder
   named.

Stamp **after** the gate passes, not before. If the plan file is read-only, stop and report — the
completion trail is part of the deliverable.

Do not begin Step 4 while any item in this plan is unstamped.

## Step 4 — Audit the code against the plan, then close the gaps

1. Re-read the plan file from disk, including the stamps written in Step 3.
2. For each work item, locate the code that implements it with `Grep` and `Glob`. Confirm the
   behaviour the plan describes exists in the code — read it, do not count matches.
3. Build a gap list. A gap is any of:
   - An item stamped `Done:` with no implementing code found.
   - Implemented behaviour that contradicts what the plan specifies.
   - A plan requirement with no test covering it, or whose test cannot fail.
   - A file the plan names that was never created or modified.
   - A claim in a stamp that the checks it cites did not actually establish.
4. Print the gap list before fixing anything. If it is empty, print `No gaps found` for this plan
   and move on.
5. Close every gap, then re-verify with the full gate from Step 3.
6. Repeat 2–5 until a full pass produces an empty gap list, to a maximum of 3 passes. Gaps that
   remain after the third pass go in the tally as outstanding — do not loop forever, and do not
   mark them closed.

When this step finishes, return to Step 2 for the next plan. Once every plan is done, go to Step 5.

## Step 5 — Final report

Include the `**Reviewed:**` line of every stamped item in the report, so a reader can see which items had a second head and which were declared to need none.

Print this structure and nothing beyond it. Repeat the per-plan block once for each plan, in
processing order, then print one combined summary.

```markdown
## Plan execution report

### <plan-file>

| # | Work item | Outcome | Verified by |
|---|-----------|---------|-------------|
| 1 | <title>   | Done    | gate commit (n passed) · mutants k/k |
| 2 | <title>   | Blocked | — |

**Implemented:** <x> of <y> work items
**Gaps found and closed:** <count>
**Gaps outstanding:** <count or "none">

## Summary

**Plans:** <p> processed
**Work items:** <total done> of <total> across all plans
**Gaps outstanding:** <count or "none">

### Outstanding work
<one line per blocked item or open gap, naming its plan and the reason — or "None">

### Needs the owner's decision
<anything that requires push, PR, merge, a real-data check, or a legal judgment — or "None">

### Files changed
<path list — uncommitted; nothing has left this machine>
```

## Rules

- **Never** `git push`, create a PR, merge, or delete a branch. Never `git add .` or `git add -A`.
  Never `git reset --hard` or `git checkout .` — both discard the owner's uncommitted work, which
  this repo routinely carries between sessions. Do not commit; leave the tree for the owner.
- **Never** read, copy, or transmit real client material. Real documents are referred to by
  anonymous `DOC-nn` identifiers. Never read `~/.lawbar-a07-key` or any `.env`.
- **Never** weaken or remove the audit-chain mechanism. It is the product's court-facing claim.
- Never stamp `Done:` without the repo gate having passed, and never cite a check that did not run.
- `Skill` is permitted for exactly one purpose: `/tdd-guardian:gate commit`. It is not licence
  to invoke `/cc-suite:audit-fix` or any other fixer from inside this command. The cc-suite
  **runner** in Step 3 item 5 is different in kind — `--sandbox read-only`, one file per job,
  text inlined and gated — and is the only cc-suite invocation this command makes.
- Never widen scope past what a plan states. Note a needed change outside the plan under
  **Outstanding work** instead of making it.
- Never delete or rewrite existing plan prose — stamps are additive.
- Report a failed check with its output. A test that fails is reported as a failure, not smoothed
  over; a hook or marker is never cited as proof of anything.
- Stop and ask the owner when a plan is self-contradictory, when two plans in the batch contradict
  each other, or when an item requires a hard-stop action. Do not pick one reading and continue.
