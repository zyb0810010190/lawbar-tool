# Plan — PRC-1: append-only enforcement for dev-memo/run/log.md (PRC1-APPEND-ONLY)

**Type**: SCAFFOLD/WORKFLOW security-hardening (run-control enforcement wiring; NO product code).
**Branch**: `security-prc1-logmd-append-only` (off `main` @ `1c4e80e`).
**Status**: READY — rev-1 (cc-suite review-plan `review-plan-mpz4u8vw-cc8mvl`, 2026-06-04: READY, no
remaining C/H/M). Authorized for implementation.
**Author**: Claude Code.
**Date**: 2026-06-04.
**Lane-start context**: deep hook-audit recall in the preceding sessions (echo-sleuth) surfaced PRC-1
verbatim + its current state.

---

## Review history

- **rev-0** review-plan (`review-plan-mpz4ah8y-8b2g5o`, COMPACT) → **NEEDS-FIX** (1 High, 3 Medium):
  - **[High] raw-glob path match is fail-open** — `*dev-memo/run/log.md)` misses lexical equivalents
    (`./…`, `dev-memo/run//log.md`, `dev-memo/run/../run/log.md`), which fall through and ALLOW
    truncation. → **rev-1: bounded canonicalization for log.md only** (user-approved scope, Option 1):
    `path.resolve` the candidate inside the verifier, compare to the canonical repo target; broaden the
    bash route to `*log.md*`. Lexical `./` `//` `../` forms closed. **Symlink / non-`"log.md"`-named
    path indirection remains OPEN**, deferred to PRC-2/BRCBW path-indirection — recorded explicitly in
    §3 acceptance + `deferred-audit-findings.md` (the condition the reviewer required for deferral).
  - **[Medium] Write TOCTOU** — a full-file `Write` from a stale read can clobber concurrently-appended
    bytes. → **rev-1: deny `Write` to an EXISTING log.md entirely; allow `Write` only to CREATE it
    (absent).** Appends go through Bash `>>` or `Edit`/`MultiEdit` (append-only-checked). Removes the
    Write TOCTOU class.
  - **[Medium] unreadable-file handling** — treating any read error as "absent" makes an unreadable
    log.md overwrite-allowed. → **rev-1: `ENOENT` ⇒ current=""; any other read error ⇒ DENY.**
  - **[Medium] Edit/MultiEdit shape ambiguity** — "absent old_string ⇒ no-op" conflicts with
    "unknown-shape DENY". → **rev-1: strict shape validation** (missing/empty/non-string `old_string`,
    malformed `edits`, bad `replace_all` type ⇒ DENY); ONLY "valid old_string not found in current" is
    a no-op ALLOW.

---

## Review packet (compact)

1. **Summary.** Close PRC-1: a `Write`/`Edit`/`MultiEdit` tool call on `dev-memo/run/log.md` is
   currently UNGUARDED (`protect-run-control.sh` omits it), so the append-only audit trail can be
   truncated/rewritten, erasing evidence (e.g. the `human.override` consumption records the guard
   appends). The earlier audit's *blanket* Write/Edit block was rejected (would break legitimate
   appends). This WI implements the real need — **append-only enforcement**: a Write/Edit/MultiEdit on
   log.md is allowed **iff** the resulting content keeps the current content as a strict prefix (grows
   only at the end), with `Write` to an existing log.md denied outright (creation only). The Bash side
   is already append-only (`block-run-control-bash-write.sh`, unchanged). Path matching for log.md is
   **lexically canonicalized** so spelling variants can't bypass; symlink indirection stays deferred
   (PRC-2), noted in acceptance.

2. **Exact target files.**
   - EDIT `.claude/hooks/protect-run-control.sh` — route a `*log.md*` target to the verifier; deny on
     violation or any verifier error (fail-closed). log.md is NOT added to the blanket `PROTECTED_RE`.
   - NEW `.claude/hooks/logmd-append-guard.mjs` — side-effect-free Node verifier (no deps).
   - NEW `.claude/hooks/tests/logmd-append-guard.test.mjs` — unit tests.
   - EDIT `.claude/hooks/tests/protect-run-control.test.sh` — end-to-end log.md cases.
   - EDIT `dev-memo/deferred-audit-findings.md` — PRC-1 `open → closed` (+ the symlink residual note).
   - WI artifacts: this plan; `.gitignore` only if needed (not expected).

