# Plan — PRC-2: path canonicalization for protect-run-control.sh (PRC2-PATH-CANON)

**Type**: SCAFFOLD/WORKFLOW security-hardening (run-control enforcement wiring; NO product code).
**Branch**: `security-prc2-path-canon` (off local `main` @ `e819ca3`; carries the closeout commit into this PR).
**Status**: READY-WITH-LOW — rev-1 (cc-suite review-plan `review-plan-mpzid6cq-3780u4`, 2026-06-04: all
Critical/High/Medium RESOLVED; Low = node-absent degrades to bash globs, accepted). Authorized for
implementation. Testing note (from the review): the hook E2E enumeration uses an EXPLICIT basename
table, NOT the helper's own constant, to avoid a tautological test.
**Author**: Claude Code.
**Date**: 2026-06-04.

## Review history

- **rev-0** review-plan (`review-plan-mpzi2tbp-0yh1dg`, COMPACT) → **NEEDS-FIX**:
  - **[Critical] log.md symlink routing doesn't compose.** Helper classifies `dev-memo/run/link → log.md`
    as 11, but the wrapper pipes the ORIGINAL payload (`file_path=link`) to `logmd-append-guard.mjs`,
    which uses `path.resolve` (NOT realpath, by PRC-1 design) → sees `link` → returns 3 → wrapper could
    fall through to ALLOW. → **rev-1 §3: when the helper returns 11 (canonically log.md) and the verifier
    returns 3, the wrapper treats it as DENY (fail-closed).** A symlink-to-log.md cannot be
    append-verified, so it is denied; the normal (non-symlink) log.md path still gets the append-only
    check (verifier returns 0/1).
  - **[High] `*dev-memo/run*` pre-filter leaves an outside-symlink bypass.** A pre-existing symlink named
    outside `dev-memo/run` (`/tmp/x → repo/dev-memo/run/config`) is never routed; the creation-block
    reduces but does not prove absence (the Bash hook is lexical with its own documented gaps). → **rev-1:
    DROP the pre-filter — the helper realpaths EVERY parsed Write/Edit/MultiEdit path, then exact-classifies.**
    Node on every file-tool call is acceptable for a governance hook (not a hot syscall path). Node-absent
    falls back to the existing bash suffix-globs (degraded = pre-PRC-2 behavior, never worse).
  - **[Medium] "unresolvable-but-references-protected" must use normalized semantics, not raw substring**
    (else it reintroduces the `xdev-memo/run/config` false-positive). → **rev-1: the helper classifies
    purely from the NORMALIZED path (dir === `<repo>/dev-memo/run` AND basename ∈ set); there is no
    raw-substring fail-closed. A payload the helper cannot parse exits 2 and the wrapper falls through to
    the bash-glob fallback (not a blanket deny-all, not fail-open).**
