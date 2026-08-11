VERDICT: PASS-WITH-FINDINGS

**Critical**
None.

**High**
None.

**Medium**
None.

**Low**
[services/case-box-persistence/tests/hardening-audit.test.mjs](/Users/zhongyibao/ClaudeProjects/lawbar-tool/services/case-box-persistence/tests/hardening-audit.test.mjs:228): The v2 tamper test changes `MATTER_REGISTERED` to `DEADLINE_MET`, so the failure is driven by ADR §4 metadata inconsistency, not by proving `event_kind` is hashed at the persistence boundary. The assertion `event_kind_inconsistent` is correct for that mutation and proves `verifyAuditChainForMatter` reaches the contract verifier, but it is not the strongest possible persistence tamper assertion. A same `{action, entity_type, reasonRequired}` mutation, such as between compatible matter update kinds, would better prove persisted v2 `event_kind` hash participation via `prev_event_hash_mismatch` or head-anchor mismatch. This is Low because WI-V1 contract tests already cover same-class hashed tamper behavior, and SQLite verification delegates to that contract verifier.

**Scope / Correctness Notes**
Tracked diff scope is upheld: `git diff --name-status` shows only `dev-memo/deferred-audit-findings.md` and `services/case-box-persistence/tests/hardening-audit.test.mjs`. No persistence source, contract source, app code, `package.json`, or migration diff is present.

The tests are non-vacuous overall. They exercise SQLite persistence APIs after DB writes: `listAuditEvents` for event JSON round-trip and `verifyAuditChainForMatter` for v2, tampered, legacy v1, and mixed v1->v2 chains. The SQLite verifier loads `event_json` and calls contract `verifyAuditChain`, then compares the computed head hash to `case_box_audit_chain_heads.head_hash`.

The v1/mixed reconstruction is faithful enough for this conformance target: deleting `event_kind` and `audit_schema_version` enters the contract’s v1 canonicalization path; mixed-chain relinking updates `prev_event_hash` and the persisted head anchor. The `event_hash` column update is not load-bearing for `verifyAuditChainForMatter`, but it keeps the stored row realistic.

The DT-V1-L1 deferred row is accurate and scoped as a Low doc-wording issue.

LOC check matches: `hardening-audit.test.mjs` is 285 lines, under the 1200 cap.

I did not rerun the test gates; I audited the diff and relevant verifier/canonicalization source.
