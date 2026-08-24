# Development workflow

Derived from measured outcomes of the 2026-08-13 release-script and audit-chain TDD
sessions, not from general practice. Every stage below exists because something
specific went wrong without it, and the incident is named.

**Enforcement posture.** Nothing here is a hook. This repository deleted its
hook-enforcement layer twice (2026-08-10, 2026-08-12) after an audit found hooks were
bypassable string-matchers running inside the same uid as the thing they gated. This
document is a checklist a human drives; CI is the only enforcement boundary. Do not
cite a local gate result as proof of anything.

---

## What the workflow has to catch

Ranked by how often it actually bit, in one session:

1. **Vacuous passes — a test that cannot fail.** Three separate instances:
   `check-no-real-data` scanned **0 files** and reported clean; an assertion sliced an
   always-empty array and passed for every possible output; an opt-in lane *skipped*
   when its subject was missing and reported success. Coverage cannot see any of these.
2. **Claims that are true but wrongly scoped.** Repeatedly the headline held while the
   reasoning under it did not — a regex anchored at one end when both were needed; a
   document asserting "first token wins" when the loop makes the last one win; a
   finding listed as regression evidence that passed against both old and new code.
3. **Green tests against stale artifacts.** The desktop consumes two internal packages
   as *committed tarballs*. A verified fix sat green in its own lane while the shipped
   app still contained the vulnerable code.
4. **Specification errors, which are the expensive ones.** A test-design file list left
   three work items with nowhere to live — repeating verbatim an error the same
   document had already corrected once.

Note what is *not* on this list: ordinary logic bugs in freshly written code. The lanes
catch those — but only where a lane actually runs a registered test over the changed path.
That qualifier is load-bearing here: `scripts.test` is a hand-maintained list, CI workflows
are `paths:`-filtered, and `scripts/workflow/` is covered by no workflow at all. The workflow
below is for everything the lanes structurally cannot see, which includes anything they were
simply never pointed at.

---

## Tiers

**Defined canonically in `docs/wi-loop.md`** — the tier table there states, per tier, exactly
which stages and which independent pass are required before an item can be CLEAN. This
section previously carried a second table with different contents; it was deleted rather
than synchronised, because two tables that must agree are a drift waiting to happen.

Shorthand: **T0** trivial · **T1** a bounded change inside one package · **T2** anything
touching a court-facing invariant. When unsure, T2.

## Stages

### 0 — Decide the posture *before* designing tests

Characterise-first (pin what exists, then change) or fix-first (correct it, then write
tests asserting the corrected behaviour)? This one decision determines the expected
outcome of every case.

*Incident:* a 1,059-line test matrix was written characterisation-first; the posture
then changed to fix-first, and eleven cases had to flip. Deciding first costs a
sentence.

### 1 — Spec, then attack the spec (T2)

Design the test matrix, then run `tdd-guardian:tdd-spec-adversary` against it **before
any implementation exists**. Its job is to find a wrong implementation that passes
every case.

*Untried.* This agent has never been run in this repository; the recommendation rests on
its stated purpose, not on observed output. Treat the first use as an evaluation of the
agent as much as of the spec, and record whether it earned its place.

*Incident:* the most expensive errors of the session were specification errors, and
they were found late — by an implementer and a reviewer — when they were costly. A
spec is cheapest to attack while it is still only a spec.

### 2 — Preserve the baseline **(non-negotiable, and the highest value per minute)**

Before editing any source, copy the current implementation somewhere outside the repo
and record its `sha256`. Verify the copy matches `git show HEAD:<path>`.

This single step is what makes stage 5 possible. It cost minutes and produced the
strongest evidence of the session.

### 3 — Execute: red → green

Write the failing test, **show the actual assertion-failure output**, then the smallest
change that passes. The failure output is the only thing distinguishing TDD from
writing tests after the fact.

### 4 — Size advisory (see "loc-guardian" below)

Run **only against changed files**. Never repo-wide.

### 5 — Two-sided verification **(gate for T1 and T2; NOT APPLICABLE to greenfield — see the canonical rule in `docs/wi-loop.md`)**

