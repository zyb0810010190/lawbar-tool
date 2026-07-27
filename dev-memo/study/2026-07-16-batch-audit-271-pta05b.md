# Batch audit 271 — WI-PTA-05b EvidencePreparation package publication

**Range:** `68e2d6b..f033e2e` (3 commits) on `feature/pretrial-trial-addon-05`.
**Date:** 2026-07-16.
**Type:** Layer-B batch closeout (package-publication WI + preceding governance).

## Commits in range (marker 68e2d6b EXCLUDED)
- `6fcdf14` `chore(workflow): batch-audit closeout 9922bbd..68e2d6b` — governance-only (attestation study 270 +
  closeout-log append; closed the WI-PTA-05 contract-impl range).
- `03e4e6a` `docs(plan): authorize WI-PTA-05b package publication` — the reviewed WI-PTA-05b docket (one file;
  review-plan `review-plan-mrp21dfw-s6aks9` READY).
- `f033e2e` `build(desktop): publish EvidencePreparation contract package` — 3 desktop artifacts (contract tarball
  75382→79395, manifest contract-entry-only, lockfile contract-integrity-only); carries the cc-suite recording
  block for `audit-ms1k0pfm-xl5jv9`.

## Re-audit
- **Job `audit-ms1xj00u-fbc7r4`** (cc-suite Path 1 runner `codex-runner.mjs` @ `0.2.18`,
  `--kind audit --model gpt-5.5 --effort high --sandbox read-only`).
- **Verdict: BATCH-PASS C0 H0 M0** (no findings). rawOutput sha256
  `424120e32b3ebf56cbf2cbcf6d3c522320a81770b7819b59c1f48d9c5c4d0322`.
- All 13 points verified: `6fcdf14` governance-only; `03e4e6a` docket-only; `f033e2e` exactly the 3 artifacts with
  the durable recording block; contract tarball SHA `6d8bbe36…` publishing only the committed EvidencePreparation
  model (schema + validator/generated `.js`/`.d.ts` + loader/root exports + 5 valid/7 invalid fixtures; schema + all
  12 fixtures byte-match `68e2d6b`); persistence tarball byte-identical (`f5e75d99…`) + manifest entry
  JSON-identical to HEAD; manifest contract-entry-only; lock `node_modules/case-box-contract.integrity`-only; no
  version/resolved/deps/persistence/renderer/persistence-source/IPC/audit-emission/dep-upgrade/PTA-06 work;
  contract 512/512, desktop 837/837, packaging-tool 19/19 recorded gates internally consistent.

## WI-PTA-05b implementation-audit (recorded on `f033e2e`, preserved here)
- Audit `audit-ms1k0pfm-xl5jv9` → **C0 H0 M0 L0** (no findings; rawOutput sha256
  `b58fc8d2c7c0829739732a6262bc44f83718ba8d95ba188b9b677f9da67c71d8`). Read-only-sandbox EPERM prevented rerunning
  write-requiring gates; auditor independently re-ran `check:internal-lock` + `git diff --check` (pass) and
  confirmed deterministic tar metadata.

## Confirmation
No product/source change; this range is the WI-PTA-05b package publication (artifact-only) plus the preceding
governance. The next work is the WI-PTA-05 PR (contract model + desktop package), which this closeout does NOT open.

<!-- batch-audit-attestation v1
range_base: 68e2d6bc60bd1bfb910624a6695768e132bfacc9
target_sha: f033e2e5a5710b8e3e266b7a75bcb338c81c77d9
verdict: BATCH-PASS
findings: C0 H0 M0 L0
broker_job_id: audit-ms1xj00u-fbc7r4
broker_output_sha256: 424120e32b3ebf56cbf2cbcf6d3c522320a81770b7819b59c1f48d9c5c4d0322
-->