**Lane-start context**: continuous work on these hooks this session (PRC-1 #38, BATCH-CLOSEOUT #37); PRC-2
+ the PRC-1-deferred symlink residual are the named targets in `dev-memo/deferred-audit-findings.md`.

---

## Review packet (compact)

1. **Summary.** Close PRC-2: `protect-run-control.sh` (PreToolUse Write|Edit|MultiEdit) matches the raw
   `file_path` with suffix globs, so **lexically-equivalent spellings bypass** the blanket deny —
   verified ALLOW today: `dev-memo/run/./config`, `dev-memo/run//config`, `dev-memo/run/x/../config`
   (a *leading* `./` is already caught by the suffix glob). PRC-2 canonicalizes the target path
   **before** matching, via a side-effect-free Node helper (`path.resolve` for lexical `./` `//` `../`
   absolute, + best-effort `realpathSync` for symlinks), and matches the **exact** canonical path
   against the protected set. Preserves every existing behavior: blanket denies stay deny, `log.md`
   still routes to the PRC-1 append-only verifier (now on the canonical path), legitimate appends stay
   allowed, human emergency paths unchanged.

2. **Exact target files.**
   - EDIT `.claude/hooks/protect-run-control.sh` — canonicalize+classify the target via the helper
     before deny/route; replace the suffix-glob blanket case + `*log.md*` route with an exact canonical
     classification. Fail-closed preserved.
   - NEW `.claude/hooks/runcontrol-canon.mjs` — Node canonicalize+classify helper (no deps).
   - NEW `.claude/hooks/tests/runcontrol-canon.test.mjs` — unit tests.
   - EDIT `.claude/hooks/tests/protect-run-control.test.sh` — e2e: `./` `//` `../` absolute forms now
     DENY; non-protected allow; log.md routing on canonical path; PRC-3 fail-closed preserved.
   - EDIT `dev-memo/deferred-audit-findings.md` — PRC-2 `open → closed` (+ symlink residual note);
     note PRC-5 (substring-glob false-positive `xdev-memo/run/config`) is **incidentally closed** by
     exact canonical matching.

3. **Acceptance criteria.**
   - `dev-memo/run/./config`, `dev-memo/run//config`, `dev-memo/run/x/../config`, the absolute repo
     path, and a leading `./` all resolve to `<repo>/dev-memo/run/config` and **DENY**.
   - Each protected basename (the `PROTECTED_RE` set incl. `.closeout-pending`) is matched by **exact
     canonical path**, not suffix glob — so `xdev-memo/run/config` (PRC-5) is NOT falsely denied.
   - `log.md` (and its lexical spellings) routes to `logmd-append-guard.mjs` (append-only), never the
     blanket deny.
   - A path that canonicalizes OUTSIDE `<repo>/dev-memo/run/` is allowed (not run-control).
   - Fail-closed: node absent / unparseable input / unresolvable path that still references a protected
     name ⇒ DENY.
   - **Symlink:** best-effort `realpathSync` resolves a symlink in a routed path to its real target; a
     symlink-to-a-protected-file whose path still routes is caught. The residual (a *pre-existing*
     symlink **named outside `dev-memo/run/`** that resolves to a protected file) is documented +
     mitigated by the existing block-run-control-bash-write CREATION block (verified: `ln -s` and
     `node symlinkSync` to a protected path both DENY) — see §4.
   - Existing `protect-run-control.test.sh` (23) keeps passing; PRC-1 log.md tests keep passing.

4. **Out of scope (do NOT touch).** `block-run-control-bash-write.sh` and `batch-commit-guard.sh`
   (PRC-2 is the Write/Edit hook only); **BRCBW-1 / BRCBW-10** (the Bash-side path-indirection — a
   separate hook + WI; not required for PRC-2 correctness, per the user scope); all product code; the
   PRC-1 `logmd-append-guard.mjs` internals (reused, not modified). `log.md` is NOT moved into the
   blanket deny.

5. **Essential references.** `dev-memo/deferred-audit-findings.md` (PRC-2 ~line 78, PRC-5 ~line 81,
   PRC-1 closed ~77), `.claude/hooks/protect-run-control.sh`, `.claude/hooks/logmd-append-guard.mjs`
   (PRC-1), `.claude/rules/security-boundary.md`. The broader-audit invariant: **no GNU-only idioms**
   (`readlink -f` forbidden) — canonicalization lives in Node, not bash.

6. **Review questions.**
   1. Is replacing the suffix-glob matching with **exact canonical-path classification** in a Node
      helper correct + complete for the lexical forms, and does it compose cleanly with the PRC-1
      log.md routing?
   2. **Symlink scope:** is routing only `dev-memo/run`-substring paths to the helper (+ best-effort
      realpath) the right bound — given symlink CREATION to a protected file is already blocked — or
      must PRC-2 `realpath` **every** Write/Edit path (full closure, latency cost on every file op)?
      Is documenting the narrow pre-existing-unnamed-symlink residual acceptable?
   3. Are the fail-closed defaults (node absent, parse error, unresolvable path referencing a protected
      name) safe and non-fail-open?
   4. Does the helper faithfully reproduce the existing protected set (the `PROTECTED_RE` basenames +
      log.md) so no protected file is silently dropped?

---

## 1. Threat model

`protect-run-control.sh` blocks Write/Edit/MultiEdit to the run-control authority files
(`config`, `batch-start`, `last-batch-audit`, `queue.*`, `human.*`, `override-reason.md`, `risk.flag`,
`forbidden-paths.txt`, `.closeout-pending`) and routes `log.md` to the append-only verifier. It matches
the **raw** `file_path` with suffix globs, so a lexically-equivalent spelling
(`dev-memo/run/./config`, `dev-memo/run//config`, `dev-memo/run/x/../config`) evades the match and the
agent can forge/overwrite governance state. Actor: a cooperative agent that addresses a protected file
through an equivalent path. Posture: cooperative-agent + direct-write-block, NOT cryptographic.

## 2. Canonicalize-then-classify (the fix)

Before any deny/route, resolve the target to its canonical absolute path and classify it by **exact**
match against the protected set:

- **Lexical** (`path.resolve(repoRoot, file_path)`): collapses `.`, `//`, `..`, and normalizes
  relative/absolute. `dev-memo/run/x/../config` → `<repo>/dev-memo/run/config`.
- **Symlink** (best-effort `realpathSync`): if the path (or its existing parent, for a not-yet-created
  target) is a symlink, resolve it to the real path, so a symlink that still routes is caught.
- **Exact classification**: compare the canonical path to `path.resolve(repoRoot, "dev-memo/run/<name>")`
  for each protected `<name>`. Exact equality — not suffix — so `xdev-memo/run/config` (PRC-5) is a
  different file and is NOT denied.

Classification result drives the hook:
- canonical == `dev-memo/run/log.md` → route to `logmd-append-guard.mjs` (PRC-1 append-only).
- canonical == any other protected file → **DENY** (blanket).
- otherwise → allow (fall through).

## 3. Mechanism (rev-1)

`.claude/hooks/runcontrol-canon.mjs` (pure, never writes): reads the PreToolUse JSON, resolves
`repoRoot` (`CLAUDE_PROJECT_DIR` or `git rev-parse`), canonicalizes `file_path` (§2 — `path.resolve`
THEN best-effort `realpathSync` of the path, or of its existing parent for a not-yet-created target),
and classifies **purely from the normalized path**: `dir(resolved) === path.resolve(repoRoot,
"dev-memo/run")` AND `basename(resolved) === "log.md"` → exit `11`; same dir AND basename ∈ the
protected set → exit `10`; otherwise → exit `0` (not protected). Parse failure / missing file_path /
unknown shape → exit `2`. There is **no raw-substring** check (Medium fix), so `xdev-memo/run/config`
(parent `<repo>/xdev-memo/run` ≠ the target dir) → `0`.

`protect-run-control.sh` invokes the helper for **every** parsed Write/Edit/MultiEdit `file_path`
(High fix — no `dev-memo/run` pre-filter), when `node` is available:

```
if command -v node; then
  printf '%s' "$INPUT" | node runcontrol-canon.mjs ; rc=$?
  case $rc in
    0) exit 0 ;;                                  # not protected -> allow
    10) deny "blanket run-control protected" ;;
    11) printf '%s' "$INPUT" | node logmd-append-guard.mjs ; vrc=$?   # PRC-1 append-only
        case $vrc in
          0) exit 0 ;;                            # append-only OK
          3) deny "log.md reached via symlink cannot be append-verified" ;;  # Critical fix
          *) deny "log.md would truncate/rewrite, or fail-closed" ;;
        esac ;;
    2) : ;;   # helper could not classify -> fall through to the bash-glob fallback below
  esac
fi
# Bash-glob FALLBACK (node absent, or helper exit 2): the pre-PRC-2 behavior — the existing
# *log.md* node-absent deny + the blanket suffix-glob case. Degraded (lexical bypasses possible)
# but never worse than today, and never deny-all / fail-open.
... existing *log.md* arm + blanket case ...
```

The existing `[ -z "$P" ]` fail-closed (PRC-3) + `deny()` are unchanged. PRC-1's `logmd-append-guard.mjs`
is **reused unmodified**; the Critical fix lives entirely in the wrapper (helper-`11` + verifier-`3` ⇒
deny).

## 4. Symlink handling (rev-1 — full closure)

Because the helper runs on **every** parsed Write/Edit/MultiEdit path and `realpathSync`-resolves it
(High fix), a symlink that resolves to a protected file is caught **regardless of the symlink's own
name** — including a pre-existing `/tmp/x → <repo>/dev-memo/run/config` (realpath → the target → exact
dir+basename match → DENY). This closes the PRC-1-deferred residual at the Write/Edit-tool boundary.
The existing `block-run-control-bash-write.sh` creation-block (verified: `ln -s` / `node symlinkSync`
to a protected path both DENY) is a complementary control, no longer the sole one.

Residual now (node-absent only): in the degraded bash-glob fallback there is no realpath, so a symlink
bypass is possible **only when `node` is entirely unavailable** — an anomalous state (Node 22+ is a
project requirement) in which the hook is no worse than today. Documented, not relied upon.

## 5. Tests (TDD — red first)

Unit (`runcontrol-canon.test.mjs`, node --test; temp repo + `CLAUDE_PROJECT_DIR`):
- `dev-memo/run/./config`, `dev-memo/run//config`, `dev-memo/run/x/../config`, leading `./`, the
  absolute path → classify **blanket (10)**;
- **enumerate EVERY protected basename** (`queue.governed|queue.linted|queue.reviewed|human.ack|
  human.override|override-reason.md|batch-start|last-batch-audit|risk.flag|config|forbidden-paths.txt|
  .closeout-pending`) → blanket (10); `log.md` (+ `./`,`..` spellings) → **11**;
- `xdev-memo/run/config` (PRC-5) → **0**; a path resolving outside `<repo>/dev-memo/run` → 0;
  `dev-memo/cc-suite-reliability-log.md` → 0;
- **symlink (temp repo)** `dev-memo/run/link → config` → realpath → **10**; a symlink NAMED OUTSIDE
  dev-memo/run (`outside/link → dev-memo/run/config`) → realpath → **10** (the outside-symlink closure);
  a symlink `dev-memo/run/loglink → log.md` → **11**;
- not-yet-created target under dev-memo/run (parent realpath, basename appended) → classified correctly;
- malformed/unknown shape, missing file_path → **2**.

End-to-end (`protect-run-control.test.sh`, extend): through the hook — the internal-normalization forms
now DENY; `xdev-memo/run/config` ALLOW (PRC-5); **every protected basename enumerated through the HOOK**
DENY (Q4 — the source of truth shifted from bash globs to Node); `log.md` append still ALLOW + truncate
still DENY (PRC-1 composition); a `dev-memo/run/loglink → log.md` symlink Write → DENY (Critical:
helper-11 + verifier-3); node-absent → bash-glob fallback still DENYs `dev-memo/run/config`; PRC-3
unparseable-references-protected still DENY.

## 6. Rollback plan

Single SCAFFOLD commit. `git revert` restores `protect-run-control.sh` (re-opening PRC-2/PRC-5) and
removes the helper + tests. No data/schema/dependency/product surface; the helper is side-effect-free.
`deferred-audit-findings.md` PRC-2/PRC-5 rows flip back to `open` on revert.

## 7. Interaction with PRC-1 (log.md append-only)

PRC-2 canonicalizes + classifies; when the canonical path is `dev-memo/run/log.md`, the hook routes to
the **existing** `logmd-append-guard.mjs` (unchanged) with the original INPUT. The verifier's own
`path.resolve` is idempotent on the already-canonical target, so the two compose without conflict:
PRC-2 decides *which* protected file (canonical, exact); PRC-1 decides append-only *for log.md*.

## 8. Required cc-suite review

> Not authorized for implementation until `/cc-suite:review-plan` returns READY (or READY-WITH-LOW).
> Security-boundary ⇒ high-risk ⇒ broker review required; broker audit + verify on the implementation
> diff. BRCBW-1/10 stay deferred (separate Bash hook); the symlink residual is explicitly scoped here.
