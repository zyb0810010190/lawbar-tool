# ADR A3-DB-00 — Evidence-Genie M0 A3 persistence substrate decision

> **Provenance note (2026-08-22).** The governance queue, review tree and autonomy rules
> cited below were removed together with the agent-governance layer in commits `49dd7ad`
> and `e67b047`. Those citations — queue and review paths, sha256 digests, PR numbers —
> are retained deliberately as the audit trail of what authorized this work. They record
> provenance; they are not paths you can follow today. Current authority for hard stops
> is `docs/product/product-definition.md` §20.


**Status**: Accepted (substrate DECISION — design only; adds no dependency, migration, schema, or key
management).
**Date**: 2026-06-23.
**WI**: WI-A3-DB-00 (Type PLAN; design-only; NOT A0.7-gated).
**Decides the substrate for**: the future A3 anchor/link **schema implementation** contracted by
`ADR-evidence-a3-schema-persistence-contract.md` (A3-SCHEMA-00, engine-neutral). Composes under
`ADR-evidence-a07-key-custody-operating-model.md` (A07-KEY-00) and `.claude/rules/client-local-first.md`.

## 1. Context

A3-SCHEMA-00 fixed the engine-neutral anchor/link persistence contract (canonical `page_ratio` as fixed
12-dp strings, `geometryCapturedAt` NOT NULL + immutable, `LinkStatus` with no implicit `valid`, cascade
unresolved) and explicitly **deferred the storage engine** to "a future dependency hard-stop WI — not here."
This ADR is that decision. It chooses **where** the A3 schema is implemented and **whether** encryption-at-rest
is in scope now. It writes no code, adds no dependency, runs no migration, and invents no key management.

## 2. Decision

**Reuse the existing Node `services/case-box-persistence` `better-sqlite3` SQLite layer — NO new dependency —
and implement the A3 `Anchor` / `Link` tables as schema version V9 via that service's existing versioned-DDL
`applySchema` convention.** Encryption-at-rest is **out of scope for schema-only M0 work** and is a **HARD
STOP before production evidence ingestion** (§5).

## 3. The ten questions, answered (grounded — verified read-only)

1. **What local-persistence storage already exists?** `services/case-box-persistence` and
   `services/ocr-persistence` both use **`better-sqlite3` ^12.9.0** (native binding; `engines.node
   ">=22.0.0 <26.0.0"`; a `pretest` `abi-smoke.mjs` ABI check). case-box-persistence is at
   `CURRENT_SCHEMA_VERSION = 8` and already owns `case_box_documents` (with `supersedes_document_id` for
   replacement), `case_box_facts`, `case_box_evidence_items`, `case_box_ocr_links`, and the audit chain.
2. **Can A3-T1 schema reuse an existing path?** **Yes.** `DocumentPage` / `DocumentPageGeometry` are
   case-box domain concepts; `Anchor`/`Link` bind to them. case-box-persistence is the natural home — a new
   service adds ownership ambiguity, and `ocr-persistence` is the wrong domain.
3. **If a new dependency is needed, which + why?** **None.** The reuse path needs no new dependency
   (`better-sqlite3` already present). Introducing GRDB/SQLCipher into the Node services now would violate the
   no-new-dependency / schema-decision-only scope and blur the macOS-app concern into the Node layer.
4. **Is SQLCipher/encryption required now or deferred?** **Deferred** for schema-only M0 work; see §5 (hard
   stop before production evidence ingestion).
5. **Can schema-only impl proceed without encryption?** **Yes — for M0.** M0 is manual-truth-only, synthetic
   fixtures, **no production client evidence ingested**, **no network**, local-only. The Node services are
   plaintext SQLite today (WAL/synchronous/foreign_keys pragmas only). Schema-only V9 work on synthetic data
   does not weaken confidentiality **because** the production boundary in §5 is recorded as blocking.
6. **Migration file location + naming convention.** No standalone SQL files / migration framework. The
   convention is **versioned-DDL arrays inside `services/case-box-persistence/src/sqlite/schema.ts`**: add
   `DDL_STATEMENTS_V9`, bump `CURRENT_SCHEMA_VERSION` to 9, and let the idempotent `applySchema(db)` apply it
   inside a single `BEGIN/COMMIT`, recording the version in the `schema_version` table.
