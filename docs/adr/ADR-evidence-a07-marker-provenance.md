# ADR — A0.7 marker provenance (design only)

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
- **Status**: Proposed — **design only, non-authorizing**. This ADR designs the future A0.7 marker schema,
  evidence bindings, provenance-validation rules, and anti-fabrication requirements. It does **not** authorize,
  implement, or enable any marker write, provenance/HMAC code, tamper/fabrication guard, or EVW5 hook. Each
  implementation step in §8 is a separate, individually-authorized WI.
- **Date**: 2026-06-23.
- **Author**: Claude Code (WI-ENA9, governed-queue lane `evidence-a07-marker-provenance-design`).
- **Extends**: `docs/adr/ADR-evidence-a07-renderer-conformance-gate.md` (A07-GATE-00, esp. §5 marker policy +
  §8 sequencing) and `docs/adr/ADR-evidence-native-core-a07-feasibility.md` (ENA-00). Composes under
  `.claude/rules/evidence-genie.md` (invariants 3, 8, 10) and `AGENTS.md` §"Evidence-Genie M0 workflow
  composition". On conflict, the Evidence invariants win (`AGENTS.md` §"Source hierarchy").

## Context

A07-GATE-00 fixed the gate design; WI-ENA7 materialized the independent fixture/oracle; WI-ENA8 implemented the
A0.7 renderer-conformance harness, which runs green on the committed fixture (still true, and
misleading: per `docs/product/product-plan.md` §0, three of five oracles carry zero `samplePoints`,
so "runs green" does not mean normalization was checked) and **explicitly emits
`isMarker=false`** — a passing harness run is deliberately *not* a marker. What is still undefined is the
**durable marker**: the tamper-evident record that a real harness run produced a classified pass against the
reviewed fixture/oracle, such that a later reader (or gate) can trust A0.7 is green without re-running.

A07-GATE-00 §5 already states the policy in prose (no marker until provenance-valid evidence; un-fabricatable by
touching a file; future provenance/HMAC tamper-evidence; `dev-memo/run/evidence/**` absent until the marker-write
WI). This ADR turns that policy into a **concrete schema + binding + validation design** so the eventual
implementation cannot quietly weaken it. The recurring failure mode this must close is the EVW5 forgery hole:
**schema-valid ≠ provenance-valid** — a hand-authored file that merely matches the shape must NOT validate.

This ADR is **docs/governance only**: no `native/**`, `.github/**`, hooks, or app code; no marker file; and
`dev-memo/run/evidence/**` stays absent.

## Decision

Adopt the following marker provenance design. The numbered sections bind any future implementation WI; an
implementation that contradicts them requires a superseding ADR.

### 1. Marker objective

- A marker is **durable evidence that a real harness run produced a classified pass** (`status=pass`,
  `classification=ok`) against the reviewed fixture/oracle, bound to the exact inputs and execution context.
- A marker is **NOT** equivalent to a source file existing: creating/copying a file of the right shape is not a
  marker.
- A **harness pass is not a marker** unless provenance-valid marker material exists (the harness itself emits
  `isMarker=false`; §4).

### 2. Marker schema proposal (fields proposed, NOT implemented)

A future marker is a deterministic logical payload (canonical JSON) plus a separate tamper-evidence field over
that payload (parallel to the SnapshotManifest/SnapshotSeal anti-circularity, `evidence-genie.md` invariant 8 —
the seal is NOT a self-hash of the file that holds it). Proposed fields:

- `schemaVersion` — e.g. `"a07-marker/1.0.0"`.
- `gateId` — e.g. `"A07-GATE-00"`.
- `harnessImplCommit` — the git commit (and/or tree hash) of the harness implementation that ran.
- `fixturePath` + `fixtureSha256` — the exact fixture bytes audited.
- `oraclePath` + `oracleSha256` — the exact oracle bytes audited.
- `resultStatus` + `resultClassification` — must be `pass` / `ok` to be marker-eligible (§7).
- `observedPageCount`.
- `tolerance` — the oracle tolerance applied.
- `producedAt` — UTC timestamp of the harness run.
- `repoCommit` + `repoTreeHash` — repository state at run time.
- `command` — the exact command invocation that produced the result.
- `platform` — OS/arch/Swift+PDFKit version context (must indicate local/offline execution).
- `runId` — a unique **run-identity / nonce** for this specific harness execution (not derivable from the bound
  artifacts, so two runs over identical fixture/oracle/commit still differ). It is the anti-replay handle: the
  guard records accepted `runId`s in its own write ledger (§5) and rejects a marker whose `runId` is absent,
  reused, or already consumed (§4). Prevents byte-for-byte replay/copy of a genuine marker.
