# ADR A3-UNLINK-SCHEMA-00 — Evidence-Genie M0 durable-unlink schema mechanism

**Status**: Accepted (durable-unlink schema-mechanism CONTRACT — design only; authorizes no schema, DDL, or
migration).
**Date**: 2026-06-25.
**WI**: WI-A3-UNLINK-SCHEMA-00 (Type PLAN; design-only; NOT A0.7-gated).
**Resolves**: the load-bearing finding in `ADR-evidence-a3-unlink-break-link-workflow.md` (A3-UNLINK-00 §2/§6/§8)
— a durable, link-preserving explicit unlink is not implementable on V11 because `case_box_links.anchor_id` is
NOT NULL, `LinkStatus` has no `unlinked`, and the resolver recomputes a status-only `broken` back to `valid`.
**Composes under**: the merged V11 schema, resolver (`resolveLinkStatuses`), export builder
(`buildExportCitations`), and `ADR-evidence-a3-schema-persistence-contract.md` (A3-SCHEMA-00 — no-FK + additive
`DDL_STATEMENTS_VN` migration conventions).

## 1. Context

A3-UNLINK-00 requires a *durable* representation for an explicit unlink that the resolver and export both
respect, distinct from the resolver's structural `broken`. This ADR **chooses the schema mechanism** (and its
resolver/export implications) so a future A0.7-gated V12 migration WI can build it. It writes no schema, no DDL,
no migration, and changes no resolver/export/guard behavior. `CURRENT_SCHEMA_VERSION` stays 11 in this lane.

## 2. Chosen mechanism (decision 1) — option 1: durable marker columns on `case_box_links`

The future V12 migration adds **durable unlink-marker columns to `case_box_links`**, preserving the existing
`anchor_id` and the link row:
- **`unlinked_at TEXT` (nullable, `COLLATE BINARY`)** — the marker. A link is explicitly unlinked **iff
  `unlinked_at IS NOT NULL`**. (No second status ladder — review L2.)
- **`unlink_reason TEXT` (nullable)** — required *iff* `unlinked_at IS NOT NULL` (app-layer invariant, §9). It is
  durable audit metadata on the row (§7).

This preserves `anchor_id`, the link-row history, A3 identity, and the A10 export no-drop guarantee, while
avoiding the LinkStatus enum churn of option 2 and the identity loss of option 3. It is a tight, additive marker
— **not** an extensible lifecycle enum (review L2).

## 3. Rejected alternatives (decision 1, cont.)

- **Option 2 — add `unlinked` to `LinkStatus`**: REJECTED for M0. Extending the
  `valid|needs_review|broken` enum forces a status-ladder, resolver, and export rework, and conflates lifecycle
  state with structural validity. (Reconsider only if the status model is intentionally expanded later.)
- **Option 3 — nullable `anchor_id`**: REJECTED. Nulling `anchor_id` loses the anchor reference and weakens A3
  link↔anchor identity; recovering it would need separate historical-anchor fields. The recommendation is to
  keep `anchor_id NOT NULL` (§4).
- **Option 4 — separate link-lifecycle/status table**: REJECTED for M0 as heavier than needed; the two marker
  columns suffice. (A future richer lifecycle could revisit this.)

## 4. `anchor_id` + `LinkStatus` unchanged (decisions 2, 3)

- **`anchor_id` remains `NOT NULL`** (decision 2) — the link keeps pointing at its anchor even when unlinked
  (the unlink is a marker, not a detachment of the FK-less reference).
- **`LinkStatus` remains `valid | needs_review | broken`** (decision 3) — unchanged. The explicit unlink is
  **lifecycle/audit state**, not a structural-validity value; it is carried by the marker, not the status enum.

## 5. Resolver treatment (decision 4 + review L1)

When the durable marker is present (`unlinked_at IS NOT NULL`), the resolver MUST **respect the marker and NOT
recompute the structural ladder back to `valid`**. A marked link resolves to a **non-clean** result; the marker
is the durable reason it stays non-clean even when anchor/page/geometry are structurally intact. The resolver
MUST treat the marker as taking precedence over a structural recompute (an explicitly-unlinked link is never
recomputed to `valid`).

## 6. Export flagging (decision 5 + review L1)

Export MUST read the **marker**, not only `status` (review L1) — because `buildExportCitations` runs the resolver
first and the resolver-first shape could otherwise clean-export a marked link. An explicitly-unlinked link MUST
export as a **deterministic non-clean** `exportFlag` (best-effort link/source identity; A10 no-drop; never a
clean citation, never silently omitted), and that flag MUST be **distinguishable from structural `broken`**
(two links can both be non-clean — one structurally broken, one explicitly unlinked — and export must tell them
apart). The marker is a **hard override on clean export**. The exact `exportFlag` value (reuse vs a dedicated
unlinked flag) is finalized in the implementation WI (§12).

