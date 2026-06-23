# BATCH-CASEBOX-EVIDENCE-A3-DB-SUBSTRATE-00 (plan — proposal)

**Status**: proposal plan (the governed `dev-memo/run/queue.md` is the authority). Records the next-WI boundary
+ open hard stops from the substrate decision; does NOT authorize execution.
**Date**: 2026-06-23. **Type**: PLAN (decision / sequencing).
**ADR**: `docs/adr/ADR-evidence-a3-persistence-substrate.md` (A3-DB-00). Read it first.

## 0. Purpose & scope cut

Record the implementation boundary that follows the substrate decision (reuse `case-box-persistence`
`better-sqlite3`; A3 schema = V9; encryption deferred behind a hard stop). **This plan writes no code,
dependency, migration, or schema.**

## 1. Next implementation WI boundary

### WI-A3-T1-IMPL — schema-only V9 (the next authorized lane)

Acceptance criteria the future WI MUST restate verbatim *(folds review Low)*:
- **A0.7-gated**: declares `Requires-A07: yes`; runs under A07-KEY-00 **custody mode 9b** (human-run gated
  `check-gates` with the HMAC key; agent never receives the key; impl commit blocked until the human reports
  gated PASS).
- **Schema-only V9**: adds `Anchor` + `Link` tables + constraints (per A3-SCHEMA-00 §3) to
  `services/case-box-persistence/src/sqlite/schema.ts` as `DDL_STATEMENTS_V9`, bumping
  `CURRENT_SCHEMA_VERSION` to 9; idempotent `applySchema`; `schema_version` row; one `BEGIN/COMMIT`.
- **NO new dependency** (reuses `better-sqlite3`); **NO key management**; **NO UI/product**; **NO resolver /
  status-transition logic** (that is the later A3-T5 WI); **NO export degradation**.
- **NO production-evidence-ingestion enablement** — the A3-DB-00 §5 HARD STOP applies; the WI works on
  synthetic fixtures only.
- **Migration discipline**: forward-only; no down-migrations; rollback via `git revert` + a new forward
  version, never a destructive reset/drop on real data.
- **Tests** (headless): `node --test` against `:memory:` (constraints + idempotency: page_ratio stored as
  byte-stable 12-dp strings; `geometryCapturedAt` NOT NULL/FK rejects an anchor without provenance;
  `LinkStatus` CHECK with no `DEFAULT 'valid'`) + a temp-file DB for restart behavior; `pretest` abi-smoke.
- **Verify**: per-service `npm --prefix services/case-box-persistence test` green (incl. the new schema
  tests); no committed marker/ledger/key/evidence-run.

Subsequent WIs (each separate, A0.7-gated): **A3-T5** resolver/status transitions → **A3-export** degradation
→ **A3-T6** mutation/cascade (stops-and-asks for the unresolved cascade policy).

## 2. Open hard stops (recorded; each its own user-authorized WI)

1. **Encryption-at-rest + production key management** — REQUIRED before production evidence ingestion
   (A3-DB-00 §5). Blocks any real client evidence entering persistence.
2. **macOS GRDB/SQLCipher client store** — a client-architecture decision (the handover's eventual encrypted
   store); separate from the Node schema substrate.
3. **Any move off `better-sqlite3` / Node 22-24** — a dependency/runtime hard stop.
4. **Anchor-delete cascade** — unresolved (A3-SCHEMA-00 decision 5 / A3-CONTRACT-00 decision 9); future
   A3-T6-equivalent stops-and-asks.

## 3. Verification (this decision PR)

Docs-only (ADR + this plan); changes no source. Real commands:
- `scripts/workflow/check-contract-integrity.sh`
- `scripts/workflow/check-gates.sh` (A0.7 gate not required — queue has no Requires-A07, no markers)
- `npm --prefix apps/lawbar-desktop test` (610/610)
- `npm --prefix native/evidence-core test` (38/38, A3-T2 stays green)

## 4. Stop condition

"Done" when the ADR + this plan are committed (WI-A3-DB-00). "Outdated" when WI-A3-T1-IMPL is promoted +
governed, or when A3-DB-00 is superseded (e.g. by the encryption/GRDB decision).

## References
- `docs/adr/ADR-evidence-a3-persistence-substrate.md` (A3-DB-00),
  `docs/adr/ADR-evidence-a3-schema-persistence-contract.md` (A3-SCHEMA-00),
  `docs/adr/ADR-evidence-a07-key-custody-operating-model.md` (A07-KEY-00).
- `services/case-box-persistence/src/sqlite/schema.ts` (the V8 schema this extends to V9).
