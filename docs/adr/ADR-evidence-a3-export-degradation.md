# ADR A3-EXPORT-00 — Evidence-Genie M0 A3 export-degradation behavior

**Status**: Accepted (export-degradation CONTRACT — design only; authorizes no export code, schema, or
migration).
**Date**: 2026-06-25.
**WI**: WI-A3-EXPORT-00 (Type PLAN; design-only; NOT A0.7-gated).
**Composes under**: `ADR-evidence-a3-resolver-status-transitions.md` (A3-RESOLVE-00 — the resolver ladder;
`case_box_links.status` is the trusted status), `ADR-evidence-a3-anchor-link-contract.md` (A3-CONTRACT-00
INV-A3-6/7/8), `ADR-evidence-a3-page-geometry-foundation.md` (A3-PAGE-00 — DocumentPage identity = citation
identity; geometry is never viewport). Reads the merged V9-V11 schema + the merged `resolveLinkStatuses`
resolver. Court-facing export-reproducibility framing: `Evidence-Genie-M0-Developer-Handover.md` §A10 (the
`CanonicalExportModel`; the `ExportCitationFlag` set) + §A1 (citation rendered solely from `DocumentPage`,
卷X页Y).

## 1. Context

The A3 schema foundation (V9-V11) and the A3 link-status resolver (`resolveLinkStatuses`, A3-RESOLVE-00) are
merged: `case_box_links.status` is computed deterministically as `valid | needs_review | broken`, and `valid`
is never a default. This ADR fixes the **export-degradation behavior** — how a court-fileable export presents a
citation/hyperlink when the link's resolved status is `needs_review` or `broken` — so that **no unresolved or
stale anchor can appear as a silently-valid citation**. It writes no export code, no schema, no migration, no
UI; it resolves no anchor-delete cascade and no Evidence document-lifecycle schema.

The export surface must preserve the A1/A10 court-fileability invariants: every citation is rendered **solely
from `DocumentPage`** (卷X页Y) — never from viewport/screen/rendered coordinates and never from an
`OptimizedDocumentRendition`; in-app hyperlinks degrade to **textual 卷X页Y or an explicit
`ExportCitationFlag`** (never dropped, never silently wrong).

## 2. Export inputs (decision 1)

The export-citation builder reads (no writes here — this is a read/derive contract):
- `case_box_links.status` — the resolver's persisted `valid | needs_review | broken`; the **trusted status**.
- `case_box_anchors` — the anchor's `document_id`, `physical_page_index`, `geometry_captured_at`, rect.
- `case_box_document_pages` (V9) — the page identity (`UNIQUE(document_id, physical_page_index)`).
- `case_box_document_page_geometries` (V10) — the current geometry version (`captured_at`) for a page.
- the **document/page citation-identity** available today — `DocumentPage` (`documentId + physicalPageIndex`)
  mapping to the citation volume / page label kept in `payload_json` (A1). Citation identity comes only from
  here.

## 3. Status vs export classification (decision 9 shape + folds review L1/L2)

The export model separates two distinct fields — they MUST NOT be collapsed:
- **`linkStatus`** = the resolver output `valid | needs_review | broken` (A3-RESOLVE-00). This is the *trust*
  gate.
- **`exportFlag`** = the *export* classification, a superset of the trust gate:
  `NEEDS_REVIEW | BROKEN | NON_CITABLE | AMBIGUOUS | REPLACED | (none, for a clean citation)`
  (handover §A10: 引用待核_NEEDS_REVIEW | 引用缺失_BROKEN | 不可引用_NON_CITABLE | 引用歧义_AMBIGUOUS |
  文档已替换_REPLACED).

A3 `linkStatus == valid` is **necessary but NOT sufficient** (review L1) for a clean citation: even a `valid`
link must still pass the A1/A10 citation-contract checks — `isCitable`, citation-label ambiguity
(`AMBIGUOUS`), and non-citable / cross-volume cases (`NON_CITABLE`). A `valid` link is **never** `REPLACED`: a
replaced/superseded document is already `needs_review` at the resolver (A3-RESOLVE-00; resolver-first ordering,
§6), so `REPLACED` can never co-occur with `valid`.

