# ADR A3-RESOLVE-00 — Evidence-Genie M0 A3 resolver / status-transition behavior

**Status**: Accepted (resolver-behavior CONTRACT — design only; authorizes no resolver code, schema, or
migration).
**Date**: 2026-06-24.
**WI**: WI-A3-RESOLVE-00 (Type PLAN; design-only; NOT A0.7-gated).
**Composes under**: `ADR-evidence-a3-anchor-link-contract.md` (A3-CONTRACT-00 INV-A3-6/7/8, §4
resolveLink/classifyLinkStatus/markReplacementEffects), `ADR-evidence-a3-schema-persistence-contract.md`
(A3-SCHEMA-00 §3 LinkStatus no-default, decision 4 replacement, decision 5 cascade-unresolved),
`ADR-evidence-a3-page-geometry-foundation.md` (A3-PAGE-00 app-layer identity invariant). Reads the merged
V9-V11 schema + `case_box_documents`.

## 1. Context

The A3 schema foundation is complete and merged: V9 `case_box_document_pages` (page identity), V10
`case_box_document_page_geometries` (geometry version; `captured_at` is the version; single-current
`UNIQUE(document_id, physical_page_index)`), V11 `case_box_anchors` (`geometry_captured_at` NOT NULL; 12-dp
`page_ratio` rect) + `case_box_links` (`status` CHECK `valid|needs_review|broken`, NOT NULL, **no default**).
This ADR fixes the **resolver behavior** — how a link's `status` is computed from those rows + the document
lifecycle — so the future resolver implementation is deterministic and never lets a stale/wrong anchor read as
`valid`. It writes no resolver code, no schema, no migration, and resolves no cascade policy.

## 2. Resolver inputs (decision 1)

The resolver reads (no writes except `case_box_links.status`):
- `case_box_anchors` — the anchor: `document_id`, `physical_page_index`, `geometry_captured_at`, the rect.
- `case_box_links` — `anchor_id`, `source_type`, `source_id`, and the `status` it computes.
- `case_box_document_pages` (V9) — the page identity owner (`UNIQUE(document_id, physical_page_index)`).
- `case_box_document_page_geometries` (V10) — the current geometry version (`captured_at`) for a page.
- `case_box_documents` — `status` (the document lifecycle) + `supersedes_document_id` (the supersession chain).

All bindings are **app-layer invariants** (no SQLite FKs), per the case-box convention.

## 3. Status precedence ladder (decision 6 + folds review Medium)

When more than one condition applies, the status is determined by this **strict, ordered** ladder — evaluated
top-down; the first matching rung wins, so a combined failure state yields exactly ONE deterministic status:

