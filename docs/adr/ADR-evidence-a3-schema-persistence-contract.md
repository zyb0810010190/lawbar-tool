# ADR A3-SCHEMA-00 — Evidence-Genie M0 A3 anchor / link schema + persistence contract

**Status**: Accepted (schema/persistence CONTRACT — design only; authorizes no migration or persistence code).
**Date**: 2026-06-23.
**WI**: WI-A3-T1 (Type PLAN; design-only; NOT A0.7-gated).
**Composes under**: `ADR-evidence-a3-anchor-link-contract.md` (A3-CONTRACT-00 — invariants + headless API +
cascade-unresolved) and `ADR-evidence-a07-key-custody-operating-model.md` (A07-KEY-00 — A3 impl WIs are
A0.7-gated, custody mode 9b). The canonical `page_ratio` producer is `native/evidence-core/lib/page-ratio.mjs`
(A3-T2, merged). Entity vocabulary: `Evidence-Genie-M0-Developer-Handover.md` §10 (read-only intake).

## 1. Context

A3-T2 (merged) produces a canonical `page_ratio` rect — fixed 12 fractional decimal places, round-half-to-even,
fixed-point decimal string, byte-stable. This ADR defines **how anchors and links are persisted** so that the
A3 invariants (A3-CONTRACT-00 §3) survive storage: an anchor must never persist a stale or wrong location, a
link must never default to `valid`, and viewport/screen coordinates must never enter persistence.

This is the **contract** layer. It writes no schema, no migration, and adds no storage-engine dependency. The
storage engine itself (SQLite / GRDB / SQLCipher) is a **future dependency hard-stop**, decided in its own
user-authorized WI — not here. The future A3-T1 **implementation/migration** WI that realizes this schema is
**A0.7-gated** (`Requires-A07: yes`, custody mode 9b) and is itself a persistence/migration + possible
new-dependency autonomy hard stop.

## 2. Decisions (the eight groups)

1. **Anchor storage model.** An `Anchor` row binds `documentId + physicalPageIndex` (FK → `DocumentPage`,
   which owns page identity via `UNIQUE(documentId, physicalPageIndex)`). It stores the canonical
   `page_ratio` rect produced by A3-T2 as **four fixed 12-dp decimal STRING** columns (see decision-Medium
   below), plus `coordinateSpace='page_ratio'`, `originRef='DocumentPageGeometry'`, and `pageRotation`. The
   anchor PK is its own `id` (multiple anchors per page are allowed, each a distinct rect). **No
   viewport/screen coordinate is ever a column** — the only coordinate columns are `page_ratio` strings.
2. **Geometry-version binding.** An `Anchor` stores `geometryCapturedAt` as a **NOT NULL** FK → the captured
   `DocumentPageGeometry` version. `geometryCapturedAt` is the version key (A3-CONTRACT-00 decision 3) until a
   later WI introduces a stronger immutable geometry identifier. It is **immutable for a stored anchor**: a
   geometry re-capture writes a NEW `DocumentPageGeometry` version; existing anchors keep their original
   `geometryCapturedAt` and resolve to `needs_review` on mismatch. **Absent provenance cannot create an
   anchor** (NOT NULL + FK); ambiguous provenance is resolved to a single version before insert (the A3-T2
   math already fail-closes on ambiguity).
3. **Link model.** A `Link` row references a work-product source (`sourceType ∈
   {evidence,note,question,calcTerm,claimElement}` + `sourceId`) and a target `anchorId` (FK → `Anchor`).
   `status` is a stored enum **`LinkStatus ∈ {valid, needs_review, broken}`** with a `CHECK` constraint and
   **NO `DEFAULT 'valid'`** (decision-Low). A link to a missing/absent target resolves to explicit `broken`;
   a geometry-version mismatch or a replaced/superseded document resolves to `needs_review` — neither can
   remain `valid`.
4. **Replacement / quarantine.** `Document.status ∈ {canonical, replaced_pending_review, superseded}` is
   stored; when a document leaves `canonical`, every link whose anchor targets it becomes `needs_review`
   deterministically (computed by the later resolver WI, not silently). **No stale coordinate stays silently
   valid.** The schema stores the fields that make this derivation possible; it does not bake in the
   transition logic.