Point the suite at the preserved baseline and run it again. Every test claiming to be a
regression test **must fail there**. A test that passes against both the old and the new
code is not testing the change.

Make it mechanical: have the harness accept a source path via an environment variable so
the whole suite can be aimed at the baseline in one command.

**The seam usually does not exist yet, and building it is part of the work.**
`LAWBAR_SCRIPT_DIR` exists in exactly one package — the release-script harness. (How many
files that harness covers is not recorded here; it has already drifted once. Count it with
`grep -rl LAWBAR_SCRIPT_DIR apps/lawbar-desktop/tests/` when the number matters.)
`services/case-box-persistence` — the package holding the audit chain, i.e. the main
subject of T2 — has **no equivalent**. The audit-chain fix of 2026-08-13 was verified by
an ad-hoc probe script that was then deleted, which is evidence that convinced the author
and is reproducible by nobody. Treat "add the baseline seam" as the first task of any T2
change in a package that lacks one, not as a precondition that happens to be satisfied.

*Incident:* 28 of 43 pre-fix failures were purpose-built regression tests; the other 15
were over-satisfaction. Without running both directions, all 43 would have been claimed
as regression evidence.

### 6 — Independent audit: `/cc-suite:audit-fix` (T2)

Codex audits read-only, then a fixer applies changes. **Reachable without cc-suite init** —
invoke the runner by absolute path; see `CLAUDE.md` for the exact call and the model-slug
trap. Proven 2026-08-22. Two constraints:

- **`--fixer=claude`** (the default). Codex audits without repo context, which is what
  makes it independent; fixing needs the context.
- **The fixer may not weaken a test to make it pass.** If a test has to change, that is
  a finding for a human, not an auto-fix.

*Incident:* repairing a helper bug turned a previously-vacuous assertion into a real one,
which then correctly failed. The right response was to sharpen the assertion. An
auto-fixer optimising for green would plausibly have deleted it.

### 7 — Test-quality review: `/tdd-guardian:review` (T2)

A different lens from stage 6: stage 6 asks whether the code is right, this asks whether
the tests mean anything — wiring-only assertions, mocked internal modules, security
checks that only inspect mock arguments.

*Incident:* it returned 0 High / 7 Medium / 9 Low on work that had already passed a
coverage audit at 100% and a mutation audit at 100%.

### 8 — Mutation spot-check (T1 sampled, T2 required)

No mutation tooling exists here and none can mutate a bash script, so this is hand-rolled:
6–20 mutants targeting exactly the invariants the change introduced. Apply one edit to a
copy, run the suite, record killed/survived. **Assert that each mutation actually applied**
— a no-op edit scores as a false result.

*Incident:* 18 mutants, 14 minutes, **2 survivors** — both real gaps, on code with **100%
line coverage**. Coverage proves a line ran; only mutation proves a test objects when it
changes.

### 9 — Independent confirmation: `node \~/.claude/plugins/cache/xiaolai/cc-suite/2.0.0/scripts/codex-runner.mjs --kind audit --model gpt-5.5 \\

