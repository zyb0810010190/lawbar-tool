# case-box-persistence

Persistence boundary for the lawyer case-box product. Phase A1.

**Status**: A1 — in-memory implementation only. No SQLite, no `better-sqlite3`, no native dependency. See `dev-memo/plan-case-box-persistence-A1.md` and `dev-memo/plan-case-box-persistence-00.md`.

## Public surface (Phase A1)

10 methods on `InMemoryCaseBoxPersistence`:

- `createMatter`, `getMatter`, `archiveMatter`, `unarchiveMatter`
- `registerDocument`, `getDocument`, `listDocuments`
- `listAuditEvents`, `getAuditChainHead`, `verifyAuditChainForMatter`

Every state-changing call emits exactly one audit event via the contract's
`buildCaseBoxAuditEvent` (NEVER raw construction). Audit chain head is tracked
per matter; chain reads are ordered by an internal per-matter monotonic
`sequence` (NOT timestamp + id, which is unsafe as an append-order proxy).

## What this package is NOT

- Not a SQLite implementation (Phase B, ABI-gated).
- Not an HTTP API, sync bridge, UI, auth provider, cloud client, or LLM extractor.
- Not a coordinator for OCR.

## Run tests

```bash
npm --prefix services/case-box-persistence install
npm --prefix services/case-box-persistence test
```

## References

- `dev-memo/plan-case-box-persistence-A1.md` — bounded reviewed plan (commit `3a9e06c`).
- `dev-memo/plan-case-box-persistence-00.md` — parent plan (A1 §1.1 NOTE enumerates four parent staleness points; A1 is AUTHORITATIVE on all four).
- `docs/adr/case-box-step-0-boundary.md` — boundary; one-way dep direction.
- `docs/adr/case-box-step-4-audit-log-shape.md` — audit chain shape; hash inputs; obligations.
- `docs/adr/case-box-step-7-multi-user-readiness.md` — `actor_user_id` posture; "local-user" sentinel rules.
- `docs/contracts/case-box-contract/` — schemas, validators, state machines.
