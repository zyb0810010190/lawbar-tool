# Plan — Automatic batch-audit closeout (BATCH-CLOSEOUT-AUTO-00)

**Type**: WORKFLOW (scaffold/enforcement wiring; NO product code).
**Branch**: `workflow-batch-closeout-automation` (off `origin/main` @ `9ae690c`).
**Status**: READY-WITH-LOW — rev-2 (cc-suite review-plan `review-plan-mpyt1rnq-tm31ib`, 2026-06-03).
Authorized for implementation. Low residual folded into the test list as **t21** (see §7).
**Author**: Claude Code.
**Date**: 2026-06-03.

---

## Review history

- **rev-0** review-plan attempt 1 (`review-plan-mpyqyo1c-ysgfoy`, FULL) → TIMEOUT (30:00).
- **rev-0** review-plan attempt 2 (`review-plan-mpys5j8q-8uopfq`, COMPACT) → NEEDS-FIX (High broker
  binding, 2 Medium, 1 Low). Fixed in rev-1.
- **rev-1** re-review (`review-plan-mpysfxrg-305eg9`, COMPACT) → NEEDS-FIX:
  - **[High] broker binding NOT bound to the audited range** — the output-hash proves *a* real audit,
    not *this* `BASE..HEAD`; a forger could cite a different clean audit, copy its hash, pair it with
    the current range. → **rev-2 §4: bind via `rawOutput` content (`AUDIT-RANGE`/`AUDIT-VERDICT`
    lines) — see the artifact constraint below.**
  - **[Medium] kill/crash window** between marker write and commit; the guard trusts the marker alone.
    → **rev-2 §5+§6.3: pending-sentinel `dev-memo/run/.closeout-pending` + a minimal ADDITIVE guard
    deny (user-authorized 2026-06-03).**
  - **[Medium] rollback** → RESOLVED in rev-1 (tracked closeout log).
  - **[Low] hook over-deny** → RESOLVED in rev-1 (payload-scoped match).
- **rev-2** re-review (`review-plan-mpyt1rnq-tm31ib`, COMPACT) → **READY-WITH-LOW** (no remaining
  C/H/M). Both prior findings RESOLVED. One Low: add an explicit reconcile test for the
  `marker==HEAD + sentinel exists` split — prove the reconcile branch distinguishes "commit completed
  but cleanup crashed" (→ just remove the sentinel) from "marker advanced before commit" (→ restore
  marker to OLD). → folded in as **t21**; reconcile uses the committed closeout-log entry for HEAD as
  the signal (present ⇒ commit completed ⇒ cleanup-only; absent ⇒ pre-commit crash ⇒ restore).
