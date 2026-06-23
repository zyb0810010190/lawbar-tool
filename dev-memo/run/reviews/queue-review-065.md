# Queue review 065 — WI-ENA11-FIX1 (BATCH-FAIL remediation: bind + check isMarker)

**Date**: 2026-06-23.
**WI**: WI-ENA11-FIX1 — repair the WI-ENA11-window BATCH-FAIL (audit-mqqlaozw-jns64v, M1): in
`scripts/workflow/a07_marker.py`, `isMarker` is written (true) but not HMAC-bound and not checked, so editing
`isMarker: true -> false` survives validation. Option-B fix (user-chosen): bind `isMarker` into the canonical
`PAYLOAD_FIELDS` (so it is covered by `provenancePayloadHash` + the HMAC) and make `validate` require
`isMarker is True` (strict boolean); add a regression test. Narrow fix to `a07_marker.py` + `a07-marker.test.sh`
only. **HIGH-RISK** (apex marker provenance repair).
**Queue**: `dev-memo/run/queue.md` (single WI; remediation of ENA11 on main `67c6132`; batch window
`5d75f57..67c6132` is BATCH-FAIL and cannot close until this fix lands).
**Reviewed queue.md sha256**: `74056fdc6fd30f05ad7c7d894276be2b1e84e07710ea5e709edc59ccb604643b`.

## cc-suite invocation (required recording)
- **Kind**: review-plan (HIGH-RISK; broker required, no self-review).
- **Target scope**: `dev-memo/run/queue.md` WI-ENA11-FIX1 block (compact packet inlined) + the M1 finding +
  A07-MARK-00 §2/§4 + a07_marker.py/a07-marker.test.sh (read-only).
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqqm2c4q-r7mf70`.
- **threadId**: none emitted.
- **rawOutput sha256**: `0655167d1f00209b00b5e117e3100c9c542f4d41aa073265c7d92901214a231f`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY).
- **Retry attempts**: 1.

## Verdict
**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**SCOPE-ASSESSMENT: NARROW-FIX-ONLY** (Codex confirmed it stays limited to `a07_marker.py` + the marker test;
no guard/native/key-custody/EVW5/harness/UI change — the guard delegates to `a07_marker.py validate`).

Codex confirmed: binding `isMarker` into the fixed-order canonical payload makes a `true->false` edit change
the validator-rebuilt canonical → `provenancePayloadHash` + HMAC mismatch; the explicit strict-boolean check
also blocks `isMarker=false` from satisfying validity. The fix (add to `PAYLOAD_FIELDS` + require strict `true`
+ regression) is sufficient to close M1 with existing tests intact; regression risk is low (adding one bound
field strengthens the model). The one credible breakage is writer/validator divergence.

## Low-risk clarifications (folded into implementation; non-blocking)
1. **Identical canonical construction.** Both writer and validator build the canonical payload from the SAME
   `PAYLOAD_FIELDS` list via the same `_canonical()` serializer, so adding `isMarker` to that list is applied
   identically on both sides — no field-order/serialization divergence. The writer sets `isMarker` in the
   `payload` dict (bound), not appended afterward.
2. **Strict boolean.** `validate` requires `m["isMarker"] is True` (Python bool `True`), so a string `"true"`,
   `1`, or any non-`true` value is rejected — independent of, and in addition to, the HMAC binding.

These do not expand scope; verdict stands as READY; governance proceeds.

## Disposition
READY → eligible to govern. Proceeding to mark-reviewed + govern (standalone, content-bound to sha
`74056fdc…`). HIGH-RISK: after implementation, broker `/cc-suite:audit` + `/cc-suite:verify` run before commit;
then re-run the batch audit over the failed window INCLUDING the fix, and only a BATCH-PASS re-run authorizes
the closeout. Commits land via single-use, user-authorized `human.override` (one for governance, one for impl)
because the BATCH-FAIL window cannot be closed to reset the count gate. No EVW5 scratch is committed.

QUEUE_REVIEW_VERDICT=PASS
