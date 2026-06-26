# BATCH-CASEBOX-EVIDENCE-A3-UNLINK-AUDIT-KINDS-00 (record — contract addition)

**Status**: record of an implemented contract addition (the governed `dev-memo/run/queue.md` WI-A3-UNLINK-AUDIT-KINDS
is the authority). Records the `link` audit entity_type + the LINK_UNLINKED/LINK_RELINKED kinds added to the
case-box-contract audit vocabulary, the predecessor for the durable unlink/relink operation (WI-A3-UNLINK-T1).
**Date**: 2026-06-26. **Type**: SOURCE (contract / audit-event-kind; NOT A0.7-gated; HIGH-RISK contract).
**ADR**: `docs/adr/audit-event-kind-preservation.md` (the governing audit-event-kind ADR). Read it first.

## 0. Why this lane exists (sequencing)

The durable unlink/relink OPERATION (WI-A3-UNLINK-T1) must emit a tamper-evident audit event (A3-CASCADE-00 §7 /
A3-UNLINK-00 §7: a deliberate unlink must not ship unaudited). The case-box audit chain validates a v2 event's
`event_kind` against a fixed `{action, entity_type, reasonRequired}` registry, and the `entity_type` vocabulary had
no `link` value and there were no LINK kinds. Per the user's direction (2026-06-26), the audit-kind CONTRACT support
is added FIRST, in its own governed lane, so T1 can emit the kinds against an already-supported contract.

## 1. What was added (additive, append-only)

- `entity_type` enum (`schemas/case-box-audit-event.schema.json`) + `CASE_BOX_AUDIT_ENTITY_TYPES`
  (`src/audit-log.ts`): added **`link`** (the A3 evidence anchor/link).
- `event_kind` enum (schema) + `CASE_BOX_AUDIT_EVENT_KINDS` (`src/audit-log.ts`): added
  - **`LINK_UNLINKED`** — `{ action: "update", entity_type: "link", reasonRequired: true }` (an explicit unlink
    requires a reason — mirrors the V12 app-layer `unlink_reason`-required-iff-`unlinked_at` invariant).
  - **`LINK_RELINKED`** — `{ action: "update", entity_type: "link", reasonRequired: false }` (relink restores the
    link to active; the V12 `unlink_reason` is cleared, so no reason is mandated — it is not forbidden).
- `src/generated/case-box-audit-event.ts`: REGENERATED via `gen:types` (AUTO-GENERATED; not hand-edited).
- `tests/audit-event-kind-v2.test.mjs`: added positive/negative cases (registry tuples; LINK_UNLINKED with a reason
  verifies; LINK_UNLINKED without a reason → `event_kind_inconsistent`; LINK_RELINKED without a reason verifies; a
  mismatched action/entity_type → `event_kind_inconsistent`). The existing schema-vs-registry drift tests stay green
  because the schema enums + the TS arrays/objects were edited in sync.

## 2. What was NOT done (deferred to WI-A3-UNLINK-T1)

- No emitter — no audit event is produced; no `prepare*`/persistence wiring.
- No persistence change (`services/**` untouched); no SQLite schema / `CURRENT_SCHEMA_VERSION` change.
- No resolver/export/UI change. No canonicalization or verifier-logic change (registry addition only).

## 3. Governance

- review-plan `review-plan-mqugufiv-brs3tr` → READY, A07-CLASSIFICATION CONFIRMED-NOT-GATED-HIGH-RISK, KINDS
  AS-PROPOSED-OK (C0 H0 M0; 2 Lows: keep the drift tests green by editing schema+TS in sync; LINK_RELINKED
  reasonRequired false ok). queue.md sha256 `0a3cd16a` (govern `192300f`).
- Broker `/cc-suite:audit` + `/cc-suite:verify` run on the implementation diff before the commit.

## 4. Stop condition

"Done" when the contract additions + tests are committed. "Outdated" when WI-A3-UNLINK-T1 (the emitter) is promoted,
or when the audit-event-kind ADR supersedes the kinds.

## References
- `docs/adr/audit-event-kind-preservation.md`, `docs/adr/case-box-step-4-audit-log-shape.md`.
- `docs/contracts/case-box-contract/schemas/case-box-audit-event.schema.json`,
  `docs/contracts/case-box-contract/src/audit-log.ts`,
  `docs/contracts/case-box-contract/src/generated/case-box-audit-event.ts`,
  `docs/contracts/case-box-contract/tests/audit-event-kind-v2.test.mjs`.
- `docs/adr/ADR-evidence-a3-unlink-break-link-workflow.md`, `docs/adr/ADR-evidence-a3-durable-unlink-schema.md`.