7. **Rollback / forward-only policy.** **Forward-only — no down-migrations** (matches the existing services
   and the repo's no-`reset --hard` policy). Rollback of unshipped work is `git revert`; rollback of any
   shipped schema is a **new forward version**, never a destructive reset/drop on real data.
8. **How schema tests run headlessly.** `node --test` against an in-process `:memory:` SQLite DB (idempotency,
   constraints) plus a file-backed temp DB via `mkdtempSync(tmpdir())` for restart-style assertions, gated by
   the `pretest` `abi-smoke.mjs` native-binding check. No external service, no UI.
9. **How A0.7 gating applies to the impl WI.** `WI-A3-T1-IMPL` is A0.7-DEPENDENT: it MUST declare
   `Requires-A07: yes` and run under custody mode 9b (human-run gated `check-gates` with the HMAC key; agent
   never receives the key; impl commit blocked until the human reports gated PASS). It is a **migration**
   (schema-version bump) but, under this reuse decision, **NOT a new-dependency** hard stop.
10. **Exact next WI authorized.** **WI-A3-T1-IMPL** — schema-only V9 (`Anchor` + `Link` tables + constraints)
    in `services/case-box-persistence`, A0.7-gated, no resolver/status/UI, no new dependency, no key
    management, and **no production-evidence-ingestion enablement** (§5).

## 4. Why this substrate (not the alternatives)

- **Reuse case-box-persistence (chosen)**: zero new dependency; correct domain ownership; reuses the proven
  versioned-DDL/`applySchema` + `:memory:` test pattern; keeps the Node-engine pin in sync.
- **New service**: rejected — ownership ambiguity for entities that are case-box document properties.
- **ocr-persistence**: rejected — wrong domain (OCR jobs/queue), not case-box documents.
- **GRDB/SQLCipher in Node now**: rejected — a new dependency + a key-management surface this lane forbids;
  GRDB/SQLCipher is the **macOS app's** eventual encrypted store (handover), a separate client-architecture +
  encryption decision (§5), not the Node schema substrate.

## 5. Encryption-at-rest — HARD STOP before production evidence ingestion *(folds review Medium)*

Encryption-at-rest is **NOT an optional "future improvement" — it is REQUIRED before any production client
evidence is ingested into persistence.** Until that decision lands, the following is a **blocking hard stop**:

> **HARD STOP**: No production / real client evidence content may be ingested into the plaintext Node SQLite
> store. Production evidence ingestion is blocked until a separate, user-authorized WI decides encryption-at-rest
> (the macOS GRDB/SQLCipher store and/or Node-side encryption) **and** production key management (Argon2id /
> CryptoKit per the handover; a custody model parallel to A07-KEY-00). This is recorded here and MUST be
> restated in the acceptance criteria of every WI that approaches evidence ingestion.

For M0 schema-only work on **synthetic** fixtures with no network, plaintext is acceptable precisely because
this boundary is explicit and enforceable. This ADR invents **no** key management and weakens **no**
confidentiality assumption.

## 6. Consequences + open hard stops

- **Positive**: the A3 schema implementation can proceed with zero new dependency, in the correct domain, on a
  proven migration + test pattern; the production-evidence boundary is explicit; encryption is not silently
  assumed-away.
- **Open hard stops (recorded, not decided here)**: (a) encryption-at-rest + production key management before
  production evidence ingestion (§5); (b) the macOS GRDB/SQLCipher client store (a client-architecture
  decision); (c) any move off `better-sqlite3` / Node 22-24; (d) the anchor-delete cascade (A3-SCHEMA-00
  decision 5, still unresolved). Each is its own user-authorized WI.

## References
- `docs/adr/ADR-evidence-a3-schema-persistence-contract.md` (A3-SCHEMA-00 — the engine-neutral schema this
  substrate hosts), `dev-memo/plan-batch-casebox-evidence-a3-db-substrate-00.md` (next-WI boundary).
- `services/case-box-persistence/{package.json, src/sqlite/schema.ts, src/sqlite/openSqliteCaseBoxPersistence.ts,
  scripts/abi-smoke.mjs, tests/hardening-schema.test.mjs}` (the reused layer; read-only reference).
- `docs/adr/ADR-evidence-a07-key-custody-operating-model.md` (A07-KEY-00),
  `Evidence-Genie-M0-Developer-Handover.md` (GRDB/SQLCipher = macOS app; manual-truth M0; synthetic fixtures).
- `.claude/rules/client-local-first.md`, `.claude/rules/security-boundary.md`, `.claude/rules/autonomy.md`
  (new dependency / migration / cloud / key custody are hard stops).
