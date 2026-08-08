---
description: Evidence-Genie M0 domain invariants — macOS-only local-first manual-truth substrate; A0.7 is the first real gate; citation/anchor/snapshot/export invariants are STOP-grade and must never be weakened
applies-to:
  - "native/evidence-core/**"
  - "docs/adr/*evidence*"
  - "dev-memo/plan-batch-casebox-evidence-*"
  - "dev-memo/plan-*evidence*"
  - "apps/**/evidence/**"
---

# Evidence-Genie M0 — Domain Invariants

Authoritative records for the Evidence-Genie M0 substrate. Composes under
`AGENTS.md` §"Evidence-Genie M0 workflow composition" (layer 3) and
`docs/adr/ADR-evidence-m0-xiaolai-workflow-composition.md` (EVW-00, D1-D7). The port plan is
`dev-memo/plan-batch-casebox-evidence-workflow-port-00.md`. These invariants are the apex of the
composition: any conflict with a generic workflow guardian resolves in favor of the invariant
(`AGENTS.md` §"Source hierarchy"). Surface conflicts, never silently choose.

This rule **records, it does not authorize**. No Evidence behavior, UI, anchors, export, snapshot,
compression, OCR, AI/VLM, cloud, auth, or network code is enabled by this file. A0.7 remains the first
real Evidence architecture gate; nothing builds on it until it is green and its failures classified.

## Invariants (records)

1. **macOS-only, local-first / offline-first.** Evidence-Genie M0 is a macOS-only, local-first and
   offline-first case-prep + courtroom tool. The offline guarantee is OS-enforced (App Sandbox with no
   network entitlements), not convention. This MUST NOT be weakened to a browser-first, multi-tenant, or
   default-on-cloud framing (see [[client-local-first]]).

2. **Manual-truth-only M0 scope.** M0 is the human-verifiable manual substrate. It MUST NOT introduce
   OCR, AI/VLM, external databases, evidence-weight scoring, cloud sync, an auth provider, or any network
   behavior. Lawyer-entered fields are authoritative and court-facing.

3. **A0.7 renderer-conformance is the first real Evidence architecture gate.** The A0.7
   `renderer-conformance` harness over real fixtures is the first reality gate and MUST be built and green
   before downstream Evidence architecture. It classifies each failure: class-1 (local normalization bug,
   fixable inline) vs class-2 (geometry-source instability, architectural STOP). A class-2 result MUST stop
   downstream work — do not build A3/A5/UI on top.

4. **No Evidence UI before A0.7 is green.** Product Evidence UI MUST NOT be started until A0.7 passes.
   This is a STOP-grade (`deny`) boundary, not advice.

5. **Citation identity comes only from DocumentPage.** Every citation MUST be derived solely from
   `DocumentPage` (`documentId + physicalPageIndex -> citationVolume + citationPageLabel`), byte-stable
   across close/reopen/export — never page-index arithmetic, never an optimized rendition. An ambiguous
   citation (maps to >1 physical page in scope) MUST be disambiguated or refused+warned, never guessed.

6. **Anchors persist page-ratio geometry against captured page geometry, never viewport/screen pixels.**
   Anchors MUST be ratio-based against the persisted page geometry (resolved box origin subtracted,
   rotation-aware, version-pinned to `geometryCapturedAt`), in PDF page space — never screen/viewport
   pixels. A replacement or geometry-version mismatch yields `needs_review`, never a stale location.

7. **OptimizedDocumentRendition is never the canonical citation/anchor source.** The uploaded original is
   authoritative for anchors and citations. An `OptimizedDocumentRendition` is a display/size convenience
   only, usable after geometry+anchor+readability verification, and MUST NEVER become the citation/anchor
   basis. Readable compression, never destructive canonicalization.

8. **Snapshot manifest/seal anti-circularity MUST be preserved.** The `SnapshotManifest` hashes a
   deterministic **logical** payload, NOT the encrypted DB file that holds the seal; a separate
   `SnapshotSeal` makes the manifest tamper-evident (no circular self-hash). This anti-circularity MUST NOT
   be collapsed.

9. **CanonicalExportModel, not raw .docx/PDF bytes by default, is the reproducibility layer.**
   Reproducibility MUST be measured against the `CanonicalExportModel` (deterministic serialization,
   byte-identical across display/re-export/restore). Raw `.docx`/PDF bytes MUST NOT be hashed by default;
   use canonicalized/normalized artifact hashing only where the renderer is controlled.

10. **`not_implemented` harness status fails, never passes.** Any Evidence harness that is not yet
    implemented MUST exit non-zero / report `not_implemented` as a **failure**. A `not_implemented` harness
    MUST NEVER be treated as passing or as satisfying a gate.

11. **Future AI suggestion layer is build-flagged and separate from manual truth.** Any future
    machine/AI suggestion output MUST be a build-flagged layer in a separate migration namespace
    (`Manual* != Extracted*`), promoted into manual tables only by explicit lawyer review. It MUST NOT
    overwrite or masquerade as manual truth.

12. **echo-sleuth pre-flight wording matches the repo rule.** The echo-sleuth **lessons/recall**
    pre-flight is **REQUIRED** before editing any `.claude/rules/**` file (the binding pre-flight for a rule
    edit), per [[echo-sleuth]] §C. The broader **lane-start recap** is REQUIRED before the major-lane
    triggers [[echo-sleuth]] §A enumerates (a new Phase-B sub-WI plan or impl, a new umbrella plan or
    revision, a new ADR, a new RCA lane, a `/project-autopilot` or `/loop` start, or whole-project intake);
    it is advisory for an individual WI that is not one of those triggers. Do not state recap is REQUIRED
    for every WI, and do not downgrade the §C lessons/recall pre-flight to SHOULD.
    **Conditional on plugin enablement** — per [[echo-sleuth]] §"Enablement gate", whenever the echo-sleuth
    plugin is unavailable both pre-flights are DORMANT: they MUST NOT block an Evidence WI and their
    absence MUST NOT be recorded as a skipped gate. This is an availability condition on the *mechanism*,
    not a downgrade of the wording, and it re-arms automatically once the plugin is enabled. No Evidence
    court-facing invariant (1-11) is affected.

## References
- `docs/adr/ADR-evidence-m0-xiaolai-workflow-composition.md` (EVW-00, D1-D7).
- `dev-memo/plan-batch-casebox-evidence-workflow-port-00.md` (port plan; §4.3 hard hooks, §4.4 harness).
- `AGENTS.md` §"Evidence-Genie M0 workflow composition" (the three-layer model + D3/D4 posture).
- [[client-local-first]], [[autonomy]], [[echo-sleuth]], [[cc-suite]] — composed Lawbar policy.
