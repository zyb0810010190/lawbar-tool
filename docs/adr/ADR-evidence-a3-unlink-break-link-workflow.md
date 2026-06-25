# ADR A3-UNLINK-00 — Evidence-Genie M0 A3 unlink / break-link workflow

**Status**: Accepted (unlink/break-link workflow CONTRACT — design only; authorizes no unlink code, schema, or
migration).
**Date**: 2026-06-25.
**WI**: WI-A3-UNLINK-00 (Type PLAN; design-only; NOT A0.7-gated).
**Composes under**: `ADR-evidence-a3-anchor-delete-policy.md` (A3-CASCADE-00 §4 — unlink/break-link is a
separate, explicit, audited workflow, never an implicit cascade). Reads the merged V11 schema, the resolver
(`resolveLinkStatuses`), the export builder (`buildExportCitations`), and the refusal guard
(`assertCanDeleteAnchor`).

## 1. Context

A3-CASCADE-00 refuses physical deletion of a *referenced* anchor and defers anchor removal until the link is
explicitly detached. This ADR fixes that detachment — the **unlink / break-link workflow** — BEFORE any unlink
behavior is implemented, so a link can be intentionally detached from an anchor without deleting the anchor and
without any silent cascade. It writes no unlink code, no schema, no migration, and changes no
resolver/export/guard behavior.

## 2. The workflow + the load-bearing M0 finding (decision 1)

**Unlink is a separate, explicit operation** — invoked deliberately by the user, never triggered implicitly by
anchor delete (A3-CASCADE-00 §4). It detaches a link from its anchor; the anchor and (by default) the link rows
are preserved (§3, §4).

**KEY M0 FINDING — a durable, link-preserving explicit unlink is NOT implementable without a schema decision.**
Verified against the merged V11 schema + resolver + export:
- `case_box_links.anchor_id` is **`TEXT NOT NULL`** — an unlink cannot null `anchor_id` to "detach".
- `case_box_links.status` CHECK is **`valid | needs_review | broken`** — there is **no `unlinked` value**.
- `resolveLinkStatuses` computes status **purely from structural state** (anchor + page + geometry +
  supersession; `ELSE 'valid'`) and writes when the computed status differs from the stored one; and
  `buildExportCitations` runs the resolver **first**. So a status-only unlink that merely sets `status='broken'`
  on a link whose anchor is still structurally valid would be **revalidated back to `valid`** on the next
  resolve/export — the unlink would silently un-happen.

Therefore a **durable** link-preserving unlink requires one of (a schema decision — a future schema WI; §8):
1. a durable **unlink reason/flag** column the resolver respects (preferred), OR
2. a new **`unlinked`** LinkStatus value + resolver awareness, OR
3. a **nullable `anchor_id`** (+ a reason).

The **non-schema alternative** — physically deleting the link row — IS durable (no row for the resolver to
revalidate) and preserves the anchor, but it does **not** preserve the link row, conflicting with the
link-preservation default (§4). This ADR **recommends the durable, link-preserving form (a schema-WI
predecessor)** and **records** the physical-link-delete alternative; it does **not** pick a schema design.

## 3. Anchor preservation (decision 2)

The anchor row **MUST remain** on unlink. Physically removing an anchor is the separate, deferred
unreferenced-anchor-delete decision (A3-CASCADE-00 §3 — product-gated). Unlink detaches the *link*, it never
deletes the *anchor*.

## 4. Link preservation (decision 3 + review L2)

For the recommended durable (link-preserving) path, the link row **MUST remain** for audit/history — UNLESS a
future reviewed policy explicitly chooses the physical-link-delete alternative (§2). Preserving the link row is
exactly what forces decision 1's durable-state requirement: a preserved link whose anchor is still structurally
valid is the case the resolver revalidates, so the unlink must carry a durable reason/status the resolver
respects.

## 5. Export effect (decision 4)

An unlinked link **MUST export as a DEGRADED (non-clean) state**, preserving best-effort link/source identity
(A3-EXPORT-00 A10 no-drop) — never a clean citation, never silently omitted. (Which `exportFlag` an unlinked
link maps to is finalized with the durable-unlink mechanism in the implementation WI; it MUST be a non-clean
flag.)