1. **`broken`** (highest precedence) — any of:
   - the page identity is missing (no `case_box_document_pages` row for `(document_id, physical_page_index)`);
   - the geometry record is missing (no `case_box_document_page_geometries` row for that page);
   - the anchor target is missing (the link's `anchor_id` has no `case_box_anchors` row);
   - the anchor is otherwise un-resolvable (orphan / out-of-range / structurally invalid).
2. **`needs_review`** — else any of:
   - **geometry mismatch**: `anchor.geometry_captured_at != ` the current page geometry version's `captured_at`
     (the single-current V10 row) — INV-A3-6; no stale coordinate stays valid;
   - **document replacement/quarantine**: the owning `case_box_documents.status` has left `canonical`
     (`replaced_pending_review` / `superseded` / any withdrawn/quarantined/unavailable lifecycle value) or the
     document is on a `supersedes_document_id` chain that affects the page;
   - **source uncertainty**: the link's source identity (`source_type`, `source_id`) does not currently
     resolve unambiguously.
3. **`valid`** — else (all present, geometry matches, document `canonical`, source resolves). `valid` is the
   **lowest rung** — reached only when every check passes; it is **NEVER a default** (consistent with the V11
   `LinkStatus` NOT NULL, no `DEFAULT`).

So: missing/structural → `broken`; otherwise stale/replaced/uncertain → `needs_review`; otherwise `valid`.
"geometry mismatch + missing target" → `broken` (rung 1 wins, unambiguously).

## 4. The per-condition decisions (2-5)

- **Valid condition (decision 2)**: an anchor is `valid` only if its page identity exists AND
  `anchor.geometry_captured_at` equals the current V10 `captured_at` for that page; a link is `valid` only if
  its anchor resolves `valid` AND its source `(source_type, source_id)` resolves. (Rung 3.)
- **Geometry mismatch (decision 3)**: version mismatch → `needs_review`; no stale coordinate silently `valid`
  (INV-A3-6). (Rung 2.)
- **Document replacement/quarantine (decision 4)**: a document leaving `canonical` / a supersession chain /
  any withdrawn/quarantined state → affected links `needs_review`; never silently `valid`. The resolver
  recomputes affected links when the document lifecycle changes (markReplacementEffects, A3-CONTRACT-00 §4).
  (Rung 2.)
- **Missing target (decision 5)**: missing page identity / geometry record / anchor target → explicit `broken`
  (INV-A3-8). (Rung 1.)

## 5. Status writes, determinism + idempotence (decision 6)

The resolver may set `valid | needs_review | broken`. It **never defaults to `valid`**. Resolution is
**deterministic** (the same inputs always yield the same status via the §3 ladder) and **idempotent**
(re-running on unchanged inputs produces no status change and no spurious writes/audit churn — the resolver
writes a row only when the computed status differs from the stored one).

## 6. Transaction boundary (decision 8)

The resolver updates affected links **atomically per document/matter scope** (one `BEGIN/COMMIT` per the unit
of work, mirroring the existing case-box Mode-B atomicity for multi-row transitions), unless the
implementation WI's review-plan recommends a narrower per-link or per-page boundary. No partial-update state is
observable.

## 7. Deferred + non-inferable (decisions 7 + 9 + folds review Low)

- **Audit events (decision 7) — DEFERRED, non-inferable.** Whether resolver status changes emit
  `case_box_audit_events` / `ActivityEvent` is **decided in the first resolver implementation WI**, not here. If
  the audit-event shape is unclear at that point, it is deferred to its own WI. This ADR **invents no audit
  shape**, and the resolver implementation **MUST NOT infer one** — it either uses an explicitly-authorized
  audit shape or emits none.
- **Anchor-delete cascade (decision 9) — UNRESOLVED, non-inferable.** Deletion/cascade behavior for anchors
  (and links on a deleted anchor) is **intentionally out of scope** (A3-SCHEMA-00 decision 5 / A3-CONTRACT-00
  decision 9 — still unresolved). The resolver implementation **MUST NOT infer or invent** delete/cascade
  semantics; deleting anchors remains a future **stop-and-ask** WI.

## 8. A0.7 dependence + implementation sequence (decision 10)

This design WI is NOT A0.7-gated. The future **resolver/status implementation WI** (and any follow-on export
WI) MUST declare `Requires-A07: yes` and run under A07-KEY-00 custody mode 9b — resolver behavior reads the
geometry version and must not build on unproven A0.7 geometry. Sequence + test strategy:
`dev-memo/plan-batch-casebox-evidence-a3-resolver-status-00.md`.

## 9. Consequences + open items

- **Positive**: the status ladder is explicit + deterministic (no combined-state ambiguity); `valid` is never
  a default; stale geometry, replacement, and missing targets all map to a single correct non-`valid` status;
  audit + cascade are explicitly out of scope and non-inferable.
- **Open (preserved, not decided here)**: the audit-event shape (decided/deferred in the impl WI); the
  anchor-delete cascade (future stop-and-ask); export degradation (a later WI: 卷X页Y / `ExportCitationFlag`,
  A10-T2); the exact `case_box_documents.status` lifecycle value set the resolver keys on (confirmed against the
  case-box document contract in the impl WI — this ADR keys on "left `canonical`", not on inventing values).

## References
- `docs/adr/ADR-evidence-a3-anchor-link-contract.md` (A3-CONTRACT-00 INV-A3-6/7/8, §4),
  `docs/adr/ADR-evidence-a3-schema-persistence-contract.md` (A3-SCHEMA-00 §3, decisions 4/5),
  `docs/adr/ADR-evidence-a3-page-geometry-foundation.md` (A3-PAGE-00 identity invariant).
- `services/case-box-persistence/src/sqlite/schema.ts` (V9-V11 + case_box_documents.status/
  supersedes_document_id — read-only reference). `Evidence-Genie-M0-Developer-Handover.md` §5/§10 + the A3-T5
  follow-link resolver ticket.
- `docs/adr/ADR-evidence-a07-key-custody-operating-model.md` (A07-KEY-00 — the future resolver impl is 9b).
- `dev-memo/plan-batch-casebox-evidence-a3-resolver-status-00.md` (the resolver impl WI sequence).
