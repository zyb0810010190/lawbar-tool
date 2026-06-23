# ADR A07-KEY-00 — A0.7 marker / key custody operating model

**Status**: Accepted (operating model / design only — authorizes no implementation, mints no marker,
exposes no key, changes no gate behavior).
**Date**: 2026-06-23.
**WI**: WI-A07-KEY-00 (Type PLAN; design-only; NOT A0.7-gated).
**Composes under**: `ADR-evidence-a07-marker-provenance.md` (A07-MARK-00 — provenance + validation authority,
env-only key custody) and `ADR-evidence-a07-renderer-conformance-gate.md` (A07-GATE-00 — A0.7-dependence +
no-build-on-non-green). Consumed by `ADR-evidence-a3-anchor-link-contract.md` (A3-CONTRACT-00 §6) and the A3
implementation WIs.

## 1. Context

The A0.7 reality gate is built and hard-enforced (`scripts/workflow/check-a07-gate.sh`, wired into
`check-gates.sh`). An action is **A0.7-dependent** when `A07_REQUIRED=1|true|yes` is set OR the governed
`dev-memo/run/queue.md` block carries a `Requires-A07: yes|true` line. When dependent, the gate requires at
least one **provenance-valid local A0.7 marker** — minted only by the existing writer
(`scripts/workflow/a07-marker-write.sh` → `a07_marker.py write`, which runs the harness, requires
`status=pass` + `classification=ok`, and HMACs a canonical payload with `LAWBAR_A07_MARKER_HMAC_KEY`) and
accepted only by the existing validator (`a07_marker.py validate`, which **recomputes** the HMAC with the same
env key and checks the ledger-bound non-replay record). No key → the gate **fails closed**.

A3 anchor/link implementation WIs (A3-T2 onward) are A0.7-dependent (A3-CONTRACT-00 §6) and therefore cannot
begin cleanly until the human/agent **key-custody process** is defined: who holds the key, when a marker is
minted, and how an agent session may verify A0.7-gated work **without silently weakening the gate**. This was
surfaced concretely when the A3-00 lane hit the gate with no key available; the resolution there was to keep
A3-00 design-only and NOT A0.7-gated, and to define this operating model before the first gated impl lane.

This ADR is that operating model. It is **policy on paper**: no key material, no marker generation, no key
exposure, and no change to the gate / writer / validator / marker schema.

## 2. Decisions (the operating model)

1. **The HMAC key is NEVER committed.** `LAWBAR_A07_MARKER_HMAC_KEY` (and any key material) never enters
   git — not in source, fixtures, dev-memos, commit messages, or `dev-memo/run/evidence/**`.
2. **The key is local / env-only.** It lives only in the operator's environment (a local secret store or a
   per-session export). It is never persisted in the repo, never in a tracked config, never in CI without a
   separate decision (decision 8).
3. **A marker is valid ONLY via the existing writer + existing validator.** Mint = `a07-marker-write.sh`
   (harness `pass`/`ok` + HMAC over the canonical payload). Accept = `a07_marker.py validate` (recompute
   HMAC + ledger-bound non-replay). No other path produces a "valid" marker; a file that merely looks like a
   marker is not one.
4. **An agent without the key MUST NOT claim A0.7-gated verification passed.** If the agent's environment has
   no usable key (or the gate fails closed), the agent reports **"verification pending / unable to validate
   A0.7 marker"** (decision §6 wording) — never "passed", "green", or any softer phrasing mistakable for a
   pass.
5. **A3 `Requires-A07: yes` WIs STOP before commit if the key/marker is unavailable.** A gated implementation
   WI does not commit on an unverified A0.7 gate. It stops and reports verification-pending; it does not
   fix-forward past a fail-closed gate, and it does not downgrade the WI to ungated to get around it.
6. **Human-run mint ALONE is insufficient unless the validation environment also holds the key.** The
   validator recomputes the HMAC with `LAWBAR_A07_MARKER_HMAC_KEY`; so a marker a human minted is provable
   only in an environment that also has the same key. If the human mints the marker but the agent's
   `check-gates` environment lacks the key, the gate still fails closed (correctly). Therefore either the key
   reaches the validation environment (mode 9a) OR the human runs validation/`check-gates` too (mode 9b).
7. **No HMAC → asymmetric-signing switch without a separate ADR/WI.** The current model is symmetric HMAC
   (mint and validate share the key). Moving to asymmetric signing (mint with a private key, validate with a
   public key — which would let validation run without the secret) is a real improvement worth considering,
   but it is a marker-provenance change and requires its own ADR + WI. It is NOT done here.
8. **Future CI validation is a SEPARATE secret-management decision.** Validating A0.7 markers in CI would
   require putting key material (or a verification capability) into CI secrets — a distinct
   security/key-custody decision (stop-and-ask). It MUST NOT be smuggled into an A3 implementation WI, and the
   local-M0 rules in this ADR do not imply or pre-decide any CI secret handling.
