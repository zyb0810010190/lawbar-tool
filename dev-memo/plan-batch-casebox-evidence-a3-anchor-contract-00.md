# BATCH-CASEBOX-EVIDENCE-A3-ANCHOR-CONTRACT-00 (plan — proposal)

**Status**: proposal plan (untracked-style; the governed `dev-memo/run/queue.md` is the authority). This plan
**proposes** the A3 implementation WI sequence; it does NOT authorize execution. Each WI is separately
authored into `queue.md`, governed (lint + review-plan + govern), and gated before it runs.
**Date**: 2026-06-23. **Type**: PLAN (design / sequencing).
**ADR**: `docs/adr/ADR-evidence-a3-anchor-link-contract.md` (A3-CONTRACT-00) — the contract + invariants +
headless API + the ten decisions. Read it first.

## 0. Purpose & scope cut

Sequence the A3 anchor/link engine implementation AFTER the A0.7 reality gate (now merged + hard-enforced).
Define: the first implementation lane, which single WI may touch persistence, the test fixtures the first lane
needs, and the failure classes + stop conditions. **This plan writes no code, schema, migration, or
dependency.**

This plan produces nothing but itself + the ADR. It explicitly does NOT: implement anchor math; add schema /
migrations; add GRDB/SQLCipher or any dependency; build Evidence UI/forms (A5); touch `apps/**`, `native/**`,
`.claude/**`, `.github/**`; create any committed marker/ledger/key/evidence-run file; decide the anchor-delete
cascade rule (A3-T6, undecided).

## 1. A0.7-dependence rule (binding on every WI below)

Every A3 implementation WI is A0.7-DEPENDENT and MUST:
- carry `Requires-A07: yes` in its governed `queue.md` block (or set `A07_REQUIRED` for its protected action);
- run with a genuine, provenance-valid LOCAL A0.7 marker (env key `LAWBAR_A07_MARKER_HMAC_KEY` +
  `a07_marker.py validate`), else `scripts/workflow/check-a07-gate.sh` fails closed;
- never commit a marker/ledger/key (local-only + gitignored under `dev-memo/run/evidence/**`).

A3-00 (this design lane + the ADR) is the ONLY A3 WI that is NOT A0.7-gated (ADR decision 1). The marker/key
custody decision (how the env key reaches the agent/CI environment) is resolved when the first
implementation WI (A3-T2) is authorized — it is a secrets/key-custody decision for the user, not this plan.

## 2. Proposed A3 implementation WI sequence

