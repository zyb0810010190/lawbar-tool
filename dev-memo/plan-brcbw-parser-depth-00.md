# Plan: WORKFLOW(design) — parser-depth guard plan for BRCBW-1/2/8

**Status**: DESIGN / SPEC (non-authoritative). Not implementation-authorizing. This document
specifies the mechanism, scope, fixtures, and WI split for the remaining parser-depth findings
in `.claude/hooks/block-run-control-bash-write.sh`. It changes **no enforcement code** and
marks **no finding closed**.
**Date**: 2026-06-02.
**Author**: Claude Code at user's direction.
**Branch**: `workflow-brcbw-parser-depth-spec`.
**Scope source**: `dev-memo/deferred-audit-findings.md` rows BRCBW-1, BRCBW-2, BRCBW-8;
origin canary `dev-memo/hook-audit-canary-01.md`.
**Downstream gate**: the implementation WI(s) this spec proposes are **security-boundary**
work (`.claude/rules/security-boundary.md`) and require cc-suite `/review-plan` → tests-first →
`/audit` → `/verify` before commit. This spec is the input to that review, not a substitute.

## 1. Problem statement

The run-control Bash guard protects a small fixed set of authority/state files under
`dev-memo/run/` (`config`, `batch-start`, `last-batch-audit`, `queue.governed`, `queue.linted`,
`queue.reviewed`, `risk.flag`, `human.ack`, `human.override`, `override-reason.md`,
`forbidden-paths.txt`, plus append-only `log.md`). Its detection is **lexical and shallow**: it
matches authority paths as literal substrings of tokens, and (pass 4) extracts only non-nested
command substitutions. Three classes of write therefore bypass it. All three are **confirmed
ALLOW** on `main` (`0cf06a8`) by payload probe (commands fed to the hook, never executed):

| Finding | Example (confirmed ALLOW on main) | Why it bypasses |
|---|---|---|
| BRCBW-1 | `cd dev-memo/run && echo x > config` | after `cd`, the redirect target is the bare relative `config`; the guard only matches the literal `dev-memo/run/config` |
| BRCBW-1 | `cd dev-memo/run && rm config` | same: `rm`'s operand is bare `config` |
| BRCBW-1 | `p=dev-memo/run/config; rm "$p"` | write operand is `$p`; the guard does not resolve the assignment |
| BRCBW-2 | `p=dev-memo/run/config; echo x > "$p"` | redirect target is a variable, not a literal |
| BRCBW-8 | `[[ "$(echo $(tee dev-memo/run/config))" = y ]]` | pass-4 extraction is non-recursive (`[^)]*` stops at the first `)`); only the outer body is scanned |
| BRCBW-8 | `echo $(echo $(tee dev-memo/run/config))` | same nesting limit, outside `[[ ]]` too |

Direct writes (`echo x > dev-memo/run/config`, `rm dev-memo/run/config`, non-nested
`$(echo x > config)`) correctly **DENY**; read-only forms (`cat`, `grep`, `cd … && cat config`,
`p=…; cat "$p"`) correctly **ALLOW**. The fix must close the bypasses **without** regressing
either set.

## 2. Existing context used

- `.claude/hooks/block-run-control-bash-write.sh` (current guard: 4 passes — fail-safe/fast-exit,
  pass-1 redirection, pass-2/3 command-word-gated write verbs, pass-4 non-nested substitution).
- `.claude/hooks/tests/block-run-control-bash-write.test.sh` (103 cases — the executable spec).
- `dev-memo/deferred-audit-findings.md` — BRCBW-1/2/8 rows + the closed BRCBW-3/4/5/7 history.
- `dev-memo/hook-audit-canary-01.md` — the multi-lens audit that produced the BRCBW findings.
- `.claude/rules/security-boundary.md` — required loop for security-sensitive changes.
- `.claude/rules/loc-guardian.md` — the guard file is hand-written source (800 fail / 1500
  critical pure-LOC); the impl WI must respect it (see §7).
- Guard header self-statement: "cooperative agent + direct-write block, NOT cryptographic." The
  design preserves that threat model — it raises the cost of indirection, it is not a sandbox.

## 3. Candidate mechanisms

Three mechanisms, evaluated independently. The recommendation (§4) composes A + B and makes C an
explicit non-goal.

### Mechanism A — flatten-and-rescan (lexical; closes BRCBW-8)