\--effort high --sandbox read-only --timeout-ms 600000 -- "<verify prompt carrying the findings>"` (T2)

Confirms the stage-6 findings were actually resolved. Run after all code changes are
final, never between them.

### 10 — Artifact integrity **(non-negotiable — repo-specific)**

```
npm --prefix apps/lawbar-desktop run check:internal-tarballs
```

`case-box-contract` and `case-box-persistence` reach the desktop app as **committed
tarballs**. Editing their source and passing their lanes proves nothing about the app.
On drift, from the repo root (these are npm scripts, not shell commands):
`npm --prefix apps/lawbar-desktop run pack:internal && npm --prefix apps/lawbar-desktop run refresh:internal-tarballs && npm --prefix apps/lawbar-desktop install`, then re-verify the
fix is present in `node_modules/`.

*Incident:* fired on 2026-08-13. Persistence lane green; the desktop's installed copy did
not contain the fix.

### 10b — Record what is checkable, not what is asserted

Several phrases in this document are judgements, not measurements: "the smallest change",
"no fork surfaced", "a different head", "a fresh subagent with no conversation context".
An executor cannot verify any of them from the artifact alone. Where a stage depends on
one, record the **observable** instead: the command that ran, the agent or model name, the
finding ids returned, the diffstat, and the list of files touched versus the WI's declared
files. A claim with a recorded command behind it is checkable; the adjective is not.

### 11 — Close out

State: what changed, what was deliberately **not** changed and why, what needs a decision.
Write "none" rather than inventing one. Then confirm the standing constraints hold —
no real client data, nothing staged with `git add .`, **nothing pushed**.

---

## Verifying agent output

Agents return evidence, never verdicts.

The honest sample, stated as a sample rather than as a measurement: across three research
agents, **11 claims were spot-checked and 10 held exactly as stated**. The eleventh — a
"nothing exists" claim — had two matching files behind it, and only checking revealed both
were false positives. That is one sample, not a rate, and it says nothing about the claims
that were *not* checked.

**Rule:** spot-verify every claim that drives an edit, a severity rating, or a decision.
Five of five reviewer findings verified as stated; the one unverified claim class was the
one that was imprecise. Verification is minutes; acting on a wrong finding is not.

---

## loc-guardian

**Do not enable a global limit.** Measured 2026-08-22: **32 source files already exceed
500 lines**, the largest at 963. A repo-wide gate produces 32 day-one violations against
files nobody is touching, and a gate that is always red is a gate that gets ignored —
the same reasoning that set every coverage threshold in this repo to 0 rather than to a
number that is unmeasurable rather than merely unmet.

Enable it as either:

- **changed-files-only** — the limit binds on files this change touches, or
- **a ratchet** — an oversized file may not grow; it does not have to shrink.

**Interface caveat, verified 2026-08-22.** `/loc-guardian:scan` takes `[language] [path]` —
a single optional path, not a list. "Changed files only" is therefore not directly
expressible: it needs one invocation per changed file, or a scan scoped to the smallest
directory containing them. Confirm the tool's behaviour before relying on this stage;
an earlier draft of this document asserted a plural-path signature that does not exist.

When it is available, run it at **stage 4** — after implementation, before external audit —
to flag oversized changed files. It cannot promise an auditor is never handed a 900-line
file: loc-guardian is not initialised in this repo, and advisory tooling that is not running
guarantees nothing. If it did not run, record "size advisory unavailable" and do not claim
size was gated. Its findings are advisory input to stage 6, never an independent gate.

---

## The command sequence

```bash
# 0  state the posture in one sentence: characterise-first, or fix-first?
# 1  (T2) design the matrix, then attack it before any implementation exists
#     Agent: tdd-guardian:tdd-spec-adversary   — untried here; see stage 1

# 0 + 2  set-up and baseline, both owned by scripts/workflow/wi-baseline.sh
#
# This used to be ~60 lines of shell inline here. Four audits found defects in it repeatedly —
# a verify loop that skipped git trees so a tampered baseline passed; $SCRATCH used everywhere
# and defined nowhere, making cleanup resolve to `rm -rf /baseline-desktop`; an apostrophe in
# a "${VAR:?...}" message that unterminated a quote and broke 200 lines of parsing. All of
# those fail on the first test run and none of them failed sitting in a code fence.
#
# The logic now lives in one place with behavioural tests over real temp git repos, and every
# defect above is pinned by a case in scripts/workflow/wi-baseline.test.mjs. Do not restate
# its behaviour here; call it.

export SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/lawbar-wi.XXXXXX")"
export PATHS_UNDER_CHANGE="<literal git pathspecs — NOT the queue prose column>"
export GREENFIELD="<yes|no: can NO existing HEAD entrypoint reach the behaviour you change?>"

bash scripts/workflow/wi-baseline.sh check-paths || exit 1