3. **Acceptance criteria.**
   - `Write` to an EXISTING log.md ⇒ DENY; `Write` to an ABSENT log.md (create) ⇒ ALLOW.
   - `Edit`/`MultiEdit` whose simulated result keeps current content as a strict prefix ⇒ ALLOW; any
     edit that truncates/shortens/mid-inserts/reorders/rewrites existing content ⇒ DENY.
   - **Canonicalization (bounded):** the verifier `path.resolve`s the candidate and applies the check
     iff it equals the canonical `<repo>/dev-memo/run/log.md`. These spellings are all caught:
     `dev-memo/run/log.md`, `./dev-memo/run/log.md`, `dev-memo/run//log.md`,
     `dev-memo/run/../run/log.md`, and the absolute form. A path that resolves OUTSIDE that exact
     target is not treated as log.md (falls through).
   - **Explicit deferred residual (required by the review):** symlink indirection and any non-`"log.md"`
     -named path that resolves to log.md are NOT closed here — they remain OPEN under PRC-2 /
     path-indirection (recorded in `deferred-audit-findings.md`). PRC-1 uses **lexical** canonicalization
     (`path.resolve`), not `fs.realpath`.
   - Fail-closed: node absent / unparseable input / unknown-or-malformed tool shape / non-ENOENT read
     error ⇒ DENY.
   - Non-log.md paths are NOT pulled into the special case; OTHER run-control files keep the blanket
     deny (no regression). The Bash append path (`>>`, `tee -a`) is untouched.
   - Existing `protect-run-control.test.sh` (14) + broader hook suites pass; new tests pass.

4. **Out of scope (do NOT touch).** PRC-2 (general canonicalization for all protected files), BRCBW-1/10
   (path-indirection); `batch-commit-guard.sh`; `block-run-control-bash-write.sh`; all product code; the
   deadline-urgency stash. log.md is NOT added to the blanket protected set.

5. **Essential references.** `dev-memo/deferred-audit-findings.md` (PRC-1 ~line 77; PRC-2 ~78),
   `dev-memo/run/README.md` (log.md = append-only trail), `.claude/rules/security-boundary.md`,
   `.claude/hooks/block-run-control-bash-write.sh` (already-correct Bash precedent).

6. **Review questions (rev-1).**
   1. Does denying `Write` to an existing log.md (create-only) + append-only `Edit`/`MultiEdit` fully
      remove the Write TOCTOU class while preserving every legitimate append path?
   2. Is the bounded `path.resolve` canonicalization correct and free of new bypass for the lexical
      forms, and is the symlink deferral (with explicit acceptance note) sound?
   3. Is the Edit/MultiEdit simulation + strict shape validation faithful (first vs all; not-found
      no-op; ordering; malformed ⇒ deny)?
   4. Any remaining fail-OPEN path?

---

## 1. Threat model

`dev-memo/run/log.md` is the append-only audit trail (one block per WI + `human.override` consumption
records appended by `batch-commit-guard.sh`); integrity is load-bearing for study-after-ship and
override-abuse detection. **Bash** writes are already append-only (`block-run-control-bash-write.sh`).
The **Write/Edit/MultiEdit tool** surface is unguarded (PRC-1): a `Write` (full replace) truncates the
trail; an `Edit` can rewrite prior entries; and lexical path spellings evade a raw glob. Actor: a
cooperative agent that (accidentally or to hide an override) rewrites the trail via file-edit tools,
which the Bash guard never sees. Posture: cooperative-agent + direct-write-block, NOT cryptographic.

## 2. The append-only invariant + Write rule

`current` = log.md's current on-disk bytes (or "" if absent). The operation is **append-only iff
`result.startsWith(current)`** — every existing byte preserved in order as a prefix, additions only at
the end.

- **Write** (`content` = full new file): a full replace is never a safe append and is TOCTOU-prone, so:
  **Write to an existing log.md ⇒ DENY**; **Write to an absent log.md ⇒ ALLOW** (creation;
  `result.startsWith("")` trivially holds). Appends use Bash `>>` or `Edit`.
- **Edit** (`old_string`,`new_string`,`replace_all`): `result = applyReplace(current, …)`; ALLOW iff
  `result.startsWith(current)`.
- **MultiEdit** (`edits[]`): fold `applyReplace` in order; ALLOW iff `result.startsWith(current)`.

`applyReplace` mirrors the tool: first occurrence (or all if `replace_all===true`); a VALID
`old_string` not present in `current` ⇒ result unchanged (no-op). Malformed shapes (missing/empty/
non-string `old_string`, non-string `new_string`, non-array `edits`, non-boolean `replace_all`) ⇒ DENY.

## 3. Allowed vs denied

