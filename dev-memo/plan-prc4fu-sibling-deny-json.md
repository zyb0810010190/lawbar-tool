# Plan — PRC-4-FU: port control-character-safe deny() JSON to the two sibling hooks (PRC4FU-DENY-JSON)

**Type**: SCAFFOLD/WORKFLOW security-hardening (run-control enforcement wiring; NO product code).
**Branch**: `security-prc4fu-sibling-deny-json` (off `main` @ `bf12bed`).
**Status**: READY-WITH-LOW — cc-suite review-plan `review-plan-mpzoupz6-3jbkia` (2026-06-04: no
C/H/M). Authorized. Low note: keep each sibling's own signature (`emit_deny() {` / `deny() {`)
with the closing `}` on its own line, so the `sed -n '/^<name>() {/,/^}/p'` extraction matches —
do NOT collapse to PRC-4's one-line `exit 0; }` wrapper. Guarantee boundary confirmed: meaningful
coverage is reachable C0 controls (newline/tab/CR) + quotes + backslashes; NUL can't ride a Bash
string; non-UTF-8 in the jq-absent fallback is a real residual, not overclaimed.
**Author**: Claude Code.
**Date**: 2026-06-04.
**Predecessor**: PRC-4 (commit `240fb81`, PR #43, merged) fixed the SAME bug in
`protect-run-control.sh` `deny()`. PRC-4's audit (`audit-mpzo7b65-tjwv93`) and the ledger row
**PRC-4-FU** recorded the two sibling hooks as the explicit follow-up this WI closes.
**Breaker note**: main HEAD `bf12bed`; commits-since-marker = 1; headroom 2. This WI targets ONE
commit. If a second is needed, STOP and report before creating it.

---

## 1. The two sibling emitters (identical pre-PRC-4 pattern)

Both build `permissionDecisionReason` by escaping ONLY `\` and `"` via `sed`, leaving ASCII C0
control bytes (0x00–0x1F: newline/tab/CR) UNescaped → invalid JSON (RFC 8259 §7) → the harness
may fail to parse `permissionDecision:"deny"` → **fail-open**. Same bug PRC-4 fixed.

- `.claude/hooks/block-run-control-bash-write.sh:29-33` — `emit_deny()`.
- `.claude/hooks/batch-commit-guard.sh:19-23` — `deny()`.

Both bodies are byte-identical to PRC-4's old `protect-run-control.sh` `deny()`:
```
esc=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf '{"hookSpecificOutput":{...,"permissionDecisionReason":"%s"}}\n' "$esc"
exit 0
```

## 2. Reachability (honest)

Same posture as PRC-4: every reason reaching these emitters today is a fixed hook string or a
`$(...)`-derived basename / verb name; a control-char path is not classified as a protected
authority name, so it would not deny in the first place. So this is **not known reachable today**
— a robustness / defense-in-depth fix so neither emitter can emit invalid JSON for any future
reason. No active bypass claimed.

## 3. The fix (port PRC-4 verbatim)

Replace each emitter body with the PRC-4 `deny()` body (same guarantee boundary):
```
<name>() {
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
- `<name>` = `emit_deny` (BRCBW) / `deny` (batch-commit-guard). Names + call sites unchanged.
- **jq present**: `jq -Rs .` → fully-escaped JSON string literal (quotes + C0 + `\uXXXX` + UTF-8),
  interpolated as bare `%s`.
- **jq absent OR jq errors OR jq emits empty**: strip C0 controls to spaces, then escape `\`/`"` —
  valid JSON. **Guarantee boundary preserved**: valid JSON for C0 control bytes + quotes +
  backslashes; arbitrary non-UTF-8 bytes in the jq-absent fallback are a documented residual, NOT
  claimed covered.
- Control flow unchanged (both still `exit 0`); JSON object shape unchanged.

`local` is valid here — both are shell functions.

## 4. Exact target files

- EDIT `.claude/hooks/block-run-control-bash-write.sh` — `emit_deny()` body only.
- EDIT `.claude/hooks/batch-commit-guard.sh` — `deny()` body only.
- EDIT `.claude/hooks/tests/block-run-control-bash-write.test.sh` — add emit_deny JSON tests.
- EDIT `.claude/hooks/tests/batch-commit-guard-base.test.sh` — add deny JSON tests.
- EDIT `dev-memo/deferred-audit-findings.md` — PRC-4-FU `open → closed`.
- NEW `dev-memo/plan-prc4fu-sibling-deny-json.md` (this plan).

## 5. Tests (TDD — mirror PRC-4)

For each emitter: extract the function in isolation (`sed -n '/^<name>() {/,/^}/p'`), run it in a
subshell with hostile reasons (newline / tab / CR / quote+backslash / mixed / normal), assert the
output parses as JSON with `permissionDecision=deny`. Force the fallback with a `jq` STUB that
exits 1 (system `/usr/bin/jq` here means PATH-strip cannot force absence). Run BOTH jq-present and
jq-fallback. All existing cases in both suites stay green.

## 6. Out of scope (do NOT touch)

- Any OTHER behavior in either hook (detection logic, resolvers, gates). ONLY the emitter body.
- `protect-run-control.sh` (already fixed in PRC-4).
- Mechanism-C, BRCBW-9, all other BCG findings, product/UI/manifest/dependency files.
- No unrelated refactor, no renaming, no call-site changes.

## 7. Required cc-suite review

> Security-boundary (run-control enforcement) ⇒ broker review-plan required, then broker audit +
> verify on the implementation diff. One commit (headroom 2); if a second is needed, stop and
> report the breaker state first. Not authorized for implementation until review-plan returns
> READY / READY-WITH-LOW.
