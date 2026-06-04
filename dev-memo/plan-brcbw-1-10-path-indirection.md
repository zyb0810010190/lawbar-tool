# Plan — BRCBW-1 + BRCBW-10: Bash path-indirection hardening (BRCBW-IND)

**Type**: SCAFFOLD/WORKFLOW security-hardening (run-control enforcement wiring; NO product code).
**Branch**: `security-brcbw-1-10-path-indirection` (off `origin/main` @ `ca6ead0`).
**Status**: READY-WITH-LOW — rev-1 (cc-suite review-plan `review-plan-mpzkrvt2-jl9yi1`, 2026-06-04:
all C/H/M RESOLVED). Authorized for implementation. Low: DEOBF = **balanced** shell-word quote-boundary
removal for literal concatenation (remove the surrounding `'`/`"` of a balanced fragment, **preserve
contents**; per-quote-type ODD count ⇒ unbalanced ⇒ leave unchanged), AND unquoted `\X` → `X`. Not just
empty `''`/`""` pairs.

## Review history

- **rev-0** review-plan (`review-plan-mpzklnor-ys7ghd`) → **NEEDS-FIX**:
  - **[High] fast-exit precedes de-obfuscation.** The hook's line-79 gate
    `grep -qE 'dev-memo/run/' || exit 0` bails BEFORE any de-obfuscation/cd-resolution, so
    `dev-memo/r\un/config` / `dev-memo/"run"/config` (no literal `dev-memo/run/`) — AND the cd form
    `cd dev-memo/run && echo x > config` (the cd arg is `dev-memo/run`, NO trailing slash) — never
    reach `tok_auth`. → **rev-1 §2: replace the gate with a DE-OBFUSCATED precheck.** Compute
    `DEOBF` = the command with unquoted `\`-before-non-special stripped + adjacent `''`/`""` pairs
    collapsed; gate on `dev-memo/run` (no trailing-slash requirement) present in `CMD` **or** `DEOBF`;
    run the scanners over `DEOBF` (additive) so obfuscated targets reach `tok_auth`.
  - **[Medium] reserved-basename fallback unsafe if global.** `echo x > config` / `rm config` OUTSIDE
    dev-memo/run is normal — a global bare-basename deny re-introduces Mechanism C. → **rev-1: the
    fallback fires ONLY with positive run-control context** — a tracked `cd dev-memo/run` (or a
    de-obfuscated/relative `cd` the resolver believes points at dev-memo/run) in scope for the
    statement. No tracked run-control dir ⇒ a bare `config` write is NOT denied. `grep config
    dev-memo/run/queue.md` stays ALLOW (config is not a write target).
  - **[Medium] resolver scoping/order under-specified.** → **rev-1 §4: explicit fixtures** for
    paren/subshell `(cd dev-memo/run; rm config)`, `cd dev-memo/run && (cd ..; rm config)`, nested
    subshells, and assignment-before/after ordering (sequential, last-wins, prior-assignments-only;
    a leading env-assignment on a simple command is NOT an in-command variable).
- **Relabel (Q3):** BRCBW-10 closure is "**lexical shell-word obfuscation** (backslash + adjacent-quote)
  closed" — NOT "all computed path spelling." Computed/`$IFS`/`$(...)`-spelled/variable residual stays a
  documented Mechanism-C non-goal.
- **BRCBW-2 (Q4):** only the **literal-var redirect** subset closes (shared machinery); dynamic
  redirects remain residual unless Mechanism C is approved.
**Author**: Claude Code.
**Date**: 2026-06-04.
**Design source**: `dev-memo/plan-brcbw-parser-depth-00.md` §3 Mechanism B + §5 fixtures (WI-B).
**Breaker note**: commits-since-marker = 2; this WI targets **one** commit (plan + impl + tests
together). If a second commit becomes necessary, STOP and clear the breaker (batch-closeout) first —
do not bypass it.

---

## Review packet (compact)

1. **Summary.** `block-run-control-bash-write.sh` (PreToolUse Bash hook) detects writes to run-control
   authority files by LEXICAL matching of the pre-resolution command string. Two open bypasses:
   - **BRCBW-1** (High): the literal `dev-memo/run/` substring is absent after **cd** or **variable**
     indirection — `cd dev-memo/run && echo x > config`, `p=dev-memo/run/config; echo x > "$p"`.
   - **BRCBW-10** (Low): Bash word-mechanics spell the path so the substring never appears —
     `echo X > dev-memo/r\un/config` (backslash strip), `dev-memo/"run"/config`, `dev-memo/ru''n/config`
     (adjacent-quote concat).
   This WI implements the spec's **Mechanism B** (bounded literal `VAR=`/`cd` resolver + the narrow
   reserved-basename fail-closed fallback) for BRCBW-1, and a **bounded token de-obfuscation**
   (strip unquoted `\`-before-normal-char + adjacent `''`/`""` pairs inside a write-target/operand
   token, before `tok_auth`) for BRCBW-10's backslash/quote subset. The computed/`$IFS`/`$(...)`-spelled
   subset is **Mechanism C** (the spec's explicit non-goal) and is documented as a residual, not closed.

2. **Exact target files.**
   - EDIT `.claude/hooks/block-run-control-bash-write.sh` — Mechanism B resolver + de-obfuscation,
     hooked into the existing `scan_redir` / `scan_verbs` operand checks (`tok_auth`/`tok_logmd`).
   - EDIT `.claude/hooks/tests/block-run-control-bash-write.test.sh` — the spec §5 fixtures (BRCBW-1/2)
     + BRCBW-10 de-obfuscation fixtures + the ALLOW false-positive guards; keep all existing cases green.
   - EDIT `dev-memo/deferred-audit-findings.md` — BRCBW-1 + BRCBW-10 `open → closed`; **BRCBW-2 closed
     as a natural consequence** (same literal-var mechanism — like PRC-5 fell out of PRC-2); record the
     BRCBW-10 computed/`$IFS` residual (Mechanism-C non-goal).
   - NEW `dev-memo/plan-brcbw-1-10-path-indirection.md` (this plan — committed with the WI).

3. **Acceptance criteria** (the spec's §5 fixtures, all red-before / green-after; existing 143 green):
   - DENY: `cd dev-memo/run && echo x > config`, `cd dev-memo/run && rm config`,
     `cd dev-memo/run && echo X | tee config`; `p=dev-memo/run/config; echo x > "$p"`,
     `p=dev-memo/run/config; rm "$p"`, `p=dev-memo/run/config; echo x > "${p}"`.
   - DENY (BRCBW-10): `echo X > dev-memo/r\un/config`, `echo X > dev-memo/"run"/config`,
     `echo X > dev-memo/ru''n/config`, `rm dev-memo/ru''n/config`.
   - ALLOW (false-positive floor): `cd dev-memo/run && cat config`, `p=dev-memo/run/config; cat "$p"`,
     `cd dev-memo/run && echo x > scratch.txt`, `grep config dev-memo/run/queue.md`.
   - DENY (regression floor): `echo x > dev-memo/run/config`, `rm dev-memo/run/config`, the existing
     nested-substitution cases.
   - **Documented residual (NOT closed):** computed indirection — `p=$(printf dev-memo/run/config)`,
     `${p:-dev-memo/run/config}`, `$IFS`/brace-spelled paths, paths from a file/`eval`. Mechanism-C
     non-goal per the spec; same class as BRCBW-1/2's enumerated non-goals.

4. **Out of scope (do NOT touch).** `protect-run-control.sh` (PRC-2), `batch-commit-guard.sh`,
   `logmd-append-guard.mjs`, `runcontrol-canon.mjs` — different hooks/surfaces; **PRC-4** (deny() JSON
   escaping); all product/UI/manifest/dependency files. Mechanism C (blanket fail-closed) stays a
   non-goal. If closing BRCBW-10's computed subset is required, that is a **Mechanism-C policy
   escalation** → STOP and ask (do not silently reverse the spec's non-goal).

5. **Essential references.** `dev-memo/plan-brcbw-parser-depth-00.md` §3 Mechanism B + §5;
   `dev-memo/deferred-audit-findings.md` (BRCBW-1 ~67, BRCBW-2 ~68, BRCBW-10 ~73);
   `.claude/rules/security-boundary.md`; `.claude/rules/cc-suite.md`.

6. **Review questions.**
   1. Is the bounded resolver (Mechanism B: literal `VAR=`/`cd`, last-assignment-wins, single command
      line, subshell over-approximated to the enclosing cd) sound and free of new false negatives
      within its stated bounds? Are the non-goals correctly enumerated?
   2. Is the narrow reserved-basename fail-closed fallback (a bare reserved basename as a
      write-target/operand whose directory the resolver cannot confirm ⇒ deny) low-FP enough, and does
      it preserve BRCBW-5's read-source / prose ALLOW discipline (e.g. `grep config dev-memo/run/queue.md`
      stays ALLOW)?
   3. Is the BRCBW-10 de-obfuscation (strip unquoted `\`-before-non-special + adjacent `''`/`""` pairs
      within a write-target/operand token, then re-check) correct, and is documenting the
      computed/`$IFS` residual (Mechanism-C non-goal) acceptable — or must BRCBW-10 be FULLY closed
      (escalation)?
   4. Is closing **BRCBW-2** as a side effect of Mechanism B acceptable (it is the same code path)?
   5. Fail-closed: do unexpected parse states (unbalanced quotes, the existing jq-absent + pass-4b
      backstops) remain deny-safe with the new passes? Any way the resolver itself fails OPEN?
   6. Does anything here weaken the PRC-2 `protect-run-control.sh` closure? (Different hook; confirm no
      shared state / no behavioral coupling.)

---

## 1. Threat model

`block-run-control-bash-write.sh` blocks Bash writes (redirection, `tee`, `cp`/`mv`/`ln`/`rm`/`dd`,
`sed -i`, interpreter-inline) to the run-control authority files, by lexically scanning the command
string. The gap: Bash RESOLVES the actual write target differently from the lexical string —
- **cd**: `cd dev-memo/run && echo x > config` — after cd, the redirect target `config` is a bare
  basename; the literal `dev-memo/run/` never appears with the operand.
- **variable**: `p=dev-memo/run/config; echo x > "$p"` — the operand is `"$p"`; the path is only in the
  assignment.
- **metachar (BRCBW-10)**: `dev-memo/r\un/config` / `dev-memo/"run"/config` / `dev-memo/ru''n/config` —
  Bash strips the `\` / concatenates the quotes to `dev-memo/run/config`; the lexical string differs.
Actor: a cooperative agent addressing a protected file through Bash indirection. Posture:
cooperative-agent + direct-write-block, NOT cryptographic (unchanged).

## 2. Mechanism (rev-1)

**Mechanism 0 — de-obfuscated precheck (High fix; enables BRCBW-10 + the cd form to be seen).**
Before the fast-exit and the scans, compute `DEOBF` = `CMD` with (a) an unquoted `\` before a
non-special char removed (`r\un` → `run`) and (b) adjacent same-token quote pairs collapsed
(`"run"` → `run`, `ru''n` → `run`). The fast-exit gate becomes: proceed to scan iff `CMD` **or**
`DEOBF` contains `dev-memo/run` (no trailing-slash requirement — catches `cd dev-memo/run` and the
obfuscated forms). The existing scans run over `CMD` (unchanged); the same scans additionally run
over `DEOBF` (strictly ADDITIVE — only adds DENYs for obfuscated targets; never removes a deny).
`DEOBF` is a best-effort normalization: it does NOT resolve `$IFS`/`$(...)`/variables/brace (those
stay Mechanism-C non-goals). Unbalanced quotes ⇒ leave that token unchanged (the `CMD` scan still
applies) — never fail-open.

**Mechanism B — bounded indirection resolver** (in the existing `scan_verbs`/`scan_redir` statement
loop, before `tok_auth`/`tok_logmd`):
1. **Literal `VAR=<literal>`**: when the RHS is a pure literal containing an authority path (no `$`,
   `$(`, backtick), record `VAR → value`. When a later write-target/operand is exactly `$VAR`/`${VAR}`/
   `"$VAR"`/`"${VAR}"`, substitute the recorded value before classifying. Bounds: same command line,
   last-assignment-wins; RHS with `$`/substitution NOT resolved; no arrays/defaults/`declare`.
2. **`cd <literal>` canonicalization**: track `cd dev-memo/run` (literal arg) as the logical directory
   for subsequent `;`/`&&`-sequenced statements; for a **bare relative** write-target/operand, prepend
   the tracked dir and re-check. Bounds: literal `cd` args only; subshell `(...)` over-approximated to
   the enclosing cd (deny-safe); ignore `cd -`, `cd "$x"`, `$OLDPWD`.
3. **Narrow reserved-basename fail-closed fallback** (Medium fix — context-gated, NOT global): a bare
   reserved basename as a write-verb operand / redirect target is denied **ONLY when there is positive
   run-control context in scope** — i.e. a tracked `cd dev-memo/run` (literal, or a relative `cd` the
   resolver believes points at dev-memo/run) governs the statement. With **no tracked run-control dir**,
   a bare `config`/`rm config`/`echo x > config` is **NOT** denied (that is normal elsewhere). This
   preserves BRCBW-5: `grep config dev-memo/run/queue.md` stays ALLOW (config is not a write target),
   `echo x > config` outside a tracked cd stays ALLOW. Blanket bare-basename fail-closed stays a
   non-goal.

**BRCBW-10 — bounded token de-obfuscation** (normalize a write-target/operand token before `tok_auth`):
remove unquoted `\` before a non-special char (`r\un` → `run`) and collapse adjacent same-token quote
pairs (`"run"` → `run`, `ru''n` → `run`). This reveals `dev-memo/run/...` for the backslash/quote
class. NOT resolved: `$IFS`, `$(...)`/backtick-spelled, brace expansion, variables (those are
Mechanism B for the literal-var case, else Mechanism-C non-goal).

## 3. Why this does NOT weaken the PRC-2 closure

PRC-2 hardened `protect-run-control.sh` — the **Write/Edit/MultiEdit tool** surface (a Node helper +
canonical classification). This WI hardens `block-run-control-bash-write.sh` — the **Bash** surface.
They are independent hooks with no shared state; the Bash de-obfuscation/resolver changes nothing in
the Write/Edit hook or its `runcontrol-canon.mjs`. Confirmed by an acceptance check: `protect-run-control`
+ closeout suites must stay green unchanged.

## 4. Tests (TDD — red first)

`block-run-control-bash-write.test.sh`: the spec §5 DENY/ALLOW/regression fixtures + the BRCBW-10
backslash/quote DENY fixtures + ALLOW read-source/`cat`/`grep` guards + an ALLOW for the documented
computed residual (a KNOWN non-goal, not a silent miss). **Plus the rev-1 fixtures (Medium-2):**
- subshell/paren cd: DENY `(cd dev-memo/run; rm config)`, DENY `(cd dev-memo/run && rm config)`;
- subshell scope reset (deny-safe over-approximation): DENY `cd dev-memo/run && (cd ..; rm config)`
  (over-approximate to the enclosing cd; deny-safe), ALLOW `cd /tmp && rm config` (no run-control cd);
- assignment ordering: DENY `p=dev-memo/run/config; rm "$p"`, ALLOW `rm "$p"; p=dev-memo/run/config`
  (use-before-assign — `$p` unresolved, no run-control context), ALLOW `FOO=bar rm config` (leading env
  assignment on a simple command is NOT an in-command var, and no run-control cd);
- fallback context-gating: ALLOW `echo x > config` (no tracked cd), ALLOW `rm config` (no tracked cd),
  DENY `cd dev-memo/run && rm config` (tracked cd).
Keep all 143 existing cases green (additive). Re-run every other hook suite + the closeout +
protect-run-control suites for non-regression (PRC-2 non-interaction).

## 5. Fail-closed behavior

The existing jq-absent fail-closed and the pass-4b unresolved-substitution backstop are unchanged. The
resolver only ADDS deny paths (var/cd resolution + the narrow basename fallback); it removes none. A
resolver that cannot parse a construct leaves the existing scans in force (no fail-open). Unbalanced
quotes in de-obfuscation: leave the token unchanged (the existing scan still applies) — never allow a
write it would otherwise deny.

## 6. Rollback plan

Single SCAFFOLD commit. `git revert` restores `block-run-control-bash-write.sh` (re-opening
BRCBW-1/2/10) and the test additions. No data/schema/dependency/product surface. `deferred-audit-findings.md`
rows flip back to `open` on revert.

## 7. Required cc-suite review

> Not authorized for implementation until `/cc-suite:review-plan` returns READY (or READY-WITH-LOW).
> Security-boundary ⇒ high-risk ⇒ broker review required; broker audit + verify on the implementation
> diff. Mechanism C (full computed-path closure) stays a non-goal unless the reviewer/user explicitly
> escalates. One commit; if a second is needed, stop and clear the breaker first.
