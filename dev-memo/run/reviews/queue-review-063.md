# Queue review 063 — WI-ENA10 (BATCH-CASEBOX-EVIDENCE-A07-MARKER-GUARD)

**Date**: 2026-06-23.
**WI**: WI-ENA10 — implement the fail-closed A0.7 tamper/fabrication guard
(`scripts/workflow/check-marker-guard.sh`) that rejects any file under `dev-memo/run/evidence/**` (accepted set
EMPTY, no authorized writer yet), plus a `*.test.sh` self-test and a narrow `check-gates.sh` integration. The
guard that must land BEFORE any marker-write WI. NO marker write, NO HMAC/provenance/key-custody, NO EVW5 hooks,
NO JS-shim change. The tenth ENA WI. **HIGH-RISK** (protects future A0.7 marker authority).
**Queue**: `dev-memo/run/queue.md` (single WI; prior WI-ENA9 executed + merged via PR #111, `ac25c6e`).
**Reviewed queue.md sha256**: `f6677317cf4d1129d03dc36751abf77792bc5cada4fd22de380db9ee5a082dd6`.

## cc-suite invocation (required recording)

- **Kind**: review-plan (HIGH-RISK; broker required, no self-review).
- **Target scope**: `dev-memo/run/queue.md` WI-ENA10 block (compact packet inlined) + A07-GATE-00 §5/§8 +
  A07-MARK-00 §4/§5/§6 + the `*.test.sh` convention + check-gates.sh (read-only).
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqqa8na9-797br4`.
- **threadId**: none emitted.
- **rawOutput sha256**: `1a0065675fe1cdada00a3ae9030f257378b73aa6195f46e58e6072b1a425af6c`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY; compact no-repo-read packet avoided the timeout class).
- **Retry attempts**: 1.

## Verdict

**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**SCOPE-ASSESSMENT: GUARD-ONLY-NO-MARKER-WRITE** (Codex confirmed it implements no marker write / HMAC /
key-custody / provenance / EVW5 / native / JS-shim / UI / hook-settings change; writes no marker and creates
nothing under `dev-memo/run/evidence/**`).

Codex confirmed (adversarially): with no authorized writer, an empty accepted-marker set is the correct
fail-closed posture; rejecting all `dev-memo/run/evidence/**` files enforces guard-before-marker-write and stops
schema-shaped files becoming de-facto markers before provenance validation exists; copied/touched/nested/
schema-only markers all fail (exit 2); the "guard must not create the namespace" behavior is directly tested;
synthetic `--paths` + temp-dir `--scan` tests are a sound way to prove rejection without polluting the repo;
wiring the guard scan + self-test into `check-gates.sh` is an appropriate, additive enforcement point (commit
hook/settings is out of scope), and the clean repo still returns GATES OK. Risk classified correctly as
HIGH-RISK.

## Low-risk clarification (folded into the guard before commit; non-blocking)

1. **Path canonicalization (anti-evasion).** Codex's one concern: a marker path with a leading `./`, duplicate
   slashes (`dev-memo//run/evidence/x`), or other non-canonical form should NOT evade the namespace prefix
   match. Git-derived paths (`git ls-files` / `git diff --cached`) are already canonical, so `--scan`/`--staged`
   are safe in practice; but for `--paths` input and defense-in-depth the guard is hardened to **normalize each
   candidate** (strip a leading `./`, collapse duplicate slashes) before the prefix check, and the self-test
   adds canonicalization cases (`./dev-memo/run/evidence/...`, `dev-memo//run/evidence/...`) that must still be
   rejected. (Symlink resolution is out of scope for a path-classifier; the `--scan` mode enumerates real files
   under the namespace via `find`, which already resolves the actual tree.)

This sharpens the guard within scope; it does not expand scope. Verdict stands as READY; governance proceeds.

## Disposition

READY → eligible to govern. Proceeding to mark-reviewed + govern (standalone, content-bound to sha
`f6677317…`). HIGH-RISK + protects future marker authority: after implementation, broker `/cc-suite:audit` +
`/cc-suite:verify` run on the impl scope before commit. User authorization for the tamper/fabrication-guard
step was given explicitly; the remaining WIs (marker write — gated behind THIS guard — and EVW5 hooks) remain
separate hard-stops; key custody is a Stop-and-Ask for the marker-write WI. None authorized by ENA10.

QUEUE_REVIEW_VERDICT=PASS
