# Batch audit 269 — WI-PTA-04b post-merge closeout

**Range:** `5295ed0..9922bbd` (3 commits) on `main`.
**Date:** 2026-07-16.
**Type:** post-merge governance closeout.

## What this batch covers

PR #262 (`feat(contract): add ClaimTrack model and publish desktop package`) merged into `main` by a
**merge commit** (`9922bbd`), preserving all reviewed commit identities. Since the previous marker `5295ed0`,
three commits accrued: the recording-remediation closeout `809e4e1`, the standalone recording-override log
record `d42b2ee`, and the merge commit `9922bbd`. This closeout audits and closes that range.

## Commits in range (marker 5295ed0 EXCLUDED)

- `809e4e1` `chore(workflow): batch-audit closeout 131fc31..5295ed0` — governance-only; closed the WI-PTA-04b
  missing-audit-record remediation (re-audit `audit-mrnlyomn-38cgic` BATCH-PASS).
- `d42b2ee` `chore(workflow): record PTA-04b recording-override consumption` — governance-only; one
  `dev-memo/run/log.md` append (the consumed recording-override reason, `2026-07-16T14:30:37Z`).
- `9922bbd` `Merge pull request #262 …` — merge commit; parents `6856148` (pre-merge main) + `d42b2ee`
  (reviewed branch tip). `git diff d42b2ee..9922bbd` is EMPTY — the merge introduced no change beyond the
  reviewed branch.

## Merge / CI / post-merge evidence

- Merge method: **merge commit** (no squash/rebase); identities `bbf2a36`, `3c2f828`, `5295ed0`, `809e4e1`,
  `d42b2ee` preserved.
- PR #262 required checks green before merge: `check-ui-design-artifact` pass, `case-box-persistence` pass,
  `desktop-release-gates` pass. Merged `2026-07-16T14:42:59Z`.
- Post-merge verification on `main`: contract 485/485; persistence 590/590, 273/273, 288/288; packaging-tool
  19/19; desktop 837/837; contract+desktop builds clean; `check:internal-tarballs` PASS; `check:internal-lock`
  current; `check-gates.sh` GATES OK; `npm ci` no diff; `gen:types` no diff. ClaimTrack payload present (5 core
  files + 14 fixtures); persistence tarball `f5e75d99…` unchanged; lockfile carries only the approved
  `case-box-contract` integrity reconciliation.

## Re-audit

- **Job `audit-mrnmjs4g-o89ooh`** (cc-suite Path 1 runner `codex-runner.mjs` @ `0.2.18`,
  `--kind audit --model gpt-5.5 --effort high --sandbox read-only`).
- **Verdict: BATCH-PASS C0 H0 M0** (no findings). rawOutput sha256
  `295e51183ccf2b2748992e21a7fc21d1dc42f23ab9c26092af51152c951a76c5`.
- All 10 points verified: merge topology + preserved identities; empty merge-vs-branch diff; governance-only
  range; audit-record closeout correct; override-consumption log correct; persistence tarball + manifest entry
  unchanged; lockfile contract-integrity-only; ClaimTrack schema + 14 fixtures byte-match `bbf2a36`; no WI-PTA-05.

## Confirmation

No product, contract, tarball, lockfile, renderer, or package change is introduced by this range beyond the
already-reviewed-and-merged PR content. This is a governance-only closeout.

<!-- batch-audit-attestation v1
range_base: 5295ed0a3880e341df75a0ff1c61198cb3f56354
target_sha: 9922bbd90b5df0a042c02f8b7191a597536972d4
verdict: BATCH-PASS
findings: C0 H0 M0 L0
broker_job_id: audit-mrnmjs4g-o89ooh
broker_output_sha256: 295e51183ccf2b2748992e21a7fc21d1dc42f23ab9c26092af51152c951a76c5
-->
