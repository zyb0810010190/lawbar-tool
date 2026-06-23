# Queue review 062 — WI-ENA9 (BATCH-CASEBOX-EVIDENCE-A07-MARKER-PROVENANCE-DESIGN)

**Date**: 2026-06-23.
**WI**: WI-ENA9 — produce a DESIGN ADR for future A0.7 marker provenance
(`docs/adr/ADR-evidence-a07-marker-provenance.md`, A07-MARK-00, Status: Proposed — design only,
non-authorizing), extending A07-GATE-00 §5/§8. Docs/ADR governance lane — NO native code, NO marker, NO
HMAC/provenance code, NO tamper guard, NO EVW5 hooks, NO JS-shim change, NO `dev-memo/run/evidence/**`. The
ninth ENA WI; design/planning, not implementation. **HIGH-RISK** (defines future A0.7 marker authority — the
durable court-facing A0.7 claim; a weak design risks the EVW5 forgery class).
**Queue**: `dev-memo/run/queue.md` (single WI; prior WI-ENA8 executed + merged via PR #110, `eff5292`).
**Reviewed queue.md sha256**: `94c1cca9c90a33da06766e62165755c58a954fc5b363e0257e28e3f9da8b5212`.

## cc-suite invocation (required recording)

- **Kind**: review-plan (HIGH-RISK; broker required, no self-review — the ADR defines future marker authority).
- **Target scope**: `dev-memo/run/queue.md` WI-ENA9 block (compact packet inlined) + A07-GATE-00 §5/§8 + ENA-00
  + evidence-genie.md invariants + the ENA7 fixture/oracle + the ENA8 harness (read-only).
- **Path / runner**: Path 1 runner `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`
  (native `--background`).
- **Model / effort / sandbox**: gpt-5.5 / high / read-only.
- **Job ID**: `review-plan-mqq9j2jp-l6fcaz`.
- **threadId**: none emitted.
- **rawOutput sha256**: `e98c63d2554070f6ddbdeba73dd3ca0a2d43f538ff8ae42c49cbd0f3d4f5acc2`.
- **/cc-suite:status / :result retrievable?**: YES (Path 1, native `--background`, terminal with rawOutput).
- **Failure classification**: none (first attempt READY; compact no-repo-read packet avoided the timeout class).
- **Retry attempts**: 1.

## Verdict

**REVIEW VERDICT: READY (Low-risk clarifications).** Critical: none. High: none. Medium: none.
**SCOPE-ASSESSMENT: DESIGN-ONLY** (Codex confirmed the lane stays docs/ADR-only and authorizes no
HMAC/marker-write/guard/hook/CI/`dev-memo/run/evidence/**` implementation).

Codex confirmed (adversarially): the 8 sections cohere as a non-authorizing design; the integrity model is
right (schema-valid != provenance-valid; validation re-reads bound artifacts; fixture/oracle/harness/tree/
command/result bound; `isMarker=false` cannot satisfy validity; anti-circularity by hashing the canonical
logical payload, not the marker file). §8 has the right dependency (guard before marker-write) and key custody
is correctly deferred as a Stop-and-Ask. Risk classified correctly as HIGH-RISK.

## Low-risk clarification (folded into the ADR before commit; non-blocking)

1. **Non-replay / run-identity.** Codex's one gap: HMAC/signature alone does NOT prevent a byte-for-byte
   *replay/copy* of a genuinely-valid marker while the bound artifacts + commit still match — so the ADR's
   "manually touched/copied marker MUST fail" is not fully achieved by tamper-evidence alone. Resolution:
   the ADR is amended (§2 schema, §4 validation, §5 guard) to REQUIRE a future non-replay mechanism — a
   guard-owned write record / run-identity / nonce validated OUTSIDE the marker file — so a copied or replayed
   marker fails validation even when its bound artifacts are unchanged. This is design-only (still no
   implementation) and sharpens the anti-fabrication model within ENA9 scope.

This does not expand scope; the verdict stands as READY and governance proceeds. The amended ADR is the artifact
the subsequent broker audit/verify reviews.

## Disposition

READY → eligible to govern. Proceeding to mark-reviewed + govern (standalone, content-bound to sha
`94c1cca9…`). HIGH-RISK + future marker authority: after writing/amending the ADR, broker `/cc-suite:audit` +
`/cc-suite:verify` run on the ADR before commit. User authorization for the marker-provenance-DESIGN step was
given explicitly; the §8 future WIs (tamper/fabrication guard, marker write, EVW5 hooks) remain separate
hard-stops — none authorized by ENA9; marker write must not precede the guard.

QUEUE_REVIEW_VERDICT=PASS