Ordered by dependency (handover A3 order `T2→T1→T5→T6→T7→T4→T8→T9→T3→T10`, reconciled with "math before
schema"). Each is a SEPARATE WI; none auto-authorized. Risk/gates summarized; full per-WI blocks authored at
promotion time into `queue.md`.

```
WI-A3-T2  IMPL   Pure headless page_ratio normalization/denormalization math (NO persistence, NO schema).
                 normalizePageSpaceToRatio + denormalizeRatioToPageSpace per ADR §4: box-origin subtracted,
                 rotation-aware, canonical precision + roundtrip tolerance ≤ 1e-9 (INV-A3-5). Verify:
                 `coordinate-roundtrip` over the §3 fixtures (cropBox-offset, rotated, mixed-size,
                 non-zero-origin, mediaBox-fallback). A0.7-gated. NO new dependency.   ◀── FIRST lane.
                 Allowed: native/evidence-core-swift/** (math + tests) OR native/evidence-core/** (JS), TBD by
                 its own review-plan; dev-memo governance. Depends: A3-00 (this ADR). Risk: A0.7-dependent
                 coordinate math (review-plan + audit + verify; the single coordinate contract).

WI-A3-T1  IMPL   Anchor + Link schema (FKs to DocumentPage + DocumentPageGeometry version; ratios only;
                 geometryCapturedAt immutable per ADR §5 decision 3). THE ONLY WI THAT MAY TOUCH PERSISTENCE.
                 HIGH-RISK (persistence/migration) — review-plan REQUIRED; migration is its own hard stop
                 (autonomy). Verify: schema asserts + `migrate+assert-constraints`. A0.7-gated.
                 Depends: A3-T2. (GRDB/SQLCipher dependency choice, if any, is a SEPARATE user-authorized WI.)

WI-A3-T5  IMPL   Follow-link resolver (headless tuple; quarantine-aware; needs_review on version mismatch OR
                 absent/ambiguous provenance per INV-A3-6/7; broken -> explicit error per INV-A3-8). Verify:
                 `resolve-links`. A0.7-gated. Depends: A3-T1.

WI-A3-T6  IMPL   Mutation / cascade (move re-normalizes to the SAME version; delete cascade PER RULE —
                 UNDECIDED, ADR decision 9). This WI STOPS-AND-ASKS for the cascade policy before coding it.
                 Verify: `anchor-mutation`. A0.7-gated. Depends: A3-T5.

WI-A3-T7  IMPL   Integrity checker (out-of-range / orphan / needs_review / broken / geometry-version
                 mismatch). Verify: `integrity-scan`. A0.7-gated. Depends: A3-T5.

WI-A3-T4  IMPL   Source registry (valid source types; existing-source ref; delete cascades). Verify:
                 `source-registry`. A0.7-gated. Depends: A3-T1.

WI-A3-T8  IMPL   Coverage-gap query (sources with no valid link). Verify: `coverage-gap`. A0.7-gated.
                 Depends: A3-T5, A3-T4.

WI-A3-T9  IMPL   Link-manager query (filter/sort; perf budget). Verify: `link-query`. A0.7-gated.
                 Depends: A3-T5.

WI-A3-T3  IMPL   Renderer conformance (stable index, box bounds + fallback + non-zero origin, rotation,
                 round-trips). CI GATE. Verify: `renderer-conformance`. A0.7-gated. Depends: A3-T2.

WI-A3-T10 TEST   Regression suite (reopen/freeze identical; quarantine/replacement scenarios). CI GATE.
                 Verify: `a3-regression`. A0.7-gated. Depends: A3-T5, A3-T6, A3-T7.
```

**Sequencing note**: A3-T2 (pure math) is the first lane — it proves the coordinate contract before A3-T1
freezes it into schema. A3-T1 is the only persistence-touching WI and is HIGH-RISK (migration + possible
dependency, both autonomy hard stops handled in their own authorizations).

## 3. Test fixtures the first implementation lane (A3-T2) needs

Synthetic only; NO client-confidential PDFs (handover §10 / port-plan §4.4). The A3-T2 `coordinate-roundtrip`
needs page-geometry fixtures + expected oracle exercising each normalization edge:

- **F1 — zero-origin upright**: resolvedBox=mediaBox, origin (0,0), rotation 0 (the existing
  `synthetic-twopage.pdf` geometry, mediaBox [0 0 612 792]).
- **F2 — cropBox non-zero origin**: resolvedBox=cropBox with boundsX/Y ≠ 0 (proves box-origin subtraction).
- **F3 — rotated**: rotation ∈ {90, 180, 270} (proves rotation-aware transform).
- **F4 — mixed page sizes**: different bounds per page (proves per-page geometry, not a global box).
- **F5 — mediaBox fallback**: no cropBox → mediaBox used + recorded.
- **Oracle**: for each fixture, expected `page-space → page_ratio → page-space` pairs at canonical precision,
  tolerance ≤ 1e-9 (mirrors the A0.7 oracle convention). Round-trip outside tolerance = class-1 bug.

Fixtures live under the future A3-T2 test tree (native or JS, decided by A3-T2's review-plan); they are
authored in that WI, not here.

## 4. Failure classes + stop conditions (from ADR §7)

- **Class 1** (normalization/math): fix A3-T2 math, re-run, continue. No architecture reset.
- **Class 2** (geometry-source instability): STOP downstream A3 work; reopen the geometry-source assumption.
- **Hard stops** (STOP and ask): persistence/migration outside A3-T1; GRDB/SQLCipher or any new dependency;
  the A3-T6 cascade policy (undecided); a viewport coordinate reaching persistence; making
  `OptimizedDocumentRendition` the anchor basis.

## 5. Verification (this design PR)

This PR is docs-only (ADR + this plan); it changes no source. Real commands:
- `scripts/workflow/check-contract-integrity.sh` (contract docs unperturbed).
- `scripts/workflow/check-gates.sh` (A0.7 gate: queue has no `Requires-A07`, no markers → not required →
  pass; desktop suite 610/610).
- `npm --prefix apps/lawbar-desktop test`.

## 6. Stop condition

This plan is "done" when the ADR + this plan are committed (WI-A3-00). It is "outdated" when its §2 WIs are
promoted into `queue.md` and governed (then `queue.md` + the ADR are the authority), or when A3-CONTRACT-00
is superseded.

## References
- `docs/adr/ADR-evidence-a3-anchor-link-contract.md` (A3-CONTRACT-00).
- `Evidence-Genie-M0-Developer-Handover.md` (root intake) §5/§10/§11, A3 ticket set.
- `.claude/rules/evidence-genie.md`, `docs/adr/ADR-evidence-a07-renderer-conformance-gate.md`,
  `docs/adr/ADR-evidence-a07-marker-provenance.md`.
- `scripts/workflow/check-a07-gate.sh`, `scripts/workflow/check-gates.sh`,
  `scripts/workflow/check-contract-integrity.sh`.