# WHICH BASELINE MECHANISM applies must be decided BEFORE preserving anything. The desktop
# package baselines as a BUILT PACKAGE snapshotted from the working tree; every other package
# baselines as git blobs read from HEAD. Those need different preconditions, and getting the
# order wrong makes the next work item unrunnable: `preserve` refuses a dirty tree, so running
# it first aborted every desktop item before it reached the desktop block below — the block
# that exists specifically to handle a dirty tree.
if printf '%s\n' $PATHS_UNDER_CHANGE | grep -q '^apps/lawbar-desktop'; then
  DESKTOP_WI=yes
else
  DESKTOP_WI=no
fi

if [ "$DESKTOP_WI" = no ]; then
  # Git-blob baseline from HEAD. Requires a clean tree, and says so with the remedy.
  bash scripts/workflow/wi-baseline.sh preserve || exit 1
fi
# For a desktop item the baseline is the package snapshot built below — which is a STRONGER
# baseline than the blob comparison, not a waiver of it: it captures the whole buildable
# package rather than a list of files.

# --- apps/lawbar-desktop needs a BUILDABLE baseline, built HERE, before any edit ------
# Skipped entirely for a non-desktop item, and for a greenfield one — neither has a
# pre-change behaviour to compare against. See DESKTOP_WI and GREENFIELD above.
#
# WHY THIS IS ONE LINE NOW. Until GAP-3 this was ~75 lines of shell living in this fence, and
# it was the most defect-prone text in the repo: four adversarial audits found defects in it,
# including a lockfile guard that could never pass and a `$SCRATCH` that was used everywhere
# and defined nowhere, so cleanup resolved to `rm -rf /baseline-desktop`. None of those fails
# while sitting in a fence nobody executes.
#
# It now lives in scripts/workflow/wi-baseline.sh with 11 behavioural cases (D-1..D-11) over
# real git repos. The reason it stayed prose for so long was a mis-stated blocker — "needs a
# 613 MB clone and a full build" — but 613 MB is the size of the production input, not a
# property of the logic, and a fixture of a few kilobytes drives the same code paths.
#
# What it does, so you can review the result rather than trust the name:
#   clean tree  -> a detached HEAD worktree, node_modules CLONED (never symlinked — a symlink
#                  points into the live tree and the restore below would corrupt it), then the
#                  COMMITTED tarballs restored over it, because the internal packages arrive as
#                  tarballs and HEAD source against current tarballs is a MIXED tree.
#   dirty tree  -> a snapshot of the WORKING TREE, and deliberately NO tarball restore. Found
#                  the hard way: HEAD was once 69 files behind, so a HEAD baseline was missing
#                  three earlier work items and the new test failed there for unrelated
#                  reasons — which reads as "regression confirmed" and is worthless.
#   both        -> a build, which is a free self-check and really fires. If the baseline does
#                  not compile against its own deps the tree is MIXED, stage 5 is VOID, and it
#                  refuses rather than handing back a path.
# It writes "$SCRATCH/baseline-kind" (head|snapshot) and prints the baseline package path.
if [ "$DESKTOP_WI" = yes ] && [ "$GREENFIELD" = no ]; then
  BASELINE_PKG="$(bash scripts/workflow/wi-baseline.sh desktop-baseline)" || exit 1
  echo "desktop baseline ready at: $BASELINE_PKG"
fi   # DESKTOP_WI

# 3  red -> green   (show the failure output)
# From the PACKAGE root: NEW_TEST_FILE is package-relative, and running it from the repo
# root yields file-not-found — which looks exactly like the red output stage 3 wants.
: "${PACKAGE_DIR:?the package root, e.g. apps/lawbar-desktop}"
( cd "$PACKAGE_DIR" && node --test "$NEW_TEST_FILE" )

# 4  size advisory, changed files only
# one invocation per changed file — scan takes ONE optional path, not a list (see the caveat above)
# NOT shell: `/loc-guardian:scan` is a slash command, and a bash block would parse it as an
# absolute path and fail with command-not-found. Invoke it as a slash command, once per
# changed file, passing an empty language so the file binds to the path argument:
#     /loc-guardian:scan "" <file>
# loc-guardian is not initialised in this repo, so record "advisory unavailable" and move on.

