Findings:

- A3-DESIGN-L1, Low, [ADR-evidence-a3-link-create-operation.md](/Users/zhongyibao/ClaudeProjects/lawbar-tool/docs/adr/ADR-evidence-a3-link-create-operation.md:96): D4 requires `anchor_id` to exist at create time and §9 correctly requires missing-anchor create rejection, but D6/§9 also say “after `createLink` + `resolveLinkStatuses`” a missing-anchor fixture resolves `broken`. That cannot be produced through `createLink` under require-exists. Fix: reword the resolver/export test to use a raw/legacy orphan row or a post-create corrupted/deleted-anchor fixture, not a normal `createLink` call.

No Critical/High/Medium findings.

Checked facts:
- `LINK_CREATED` is absent from the contract; current `link` kinds are only `LINK_UNLINKED` and `LINK_RELINKED`, both `action: "update"` in [audit-log.ts](/Users/zhongyibao/ClaudeProjects/lawbar-tool/docs/contracts/case-box-contract/src/audit-log.ts:120).
- V11/V12 provide the required create columns plus nullable unlink markers, with no logical-duplicate uniqueness and no schema gap in [schema.ts](/Users/zhongyibao/ClaudeProjects/lawbar-tool/services/case-box-persistence/src/sqlite/schema.ts:601).
- `linkStateForHash` excludes `status` and includes the V12 markers in [linkRepoQueries.ts](/Users/zhongyibao/ClaudeProjects/lawbar-tool/services/case-box-persistence/src/sqlite/linkRepoQueries.ts:105).
- Sequencing is correct: audit-kind contract WI first, persistence impl second.
- Scope discipline is intact: the ADR does not add the kind, change schema/version, implement `createLink`, or touch UI/IPC/export rendering.

AUDIT-VERDICT: PASS C0 H0 M0 L1