## 6. Resolver interaction (decision 5 + review L1)

**Today's resolver WOULD overwrite an explicit unlink** that is represented only as `status='broken'`, because
it recomputes status from structural inputs. So the unlink implementation needs a **durable reason/source the
resolver respects BEFORE any code** — this is the load-bearing reason decision 1 gates on a schema/mechanism
decision.

**Do not conflate explicit-unlink with the resolver's `broken` (review L1).** Today's `broken` is
resolver-computed from structural inconsistency (a corruption / missing-target SAFETY NET), NOT a stable
explicit-unlink marker. The future explicit unlink is a **distinct concept** with its **own** durable
reason/status/source that the resolver respects and that export maps to a non-clean state. The unlink
implementation MUST make the resolver respect the durable unlink marker (e.g. short-circuit a flagged link
rather than recomputing it).

## 7. Auditability (decision 6) — a PREDECESSOR for the destructive op

An explicit unlink **changes the evidentiary binding** even when rows are preserved, so the future unlink
implementation WI **MUST make audit semantics a predecessor or an explicit acceptance item** — an unlink MUST
NOT ship as an unaudited operation (A3-CASCADE-00 §7). This ADR invents no audit shape; if the shape is unclear
at implementation time it is deferred to its own WI, but the destructive unlink does not ship until audit is
resolved.

## 8. Schema (decision 7) — none here; durable-unlink is a future schema WI

This lane adds **no schema, no migration, no FK, no soft-delete/tombstone**. The durable-unlink mechanism
required by §2/§6 (an unlink reason/flag column, an `unlinked` status, or a nullable `anchor_id`) is a **future
schema WI** (its own migration + ADR), not decided here.

## 9. A0.7 dependence (decision 8)

This design WI is NOT A0.7-gated. **Any future unlink implementation** MUST declare `Requires-A07: yes` and run
under A07-KEY-00 custody mode 9b. Sequence + deferred items:
`dev-memo/plan-batch-casebox-evidence-a3-unlink-workflow-00.md`.

## 10. Consequences + open items

- **Positive**: unlink is explicit + separate (never an implicit cascade); citation trust is preserved (anchor
  + link preserved; degraded non-clean export); the durable-unlink mechanism is correctly surfaced as a schema
  decision rather than silently faked with a non-durable `broken`; the destructive op is bounded (audited,
  A0.7-gated).
- **Open (preserved, not decided here)**: the durable-unlink schema mechanism (a future schema WI, §8); the
  export flag an unlinked link maps to (finalized with that mechanism, §5); the audit-event shape
  (decided/deferred in the impl WI, §7); the physical-link-delete alternative (only if a future reviewed policy
  chooses it over link preservation, §2/§4); the unreferenced-anchor delete + soft-delete/tombstone (separate
  deferred WIs, A3-CASCADE-00 §3/§8).

## References
- `docs/adr/ADR-evidence-a3-anchor-delete-policy.md` (A3-CASCADE-00 §4),
  `docs/adr/ADR-evidence-a3-resolver-status-transitions.md` (A3-RESOLVE-00 — the resolver ladder),
  `docs/adr/ADR-evidence-a3-export-degradation.md` (A3-EXPORT-00 — A10 no-drop / degraded export).
- `services/case-box-persistence/src/sqlite/schema.ts` (V11 `case_box_links`: `anchor_id NOT NULL`, status
  `valid|needs_review|broken`), `src/sqlite/linkStatusResolverQueries.ts` (resolver revalidation),
  `src/sqlite/exportCitationQueries.ts` (runs the resolver first), `src/sqlite/anchorDeleteGuardQueries.ts`
  (the refusal guard) — all READ-ONLY.
- `docs/adr/ADR-evidence-a07-key-custody-operating-model.md` (A07-KEY-00 — the future unlink impl is 9b).
- `dev-memo/plan-batch-casebox-evidence-a3-unlink-workflow-00.md` (the unlink impl WI sequence).
