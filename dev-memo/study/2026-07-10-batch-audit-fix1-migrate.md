# Batch audit — window a7977ce..2063b0d (WI-16 migration-compat + FIX1 hardening)

**Verdict**: BATCH-PASS C0 H0 M0. **Broker job**: `audit-mre6rpmh-mb8fkn` (Path 1 runner `cc-suite/0.2.18`, gpt-5.5/high/read-only; inlined-diff post-fix re-audit).

## Window

`a7977ce04d433aa3083cb46541df13808d1a0c2e..2063b0d5d218ee558732445a56c3859706903db1`:
- `3ff1211` chore(workflow): batch-audit closeout d9ade65..a7977ce.
- `915ffb7` test(persistence): data-migration / upgrade compatibility (WI-16).
- `9f5700f` merge PR #251.
- `2063b0d` test(persistence): frozen-DDL old-store fixture + temp-root guard (WI-MIGRATION-COMPAT-FIX1).

## Remediation history (why this is a re-audit)

The first Layer-B pass over `a7977ce..9f5700f` (`audit-mre5099f-u48410`) returned **BATCH-FAIL C0 H0 M2** on the
WI-16 `data-migration-compat.test.mjs`: (M1) no safe temp-root guard; (M2) the old store was a current DB rewound
to v8, not built from historical v8 DDL. FIX1 (`2063b0d`, single-use override, marker held at `a7977ce`) added an
`assertSafeTempRoot()` preflight and rebuilt the old store from a **complete frozen v1–v8 DDL** snapshot populated
with authentic API rows via `ATTACH` (self-checks the complete v8 table set + no v9+ tables). Verify
`verify-mre66wyl-yim2tx` → ALL CLOSED. The old-payload-shape residual is escalated + documented in
`dev-memo/deferred-audit-findings.md` (`MIGRATE-COMPAT-M2-residual`). This attestation is the post-fix re-audit.

## Checks (Layer B)

- **Net delta**: a persistence test + `package.json` test-list entry + docs + deferred-findings row + run-control
  records. No product source / contracts / schema / IPC / UI.
- **Security / confidentiality**: `assertSafeTempRoot()` refuses a `$TMPDIR` inside the repo or `~/Library` before
  any write; synthetic data only; temp files under `os.tmpdir()`; nothing written to the repo tree or `~/Library`;
  `dev-memo/run/intake/` untouched.
- **FIX1 holds**: old store built from a complete frozen v1–v8 DDL (not a subset, not a rewind), authentic rows via
  `ATTACH`, upgrade to current proven with deep preservation + audit-chain consistency; residual documented.

## Findings

None (C0 H0 M0).

<!-- batch-audit-attestation v1
range_base: a7977ce04d433aa3083cb46541df13808d1a0c2e
target_sha: 2063b0d5d218ee558732445a56c3859706903db1
verdict: BATCH-PASS
findings: C0 H0 M0 L0
broker_job_id: audit-mre6rpmh-mb8fkn
broker_output_sha256: 54a75513d767d46738605ef653e177fa57a7d9c06e7b134765b7f333c5ed7805
-->