9. **Accepted custody modes** (one of these per gated WI):
   - **(9a) Human exports the key to the local agent shell for the duration of ONE gated WI.** The operator
     makes `LAWBAR_A07_MARKER_HMAC_KEY` available to the agent's environment for exactly that WI; the agent
     mints (if needed) + validates via the existing writer/validator + runs `check-gates`. The key is UNSET
     after the WI (decision §7 hygiene); it is not assumed available for later queued work.
   - **(9b) Human runs BOTH marker mint and validation / `check-gates` directly.** The operator runs the
     writer and the gate themselves (e.g. via the `!` shell prefix), keeping the key entirely out of the
     agent's environment; the agent consumes the human-reported gate result.
   - **(9c) The lane STOPS with verification pending** if neither (9a) nor (9b) is acceptable for this WI.
     This is a legitimate terminal state, not a failure to be worked around.
10. **Rejected modes** (never acceptable):
    - a throwaway / agent-created key (a marker "valid" under a self-invented key proves nothing);
    - a committed key (any key material in git);
    - a committed marker used as a substitute for validation (a stored marker is not a fresh validation);
    - bypassing `Requires-A07` (dropping the gate trigger to avoid the marker requirement);
    - weakening `check-a07-gate` (relaxing fail-closed, accepting `isMarker=false`, accepting
      fabricated/touched/copied markers).

## 3. Operational hygiene (folds review Lows)

- **No key exposure.** The key is never printed to stdout/stderr, pasted into logs, echoed in a command the
  transcript records, written to a shell profile/rc file, included in a gate report or commit message, or
  stored in `dev-memo/**`. Prefer reading it from a local secret store into the process environment over
  typing it inline. (Low #1.)
- **Per-WI env-var lifetime.** Mode (9a)'s "ONE gated WI" is literal: export for the WI, **unset
  immediately after**, and never assume it persists into the next queued WI. A long-lived exported key is an
  environment-leakage risk and is not the accepted mode. (Low #2.)
- **Marker freshness / no replay.** A committed or stale local marker is NEVER a substitute for fresh
  validation by the existing validator. The marker provenance model already binds non-replay (A07-MARK-00:
  ledger record `runId → {markerPath, payloadHash, repoCommit, repoTreeHash}`); the operating model relies on
  that binding rather than trusting a marker's mere presence. (Low #3.)
- **Verification-pending phrasing.** When the key is unavailable, the only acceptable report is
  "verification pending / unable to validate A0.7 marker" (or equivalent explicit non-pass). Softer wording
  ("looks fine", "should pass", "gate not blocking") is forbidden — it can be mistaken for a pass. (Low #4.)
- **CI boundary.** These are LOCAL M0 custody rules. They do not authorize, imply, or pre-decide any CI
  secret handling; CI validation is decision 8 (separate). (Low #5.)

## 4. A3 implementation preconditions

Before any A3 implementation WI (A3-T2 pure math first, then A3-T1 schema, etc. per
`dev-memo/plan-batch-casebox-evidence-a3-anchor-contract-00.md`) can pass its gates + commit:

1. The WI's governed queue block carries `Requires-A07: yes` (or the protected action sets `A07_REQUIRED`).
2. A custody mode (9a / 9b) is in effect for that WI, so a genuine local marker can be minted (writer) AND
   validated (validator) in the environment that runs `check-gates`.
3. If neither mode is in effect, the WI STOPS at the gate with verification pending (9c) — it does not
   commit, does not fix-forward past the fail-closed gate, and does not drop `Requires-A07`.
4. The marker stays local-only + gitignored (`dev-memo/run/evidence/**`); the key stays env-only; neither is
   ever committed.

The custody mode for A3-T2 is chosen by the user when A3-T2 is authorized (a secrets decision); this ADR does
not pre-select it.

## 5. What this ADR does NOT change

- The A0.7 hard gate `check-a07-gate.sh` — behavior unchanged (documented, not edited).
- The marker writer `a07-marker-write.sh` / `a07_marker.py write` — unchanged.
- The marker validator `a07_marker.py validate` — unchanged.
- The marker schema / canonical payload / `isMarker` binding — unchanged.
- The local-only marker + offline/local-first posture (evidence-genie inv.1) — preserved.

Verified live this lane (gate intact): not-required → pass; `A07_REQUIRED=1` with no marker/key → fail closed.

## 6. Open / deferred

- **Asymmetric signing** (decision 7) — would let validation run without the secret (e.g. CI verify with a
  public key). Deferred to its own ADR/WI; not done here.
- **CI secret management** (decision 8) — deferred; a separate security decision, never smuggled into A3.

## References
- `docs/adr/ADR-evidence-a07-marker-provenance.md` (A07-MARK-00 — provenance, validation, ledger non-replay).
- `docs/adr/ADR-evidence-a07-renderer-conformance-gate.md` (A07-GATE-00 — A0.7-dependence, no-build-on-non-green).
- `docs/adr/ADR-evidence-a3-anchor-link-contract.md` (A3-CONTRACT-00 §6 — A3 impl WIs are A0.7-gated);
  `dev-memo/plan-batch-casebox-evidence-a3-anchor-contract-00.md` (A3-T2 first lane).
- `scripts/workflow/check-a07-gate.sh`, `scripts/workflow/a07-marker-write.sh`, `scripts/workflow/a07_marker.py`,
  `scripts/workflow/check-marker-guard.sh` (documented here; unchanged).
- `.claude/rules/evidence-genie.md` (inv.1 offline/local-first, inv.3/4 A0.7-first),
  `.claude/rules/security-boundary.md`, `.claude/rules/autonomy.md` (secrets are a hard stop).