5. **Deletion / cascade — UNRESOLVED.** Per A3-CONTRACT-00 decision 9, the anchor-delete cascade rule
   (`broken`-with-audit vs hard-delete) is **left undecided**; this schema ADR introduces **no `ON DELETE`
   cascade** and invents no policy. The future A3-T6-equivalent WI **stops-and-asks** for the policy before
   adding any cascade.
6. **Migration boundaries.** Three sequenced implementation WIs, each separate and (where they touch
   persistence) A0.7-gated:
   - **WI-A3-T1-IMPL** — schema only: create the `Anchor` / `Link` tables + constraints (FKs, the
     `page_ratio` 12-dp string columns, the `LinkStatus` CHECK with no default, the NOT NULL
     `geometryCapturedAt`). NO resolver, NO status-transition logic, NO UI/product. A0.7-gated +
     migration/dependency hard stop.
   - **WI-A3-T5** — resolver + status transitions (mismatch/replacement → `needs_review`, missing → `broken`).
   - **later WI** — export degradation (in-app link → 卷X页Y or `ExportCitationFlag`, A10-T2 bijection).
7. **A0.7 dependency.** This design-only WI is **NOT** A0.7-gated. Every persistence-touching A3
   implementation WI above MUST declare `Requires-A07: yes` and pass the A0.7 hard gate with a provenance-valid
   local marker (custody mode 9b).
8. **Test strategy.** The schema WI's tests MUST prove: (a) a canonical `page_ratio` value stored then read
   back is **byte-identical** (the fixed 12-dp string round-trips with no re-rounding); (b) an anchor **cannot
   be created** without a valid `geometryCapturedAt` (NOT NULL + FK) — invalid/absent geometry provenance
   cannot produce a persisted anchor; (c) `LinkStatus` has **no implicit `valid`** (CHECK enforces the enum;
   no `DEFAULT 'valid'`); (d) once the resolver WI exists, replacement / geometry mismatch is **not silently
   valid** (resolves to `needs_review`); (e) the WI's commit contains **no marker/ledger/key/evidence-run**
   file.

### Decision-Medium (storage type for canonical page_ratio) — folds review Medium

Store each `page_ratio` component as the **fixed 12-dp decimal STRING** A3-T2 emits (a `TEXT` column), NOT a
numeric/`REAL`/decimal type. Rationale: the string form is byte-stable across storage drivers, runtimes, and
locales and carries A3-T2's round-half-to-even determinism intact; a binary-float (`REAL`) column would
reintroduce formatting/rounding drift and break byte-stability. A numeric/decimal column is acceptable **only
if** the chosen storage engine guarantees an exact decimal lexical round-trip — an engine-specific constraint
that is therefore **DEFERRED** to the future storage-engine/dependency WI, where it is decided against the
real engine. Default for now: the 12-dp string.

## 3. Schema contract (entities + columns; NOT a migration)

Logical shape (engine-neutral; the impl WI maps it to the chosen engine):

```
Anchor {
  id                 (PK)
  documentId         (FK -> DocumentPage.documentId, part of page identity)
  physicalPageIndex  (FK -> DocumentPage.physicalPageIndex, part of page identity)
  geometryCapturedAt (NOT NULL, FK -> DocumentPageGeometry version; immutable per stored anchor)
  rectX, rectY, rectWidth, rectHeight   (TEXT, canonical 12-dp page_ratio strings; decision-Medium)
  coordinateSpace    (const 'page_ratio')
  originRef          (const 'DocumentPageGeometry')
  pageRotation       (0|90|180|270, == the geometry version's rotation)
  label?             (optional)
  -- NO viewport/screen columns. NO REAL/float coordinate columns.
}
Link {
  id          (PK)
  sourceType  (CHECK IN evidence|note|question|calcTerm|claimElement)
  sourceId    (work-product object id)
  anchorId    (FK -> Anchor.id; the target page region)
  status      (CHECK IN valid|needs_review|broken; NOT NULL; NO DEFAULT)
}
```
Supporting (already specified in the handover / A3-CONTRACT-00 §5; not introduced here): `DocumentPage`,
`DocumentPageGeometry` (`capturedAt` = version), `Document.status`.