**`exportFlag` precedence (highest first; exactly ONE flag per link, deterministically):**
1. `linkStatus == broken` → `BROKEN`.
2. `linkStatus == needs_review` → `NEEDS_REVIEW` by default. It MAY be refined to `REPLACED` (文档已替换) ONLY
   when the `needs_review` is attributable to document replacement/supersession AND the implementation WI is
   authorized to read that reason — either via a resolver-emitted **status reason** or by the export builder
   re-reading the SAME `supersedes_document_id` signal the resolver used (never a separate validity
   computation, §5). Absent that reason in M0 the deterministic default is `NEEDS_REVIEW`; `REPLACED` is a
   recorded refinement decision for the impl WI, never a silent guess. (The full Evidence document lifecycle
   that would give `REPLACED` richer meaning — `canonical → replaced_pending_review → superseded` — remains
   deferred, §10.)
3. `linkStatus == valid` → a clean citation, UNLESS an A1/A10 citation-contract check yields `AMBIGUOUS` or
   `NON_CITABLE`. A `valid` link never yields `NEEDS_REVIEW` / `BROKEN` / `REPLACED`.

So `exportFlag` is derived from `linkStatus` AND those citation-contract checks; it is never just a rename of
`linkStatus`.

## 4. Per-status export behavior (decisions 2-5)

- **`valid` (decision 2)** — eligible for a normal 卷X页Y citation, rendered **solely from `DocumentPage`
  identity** (never viewport/rendered/optimized coordinates). It still passes the §3 A1/A10 checks: if it is
  ambiguous / non-citable / cross-volume, it takes the corresponding `exportFlag` (`AMBIGUOUS` / `NON_CITABLE`)
  instead of a clean citation. A `valid` link is never `REPLACED` (§3 precedence). Only a `valid` link that also
  clears those checks emits a clean citation (`exportFlag = null`).
- **`needs_review` (decision 3)** — MUST NOT silently present stale geometry as trusted. It emits a **visible
  `exportFlag = NEEDS_REVIEW`** (引用待核) by default — or `REPLACED` (文档已替换) when the §3 precedence rule
  attributes the `needs_review` to document replacement/supersession; the citation **preserves the stable
  `DocumentPage` identity when available** (so the reviewer can locate it) but is unambiguously **marked
  review-required** — never a clean citation.
- **`broken` (decision 4)** — MUST NOT produce a normal citation. It emits a **visible `exportFlag = BROKEN`**
  (引用缺失); it **preserves best-effort source/link identity** (source_type/source_id, link id) when available
  but **MUST NOT claim page/rect validity** (no 卷X页Y, no rect).
- **Missing page / geometry / anchor (decision 5)** — a `broken` arising from a missing page identity / geometry
  record / anchor target maps to a **deterministic flagged fallback** (`exportFlag = BROKEN`, best-effort source
  identity, no page/rect claim). **Never dropped (A10).** Every in-app link whose target is missing MUST still
  produce a deterministic `BROKEN` export object — preserving link/source identity, with an empty citation — and
  is **never omitted**. A10 forbids dropping the link→citation mapping; there is **no omission escape hatch**.

## 5. Geometry + resolver-status as source of truth (decision 6)

- Exports MUST NOT use an `OptimizedDocumentRendition` as the canonical citation/anchor basis (handover §A1; the
  uploaded original is authoritative).
- Exports MUST NOT **independently recompute** link validity from raw geometry. The resolved
  `case_box_links.status` is the **single source of truth** for trust; the export builder consumes it. The only
  sanctioned way for an export to act on fresher truth is to **re-run the same resolver first** (§6 ordering) —
  never to fork a parallel validity computation that could diverge from the resolver.

## 6. Ordering — run the resolver first (decision 7)

Preferred (recorded): the future export implementation WI **runs a resolver/status refresh
(`resolveLinkStatuses`) immediately before export, in the same matter/document scope**, so the export never
treats a stale stored status as current export truth. If a later review prefers to require the caller to have
run the resolver beforehand, that is an allowed narrowing — but the default is export-runs-resolver-first. Either
way, the export MUST NOT compute its own status.

