# BATCH-CASEBOX-EVIDENCE-A3-LINK-CREATE-AUDIT-KIND-00 (record — contract addition)

**Status**: record of an implemented contract addition (the governed `dev-memo/run/queue.md`
WI-A3-LINK-CREATE-AUDIT-KIND is the authority). Records the `LINK_CREATED` audit-event kind added to the
case-box-contract audit vocabulary, the predecessor for the durable link-CREATE operation (WI-A3-LINK-CREATE-T1).
**Date**: 2026-06-26. **Type**: SOURCE (contract / audit-event-kind; NOT A0.7-gated; HIGH-RISK contract).
**ADRs**: `docs/adr/ADR-evidence-a3-link-create-operation.md` (D1/§8 — requires this kind) +
`docs/adr/audit-event-kind-preservation.md` (the governing kind-preservation ADR). Read them first.

## 0. Why this lane exists (sequencing)

The durable link-CREATE OPERATION (WI-A3-LINK-CREATE-T1) must emit a tamper-evident audit event. The case-box
audit chain validates a v2 event's `event_kind` against a fixed `{action, entity_type, reasonRequired}` registry,
and there was no create-action kind for `link` (only `LINK_UNLINKED`/`LINK_RELINKED`, both `action: update`). Per
the merged link-create ADR (D1), the audit-kind CONTRACT support is added FIRST, in its own governed lane, so T1
can emit the kind against an already-supported contract — the same pattern as WI-A3-UNLINK-AUDIT-KINDS (PR #136).

## 1. What was added (additive, append-only)

- `event_kind` enum (`schemas/case-box-audit-event.schema.json`) + `CASE_BOX_AUDIT_EVENT_KINDS`
  (`src/audit-log.ts`): added **`LINK_CREATED`** — `{ action: "create", entity_type: "link", reasonRequired:
  false }` (creating a link is `action: create`, needs no reason; mirrors `DOCUMENT_REGISTERED`/`MATTER_REGISTERED`
  create kinds). The `link` entity_type already exists (added by WI-A3-UNLINK-AUDIT-KINDS, PR #136) — NO
  entity_type change.
- `src/generated/case-box-audit-event.ts`: REGENERATED via `gen:types` (AUTO-GENERATED banner intact; not
  hand-edited).
- `tests/audit-event-kind-v2.test.mjs`: extended the registry-tuple assertion with `LINK_CREATED`; added a
  positive case (a LINK_CREATED event with `action: create`, `entity_type: link`, no reason verifies) and a
  negative case (a tuple mismatch → `event_kind_inconsistent`). The existing schema-vs-registry drift tests +
  LINK_UNLINKED/LINK_RELINKED + golden canonical tests stay green (schema + TS edited in sync).

## 2. What was NOT done (deferred to WI-A3-LINK-CREATE-T1)

- No emitter — no audit event is produced; no `createLink`/persistence wiring.
- No persistence change (`services/**` untouched); no SQLite schema / `CURRENT_SCHEMA_VERSION` change.
- No resolver/export/UI/IPC change. No canonicalization or verifier-logic change (registry addition only).
- No `entity_type` change (`link` already present).

## 3. Governance

- review-plan `review-plan-mquong84-3png0m` → READY, A07-CLASSIFICATION CONFIRMED-NOT-GATED-HIGH-RISK, TUPLE
  AS-PROPOSED-OK (C0 H0 M0; 1 Low: add explicit LINK_CREATED tests — the WI already requires it, done).
  queue.md sha256 `7ddf478f`.
- Broker `/cc-suite:audit` + `/cc-suite:verify` run on the implementation diff before the commit.

## 4. Stop condition

"Done" when the contract addition + tests are committed. "Outdated" when WI-A3-LINK-CREATE-T1 (the emitter) is
promoted, or when the audit-event-kind ADR supersedes the kind.

## References
- `docs/adr/ADR-evidence-a3-link-create-operation.md`, `docs/adr/audit-event-kind-preservation.md`,
  `docs/adr/case-box-step-4-audit-log-shape.md`.
- `docs/contracts/case-box-contract/schemas/case-box-audit-event.schema.json`,
  `docs/contracts/case-box-contract/src/audit-log.ts`,
  `docs/contracts/case-box-contract/src/generated/case-box-audit-event.ts`,
  `docs/contracts/case-box-contract/tests/audit-event-kind-v2.test.mjs`.
