Findings: none.

I verified the working diff is limited to the three tracked files in scope. The V12 migration is additive and nullable, `CURRENT_SCHEMA_VERSION` is `12`, `DDL_BY_VERSION` includes `[12, DDL_STATEMENTS_V12]`, V11 DDL remains unchanged, `applySchema` is still version-gated and future-version refusal still happens before mutation. The preserved invariants also hold: `anchor_id` remains `NOT NULL`, `LinkStatus` has no `unlinked`, no FK/cascade/index/check was added for the unlink marker, and `unlinked_at` is declared `TEXT COLLATE BINARY`.

The tests cover the requested V12 behaviors, and the guard-test change is narrowly limited to removing the stale absolute version pin. I did not run package tests because this was a read-only audit, but I did run `git diff`, scope checks, and source/NUL checks.

AUDIT-VERDICT: PASS C0 H0 M0 L0