**What it does.** Before pass-2/3 and pass-1, replace the substitution delimiters `$(`, `` ` ``,
and the matching `)` with statement separators (newlines), so the contents of *any* depth of
command substitution become ordinary statements fed through the existing `scan_redir` /
`scan_verbs`. `$(echo $(tee config))` flattens to two statements `echo` and `tee config`; the
inner `tee config` is then a normal write-verb statement → DENY.

- **Detects**: writes inside command substitutions at **any** nesting depth (redirection, `tee`,
  write verbs), surfacing each substitution body as its own statement.
- **Deliberately does not detect**: nothing additional is hidden by nesting after flattening; but
  it does not interpret quoting (see expected FPs).
- **Expected false positives**: an authority `$(...)` written as a **non-executing literal**
  (`echo '$(rm config)'`, `echo "\$(rm config)"`). Flattening is quote-blind, so the literal is
  scanned and **over-denies**. Fail-closed (denies a safe command); already the documented
  behavior of the current pass-4 for the non-nested case, so this is not a new class — it merely
  extends to nested literals.
- **Expected false negatives**: runtime-produced bodies (`$(cat file-of-commands | sh)`) — the
  text inside is not a literal write; out of scope for any lexical approach.
- **Why safer than current**: strictly **additive** (flatten only ADDS statements to scan; it
  removes no deny path), and it eliminates the depth limit that is BRCBW-8. Near-zero new
  false-negative surface; the only cost is the documented literal over-deny.
- **Cost / risk**: LOW. ~10–20 LOC, mechanical, no state. Balanced-delimiter flattening needs a
  small loop (sed alone cannot balance nested `)`); a bounded iterative replace (N passes, N
  small) is sufficient and still additive.

### Mechanism B — bounded indirection resolver (closes BRCBW-1 + BRCBW-2)

**What it does.** A small, **bounded** resolver that tracks two kinds of literal context within a
single command line and resolves them into the existing write-target checks:

1. **Literal variable assignments.** For `VAR=<literal>` where `<literal>` contains an authority
   path, record `VAR → value`. When a later redirection target or write-verb operand is exactly
   `$VAR` / `${VAR}` / `"$VAR"`, substitute the recorded value before `tok_auth` / `tok_logmd`.
   Bounded: literal RHS only (RHS containing `$(`/`` ` ``/`$` is NOT resolved); same command
   line only; last-assignment-wins; no arrays, no `${VAR:-default}`, no `declare`/`export`
   indirection.
2. **`cd` canonicalization.** Track `cd <literal>` / `cd dev-memo/run` (and `pushd`) as the
   current logical directory for subsequent `;`/`&&`-sequenced statements. When a write target /
   operand is a **bare relative** token, prepend the tracked directory and re-check against the
   authority set. Bounded: literal `cd` args only; over-approximate subshell/`(...)` scoping to
   the enclosing cd (deny-safe); ignore `cd -`, `cd "$x"`, `$OLDPWD`.

- **Detects**: `cd dev-memo/run && rm config`, `cd dev-memo/run && echo x > config`,
  `p=dev-memo/run/config; rm "$p"`, `p=dev-memo/run/config; echo x > "$p"`.
- **Deliberately does not detect**: non-literal indirection — `p=$(printf dev-memo/run/config)`,
  `${p:-dev-memo/run/config}`, array elements, a path arriving from a file/network, `eval`,
  `cd "$dir"` with a computed `$dir`. These are explicit non-goals (Mechanism C territory).
- **Expected false positives**: a benign `cd dev-memo/run && rm somethingelse` is unaffected
  (operand is not an authority basename). A genuine FP would require a non-authority file that
  *happens to share an authority basename* in the tracked dir — e.g. the user legitimately
  writing a file literally named `config` inside `dev-memo/run/` by hand; but those names are
  exactly the reserved set the guard exists to protect, so denying a direct hand-write to them is
  the intended behavior, not a defect. Net new FP surface: effectively nil.
- **Expected false negatives**: everything in the non-goal list above (computed paths). The guard
  remains a cooperative-agent control, not a sandbox.
- **Why safer than current**: closes the two **High**-severity indirection bypasses with a
  bounded, **enumerable** non-goal list, rather than the current open-ended literal match. Each
  resolved case reduces to an existing `tok_auth` check, so the deny logic is unchanged — only
  the *target string* is canonicalized first.
