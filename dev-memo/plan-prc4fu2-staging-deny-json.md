# Plan — PRC-4-FU2: port control-character-safe deny() JSON to the two staging-hygiene hooks (PRC4FU2-DENY-JSON)

**Type**: SCAFFOLD/WORKFLOW security-hardening (commit-policy enforcement wiring; NO product code).
**Branch**: `security-prc4fu2-staging-deny-json` (off `main` @ `61b47b8`).
**Status**: READY — cc-suite review-plan `review-plan-mq05hi3k-3a026d` (2026-06-04: no C/H/M).
Authorized. Reviewer confirmed all FIVE PreToolUse deny emitters in `.claude/hooks` and no sixth;
closing PRC-4-FU2 is honest with the bounded guarantee. Precision note (adopted): NUL cannot survive
a Bash variable/arg, so the honest claim is "cannot emit invalid JSON from C0 controls reachable in
the shell string; the fallback strips C0 from the emitted reason" — not "handles 0x00 input content".
**Author**: Claude Code.
**Date**: 2026-06-04.
**Predecessors**: PRC-4 (`240fb81`, #43) fixed `protect-run-control.sh` `deny()`; PRC-4-FU (`85a5ffd`,
#44) ported it to `block-run-control-bash-write.sh` `emit_deny()` + `batch-commit-guard.sh` `deny()`.
The PRC-4-FU audit (`audit-mpzp0vaz-bgvs2s` Q7) surfaced the last two emitters with the same pattern
and they were recorded as the **PRC-4-FU2** ledger row this WI closes.
**Breaker note**: main HEAD `61b47b8`; marker `f446807`; commits-since-marker = 1; headroom 2. This
WI targets ONE commit. If a second is needed, STOP and report before creating it.

---

## 1. The two staging-hygiene emitters (identical pre-PRC-4 pattern — discovery confirmed)

Both build `permissionDecisionReason` by escaping ONLY `\` and `"` via `sed`, leaving ASCII C0
control bytes (0x00–0x1F: newline/tab/CR) UNescaped → invalid JSON (RFC 8259 §7) → the harness may
fail to parse `permissionDecision:"deny"` → **fail-open**. Same bug PRC-4 / PRC-4-FU fixed.

- `.claude/hooks/block-git-add-all.sh:20-24` — `emit_deny()`.
- `.claude/hooks/block-commit-stage-all.sh:19-23` — `emit_deny()`.

Both bodies are byte-identical to PRC-4's old `deny()`:
```
esc=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf '{"hookSpecificOutput":{...,"permissionDecisionReason":"%s"}}\n' "$esc"
exit 0
```
**Shape parity confirmed**: same `emit_deny() {` signature, closing `}` on its own line (so the
`sed -n '/^emit_deny() {/,/^}/p'` extraction matches), all call sites pass ONE quoted reason. No
material divergence from the previous three → mechanical port is correct (the WI's "stop if shape
differs" condition does NOT trigger).

## 2. Reachability (honest)

Same posture as PRC-4 / PRC-4-FU: every reason reaching these emitters today is a fixed hook string
or contains a `"$tok"` git-token echo; a control-byte token is not a recognized broad-staging flag,
so it would not deny in the first place. **Not known reachable today** — a robustness / defense-in-
depth fix so neither emitter can emit invalid JSON for any future reason. No active bypass claimed.

## 3. The fix (port the hardened body verbatim)

Replace each `emit_deny()` body with the PRC-4 body (same guarantee boundary), keeping each hook's
own `emit_deny() {` signature and `}`:
```
emit_deny() {
  local reason=$1 enc
  if command -v jq >/dev/null 2>&1 && enc=$(printf '%s' "$reason" | jq -Rs . 2>/dev/null) && [ -n "$enc" ]; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' "$enc"
  else
    enc=$(printf '%s' "$reason" | tr '\000-\037' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$enc"
  fi
  exit 0
}
```
- **jq present**: `jq -Rs .` → fully-escaped JSON string literal (quotes + C0 + `\uXXXX` + UTF-8),
  bare `%s`.
- **jq absent OR jq errors OR jq emits empty**: strip C0 controls to spaces, then escape `\`/`"` —
  valid JSON. **Guarantee boundary**: valid JSON for C0 control bytes + quotes + backslashes;
  arbitrary non-UTF-8 bytes in the jq-absent fallback are a documented residual, NOT claimed covered.
- Names + call sites + control flow (`exit 0`) + JSON object shape unchanged. `local` valid (function).

## 4. Exact target files

- EDIT `.claude/hooks/block-git-add-all.sh` — `emit_deny()` body only.
- EDIT `.claude/hooks/block-commit-stage-all.sh` — `emit_deny()` body only.
- EDIT `.claude/hooks/tests/block-git-add-all.test.sh` — add emit_deny JSON tests.
- EDIT `.claude/hooks/tests/block-commit-stage-all.test.sh` — add emit_deny JSON tests.
- EDIT `dev-memo/deferred-audit-findings.md` — PRC-4-FU2 `open → closed`.
- NEW `dev-memo/plan-prc4fu2-staging-deny-json.md` (this plan).

## 5. Tests (TDD — mirror PRC-4-FU)

For each emitter: extract the function (`sed -n '/^emit_deny() {/,/^}/p'`), run it in a subshell
(so its `exit 0` cannot kill the suite) with hostile reasons (newline / tab / CR / quote+backslash /
mixed / normal), assert the output parses as JSON with `permissionDecision=deny`. Force the fallback
with a `jq` STUB that exits 1 (system `/usr/bin/jq` here means PATH-strip cannot force absence). Run
BOTH jq-present and jq-fallback. **Red-before evidence**: a one-shot check that the OLD sed-only body
emits invalid JSON on a newline reason. All existing cases in both suites stay green.

## 6. Out of scope (do NOT touch)

- Any OTHER behavior in either hook (broad-staging detection, token parsing). ONLY the emitter body.
- The three already-hardened hooks (`protect-run-control.sh`, `block-run-control-bash-write.sh`,
  `batch-commit-guard.sh`).
- Mechanism-C, BRCBW-9, other findings, product/UI/manifest/dependency files. No rename, no refactor.

## 7. Required cc-suite review

> Security-boundary (commit-policy enforcement) ⇒ broker review-plan required, then broker audit +
> verify on the implementation diff. One commit (headroom 2); if a second is needed, stop and report
> the breaker state first. Not authorized for implementation until review-plan returns READY /
> READY-WITH-LOW. After this WI, all FIVE PreToolUse deny emitters share the hardened pattern.