## 7. Auditability (decision 8) — DEFERRED, non-inferable

Whether export-degradation events emit audit records (e.g. "exported N citations: X needs_review, Y broken") is
**decided in the export implementation WI**, not here. If the audit-event shape is unclear at that point, it is
deferred to its own WI. This ADR **invents no export audit shape**, and the implementation **MUST NOT infer
one** — it either uses an explicitly-authorized shape or emits none (consistent with A3-RESOLVE-00 §7).

## 8. Output contract (decision 9) — minimal headless export-citation object

The export builder produces, per link, a minimal **headless** object (no UI copy beyond the export-text
semantics needed for the contract):
- `linkId`, `sourceType`, `sourceId` — link/source identity.
- `linkStatus` — `valid | needs_review | broken` (the resolver output; the trust gate).
- `exportFlag` — `NEEDS_REVIEW | BROKEN | NON_CITABLE | AMBIGUOUS | REPLACED | null` (null = clean citation).
- `citation` — present (the `DocumentPage`-derived 卷X页Y identity: documentId, physicalPageIndex, volume/page
  label) only when it can be asserted; **omitted/empty for `broken`** (no page/rect claim); **present but
  flagged for `needs_review`** when identity is available.
This is a contract shape, not an implementation: field names/serialization are finalized (deterministically,
per A10) in the implementation WI.

## 9. A0.7 dependence (decision 10)

This design WI is NOT A0.7-gated. The future **export implementation WI** MUST declare `Requires-A07: yes` and
run under A07-KEY-00 custody mode 9b — export behavior reads geometry-derived status and must not build on
unproven A0.7 geometry. Sequence + test strategy:
`dev-memo/plan-batch-casebox-evidence-a3-export-degradation-00.md`.

## 10. Consequences + open items

- **Positive**: citation trust is preserved end-to-end — a `needs_review`/`broken` link can never export as a
  silently-valid citation; `valid` is necessary-but-not-sufficient (A1/A10 checks still apply); `linkStatus` and
  `exportFlag` are distinct; the resolver is the single source of truth; missing records degrade to a
  deterministic flag, never silent omission; audit + cascade + document lifecycle are explicitly out of scope
  and non-inferable.
- **Open (preserved, not decided here)**: the export audit-event shape (decided/deferred in the impl WI); the
  exact `ExportCitationFlag` serialization + the `isCitable`/ambiguous/cross-volume citation-contract checks
  (A1/A10, finalized in the impl WI); whether `needs_review`-from-supersession is surfaced as the refined
  `REPLACED` flag (§3 precedence rung 2 — needs a resolver status-reason or the export re-reading the
  supersession signal; the M0 default is `NEEDS_REVIEW`); the **anchor-delete cascade** (future stop-and-ask
  WI); the **full Evidence document lifecycle** (`canonical → replaced_pending_review → superseded`) which a
  future schema WI adds — until then a superseded link is `needs_review` with `exportFlag = NEEDS_REVIEW` by
  default, and a distinct lifecycle-driven `REPLACED` awaits that schema WI.

## References
- `docs/adr/ADR-evidence-a3-resolver-status-transitions.md` (A3-RESOLVE-00 — the resolver; case_box_links.status
  as trusted status), `services/case-box-persistence/src/sqlite/linkStatusResolverQueries.ts` (resolveLinkStatuses,
  READ-ONLY reference).
- `docs/adr/ADR-evidence-a3-anchor-link-contract.md` (A3-CONTRACT-00 INV-A3-6/7/8),
  `docs/adr/ADR-evidence-a3-page-geometry-foundation.md` (A3-PAGE-00 DocumentPage identity).
- `Evidence-Genie-M0-Developer-Handover.md` §A10 (CanonicalExportModel; ExportCitationFlag) + §A1
  (citation-from-DocumentPage, 卷X页Y).
- `docs/adr/ADR-evidence-a07-key-custody-operating-model.md` (A07-KEY-00 — the future export impl is 9b).
- `dev-memo/plan-batch-casebox-evidence-a3-export-degradation-00.md` (the export impl WI sequence).
