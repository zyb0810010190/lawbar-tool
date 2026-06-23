# ADR A3-CONTRACT-00 — Evidence-Genie M0 A3 anchor / link engine contract

**Status**: Accepted (contract/design only — authorizes no implementation).
**Date**: 2026-06-23.
**WI**: WI-A3-00 (Type PLAN; design-only; NOT A0.7-gated).
**Supersedes / extends**: none. Composes under `.claude/rules/evidence-genie.md` (inv.5/6/7) and the
A0.7 reality-gate ADRs `ADR-evidence-a07-renderer-conformance-gate.md` (A07-GATE-00) +
`ADR-evidence-a07-marker-provenance.md` (A07-MARK-00).

## 1. Context

Evidence-Genie M0 is a local-first, fully-offline macOS case-prep + courtroom tool. Both sides' evidence are
paginated PDFs; the lawyer draws hyperlinks (anchors) from work-product (evidence rows, notes, questions,
calc terms, claim elements) to a target page/region, and in the air-gapped hearing navigates to pre-marked
excerpts. The **A3 anchor / link engine** persists those anchors and resolves those links.

The A0.7 renderer-conformance reality gate is now built and hard-enforced (A07-GATE-00 §1; the EVW5
`check-a07-gate.sh` hook). A0.7 is the **first real Evidence architecture gate**; nothing that depends on
"A0.7 green" may be built until A0.7 is genuinely green, proven by a provenance-valid local marker
(A07-MARK-00). A3 anchor geometry is exactly such a dependent: it relies on the stable page identity +
resolved-box geometry + coordinate round-trip that A0.7 proves.

This ADR converts the handover's A3 model (`Evidence-Genie-M0-Developer-Handover.md` §10 entities, §5 A0.7
class-1/class-2, the A3 ticket set A3-T1..A3-T10, §11 open decisions) into repo-local contract boundaries
**before any implementation**. It defines the invariants, the headless API contracts (signatures only), the
A0.7-dependence rule, the failure classes, and the stop conditions. It writes no code, no schema, no
migration, and adds no dependency.

This is the **design** layer. The implementation WIs it scopes are listed in
`dev-memo/plan-batch-casebox-evidence-a3-anchor-contract-00.md`.

## 2. Decision summary — the ten recorded decisions

1. **A3-00 (this design WI) is design-only and NOT A0.7-gated.** A contract ADR executes no anchor math,
   geometry resolution, persistence, link status, or product behavior, so it needs no live provenance-valid
   A0.7 marker. The A0.7 hard gate is left unchanged and still fails closed for genuinely A0.7-dependent
   actions. (User reclassification 2026-06-23, overriding the prior "must include Requires-A07: yes"
   instruction; broker review-plan `review-plan-mqqpew61-aef001` confirmed CONFIRMED-DESIGN-ONLY-NOT-GATED.)
2. **All A3 implementation WIs ARE A0.7-gated.** Every A3 WI that touches anchor math, geometry resolution,
   persistence, link status, native code, or product behavior MUST declare `Requires-A07: yes` in its
   governed queue block (or set `A07_REQUIRED` for its protected action) AND pass the A0.7 hard gate with a
   provenance-valid local marker. See §6.
3. **Anchor identity binds to `documentId + physicalPageIndex`.** An anchor names the document and the
   physical page index it was drawn on; navigation is by `physicalPageIndex`, never by an optimized
   rendition or page-index arithmetic.
4. **Anchor geometry binds to a captured `DocumentPageGeometry` version.** Each anchor records the
   `geometryCapturedAt` version (the geometry it was normalized against). The resolved box
   (`cropBox` → `mediaBox` fallback, recorded) + bounds + rotation are the persisted basis.
5. **Persisted rects use `page_ratio`, never viewport/screen coordinates.** The persisted rect is
   `{x, y, width, height, coordinateSpace:"page_ratio", originRef:"DocumentPageGeometry", pageRotation}`. No
   viewport/screen pixel ever enters persistence.
6. **Ratios are derived only from the persisted resolved box/bounds/rotation.** Normalization subtracts the
   resolved box origin and is rotation-aware (PDF page space: lower-left origin, 72 dpi). Ratios are computed
   against the persisted geometry, not against a live PDFKit view.
7. **Geometry mismatch or document replacement yields `needs_review`, never a stale valid coordinate.** If
   the anchor's `geometryCapturedAt` no longer matches the current persisted geometry version, or the
   document is in `replaced_pending_review` / `superseded`, link resolution returns `needs_review` — it never
   returns a coordinate that silently points at the wrong place.
8. **Broken links must be explicit, never silent.** A `broken` link resolves to an explicit error
   (surfaced + auditable), never to a guessed or empty location. Export degradation maps each in-app link to
   a textual citation (卷X页Y) **or** an explicit `ExportCitationFlag`, never dropped and never silently
   wrong (bijection link ↔ citation/flag, per A10-T2).