- **Cost / risk**: MEDIUM. Variable + cwd tracking adds state and is the part most able to
  introduce new false-positives if over-built; must be kept to literal-only resolution and
  covered by the FP-guard fixtures (§5). This is why it is a **separate WI** from A (§6).

### Mechanism C — fail-closed broadening (explicit NON-GOAL for now)

**What it would do.** Abandon target resolution; instead, whenever an authority **basename**
co-occurs with any write indicator and the guard cannot *prove* the write is not to an authority
file, DENY. This catches everything A and B catch and more (computed paths included).

- **Why rejected as the primary mechanism**: it reintroduces exactly the broad false-positive
  friction that BRCBW-5 deliberately removed (prose mentions, read-source co-occurrence). It
  would deny `grep config dev-memo/run/notes` and similar. High FP cost, poor ergonomics.
- **Where it survives**: as a **narrow fallback** inside B — when a *bare authority basename*
  (`config`, `batch-start`, …, the reserved names) appears as a **write-verb operand or redirect
  target** and B's resolver cannot confirm the directory, deny. The reserved basenames are
  specific enough that this targeted fail-closed has negligible FP cost, unlike the blanket form.
- **Decision**: blanket fail-closed is a **documented non-goal**; the narrow reserved-basename
  fallback is folded into Mechanism B.

## 4. Recommended direction

**Adopt Mechanism A (flatten-and-rescan) + Mechanism B (bounded indirection resolver), with the
narrow reserved-basename fail-closed fallback from C folded into B. Blanket fail-closed is a
non-goal.**

Rationale: A is additive, low-risk, and closes BRCBW-8 cleanly; B closes the two High-severity
indirection findings with a bounded, enumerable non-goal list; C-blanket is rejected on
false-positive grounds but contributes a targeted fallback. Together they convert the guard from
"literal-substring + non-recursive" to "depth-flattened + literal-indirection-resolved," while
keeping the cooperative-agent threat model and the BRCBW-5 false-positive discipline.

## 5. Acceptance fixtures (define BEFORE implementation)

These extend `.claude/hooks/tests/block-run-control-bash-write.test.sh`. Each `expect` line is a
verifiable acceptance check. The impl WI(s) MUST add these and keep all 103 existing cases green
(red-before / green-after for the new DENYs).

### Must DENY — the bypasses being closed

```
# BRCBW-8 (Mechanism A — flatten)
expect DENY  "nested sub tee (in [[]])"   '[[ "$(echo $(tee dev-memo/run/config))" = y ]]'
expect DENY  "nested sub bare"            'echo $(echo $(tee dev-memo/run/config))'
expect DENY  "nested sub redirect"        'echo $(echo X > dev-memo/run/config)'
expect DENY  "triple-nested verb"         'echo $(echo $(echo $(rm dev-memo/run/config)))'
# BRCBW-1 cd-relative (Mechanism B — cd canonicalization)
expect DENY  "cd then redirect bare"      'cd dev-memo/run && echo x > config'
expect DENY  "cd then rm bare"            'cd dev-memo/run && rm config'
expect DENY  "cd then tee bare"           'cd dev-memo/run && echo X | tee config'
# BRCBW-1/2 variable-indirected (Mechanism B — literal var resolution)
expect DENY  "var redirect target"        'p=dev-memo/run/config; echo x > "$p"'
expect DENY  "var rm operand"             'p=dev-memo/run/config; rm "$p"'
expect DENY  "var braced redirect"        'p=dev-memo/run/config; echo x > "${p}"'
```

### Must remain ALLOW — read-only / false-positive guard

```
expect ALLOW "cd then cat bare"           'cd dev-memo/run && cat config'
expect ALLOW "var cat operand"            'p=dev-memo/run/config; cat "$p"'
expect ALLOW "read nested sub"            '[[ "$(echo $(cat dev-memo/run/config))" = y ]]'
expect ALLOW "cd then write other file"   'cd dev-memo/run && echo x > scratch.txt'
expect ALLOW "grep authority co-occur"    'grep config dev-memo/run/queue.md'
```

### Must remain DENY — existing protections (regression floor)

```
expect DENY  "direct redirect"            'echo x > dev-memo/run/config'
expect DENY  "direct rm"                  'rm dev-memo/run/config'
expect DENY  "non-nested sub redirect"    '[[ "$(echo x > dev-memo/run/config)" = y ]]'
```

