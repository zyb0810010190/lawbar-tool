# Hook audit — canary run 01 (WI-REVIEW-001)

**Type**: REVIEW (read-only). **Date**: 2026-05-31. **Branch**: `workflow-scaffold-migration`.
**Trigger**: independent audit of the workflow enforcement files touched/relied on by the
first non-UI canary, before WI-002 advances. Codex (the normal independent reviewer) was
`ETIMEDOUT` this session, so independence came from a 3-lens multi-agent review
(portability / bypass-resistance / run-control state integrity), each finding adversarially
verified. 39 agents, 36 raw findings, 31 kept after verify, 5 rejected.

**This is a review artifact. No enforcement or run-control file was modified. The canary
remains stopped at the batch-audit-due breaker. Nothing was pushed.**

## Headline verdict

The change this run actually made — `batch-commit-guard.sh` lines 37-39, GNU-only `\+` →
portable `[0-9][0-9]*` (commit `40c000e`) — is **correct, complete, and isolated**:
- Parses identically to GNU sed (MAX=3, EVERY=3); rejects non-numeric; no wider match.
- All deny branches byte-identical; no new bypass introduced.
- No other GNU-only sed/grep/date idiom remains anywhere in the 10-file surface
  (PORT-013/014: no `grep -P`, no `sed -r`, no `cat -A`, no `readlink -f`, no GNU `date`).

Everything else of note is **pre-existing** scaffold behavior the audit surfaced — not a
regression from this run. The most actionable item is a governance bypass the scaffold's own
comments already acknowledge (BASH-WRITE-BYPASS).

## Adjudications where I overrode the agents

The verify agents are advisory; two of their kept verdicts are wrong or mis-severitied.

1. **Off-by-one: Critical (BATCH-COUNTER-001) vs "false alarm" (BATCH-START-EDGE-CASE) —
   both were kept and they contradict.** My ruling: a **real Medium**, not Critical, not a
   false alarm.
   - The "false alarm" finding is right that `git rev-list 5bde78b..HEAD` is *correct git
     semantics* — but that answers the wrong question. The defect is the **choice of BASE**,
     not rev-list. `batch-start` = `5bde78b` (parent of the marker commit `e0333b0 "Set
     canary batch start"`), so the scaffold marker commit itself is counted as batch-commit
     #1. The window is then `{e0333b0(setup), 40c000e(scaffold fix), b632c98(WI-001)}` = 3,
     tripping the breaker after only **one** canary WI.
   - The "Critical" finding is right that the canary pauses early, but **overstates
     severity**: an *early* audit demand is fail-safe (conservative), not a security hole.
     The human records `last-batch-audit` and continues. Nothing unsafe shipped.
   - Correct framing: `batch-start` should be the last pre-batch commit (`e0333b0`) or the
     post-scaffold commit (`40c000e`), so only genuine batch WIs count. **Medium.**

2. **GOVERNANCE-001 "add log.md to protect-run-control.sh" — partially wrong.** `log.md` is
   the audit trail that `batch-commit-guard.sh` *and the workflow itself* append to per WI.
   A blanket Write|Edit block would break the legitimate append step. The real gap is
   *append-only* integrity (an agent could rewrite history, not just append), which a
   Write-block can't express anyway given the Bash-redirection gap below. Downgrade to
   **Medium**, fix via append-only/audit, not by adding it to the deny list. (`queue.example.md`
   is a static template — Low/ignore.)

## Confirmed findings worth acting on (all pre-existing)

### High

- **BASH-WRITE-BYPASS-FILE-PROTECTION** — `protect-run-control.sh` guards only
  `Write|Edit|MultiEdit`. An agent with Bash can `echo AUTO_ADVANCE_MAX=100 >
  dev-memo/run/config` or overwrite `batch-start`/`risk.flag`/`human.override` to forge
  governance state. **The hook's own header (lines 9-10) acknowledges this** ("pair with a
  permissions.deny on Bash writes to dev-memo/run/ … if you need a firmer boundary"). It is a
  documented cooperative-agent limitation, not a hidden flaw — but it is the single biggest
  hardening win. *Note: this run deliberately refused to forge `batch-start` via `echo`
  exactly because the boundary currently rests on agent goodwill; this finding is why that
  shouldn't.* **Fix**: add `permissions.deny` Bash rules for redirection into
  `dev-memo/run/**`.

