Status: scaffold. Content lands in WI-09b after WI-07 completes and either WI-06 completes or the WI-06-deferral decision is recorded (per the round-4 plan's WI-09b conditional predecessor rule).

## Node Version Check (Capture `node --version`; Must Match Plan Pin Node 22.x LTS)
_To be filled in WI-09b after WI-06/WI-07 land. See [`docs/release/go-live-plan.md`](../release/go-live-plan.md) WI-09b acceptance criteria._

## Dependency Audit (`npm audit --omit=dev` per package; Record Output; Treat Unfixed Critical/High in Prod Deps as v1-Blocking)
_To be filled in WI-09b after WI-06/WI-07 land. See [`docs/release/go-live-plan.md`](../release/go-live-plan.md) WI-09b acceptance criteria._

## Production Config Preflight (Validate Every Env Var Defined in the Runbook's Production Profile Section)
_To be filled in WI-09b after WI-07 lands (and after WI-06 lands, or after the WI-06-deferral decision). See [`docs/release/go-live-plan.md`](../release/go-live-plan.md) WI-09b acceptance criteria._

## Fail-Closed Probes (Missing `OCR_WORKER_REQUIRE_REAL`, `OCR_WORKER=fake` Under Production, `OCR_WORKER_REQUIRE_REAL=1` + `OCR_WORKER=fake` Outside Production, Valid Production Profile)
_To be filled in WI-09b after WI-06/WI-07 land. See [`docs/release/go-live-plan.md`](../release/go-live-plan.md) WI-09b acceptance criteria._

## Queue + Persistence Checks (SQLite File Exists + Has v3 Schema, Queue Rows Readable, No Orphaned Pending-Retry Rows)
_To be filled in WI-09b after WI-06/WI-07 land. See [`docs/release/go-live-plan.md`](../release/go-live-plan.md) WI-09b acceptance criteria._

## Rollback Procedure (Per-WI Baseline-Patch Reference; Commit-vs-Uncommitted Branches)
_To be filled in WI-09b after WI-06/WI-07 land. See [`docs/release/go-live-plan.md`](../release/go-live-plan.md) WI-09b acceptance criteria._

## Commit / Diff-Hash Evidence
_To be filled in WI-09b after WI-07 lands (and after WI-06 lands, or after the WI-06-deferral decision). See [`docs/release/go-live-plan.md`](../release/go-live-plan.md) WI-09b acceptance criteria and the Branch, Commit, And Evidence Policy section._

## Audit Checks
_To be filled in WI-09b after WI-07 lands (and after WI-06 lands, or after the WI-06-deferral decision). See [`docs/release/go-live-plan.md`](../release/go-live-plan.md) WI-09b acceptance criteria._