- `provenancePayloadHash` — sha256 of the canonical logical payload above (NOT of the file that will store the
  marker; anti-circularity).
- `provenance` — the tamper-evidence field: an HMAC (or equivalent, e.g. detached signature) over
  `provenancePayloadHash` + the bound artifact hashes, using a key/material **not derivable from the marker file
  itself**. (Key custody is a Stop-and-Ask: an HMAC key or signing key is "secret material" / "key custody"
  under `AGENTS.md` hard stops — the marker-write WI must resolve custody before any real key is used.)

The schema MAY be proposed here; it is implemented only by a future WI.

### 3. Evidence binding rules

A marker MUST bind to, and be invalid if any of these changes:

- the **exact fixture bytes** (`fixtureSha256`);
- the **exact oracle bytes** (`oracleSha256`);
- the **exact harness implementation** commit/tree (`harnessImplCommit`);
- the **exact classified result** (`resultStatus`/`resultClassification`/`observedPageCount`);
- the **exact command invocation** (`command`);
- the **local/offline execution context** (`platform` indicates offline; no network input was used — the
  harness already refuses non-file URLs).

Any drift in a bound artifact (different fixture, re-tuned oracle, changed harness, different result) MUST
invalidate the marker. A marker is a claim about one specific run over specific inputs, not a standing badge.

### 4. Validation rules

- **Schema-valid is NOT provenance-valid.** A file that parses and has all fields is not thereby a valid marker.
- **Provenance-valid** requires the validator to: re-read each bound artifact, recompute its hash, recompute the
  canonical `provenancePayloadHash`, and verify the `provenance` tamper-evidence (HMAC/signature) over it.
  Mismatch on any → invalid.
- A **manually touched / copied / hand-authored marker MUST fail** validation (its provenance field cannot be
  forged without the key material; and its bound hashes must match the real artifacts).
- A **missing or invalid `provenance` (HMAC/signature) MUST fail** validation.
- An **`isMarker=false` harness result cannot itself satisfy marker validity** — the harness output is an input
  to the marker-write WI, not a marker.
- **Non-replay (anti-copy), ledger-bound to the original.** Tamper-evidence alone does NOT stop a byte-for-byte
  *replay/copy* of a genuine marker while its bound artifacts + commit still match. Validation MUST therefore
  also resolve the marker's `runId` in a **guard-owned write ledger kept OUTSIDE the marker file** (§5) that
  binds each accepted `runId` to the **identity of the original accepted marker** — at minimum its
  `{marker path, canonical marker payload hash, repoCommit/treeHash}`. A marker is non-replay-valid **iff** its
  `runId` resolves to a ledger entry **and** the presented marker's path + canonical payload hash + repo/tree
  context **match that ledger entry exactly**. Consequences (both required):
  - a **copy** of a genuine marker (same `runId`) at a different path, or with any differing payload/context,
    does **NOT** match the ledger-bound original → **fails** (closes the "any recorded runId validates" hole);
  - the **original** marker keeps matching its own ledger entry on every later validation → it stays **durable**
    evidence (closes the "already-consumed runId stops being valid" hole — `runId` is bound, not single-use).
  This is what makes "a manually copied marker MUST fail" literally true even when nothing it binds to changed,
  without ever invalidating the genuine original.

### 5. Tamper/fabrication guard requirements

- The guard is a **separately authorized WI** (§8) and **MUST land before the marker-write WI** (A07-GATE-00 §8,
  the guard-before-write ordering is binding).
- The future guard MUST **reject fabricated marker files** and **reject marker writes that lack valid
  provenance** (per §4).
- The guard MUST **protect the eventual marker path** (`dev-memo/run/evidence/**`, §6) — e.g. a commit-boundary
  hard hook (like the existing run-control guards) that denies staging/committing a marker file unless it is
  provenance-valid — **before** marker-write is authorized. Until then the path stays absent.