- **Implementation audit** (`audit-mpytolwn-mfi5rq`, `/cc-suite:audit`, gpt-5.5) → **FAIL
  C0 H2 M1 L3** → all remediated in-scope, re-verified:
  - **[H1] privileged commit ride-along** — the child-process `git commit` ran without a pathspec,
    so a pre-staged file could ride along, bypassing the staged-file guard. → FIXED:
    `preflight()` now requires a clean index; after staging, the cached set is asserted to be
    EXACTLY `[attestation, closeout-log]`; the commit uses an explicit pathspec (`batch-closeout.mjs`).
    Test **t22**.
  - **[H2] interpreter-inline false negatives** — `open(path,'w')`, `pathlib.write_text`, perl
    `open(FH,'>file')`, and `;`-in-quoted-payload evaded the tightening. → FIXED:
    added write-mode `open(...)` detection (`OPENMUT`), `write_text`/`write_bytes`/`.touch`, and
    whole-command payload scoping for interpreter+inline-flag statements (so an in-quote `;` no
    longer fragments the scan). Read-mode `open(...,'r')` still allowed. Tests **t23, t24**.
  - **[M] substring broker binding** — `AUDIT-RANGE`/`AUDIT-VERDICT` were not line-anchored, so prose
    could satisfy PASS. → FIXED: full-line `^…$` (multiline) anchors. Test **t26**.
  - **[L] duplicate attestation field keys** silently overwrote → FIXED: `parseAttestation` rejects
    duplicate keys. Test **t25**.
  - **[L] L-disposition not tracked** — any non-empty file passed → FIXED: requires a git-TRACKED
    non-empty `dev-memo/deferred-audit-findings.md` (per-id matching documented out-of-scope).
  - **[L] scope accounting** — `dev-memo/cc-suite-reliability-log.md` was modified but not in the
    file list → ACCEPTED into scope here (it is the cc-suite §"Required recording" home for this
    WI's review/audit invocations); `.gitignore` (sentinel ignore) and this plan doc are likewise
    WI artifacts. See updated §2.
- Recording: `dev-memo/cc-suite-reliability-log.md` (2026-06-03).

**Load-bearing artifact constraint (verified 2026-06-03).** The cc-suite audit job JSON
(`.../jobs/<jobId>.json`) stores **only** `rawOutput` and `threadId` — there is **no** `kind`,
`status`, prompt, or range field. Therefore broker verification CANNOT read structured kind/status/
prompt; all binding must come from `rawOutput` **content** + the filename jobId. rev-2's §4 reflects
this (rev-1 wrongly assumed kind/status fields existed).

**Guard-edit authorization (user, 2026-06-03).** An explicit exception to the "do not touch
`batch-commit-guard.sh`" lock, granted because the re-review found a real Medium. Bounded by the
user's 7 constraints: (1) add ONLY the pending-sentinel deny check; (2) do not relax/reorder existing
audit-due logic except to check the sentinel before the count check; (3) sentinel is repo-local under
`dev-memo/run/.closeout-pending`; (4) while it exists, all normal commits are blocked as
closeout-in-progress; (5) closeout creates it before marker mutation, removes it only after a
successful closeout commit, or restores/reconciles on failure; (6) tests prove
present-blocks / absent-preserves / crash-restart-blocks / success-removes; (7) record as rev-2.

---

## Review packet (compact)

1. **Summary.** Replace the manual "human writes HEAD into `dev-memo/run/last-batch-audit`" step with
   `scripts/workflow/batch-closeout.mjs`: it re-derives the audit window, verifies a git-tracked
   attestation, **hard-binds the broker audit to this exact `BASE..HEAD` via `rawOutput` content +
   output-hash**, preflights commit blockers, then advances the marker transactionally behind a
   **pending-sentinel** and creates a batch-close commit — restoring on failure. A minimal ADDITIVE
   deny is added to `batch-commit-guard.sh` (user-authorized) so an in-progress closeout reads as
   still-DUE, closing the crash window. Two run-control hooks gain a deny-only tightening. High-risk
   (3 security hooks) ⇒ full plan-review → tests → implement → audit → verify.

2. **Exact target files.**
   - NEW `scripts/workflow/batch-closeout.mjs` (Node, no deps).
   - NEW `scripts/workflow/batch-closeout.test.mjs` (§7 tests).
   - EDIT `.claude/hooks/batch-commit-guard.sh` — **add only** the `.closeout-pending` deny (before the
     count check); nothing else changed (user constraints 1–2).
   - EDIT `.claude/hooks/block-run-control-bash-write.sh` — (a) interpreter-inline mutation tightening
     (§6.1); (b) add `.closeout-pending` to the protected `AUTH` set.
   - EDIT `.claude/hooks/protect-run-control.sh` — add `.closeout-pending` to `PROTECTED_RE` (so
     Write/Edit to the sentinel is blocked for general agents, like every other run-control file).
   - NEW `dev-memo/batch-closeout-log.md` — tracked, append-only closeout record.
   - EDIT `BATCH-AUDIT.md` — require the batch-audit broker prompt to emit `AUDIT-RANGE` / `AUDIT-VERDICT`
     lines; document the attestation block + closeout step (doc-only).
   - EDIT `.gitignore` — ignore the transient sentinel `dev-memo/run/.closeout-pending`.
   - WI workflow artifacts (not product code): this plan
     `dev-memo/plan-batch-closeout-automation-00.md` and the cc-suite recording in
     `dev-memo/cc-suite-reliability-log.md`.

3. **Acceptance criteria.**
   - Closeout advances the marker + writes the closeout record **iff** every §5 check passes; else
     writes nothing (or restores), exits non-zero, prints the failing check.
   - Broker binding is to **this** range: `rawOutput` must declare `AUDIT-RANGE: <BASE>..<HEAD>` (exact
     SHAs) and a PASS verdict, and `sha256(rawOutput)` must equal the attestation's recorded hash.
   - Marker write + commit is transactional and guarded by `.closeout-pending`; a crash leaves the
     sentinel, which blocks all commits and drives reconciliation on re-run.
   - The guard diff is **additive-only** (the sole change is the sentinel deny; the count/audit-due
     logic is unchanged) — verified by inspection in the audit.
   - All §7 tests pass; cc-suite audit returns no open C/H/M; verify confirms.

4. **Out of scope.** Product code (`apps/**`, `services/**`, `docs/contracts/**`); the deadline-urgency
   UI WI (`stash@{0}`); cc-suite runner internals; the guard's existing count/governed-queue/risk/
   AUTO_ADVANCE_MAX logic (untouched beyond the additive sentinel deny).

5. **Essential references.** `.claude/hooks/batch-commit-guard.sh`, `.claude/rules/cc-suite.md`,
   `.claude/rules/security-boundary.md`, `.claude/rules/staging-hygiene.md`.

6. **Review questions (rev-2).**
   1. Does `rawOutput`-content binding (`AUDIT-RANGE`/`AUDIT-VERDICT` + hash) close the High
      different-job forgery, given the JSON lacks kind/status/prompt? Any residual beyond the
      cooperative-agent floor (run a real failing audit, then lie in the attestation verdict — but the
      `AUDIT-VERDICT` line is in the *hashed* rawOutput, so the lie must be in the broker output itself,
      i.e. the auditor would have to emit `BATCH-PASS` on a failing range)?
   2. Is the pending-sentinel + additive guard deny correct and free of new bypass? Is the guard change
      truly additive (never permits a previously-blocked commit)?
   3. Is the transactional sequence (sentinel → marker → commit → remove sentinel; restore on failure)
      free of any window that leaves the guard cleared without the sentinel?
   4. Are the ~20 tests sufficient?

---

## 1. Problem statement

Automate the human marker-write that clears the `batch-commit-guard.sh` audit-DUE block, **without
weakening the breaker** and **without making the marker writable by general agent execution**.

## 2. How the marker is protected today (verified)

Lexical hooks: `node <script>` writing the marker internally → ALLOW (sanctioned script channel);
shell redirection → DENY; `node -e` mutation of the marker → ALLOW (loophole, closed in §6.1); the
hook also over-denies any command *string* with a redirection token next to the marker path, even in
prose (§6.1 stays payload-scoped to avoid worsening this). The guard derives
`BASE = newer(batch-start, last-batch-audit)`, `COUNT = BASE..HEAD`, blocks commits when
`COUNT ≥ EVERY`, and trusts the marker as its sole state anchor.

## 3. Recommended direction

Verification-in-script with **range-bound broker binding**, a **pending-sentinel + minimal additive
guard deny** to kill the crash window, two **deny-only** run-control tightenings, and the guard's
existing audit-due logic otherwise untouched.

## 4. Attestation contract + range-bound broker binding (the High fix)

The git-tracked study packet (`dev-memo/study/<date>-batch-audit-*.md`) carries:

```
<!-- batch-audit-attestation v1
range_base: <40-hex SHA = audit window base>
target_sha: <40-hex SHA = audited HEAD>
verdict: BATCH-PASS
findings: C0 H0 M0 L<n>
broker_job_id: <cc-suite jobId, e.g. audit-mpy86w0h-p9076g>
broker_output_sha256: <sha256 of the broker job's rawOutput>
-->
```

The **batch-audit broker prompt** (BATCH-AUDIT.md) is required to make the auditor emit two machine
lines in its `rawOutput`:

```
AUDIT-RANGE: <BASE>..<HEAD>
AUDIT-VERDICT: BATCH-PASS C0 H0 M0 L<n>     (or BATCH-FAIL …)
```

The closeout **hard-verifies** (any miss ⇒ FAIL):
1. job JSON exists at `.../jobs/<broker_job_id>.json`;
2. it has non-empty `rawOutput` and **no** `error` key (= completed, not a failed/timed-out job — a
   failed job writes `{"error": …}` instead, e.g. the ETIMEDOUT envelopes seen in this very WI);
3. `broker_job_id` matches `^audit-` (the only "kind" signal the JSON exposes is the id prefix);
4. `sha256(rawOutput)` == `broker_output_sha256`;
5. `rawOutput` contains `AUDIT-RANGE: <BASE>..<HEAD>` with the **exact** current `BASE` and `HEAD`;
6. `rawOutput` contains `AUDIT-VERDICT: BATCH-PASS` with `C0 H0 M0`.

Because checks 4–6 operate on the **same hashed bytes**, a forger cannot pair one audit's hash with a
different range: the only `rawOutput` whose hash matches AND whose `AUDIT-RANGE` equals this
`BASE..HEAD` is a real audit *of this range*. The residual — an auditor that emits `BATCH-PASS` on a
range that should fail — is the cooperative-agent floor (and now the false claim sits in the broker's
own hashed output, not merely a human-typed marker). Disclosed, not hidden;
**cooperative-agent + direct-write-block + range-bound broker binding, NOT cryptographic.** The hash +
range are also copied into the tracked closeout log so the binding survives job-JSON pruning. The
machine-local state dir is resolved (`~/.claude/plugins/data/cc-suite-xiaolai/state/<slug>-*/`) or via
`--state-dir`.

## 5. The closeout algorithm (fail-closed; transactional behind the sentinel)

Inputs `--attestation <path>` (opt `--state-dir`). Derived `BASE` (newer of valid
`batch-start`/`last-batch-audit`, as the guard), `HEAD = git rev-parse HEAD`.

1. **Attestation present + git-tracked + exactly one well-formed block.** Else FAIL (malformed /
   duplicate / untracked).
2. `range_base == BASE`. Else FAIL *(t1)*.
3. `target_sha == HEAD`. Else FAIL *(t2)*.
4. `verdict == BATCH-PASS`; `findings` = `C0 H0 M0` (any C/H/M>0 ⇒ FAIL *(t3)*; `L>0` only if each L is
   dispositioned in a staged tracked file *(t10)*).
5. **Range-bound broker check (§4 checks 1–6).** Any miss ⇒ FAIL *(t4 missing fields; t5 job
   missing/has-error/wrong-id-prefix; t6 hash mismatch; t7 rawOutput AUDIT-RANGE ≠ BASE..HEAD; t8
   rawOutput verdict not PASS)*.
6. **Preflight ALL other commit blockers** before any write: governed queue present, no pending
   `risk.flag` (unless this closeout clears it), no forbidden path in the staged set, staged/untracked
   set is exactly the intended tracked files. Any blocker ⇒ FAIL, **nothing written**.
7. **Create the pending-sentinel.** Write `dev-memo/run/.closeout-pending` (content: `OLD=BASE`,
   `HEAD`, `broker_job_id`, `broker_output_sha256`, timestamp) via the script channel. From this moment
   the guard denies ALL commits (closeout-in-progress) — §6.3.
8. **Stage** the batch-close files by explicit path (study packet + finding-closure notes + closeout-log
   append). Never the gitignored marker; never product code.
9. **Advance the marker (transactional).** Write marker = `HEAD\n`. Then issue the batch-close
   `git commit` **as a node child process** (`execFileSync('git', ['commit', …])`). This child commit
   is **not a Claude Bash-tool call**, so `batch-commit-guard.sh` never fires on it — the sentinel does
   NOT need to be removed first. (This is the same lexical-hook limitation that lets the script write
   the marker: the guard only intercepts `git commit` issued as a Claude Bash-tool command word; a
   child-process commit bypasses it. It is a pre-existing property of the cooperative-agent model, not
   introduced here, and it is what makes the sentinel able to wrap the whole operation.) **On commit
   success**: remove `dev-memo/run/.closeout-pending` (the LAST step) — only now do normal commits
   resume. **On commit failure**: restore marker to `OLD`, remove the sentinel, exit non-zero — state
   is back to the consistent pre-closeout DUE condition (marker=OLD, no sentinel; the guard blocks via
   its normal count logic) *(t15)*.
10. **On success**, the sentinel is gone, marker==HEAD, and the tracked closeout-log entry is committed
    *(t16)*. There is no point in the sequence where the marker is advanced AND the sentinel is absent
    AND the commit is incomplete — the sentinel is removed strictly last.

**Reconciliation (crash/restart).** If `.closeout-pending` exists at startup: the guard already blocks
all commits. The closeout, given the same attestation, detects the sentinel, verifies marker state
(`== HEAD` means the marker already advanced), and either completes the commit (idempotent) or restores
marker to the sentinel's `OLD` and clears the sentinel — never leaving the guard cleared without the
sentinel *(t17 crash-restart-blocks)*.

Seams: `verifyAttestation`, `verifyBrokerRangeBound` (pure, fixture-driven); `runCloseout`
(sentinel/marker/commit/restore).

## 6. Hook changes (all deny-only / additive)

### 6.1 `block-run-control-bash-write.sh` — interpreter-inline mutation tightening (Low fix)

Deny only when ALL hold: command word is an interpreter (`node`/`python`/`python3`/`perl`/`ruby`,
path-prefixed ok, via existing unwrapping); an inline-code flag is present (Node `-e`/`-p`/`--eval`;
Python `-c`; Perl `-e`; Ruby `-e`); inspect **only the inline-code payload**; the payload contains a
protected `dev-memo/run/` authority basename **and** a mutation indicator (`writeFile`, `appendFile`,
`open(…,'w'|'a'|'x'|'r+'|'w+')`, `truncate`, `unlink`, `rm`/`remove`, `rename`, `copy`/`cp`,
`move`/`mv`, `symlink`/`link`, `chmod`, `chown`, `mkdir`, or a shell `>`/`>>`/`tee` in spawned shell).
Read-only refs (`readFileSync`) and non-protected payloads ALLOW *(t12 deny, t13 allow-readonly, t14
allow-nonprotected)*.

### 6.2 `block-run-control-bash-write.sh` + `protect-run-control.sh` — protect the sentinel basename

Add `\.closeout-pending` to the `AUTH` set (Bash hook) and `PROTECTED_RE` (Write/Edit hook) so general
agents cannot forge or delete the sentinel by direct write/redirection/verb or Write/Edit — only the
closeout script (script channel) writes/removes it. Keeps the sentinel as tamper-resistant as the rest
of run-control state, so guard constraint (4) actually holds.

### 6.3 `batch-commit-guard.sh` — additive pending-sentinel deny (user-authorized; constraints 1–2)

Insert ONE check **before** the count derivation, inside the existing batch-mode block, after the
governed-queue/risk checks:

```
[ -f "$RUN/.closeout-pending" ] && deny "Batch guard: a batch-closeout is in progress
  (.closeout-pending present); audit is still DUE until the closeout commit completes. Reconcile
  the closeout (re-run scripts/workflow/batch-closeout.mjs) before committing."
```

Strictly additive: it can only ADD a denial; it never permits a commit the guard previously blocked.
The override path still bypasses it the same way it bypasses the rest (an authorized human.override is
unchanged). Nothing else in the guard is reordered or relaxed *(t18 present-blocks-even-if-marker-current,
t19 absent-preserves-existing-behavior, t20 success-removes-sentinel)*.

The closeout's OWN batch-close commit is a node child process (§5 step 9), so this deny does not block
it — the deny targets the agent's normal Claude Bash-tool commits, which is exactly the surface that
must stay blocked while a closeout is mid-flight. This asymmetry is intentional and is the reason the
sentinel can wrap the entire transaction and be removed strictly last.

## 7. Tests (TDD — red first) — `scripts/workflow/batch-closeout.test.mjs`

t1 wrong `range_base`; t2 `target_sha`≠HEAD; t3 C/H/M>0; t4 missing broker fields; t5 broker job
missing / has `error` / wrong id-prefix; t6 hash mismatch; t7 `rawOutput` `AUDIT-RANGE`≠BASE..HEAD;
t8 `rawOutput` verdict not PASS; t9 BASE = newer-of(batch-start,last-batch-audit); t10 L-disposition
(absent fails / present allows); t11 hook denies `printf` redirection (regression); t12 hook denies
`node -e` mutation; t13 hook allows `node -e` `readFileSync` (readonly); t14 hook allows `node -e`
not naming a protected path; t15 commit failure ⇒ marker restored + sentinel retained; t16 valid PASS
⇒ marker==HEAD, sentinel removed, closeout-log appended; **t17** crash-restart with sentinel ⇒ guard
still blocks (reconcile path); **t18** guard denies a normal commit while `.closeout-pending` exists
even though marker==HEAD; **t19** guard with no sentinel preserves existing audit-due behavior
(due-when-COUNT≥EVERY unchanged); **t20** successful closeout removes the sentinel so normal commits
resume; **t21** reconcile split — with `.closeout-pending` present and `marker==HEAD`: if the committed
closeout-log already has the HEAD entry (commit completed, cleanup crashed) ⇒ reconcile removes the
sentinel only; if it does NOT (crash before commit) ⇒ reconcile restores marker to `OLD` and removes
the sentinel. Proves the branch does not silently clear the sentinel in the pre-commit case.

## 8. Failure cases

Pre-write failures (attestation/range/broker/preflight) ⇒ FAIL, nothing written. Commit failure ⇒
marker restored, sentinel retained (guard stays blocked), transparent non-zero exit; operator fixes
the blocker and re-runs (idempotent via the sentinel + intact prior marker). Crash anywhere after the
sentinel write ⇒ guard blocked until reconcile.

## 9. Rollback plan (two-part — total)

1. **Code**: `git revert <commit>` restores the three hooks' bytes, removes the script/test/closeout-log
   change. Single WORKFLOW commit.
2. **Local state**: reset the gitignored marker to the reverted closeout record's `OLD` (deterministic),
   and remove any stale `dev-memo/run/.closeout-pending`. The closeout record makes both deterministic.

No migration/schema/product surface/dependency. The guard deny is a self-contained removable clause.

## 10. How the marker stays non-writable by general agent execution

Redirection/verb writes denied; Write/Edit denied; interpreter-inline **mutation** denied (§6.1);
the sentinel basename protected (§6.2). The only marker writer is `batch-closeout.mjs` (script channel),
which writes only after §5 checks 1–6 pass and preflight is clean. The sentinel guarantees a crashed
closeout cannot leave the breaker cleared.

## 11. Why the guard's existing logic is otherwise untouched

Only the additive sentinel deny is added (user constraints 1–2). The count derivation, governed-queue
requirement, risk-flag check, and `AUTO_ADVANCE_MAX` ceiling are byte-for-byte unchanged. The breaker
is strengthened, never weakened.

## 12. Required cc-suite review

> Not authorized for implementation until `/cc-suite:review-plan` on rev-2 returns READY (or
> READY-WITH-LOW), all Critical/High fixed and re-reviewed. Touches 3 security hooks ⇒ high-risk ⇒
> broker review required; broker audit + verify required on the implementation diff.