| Operation on log.md | Decision |
|---|---|
| Bash `>>` / `tee -a` (existing) | ALLOW (unchanged) |
| Write to ABSENT log.md (create) | ALLOW |
| Write to EXISTING log.md | DENY (use `>>` or Edit) |
| Edit/MultiEdit whose result extends current at the end | ALLOW |
| Edit/MultiEdit that truncates/shortens/mid-inserts/reorders | DENY |
| Lexical path variant (`./`,`//`,`../`) resolving to log.md, truncating | DENY (canonicalized) |
| Symlink / non-`"log.md"`-named path resolving to log.md | **OPEN — deferred to PRC-2** (documented) |
| node absent / parse error / malformed shape / non-ENOENT read error | DENY (fail-closed) |
| Bash `>`, bare `tee`, `cp`/`mv`/`dd`/`sed -i` (existing) | DENY (unchanged) |

## 4. Mechanism

`protect-run-control.sh`, BEFORE the blanket `PROTECTED_RE`/case deny:

```
case "$P" in
  *log.md*)
    if command -v node >/dev/null 2>&1; then
      CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}" \
        printf '%s' "$INPUT" | node "<hookdir>/logmd-append-guard.mjs"
      case $? in
        0) exit 0 ;;   # is log.md AND append-only-ok -> allow
        3) ;;          # NOT (canonically) dev-memo/run/log.md -> fall through to blanket case
        *) deny "dev-memo/run/log.md is the append-only audit trail; this Write/Edit would truncate or rewrite existing content (or a Write targets an existing trail). Append a new entry at the end, or use Bash '>>'." ;;
      esac ;;
esac
# ... existing blanket PROTECTED_RE / case deny (unchanged) ...
```

`logmd-append-guard.mjs` (pure, never writes):
1. Resolve `repoRoot` from `CLAUDE_PROJECT_DIR` (or `git rev-parse`). `target = path.resolve(repoRoot,
   "dev-memo/run/log.md")`. `candidate = path.isAbsolute(file_path) ? path.resolve(file_path) :
   path.resolve(repoRoot, file_path)`. If `candidate !== target` ⇒ `exit 3` (not our file).
   **Lexical only** (`path.resolve`, no `fs.realpath`) — symlink indirection deferred per §3.
2. Read `current`: `ENOENT` ⇒ `""`; any other read error ⇒ `exit 2` (deny).
3. Determine shape (Write: `content`; MultiEdit: `edits[]`; Edit: `old_string`). Validate strictly;
   malformed/unknown ⇒ `exit 2`.
4. Write: if `current !== "" ` (exists) ⇒ `exit 1` (deny); else `exit 0` (create). Edit/MultiEdit:
   compute `result`; `exit(result.startsWith(current) ? 0 : 1)`.

## 5. Tests (TDD — red first)

Unit (`logmd-append-guard.test.mjs`, node --test; each sets `CLAUDE_PROJECT_DIR` to a temp repo and a
temp `dev-memo/run/log.md`):
- write-create-when-absent ALLOW; write-to-existing DENY (TOCTOU rule); 
- edit-append-at-end ALLOW; edit-truncate (replace big→small) DENY; edit-mid-insert DENY;
  edit-valid-old-not-found ALLOW(no-op); edit-empty-old_string DENY (malformed);
  multiedit-all-append ALLOW; multiedit-one-truncating DENY; replace_all append ALLOW;
  unknown/missing shape DENY; non-ENOENT read error DENY.
- **canon**: `./dev-memo/run/log.md`, `dev-memo/run//log.md`, `dev-memo/run/../run/log.md`, and the
  absolute path each routed + enforced (truncate ⇒ DENY); 
- **non-log.md not pulled in**: `dev-memo/cc-suite-reliability-log.md`, `/tmp/log.md`,
  `dev-memo/run/config` ⇒ `exit 3` (not treated as the target).

End-to-end (`protect-run-control.test.sh`, extend): through the hook — Write-create ALLOW;
Write-to-existing DENY; Edit-append ALLOW; Edit-truncate DENY; `./`-spelled truncate DENY; node-absent
⇒ DENY; `dev-memo/run/config` still blanket-DENY (no regression).

## 6. Rollback plan

Single SCAFFOLD commit. `git revert` restores `protect-run-control.sh` (re-opening PRC-1) and removes
the verifier + tests. No data/schema/dependency/product surface; verifier is side-effect-free; the bash
routing is a self-contained `case` arm. `deferred-audit-findings.md` PRC-1 flips back to `open` on
revert.

## 7. Required cc-suite review

> Not authorized for implementation until `/cc-suite:review-plan` on this rev-1 returns READY (or
> READY-WITH-LOW). Security-boundary ⇒ high-risk ⇒ broker review required; broker audit + verify
> required on the implementation diff. PRC-2 / BRCBW follow-ups stay out of scope (the symlink residual
> is explicitly deferred, not silently dropped).
