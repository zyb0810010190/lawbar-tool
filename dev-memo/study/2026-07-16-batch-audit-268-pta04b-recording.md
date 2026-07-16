# Batch audit 268 — WI-PTA-04b implementation-audit recording remediation

**Range:** `131fc31..5295ed0` (4 commits) on `feature/pretrial-trial-addon-04`.
**Date:** 2026-07-16.
**Type:** forward-remediation re-audit + closeout (follows a BATCH-FAIL).

## Why this batch first failed, then closed out on a re-audit

The batch marker sat at `131fc31`. Three commits landed (`3dc9914` governance closeout, `e51c322` override-log
record, `3c2f828` ClaimTrack contract-package publication), making a Layer-B batch audit due. The FIRST closeout
audit of `131fc31..3c2f828` (job **`audit-mrnkq5on-z8xmyq`**) returned **BATCH-FAIL C0 H0 M1**.

- **M1 (root cause):** the two WI-PTA-04b final implementation audits — `audit-mrnjow40-93d3wi`
  (pre-normalization candidate) and `audit-mrnk9vwr-sza21y` (normalized candidate, authoritative for `3c2f828`)
  — were not preserved in any **tracked** repository artifact. `3c2f828`'s message was bare and study-267
  referenced only the reconciliation-chain audits. Per `.claude/rules/cc-suite.md` §"Required recording", a
  high-risk WI's Path-1 audits must be recorded in a tracked artifact.

## Forward-only remediation (no rewrite of history)

- **`5295ed0` `docs(record): preserve WI-PTA-04b implementation audits`** — ONE new tracked file
  `dev-memo/run/reviews/pta04b-package-integration-audit-001.md` recording both impl audits with full cc-suite
  metadata (job IDs, runner/model/effort/sandbox, status, verdicts, scope, dispositions, output hashes,
  limitations), and identifying `audit-mrnk9vwr-sza21y` as authoritative for `3c2f828` and `audit-mrnjow40-93d3wi`
  as superseded. No product/artifact/docket change.
- **`3c2f828` was NOT amended, rebased, or squashed** — `5295ed0` is a fresh child commit; `3c2f828` retains SHA
  `3c2f8281a3edf8ab0206630a0657cd3131b9bf30`.

## Single-use override authorization (consumed)

The due-closeout guard blocked the record commit (audit due, count-since-marker = 3) while the failed audit blocked
advancing the marker — a governance-recording deadlock. The human operator armed a single-use
`dev-memo/run/human.override`. Consumed reason (logged `2026-07-16T14:30:37Z`):

> Governance-recording deadlock override (NOT a bypass of the batch finding): batch audit `audit-mrnkq5on-z8xmyq`
> of `131fc31..3c2f828` failed solely because WI-PTA-04b implementation audits `audit-mrnjow40-93d3wi` and
> `audit-mrnk9vwr-sza21y` were not preserved in a tracked repository artifact. … This override authorizes exactly
> ONE docs-only commit adding the cc-suite audit record; no amendment of `3c2f828`, product change, artifact
> change, scope expansion, or unrelated documentation is authorized.

## Successful re-audit

- **Job `audit-mrnlyomn-38cgic`** (cc-suite Path 1 runner `codex-runner.mjs` @ `0.2.18`,
  `--kind audit --model gpt-5.5 --effort high --sandbox read-only`).
- **Verdict: BATCH-PASS C0 H0 M0** (no findings). rawOutput sha256
  `e92d1dea40cd2601074d03b374e9c9d2f6a7f79078886efc97393ea7556a3a89`.
- All 9 points verified: `3dc9914`/`e51c322` governance-only; `3c2f828` unchanged, exactly the 3 authorized
  artifacts; `5295ed0` only the audit record; both impl-audit IDs now tracked with full metadata;
  `audit-mrnk9vwr-sza21y` authoritative / `audit-mrnjow40-93d3wi` superseded; persistence tarball + full manifest
  entry unchanged (`f5e75d99…`); lockfile contract-integrity-only; no unrelated product / WI-PTA-05 work.

## M1 disposition

**CLOSED** by `5295ed0`. The two implementation audits are now preserved in a tracked artifact; the re-audit
`audit-mrnlyomn-38cgic` confirms verification point 7 holds.

## Confirmation

No product or artifact changed during remediation — the only change relative to the failed audit is the single new
tracked audit-record file (`5295ed0`). The ClaimTrack contract publication (`3c2f828`) is byte-for-byte the audited
state.

<!-- batch-audit-attestation v1
range_base: 131fc317471845cbdc16b51543ef8b589e0b3ca5
target_sha: 5295ed0a3880e341df75a0ff1c61198cb3f56354
verdict: BATCH-PASS
findings: C0 H0 M0 L0
broker_job_id: audit-mrnlyomn-38cgic
broker_output_sha256: e92d1dea40cd2601074d03b374e9c9d2f6a7f79078886efc97393ea7556a3a89
-->