- **CMD-SUBST-BYPASS** — the `if: Bash(git add*)` / `Bash(git commit*)` matchers compare the
  literal command string, so `git $(echo add) -A` or similar substitution evades
  `block-git-add-all.sh` / `batch-commit-guard.sh` entirely. **Fix**: match any `git` Bash
  command then inspect, or deny command-substitution forms of `git add`/`git commit`.

- **HARDLINK-TOKEN-REUSE** — `human.ack` / `human.override` are consumed with `rm -f`. An
  agent that `ln`s the token before a commit keeps a live copy, reusing the single-use
  escape. Esoteric (needs Bash + intent), same cooperative-agent threat model. **Fix**:
  nonce + recency check instead of file-presence.

### Medium

- **BATCH-COUNTER-001 (reframed)** — `batch-start` set to parent-of-marker; canary breaker
  fires one WI early. **Fix**: set `batch-start`/`last-batch-audit` to `e0333b0` or `40c000e`.
- **GOVERNANCE-CHAIN-001** — `govern-queue.sh` needs both `queue.linted` + `queue.reviewed`,
  but nothing stops an agent deleting `queue.reviewed` post-governance; `batch-commit-guard.sh`
  trusts `queue.governed` alone. **Fix**: re-verify linted+reviewed presence at commit time,
  or protect those two from deletion.
- **GLOB-ROUTING-EDGE-CASES** — matcher glob semantics (`git add*`) undocumented/untested.
- **GOVERNANCE-001 (reframed)** — `log.md` audit trail is agent-mutable; want append-only.

### Low / Info

- `block-commit-stage-all.sh` quote-stripping (`s/"[^"]*"//g`) is brittle on escaped/unclosed
  quotes (ESCAPED-QUOTE, UNCLOSED-QUOTE, QUOTE-REGEX-COMPLEXITY) — fail-safe-leaning, low risk.
- `mark-queue-reviewed.sh:25` unquoted `$verdicts` in a diagnostic printf — quote it.
- jq-absent fallback JSON parsing is fragile but backed by a fail-safe deny (FALLBACK-DEFENSIVE).
- Portability bill of health: PORT-002…012 all confirmed POSIX-safe on BSD; hook wiring
  correct (HOOK-WIRING-001); current run-control state coherent (RUN-STATE-INTEGRITY-001);
  queue review verdict strict + valid (QUEUE-REVIEW-VERDICT-001).

## Rejected (5, agreed)

ALIAS-BYPASS-ROUTING (aliases not sourced in hook env), MULTILINE-STRING-HANDLING,
NARROW-DENY-LIST-GIT-ADD, FILE-PERMISSION-RACE-CONDITION (hooks serialize), GOVERNANCE-003.

## Disposition

All confirmed items are **pre-existing scaffold properties**, not introduced by `40c000e`.
None blocks reverting or re-running the canary. Fixes are out of scope for this read-only
REVIEW WI and several touch `settings.json`/permissions and protected run-control files —
they belong in their own authorized SCAFFOLD WIs. Recommended order if pursued:
1. BASH-WRITE-BYPASS (`permissions.deny` for `dev-memo/run/**` Bash writes) — closes the
   broadest governance hole and is a prerequisite for trusting the others.
2. BATCH-COUNTER-001 (`batch-start` → `40c000e`) — lets the canary prove 3 WIs as intended.
3. CMD-SUBST-BYPASS + HARDLINK-TOKEN-REUSE — matcher/token hardening.

Until then the canary stays stopped at batch-audit-due. No push.
