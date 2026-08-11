**Findings**

Low - `services/case-box-persistence/tests/hardening-anchor-delete-guard.test.mjs:71`: tests prove refusal for `status: "valid"` links, but do not explicitly cover links whose status is `needs_review` or `broken`. The implementation correctly counts all scoped `case_box_links` rows with no status filter, but this is an important invariant because a future regression could accidentally refuse only `valid` links. Fix: add a parameterized test over `["valid", "needs_review", "broken"]` asserting each referenced link status throws typed `anchor_referenced` and leaves rows/status unchanged.

**Audit Summary**

No Critical/High/Medium issues found. The guard is scoped, parameter-bound, read-only, and runs the existence plus reference checks in one `db.transaction(...).immediate()`. It does not delete anchors, mutate links/status, emit audit events, alter schema, add FK/cascade behavior, or touch resolver/export behavior. `errors.ts` adds only `anchor_referenced`; `index.ts` is additive; `package.json` only wires the new test file. NUL-byte check returned clean.

I did not run the full package test command because this environment is read-only and the script builds into `dist`.

AUDIT-VERDICT: PASS C0 H0 M0 L1