- The guard MUST own a **write ledger** (outside the marker file) that, on accepting a provenance-valid marker
  write, records the `runId` **bound to that original marker's identity** — `{marker path, canonical marker
  payload hash, repoCommit/treeHash}` (§4). It then enforces the §4 non-replay check on every validation: the
  presented marker's `runId` must resolve to a ledger entry **and** its path + canonical payload hash + repo/tree
  context must match that entry exactly. The same `runId` presented from any other marker/location/payload is
  rejected, while the original keeps validating against its own ledger entry. This ledger-bound design defeats
  replay/copy of a genuine marker (not just edited/forged ones) **without** making the genuine original
  single-use. (The ledger itself is guard-owned state, written only by the guard — its own integrity/custody is
  part of the guard-implementation WI, not authorized here.)

### 6. Marker path policy

- Proposed path: under **`dev-memo/run/evidence/**`** (e.g. `dev-memo/run/evidence/a07/<repoCommit>.marker.json`),
  consistent with the existing run-control evidence namespace and the gitignore/guard posture.
- This ADR **does not create** the path. `dev-memo/run/evidence/**` MUST remain **absent** in ENA9; its first
  legitimate appearance is the marker-write WI, after the guard exists.

### 7. Failure semantics (marker eligibility)

- **Only `status=pass` AND `classification=ok`** may be eligible for marker creation.
- `fail`, `inconclusive`, `not_implemented`, `class_1_normalization_math_bug`,
  `class_2_geometry_source_instability`, `fixture_or_oracle_invalid`, and
  `inconclusive_no_checkable_assertions` are **NOT** marker-eligible.
- **Class-2 remains STOP/reassess and MUST NEVER be marker-eligible** (A07-GATE-00 §4); `not_implemented` is a
  FAIL (`evidence-genie.md` invariant 10) and is never marker-eligible.

### 8. Sequencing (each a separately authorized WI — none authorized by ENA9)

ENA9 authorizes **no implementation**. The remaining A07-GATE-00 §8 WIs, ordered:

1. **Tamper/fabrication guard implementation** — the validator + commit-boundary hard hook (§4, §5). **Must land
   before** marker-write.
2. **Marker write implementation** — produce a provenance-valid marker only after a passing harness run; first
   legitimate `dev-memo/run/evidence/**`. **Must not precede the guard.**
3. **EVW5 hard hooks** — the deferred Evidence stop-grade hooks, armed once harness + guard + marker exist.

**Marker write must not precede the guard.** This ordering is binding.

## Consequences

- **Positive**: the marker's anti-fabrication design (schema-valid ≠ provenance-valid; bound to exact
  fixture/oracle/harness/result/command/offline-context; manually-authored markers fail; guard-before-write) is
  fixed in a reviewed ADR before any code — so the marker-write WI cannot quietly become a "touch a file" badge.
- **Cost / risk**: key custody for the HMAC/signature is unresolved and is a Stop-and-Ask (`AGENTS.md` hard
  stops) the marker-write WI must answer; this ADR only names the requirement. The design is only as strong as
  the future guard implementation — §5's "guard before write" + cc-suite review at each WI is the mitigation.
- **Reversibility**: docs-only; revertable as a single commit. No runtime behavior changes.

## References

- `docs/adr/ADR-evidence-a07-renderer-conformance-gate.md` (A07-GATE-00, §5 marker policy, §8 sequencing).
- `docs/adr/ADR-evidence-native-core-a07-feasibility.md` (ENA-00).
- `.claude/rules/evidence-genie.md` — invariants 3 (A0.7-first / Class-1-vs-Class-2), 8 (snapshot
  manifest/seal anti-circularity), 10 (`not_implemented`-fails).
- `AGENTS.md` §"Evidence-Genie M0 workflow composition" + hard stops (key custody / secret material).
- WI-ENA7 fixture/oracle: `native/evidence-core-swift/Tests/EvidenceCoreSmokeTests/Fixtures/a07-renderer-conformance/`.
- WI-ENA8 harness: `native/evidence-core-swift/Sources/EvidenceCoreSmoke/A07ConformanceHarness.swift` (emits
  `isMarker=false`).