### Escaped / single-quoted literal `$(...)` — behavior MUST be specified by the impl WI

```
# Bash would NOT execute these (literal text). The lexical flatten is quote-blind.
#   Option 1 (RECOMMENDED interim): accept fail-closed over-deny, documented.
#       expect DENY  "single-quoted literal sub"  "echo '\$(rm dev-memo/run/config)'"
#   Option 2 (only if a real quote-aware lexer lands): allow.
#       expect ALLOW "single-quoted literal sub"  "echo '\$(rm dev-memo/run/config)'"
```

The impl WI MUST pick Option 1 or Option 2 explicitly and record the choice. Default
recommendation: **Option 1** (over-deny is fail-closed friction, not a bypass; full quote
awareness needs a real lexer, which is out of scope for A/B).

## 6. WI split recommendation

**Two implementation WIs, not one, and not three.**

- **WI-A — `IMPL(hooks): flatten command substitutions (BRCBW-8)`.** Mechanism A only. Low-risk,
  additive, ~10–20 LOC, no state. Ships first and independently; near-zero new false-positive
  surface. Closes BRCBW-8.
- **WI-B — `IMPL(hooks): resolve literal cd/variable write targets (BRCBW-1, BRCBW-2)`.**
  Mechanism B (+ narrow reserved-basename fallback). Medium-risk (adds variable + cwd state, the
  part able to introduce false-positives), so it warrants its own `/review-plan` and adversarial
  `/audit`. Closes BRCBW-1 and BRCBW-2 together — they already share the
  "Bash path-indirection hardening" backlog label and the same resolver machinery.

**Why split A from B**: A is lexical and provably additive; B carries real false-positive risk
from state tracking. Bundling them would force A to wait on B's heavier review and would blur the
audit scope. Why **not** three: BRCBW-1 and BRCBW-2 cannot be cleanly separated — the variable
resolver serves both the `rm "$p"` (BRCBW-1) and `> "$p"` (BRCBW-2) cases — so splitting them
would duplicate machinery across two WIs.

Sequence: **WI-A first** (fast, safe), then **WI-B** (gated). Each is one bounded, revertable
commit through the security-boundary loop.

## 7. Constraints the impl WIs inherit

- **Security-boundary loop** (`.claude/rules/security-boundary.md`): bounded WI → `/review-plan`
  → tests-first (red before green) → implement → `/audit` → `/verify` → record. High-risk per
  `.claude/rules/cc-suite.md` (security/sandboxing) — broker is **required**, self-review is not
  acceptable.
- **No surface changes** without an ADR: do not rename/remove `OcrQueueError` codes or alter the
  authority basename set; the resolver consumes the existing `AUTH` regex + `tok_auth`/`tok_logmd`
  classifiers unchanged.
- **loc-guardian**: the guard is hand-written source (800 fail / 1500 critical pure-LOC). The
  impl must `/loc-guardian:scan` before and after; if A+B push the file toward the threshold,
  extract the resolver into a sibling sourced helper rather than growing a god-file.
- **BSD/macOS portability**: no GNU-only regex idioms (`\+`, GNU `sed -i` semantics); balanced
  flattening via a bounded shell loop, not a PCRE recursive pattern.
- **Additive-deny discipline**: every new mechanism may only ADD denials; no path that currently
  DENYs may become ALLOW. The regression-floor fixtures (§5) enforce this.

## 8. Hard stops (from `.claude/rules/autonomy.md`)

- Security-sensitive code path → security-boundary loop + cc-suite broker required (above).
- No new runtime dependency (pure bash/sed/awk only).
- No weakening of any hard stop, gate, or the authority basename set.
- Push remains manual; these WIs commit locally and stop for review per the security loop.

## 9. Required downstream artifacts

This spec → two WI plans (`dev-memo/plan-brcbw-flatten-A.md`, `dev-memo/plan-brcbw-indirection-B.md`
or equivalent), each carrying a `## Review packet (compact)` and each run through
`/cc-suite:review-plan` before implementation. This spec does **not** authorize implementation.

## 10. Stop condition

This spec is "done" when WI-A and WI-B plans are opened and pass `/review-plan`. It is
"superseded" if a later decision adopts a real shell lexer (which would re-open Mechanism A's
quote-handling) or moves the guard to a non-bash implementation. Until then, BRCBW-1/2/8 remain
`open` in `dev-memo/deferred-audit-findings.md`, now cross-referencing this spec.