# 5  two-sided
# The seam is PER-PACKAGE. `LAWBAR_SCRIPT_DIR` is valid ONLY for the release-script
# harness — one package, see the note above. Substituting it anywhere else does
# not fail: the variable is simply ignored, the suite runs against CURRENT code, and a
# genuine regression test PASSES — which reads as "this test has no teeth" and invites
# deleting a good test. If the package has no seam, stage 5 is BLOCKED, not satisfied.
# ONLY for a package that HAS an env seam. This block used to run unconditionally, and
# `${BASELINE_SEAM_VAR:?}` aborts when unset — so a desktop item (which by D-7 has no seam
# and uses the worktree baseline below) could never reach its own procedure. WI-04, the next
# row in the queue, is a desktop item: stage 5 was unpassable for it.
if [ "$DESKTOP_WI" = no ] && [ "$GREENFIELD" = no ]; then
  # The seam variable NAME differs per package. For the release-script harness that is
  # LAWBAR_SCRIPT_DIR; no other package has one, so most items land in the else.
  : "${PACKAGE_DIR:?the package root the suite is relative to}"

  # BUILD the baseline; do not try to redirect imports into it. WI-01 originally specified a
  # `LAWBAR_SCRIPT_DIR`-style env seam for case-box-persistence. Measurement killed that: 17
  # of its 41 test files use STATIC ESM imports of `../dist/...`, resolved at parse time. It
  # is the same finding D-7 recorded for the desktop, and the same answer applies.
  BASE_PKG="$(PACKAGE_DIR="$PACKAGE_DIR" SCRATCH="$SCRATCH" \
    bash scripts/workflow/wi-baseline.sh package-baseline)" || exit 1

  # Copy ONLY the new or changed test files in, then run them there: their relative imports
  # now resolve, unchanged, to baseline code.
  : "${CHANGED_TEST_FILES:?space-separated list of test files to run against the baseline}"
  cp $CHANGED_TEST_FILES "$BASE_PKG/tests/"
  baseline_log="$SCRATCH/baseline-run.log"
  ( cd "$BASE_PKG" && node --test "$SUITE" ) > "$baseline_log" 2>&1
  baseline_status=$?
  BASELINE_LOG="$baseline_log" BASELINE_STATUS="$baseline_status" \
    bash scripts/workflow/wi-baseline.sh classify || exit 1

  # ...and the same suite must PASS against current code, or the change is simply broken.
  ( cd "$PACKAGE_DIR" && node --test "$SUITE" ) || exit 1
fi

# --- apps/lawbar-desktop: CONSUME the baseline built at stage 2 ----------------------
# The snapshot is NOT taken here. Taking it at stage 5 would copy the finished
# implementation, so "baseline" would be the current code, every regression test would pass
# there, and the whole stage would score good tests as toothless. Stage 2 builds it; this
# stage only runs against it.
if [ "$GREENFIELD" = yes ]; then
  echo "stage 5 not applicable — greenfield; record it in Notes and do NOT claim teeth"
elif [ "$DESKTOP_WI" = yes ]; then
BASE="$SCRATCH/baseline-desktop"
# BLOCKED only when a desktop item has no baseline. A persistence item legitimately has none
# and must not be blocked by a desktop gate it was never in scope for.
[ -d "$BASE" ] || { echo "no baseline: stage 2 did not build one — stage 5 is BLOCKED"; exit 1; }

# Copy ONLY the new or changed test files. Copying more risks dragging the implementation
# into the baseline, which produces a false "no teeth".
: "${CHANGED_TEST_FILES:?space-separated list of test files to run against the baseline}"
cp $CHANGED_TEST_FILES "$BASE/apps/lawbar-desktop/tests/"
baseline_log="$SCRATCH/baseline-run.log"
# EVERY changed test file, not just one. Copying several and judging only NEW_TEST_FILE let
# a second, toothless regression test ride along while stage 5 reported TEETH.
baseline_names=""
for t in $CHANGED_TEST_FILES; do baseline_names="$baseline_names tests/$(basename "$t")"; done
( cd "$BASE/apps/lawbar-desktop" && node --test $baseline_names ) > "$baseline_log" 2>&1
baseline_status=$?

