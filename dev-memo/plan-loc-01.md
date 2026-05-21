# LOC-01 — Split SqliteOcrPersistence.ts below LOC fail threshold

**Status**: implementing.
**Date**: 2026-05-20.
**Authorizes**: `.claude/rules/loc-guardian.md` over-limit refactor for the only scanner-enforced violation.
**Out of scope**: public API changes, schema changes, queue behavior, OCR worker/fetcher, case-box, dependencies, native ABI repair.

---

## 1. Baseline

- File: `services/ocr-persistence/src/sqlite/SqliteOcrPersistence.ts`.
- Raw LOC: 1219. Pure LOC: 956 (over 800 fail by 156).
- `tsc --noEmit` baseline: green.
- Test baseline: blocked by **documented** native ABI mismatch (`better-sqlite3` compiled for NODE_MODULE_VERSION 127; running Node requires 137). Per user instruction: do NOT repair ABI; label baseline; rely on `tsc --noEmit` + targeted non-native tests where available.

## 2. Target

- Reduce pure LOC of `SqliteOcrPersistence.ts` below 800 (fail).
- Reach ≤500 (warn) is preferable but not required.
- Behavior unchanged. Public API unchanged.
- All imports remain importable from the same module path (`SqliteOcrPersistence` and `openSqliteOcrPersistence` continue to be exported from this file or re-exported through it).

## 3. Extractions (executed in order; tsc check after each)

| # | Sibling | Content | Estimated pure LOC moved |
|---|---|---|---|
| 1 | `src/sqlite/jobRecordMappers.ts` | `OcrJobRow` interface, `rowToJobRecord`, `buildJobRecordFromSubmission` | ~50 |
| 2 | `src/sqlite/atomicEligibility.ts` | `isAtomicEligiblePath` pure predicate | ~12 |
| 3 | `src/sqlite/ocrResultWrites.ts` | `OcrResultRow` interface, `validateResultAgainstJob` (linkage gauntlet shared by `saveOcrResult` + `saveOcrResultOnce`), `insertOcrResultRow` (shared INSERT) | ~80 |
| 4 | `src/sqlite/listOcrJobsByDocument.ts` | Body of `listOcrJobsByDocument` exported as a top-level function taking `db` + query | ~50 |
| 5 | `src/sqlite/listOcrReviewPageRows.ts` | Body of `listOcrReviewPageRows` exported as a top-level function taking `db` + query | ~145 |
| 6 | `src/sqlite/openSqliteOcrPersistence.ts` | `openSqliteOcrPersistence` factory | ~18 |

Class methods on `SqliteOcrPersistence` become one-line delegates to the extracted functions, passing `this.db` (and `this.now` where needed).

## 4. Non-extractions (deliberate)

The optimizer also proposed three micro-optimizations:

- (a) collapse the `let X: T | null = null` sentinel pattern using definite-assignment;
- (b) remove a 12-line dead comment block in `appendOcrStatusOnce`;
- (c) fold the dual-tx scaffolding in `appendOcrStatusOnce` into the strict path.

**Defer (a) and (c).** Both touch the appendOcrStatus/Once tx semantics. User requested "without changing behavior" — even an unreachable null-branch removal is a semantically observable change for static analyzers and crash reports. Without test coverage available, leave them.

**Do (b)** — pure comment removal is a no-behavior change and the comment is misleading after refactoring.

## 5. Validation

After each extraction:

1. `npx tsc --noEmit -p services/ocr-persistence/tsconfig.json` — must stay clean.
2. After the last extraction: re-read `SqliteOcrPersistence.ts` to confirm public-export surface is unchanged (named exports must still resolve from the same module path for downstream consumers).
3. `npm --prefix services/ocr-persistence test` — native ABI baseline failure expected; capture which tests fail purely from ABI vs which fail from refactor regression. Anything that fails NOT due to `ERR_DLOPEN_FAILED` → fix or revert.
4. Quick test of the OCR contract package (unchanged but our types depend on it): `npm --prefix docs/contracts test`.

## 6. Re-export policy

The current file exports:

- `SqliteOcrPersistence` (class)
- `SqliteOcrPersistenceOptions` (interface)
- `isAtomicEligiblePath` (function)
- `openSqliteOcrPersistence` (function)

After extraction, the file re-exports the moved symbols so external consumers (`SqliteOcrPersistence.js` was imported as the public entry) keep importing from one place. Re-exports look like:

```ts
export { isAtomicEligiblePath } from "./atomicEligibility.js";
export { openSqliteOcrPersistence } from "./openSqliteOcrPersistence.js";
```

## 7. Risk

- **Type drift between `OcrJobRow` (was private interface) and the mapper** — extracted module exports the type; class still uses it via import. Validated by tsc.
- **Cursor + filters-hash semantics** — extracting list bodies must preserve `kind: "jobs_by_document"` and `kind: "review_pages"` cursor discriminants exactly. Captured by passing `query` shape verbatim.
- **`this.now` capture in extracted writes** — extracted `saveOcrResult` / `saveOcrResultOnce` helpers take `now: () => Date` as a parameter so the class method passes `this.now`. No semantic change.
- **`db.transaction(...)`** — the transaction is opened inside the class method; the extracted helpers run inside the open transaction. Avoid moving the transaction boundary.
- **`insertOcrResultRow` parameter list** — needs `case_id` from the job row (NOT from the validated result, per the existing "Denorm case_id from JOB (canonical source)" rule). Captured.

## 8. Acceptance

- `SqliteOcrPersistence.ts` pure LOC < 800 (target ≤ 600).
- `tsc --noEmit` clean.
- Public exports unchanged.
- No schema, no dependency, no native-ABI changes.
- `loc-guardian:scan` returns `VERDICT: 0 over limit` for hand-written source.
- Baseline ABI mismatch unchanged.

## 9. Commit

Single commit per user spec:

```
refactor: split sqlite OCR persistence implementation
```
