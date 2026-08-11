Findings:

`AUD-A3-UNLINK-L1` Low [linkRepoQueries.ts](/Users/zhongyibao/ClaudeProjects/lawbar-tool/services/case-box-persistence/src/sqlite/linkRepoQueries.ts:167)  
Why: `relinkLink` accepts an `opts` object with extra runtime fields such as `unlink_reason` and silently ignores them. TypeScript callers are constrained, but JS/IPC-style callers can pass a reason and incorrectly believe it was audited.  
Fix: explicitly reject `unlink_reason`/`reason` on relink with `invalid_argument`, or document that unknown option fields are ignored across this API surface.

`AUD-A3-UNLINK-L2` Low [hardening-link-status-resolver.test.mjs](/Users/zhongyibao/ClaudeProjects/lawbar-tool/services/case-box-persistence/tests/hardening-link-status-resolver.test.mjs:524)  
Why: the hash tests only assert 64-character strings and inequality. They do not prove the hashes equal `entityStateHash` over the authoritative link state with `status` excluded, which is one of the core audit-chain requirements. The implementation does this correctly, but the tests would miss a future regression that includes resolver-derived `status` or hashes the wrong shape.  
Fix: add expected-hash assertions using the same public/internal hash helper or a local explicit canonical input fixture, including a case where `status` changes but the audited state hash input should not.

No Critical/High/Medium issues found. The core operation is SQLite-only, uses `#runImmediateWrite`, builds the audit before the marker update, updates only `unlinked_at`/`unlink_reason`, appends exactly one event through the existing audit-chain helpers, uses one unlink timestamp, preserves rows, and stays within the declared scope. I did not run tests because this was a read-only audit pass.

AUDIT-VERDICT: PASS C0 H0 M0 L2
