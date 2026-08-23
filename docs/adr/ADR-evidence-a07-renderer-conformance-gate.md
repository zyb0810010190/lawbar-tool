# ADR — A0.7 renderer-conformance gate (design only)

> ### ⚠️ SUPERSEDED IN FACT — 2026-08-10
>
> **The machinery this ADR designs was never retained.** This document is `Status: Proposed —
> design only, non-authorizing`: it makes no claim that any gate, marker writer, validator, or
> guard was ever built. The tooling it anticipated — `scripts/workflow/check-a07-gate.sh`,
> `a07-marker-write.sh`, `a07_marker.py`, `check-marker-guard.sh` — was created and then deleted
> in the 2026-08-10 configuration reset (`49dd7ad`), so nothing in this design is currently
> implemented. A0.7 is **PROVISIONAL, not green**. Read this as an unexecuted design, not as a
> description of anything in force.
> *(Corrected 2026-08-12: an earlier banner asserted this ADR made present-tense enforcement
> claims. It does not — that banner was applied uniformly to six ADRs, and was wrong for this one.)*
- **Status**: Proposed — **design only, non-authorizing**. This ADR designs the future A0.7
  renderer-conformance gate; it does **not** authorize, implement, or enable any harness, fixture, oracle,
  marker, provenance, anchor, persistence, UI, or network behavior. Each implementation step named in §8 is a
  separate, individually-authorized WI.
- **Date**: 2026-06-23.
- **Author**: Claude Code (WI-ENA6, governed-queue lane `evidence-a07-gate-design`).
- **Supersedes / extends**: `docs/adr/ADR-evidence-native-core-a07-feasibility.md` (ENA-00). Composes under
  `AGENTS.md` §"Evidence-Genie M0 workflow composition" (layer 3) and `.claude/rules/evidence-genie.md`
  (invariants 3, 4, 7, 8, 9, 10). On any conflict, the Evidence invariants win (`AGENTS.md` §"Source hierarchy").

## Context

The Native Evidence Core feasibility ladder has merged five isolated, internal/probe-only steps, each
green on macOS CI and each explicitly scoped to NOT begin A0.7:

- **ENA1** — SwiftPM skeleton + macOS CI smoke.
- **ENA2** — PDFKit import/link probe (compile-gated capability constant).
- **ENA3** — PDF load/page-count probe over a 432-byte synthetic 2-page fixture
  (`native/evidence-core-swift/Tests/EvidenceCoreSmokeTests/Fixtures/synthetic-twopage.pdf`,
  sha256 `63d91a6c75cc10350c0a15df19a12620d938637acf3529c15cab7d4e6e0d9276`).
- **ENA4** — raw `mediaBox` width/height read (612 x 792), structural metadata only.
- **ENA5** — internal PDF-space ↔ normalized-`[0,1]` coordinate roundtrip probe (invertible within `1e-9`).

Per `.claude/rules/evidence-genie.md` invariant 3, **A0.7 renderer-conformance is the first real Evidence
architecture gate**: nothing downstream (A3 anchors, A5, Evidence UI) may be built until A0.7 is green and its
failures are classified. The probes above prove the toolchain *can* read geometry and do invertible
arithmetic; they do **not** prove that the geometry a renderer reports is *stable enough* to anchor evidence
against. That stability proof is exactly what A0.7 must establish. This ADR fixes the gate's design so the
eventual implementation cannot quietly weaken it.

This ADR is **docs/governance only**. It writes no `native/**` code, adds no fixture, and leaves
`dev-memo/run/evidence/**` absent.

## Decision

Adopt the following design for the future A0.7 renderer-conformance gate. The numbered sections are binding on
any future implementation WI; an implementation that contradicts them requires a superseding ADR.

### 1. Gate objective

- **A0.7 proves** that the renderer/page geometry the native core reads (page boxes and the coordinate frame
  derived from them) is **deterministic and stable** across reload/reopen and across the controlled renderer
  versions in scope — stable *enough* that a future anchor can be expressed as page-ratio geometry against
  captured page geometry (per `evidence-genie.md` invariant 6) without silently drifting.
- **A0.7 does NOT prove**: production evidence workflows, citation identity, anchor correctness, export
  reproducibility, UI behavior, persistence, OCR/AI extraction, or any legal/substantive correctness. A green
  A0.7 is a *necessary, not sufficient* precondition for downstream Evidence architecture.
