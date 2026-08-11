**Findings**

Medium: [linkStatusResolverQueries.ts](/Users/zhongyibao/ClaudeProjects/lawbar-tool/services/case-box-persistence/src/sqlite/linkStatusResolverQueries.ts:135) computes statuses outside the transaction, then opens a separate transaction only for updates at line 143. That means the resolver does not atomically compute and apply one scope snapshot; another connection can change anchors/pages/geometries/doc supersession between the SELECT and UPDATE, leaving statuses based on stale inputs. Fix: wrap the compute, changed-row filtering, summary calculation, and updates in one `db.transaction(...).immediate()` and return the result from that transaction.

Low: [hardening-link-status-resolver.test.mjs](/Users/zhongyibao/ClaudeProjects/lawbar-tool/services/case-box-persistence/tests/hardening-link-status-resolver.test.mjs:107) covers ladder rungs and idempotence, but does not prove tenant/matter isolation for anchors/pages/geometries/supersession. Add tests where same IDs exist or are referenced across another tenant/matter and assert the in-scope link resolves `broken` or ignores out-of-scope supersession.

Low: [hardening-link-status-resolver.test.mjs](/Users/zhongyibao/ClaudeProjects/lawbar-tool/services/case-box-persistence/tests/hardening-link-status-resolver.test.mjs:232) asserts `updated === 0` on a second run, but it does not directly prove “writes ONLY `case_box_links.status`” or “no audit events.” Add a before/after audit-event count and table snapshots for anchors/pages/geometries/documents, plus a targeted assertion that unchanged links are not rewritten if a write-observation hook or SQLite update counter pattern is available.

I did not run the test suite because the current sandbox is read-only and the package test path performs a build.

AUDIT-VERDICT: PASS C0 H0 M1 L2
