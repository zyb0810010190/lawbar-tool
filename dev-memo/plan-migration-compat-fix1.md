# Plan — WI-MIGRATION-COMPAT-FIX1

**Type**: DATA-SAFETY test remediation. Narrow correction of the Layer-B BATCH-FAIL on the merged WI-16
migration-compat test. **No product/schema change; not the services-CI WI.** Follows
`dev-memo/plan-desktop-data-migration-compat-16.md`.

## Trigger

Layer-B batch audit of window `a7977ce..9f5700f` (job `audit-mre5099f-u48410`) → **BATCH-FAIL C0 H0 M2** on
`services/case-box-persistence/tests/data-migration-compat.test.mjs`:

1. **M1** — no safe temp-root guard: `mkdtempSync(os.tmpdir())` could write under the repo or `~/Library` if
   `$TMPDIR` is misconfigured, contradicting the "temp-only, no repo/Library writes" claim.
2. **M2** — the "old" store was a current-runtime DB rewound to v8, not built from historical v8 DDL / a versioned
   fixture, so it under-proves compatibility with a real older store.

## Remediation

- **M1 (fixed)** — added `assertSafeTempRoot()` preflight (mirrors the WI-15 backup-drill guard): refuses to run if
  `os.tmpdir()` resolves inside the repo tree or `~/Library`, before any write. Called at the start of both tests.
- **M2 (strengthened)** — replaced create-at-current-then-rewind with a **frozen v1–v8 DDL** fixture: a
  `FROZEN_V8_SUBSET_DDL` snapshot (verbatim historical DDL for the tables populated/asserted) builds a genuine v8
  store at test time; authentic rows are written by the persistence API on a separate DB and copied in via `ATTACH`
  (early-table columns are identical v8↔current). Self-checks assert it is a real v8 store (marker = 8, no v9+
  table, synthetic rows present) before the upgrade. The upgrade + preservation assertions are unchanged
  (deep matter/document fields, docket by id, audit-chain consistency, v9–v12 tables restored).
- **Residual (M2, escalated + documented)** — the copied rows use the **current** `payload_json` shape, so old-app
  persisted-JSON drift is still not exercised. Recorded in `dev-memo/deferred-audit-findings.md`
  (`MIGRATE-COMPAT-M2-residual`, status `escalated`) with a `WI-MIGRATE-PINNED-FIXTURE` follow-up — a pinned
  old-app snapshot fixture, only if the repo later accepts a committed binary fixture (currently discouraged).

## Files

- `services/case-box-persistence/tests/data-migration-compat.test.mjs` — guard + frozen-DDL fixture.
- `dev-memo/desktop-data-migration-compat.md` — §3/§5 updated to the frozen-DDL approach + temp-root guard.
- `dev-memo/deferred-audit-findings.md` — residual row.
- this plan.

## Acceptance

`npm --prefix services/case-box-persistence test` (incl. the 2 rebuilt cases) · desktop regression
`npm --prefix apps/lawbar-desktop test` + `dist` + `test:smoke-matrix`. Post-fix Layer-B audit must cover
`a7977ce..<fix-head>` and return BATCH-PASS before the window closes.

## Governance

A BATCH-FAIL hard stop is active. This WI does NOT commit until a human-created `dev-memo/run/human.override`
exists. Marker stays `a7977ce`; the override authorizes the corrective commit; the post-fix Layer-B re-audit covers
`a7977ce..<fix-head>`. No push/merge/marker-mutation via the override. `WI-SERVICES-CI-GATES-17` resumes only after
this closes out.

## Out of scope

`apps/lawbar-desktop/**`, schema/contract source, CI workflows, product UI, backup scripts, signing/release.