- A0.7 is a **reality gate**, not a feature. Its only output is a classified pass/fail verdict over fixtures
  (see §4) and — only once §5 is satisfied — a provenance-valid marker.

### 2. Future fixture policy

- Every A0.7 fixture MUST be **synthetic or public, non-confidential** — never a client/matter PDF, never
  production-shaped real data (`evidence-genie.md` invariants 1–2; `AGENTS.md` hard-stop on exposing legal
  documents).
- Each fixture MUST record, in a committed manifest: **provenance** (how it was generated, deterministically
  where possible), **sha256 checksum**, **byte size**, **page count**, **per-page box geometry** (the boxes
  A0.7 inspects), and the **expected geometry** the oracle will assert.
- A fixture is **canonical only when documented and reviewed** — a bare committed PDF is not an oracle. An
  undocumented or unreviewed fixture MUST NOT gate anything.
- Fixtures exercising distinct renderer conditions (rotation, non-Letter sizes, differing crop vs media boxes,
  multi-page) are added as separate, documented entries; none becomes canonical implicitly.
- The existing ENA3 fixture is the seed example of the manifest discipline, not by itself an A0.7 oracle.

### 3. Future oracle policy

- **Expected values are defined BEFORE implementation** and committed in the fixture manifest. The oracle MUST
  be **independent of the code under test** — derived from the fixture's known construction (or an independent
  tool), never back-filled from whatever the harness happens to emit.
- The oracle MUST state, per fixture: page-index assumptions (0- vs 1-based, and the physical-page mapping),
  page-box assumptions (which box: media/crop, and the coordinate origin convention), the **expected geometry
  values**, and **tolerance rules** (absolute and/or relative, with units in PDF points) — tolerances chosen to
  catch real instability while permitting floating-point noise, and justified in the manifest.
- Result vocabulary is exactly three states:
  - **pass** — every asserted value is within tolerance.
  - **fail** — at least one asserted value is outside tolerance (subject to §4 classification).
  - **inconclusive** — the harness could not produce a comparable value (fixture failed to load, geometry
    unavailable, environment unsupported). **Inconclusive is NOT pass** and MUST NOT advance the gate.

### 4. Failure classification

Every A0.7 failure MUST be classified (per `evidence-genie.md` invariant 3):

- **Class 1 — local normalization/math bug**: the geometry source is stable, but the core's
  normalization/derivation is wrong. Resolution: fix the implementation inline and re-run. Continue only after
  green.
- **Class 2 — geometry-source instability**: the underlying renderer/geometry is itself unstable
  (non-deterministic across reload or across in-scope renderer versions). This is an **architectural STOP**:
  downstream Evidence work (anchors/A5/UI) MUST NOT be built on it. Resolution: stop and reassess architecture;
  do not proceed.
- The gate MUST NOT silently downgrade a Class-2 failure to green, to "inconclusive-treated-as-pass", or to a
  Class-1. A `not_implemented` harness reports **fail**, never pass (`evidence-genie.md` invariant 10).

### 5. Marker policy

- **No A0.7 marker may be written until a real harness executes and produces provenance-valid evidence** of a
  classified pass over the reviewed fixtures/oracle. A marker is a claim that A0.7 is green; it is illegitimate
  without that execution.
- A marker MUST be **impossible to fabricate by merely touching/creating a file**. Schema-validity ≠
  provenance-validity (the EVW5 forgery lesson): a future marker MUST carry tamper-evidence — a provenance
  binding (HMAC or equivalent) over the deterministic logical payload (the audited range/fixtures/oracle
  results), verified by a checker that rejects a hand-authored or schema-only marker.
- This lane (ENA6) **does not implement** marker writing or provenance. It only fixes the policy. Marker
  provenance design and the write path are separate WIs (§8).
- `dev-memo/run/evidence/**` MUST remain **absent** until the marker-write WI is authorized and implemented;
  its presence before then is itself a red flag.

### 6. Command / contract boundary

- A future A0.7 harness command and its output schema MAY be **proposed** (deterministic-JSON, consistent with
  the `native/evidence-core` contract surface), but this lane implements none.
- Any proposed schema MUST **preserve existing `not_implemented` failure semantics**: until a real harness
  exists, the command reports `not_implemented` and that status is a **failure**, never a pass
  (`evidence-genie.md` invariant 10).
