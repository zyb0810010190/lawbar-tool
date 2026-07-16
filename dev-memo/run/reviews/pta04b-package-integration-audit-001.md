# WI-PTA-04b — cc-suite implementation-audit record

Forward-only governance record preserving the two cc-suite Path-1 implementation audits run against the
WI-PTA-04b desktop package-publication candidate (commit `3c2f828`
`build(desktop): publish ClaimTrack contract package`). Structured per `.claude/rules/cc-suite.md`
§"Required recording". This file records; it changes no WI-PTA-04b scope, implementation, or verification
result. All metadata was copied from the cc-suite shared state store
(`~/.claude/plugins/data/cc-suite-xiaolai/state/lawbar-tool-8153f46e0d61e5fb/jobs/`), not from memory.

## Governance linkage (why this file exists)

- Batch closeout audit **`audit-mrnkq5on-z8xmyq`** over range `131fc31..3c2f828` returned
  **`BATCH-FAIL C0 H0 M1`** (rawOutput sha256 `5cb456979cbb4a81839068eb6fd41e7e179112b26d7cc0a3d1360451668f91c2`).
- Its **sole Medium** finding: the two WI-PTA-04b implementation audits (`audit-mrnjow40-93d3wi`,
  `audit-mrnk9vwr-sza21y`) were not preserved in any **tracked** repository artifact — `3c2f828`'s message is
  bare and the study-267 attestation references only the reconciliation-chain audits.
- **This file is the forward remediation.** It does NOT amend, squash, or rewrite `3c2f828`. The batch failure
  is NOT considered closed until the subsequent re-audit over `131fc31..<this-commit>` confirms `BATCH-PASS`.

## Audit 1 — pre-normalization candidate (superseded for final-diff authority; retained as evidence)

1. **Work item:** WI-PTA-04b (publish committed ClaimTrack contract into the checked-in desktop internal tarball).
2. **Audited candidate:** the initial three-file WI-PTA-04b artifact diff **before** persistence-manifest
   timestamp normalization — contract tarball (71687→75382 B), `manifest.json` (contract entry **plus** a
   persistence-entry `packedAt`-only churn), `package-lock.json` (contract integrity). Not a commit; a working-tree candidate.
3. **Audit type / kind:** `audit` (final implementation audit).
4. **Runner / model / effort / sandbox / approval-policy:** Path 1 plugin runner
   `~/.claude/plugins/cache/xiaolai/cc-suite/0.2.18/scripts/codex-runner.mjs`; `gpt-5.5`; effort `high`;
   sandbox `read-only`; per-command default approval policy.
5. **Job ID:** `audit-mrnjow40-93d3wi`.
6. **Status:** `completed` (created `2026-07-16T13:28:49.307Z`, completed `2026-07-16T13:31:13.284Z`).
7. **Codex threadId:** not separately emitted by the runner envelope for this job.
8. **Output / result location:** cc-suite state store job artifact
   `.../jobs/audit-mrnjow40-93d3wi.{json,log}`; rawOutput sha256
   `7c09cd83d3c4430cd0a6d53da8bb210bbb93f29b720cb10677eee74549cbb281`.
9. **`/cc-suite:status` / `/cc-suite:result` retrievable?** YES (Path 1, runner returned `status:"completed"`).
10. **Exact verdict:** **no findings — `C0 H0 M0 L0`.**
11. **Scope confirmed:** persistence tarball byte-identical; contract manifest changes = sizeBytes/integrity/packedAt;
    lockfile = contract integrity only; contract tarball publishes only the committed ClaimTrack model (`bbf2a36`);
    no source/renderer/persistence/IPC/dependency/audit-emission/PTA-05 work.
12. **Limitation:** the read-only sandbox could not rerun write-requiring packaging checks (`EPERM` on temp-dir);
    the auditor independently inspected the artifact state and successfully reran `check:internal-lock` (pass).
13. **Disposition:** **superseded for final-diff authority** by Audit 2 (the persistence `packedAt` churn this
    candidate carried was later normalized away). Retained here as evidence of the earlier candidate.

## Audit 2 — final normalized candidate (AUTHORITATIVE for `3c2f828`)

1. **Work item:** WI-PTA-04b.
2. **Audited candidate:** the **normalized** three-file diff committed as **`3c2f828`** — contract tarball,
   `manifest.json` (contract entry **only**; persistence entry restored byte-identical to HEAD `e51c322`),
   `package-lock.json` (contract integrity only).
3. **Audit type / kind:** `audit` (final implementation re-audit after normalization).
4. **Runner / model / effort / sandbox / approval-policy:** Path 1 runner `codex-runner.mjs` @ `0.2.18`;
   `gpt-5.5`; effort `high`; sandbox `read-only`; per-command default approval policy.
5. **Job ID:** `audit-mrnk9vwr-sza21y`.
6. **Status:** `completed` (created `2026-07-16T13:45:08.824Z`, completed `2026-07-16T13:48:32.771Z`).
7. **Codex threadId:** not separately emitted by the runner envelope for this job.
8. **Output / result location:** `.../jobs/audit-mrnk9vwr-sza21y.{json,log}`; rawOutput sha256
   `dea012d2a58ec0d9489915358001025274d6ffbccf1d6430c9407aead8dc7732`.
9. **`/cc-suite:status` / `/cc-suite:result` retrievable?** YES (Path 1, `status:"completed"`).
10. **Exact verdict:** **no findings — `C0 H0 M0 L0`.**
11. **Confirmations:** the persistence tarball remained byte-identical (`cmp=0`); the complete
    `case-box-persistence` manifest entry remained JSON-identical to HEAD; the manifest changed only for the
    contract entry (sizeBytes/integrity/packedAt); the lockfile changed only `node_modules/case-box-contract.integrity`;
    the contract tarball publishes the already-committed ClaimTrack model (schema + 14 fixtures byte-match `bbf2a36`);
    no source behavior, renderer, persistence source, IPC, dependency, audit-emission, or PTA-05 work was included.
12. **Limitation:** same read-only-sandbox `EPERM` on write-requiring packaging checks; auditor independently
    reran `check:internal-lock` (pass) and found the supplied gate evidence consistent with the inspected state.
13. **Disposition:** **AUTHORITATIVE final-diff audit for `3c2f828`.** No findings to resolve.

## Local gate evidence at `3c2f828` (from the implementing session)

`check:internal-tarballs` PASS · `check:internal-lock` current · `npm ci` no lockfile change ·
contract 485/485 · persistence 590/273/288 · packaging-tool self-test 19/19 · desktop build clean ·
desktop suite 837/837 · `check-gates.sh` GATES OK.
