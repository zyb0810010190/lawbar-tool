# Plan — PRC-4: control-character-safe deny() JSON in protect-run-control.sh (PRC4-DENY-JSON)

**Type**: SCAFFOLD/WORKFLOW security-hardening (run-control enforcement wiring; NO product code).
**Branch**: `security-prc4-deny-json-escaping` (off `origin/main` @ `ceb13e8`).
**Status**: READY-WITH-LOW — cc-suite review-plan `review-plan-mpznrewh-0cwh19` (2026-06-04: no C/H;
one Medium claim-precision). Authorized for implementation. **Claim narrowed (per the review):** the fix
guarantees valid JSON for **C0 control bytes (0x00–0x1F) + quotes + backslashes** — the PRC-4 finding.
The **jq-present** path additionally encodes UTF-8 correctly; the **jq-absent** degraded path strips C0
controls + escapes `\`/`"` (valid JSON), but does NOT guarantee valid UTF-8 if the reason carries
non-UTF-8 bytes — a documented residual of the doubly-anomalous (jq-absent + non-UTF-8) path, outside the
C0-control-byte scope. NOT claimed: "arbitrary bytes / ANY future reason." Also: `deny()` falls back to the
strip path if `jq` itself ERRORS (e.g. invalid UTF-8 input), so a jq failure never emits empty/no JSON.
**Author**: Claude Code.
**Date**: 2026-06-04.
**Breaker note**: commits-since-marker = 2; this WI targets ONE commit. If a second is needed, STOP and
report before creating it (do not bypass the breaker).

---

## 1. Where deny() emits JSON

`.claude/hooks/protect-run-control.sh:20-21`:

```
deny(){ esc=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$esc"; exit 0; }
```

It interpolates the escaped reason into a `permissionDecisionReason` JSON string. The harness parses
that JSON to register the `"permissionDecision":"deny"`.

## 2. The exact failure mode

The `sed` escapes only `\` and `"`. It does NOT escape ASCII control characters (`0x00`–`0x1F`:
newline `\n`, tab `\t`, CR `\r`, …). A **literal** control byte inside a JSON string is invalid JSON
(RFC 8259 §7 — control chars MUST be escaped). If a control byte ever reaches the reason, the emitted
object is malformed → the harness may fail to parse `permissionDecision:"deny"` → the deny does not
register → **fail-open**. This is the auditor's PRC-4 (Medium, defense-in-depth).

**Current reachability (honest):** every reason that reaches `deny()` today is either a fixed
hook-authored string or `$(basename "$P")`, and a path whose basename contains a control char is NOT
classified as a protected reserved name (so it would not deny in the first place). So PRC-4 is **not
known to be reachable today** — it is a robustness/defense-in-depth fix so that `deny()` cannot emit
invalid JSON for ANY future reason content. The plan does not overclaim an active bypass.

## 3. Minimal escaping strategy

Make `deny()` emit a correctly-encoded JSON string for arbitrary reason content:

- **jq present (normal):** encode the whole reason with `jq -Rs .` (raw-slurp → a fully-escaped JSON
  string literal, quotes included), and interpolate it as a bare `%s` value (no surrounding quotes in
  the format). jq escapes `\`, `"`, AND all control bytes (`\n`, `\t`, `\r`, `\uXXXX`).
- **jq absent (degraded, anomalous — Node/jq are project tools):** strip control bytes to spaces
  (`tr '\000-\037' ' '`) — which alone guarantees valid JSON — then escape `\` and `"` with the
  existing `sed`. Stripping (not preserving) is acceptable in the degraded path: the reason is advisory
  and the load-bearing requirement is that the deny REGISTERS (valid JSON), not that the message is
  byte-perfect when jq is missing.

Both branches always exit 0 (unchanged control flow). No other behavior touched.

## 4. Exact target files

- EDIT `.claude/hooks/protect-run-control.sh` — replace the `deny()` body only.
- EDIT `.claude/hooks/tests/protect-run-control.test.sh` — add PRC-4 regression tests (below).
- EDIT `dev-memo/deferred-audit-findings.md` — PRC-4 `open → closed`.
- NEW `dev-memo/plan-prc4-deny-json-escaping.md` (this plan — committed with the WI).

## 5. Tests (TDD — prove valid JSON for control chars / quotes / backslashes / newlines)

Extract the `deny()` function definition in isolation (`sed -n '/^deny()/,/^}/p'`, `eval` it in a
subshell — `deny` only depends on `$1`) and assert, for each hostile reason, that the emitted output is
**valid JSON** (`jq .` exits 0) AND carries `"permissionDecision":"deny"`:
- a reason containing a newline; a tab; a CR; a NUL-adjacent low control byte;
- a reason containing a `"` and a `\`;
- a reason mixing all of the above.
Run BOTH the jq-present branch and the jq-absent branch (the existing `nojq_setup`/PATH trick).
Also: a normal reason still produces the same valid JSON (no regression). Keep all existing
`protect-run-control.test.sh` cases green.

## 6. Compatibility risk

The output stays a single JSON object with `permissionDecisionReason` as a valid JSON string — the same
shape the harness already parses. jq's encoding only ADDS correct escaping; no field renamed, no schema
change. Downstream parsers that accept JSON are unaffected (they get well-formed JSON in MORE cases, not
fewer). The only behavioral difference: control bytes are now escaped (jq) or stripped (jq-absent)
instead of producing malformed output.

## 7. Out of scope (do NOT touch)

`block-run-control-bash-write.sh` `emit_deny()` and `batch-commit-guard.sh` `deny()` share the same
control-char pattern — but they are NOT PRC-4 (a separate finding each). Per the WI scope (PRC-4 only,
do not touch unrelated hook behavior), they are left unchanged and recorded as a **follow-up** in the
ledger, not fixed here. Also out of scope: Mechanism-C, BRCBW-9, all BCG items, product/UI/manifest/
dependency files.

## 8. Required cc-suite review

> Not authorized for implementation until `/cc-suite:review-plan` returns READY (or READY-WITH-LOW).
> Security-boundary ⇒ broker review required; broker audit + verify on the implementation diff. One
> commit; if a second is needed, stop and report the breaker state first.