- The existing `native/evidence-core` JS deterministic-JSON shim is **unchanged** in this lane and MUST NOT be
  wired to any A0.7 behavior here. Citations remain `DocumentPage`-only and an `OptimizedDocumentRendition` is
  never a citation/anchor basis (`evidence-genie.md` invariants 5, 7) — A0.7 does not alter those.

### 7. Non-goals (this gate and this lane)

- No Evidence UI; no PDFView/UI coordinate conversion.
- No production anchors; no rotation/captured-geometry versioning/persistence beyond what a future anchor WI
  defines.
- No citation / page-identity persistence; no export behavior.
- No OCR / AI / VLM / cloud / auth / network (`evidence-genie.md` invariants 1, 2, 11).
- No implementation of the harness, fixtures, oracle, marker, or provenance in ENA6.

### 8. Implementation sequencing (each a separately authorized WI — none authorized by ENA6)

ENA6 authorizes **none** of the following. Each is a future WI requiring its own explicit authorization +
governed-queue + cc-suite review:

1. **Fixture/oracle materialization** — commit documented synthetic fixtures + manifests with pre-defined
   expected values and tolerances (§2, §3).
2. **Harness command implementation** — the A0.7 renderer-conformance harness that runs fixtures against the
   oracle and emits a classified verdict (§3, §4), preserving `not_implemented`-fails until real.
3. **Marker provenance design** — the tamper-evident marker schema + provenance/HMAC binding (§5), design WI.
4. **Tamper/fabrication guard** — the checker + hard hook that rejects a fabricated/schema-only marker (§5;
   EVW5 hard-hooks family). **This MUST land before — or as part of — the marker-write WI (item 5): no path
   that can create a marker may ship until the guard that rejects a fabricated/schema-only marker is in place.**
   Sequencing the write before the guard would reopen the EVW5 forgery hole §5 forbids.
5. **Marker write implementation** — the path that writes a marker ONLY after a provenance-valid passing run
   (§5) **and only once the item-4 guard is in place**; first legitimate appearance of `dev-memo/run/evidence/**`.
6. **EVW5 hard hooks** — the deferred Evidence stop-grade hooks (per `AGENTS.md` §EVW composition / EVW5R),
   armed only once the harness + guard + marker exist.

The guard-before-write ordering (item 4 before item 5) is binding: it makes §5's "a marker is impossible to
fabricate by merely touching a file" enforceable from the very first marker that can ever be written.

Only after A0.7 is **green and its failures classified** may downstream Evidence architecture (A3 anchors, A5,
Evidence UI) begin (`evidence-genie.md` invariants 3, 4).

## Consequences

- **Positive**: the gate's objective, oracle independence, three-state result vocabulary, Class-1/Class-2 split,
  anti-fabrication marker policy, and `not_implemented`-fails semantics are fixed in a reviewed ADR before any
  code exists — so the eventual implementation cannot quietly weaken them, and a Class-2 instability cannot be
  laundered into a green marker.
- **Cost / risk**: this is design, not proof. It does not establish that the renderer geometry is actually
  stable — only what the future harness must show and must not claim. If §3 oracles or §2 fixtures are authored
  carelessly later, the gate could still be undermined; §2/§3's "documented + reviewed + independent oracle"
  requirements are the mitigation, enforced at each future WI's review.
- **Reversibility**: docs-only; revertable as a single commit. No runtime behavior changes.

## References

- `docs/adr/ADR-evidence-native-core-a07-feasibility.md` (ENA-00) — the feasibility decision this gate design
  builds on.
- `.claude/rules/evidence-genie.md` — Evidence-M0 invariants (esp. 3 A0.7-first, 4 no-UI-before-A0.7, 5
  citation identity, 6 anchors, 7 optimized-rendition, 8 snapshot anti-circularity, 9 export, 10
  `not_implemented`-fails, 11 AI-layer separation).
- `AGENTS.md` §"Evidence-Genie M0 workflow composition" — the three-layer model + EVW5/EVW5R hard-hook posture.
- `dev-memo/plan-batch-casebox-evidence-native-a07-feasibility-00.md` — the ENA feasibility plan.
- ENA1–ENA5 merged probes: PRs #103–#107 on `main` (`native/evidence-core-swift/**`).
- `native/evidence-core/README.md` — the JS deterministic-JSON shim contract (unchanged here).
