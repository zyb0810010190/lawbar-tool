# Queue review 068 — WI-A07-KEY-00 (A0.7 marker/key custody operating model; design-only, NOT A0.7-gated)

**Date**: 2026-06-23.
**WI**: WI-A07-KEY-00 — author the A0.7 marker/key custody OPERATING MODEL ADR: how the HMAC key
(`LAWBAR_A07_MARKER_HMAC_KEY`) is supplied/withheld for local A0.7-gated implementation WIs, when a marker may
be minted, who runs write+validation, how an agent verifies A0.7-dependent work without weakening the hard
gate, the accepted + rejected custody modes, and the A3-T2 preconditions. **Design/ADR only**: no code, no key
material, no marker mint, no key exposure, no gate/writer/validator/schema behavior change.
**Classification under review**: docs-only; carries NO `Requires-A07:` line — intentionally NOT A0.7-gated.
**Queue**: `dev-memo/run/queue.md` (single WI).
**Reviewed queue.md sha256**: `8768273487548e0ac775a067aa203a1827e9b1b49763b1bd7cd3fd338c129285`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (broker; the model governs eventual HIGH-RISK A0.7-gated implementation + secrets).
- **Target scope**: `dev-memo/run/queue.md` WI-A07-KEY-00 block (compact packet inlined) + the 10 custody
  decisions + accepted/rejected modes.
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqqq83a5-d960iu`.
- **threadId**: none emitted.
- **rawOutput sha256**: `db823b655a2310d5bd7b9baead98d6019dba7ce8d23621240f49d85b5c10e419`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**A07-CLASSIFICATION: CONFIRMED-DESIGN-ONLY-NOT-GATED** — Codex confirmed: (1) gating a key-custody ADR on
A0.7 would create a bootstrap dependency (the policy explaining when the key may be supplied would itself need
the key); the real boundary is that A3 implementation WIs remain gated. (2) Decision 6 is correct — a
human-minted marker is not independently sufficient unless the validation/check-gates env also holds the key
(validation recomputes the HMAC). (3) The accepted modes are safe + sufficient for single-lawyer local-first
M0; the rejected modes close the main bypasses.

## Findings to fold into the ADR (all Low; non-blocking)
1. **Key-exposure hygiene** — the ADR must state the key is never printed, pasted into logs, committed to
   shell profiles, captured in transcripts, or included in gate reports.
2. **Per-WI env-var lifetime** — mode (9a) "ONE gated WI": clarify the key is UNSET after the WI and not
   assumed available for later queued work (no long-lived environment leakage).
3. **Marker freshness / replay** — committed or stale local markers are NEVER a substitute for fresh
   validation by the existing validator; cite the existing provenance binding (A07-MARK-00 ledger-bound
   non-replay: runId → {markerPath, payloadHash, repoCommit, repoTreeHash}).
4. **Verification-pending phrasing** — an agent without the key reports "verification pending / unable to
   validate A0.7 marker"; it MUST NOT use softer language mistakable for pass.
5. **CI boundary** — local M0 custody rules must not imply or pre-decide future CI secret handling.

## Disposition
READY → eligible to govern. All five findings are Low design-content clarifications authored into the ADR in
this same lane and confirmed by the post-authoring broker audit + verify; none is a scope change into
implementation / secrets exposure / gate behavior / CI (no stop-and-ask trigger fired). Proceeding to
mark-reviewed + govern (standalone, content-bound to sha `87682734…`). After authoring, broker
`/cc-suite:audit` + `/cc-suite:verify` run on the ADR before the design commit.

QUEUE_REVIEW_VERDICT=PASS