## 7. Audit metadata (decision 6)

`unlink_reason` is **durable audit metadata on the row** — the **why/reason** is recorded at unlink time. The
**actor/who** and any audit-event shape are **deferred to the audited unlink-operation WI**: the chosen tight
row shape adds only `unlinked_at` + `unlink_reason` (no actor/user column), and whether the unlink operation
ALSO emits a separate audit *event* (an `ActivityEvent` / `case_box_audit_events` row, with the actor) is
**decided in the implementation WI** (A3-UNLINK-00 §7 — a destructive op must not ship unaudited). This ADR adds
no actor column and invents no audit-event shape.

## 8. Migration version target (decision 7)

The future schema implementation targets **schema version V12** (the next additive version after V11). This lane
bumps **nothing** — `CURRENT_SCHEMA_VERSION` stays 11; V12 is the recorded target for the future WI.

## 9. App-layer invariants (decision 8 + review L3)

The V12 mechanism introduces these **app-layer invariants** (no SQLite FK; enforced by the repository layer):
- `unlink_reason` is **required iff** `unlinked_at IS NOT NULL` (and null when not unlinked).
- An unlinked link is **terminal-until-relink** (review L3): it stays non-clean until an explicit relink.
- **Relink clears the marker atomically** (`unlinked_at` + `unlink_reason` back to NULL) and re-runs/recomputes
  the status; relink is its own explicit operation.
- **Mutual exclusion with a clean citation**: a link with the marker set MUST NOT export clean.
- The explicit unlink is **NEVER represented by overloading structural `broken`** — it is the marker, always.

## 10. Backward compatibility (decision 9)

The V11 → V12 migration is **forward-only and ADDITIVE** (matching the `DDL_STATEMENTS_VN` / `DDL_BY_VERSION`
pattern + the forward-only `applySchema`): it adds the two nullable columns; **existing V11 rows default to
`unlinked_at IS NULL`** (not unlinked); **no existing data is rewritten**. The columns follow the case-box style
(`TEXT`, `COLLATE BINARY` for the timestamp). No FK, no `ON DELETE CASCADE`.

## 11. A0.7 dependence (decision 10)

This design WI is NOT A0.7-gated. The future **schema IMPLEMENTATION WI (the V12 migration, plus the
resolver/export marker-awareness)** is HIGH-RISK (persistence/migration + resolver/export change over
court-facing evidence) and MUST declare `Requires-A07: yes` under A07-KEY-00 custody mode 9b. Sequence + deferred
items: `dev-memo/plan-batch-casebox-evidence-a3-unlink-schema-00.md`.

## 12. Consequences + open items

- **Positive**: the durable-unlink finding is resolved with a tight additive marker that preserves `anchor_id`,
  link history, A3 identity, and A10 no-drop; the resolver respects the marker (no silent recompute to `valid`);
  export reads the marker (a hard override; distinguishable from structural `broken`); `LinkStatus` + the no-FK
  convention are unchanged; the migration is additive + backward-compatible.
- **Open (preserved, not decided here)**: the exact V12 DDL (authored in the impl WI); the exact non-clean
  `exportFlag` an unlinked link maps to (§6); the unlink audit-event shape (§7); the unlink/relink OPERATION WI
  (A3-UNLINK-T1, gated on this V12); the physical-link-delete alternative (A3-UNLINK-00 §2/§4 — only if a future
  reviewed policy chooses it); the encryption-at-rest hard stop (A3-DB-00 §5) before any production evidence.

## References
- `docs/adr/ADR-evidence-a3-unlink-break-link-workflow.md` (A3-UNLINK-00 — the finding this lane resolves),
  `docs/adr/ADR-evidence-a3-anchor-delete-policy.md` (A3-CASCADE-00),
  `docs/adr/ADR-evidence-a3-resolver-status-transitions.md` (A3-RESOLVE-00),
  `docs/adr/ADR-evidence-a3-export-degradation.md` (A3-EXPORT-00 — A10 no-drop),
  `docs/adr/ADR-evidence-a3-schema-persistence-contract.md` (A3-SCHEMA-00 — additive-migration conventions).
- `services/case-box-persistence/src/sqlite/schema.ts` (V11 `case_box_links`: `anchor_id NOT NULL`, status enum;
  `DDL_STATEMENTS_VN` / `DDL_BY_VERSION` / `applySchema`), `src/sqlite/linkStatusResolverQueries.ts`,
  `src/sqlite/exportCitationQueries.ts` — all READ-ONLY.
- `docs/adr/ADR-evidence-a07-key-custody-operating-model.md` (A07-KEY-00 — the future V12 impl is 9b).
- `dev-memo/plan-batch-casebox-evidence-a3-unlink-schema-00.md` (the V12 migration impl WI sequence).
