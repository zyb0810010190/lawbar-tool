Low finding:
- L1 `services/case-box-persistence/src/sqlite/exportCitationQueries.ts:44`: stale scope comment says this WI changes “no resolver”, but the current WI explicitly changes resolver marker-awareness. Fix: reword that comment to “no schema, no migration, no UI, no export-file rendering, no cascade, no dependency” or otherwise distinguish the old export WI from WI-A3-UNLINK-RESOLVE.

No Critical/High/Medium findings.

Verification:
- `git diff --name-only` shows only the four scoped tracked files.
- `CURRENT_SCHEMA_VERSION` remains `12`; `schema.ts` is not modified.
- No NUL bytes found in the four scoped files.
- `git diff --check` passed.
- `services/case-box-persistence/node_modules/.bin/tsc -p services/case-box-persistence/tsconfig.json --noEmit` passed.
- I did not run the full package test command because it builds/writes `dist/` and the sandbox is read-only.

Behavioral audit result: resolver marker rung is first and writes only `case_box_links.status` on change; export reads `unlinked_at`, emits `UNLINKED` before status branches, preserves one object per link, keeps `UNLINKED` distinct from structural `BROKEN`, and leaves legacy NULL-marker behavior unchanged.

AUDIT-VERDICT: PASS C0 H0 M0 L1