9. **Anchor-delete cascade rule (A3-T6) is UNRESOLVED.** The handover §11 specifies "delete cascades per
   rule" but leaves the rule itself undecided (`broken`-with-audit vs hard-delete). This ADR does NOT decide
   it; inventing cascade policy under a contract-design WI is out of scope. The implementation WI for A3-T6
   STOPS-AND-ASKS for the policy.
10. **First implementation lane = pure headless `page_ratio` normalization math (A3-T2) FIRST**, before
    schema/persistence (A3-T1), native, or product UI. The schema should encode stable coordinate semantics,
    not discover them. The single WI that may touch persistence is **A3-T1** (anchor schema), and it is
    A0.7-gated. Sequence + fixtures in the companion plan.

## 3. A3 invariants (the contract)

These restate and specialize `.claude/rules/evidence-genie.md` inv.5/6/7 for the anchor/link engine. Any
A3 implementation conflicting with one of these STOPS and surfaces the conflict (`AGENTS.md` §"Source
hierarchy"); it never silently chooses.

- **INV-A3-1 — Anchor identity.** `Anchor` binds `documentId + physicalPageIndex` (FK → `DocumentPage`,
  `UNIQUE(documentId, physicalPageIndex)` page identity). Citation/anchor identity comes only from
  `DocumentPage`; never from an `OptimizedDocumentRendition` and never from page-index arithmetic.
- **INV-A3-2 — Geometry-version binding.** Every `Anchor` records `geometryCapturedAt` (FK →
  `DocumentPageGeometry` version). The rect is meaningful ONLY against that geometry version.
- **INV-A3-3 — page_ratio only.** Persisted rects are `coordinateSpace:"page_ratio"`, `originRef:
  "DocumentPageGeometry"`, with `pageRotation`. No viewport/screen pixel is ever persisted or exported.
- **INV-A3-4 — Ratio derivation.** A ratio is derived only from the persisted resolved box (`cropBox` →
  `mediaBox` fallback, recorded), with the box origin subtracted and rotation applied. In PDF page space
  (lower-left origin, 72 dpi). The y-axis convention is fixed and documented by the implementation; it must
  be applied identically in normalize and denormalize.
- **INV-A3-5 — Deterministic precision + roundtrip tolerance** *(folds review Medium)*. `page_ratio`
  components are in `[0, 1]`, computed in IEEE-754 binary64, then persisted at a **fixed canonical precision
  of exactly 12 fractional decimal places** (resolution `1e-12`) using a **single deterministic rounding
  mode (round-half-to-even)** and serialized as a **canonical fixed-point decimal string** (always 12
  fractional digits, leading `0.` for values `< 1`, no exponent, no trailing-zero trimming, `-0` normalized
  to `0`). With the precision, rounding mode, and serialization all pinned, two conforming implementations
  produce **byte-identical** persisted ratios for the same input. The `page-space → page_ratio → page-space`
  round-trip MUST be within an explicit absolute tolerance of **≤ 1e-9 in page_ratio units** (i.e. relative
  to the resolved box dimensions, consistent with the A0.7 oracle tolerance `1e-9`); the 12-dp persistence
  resolution (`1e-12`) is deliberately three orders finer than this tolerance, so persistence rounding is
  never the dominant round-trip error. A round-trip outside tolerance is a class-1 A0.7 normalization bug
  (§7), not a silent pass.
- **INV-A3-6 — needs_review on mismatch/replacement.** If the anchor's `geometryCapturedAt` ≠ the current
  persisted geometry version, or the owning `Document` is `replaced_pending_review` / `superseded`, link
  resolution returns `needs_review`. It NEVER returns a stale coordinate.
- **INV-A3-7 — Fail-closed provenance** *(folds review Medium)*. Link resolution MUST fail closed —
  `needs_review` (or an explicit refusal), never a guessed location — when the required geometry provenance is
  **absent** (no `DocumentPageGeometry` for that version) **or ambiguous** (more than one candidate geometry
  in scope), not only when it explicitly mismatches. Absence/ambiguity is treated exactly like mismatch.
- **INV-A3-8 — Explicit broken links.** `LinkStatus = valid | needs_review | broken`. A `broken` link
  resolves to an explicit, auditable error, never a silent empty/guessed location.
- **INV-A3-9 — Export degradation is total + bijective.** On export, every in-app link maps to a textual
  citation (卷X页Y) OR an explicit `ExportCitationFlag` (`引用待核_NEEDS_REVIEW` / `引用缺失_BROKEN` /
  `不可引用_NON_CITABLE` / `引用歧义_AMBIGUOUS` / `文档已替换_REPLACED`). No link is dropped or silently
  rendered wrong (A10-T2 bijection).
- **INV-A3-10 — Headless / no-viewport.** Anchor creation, resolution, and classification are headless
  (testable without a window). Viewport/screen coordinates may exist only transiently in the UI gesture layer
  and are converted to page-space BEFORE reaching the anchor engine; the engine's persistence boundary never
  sees them.

## 4. Headless API contracts (signatures only — NO implementation)

Language-neutral contracts for the future implementation (native `evidence-core-swift` and/or the JS shim).
These define shapes + pre/post-conditions, not code.

```
// Resolved page geometry (read from persisted DocumentPageGeometry; never a live view).
PageGeometry = {
  documentId, physicalPageIndex,
  resolvedBox: "cropBox" | "mediaBox",      // fallback recorded
  boundsX, boundsY, boundsWidth, boundsHeight,
  rotation,                                  // 0|90|180|270
  geometryCapturedAt                         // the geometry VERSION key
}

PageSpaceRect  = { x, y, width, height }     // PDF page space, lower-left origin, 72 dpi
PageRatioRect  = { x, y, width, height,      // each in [0,1], 12-dp canonical decimal string (INV-A3-5)
                   coordinateSpace: "page_ratio", originRef: "DocumentPageGeometry", pageRotation }

// 1. normalize: page-space rect -> page-ratio rect, against a SPECIFIC persisted geometry version.
//    pre:  geometry resolved + present (else error, never guess)
//    post: result components in [0,1] at canonical precision; box origin subtracted; rotation applied
normalizePageSpaceToRatio(rect: PageSpaceRect, geometry: PageGeometry) -> PageRatioRect

// 2. denormalize: page-ratio rect -> page-space rect, against the SAME geometry version it was normalized to.
//    pre:  rect.pageRotation + originRef consistent with geometry; geometry version matches
//    post: round-trip within tolerance ≤ 1e-9 of box dims (INV-A3-5)
denormalizeRatioToPageSpace(rect: PageRatioRect, geometry: PageGeometry) -> PageSpaceRect

// 3. create anchor: bind identity + geometry version + ratio rect. Headless; no viewport input.
//    pre:  DocumentPage exists; geometry version present; rect already in page_ratio
//    post: Anchor { documentId, physicalPageIndex, geometryCapturedAt, rect: PageRatioRect, label? }
createAnchor(documentId, physicalPageIndex, geometry: PageGeometry, rect: PageRatioRect, label?) -> Anchor

// 4. resolve link: anchorId -> resolved tuple OR a non-valid status. Fail-closed (INV-A3-6/7/8).
//    returns either { documentId, physicalPageIndex, geometryCapturedAt, rect: PageRatioRect, status:"valid" }
//    or { status: "needs_review" | "broken", reason } — NEVER a stale coordinate, NEVER a guess.
resolveLink(linkId) -> ResolvedLink | NonValidLink

// 5. classify link status: pure function over (anchor, current geometry version, document status).
//    valid | needs_review | broken. needs_review on version mismatch OR absent/ambiguous provenance
//    OR document replaced; broken on orphan/out-of-range/unresolvable.
classifyLinkStatus(anchor, currentGeometryVersion, documentStatus) -> LinkStatus

// 6. mark replacement / quarantine effects: when a Document goes replaced_pending_review/superseded or a
//    geometry version changes, recompute affected links to needs_review (audited). No silent revalidation.
markReplacementEffects(documentId, fromGeometryVersion?, toGeometryVersion?) -> { affectedLinkIds[], audited: true }
```

Notes: (a) all six are **headless** and unit-testable without a window; (b) none accepts viewport/screen
coordinates; (c) `resolveLink` / `classifyLinkStatus` are fail-closed per INV-A3-6/7/8; (d) precision +
tolerance per INV-A3-5 are part of the normalize/denormalize contract, not an implementation detail.

## 5. Data-model dependencies (from handover §10; not introduced here)

A3 depends on these existing/specified entities; this ADR introduces no schema and changes none:

- `DocumentPage { id, documentId, physicalPageIndex, citationVolume?, citationPageLabel, citationPageSortKey?,
  isCitable, note? }` — `UNIQUE(documentId, physicalPageIndex)`. Citation/anchor identity owner.
- `DocumentPageGeometry { documentId, physicalPageIndex, resolvedBox, boundsX/Y/Width/Height, rotation,
  pdfKitVersion?, capturedAt }` — `UNIQUE(documentId, physicalPageIndex)`, FK → DocumentPage;
  `capturedAt` = the geometry **version**.
- `Anchor { id, documentId, physicalPageIndex, geometryCapturedAt, rect(page_ratio), label? }` — FK →
  DocumentPage, FK → DocumentPageGeometry(version).
- `Link { id, sourceType, sourceId, anchorId, status:LinkStatus }`; `LinkStatus = valid|needs_review|broken`.
- `Document.status = canonical | replaced_pending_review | superseded` (drives INV-A3-6).

**Decision 3 — geometry-version key.** `geometryCapturedAt` is the version key the handover specifies and is
**sufficient** for M0 IF it is treated as immutable per capture (a new capture is a new version; existing
anchors keep pointing at their original version and go `needs_review` on mismatch). The A3-T1 schema WI MUST
enforce that `geometryCapturedAt` is immutable and that a geometry re-capture writes a NEW version rather
than mutating the existing row. If A0.7 reveals geometry-source instability (class-2, §7), a stronger
immutable geometry identifier (e.g. a geometry content hash) is reconsidered THEN — not now.

## 6. A0.7-dependence declaration mechanism (for the implementation WIs)

Per A07-GATE-00 + the EVW5 hard gate (`scripts/workflow/check-a07-gate.sh`): an action is A0.7-dependent when
`A07_REQUIRED=1|true|yes` in the environment OR the governed `dev-memo/run/queue.md` block carries a
`Requires-A07: yes|true` line. When dependent, at least one provenance-valid local A0.7 marker must exist
(env key `LAWBAR_A07_MARKER_HMAC_KEY` + `a07_marker.py validate`) or the gate fails closed.

Therefore every A3 IMPLEMENTATION WI (A3-T2 math, A3-T1 schema/persistence, A3-T5 resolver, A3-T6 mutation,
A3-T7 integrity, A3-T3 renderer-conformance, A3-T10 regression, …) MUST carry `Requires-A07: yes` in its
queue block and run with a genuine local marker. This design WI (A3-00) deliberately does not (decision 1).
The marker is local-only + gitignored; the key is env-only + fail-closed; neither is ever committed.

## 7. Failure classes + stop conditions

A3 inherits the A0.7 class-1/class-2 classification (handover §5; A07-GATE-00):

- **Class 1 — normalization/math bug → fix locally, continue.** Page identity + persisted geometry are
  stable, but a rect lands shifted/inverted/scaled wrong (box origin not subtracted; y-axis inversion; wrong
  rotation transform; ratio uses mediaBox while geometry says cropBox; viewport leak; round-trip outside the
  INV-A3-5 tolerance). Response: fix the A3-T2 normalization math + re-run; no architecture reset.
- **Class 2 — geometry-source instability → STOP downstream.** The same unmodified file reopened yields
  unstable `physicalPageIndex` / page count / `resolvedBox` / bounds / rotation / geometry hash. Response:
  **do not build A3 persistence/resolver/UI on top.** Reassess the geometry-source assumption (PDF
  canonicalization at import, a different renderer, page fingerprinting, or a stronger page identity than
  `physicalPageIndex` alone). This is the A0.7 architectural STOP; A3 implementation does not proceed past it.

Hard stops specific to A3 implementation WIs: a needed schema/persistence change (defer to A3-T1, gated);
GRDB/SQLCipher or any new dependency (autonomy hard stop — STOP and ask); the anchor-delete cascade policy
(A3-T6 — undecided, STOP and ask); any viewport coordinate reaching persistence (INV-A3-3/10 violation —
STOP); any attempt to make `OptimizedDocumentRendition` the anchor basis (inv.7 violation — STOP).

## 8. Consequences + open items

- **Positive**: the A3 coordinate + resolution contract is fixed before code; the first implementation lane
  is unambiguous (headless math first); the A0.7-dependence rule is explicit for every downstream WI; the
  stale-anchor and wrong-citation bug classes are closed by INV-A3-5/6/7/8.
- **Open (preserved, not decided here)**: the anchor-delete cascade rule (A3-T6, decision 9) — `broken`-with
  -audit vs hard-delete — remains undecided per handover §11; its implementation WI STOPS-AND-ASKS.
- **Deferred reconsideration**: a stronger immutable geometry-version identifier than `geometryCapturedAt`
  (decision 3) is reconsidered ONLY if A0.7 shows class-2 geometry-source instability.

## References
- `Evidence-Genie-M0-Developer-Handover.md` (root intake, read-only) §5 (A0.7 class-1/2), §10 (entities),
  A3 ticket set A3-T1..A3-T10, §11 (open decisions).
- `.claude/rules/evidence-genie.md` inv.3/4/5/6/7.
- `docs/adr/ADR-evidence-a07-renderer-conformance-gate.md` (A07-GATE-00),
  `docs/adr/ADR-evidence-a07-marker-provenance.md` (A07-MARK-00).
- `dev-memo/plan-batch-casebox-evidence-a3-anchor-contract-00.md` (the implementation WI sequence).
- `scripts/workflow/check-a07-gate.sh` (the A0.7-dependence hard gate).