Constraints that make a wrong/stale anchor impossible to persist as valid:
- `geometryCapturedAt` NOT NULL + FK → no anchor without resolved geometry provenance.
- `Link.status` NOT NULL, no default, CHECK enum → no implicit `valid`.
- `page_ratio` stored only as the canonical string → no viewport leak, no float drift.
- No `ON DELETE` cascade → no invented delete semantics (decision 5).

## 4. A0.7 dependence (for the implementation WIs)

Per A07-GATE-00 + A07-KEY-00: an action is A0.7-dependent when `A07_REQUIRED` is set OR the governed queue
block carries `Requires-A07: yes`. Every persistence-touching A3 WI in §2.6 MUST carry `Requires-A07: yes`
and run under custody mode 9b (human-run gated `check-gates` with the HMAC key; the agent never receives the
key; the impl commit is blocked until the human reports gated PASS). The marker stays local-only/gitignored;
the key env-only. This design WI (A3-T1-DESIGN) is the only A3-T1 WI that is not gated.

## 5. Consequences + open items

- **Positive**: the persistence shape is fixed before code; byte-stability of A3-T2 ratios is preserved by the
  string-storage decision; `valid` is impossible without explicit derivation + present provenance; the
  migration is split into reviewable, A0.7-gated WIs; no cascade policy is invented.
- **Open (preserved, not decided here)**: the anchor-delete cascade rule (decision 5) — future
  A3-T6-equivalent stops-and-asks; a stronger immutable geometry-version key than `geometryCapturedAt`
  (decision 2) — reconsidered only if A0.7 shows class-2 geometry instability or the resolver WI needs it;
  the **storage engine** (SQLite/GRDB/SQLCipher) and any numeric-decimal storage option (decision-Medium) —
  a future dependency hard-stop WI.

## 6. Reconciliation note (added by A3-PAGE-00, 2026-06-23)

A pre-flight investigation for the schema implementation found two assumptions in this ADR that do not hold
against the chosen substrate (`services/case-box-persistence`, per A3-DB-00). Both are reconciled by
`ADR-evidence-a3-page-geometry-foundation.md` (A3-PAGE-00); this note records the correction so the contract no
longer contradicts reality:

1. **"FK →" is not a SQLite foreign key here.** `services/case-box-persistence` uses **no SQLite FK
   constraints by design** (app-layer invariants enforce correctness; `schema.ts:14`/`:134`). Every "FK →" in
   §3 (Anchor → DocumentPage, Anchor → DocumentPageGeometry, Link → Anchor) is therefore realized as a
   **NOT NULL column + an app-layer invariant**, not a SQLite `FOREIGN KEY`, unless a future substrate WI
   changes the no-FK convention. The intent (referential integrity, provenance required, no implicit `valid`)
   is unchanged; only the enforcement mechanism is corrected.
2. **`DocumentPage` and `DocumentPageGeometry` are PREREQUISITES that do not yet exist.** Neither table (nor
   any page-identity / geometry concept) exists in `case-box-persistence` or the `case-box-contract` package;
   `case_box_documents` is document-level only. They must be defined + implemented as their own A0.7-gated
   foundation WIs (A3-PAGE-00 → DocumentPage schema → DocumentPageGeometry schema) **before** the A3-T1-IMPL
   anchor/link schema. The §2.6 migration sequence is amended accordingly (foundations first).

This note does not change any §1-§5 decision; it corrects the enforcement mechanism (FK → app-layer invariant)
and records the prerequisite ordering.

## References
- `docs/adr/ADR-evidence-a3-anchor-link-contract.md` (A3-CONTRACT-00 — §3 invariants, §4 API, §5 data model,
  decision 9 cascade-unresolved, decision 3 geometry-version key).
- `native/evidence-core/lib/page-ratio.mjs` (A3-T2 — canonical page_ratio producer this schema persists).
- `docs/adr/ADR-evidence-a07-key-custody-operating-model.md` (A07-KEY-00),
  `docs/adr/ADR-evidence-a07-renderer-conformance-gate.md` (A07-GATE-00).
- `Evidence-Genie-M0-Developer-Handover.md` §10 (entities) + §11 (cascade undecided).
- `dev-memo/plan-batch-casebox-evidence-a3-schema-contract-00.md` (the implementation WI sequence).
- `.claude/rules/evidence-genie.md` (inv.5/6/7), `.claude/rules/client-local-first.md` (local-first;
  tenant_id forward-compat only).