# CLASSIFY BEFORE CLEANING UP — cleanup succeeds and would overwrite $? with 0, discarding
# the stage's only machine-visible result. The verdict rules (assertion = evidence; a module
# error is a harness fault and NOT a greenfield waiver; a test that PASSES at baseline is a
# stage-5 failure) live in the script and are pinned by tests. Do not re-implement them here.
BASELINE_LOG="$baseline_log" BASELINE_STATUS="$baseline_status" \
  bash scripts/workflow/wi-baseline.sh classify
verdict_status=$?

# Clean up the way the baseline was MADE. `git worktree remove` fails on a plain directory.
if [ "$(cat "$SCRATCH/baseline-kind" 2>/dev/null)" = head ]; then
  git worktree remove --force "$BASE"
else
  rm -rf "$BASE"
fi
[ "$verdict_status" -eq 0 ] || exit 1   # only TEETH passes stage 5
fi   # DESKTOP_WI

# 6/7  independent audit + test-quality review
# cc-suite is NOT initialised in this repo, so the slash command may be unavailable.
# Use the runner directly (see CLAUDE.md for the model-slug trap):
: "${AUDIT_PROMPT:?the inlined diff plus the audit prompt — never a path, the tree-walk times out}"
node ~/.claude/plugins/cache/xiaolai/cc-suite/2.0.0/scripts/codex-runner.mjs \
  --kind audit --model gpt-5.5 --effort high --sandbox read-only --timeout-ms 600000 -- "$AUDIT_PROMPT"
# NOT shell — `/tdd-guardian:review` is a slash command. Bash reads it as an absolute path
# and returns command-not-found, so under `set -e` a T2 item could never pass, and without it
# the required review is skipped while a later command overwrites the visible status. Invoke
# it as a slash command, outside this block.

# 8  mutation spot-check (hand-rolled; assert each mutation applied)

# 9  confirm
node ~/.claude/plugins/cache/xiaolai/cc-suite/2.0.0/scripts/codex-runner.mjs --kind audit --model gpt-5.5 \
  --effort high --sandbox read-only --timeout-ms 600000 -- "<verify prompt carrying the findings>"

# 10 artifact integrity
npm --prefix apps/lawbar-desktop run check:internal-tarballs

# 10b record the observables, not the adjectives
#     which pass ran (name + model) | finding ids | diffstat | files touched vs declared

# 11 lanes + data gate
/tdd-guardian:gate commit
npm --prefix apps/lawbar-desktop run check:no-real-data:all
```

---

## Known gaps this workflow does not close

Stated so nobody reads the checklist as completeness:

- **The `desktop` lane is KNOWN RED** — one deliberate permanent failure (the only test
  proving the app launches). Read it as "all pass except that one". Do not hard-code a
  pass count here — it goes stale the day anyone adds a test, which has happened twice
  already; the count lives in `.claude/tdd-guardian/config.json` with its measurement date.
- **No coverage tooling is declared in any package manifest**, and none could measure a
  shell script regardless. (Deliberately no count here — the number of manifests changes when
  a package is added. Re-check the manifests rather than trusting this line.)
- **The audit chain has no external anchor**, so it proves internal consistency and
  nothing about deletion. Tracked as a `todo` in
  `services/case-box-persistence/tests/hardening-audit-truncation.test.mjs`.
- **Stored documents are never re-verified** against the `content_hash` recorded at
  ingest. The chain is tamper-evident; the exhibits it points at are not.
- ~~No SQLite integrity checking~~ — **closed by WI-03.** `integrity_check` now runs on
  open, classifies corrupt / locked / foreign / unavailable, and preserves the suspect bytes.
  What remains open is D-6: a zero-byte file is valid empty SQLite, so a TRUNCATED case file
  is indistinguishable from a first run and opens as an empty store.

